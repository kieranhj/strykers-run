// profile.mjs - where the game's time goes, measured on the running build.
//
//   node tools/profile.mjs DISC.ssd [FROM_FRAME] [FRAMES] [--json OUT.json]
//
// Plays tools/playscript.mjs (seed 1) to FROM_FRAME (default 4000: in play, after the start),
// then for FRAMES frames (default 1000) records:
//   passes     main_game_loop iterations, and how many fields (50 Hz) each took - the game's
//              real frame rate, which is what the optimisation is about
//   profile    every instruction's cycles, charged to the routine it is in: the nearest JSR
//              target (or wait_for_* loop) at or below its PC in the same bank, so a routine's
//              internal labels do not split it. MOS and paged ROM time is "MOS <- caller" when a
//              game routine called it, "MOS (interrupt)" when an interrupt took it there.
// Cycles are the CPU's own counter (currentCycles + cycleSeconds * 2e6), read in the
// instruction hook, so each instruction is charged what it took, interrupts included in
// whichever routine they arrived in... except that the IRQ handler's own instructions are
// charged to it, and the MOS's to "MOS".
//
// Needs the build's symbol dump (DISC with .ssd replaced by .symbols.json) and listing (.lst).
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [disc, fromArg, framesArg] = args;
if (!disc) {
    console.error("usage: node tools/profile.mjs DISC.ssd [FROM_FRAME] [FRAMES] [--json OUT.json]");
    process.exit(2);
}
const FROM = parseInt(fromArg || "4000", 10);
const FRAMES = parseInt(framesArg || "1000", 10);

// ---- symbols: labels by bank, and which of them are routines (JSR targets) ----
const SECTION_BANK = { DATA1: 4, DATA2: 5, DATA3: 6, DATA4: 7 };
const json = JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8"));
const secs = json.assemblies[0].sections;
const bankOf = (sec) => {
    for (let s = sec; s; s = s.parent != null ? secs[s.parent] : null) if (s.name in SECTION_BANK) return SECTION_BANK[s.name];
    return -1;
};
const labels = new Map();   // name -> [addr, bank]
for (const sec of secs) for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") labels.set(k, [v.value, bankOf(sec)]);
const listing = readFileSync(disc.replace(/\.ssd$/, ".lst"), "utf8");
const jsrTargets = new Set([...listing.matchAll(/\bJSR\s+([A-Za-z_]\w*)/g)].map((m) => m[1]));
for (const extra of ["main_game_loop", "irq1_handler", "title_screen_irq1_handler", "unpack_column_of_sprite", "entry_point"]) jsrTargets.add(extra);
// Busy-waits on the raster (wait_for_timer, wait_for_vsync...) are buckets of their own. Each
// of the game's ends in an RTS or is a routine's head, so nothing after one is charged to it.
for (const n of labels.keys()) if (/^wait_for/.test(n)) jsrTargets.add(n);
const routines = { "-1": [], 4: [], 5: [], 6: [], 7: [] };
for (const n of jsrTargets) {
    const l = labels.get(n);
    if (l && l[0] < 0xc000) routines[l[0] >= 0x8000 ? l[1] : -1].push([l[0], n]);
}
for (const k in routines) routines[k].sort((a, b) => a[0] - b[0]);
const routineOf = (pc, romsel) => {
    if (pc >= 0xc000) return "MOS";
    const bank = pc >= 0x8000 ? (romsel & 15) : -1;
    if (pc >= 0x8000 && (bank < 4 || bank > 7)) return "MOS";
    const list = routines[bank];
    let lo = 0, hi = list.length - 1, best = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= pc) { best = list[m][1]; lo = m + 1; } else hi = m - 1; }
    return best || `?&${pc.toString(16)}`;
};
const mainLoop = labels.get("main_game_loop")[0];

// ---- run ----
const s = await bootMaster(MachineSession, disc);
const events = makeScript(FROM + FRAMES + 10, 1);
for (let f = 1; f <= FROM; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }

const cpu = s._machine.processor;
const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const charge = new Map();
let lastName = null, lastCyc = cyc();
const passes = [];          // cycle count at each main_game_loop entry
// MOS time is split by how it was entered: "MOS <- routine" for a JSR/JMP from a game routine
// (OSBYTE, OSWORD...), "MOS (interrupt)" otherwise.
let mosVia = "MOS (interrupt)", lastGame = null, lastOpcode = 0;
cpu.debugInstruction.add((pc, opcode) => {
    const c = cyc();
    if (lastName !== null) charge.set(lastName, (charge.get(lastName) || 0) + (c - lastCyc));
    let name = routineOf(pc, cpu.romsel);
    if (name === "MOS") {
        if (lastGame !== null) {
            mosVia = (lastOpcode === 0x20 || lastOpcode === 0x4c || lastOpcode === 0x6c) ? `MOS <- ${lastGame}` : "MOS (interrupt)";
            lastGame = null;
        }
        name = mosVia;
    } else { lastGame = name; lastOpcode = opcode; }
    lastName = name;
    lastCyc = c;
    if (pc === mainLoop) passes.push(c);
    return false;
});
const c0 = cyc();
for (let f = FROM + 1; f <= FROM + FRAMES; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
const total = cyc() - c0;

// ---- report ----
const FIELD = 39936;            // cycles per 312-line field, interlace off (STH's R8 = 0)
const deltas = passes.slice(1).map((c, i) => c - passes[i]);
const hist = {};
for (const d of deltas) { const k = Math.round(d / FIELD); hist[k] = (hist[k] || 0) + 1; }
const meanPass = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
const rows = [...charge.entries()].sort((a, b) => b[1] - a[1]);
const result = {
    disc, from: FROM, frames: FRAMES, cycles: total,
    passes: deltas.length, passesPerSecond: +(deltas.length / (total / 2e6)).toFixed(2),
    meanPassCycles: Math.round(meanPass), meanPassFields: +(meanPass / FIELD).toFixed(2),
    fieldsPerPassHistogram: hist,
    profile: rows.map(([n, c]) => ({ routine: n, cycles: c, pct: +(100 * c / total).toFixed(2) })),
};
console.log(`${disc}: frames ${FROM}-${FROM + FRAMES}, ${total} cycles`);
console.log(`main loop: ${result.passes} passes, ${result.passesPerSecond}/s, mean ${result.meanPassCycles} cycles = ${result.meanPassFields} fields`);
console.log(`fields per pass: ${JSON.stringify(hist)}`);
console.log("routine                                           cycles      %");
for (const r of result.profile.slice(0, 30)) console.log(`  ${r.routine.padEnd(46)} ${String(r.cycles).padStart(10)}  ${r.pct.toFixed(2).padStart(5)}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
