// splitscroll.mjs - the palette split on scrolling fields, where the game re-arms it itself.
//
//   node tools/splitscroll.mjs DISC.ssd
//
// Starts a game as tools/speed.mjs does, holds RIGHT for 600 frames, and per field measures the
// cycles from the vsync flag rising to irq1_handler's bottom palette write (rounded to 64, a
// scanline), split by whether wait_for_vsync_2242 re-armed User VIA T1 in that field, and when
// that re-arm write landed (rounded to 10 cycles).
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { START_AT, makeScript, applyEvents, bootMaster, KEY, gameKey } from "./playscript.mjs";
const MS = await loadMachineSession();
const disc = process.argv[2]; const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
  for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MS, disc); const ev = makeScript(START_AT + 1300, 1);
for (let f = 1; f <= START_AT + 1300; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
const cpu = s._machine.processor; const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
let prev = 0, rise = null, rearm = false; const H = { rearmed: {}, normal: {} }; let rearmAt = {};
cpu.debugInstruction.add((pc) => { cpu.sysvia._catchUp(); const f = cpu.sysvia.ifr & 2; if (f && !prev) { rise = cyc(); rearm = false; } prev = f; return false; });
cpu.debugWrite.add((addr) => { if (rise === null) return false;
  if (addr === 0xfe65 && !(cpu.pc >= syms.irq1_handler && cpu.pc < syms.multiply_A_by_X_2f1e)) { rearm = true; const d = Math.round((cyc() - rise) / 10) * 10; rearmAt[d] = (rearmAt[d] || 0) + 1; }
  if (addr === 0xfe21 && cpu.pc >= syms.irq1_handler && cpu.pc < syms.multiply_A_by_X_2f1e) { const d = cyc() - rise; if (d > 5000) { const b = rearm ? H.rearmed : H.normal; const k = Math.round(d / 64) * 64; b[k] = (b[k] || 0) + 1; } } return false; });
s.keyDownRaw(gameKey(s, "RIGHT")); for (let f = 0; f < 600; f++) await s.runFrames(1);
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join(" ");
console.log(disc, "\n  bottom write, re-armed fields:", top(H.rearmed), "\n  bottom write, other fields:", top(H.normal), "\n  T1 re-arm write after vsync:", top(rearmAt));
