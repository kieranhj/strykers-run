// colpush.mjs - every scroll's column pushed, once (layer 5, 2026-10-23): per pass, the scrolls
// (start_column) against the pushes (history_push: a fresh column, or a repush of the last), with the
// player's frame (&81) and x_delta where update_screen is decided (skip_animating_player). PLAN's
// layer 5 had, from reading the code, a column lost when moving with frame >= 0 (firing in a
// helicopter) and a column replotted after a hostile collision; this finds neither.
//
//   node tools/colpush.mjs DISC [world [PASSES] | flight V [PASSES] | heli V [PASSES] | jump [PASSES]]
//     world   the WorldBot; flight V  helilock's flight V; heli V  that flight to the helicopter, then
//     right and firing (climbing half the time); jump  run right, jump, let go of every key in the air
//   TRACE=1 prints the passes that fire or decide with frame >= 0.
import { loadMachineSession } from "./jsbeeb_src.mjs";
const MachineSession = await loadMachineSession();
import { startWorldGame, toWorldPass, worldState, pressKeys, WorldBot } from "./playscript.mjs";
import { makeFlight } from "./flightscript.mjs";

const [disc, mode = "world", a3, a4] = process.argv.slice(2);
const V = mode === "flight" || mode === "heli" ? +a3 : -1, PASSES = +(mode === "flight" || mode === "heli" ? a4 : a3) || 12000;
let aboard = 0, traced = 0;
const m = await startWorldGame(MachineSession, disc);
const { s, cpu, syms } = m;
const rd = (a) => s.readMemory(a, 1, { shadow: false })[0];
const zp = (n) => rd(syms[n]);
let cur = { scrolls: 0, fresh: 0, repush: 0 };
const ev = { lost: [], repush: [], lostFrames: {}, passesScrolled: 0 };
let decided = null;
cpu.debugInstruction.add((pc) => {
    if (pc === syms.start_column) cur.scrolls++;
    if (pc === syms.consider_adding_player_bullet_or_grenade) cur.fire = (cur.fire || 0) + 1;
    if (pc === syms.history_push && (cpu.romsel & 15) === 4) { if (rd(syms.col_fresh)) cur.fresh++; else cur.repush++; }
    if (pc === syms.skip_animating_player) decided = { frame: rd(0x81), xd: zp("x_delta"), hostile: zp("hostile_mover"), heli: zp("player_helicopter") };
    return false;
});
const bot = V < 0 ? new WorldBot() : null;
const flight = V >= 0 ? makeFlight(V, syms, rd) : null;
let end = "passes";
for (let p = 1; p <= PASSES; p++) {
    cur = { scrolls: 0, fresh: 0, repush: 0 }; decided = null;
    const r = await toWorldPass(m, p + 1);
    if (r !== "pass") { end = r; break; }
    if (cur.scrolls) ev.passesScrolled++;
    if (process.env.TRACE && (cur.fire || (decided && decided.frame < 128)) && traced++ < 25) console.log(p, JSON.stringify(cur), JSON.stringify(decided), "y", zp("movers_y") ?? rd(syms.movers_y));
    if (cur.scrolls > cur.fresh) { ev.lost.push({ p, ...cur, ...decided }); const k = `frame ${decided?.frame} heli ${decided?.heli}`; ev.lostFrames[k] = (ev.lostFrames[k] || 0) + 1; }
    if (cur.repush) ev.repush.push({ p, ...cur, ...decided });
    if (flight && flight.done && mode !== "heli") { end = "flight done"; break; }
    if (mode === "heli" && aboard > 30 && !rd(syms.player_helicopter)) { end = "left the helicopter"; break; }
    const jk = (q) => q < 10 ? ["RIGHT"] : q < 13 ? ["RIGHT", "A"] : q < 16 ? ["RIGHT"] : q < 36 ? [] : ["RIGHT"];   // jump right, then let go in the air
    if (mode === "heli" && rd(syms.player_helicopter)) aboard++;
    const hk = (q) => q % 20 < 10 ? ["RIGHT", "SHIFT"] : ["RIGHT", "A", "SHIFT"];   // aboard: fly right, firing, climbing half the time
    pressKeys(m, mode === "jump" ? jk(p % 40) : mode === "heli" && aboard > 30 ? hk(p) : flight ? flight.keys(p) : bot.step(p, worldState(m)));
}
console.log(JSON.stringify({ disc, mode, V, passes: m.passes, end, passesScrolled: ev.passesScrolled,
    lost: ev.lost.length, lostBy: ev.lostFrames, lostFirst: ev.lost.slice(0, 5),
    repush: ev.repush.length, repushFirst: ev.repush.slice(0, 5) }, null, 1));
process.exit(0);
