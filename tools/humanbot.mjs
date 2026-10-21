// humanbot.mjs - a player that reads the game and plays it more as a person would than
// playscript.mjs's WorldBot (which runs right, jumps every 30 passes and grenades what blocks it).
// It sees what is on the screen through the mover tables (positions, types, the projectiles and
// their velocities) and, each pass, picks keys by priority:
//   dodge    an enemy bullet coming at it: duck under one at y 42 (a crouching player is 17 high,
//            calculate_mover_x_max_and_y_max: y 24-41), jump one lower (y 36-38) timed so it passes
//            under the feet at the top of the jump; step back from a grenade or bomb coming down near it
//   mines    jump them
//   guns     stop at range from a heavy gun and lob grenades until it is gone
//   fight    fire at enemy soldiers ahead in range (in taps), turn and fire at one close behind
//   caution  with the shield under half and enemies near (GAMEPLAY_SHIELD), hold back and fire while
//            it recharges
//   travel   walk into fights, run (the run key, GAMEPLAY_RUN) when the way ahead is clear
//   stuck    no progress for a while: playscript.mjs's WorldBot's recovery (back off, grenade, shoot)
// Human touches: each new threat is acted on only after a reaction time of a few passes, the fire
// key is tapped, and now and then it pauses; all from a seeded generator, so a seed is one game.
// Keys are the original's names (playscript.mjs: RIGHT LEFT A=up Z=down SHIFT=fire DELETE=grenade,
// and RUN). Facts it relies on were measured on the gameplay disc, 2026-10-21 (tools/hitwatch.mjs
// and a census of the tables over 5,000 passes): the ground is y 24; enemy bullets fly at y 36-42,
// 2 columns a pass, and hit at 7-8 columns right of the player's x; soldiers are slots 1-9, enemy
// helicopters 10-11, projectiles &0C-&17 (&11 and &0C the player's), bit 7 of a type an enemy.
import { WorldBot } from "./playscript.mjs";

const DUCK_Y = 42;                                   // a crouch (y 24-41) lets only y 42 bullets over (measured: y 38 hits a crouch)
const EMPLACEMENTS = new Set([0x0a, 0x0b, 0x15]);   // (types: the nest, MOVER_TYPE_MACHINE_GUN, _HEAVY_GUN)
const T = { SKELETON: 0x0d, EXPLOSION: 0x0e, BULLET: 0x0f, GRENADE: 0x10, BOMB: 0x11, ROCKET: 0x12, MINE: 0x13, SAM: 0x0c, HEAVY_GUN: 0x15, SHELL: 0x1b };

export function see(m) {
    const { s, syms } = m;
    const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
    const xl = rd(syms.movers_x_low, 0x22), xh = rd(syms.movers_x_high, 0x22), ys = rd(syms.movers_y, 0x22), ts = rd(syms.movers_type_and_colour, 0x22);
    const xv = rd(syms.projectiles_x_velocity, 12), yv = rd(syms.projectiles_y_velocity, 12);
    const px = xl[0] + 256 * xh[0], movers = [];
    for (let i = 1; i < 0x22; i++) {
        if (xh[i] >= 0x80) continue;
        const o = { slot: i, x: xl[i] + 256 * xh[i], y: ys[i], type: ts[i] & 0x7f, enemy: (ts[i] & 0x80) !== 0 };
        o.dx = o.x - px;
        if (i >= 0x0c && i < 0x18) {
            const v = xv[i - 12], w = yv[i - 12];
            o.vx = v & 0x80 ? -(v & 0x7f) : v; o.vy = w & 0x80 ? -(w & 0x7f) : w;   // vy < 0: falling
            o.mine = i === 0x0c || i === 0x11;
        }
        movers.push(o);
    }
    const st = { px, py: ys[0], ptype: ts[0], hidden: xh[0] >= 0x80, view: rd(syms.viewport_left_low)[0] + 256 * rd(syms.viewport_left_high)[0],
        helicopter: rd(syms.player_helicopter)[0], movers };
    st.shield = syms.shield !== undefined ? rd(syms.shield)[0] / 50 : 1;
    st.canRun = syms.run_state !== undefined && rd(syms.run_state)[0] !== 0;
    st.hasRun = syms.run_state !== undefined;
    return st;
}

