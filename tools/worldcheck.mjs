// worldcheck.mjs - does render.6502's world_of_address agree with the movers' own x and y?
// (BUGS #7: the renderer places a record by where it was drawn.) At every record_live, compares
// the record's x/y (the mover's) with the world column/y worked out from its screen address,
// and counts the disagreements by mover type.
//
//   node tools/worldcheck.mjs DISC.ssd [FRAMES] [SEED]
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MS = await loadMachineSession();
const [disc, framesArg, seedArg] = process.argv.slice(2);
const FRAMES = parseInt(framesArg || "12000", 10), SEED = parseInt(seedArg || "1", 10);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MS, disc); const cpu = s._machine.processor;
const rd = (a) => cpu.readmem(a);
let records = 0; const bad = new Map(); const examples = [];
const REC = { xl: 0x100, xh: 0x180, y: 0x200, type: 0x000 };
const base = syms.rec_wxl - 0x900;
cpu.debugInstruction.add((pc, op) => {
    if (op !== 0x60 || (cpu.romsel & 15) !== 4 || pc < syms.record_live || pc > syms.world_of_address) return false;
    const i = cpu.y; records++;
    const x = rd(base + REC.xh + i) * 256 + rd(base + REC.xl + i), y = rd(base + REC.y + i);
    const wx = rd(syms.rec_wxh + i) * 256 + rd(syms.rec_wxl + i), wy = rd(syms.rec_wy + i);
    const t = rd(base + REC.type + i) & 0x7f;
    if (x !== wx || y !== wy) { bad.set(t, (bad.get(t) || 0) + 1); if (examples.length < 12) examples.push(`type ${t.toString(16)} slot ${i & 63}: x ${x} y ${y}, drawn at ${wx} ${wy}`); }
    return false;
});
const ev = makeScript(FRAMES + 10, SEED);
for (let f = 1; f <= FRAMES; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
console.log(JSON.stringify({ disc, frames: FRAMES, seed: SEED, records, disagreeing: Object.fromEntries([...bad].map(([t, n]) => [t.toString(16), n])) }));
for (const e of examples) console.log("  " + e);
