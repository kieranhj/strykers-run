// soundfx.mjs - the SN76489 writes each of the game's 8 sound effects makes, one at a time.
//
//   node tools/soundfx.mjs DISC.ssd OUT.json
//
// Plays tools/playscript.mjs (seed 1) to frame 4000, pauses the game (P), then for each effect
// (play_sound's A = &00, &08 ... &38) patches the pause loop's JSR check_for_player_input to a
// stub at &0C00 that calls play_sound first, and logs [cycles after the call, byte] of every
// chip write for the next 150 fields. Compare two builds' OUT.json channel by channel: a sound
// already playing when the game paused differs with the game state, an effect's own channel
// should not.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MS = await loadMachineSession();
const [disc, out] = process.argv.slice(2);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
  for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MS, disc); const ev = makeScript(4100, 1);
for (let f = 1; f <= 4000; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
s.releaseAllKeys(); await s.runFrames(20);
s.keyDownRaw(gameKey(s, "P")); await s.runFrames(10); s.keyUpRaw(gameKey(s, "P")); await s.runFrames(300);   // P: pause, let sounds end
const cpu = s._machine.processor; const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const chip = cpu.soundChip; const orig = chip.poke.bind(chip);
let log = null; chip.poke = (v) => { if (log) log.push([cyc(), v]); return orig(v); };
const W = syms.wait_for_unpause, PS = syms.play_sound, CP = syms.check_for_player_input, STUB = 0x0c00;
const at = []; let t0 = null;
cpu.debugInstruction.add((pc) => { if (pc === STUB) { s.writeMemory(W + 1, [CP & 255, CP >> 8]); t0 = cyc(); } return false; });
const pcs = []; cpu.debugInstruction.add((pc) => { if (pcs.length < 1 && pc === W) pcs.push(pc); return false; });
await s.runFrames(5);
if (!pcs.length) { console.log("not in the pause loop"); process.exit(1); }
const result = {};
for (let off = 0; off < 0x40; off += 8) {
  s.writeMemory(STUB, [0xA9, off, 0x20, PS & 255, PS >> 8, 0x4C, CP & 255, CP >> 8]);
  log = []; t0 = null;
  s.writeMemory(W + 1, [STUB & 255, STUB >> 8]);
  await s.runFrames(150);
  result[off] = log.filter(([c]) => t0 !== null && c >= t0).map(([c, v]) => [Math.round(c - t0), v]);
  log = null; await s.runFrames(50);
}
writeFileSync(out, JSON.stringify(result));
console.log(disc, Object.entries(result).map(([k, v]) => `&${(+k).toString(16)}:${v.length}`).join(" "));
