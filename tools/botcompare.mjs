// botcompare.mjs - a bot's game on a disc, measured: how far and how fast it gets, the hits it
// takes and the deaths (with the build's own rules: infinite lives poked in as startWorldGame does,
// a death's rewind and all, unless --keep-alive), what is done (the firing, grenade and jump sounds: anyone's firing and grenades)
// and the score. For judging tools/humanbot.mjs against playscript.mjs's WorldBot.
//
//   node tools/botcompare.mjs DISC.ssd [--bot human|world] [--passes N] [--seed S] [--keep-alive]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
import { HumanBot, see } from "./humanbot.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const BOT = opt("--bot", "human"), PASSES = +opt("--passes", 20000), SEED = +opt("--seed", 1), KEEP = flag("--keep-alive");
const disc = args[0];
const m = await startWorldGame(MachineSession, disc, { keepAlive: KEEP });
const { s, cpu, syms } = m;
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const ev = { hits: 0, deaths: 0, shots: 0, grenades: 0, jumps: 0 }, kinds = {};
const byBand = {};                       // hits (lives in the original) by 500 columns of the view
const band = () => { const v = rd(syms.viewport_left_low)[0] + 256 * rd(syms.viewport_left_high)[0]; return 500 * Math.floor(v / 500); };
cpu.debugInstruction.add((pc) => {
    if (pc === (syms.shield_hit ?? -1)) {
        ev.hits++;
        // the culprit: what the player ran into (hostile_mover), else the projectile or mover being updated
        const h = rd(syms.hostile_mover)[0], u = rd(syms.mover_to_update)[0], ran = h > 0 && h < 0x22, sl = ran ? h : u;
        if (sl === 0) { kinds["(no culprit)"] = (kinds["(no culprit)"] || 0) + 1; return false; }
        const px = rd(syms.movers_x_low)[0] + 256 * rd(syms.movers_x_high)[0], x = rd(syms.movers_x_low + sl)[0] + 256 * rd(syms.movers_x_high + sl)[0];
        const k = `type &${(rd(syms.movers_type_and_colour + sl)[0] & 0x7f).toString(16)} ${ran ? "ran into" : "hit by"} slot-${sl < 0x0c ? "soldier" : "proj"} ${x - px < 0 ? "behind" : "ahead"} y${rd(syms.movers_y + sl)[0]} ${(rd(syms.movers_frame_and_flip)[0] & 0x7f) === 0x0d ? "crouched" : rd(syms.movers_y)[0] > 24 ? "in the air" : "standing"}`;
        kinds[k] = (kinds[k] || 0) + 1;
    }
    if (pc === syms.kill_player) { ev.deaths++; const b = band(); (byBand[b] ||= { hits: 0, deaths: 0 }).deaths++; }
    if (pc === (syms.shield_hit ?? syms.kill_player)) { const b = band(); (byBand[b] ||= { hits: 0, deaths: 0 }).hits++; }
    if (pc === syms.play_sound) { if (cpu.a === 0x20) ev.shots++; if (cpu.a === 0x18) ev.grenades++; if (cpu.a === 0x30) ev.jumps++; }
    return false;
});
const bot = BOT === "world" ? new WorldBot() : new HumanBot({ seed: SEED });
let end = "passes", best = 0;
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    const keys = BOT === "world" ? bot.step(p, worldState(m)) : bot.step(p, see(m));
    best = Math.max(best, worldState(m).view);
    pressKeys(m, keys);
    if (p % 2000 === 0) console.log(`  ${p}: column ${worldState(m).view}, hits ${ev.hits}, deaths ${ev.deaths}`);
}
const score = rd(syms.game_over_text + 20, 6).map((b) => (b - 0x6c) / 6).join("");
console.log(`${disc} ${BOT}${BOT === "human" ? " seed " + SEED : ""}${KEEP ? " keep-alive" : ""}: ${m.passes} passes (${end}), furthest column ${best}; ` +
    `hits ${ev.hits}, deaths ${ev.deaths}; sounds (anyone's): firing ${ev.shots}, grenades ${ev.grenades}, the player's jumps ${ev.jumps}; score ${score}` + (bot.log ? `\n  ${JSON.stringify(bot.log)}` : ""));
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log("  by 500 columns (hits, deaths): " + Object.entries(byBand).sort((a, b) => a[0] - b[0]).map(([b, v]) => `${b}: ${v.hits}/${v.deaths}`).join("  "));