export class HumanBot {
    constructor({ seed = 1, range = 38 } = {}) {
        let x = (seed * 2654435761) >>> 0 || 1;
        this.rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
        this.RANGE = range;
        this.noticed = new Map();      // slot+type -> pass first seen as a threat (the reaction time)
        this.react = new Map();        // slot+type -> passes to react
        this.plan = []; this.best = -1; this.bestAt = 0; this.fireTap = 0; this.pauseUntil = 0;
        this.recover = new WorldBot();
        this.log = { duck: 0, jump: 0, fire: 0, grenade: 0, back: 0, hold: 0, run: 0, stuck: 0, turn: 0 };
    }
    // a threat is acted on once it has been seen for its reaction time (3-6 passes, a person's 0.12-0.24 s)
    ready(p, o) {
        const k = o.slot * 256 + o.type;
        if (!this.noticed.has(k)) { this.noticed.set(k, p); this.react.set(k, 3 + Math.floor(this.rnd() * 4)); }
        return p - this.noticed.get(k) >= this.react.get(k);
    }
    step(p, st) { const k = this.decide(p, st); if (this.trace) this.trace(p, st, this.why, k); return k; }
    decide(p, st) {
        this.why = "";
        if (p % 200 === 0) { for (const [k, v] of this.noticed) if (p - v > 200) { this.noticed.delete(k); this.react.delete(k); } }
        if (st.hidden || st.ptype === T.SKELETON) { this.why = "dying"; return []; }                 // dying or being rewound
        if (st.helicopter) { this.why = "helicopter"; return ["RIGHT"]; }                                 // (it never boards one; a respawn may)
        if (this.plan.length) { this.why = "plan"; const k = this.plan.shift(); if (!this.plan.length) { this.best = st.px; this.bestAt = p; } return k; }
        if (st.px > this.best) { this.best = st.px; this.bestAt = p; }
        if (p - this.bestAt > 220) {                                          // stuck: the WorldBot's recovery
            this.why = "stuck"; this.log.stuck++; this.plan = this.recover.recovery(); this.recover.stalls.push({ pass: p });
            return this.plan.shift();
        }
        const onGround = st.py === 24;
        const enemies = st.movers.filter((o) => o.slot < 0x0c && o.enemy && o.type !== T.SAM && o.type !== T.SKELETON && o.type !== T.EXPLOSION && o.y < 100);
        const ahead = enemies.filter((o) => o.dx > -2 && o.dx < this.RANGE && !EMPLACEMENTS.has(o.type)).sort((a, b) => a.dx - b.dx);
        const behind = enemies.filter((o) => o.dx <= -2 && o.dx > -14);
        const shots = st.movers.filter((o) => o.vx !== undefined && !o.mine && o.type === T.BULLET && o.y < 100);
        const fire = () => { this.fireTap = (this.fireTap + 1) % 5; return this.fireTap < 2; };   // 2 passes on, 3 off

        // dodge: a bullet coming at the player, from the right (vx < 0) or the left. Seen from 40 columns.
        // mover_types_height_table: the player 30 high (y 24-54), 17 crouched (24-41), a bullet 3: a
        // crouch lets a y 42 bullet over; a lower one (y 36-38) clears only the feet at the top of a
        // jump (y 42-45), about 6-12 passes after UP (one update's crouch first, GAMEPLAY_JUMP), so the
        // jump is timed for that and committed: UP held for it
        // closing on an emplacement (its stream never stops while the player is near): keep running in,
        // jumping forward over the bullet in the way (closing at 3 a pass in the air), not waiting
        const gunAhead = enemies.find((o) => EMPLACEMENTS.has(o.type) && o.dx > 30 && o.dx < 60);
        const gunInRange = enemies.some((o) => EMPLACEMENTS.has(o.type) && o.dx > 0 && o.dx <= 30);
        for (const b of gunInRange ? [] : shots) {                            // in range of one: shoot, don't dodge
            if (gunAhead && b.vx < 0 && b.dx > 0) {
                if (onGround && b.y < DUCK_Y && b.dx - 7 >= 14 && b.dx - 7 <= 28 && this.ready(p, b)) {
                    this.why = "rush-jump"; this.log.jump++;
                    this.plan = Array.from({ length: 7 }, () => ["RIGHT", "A"]);
                    return this.plan.shift();
                }
                continue;
            }
            const coming = (b.vx < 0 && b.dx > 0 && b.dx < 40) || (b.vx > 0 && b.dx < 6 && b.dx > -34);
            if (!coming || !this.ready(p, b)) continue;
            const t = b.vx < 0 ? (b.dx - 7) / -b.vx : (-b.dx) / b.vx;         // passes to impact, standing
            if (b.y >= DUCK_Y && onGround && t < 8) { this.why = "duck"; this.log.duck++; return ["Z"]; }
            if (b.y < DUCK_Y && onGround && t >= 7 && t <= 11) { this.why = "jump";
                this.log.jump++;
                this.plan = Array.from({ length: 7 }, () => ["A"]);            // on the spot: the timing holds
                return this.plan.shift();
            }
            if (b.y < DUCK_Y && onGround && t < 7) { this.why = "wait-bullet"; return []; }                      // too late to jump: stop, don't walk in
        }
        // grenades, bombs and shells coming down: where each will reach the player's head height (y 54;
        // falling speed grows by 1 a pass to 6, the sideways speed stays), and out of the way: forward if
        // it will land behind the player's middle, back if ahead
        for (const g of st.movers) {
            if (g.vx === undefined || g.mine || (g.type !== T.GRENADE && g.type !== T.BOMB && g.type !== T.SHELL)) continue;
            let x = g.dx, y = g.y, vy = g.vy, t = 0;
            while (y > 54 && t < 40) { vy = Math.max(-6, vy - 1); y += vy; x += g.vx; t++; }
            if (t >= 40 || x < -8 || x > 12 || !this.ready(p, g)) continue;
            this.why = "evade"; this.log.back++;
            return x < 3 ? (st.hasRun && st.canRun ? ["RIGHT", "RUN"] : ["RIGHT"]) : ["LEFT"];
        }
        // mines: jump them
        const mine = st.movers.find((o) => o.slot < 0x0c && o.type === T.MINE && o.dx > 3 && o.dx < 10);
        if (mine && onGround && this.ready(p, mine)) { this.why = "mine"; this.log.jump++; return ["RIGHT", "A"]; }
        // emplacements: the type &0A nest (column ~2,270) fires a stream at y 38 (every 6 passes) while
        // the player is near; a y 38 bullet hits even a crouch, and a jump clears one, not a stream.
        // The player's bullets (2 columns a pass for 12) reach ~24-30 columns, so: rush in (jumping
        // forward over its bullets, above), and from 28 columns fire at it (and lob grenades from 16-26)
        const gun = enemies.find((o) => EMPLACEMENTS.has(o.type) && o.dx > 0 && o.dx < 60);
        if (gun) {
            this.why = "gun";
            if (gun.dx <= 30) {
                const k = gun.dx < 10 ? ["LEFT"] : [];
                if (fire()) { k.push("SHIFT"); this.log.fire++; }
                if (gun.dx >= 16 && gun.dx <= 26 && p % 30 < 3) { k.push("DELETE"); this.log.grenade++; }
                return k;
            }
            return st.hasRun && st.canRun ? ["RIGHT", "RUN"] : ["RIGHT"];      // run in (jumping its bullets, above)
        }
        // a soldier close behind: turn and fire
        if (behind.length && this.ready(p, behind[0])) { this.why = "turn"; this.log.turn++; return fire() ? ["LEFT", "SHIFT"] : ["LEFT"]; }
        // soldiers ahead: fire; hold back while the shield recharges
        if (ahead.length && this.ready(p, ahead[0])) { this.why = "fight";
            const near = ahead[0].dx < 12;
            const keys = st.shield < 0.5 || near ? [] : ["RIGHT"];
            if (keys.length === 0) this.log.hold++;
            if (fire()) { keys.push("SHIFT"); this.log.fire++; }               // (no direction key: the facing is kept)
            return keys;
        }
        // now and then a person pauses
        if (p < this.pauseUntil) { this.why = "pause"; return []; }
        if (this.rnd() < 0.002) { this.pauseUntil = p + 10 + Math.floor(this.rnd() * 25); return []; }
        // the way ahead: run when nothing is within 45 columns, else walk
        const clear = !st.movers.some((o) => o.enemy && o.dx > -4 && o.dx < 45 && o.type !== T.SAM && o.y < 100);
        if (clear && st.hasRun && st.canRun) { this.log.run++; return ["RIGHT", "RUN"]; }
        return ["RIGHT"];
    }
}
