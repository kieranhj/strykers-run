// selfhit.mjs - decision 49: projectiles that hit a mover touching the player, and hit the player
// instead (the original's rule at `.not_bullet`: check_for_player_collision_with_mover_Y, then
// LDY #MOVER_PLAYER). The WorldBot plays the whole world; every such hit is counted by the
// projectile's slot (&11 the player's bullet, &0C its grenade, others the enemies').
//   GAMEPLAY_SHIELD builds: none (the mover hit takes it): fails on any
//   other builds: the original's rule, counted only
//
//   --point-blank: the case KC found (2026-10-21): wherever a friendly soldier (type 1) is on the
//   screen and the player stands on the ground, the soldier is moved onto the player and the player
//   fires, standing still, for 8 passes; 10 times. Each hit on the player is shown with its path (KC's
//   hit was an enemy's bullet into the soldier); a GAMEPLAY_SHIELD build fails on any that came
//   through a mover touching the player
//
//   node tools/selfhit.mjs DISC.ssd [--passes N] [--point-blank]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const PASSES = +opt("--passes", 16000);
const PB = args.indexOf("--point-blank") >= 0 && args.splice(args.indexOf("--point-blank"), 1).length;
const disc = args[0];

const m = await startWorldGame(MachineSession, disc);
const { s, cpu, syms } = m;
const shield = syms.shield_hit !== undefined;
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const zp = (name) => rd(syms[name])[0];
const REDIRECT = syms.projectile_hit_player - 2;            // LDY #&00 (MOVER_PLAYER), the original's
if (!shield && rd(REDIRECT, 2).join() !== "160,0") throw new Error(`${disc}: no LDY #0 before projectile_hit_player`);
const redirects = {};
cpu.debugInstruction.add((pc) => {
    if (shield ? pc === syms.projectile_hit_player && cpu.y === 0 && zp("hostile_mover") !== 0 : pc === REDIRECT) {
        const k = zp("mover_to_update"); redirects[k] = (redirects[k] || 0) + 1;
        if (trial) trial.through = true;
    }
    if (pc === syms.shield_hit && trial) {        // --point-blank: who hit the player, and from where
        const sp = cpu.s, st = [];
        for (let i = 1; i <= 12; i += 2) { const lo = rd(0x100 + ((sp + i) & 255))[0], hi = rd(0x100 + ((sp + i + 1) & 255))[0]; st.push(((hi << 8 | lo) + 1 - 3)); }
        const near = (a) => { let best = null; for (const [k, v] of Object.entries(syms)) if (v <= a && a - v < 0x200 && (!best || v > best[1]) && !/^[A-Z_0-9]+$/.test(k)) best = [k, v]; return best ? `${best[0]}+${a - best[1]}` : a.toString(16); };
        (trial.hits ||= []).push(`hit_type &${zp("hit_type").toString(16)} hostile_mover &${zp("hostile_mover").toString(16)} mover_to_update &${zp("mover_to_update").toString(16)} via ${st.slice(0, 5).map(near).join(" < ")}`);
    }
    return false;
});

const bot = new WorldBot();
let end = "passes", trials = [], trial = null;
const wr = (a, v) => s.writeMemory(a, [v]);
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    const st = worldState(m);
    if (PB && trial) {
        if (p - trial.pass < 8) { pressKeys(m, ["SHIFT"]); continue; }          // fire (the original's SHIFT), standing
        const t = rd(syms.movers_type_and_colour + trial.slot)[0], xh = rd(syms.movers_x_high + trial.slot)[0];
        trial.after = { shield: shield ? zp("shield") : null, lives: zp("lives"), type: t, gone: xh >= 0x80 };
        trials.push(trial); trial = null;
        if (trials.length >= 10) break;
    }
    if (PB && !trial && p > 50 && st.helicopter === 0 && st.py === 0x18 && rd(syms.movers_type_and_colour)[0] === 0
        && (!shield || (zp("shield") === 50 && zp("invulnerable") === 0)) && (trials.length === 0 || p - trials.at(-1).pass > 150)) {
        for (let i = 1; i <= 9; i++) {
            const xh = rd(syms.movers_x_high + i)[0], x = xh * 256 + rd(syms.movers_x_low + i)[0];
            if (xh >= 0x80 || rd(syms.movers_type_and_colour + i)[0] !== 1 || x < st.view + 8 || x > st.view + 72) continue;
            wr(syms.movers_x_low + i, st.px & 255); wr(syms.movers_x_high + i, st.px >> 8);   // onto the player
            trial = { pass: p, slot: i, before: { shield: shield ? zp("shield") : null, lives: zp("lives") } };
            pressKeys(m, ["SHIFT"]);
            break;
        }
        if (trial) continue;
    }
    pressKeys(m, bot.step(p, worldState(m)));
}
if (PB) {
    let bad = 0;
    for (const t of trials) {
        const hurt = t.after.lives < t.before.lives || (shield && t.after.shield < t.before.shield);
        const killed = t.after.gone || t.after.type !== 1;
        if (shield && t.through) bad++;
        console.log(`  pass ${t.pass}: soldier slot ${t.slot} on the player, fire: player ${hurt ? "HIT" : "unhurt"} (shield ${t.before.shield} -> ${t.after.shield}, lives ${t.before.lives} -> ${t.after.lives}); soldier ${killed ? `killed (type &${t.after.type.toString(16)})` : "unharmed"}${t.hits ? "\n      " + t.hits.join("\n      ") : ""}`);
    }
    console.log(`${disc}: point blank, ${trials.length} trials` + (shield ? `, ${bad} wrong` : " (the original's rule)"));
    process.exit(shield && bad ? 1 : 0);
}
const name = (k) => k == 0x11 ? "player's bullet" : k == 0x0c ? "player's grenade" : `slot &${(+k).toString(16)}`;
console.log(`${disc}: ${m.passes} passes (${end}); projectiles that hit the player through a mover touching it: ` +
    (Object.keys(redirects).length ? Object.entries(redirects).map(([k, n]) => `${name(k)} ${n}`).join(", ") : "none"));
const all = Object.values(redirects).reduce((a, n) => a + n, 0);
if (shield && all) { console.log(`FAILED: ${all} projectiles hit the player through a mover touching it (decision 49)`); process.exit(1); }
console.log(shield ? "all rules held" : "(not a GAMEPLAY_SHIELD build: the original's rule, counted)");
