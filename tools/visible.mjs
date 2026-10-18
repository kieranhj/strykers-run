// visible.mjs - how many movers each screen shows, and the area of their rectangles, per pass:
// the cost of redrawing everything every frame (masked sprites with a save-under each).
//
//   node tools/visible.mjs DISC.ssd [FROM] [FRAMES] [--right]
//
// At every main_game_loop entry reads the renderer's records (rec_xh in bank 4: &FF = not drawn)
// for the screen just shown, and the live slots' types: counts movers drawn, and sums
// (mover_types_width_table + 1) * (mover_types_height_table + 1) bytes for them, the rectangle
// the original's player save-under used.
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { KEY, makeScript, applyEvents, bootMaster, START_AT, gameKey, loadSyms, readAt } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const rightAt = args.indexOf("--right"); const RIGHT = rightAt >= 0; if (RIGHT) args.splice(rightAt, 1);
const [disc, fromArg, framesArg] = args;
const FROM = parseInt(fromArg || (RIGHT ? String(START_AT + 1300) : "4000"), 10), FRAMES = parseInt(framesArg || "1000", 10);
const syms = loadSyms(disc);          // with the assignments: rec_xh and rec_type are REN_BASE + n
const s = await bootMaster(MachineSession, disc);
const events = makeScript(FROM + FRAMES + 10, 1);
for (let f = 1; f <= FROM; f++) { if (!RIGHT || f <= START_AT + 1000) applyEvents(events, f, [s]); await s.runFrames(1); }
if (RIGHT) { s.releaseAllKeys(); s.keyDownRaw(gameKey(s, "RIGHT")); }
const cpu = s._machine.processor;
// main RAM until decision 40, HAZEL (&DA55, &DA71) since: readAt reads either
const W = readAt(s, syms.mover_types_width_table, 64), H = readAt(s, syms.mover_types_height_table, 64);
const REC_XH = syms.rec_xh, REC_TYPE = syms.rec_type;    // were &B180 / &B000, before c5d760b moved the workspace to &B400
const counts = [], areas = [];
cpu.debugInstruction.add((pc) => {
    if (pc !== syms.main_game_loop) return false;
    const shown = s.readMemory(syms.shown_screen, 1, { shadow: false })[0], off = shown ? 64 : 0;
    const xh = s.readMemory(REC_XH + off, 34, { bank: 4 }), ty = s.readMemory(REC_TYPE + off, 34, { bank: 4 });
    let n = 0, a = 0;
    for (let i = 0; i < 34; i++) if (xh[i] !== 0xff) { n++; const t = ty[i] & 0x7f; a += (W[t] + 1) * (H[t] + 1); }
    counts.push(n); areas.push(a); return false;
});
for (let f = FROM + 1; f <= FROM + FRAMES; f++) { if (!RIGHT) applyEvents(events, f, [s]); await s.runFrames(1); }
const stat = (v) => { const x = [...v].sort((p, q) => p - q); return { mean: +(x.reduce((p, q) => p + q, 0) / x.length).toFixed(1), median: x[x.length >> 1], p90: x[Math.floor(x.length * 0.9)], max: x[x.length - 1] }; };
console.log(JSON.stringify({ disc, from: FROM, frames: FRAMES, right: RIGHT, passes: counts.length, moversShown: stat(counts), rectangleBytes: stat(areas) }));
