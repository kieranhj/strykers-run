// worldcheck.mjs - does render.6502's world_of_address agree with the movers' own x and y?
// (BUGS #7: the renderer places a record by where it was drawn.) At every record_live, compares
// the record's x/y (the mover's) with the world column/y worked out from its screen address,
// and counts the disagreements by mover type, and those that are a mover clipped at the view's
// left edge (BUGS #10: its screen address is the end of the row above, so it is placed 80 columns
// right and 8 lines up). Before 2026-10-18 this read the records through labels the symbol dump
// does not have (rec_* are assignments, REN_BASE + n), so it compared nothing with nothing.
//
//   node tools/worldcheck.mjs DISC.ssd [FRAMES] [SEED]
//   node tools/worldcheck.mjs DISC.ssd --world     the whole world, start to completion screen,
//                                                  played by playscript.mjs's WorldBot (worldrun.mjs's)
//
// The records' addresses (rec_type, rec_xl, rec_xh, rec_y, rec_wxl, rec_wxh, rec_wy) come from the
// build's symbols.
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, loadSyms, WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MS = await loadMachineSession();
const args = process.argv.slice(2);
const wi = args.indexOf("--world"); const WORLD = wi >= 0; if (WORLD) args.splice(wi, 1);
const [disc, framesArg, seedArg] = args;
const FRAMES = parseInt(framesArg || "12000", 10), SEED = parseInt(seedArg || "1", 10);
const syms = loadSyms(disc);
let records = 0, leftClipped = 0; const bad = new Map(); const examples = [];
function hook(s) {
    const cpu = s._machine.processor;
    const rd = (a) => cpu.readmem(a);
    cpu.debugInstruction.add((pc, op) => {
        if (op !== 0x60 || (cpu.romsel & 15) !== 4 || pc < syms.record_live || pc > syms.world_of_address) return false;
        const i = cpu.y; records++;
        const x = rd(syms.rec_xh + i) * 256 + rd(syms.rec_xl + i), y = rd(syms.rec_y + i);
        const wx = rd(syms.rec_wxh + i) * 256 + rd(syms.rec_wxl + i), wy = rd(syms.rec_wy + i);
        const t = rd(syms.rec_type + i) & 0x7f;
        if (x !== wx || y !== wy) {
            bad.set(t, (bad.get(t) || 0) + 1);
            // BUGS #10: a mover clipped at the view's left edge has a screen address left of the
            // view's first column, which is the end of the character row above: drawn at +80, +8
            const view = rd(syms.viewport_left_low) + 256 * rd(syms.viewport_left_high);
            if (x < view && wx - x === 80 && wy - y === 8) leftClipped++;
            else if (examples.length < 12) examples.push(`type ${t.toString(16)} slot ${i & 63}: x ${x} y ${y}, drawn at ${wx} ${wy}, view ${view}`);
        }
        return false;
    });
}
const out = { disc };
if (WORLD) {
    const m = await startWorldGame(MS, disc);
    hook(m.s);
    const bot = new WorldBot();
    let r = "pass", p = 1;
    for (; p <= 30000 && (r = await toWorldPass(m, p)) === "pass"; p++) pressKeys(m, bot.step(p, worldState(m)));
    Object.assign(out, { world: true, passes: m.passes, completed: m.completed ? m.completed.pass : null, end: r, player: worldState(m).px, stalls: bot.stalls.length });
} else {
    const s = await bootMaster(MS, disc);
    hook(s);
    const ev = makeScript(FRAMES + 10, SEED);
    for (let f = 1; f <= FRAMES; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
    Object.assign(out, { frames: FRAMES, seed: SEED });
}
const disagreeing = [...bad.values()].reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ ...out, records, disagreeing, leftClipped, other: disagreeing - leftClipped, byType: Object.fromEntries([...bad].map(([t, n]) => [t.toString(16), n])) }));
if (examples.length) console.log("disagreements other than a mover clipped at the left edge:");
for (const e of examples) console.log("  " + e);
