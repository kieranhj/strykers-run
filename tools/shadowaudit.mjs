// shadowaudit.mjs - is anything the renderer reads in &3000-&3FFF, with ACCCON's X bit set (the
// CPU seeing shadow RAM), stale? Shadow &3000-&3FFF is a copy of main's taken when a game starts
// (render_reset), so a byte written in play on the main side alone would read old on the shadow side.
//
//   node tools/shadowaudit.mjs DISC.ssd [FRAMES]
//
// Plays tools/playscript.mjs (seed 1) for FRAMES frames (default 20000) from the boot and logs,
// from the first render_reset on: every write to &3000-&3FFF with X clear (main), every write
// to it with X set (shadow), every read of it with X set. Prints each set by address and the PC
// that touched it. Then the judgement, from a model of both copies' bytes (every write's value,
// shadow's from render_reset's copy on):
//   per screen  the save arena and player_save (from the symbols: player_save to KC_ARENA_END, or
//               save_arena_end before the kind cache): each screen's own bytes, main and shadow
//               differing by design; not judged
//   mirrored    everything else in &3000-&3FFF, code and data, and the kind cache's slot 0
//               (decision 36: kc_slot0_y and its masks and pixels after KC_ARENA_END, which
//               kc_build writes to both copies): a read with X set is STALE if the shadow copy's
//               byte differs from main's at that moment
// The problem is any stale read; "read with X set and written in play" (main) is listed too, as
// the first version of this tool reported it.
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, loadSyms } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, framesArg] = process.argv.slice(2);
const FRAMES = parseInt(framesArg || "20000", 10);
const syms = loadSyms(disc);
const symAt = {}; for (const [k, v] of Object.entries(syms)) if (v < 0x8000) (symAt[v] ||= k);
const near = (pc) => { for (let a = pc; a > pc - 0x300; a--) if (symAt[a] !== undefined) return `${symAt[a]}+${pc - a}`; return "&" + pc.toString(16); };
const perLo = syms.player_save, perHi = syms.KC_ARENA_END ?? syms.save_arena_end;
if (perLo === undefined || perHi === undefined) { console.error("no player_save / KC_ARENA_END (save_arena_end) in the symbols"); process.exit(1); }
const perScreen = (a) => a >= perLo && a < perHi;
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const events = makeScript(FRAMES + 10, 1);
let armed = false;
const writesMain = new Map(), writesShadow = new Map(), readsShadow = new Map();
const main = new Map(), shadow = new Map(), stale = new Map();
const note = (m, a) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(near(cpu.pc)); };
// the instruction under way: a store's dummy read of its target and the fetch of its own bytes are
// not reads of data (kc_build's second pass stores into slot 0 and patches its operands with X set)
const STORES = new Set([0x81, 0x85, 0x8d, 0x91, 0x92, 0x95, 0x99, 0x9d, 0x86, 0x8e, 0x96, 0x84, 0x8c, 0x94, 0x64, 0x74, 0x9c, 0x9e]);
let insPc = 0, insOp = 0;
cpu.debugInstruction.add((pc, op) => { insPc = pc; insOp = op; if (pc === syms.render_reset) armed = true; return false; });
const isData = (a) => !STORES.has(insOp) && !(a >= insPc && a <= insPc + 2);
cpu.debugWrite.add((a, v) => {
    if (!armed || a < 0x3000 || a >= 0x4000) return false;
    if (cpu.acccon & 4) { note(writesShadow, a); shadow.set(a, v); } else { note(writesMain, a); main.set(a, v); }
    return false;
});
cpu.debugRead.add((a) => {
    if (!armed || a < 0x3000 || a >= 0x4000 || !(cpu.acccon & 4)) return false;
    note(readsShadow, a);
    // mirrored: the copies agree, as far as the writes since render_reset's copy show (a byte main
    // wrote that shadow never did, or wrote differently, since)
    if (!perScreen(a) && isData(a) && main.has(a) && main.get(a) !== shadow.get(a)) note(stale, a);
    return false;
});
for (let f = 1; f <= FRAMES; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
const show = (title, m) => {
    console.log(`${title}: ${m.size} addresses`);
    const byPc = new Map();
    for (const [a, pcs] of m) for (const pc of pcs) { if (!byPc.has(pc)) byPc.set(pc, []); byPc.get(pc).push(a); }
    for (const [pc, as] of byPc) console.log(`  ${pc}: &${Math.min(...as).toString(16)}-&${Math.max(...as).toString(16)} (${as.length})`);
};
show("written in play, X clear (main)", writesMain);
show("written in play, X set (shadow)", writesShadow);
show("read with X set", readsShadow);
const both = [...readsShadow.keys()].filter((a) => writesMain.has(a));
const mirrored = both.filter((a) => !perScreen(a));
console.log(`read with X set and written in play (main): ${both.length}, of them per screen (&${perLo.toString(16)}-&${(perHi - 1).toString(16)}) ${both.length - mirrored.length}, mirrored ${mirrored.length}`);
if (syms.kc_slot0_y !== undefined) {
    const s0 = mirrored.filter((a) => (a >= syms.kc_slot0_y && a < syms.kc_slot0_y + 257) || a >= perHi);
    console.log(`  of the mirrored, the kind cache's slot 0 (kc_slot0_y and &${perHi.toString(16)} on, written to both copies by kc_build): ${s0.length}; the rest: ${mirrored.length - s0.length}` +
        (mirrored.length - s0.length ? ` - ${mirrored.filter((a) => !s0.includes(a)).slice(0, 40).map((a) => "&" + a.toString(16)).join(" ")}` : ""));
}
show("STALE: read with X set where shadow's copy differed from main's", stale);
console.log(stale.size ? `STALE READS: ${stale.size} addresses` : "no stale reads");
