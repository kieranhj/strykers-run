// hitwatch.mjs - every hit on the player over the whole world (tools/playscript.mjs's WorldBot, infinite
// lives poked in as worldrun does), with what made it: for the shield's damage table and the double hit
// (docs/briefs/gameplay-shield.md step 0).
//
//   node tools/hitwatch.mjs DISC.ssd [--passes N] [--json OUT.json]
//
// A hit is an entry to kill_player (kill_mover's path for slot 0, the player on foot) or to
// kill_player_helicopter. For each: the pass, the path that led there (the return addresses on the stack,
// named by the nearest label at or below), mover_to_update (the mover being updated), hostile_mover and
// &8D (the projectile's collision), and the type of each of those slots. Then the hits grouped: by path
// and culprit type, and every pair of hits by the same slot within 12 passes (the double hit).
import { writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const PASSES = +opt("--passes", 13000), JSON_OUT = opt("--json", null);
const disc = args[0];

const m = await startWorldGame(MachineSession, disc);
const { s, cpu, syms } = m;
const rd = (a) => s.readMemory(a, 1, { shadow: false })[0];
const labels = Object.entries(syms).filter(([k, v]) => v >= 0x0e00 && v < 0x4000 && !k.includes(".")).sort((a, b) => a[1] - b[1]);
const name = (a) => { let best = null; for (const [k, v] of labels) { if (v > a) break; best = [k, v]; } return best ? `${best[0]}+${a - best[1]}` : `&${a.toString(16)}`; };
const TYPES = ["PLAYER", "SOLDIER_WITH_RIFLE", "OFFICER_WITH_PISTOL", "TROOPER_WITH_RIFLE", "TROOPER_WITH_BAZOOKA",
    "HELICOPTER_WITH_MISSILE", "HELICOPTER", "HELICOPTER_WITH_SOLDIER", "RED_HELICOPTER", "MORTAR", "MACHINE_GUN",
    "BLUE_CRAFT", "SAM", "SKELETON", "EXPLOSION", "BULLET", "GRENADE", "BOMB", "ROCKET", "MINE", "TANK", "HEAVY_GUN",
    "GREEN_WHITE_HELICOPTER", "GREEN_WHITE_CRAFT_ONE", "GREEN_WHITE_CRAFT_TWO", "FLYING_SCOOTER",
    "GREEN_WHITE_HELICOPTER_WITH_MISSILE", "SHELL"];
const typeName = (t) => TYPES[t & 0x7f] ?? `&${(t & 0x7f).toString(16)}`;
// the types as they were where the collision path began (kill_mover turns the hit mover into an
// explosion or a skeleton before kill_player runs): snapshotted at each path's start
let pre = null;
const snapshot = () => { pre = s.readMemory(syms.movers_type_and_colour, 0x22, { shadow: false }); };
const typeOf = (slot) => slot < 0 || slot > 0x21 ? null : typeName((pre ?? s.readMemory(syms.movers_type_and_colour, 0x22, { shadow: false }))[slot]);

const hits = [];
const watch = (pc, kind) => {
    const sp = cpu.s;
    const stack = [];
    for (let i = 1; i <= 12 && sp + i + 1 <= 0xff; i += 2) {
        const ret = (rd(0x100 + sp + i) | rd(0x100 + sp + i + 1) << 8) + 1;
        if (ret >= 0x0e00 && ret < 0x4000) stack.push(name(ret - 3));     // the JSR's own address
    }
    const mtu = rd(syms.mover_to_update), hos = rd(syms.hostile_mover), p8d = rd(0x8d);
    hits.push({ pass: m.passes, kind, stack: stack.slice(0, 4), mover_to_update: mtu, hostile_mover: hos, zp8d: p8d,
        mtuType: typeOf(mtu), hostileType: typeOf(hos), p8dType: typeOf(p8d), lives: rd(syms.lives) });
    pre = null;
};
cpu.debugInstruction.add((pc) => {
    if (pc === syms.skip_rebuffering_player || pc === syms.projectile_hit_mover || pc === syms.kill_hostile_mover_and_mover) snapshot();
    if (pc === syms.kill_player) watch(pc, "on foot");
    else if (pc === syms.kill_player_helicopter) watch(pc, "helicopter");
    return false;
});

const bot = new WorldBot();
let end = "passes";
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    pressKeys(m, bot.step(p, worldState(m)));
}

const playerPath = (h) => h.stack[0] && (h.stack[0].startsWith("not_tank") || h.stack[0].startsWith("skip_rebuffering_player"));
const culprit = (h) => playerPath(h) ? `ran into ${h.hostileType} (slot ${h.hostile_mover})`
    : h.stack[0] && h.stack[0].startsWith("projectile_hit_player") ? `${h.mtuType} (slot ${h.mover_to_update}) hit the player`
    : `${h.mtuType} (slot ${h.mover_to_update}) moved into the player`;
const byKind = {};
for (const h of hits) { const k = `${h.kind}: ${culprit(h).replace(/ \(slot \d+\)/, "")} via ${h.stack[0]}`; byKind[k] = (byKind[k] || 0) + 1; }
const slotOf = (h) => playerPath(h) ? h.hostile_mover : h.mover_to_update;
const doubles = [];
for (let i = 1; i < hits.length; i++)
    for (let j = i - 1; j >= 0 && hits[i].pass - hits[j].pass <= 12; j--)
        if (slotOf(hits[i]) === slotOf(hits[j])) doubles.push({ first: hits[j], second: hits[i] });
console.log(`${disc}: ${m.passes} passes (${end}), ${hits.length} hits on the player`);
console.log("by kind:"); for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
console.log(`the same slot twice within 12 passes: ${doubles.length}`);
for (const d of doubles.slice(0, 20))
    console.log(`  pass ${d.first.pass} ${culprit(d.first)} via ${d.first.stack.join(" < ")}\n    then pass ${d.second.pass} ${culprit(d.second)} via ${d.second.stack.join(" < ")}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ disc, passes: m.passes, hits, doubles }, null, 1));
process.exit(0);
