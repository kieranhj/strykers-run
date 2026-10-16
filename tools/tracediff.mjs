// tracediff.mjs - find the first instruction where a SHIFTed build stops behaving like its control.
//
//   node tools/tracediff.mjs CONTROL.ssd SHIFTED.ssd SHIFT [START_HEX | @FRAME] [MAXCYCLES]
//
// @FRAME: instead of stopping at an address, play tools/playscript.mjs (seed 1) to FRAME and
// compare from there on, still playing the script - for a divergence lockstep.mjs found in play.
//
// CONTROL is -D SHIFT=n -D SHIFT_END=1 (padding at the ends), SHIFTED is -D SHIFT=n (padding at
// the starts); n a multiple of 256, so the two run cycle for cycle alike while the relocation is
// right (see lockstep.mjs). Both boot with SHIFT+BREAK and run to START (default: MGAME's copy-down
// stub, which sits at the same address in both). From there every instruction's PC is recorded,
// mapped back to the unshifted program (the SHIFTED build's game, assembled at &0E00 - n, is moved
// up by n, and each bank's code from its org + n down by n), and the two streams are compared. The first
// mismatch is printed with the instructions before it, as label + offset from the symbol dumps.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const [discA, discB, shiftArg, startArg, maxArg] = process.argv.slice(2);
if (!discA || !discB || !shiftArg) {
    console.error("usage: node tools/tracediff.mjs CONTROL.ssd SHIFTED.ssd SHIFT [START_HEX] [MAXCYCLES]");
    process.exit(2);
}
const SHIFT = parseInt(shiftArg, 10);
const MAX = parseInt(maxArg || "400000000", 10);

// Symbols: label -> address, from Baron's --symbols dump, for naming PCs.
// Each label is tagged with the bank its section lives in (-1: main memory), so a PC in
// &8000-&BFFF is named from the bank that was paged in.
const SECTION_BANK = { DATA1: 4, DATA2: 5, DATA3: 6, DATA4: 7 };
function loadSymbols(ssd) {
    const json = JSON.parse(readFileSync(ssd.replace(/\.ssd$/, ".symbols.json"), "utf8"));
    const secs = json.assemblies[0].sections;
    const bankOf = (sec) => {
        for (let s = sec; s; s = s.parent != null ? secs[s.parent] : null) {
            if (s.name in SECTION_BANK) return SECTION_BANK[s.name];
            if (s.parent == null) break;
        }
        return -1;
    };
    const out = [];
    const walk = (o, prefix, bank) => {
        for (const [k, v] of Object.entries(o || {})) {
            if (v && typeof v.value === "number") out.push([v.value, prefix + k, bank]);
            else if (v && typeof v === "object" && !("value" in v)) walk(v, prefix + k + ".", bank);
        }
    };
    for (const sec of secs) walk(sec.labels, "", bankOf(sec));
    return out.filter(([a]) => a >= 0x400 && a < 0xC000).sort((x, y) => x[0] - y[0]);
}
const symA = loadSymbols(discA);
const name = (syms, pcb) => {
    const pc = pcb & 0xffff, bank = pc >= 0x8000 ? pcb >> 16 : -1;
    let best = null;
    for (const [a, n, b] of syms) { if (b !== bank) continue; if (a <= pc) best = [a, n]; else break; }
    return best ? `${best[1]}+${pc - best[0]}` : "?";
};

const a = await bootMaster(MachineSession, discA);
const b = await bootMaster(MachineSession, discB);
const atFrame = startArg && startArg.startsWith("@") ? parseInt(startArg.slice(1), 10) : null;
const events = makeScript(1000000, 1);
let frame = 0;
const START = startArg && !atFrame ? parseInt(startArg, 16) : null;
// default start: the exec address of MGAME, the same in both (the stub follows the padding)
const start = START ?? (symA.find(([, n]) => n === "mgame_relocate") || [0x52e0])[0];
if (atFrame) {
    for (frame = 1; frame <= atFrame; frame++) {
        applyEvents(events, frame, [a, b]);
        await a.runFrames(1);
        await b.runFrames(1);
    }
    console.error(`at frame ${atFrame}`);
} else {
    for (frame = 1; frame <= 50; frame++) {   // SHIFT held through the BREAK, then released
        applyEvents(events, frame, [a, b]);
        await a.runFrames(1);
        await b.runFrames(1);
    }
    console.error(`start &${start.toString(16)}`);
    await a.runUntilAddress(start, 120);
    await b.runUntilAddress(start, 120);
}
console.error(`at start: cycles ${a.elapsedCycles} / ${b.elapsedCycles}`);

