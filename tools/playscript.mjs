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
    if (k === "RUN") return KEY.SHIFT;                  // GAMEPLAY_RUN's run key (decision 48): SHIFT
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

/** Run `s` until the CPU is about to execute `pc` (within `fields` fields; false if it never
 *  does), stopped there. */
export async function runToPc(s, pc, fields = 200) {
    const cpu = s._machine.processor;
    let armed = true;
    const h = cpu.debugInstruction.add((at) => armed && at === pc);
    try {
        for (let i = 0; i < fields; i++) { await s.runFrames(1); if (cpu.pc === pc) return true; }
        return false;
    } finally { armed = false; h.remove(); }
}

/** Make the CPU, stopped at an instruction, call `target` with A = `a` as a JSR placed in front
 *  of that instruction would: the return address (the stopped PC - 1) pushed, PC set. RTS then
 *  comes back to the instruction it was stopped at. Writes nothing but the stack: the tools that
 *  fire a sound effect from the pause loop (soundfx.mjs, sfxcapture.mjs) used to put a stub in
 *  "free" RAM at &0C00, which became `times_78_hi` (decisions 32-34). */
export function callFrom(s, target, a) {
    const cpu = s._machine.processor;
    const ret = (cpu.pc - 1) & 0xffff;
    cpu.writemem(0x100 + cpu.s, ret >> 8); cpu.s = (cpu.s - 1) & 0xff;
    cpu.writemem(0x100 + cpu.s, ret & 0xff); cpu.s = (cpu.s - 1) & 0xff;
    cpu.a = a;
    cpu.pc = target;
}

/** The whole world's player (tools/worldrun.mjs): keys chosen each pass from the game's own state,
 *  so two builds whose state is identical are given identical keys. It runs right, jumping (UP for
 *  3 passes in every 30, as tools/hazelreach.mjs did). When the player has made no progress for
 *  STALL passes it is against a hostile mover: DEBUG_LIVES's player cannot die on it, and
 *  `check_for_collision_after_horizontal_move` will not let it through. The crouching soldier at
 *  column 3,358 that stopped hazelreach at view 3,319 is under the player's bullets; a grenade
 *  kills it. So the bot backs off, turns, throws a grenade, fires three shots, and runs on.
 *  `step(p, st)` takes the pass and { px } (the player's x) and returns the keys (the original's
 *  names) to hold for that pass. */
export class WorldBot {
    constructor({ stall = 40, back = 40 } = {}) {
        this.STALL = stall; this.BACK = back;
        this.best = -1; this.bestAt = 0; this.plan = []; this.stalls = [];
    }
    recovery() {
        // back off further each time (a grenade's arc lands ~20-30 columns ahead), turn right,
        // a grenade, a wait for it, then three shots
        const back = this.BACK + 10 * (this.stalls.length % 4), plan = [];
        const hold = (keys, n) => { for (let i = 0; i < n; i++) plan.push(keys); };
        hold(["LEFT"], back); hold([], 4); hold(["RIGHT"], 2); hold([], 4);
        hold(["DELETE"], 4); hold([], 30);
        for (let k = 0; k < 3; k++) { hold(["SHIFT"], 3); hold([], 5); }
        return plan;
    }
    step(p, st) {
        if (this.plan.length) {
            const k = this.plan.shift();
            if (!this.plan.length) { this.best = st.px; this.bestAt = p; }
            return k;
        }
        if (st.px > this.best) { this.best = st.px; this.bestAt = p; }
        if (p - this.bestAt > this.STALL) {
            this.stalls.push({ pass: p, px: st.px });
            this.plan = this.recovery();
            return this.plan.shift();
        }
        return p % 30 < 3 ? ["RIGHT", "A"] : ["RIGHT"];
    }
}

/** label -> address from a disc's symbol dump (DISC.symbols.json beside DISC.ssd): the labels,
 *  then the numeric assignments no label has taken (the zero-page names of src/zp.6502, such as
 *  field_count or viewport_left_low, are assignments, not labels) */
