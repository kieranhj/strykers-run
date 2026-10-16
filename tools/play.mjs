// play.mjs - play the scripted game (tools/playscript.mjs) on one disc and save screenshots.
//
//   node tools/play.mjs DISC.ssd [FRAMES] [EVERY] [PREFIX]
//
// A smoke test with the game actually played: boots on a Master, starts a game, runs the input
// script for FRAMES frames and writes build/<PREFIX>-<frame>.png every EVERY frames (defaults
// 20000, 2000, "play"). Prints the frame count and the cycles it took.
import { writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const [disc, framesArg, everyArg, prefixArg] = process.argv.slice(2);
if (!disc) {
    console.error("usage: node tools/play.mjs DISC.ssd [FRAMES] [EVERY] [PREFIX]");
    process.exit(2);
}
const FRAMES = parseInt(framesArg || "20000", 10);
const EVERY = parseInt(everyArg || "2000", 10);
const PREFIX = prefixArg || "play";
const events = makeScript(FRAMES, 1);
const s = await bootMaster(MachineSession, disc);
for (let f = 1; f <= FRAMES; f++) {
    applyEvents(events, f, [s]);
    await s.runFrames(1);
    if (EVERY && f % EVERY === 0) writeFileSync(`build/${PREFIX}-${f}.png`, await s.screenshotActive({ scale: 1 }));
}
console.log(JSON.stringify({ frames: FRAMES, cycles: s.elapsedCycles }));
