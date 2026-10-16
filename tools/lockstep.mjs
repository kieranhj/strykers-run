// lockstep.mjs - run two builds side by side on identical input and report the first frame
// where what they show differs.
//
//   node tools/lockstep.mjs A.ssd B.ssd [FRAMES] [SEED]
//
// The relocation test (PLAN.md Phase 2): B is the same source assembled with -D SHIFT=&100,
// which moves the game and every bank's contents up a page. Moving by whole pages keeps every
// page-crossing the same, so a correct relocation runs CYCLE FOR CYCLE like the original, even
// though the game takes its random numbers from a VIA timer. Any difference in screen memory
// (&4000-&7FFF) or in the rendered frame means an address that did not move with its target.
// A is the control build (-D SHIFT=&100 -D SHIFT_END=1: the same padding at the end of each
// file, so the two discs have the same layout and load in exactly the same time).
//
// Input is a fixed script from SEED: SHIFT+BREAK, wait for the options screen, press 1, then
// play - runs right with the arrow key, fire (SHIFT), grenades (DELETE), jumps (A), ducks (Z).
// Keys are pressed by keyboard matrix position, as the game's OSBYTE &81 scan reads them.
//
// Prints one line per checkpoint, and at the end a JSON summary:
//   {"frames":N,"identical":true}  or  {"firstDifference":F,"what":"screen RAM &xxxx"}
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
const MachineSession = await loadMachineSession();

const [discA, discB, framesArg, seedArg] = process.argv.slice(2);
if (!discA || !discB) {
    console.error("usage: node tools/lockstep.mjs A.ssd B.ssd [FRAMES] [SEED]");
    process.exit(2);
}
const FRAMES = parseInt(framesArg || "6000", 10);
let seed = parseInt(seedArg || "1", 10) >>> 0;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) / 65536;

// Keyboard matrix [col, row] = internal key number: row * 16 + col (OSBYTE 121 numbering)
const KEY = {
    SHIFT: [0, 0], CTRL: [1, 0], ONE: [0, 3], A: [1, 4], Z: [1, 6],
    LEFT: [9, 1], RIGHT: [9, 7], DELETE: [9, 5],
};

// The input script: frame -> [[down|up, key]]
const BOOT_FRAMES = 50;            // SHIFT held through the BREAK
const START_AT = 2100;             // the options screen is up by ~1700 frames; it ignores keys for a while
// Compare from the title screen on: before that the files are being loaded through
// &1900-&58FF, where the two builds' files legitimately differ, and &4000-&46FF holds MGAME's
// start-up code until the title screen clears it.
const COMPARE_FROM = 1500;
// LOCKSTEP_SHOTS=n saves build/lockstep-<frame>.png every n frames (of B), to see what was played.
const SHOTS = parseInt(process.env.LOCKSTEP_SHOTS || "0", 10);
const events = new Map();
const at = (f, ev) => { if (!events.has(f)) events.set(f, []); events.get(f).push(ev); };
// The title alternates the high score table with the options; 1 only starts a game from the
// options, so press it a few times (it is not a game key).
for (let k = 0; k < 4; k++) { at(START_AT + 300 * k, ["down", "ONE"]); at(START_AT + 300 * k + 40, ["up", "ONE"]); }
for (let f = START_AT + 1000; f < FRAMES; ) {
    // a burst of activity, then a pause
    const len = 20 + Math.floor(rnd() * 150);
    const keys = [];
    if (rnd() < 0.8) keys.push("RIGHT"); else if (rnd() < 0.5) keys.push("LEFT");
    if (rnd() < 0.5) keys.push("SHIFT");
    if (rnd() < 0.15) keys.push("DELETE");
    if (rnd() < 0.2) keys.push("A"); else if (rnd() < 0.1) keys.push("Z");
    for (const k of keys) { at(f, ["down", k]); at(f + len, ["up", k]); }
    f += len + 1 + Math.floor(rnd() * 20);
}

async function boot(disc) {
    const s = new MachineSession("Master", { tube: false });
    await s.initialise();
    await s.boot(30);
    s.loadDisc(disc);
    s.keyDownRaw(KEY.SHIFT);
    s.reset(true);
    return s;
}

const a = await boot(discA);
const b = await boot(discB);
const hash = (buf) => createHash("md5").update(buf).digest("hex");

let result = { frames: FRAMES, identical: true };
for (let f = 1; f <= FRAMES; f++) {
    if (f === BOOT_FRAMES) { a.keyUpRaw(KEY.SHIFT); b.keyUpRaw(KEY.SHIFT); }
    for (const [what, k] of events.get(f) || []) {
        for (const s of [a, b]) (what === "down" ? s.keyDownRaw(KEY[k]) : s.keyUpRaw(KEY[k]));
    }
    await a.runFrames(1);
    await b.runFrames(1);

    if (f < COMPARE_FROM) continue;
    const ra = a.readMemory(0x4000, 0x4000), rb = b.readMemory(0x4000, 0x4000);
    let diff = -1;
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) { diff = i; break; }
    if (diff < 0 && f % 10 === 0 && hash(a._completeFb8) !== hash(b._completeFb8)) diff = -2;
    if (diff !== -1) {
        result = {
            firstDifference: f,
            what: diff === -2 ? "rendered frame" : `screen RAM &${(0x4000 + diff).toString(16).toUpperCase()}`,
            pcA: a.registers().pc?.toString(16), pcB: b.registers().pc?.toString(16),
        };
        break;
    }
    if (SHOTS && f % SHOTS === 0) writeFileSync(`build/lockstep-${f}.png`, await b.screenshotActive({ scale: 1 }));
    if (f % 500 === 0) console.error(`  frame ${f}: identical (cycles ${a.elapsedCycles} / ${b.elapsedCycles})`);
}
console.log(JSON.stringify(result));
process.exit(result.identical ? 0 : 1);