export function loadSyms(disc) {
    const out = {};
    const secs = JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections;
    for (const sec of secs)
        for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") out[k] = v.value;
    for (const sec of secs)
        for (const [k, v] of Object.entries(sec.assignments || {})) if (v && typeof v.value === "number" && !(k in out)) out[k] = v.value;
    return out;
}

/** The generator's two bytes (decision 17), [low, high]: zp.6502's rnd_seed_low/high, an
 *  assignment in the symbol dump (so loadSyms above, not a labels-only reader); &92/&93 in builds
 *  before BUGS #12's fix, and in any build without the names. */
export function prngAt(syms) {
    return [syms.rnd_seed_low ?? 0x92, syms.rnd_seed_high ?? 0x93];
}

/** BUGS #12: the original's set_dying_mover_type_and_frame keeps the dying mover's slot in &92
 *  across a call (STY &92 : LDX &92 : JSR check_for_player_collision_with_mover_Y : LDY &92), and
 *  step 2 before the fix kept the generator's low byte there: each mover's death set it to the
 *  slot. This watches that STY on machine `m` (`m.s`, `m.syms`, `m.passes`) and counts it: every
 *  one, and those that changed the generator (a build whose rnd_seed_low is &92, the slot not
 *  what it held), the first such at m.passes. With `undo`, on such a build, the byte is put back
 *  after the LDY (the BEQ that follows it tests Y, not &92), which is what the fixed build, whose
 *  generator is elsewhere, does by never losing it: so a build before the fix, undone, is the
 *  control for one after. The sequence is found by its bytes from the label, when it first runs. */
export function prngClobber(m, { undo = false } = {}) {
    const cpu = m.s._machine.processor, base = m.syms.set_dying_mover_type_and_frame;
    const st = { generatorAt92: prngAt(m.syms)[0] === 0x92, undo, clobbers: 0, changed: 0, firstClobber: null, firstChanged: null, undone: 0 };
    if (base === undefined) throw new Error("prngClobber: no set_dying_mover_type_and_frame in the symbols");
    let sty = -1, after = -1, saved = -1;
    const ZP92 = [0x84, 0x92, 0xa6, 0x92, 0x20, -1, -1, 0xa4, 0x92];     // STY &92 : LDX &92 : JSR nnnn : LDY &92
    cpu.debugInstruction.add((pc) => {
        if (sty < 0) {
            if (pc !== base) return false;
            for (let a = base; a < base + 48 && sty < 0; a++) if (ZP92.every((b, i) => b < 0 || cpu.readmem(a + i) === b)) sty = a;
            if (sty < 0) throw new Error(`prngClobber: no STY &92 : LDX &92 : JSR : LDY &92 after &${base.toString(16)}`);
            after = sty + ZP92.length;
        }
        if (pc === sty) {
            saved = cpu.readmem(0x92);
            st.clobbers++; st.firstClobber ??= m.passes;
            if (st.generatorAt92 && cpu.y !== saved) { st.changed++; st.firstChanged ??= m.passes; }
        } else if (pc === after && saved >= 0) {
            if (undo && st.generatorAt92 && cpu.readmem(0x92) !== saved) { m.s.writeMemory(0x92, [saved]); st.undone++; }
            saved = -1;
        }
        return false;
    });
    return st;
}

/** [address, length] of the movers' and projectiles' tables, the game state passlock compares:
 *  movers_type_and_colour (the first) to the end of projectiles_ttl (the last; its length the
 *  same as projectiles_is_rocket's, 12). Until decision 40 this ended at mover_types_parts, the
 *  table after it, which decision 40 moved to HAZEL. */
export function moverTables(syms) {
    const end = syms.projectiles_ttl + (syms.projectiles_ttl - syms.projectiles_is_rocket);
    if (!(end > syms.movers_type_and_colour)) throw new Error("no movers_type_and_colour .. projectiles_ttl in the symbols");
    return [syms.movers_type_and_colour, end - syms.movers_type_and_colour];
}

/** Read n bytes at a symbol's address wherever it lives: &3000-&7FFF from main RAM (not shadow),
 *  &C000-&DFFF from HAZEL (ACCCON's Y bit set for the read: decision 40 put tables there, and
 *  outside play the MOS ROM is paged at those addresses), anything else as paged. */
