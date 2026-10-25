// tracediff.mjs - find the first instruction where a SHIFTed build stops behaving like its control.
//
//   node tools/tracediff.mjs CONTROL.ssd SHIFTED.ssd SHIFT [START_HEX | @FRAME] [MAXCYCLES]
//
// @FRAME: instead of stopping at an address, play tools/playscript.mjs (seed 1) to FRAME and
// compare from there on, still playing the script - for a divergence lockstep.mjs found in play.
//
// CONTROL is -D SHIFT=n -D SHIFT_END=1 (padding at the ends), SHIFTED is -D SHIFT=n (padding at
// the starts); n a multiple of 256, so the two run cycle for cycle alike while the relocation is
// right (see lockstep.mjs). Both boot with SHIFT+BREAK and run to START (default: each build's own
// entry_point, from its symbols: the copy-down stub before it differs by design - it writes its
// own destination operand, and the pages it copies, into &4000-&7FFF at addresses SHIFT apart -
// so starting at the stub, &5181 in both, stops at once on its first STA operand). From there every instruction's PC is recorded,
// mapped back to the unshifted program (the SHIFTED build's game, assembled at &0E00 - n, is moved
// up by n; a bank's code by the offset of the nearest label at or below it that both dumps have in
// that bank - a bank's contents move up or down by n, or not at all, by build: the plain build's
// bank 5 moves DOWN since 2026-10-23, B5_OFF, where a fixed -n for every bank gave a false
// divergence at title_screen), and the two streams are compared. The first
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
    // a section nested in a bank's (andy_data at &8000, hazel_a at &C700: carried in DATA2, run
    // elsewhere) is rephased: its labels are not addresses in that bank, so the bank map skips them
    const rephased = (sec) => sec.parent != null && sec.parent !== 0 && !(sec.name in SECTION_BANK);
    const walk = (o, prefix, bank, re) => {
        for (const [k, v] of Object.entries(o || {})) {
            if (v && typeof v.value === "number") out.push([v.value, prefix + k, bank, re]);
            else if (v && typeof v === "object" && !("value" in v)) walk(v, prefix + k + ".", bank, re);
        }
    };
    for (const sec of secs) walk(sec.labels, "", bankOf(sec), rephased(sec));
    return out.filter(([a]) => a >= 0x400 && a < 0xC000).sort((x, y) => x[0] - y[0]);
}
const symA = loadSymbols(discA);
// The shifted build's game: from its org (GAME_ORG, an assignment in its symbol dump: &0E00 - SHIFT)
// to the end of MGAME as assembled (mgame_end: decisions 32-34 moved it from &46E0 to &46A1,
// decision 40 to &497A), both from its own symbols
const symB = loadSymbols(discB);
const endB = (symB.find(([, n]) => n === "mgame_end") || [])[0];
const orgB = (() => { for (const sec of JSON.parse(readFileSync(discB.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    if (sec.assignments && sec.assignments.GAME_ORG) return sec.assignments.GAME_ORG.value; })();
if (endB === undefined || orgB === undefined) { console.error(`${discB}: no mgame_end or GAME_ORG in its symbols`); process.exit(2); }
if (orgB + SHIFT !== (() => { for (const sec of JSON.parse(readFileSync(discA.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    if (sec.assignments && sec.assignments.GAME_ORG) return sec.assignments.GAME_ORG.value; })()) { console.error(`the two builds' GAME_ORG are not SHIFT apart`); process.exit(2); }
// Each bank's map, shifted -> control: the common labels (same name, same bank) by their shifted
// address, each with its delta; a PC takes the delta of the last one at or below it.
const bankMap = new Map();
{
    const byName = (syms) => { const m = new Map(); for (const [ad, n, bk, re] of syms) if (bk >= 0 && !re) m.set(bk + ":" + n, ad); return m; };
    const mA = byName(symA);
    for (const [ad, n, bk, re] of symB) {
        if (bk < 0 || re || ad < 0x8000) continue;
        const aa = mA.get(bk + ":" + n);
        if (aa === undefined) continue;
        if (!bankMap.has(bk)) bankMap.set(bk, []);
        bankMap.get(bk).push([ad, aa - ad]);
    }
    for (const [bk, list] of bankMap) {
        list.sort((x, y) => x[0] - y[0]);
        const ds = [...new Set(list.map(([, d]) => d))];
        if (ds.some((d) => d % 256 !== 0)) { console.error(`bank ${bk}: a label moved by other than whole pages (${ds.join(", ")})`); process.exit(2); }
        console.error(`bank ${bk}: ${list.length} common labels, offsets ${ds.map((d) => (d < 0 ? "-" : "+") + "&" + Math.abs(d).toString(16)).join(", ")}`);
    }
}
const bankDelta = (bank, pc) => {
    const list = bankMap.get(bank);
    if (!list) return 0;
    let d = 0;
    for (const [ad, dd] of list) { if (ad <= pc) d = dd; else break; }
    return d;
};
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
// default start: entry_point, the game's first instruction once copied down, in each build
const entryOf = (syms, disc) => { const e = (syms.find(([, n]) => n === "entry_point") || [])[0];
    if (e === undefined) { console.error(`${disc}: no entry_point in its symbols: give START_HEX`); process.exit(2); } return e; };
const start = START ?? entryOf(symA, discA), startB = START ?? entryOf(symB, discB);
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
    console.error(`start &${start.toString(16)} / &${startB.toString(16)}`);
    await a.runUntilAddress(start, 120);
    await b.runUntilAddress(startB, 120);
}
console.error(`at start: cycles ${a.elapsedCycles} / ${b.elapsedCycles}`);

const cpuA = a._machine.processor, cpuB = b._machine.processor;
// canonical PC: the shifted build's moved code back to where the control build has it
const canonB = (pc) => {
    // the game is assembled SHIFT lower (&0E00 - SHIFT, to mgame_end); the copy-down stub, run
    // where the file loads it, does not move
    if (pc >= orgB && pc < endB) return pc + SHIFT;
    const bank = cpuB.romsel & 15;
    if (bank >= 4 && bank <= 7 && pc >= 0x8000 && pc < 0xc000) return pc + bankDelta(bank, pc);
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
