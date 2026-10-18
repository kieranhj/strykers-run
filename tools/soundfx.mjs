// soundfx.mjs - the SN76489 writes each of the game's 8 sound effects makes, one at a time.
//
//   node tools/soundfx.mjs DISC.ssd OUT.json
//
// Plays tools/playscript.mjs (seed 1) to frame 4000, pauses the game (P), then for each effect
// (play_sound's A = &00, &08 ... &38) stops the CPU at the pause loop's JSR check_for_player_input
// (wait_for_unpause) and calls play_sound from there (playscript.mjs's callFrom: the return
// address pushed, PC set; it returns to the JSR), and logs [cycles after the call, byte] of every
// chip write for the next 150 fields. Nothing is written to RAM but the stack: the stub this used
// to put at &0C00 overwrote `times_78_hi` once decisions 32-34 moved things there. Every address
// comes from the build's symbols. Compare two builds' OUT.json channel by channel: a sound
// already playing when the game paused differs with the game state, an effect's own channel
// should not.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey, runToPc, callFrom } from "./playscript.mjs";
const MS = await loadMachineSession();
const [disc, out] = process.argv.slice(2);
if (!out) { console.error("usage: node tools/soundfx.mjs DISC.ssd OUT.json"); process.exit(2); }
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
const W = syms.wait_for_unpause, PS = syms.play_sound;
if (W === undefined || PS === undefined) { console.log("no wait_for_unpause or play_sound in the symbols"); process.exit(1); }
const result = {};
for (let off = 0; off < 0x40; off += 8) {
  if (!(await runToPc(s, W, 10))) { console.log("not in the pause loop"); process.exit(1); }
  log = [];
  callFrom(s, PS, off);
  const t0 = cyc();
  await s.runFrames(150);
  result[off] = log.filter(([c]) => c >= t0).map(([c, v]) => [Math.round(c - t0), v]);
  log = null; await s.runFrames(50);
}
writeFileSync(out, JSON.stringify(result));
console.log(disc, Object.entries(result).map(([k, v]) => `&${(+k).toString(16)}:${v.length}`).join(" "));
