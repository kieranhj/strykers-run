// shieldtest.mjs - GAMEPLAY_SHIELD's rules checked over the whole world (decision 44,
// docs/briefs/gameplay-shield.md): the WorldBot plays a shield build (infinite lives poked in, as
// tools/worldrun.mjs does), and every hit and every pass is judged against the rules, independently
// of src/shield.6502's own reasoning:
//   damage    the shield after a hit is max(0, before - 25 or 50): 50 for a grenade, bomb, rocket,
//             mine or shell, 25 otherwise; the culprit's type read where its collision path began
//             (before kill_mover can turn it into an explosion), as tools/hitwatch.mjs reads it
//   deaths    kill_player (a life) is entered for a hit at 0 shield and only then
//   refill    the shield rises only after 125 passes without a hit, by 1 a pass, to 50
//   the bar   hud_buffer's bar shows 3 * shield / 25 filled (green) pixels of 6, the rest red, or
//             all white while it flashes, and a blank last column; its digit is lives_digits'
//
//   --unit U --wait W: the shield's settings (decision 50: a bullet's damage U, an explosive's 2U, the
//   refill after W passes) poked into shield_unit / shield_unit2 / shield_recharge at the first pass,
//   as the game rules screen sets them; by default the build's (25 and 125, decision 44's)
//
//   node tools/shieldtest.mjs DISC.ssd [--passes N] [--unit U --wait W]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const PASSES = +opt("--passes", 13000), UNIT_ARG = opt("--unit", null), WAIT_ARG = opt("--wait", null);
const disc = args[0];

const m = await startWorldGame(MachineSession, disc);
const { s, cpu, syms } = m;
for (const k of ["shield_hit", "shield_tick", "hud_buffer", "font_data"])
    if (syms[k] === undefined) throw new Error(`${disc}: no ${k} - not a GAMEPLAY_SHIELD build?`);
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const zp = (name) => rd(syms[name])[0];
const EXPLOSIVE = new Set([0x10, 0x11, 0x12, 0x13, 0x1b]);
if (UNIT_ARG !== null) s.writeMemory(syms.shield_unit, [+UNIT_ARG, Math.min(255, 2 * UNIT_ARG)]);   // shield_unit, shield_unit2
if (WAIT_ARG !== null) s.writeMemory(syms.shield_recharge, [+WAIT_ARG]);
const UNIT = zp("shield_unit"), WAIT = zp("shield_recharge");
if (!UNIT || !WAIT) throw new Error(`${disc}: shield_unit ${UNIT}, shield_recharge ${WAIT}: not set at the game's start`);

let pre = null;                           // the movers' types where a collision path began
const snapshot = () => { pre = rd(syms.movers_type_and_colour, 0x22); };
const typeAt = (slot) => slot < 0x22 ? (pre ?? rd(syms.movers_type_and_colour, 0x22))[slot] & 0x7f : null;
let hit = null, bars = 0;                           // the hit under way: set at shield_hit, judged at the next pass
const hits = [], fails = [];
const fail = (msg) => { if (fails.length < 30) fails.push(`pass ${m.passes}: ${msg}`); };
cpu.debugInstruction.add((pc) => {
    if (pc === syms.skip_rebuffering_player || pc === syms.projectile_hit_mover || pc === syms.kill_hostile_mover_and_mover) snapshot();
    if (pc === syms.shield_hit) {
        const hos = zp("hostile_mover"), mtu = zp("mover_to_update");
        // the culprit: what the player ran into (hostile_mover), else the mover being updated
        const slot = hos > 0 && hos < 0x80 ? hos : mtu;
        const type = typeAt(slot);
        if (hit && hit.pass === m.passes) hit.second = true;
        hit = { pass: m.passes, slot, type, before: zp("shield"), died: false };
        hits.push(hit);
        pre = null;
    }
    if (pc === syms.kill_player && hit && hit.pass === m.passes) hit.died = true;
    if (pc === syms.play_sound && hit && hit.pass === m.passes) (hit.sounds ||= []).push(cpu.a);
    if (pc === syms.not_the_player && hit && hit.pass === m.passes && rd(0x87)[0] === 0) hit.deathSounds = true;   // the death's sounds follow
    // just after main_game_loop's JSR shield_tick: the bar as the tick left it
    if (pc === syms.not_game_over + 3 && m.passes > 2) checkBar(zp("shield"), zp("lives"));
    return false;
});

