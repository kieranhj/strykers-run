// zplive.mjs - which zero-page bytes the logic reads before it writes them, after the renderer
// returns: the bytes render must give back (step 2 layer 3, option B).
//
//   node tools/zplive.mjs DISC.ssd [FRAMES] [SEED]
//
// Plays tools/playscript.mjs for FRAMES frames (default 20000). From each return of render
// (bank 4) to its next entry, outside interrupts, the first access to each of &00-&FF is
// classed read or write; an address is live if any pass's first access to it was a read.
// Writes by restore_game_zp itself do not count: the result is the bytes the renderer's own work
// changes that the logic then reads.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, framesArg, seedArg] = process.argv.slice(2);
const FRAMES = parseInt(framesArg || "20000", 10), SEED = parseInt(seedArg || "1", 10);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const events = makeScript(FRAMES + 10, SEED);
let curPc = 0, inRender = false, entryS = 0, inIrq = false, lastOp = 0, renders = 0;
const seen = new Set(), live = new Map(), written = new Set();
cpu.debugInstruction.add((pc, op) => {
    curPc = pc;
    if (pc === 0xe59e && !inIrq) inIrq = true;
    else if (inIrq && lastOp === 0x40) inIrq = false;
    if (!inIrq) {
        if (inRender && cpu.s > entryS) { inRender = false; seen.clear(); }
        if (!inRender && pc === syms.render && (cpu.romsel & 15) === 4) { inRender = true; entryS = cpu.s; renders++; }
    }
    lastOp = op; return false;
});
cpu.debugRead.add((a) => {
    if (renders && !inRender && !inIrq && a < 0x100 && !seen.has(a)) { seen.add(a); live.set(a, (live.get(a) || 0) + 1); }
    return false;
});
cpu.debugWrite.add((a) => {
    if (a >= 0x100) return false;
    const restoring = curPc >= syms.restore_game_zp && curPc < syms.write_column;
    if (inRender && !inIrq && !restoring) written.add(a);
    if (renders && !inRender && !inIrq) seen.add(a);
    return false;
});
for (let f = 1; f <= FRAMES; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
const h = (a) => "&" + a.toString(16).toUpperCase().padStart(2, "0");
const both = [...live.keys()].filter((a) => written.has(a)).sort((a, b) => a - b);
console.log(JSON.stringify({ disc, frames: FRAMES, seed: SEED, renders, liveRead: live.size, mustRestore: both.length, addresses: both.map(h), live: [...live.keys()].sort((a, b) => a - b).map(h) }));