const cpuA = a._machine.processor, cpuB = b._machine.processor;
// canonical PC: the shifted build's moved code back to where the control build has it
const canonB = (pc) => {
    // the game is assembled SHIFT lower (&0E00 - SHIFT); the stub at &51E0 does not move
    if (pc >= 0x0e00 - SHIFT && pc < 0x46e0 - SHIFT) return pc + SHIFT;
    const bank = cpuB.romsel & 15;
    if (bank >= 4 && bank <= 7 && pc >= 0x8000 + SHIFT && pc < 0xc000) return pc - SHIFT;
    return pc;
};
// Both streams hold instructions (canonical PC | bank << 16) and, between them, every write
// to the screen (&4000-&7FFF): 0x40000000 | address << 8 | value. Screen writes are pure
// output, so one that differs with the same control flow is a data address that did not move.
const ta = [], tb = [];
const SCREEN_WRITE = 0x40000000;
const tracked = (addr) => (addr >= 0x4000 && addr < 0x8000) || (addr >= 0x300 && addr < 0x400);
// A runs each frame first; B then checks itself against A's stream as it goes and halts AT the
// first entry that differs (before an instruction executes; just after a write). A is then put
// back to the frame's start and replayed to the same entry, so both are stopped at one point.
let haltB = false, diverged = -1, replayTo = -1;
cpuA.debugInstruction.add((pc) => {
    if (replayTo >= 0 && ta.length >= replayTo) return true;
    ta.push(pc | (cpuA.romsel & 15) << 16);
    return replayTo >= 0 && ta.length > replayTo;
});
cpuA.debugWrite.add((addr, v) => { if (tracked(addr)) ta.push(SCREEN_WRITE | addr << 8 | v); });
cpuB.debugInstruction.add((pc) => {
    if (haltB) return true;
    tb.push(canonB(pc) | (cpuB.romsel & 15) << 16);
    const i = tb.length - 1;
    if (i < ta.length && tb[i] !== ta[i]) { diverged = i; return true; }
    return false;
});
cpuB.debugWrite.add((addr, v) => {
    if (!tracked(addr)) return;
    tb.push(SCREEN_WRITE | addr << 8 | v);
    const i = tb.length - 1;
    if (i < ta.length && tb[i] !== ta[i]) { diverged = i; haltB = true; }
});

const nm = (pc) => pc & SCREEN_WRITE ? `  write &${((pc >> 8) & 0xffff).toString(16)} = &${(pc & 0xff).toString(16)}` : ((pc & 0xffff) >= 0x8000 && ((pc >> 16) < 4 || (pc >> 16) > 7)) || (pc & 0xffff) >= 0xc000 ? "(MOS/ROM)" : name(symA, pc);
const line = (pc) => pc & SCREEN_WRITE ? nm(pc) : `   &${(pc & 0xffff).toString(16).padStart(4, "0")} b${pc >> 16}  ${nm(pc)}`;

let total = 0, done = 0;
while (done < MAX) {
    // a frame at a time, the input applied at frame boundaries exactly as lockstep.mjs does
    frame++;
    applyEvents(events, frame, [a, b]);
    const snapA = a.snapshot({ includeRoms: false });
    const c0 = a.elapsedCycles;
    await a.runFrames(1);
    await b.runFrames(1);
    done += a.elapsedCycles - c0;
    if (diverged >= 0) {
        const i = diverged;
        console.log(`first divergence in frame ${frame}, after ${total + i} entries, ${done} cycles from start:`);
        for (const pc of ta.slice(Math.max(0, i - 40), i)) console.log(line(pc));
        console.log(`=> control ${line(ta[i])}`);
        console.log(`   shifted ${line(tb[i])}`);
        // replay A to the same entry
        a.restore(snapA);
        ta.length = 0; replayTo = i;
        if (ta[i] & SCREEN_WRITE) replayTo = i + 1;
        await a.runFrames(1);
        const za = a.readMemory(0, 256), zb = b.readMemory(0, 256);
        const zd = [];
        for (let z = 0; z < 256; z++) if (za[z] !== zb[z]) zd.push(`&${z.toString(16).padStart(2, "0")}:${za[z].toString(16)}/${zb[z].toString(16)}`);
        console.log(`stopped at the divergence. zero page differs (control/shifted): ${zd.join(" ")}`);
        // DUMP=zp: also show 48 bytes at the 16-bit pointer held at that zero page address
        if (process.env.DUMP) {
            const z = parseInt(process.env.DUMP, 16);
            for (const [who, m] of [["control", a], ["shifted", b]]) {
                const p = m.readMemory(z, 2), ptr = p[0] | p[1] << 8;
                console.log(`${who} (&${z.toString(16)}) = &${ptr.toString(16)}: ${Array.from(m.readMemory(ptr, 48)).map((x) => x.toString(16).padStart(2, "0")).join(" ")}`);
            }
        }
        console.log(`registers control ${JSON.stringify(a.registers())}`);
        console.log(`registers shifted ${JSON.stringify(b.registers())}`);
        process.exit(1);
    }
    total += ta.length;
    ta.length = 0; tb.length = 0;
    if (frame % 250 === 0) console.error(`  frame ${frame}: ${total} entries identical`);
}
console.log(`no divergence in ${done} cycles (${total} entries)`);
