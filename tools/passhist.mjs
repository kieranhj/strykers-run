// passhist.mjs - each pass's work (cycles less the pass lock's wait), and what it did: how the
// slow passes differ from the rest (step 2 layer 3).
//
//   node tools/passhist.mjs DISC.ssd [FROM_FRAME] [FRAMES] [--right]
//
// Per pass: cycles from main_game_loop to the next, less those in wait_for_pass_slot;
// interrupts included. Tagged with the columns the renderer built and wrote, the bytes drawn
// and restored, and the MOS sound calls. Prints a histogram by 10k and the mean of each tag
// per bucket.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { KEY, makeScript, applyEvents, bootMaster, START_AT } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const rightAt = args.indexOf("--right"); const RIGHT = rightAt >= 0; if (RIGHT) args.splice(rightAt, 1);
const [disc, fromArg, framesArg] = args;
const FROM = parseInt(fromArg || (RIGHT ? String(START_AT + 1300) : "4000"), 10), FRAMES = parseInt(framesArg || "1000", 10);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MachineSession, disc);
const events = makeScript(FROM + FRAMES + 10, 1);
for (let f = 1; f <= FROM; f++) { if (!RIGHT || f <= START_AT + 1000) applyEvents(events, f, [s]); await s.runFrames(1); }
if (RIGHT) { s.releaseAllKeys(); s.keyDownRaw(KEY.RIGHT); }
const cpu = s._machine.processor;
const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const passes = []; let cur = null, waitFrom = null, lastC = cyc(), renFrom = null, inIrq = false, irqFrom = 0, lastOp = 0;
const bank4 = () => (cpu.romsel & 15) === 4;
cpu.debugInstruction.add((pc, op) => {
    const c = cyc();
    if (pc === 0xe59e && !inIrq) { inIrq = true; irqFrom = c; } else if (inIrq && lastOp === 0x40) { inIrq = false; if (cur) cur.irq += c - irqFrom; }
    lastOp = op;
    if (pc === syms.main_game_loop) { if (cur) { cur.cycles = c - cur.start - cur.wait; passes.push(cur); } cur = { start: c, render: 0, irq: 0, wait: 0, built: 0, written: 0, drawn: 0, restored: 0, sounds: 0 }; }
    if (!cur) return false;
    if (waitFrom && cpu.s > waitFrom.sp) { cur.wait += c - waitFrom.c; waitFrom = null; }
    if (pc === syms.wait_for_pass_slot && !waitFrom) waitFrom = { c, sp: cpu.s };
    if (renFrom && !inIrq && cpu.s > renFrom.sp) { cur.render += c - renFrom.c; renFrom = null; }
    if (bank4() && pc === syms.render && !renFrom) renFrom = { c, sp: cpu.s };
    if (pc === syms.initialise_column_buffer) cur.built++;
    if (bank4() && pc === syms.write_column) cur.written++;
    if (bank4() && pc === syms["draw_column.byte"]) cur.drawn++;
    if (bank4() && pc === syms["restore_block.byte"]) cur.restored++;
    if (pc === syms.play_sound) cur.sounds++;
    return false;
});
for (let f = FROM + 1; f <= FROM + FRAMES; f++) { if (!RIGHT) applyEvents(events, f, [s]); await s.runFrames(1); }
const buckets = new Map();
for (const p of passes) { const b = Math.floor(p.cycles / 10000) * 10; const e = buckets.get(b) || { n: 0, built: 0, written: 0, drawn: 0, restored: 0, sounds: 0, render: 0, irq: 0 }; e.n++; for (const k of ["built", "written", "drawn", "restored", "sounds", "render", "irq"]) e[k] += p[k]; buckets.set(b, e); }
console.log(`${disc}: frames ${FROM}-${FROM + FRAMES}${RIGHT ? " (RIGHT held)" : ""}: ${passes.length} passes; work = cycles less the pass lock's wait (2 fields = 79,872)`);
console.log("work      passes   built  written    drawn  restored  sounds   render     irq  (means)");
for (const b of [...buckets.keys()].sort((a, b) => a - b)) { const e = buckets.get(b); const m = (k) => (e[k] / e.n).toFixed(1).padStart(7); console.log(`${String(b).padStart(3)}-${String(b + 10).padEnd(3)}k ${String(e.n).padStart(7)} ${m("built")}  ${m("written")}  ${m("drawn")}   ${m("restored")}  ${m("sounds")}  ${String(Math.round(e.render / e.n)).padStart(7)} ${String(Math.round(e.irq / e.n)).padStart(7)}`); }
const over = passes.filter((p) => p.cycles > 79872 - 3000).length;
console.log(`over ~77k (needs 3 fields): ${over} of ${passes.length}`);