export function readAt(s, addr, n) {
    if (addr >= 0xc000 && addr < 0xe000) {
        const cpu = s._machine.processor, acccon = cpu.acccon;
        try { cpu.writeAcccon(acccon | 8); return s.readMemory(addr, n); } finally { cpu.writeAcccon(acccon); }
    }
    return s.readMemory(addr, n, addr >= 0x3000 && addr < 0x8000 ? { shadow: false } : {});
}

/** A game the WorldBot plays by pass (tools/worldrun.mjs, worldcheck.mjs --world, hazelreach.mjs):
 *  boots `disc` on a Master, starts a game with makeScript's title presses (seed 1), and stops at
 *  the start of each pass (main_game_loop) or at completion_screen. A build without DEBUG_LIVES
 *  (the shipping build) is given infinite lives by the disassembly's own poke, which is what
 *  DEBUG_LIVES assembles: `kill_player`'s DEC lives (&C6 &95) made LDA #lives (&A9 &95), checked
 *  byte for byte before it is written. The fuel table (`movers_helicopter_fuel_high`, which holds
 *  !BOOT's stamp until a helicopter is added) is zeroed at the first pass, as passlock does, so two
 *  builds with different stamps compare equal. */
export async function startWorldGame(MachineSession, disc, { onPass } = {}) {
    const syms = loadSyms(disc);
    const s = await bootMaster(MachineSession, disc);
    const cpu = s._machine.processor;
    const m = { s, cpu, syms, disc, passes: 0, target: 1, lastStop: -1, completed: null, held: [], infiniteLives: null };
    cpu.debugInstruction.add((pc) => {
        if (pc === syms.completion_screen && m.completed === null) { m.completed = { pass: m.passes, cycles: s.elapsedCycles }; return true; }
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;
        m.passes++;
        if (m.passes === 1) {
            s.writeMemory(syms.movers_helicopter_fuel_high ?? 0x0960, new Array(0x22).fill(0));
            const k = [...s.readMemory(syms.kill_player, 2, { shadow: false })];
            if (k[0] === 0xa9 && k[1] === 0x95) m.infiniteLives = "DEBUG_LIVES";
            else if (k[0] === 0xc6 && k[1] === 0x95) { s.writeMemory(syms.kill_player, [0xa9]); m.infiniteLives = "poked kill_player &C6 -> &A9"; }
            else throw new Error(`${disc}: kill_player holds ${k.map((v) => v.toString(16)).join(" ")}, not DEC lives or LDA #lives`);
        }
        if (onPass) onPass(m, c);
        if (m.passes >= m.target) { m.lastStop = c; return true; }
        return false;
    });
    const events = makeScript(6000, 1);
    for (let f = 1; f <= 6000 && m.passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
    if (m.passes < 1) throw new Error(`${disc}: no game started`);
    s.releaseAllKeys();
    return m;
}

/** Run to the start of pass n: "pass", "completed" (completion_screen reached first) or "stalled"
 *  (no pass in 1,500 fields). */
export async function toWorldPass(m, n) {
    m.target = n;
    for (let i = 0; m.passes < n; i++) {
        if (m.completed) return "completed";
        if (i === 150) return "stalled";
        await m.s.runFor(400000);
    }
    return m.completed && m.passes < n ? "completed" : "pass";
}

/** What the WorldBot reads: the player's x and y, the view's left column, helicopter, lives */
export function worldState(m) {
    const rd = (a) => m.s.readMemory(a, 1, { shadow: false })[0];
    const { syms } = m;
    return { px: rd(syms.movers_x_high) * 256 + rd(syms.movers_x_low), py: rd(syms.movers_y),
        view: rd(syms.viewport_left_low) + 256 * rd(syms.viewport_left_high), helicopter: rd(syms.player_helicopter), lives: rd(syms.lives) };
}

/** Hold exactly `keys` (the original's names) from now on */
export function pressKeys(m, keys) {
    for (const k of m.held) if (!keys.includes(k)) m.s.keyUpRaw(gameKey(m.s, k));
    for (const k of keys) if (!m.held.includes(k)) m.s.keyDownRaw(gameKey(m.s, k));
    m.held = keys;
}
