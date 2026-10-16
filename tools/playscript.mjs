// playscript.mjs - the fixed input script the harnesses play (lockstep.mjs, tracediff.mjs).
//
// Frames count from the SHIFT+BREAK that boots the disc. Keys are keyboard matrix positions
// [col, row] (internal key number = row * 16 + col), pressed with keyDownRaw, which is what the
// game's OSBYTE &81 scan reads - no host key map in between.

import { readFileSync } from "node:fs";

export const KEY = {
    SHIFT: [0, 0], CTRL: [1, 0], ONE: [0, 3], A: [1, 4], Z: [1, 6],
    LEFT: [9, 1], RIGHT: [9, 7], DELETE: [9, 5], P: [7, 3],
    BOOT_SHIFT: [0, 0],                                // SHIFT held through the BREAK: not the game's
};

// The game's actions, named by the original's keys, in the order of its `keys` table: up, down,
// right, left, fire, grenade, enter, pause.
const ACTIONS = ["A", "Z", "RIGHT", "LEFT", "SHIFT", "DELETE", "CTRL", "P"];

/** The key that session's game has for an action (named by the original's key: "A" is up,
 *  "SHIFT" fire...): read once from the build's own `keys` table (negative INKEY numbers), so a
 *  build with other keys plays the same game as one with the original's. Anything else (ONE, or
 *  SHIFT for the boot, which uses KEY directly) is KEY's. Call it once the game is loaded. */
export function gameKey(s, k) {
    if (!ACTIONS.includes(k)) return KEY[k];
    if (!s._gameKeys) {
        const syms = {};
        for (const sec of JSON.parse(readFileSync(s._disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
            for (const [n, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[n] = v.value;
        const t = s.readMemory(syms.keys, 8, { shadow: false });
        s._gameKeys = {};
        ACTIONS.forEach((n, i) => { const key = ~t[i] & 0x7f; s._gameKeys[n] = [key & 15, key >> 4]; });
    }
    return s._gameKeys[k];
}

export const BOOT_FRAMES = 50;        // SHIFT held through the BREAK
export const START_AT = 2100;         // the title is up by ~1700 frames and ignores keys a while

/** frame -> [[ "down" | "up", key name ]] for a game of FRAMES frames from SEED. */
export function makeScript(FRAMES, SEED = 1) {
    let seed = SEED >>> 0;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) / 65536;
    const events = new Map();
    const at = (f, ev) => { if (!events.has(f)) events.set(f, []); events.get(f).push(ev); };
    at(BOOT_FRAMES, ["up", "BOOT_SHIFT"]);
    // The title alternates the high score table with the options; 1 only starts a game from
    // the options, so press it a few times (it is not a game key).
    for (let k = 0; k < 4; k++) { at(START_AT + 300 * k, ["down", "ONE"]); at(START_AT + 300 * k + 40, ["up", "ONE"]); }
    // and again every 1500 frames, to start a new game after a game over
    for (let f = START_AT + 1500; f < FRAMES; f += 1500) { at(f, ["down", "ONE"]); at(f + 40, ["up", "ONE"]); }
    for (let f = START_AT + 1000; f < FRAMES; ) {
        // a burst of activity, then a pause: run (mostly right), fire, grenades, jump, duck
        const len = 20 + Math.floor(rnd() * 150);
        const keys = [];
        if (rnd() < 0.8) keys.push("RIGHT"); else if (rnd() < 0.5) keys.push("LEFT");
        if (rnd() < 0.5) keys.push("SHIFT");
        if (rnd() < 0.15) keys.push("DELETE");
        if (rnd() < 0.2) keys.push("A"); else if (rnd() < 0.1) keys.push("Z");
        for (const k of keys) { at(f, ["down", k]); at(f + len, ["up", k]); }
        f += len + 1 + Math.floor(rnd() * 20);
    }
    return events;
}

/** Apply every event for frame f to each session. */
export function applyEvents(events, f, sessions) {
    for (const [what, k] of events.get(f) || []) {
        for (const s of sessions) (what === "down" ? s.keyDownRaw(gameKey(s, k)) : s.keyUpRaw(gameKey(s, k)));
    }
}

/** A Master booting `disc` with SHIFT held: frame 0 of the script. */
export async function bootMaster(MachineSession, disc) {
    const s = new MachineSession("Master", { tube: false });
    await s.initialise();
    await s.boot(30);
    s.loadDisc(disc);
    s._disc = disc;
    s.keyDownRaw(KEY.SHIFT);
    s.reset(true);
    return s;
}
