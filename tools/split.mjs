// split.mjs - where the palette split lands, field by field, in the running build.
//
//   node tools/split.mjs DISC.ssd FROM_FRAME FRAMES
//
// Plays tools/playscript.mjs (seed 1) to FROM_FRAME, then for FRAMES frames measures the cycles
// from the System VIA CA1 (vsync) flag rising to each &FE21 (palette) write irq1_handler makes:
// the top colour (under 5,000 cycles) and the bottom one (the User VIA T1 fire). Prints the most
// common values, the extremes, the fields with no write, and how far field_count (&90) moved.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MS = await loadMachineSession();
const [disc, fromA, nA] = process.argv.slice(2); const FROM = +fromA, N = +nA;
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
  for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const h0 = syms.irq1_handler, h1 = syms.multiply_A_by_X_2f1e;
const s = await bootMaster(MS, disc); const ev = makeScript(FROM + N + 10, 1);
for (let f = 1; f <= FROM; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
const cpu = s._machine.processor; const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
let prev = 0, rise = null, fields = 0; const top = {}, bot = {}; let missTop = 0, missBot = 0, gotTop = false, gotBot = false;
cpu.debugInstruction.add(() => { cpu.sysvia._catchUp(); const f = cpu.sysvia.ifr & 2; if (f && !prev) { if (rise !== null) { if (!gotTop) missTop++; if (!gotBot) missBot++; } rise = cyc(); fields++; gotTop = gotBot = false; } prev = f; return false; });
cpu.debugWrite.add((addr, v) => { if (addr === 0xfe21 && rise !== null && cpu.pc >= h0 && cpu.pc < h1) { const d = cyc() - rise; const b = d < 5000 ? top : bot; const k = d; b[k] = (b[k] || 0) + 1; if (d < 5000) gotTop = true; else gotBot = true; } return false; });
const fc0 = s.readMemory(0x90, 1)[0];
for (let f = FROM + 1; f <= FROM + N; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
const fc1 = s.readMemory(0x90, 1)[0];
const summ = (o) => { const ks = Object.keys(o).map(Number).sort((a, b) => a - b); const n = ks.reduce((a, k) => a + o[k], 0); return { n, min: ks[0], max: ks[ks.length - 1], top5: Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5) }; };
console.log(JSON.stringify({ disc, fields, topWrite: summ(top), bottomWrite: summ(bot), fieldsWithoutTop: missTop, fieldsWithoutBottom: missBot, fieldCountStep: fc0 === null ? null : (fc1 - fc0 + 256) % 256 }));
