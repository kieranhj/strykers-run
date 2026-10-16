// speed.mjs - how fast the original moves: the player's x and the viewport per pass and per
// second, with RIGHT held. The numbers the 50 Hz version has to match (PLAN.md step 2).
//
//   node tools/speed.mjs DISC.ssd [HOLD_FRAMES]
//
// Boots, starts a game (tools/playscript.mjs's start), waits 300 frames, then holds RIGHT for
// HOLD_FRAMES (default 600) and samples at every main_game_loop entry: frame, player x
// (movers_x_high/low slot 0), viewport_left (&BA/&B2), CRTC start (&B0/&B1).
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { KEY, START_AT, makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const [disc, holdArg] = process.argv.slice(2);
const HOLD = parseInt(holdArg || "600", 10);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;

const s = await bootMaster(MachineSession, disc);
const events = makeScript(START_AT + 1300, 1);      // only the boot and the start presses are used
const begin = START_AT + 1300;
for (let f = 1; f <= begin; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }

const cpu = s._machine.processor;
const samples = [];
const rd = (a) => s.readMemory(a, 1)[0];
cpu.debugInstruction.add((pc) => {
    if (pc === syms.main_game_loop) {
        samples.push({
            frame: s.frameCount,
            x: rd(syms.movers_x_high) * 256 + rd(syms.movers_x_low),
            view: rd(0xba) * 256 + rd(0xb2),
            crtc: rd(0xb0) * 256 + rd(0xb1),
        });
    }
    return false;
});
s.keyDownRaw(gameKey(s, "RIGHT"));
for (let f = 0; f < HOLD; f++) await s.runFrames(1);
s.keyUpRaw(gameKey(s, "RIGHT"));

const first = samples[10], last = samples[samples.length - 1];      // skip the start of the run
const frames = last.frame - first.frame, passes = samples.length - 11;
const dx = {}, dv = {}, dc = {};
for (let i = 11; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    dx[b.x - a.x] = (dx[b.x - a.x] || 0) + 1;
    dv[b.view - a.view] = (dv[b.view - a.view] || 0) + 1;
    dc[b.crtc - a.crtc] = (dc[b.crtc - a.crtc] || 0) + 1;
}
console.log(JSON.stringify({
    passes, frames, passesPerSecond: +(passes / frames * 50).toFixed(2),
    playerXPerSecond: +((last.x - first.x) / frames * 50).toFixed(2),
    viewportPerSecond: +((last.view - first.view) / frames * 50).toFixed(2),
    playerXStepPerPass: dx, viewportStepPerPass: dv, crtcStepPerPass: dc,
}));