function judge() {                     // at the start of a pass: the last pass's hit, and the bar
    const shield = zp("shield"), lives = zp("lives");
    if (hit && hit.pass === m.passes - 1 && !hit.judged) {
        hit.judged = true;
        hit.after = shield;
        const dmg = hit.type !== null && EXPLOSIVE.has(hit.type) ? 2 * UNIT : UNIT;
        hit.expected = hit.before === 0 ? 50 : Math.max(0, hit.before - dmg);
        if (hit.after !== hit.expected) fail(`hit by type ${hit.type} (slot ${hit.slot}) took the shield ${hit.before} -> ${hit.after}, expected ${hit.expected}`);
        if (hit.died !== (hit.before === 0)) fail(`hit at shield ${hit.before}: kill_player ${hit.died ? "entered" : "not entered"}`);
        const snd = hit.sounds || [];                       // KC: an absorbed hit its own sound (&38), not the death's (&00, &10)
        if (hit.before > 0 && (!snd.includes(0x38) || hit.deathSounds)) fail(`absorbed hit: its sound ${snd.includes(0x38) ? "played" : "missing"}, the death's ${hit.deathSounds ? "played" : "not"}`);
        if (hit.before === 0 && (!hit.deathSounds || snd.includes(0x38))) fail(`a death: its sounds ${hit.deathSounds ? "played" : "missing"}, the shield's ${snd.includes(0x38) ? "played" : "not"}`);
    }
    return { shield, lives };
}
function checkBar(shield, lives) {
    const hud = rd(syms.hud_buffer, 72), flash = zp("shield_flash");
    const font = rd(syms.font_data + 0x6c + 6 * lives, 6);     // plot_lives' character, as livesdigits.py made it
    const digit = [];
    for (let c = 0; c < 3; c++) for (let y = 0; y < 8; y++) digit.push((font[2 * c] >> y & 1 ? 0x28 : 0) | (font[2 * c + 1] >> y & 1 ? 0x14 : 0));
    for (let y = 0; y < 8; y++) digit.push(0);
    if (lives < 10 && hud.slice(0, 32).some((b, i) => b !== digit[i])) fail(`hud_buffer's digit is not the font's for ${lives}`);
    const px = Math.floor(3 * shield / 25), white = (flash & 2) !== 0;
    const seg = [0, 1, 2, -1, 3, 4, 5, -1, -1, -1];
    const left = (p) => seg[p] < 0 ? 0 : white ? 0x2a : seg[p] < px ? 0x20 : 0x02;
    for (let c = 0; c < 5; c++) {
        const fill = left(2 * c) | (left(2 * c + 1) >> 1);
        for (let r = 0; r < 8; r++) {
            const want = r === 0 || r === 7 ? 0 : fill, got = hud[32 + 8 * c + r];
            if (got !== want) { fail(`bar column ${c} row ${r}: &${got.toString(16)}, expected &${want.toString(16)} (shield ${shield}, flash ${flash})`); return; }
        }
    }
    bars++;
}

const bot = new WorldBot();
let last = null, quiet = 0, refills = 0, refillPasses = 0, end = "passes";
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    const { shield, lives } = judge();
    const hitLast = hit && hit.pass === p - 1;
    if (last !== null && !hitLast && p > 3) {
        quiet++;
        if (shield > last) {
            refillPasses++;
            if (shield !== last + 1) fail(`shield rose ${last} -> ${shield} in a pass`);
            if (quiet <= WAIT) fail(`shield rose ${quiet} passes after a hit (${WAIT} must pass first)`);
        } else if (shield < last) fail(`shield fell ${last} -> ${shield} with no hit`);
        else if (quiet > WAIT + 1 && shield < 50) fail(`shield stayed at ${shield} ${quiet} passes after a hit`);
        if (last < 50 && shield === 50) refills++;
    } else if (hitLast) quiet = 0;
    last = shield;
    pressKeys(m, bot.step(p, worldState(m)));
}
const byType = {};
for (const h of hits) { const k = `${h.type === null ? "?" : "&" + h.type.toString(16)} ${h.before === 0 ? "at 0 (a life)" : EXPLOSIVE.has(h.type) ? "explosive" : "1 unit"}`; byType[k] = (byType[k] || 0) + 1; }
console.log(`${disc}: ${m.passes} passes (${end}); the bar right after ${bars} ticks; ${hits.length} hits, ${hits.filter((h) => h.died).length} of them lives, ${hits.filter((h) => h.second).length} a second hit in one pass; ${refills} refills to full, ${refillPasses} passes refilling`);
console.log("hits by culprit type:", byType);
console.log(fails.length ? `FAILED (${fails.length}${fails.length === 30 ? "+" : ""}):\n  ` + fails.join("\n  ") : "all rules held");
process.exit(fails.length ? 1 : 0);
