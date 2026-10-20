// livestest.mjs - GAMEPLAY_LIVES' rules checked (decision 45, docs/briefs/gameplay-shield.md): the
// WorldBot plays a GAMEPLAY_SHIELD + GAMEPLAY_LIVES build, and every death and respawn is judged:
//   death     each hit at 0 shield is a death: the player turns into the skeleton (kill_player)
//   rewind    at the skeleton's end (player_dead) with lives left, the view and the (hidden: x high
//             &FF) player go back a column a pass, RESPAWN_COLUMNS of them or to the world's start;
//             nothing else moves (the movers' x stand still, but for the enemy helicopters, slots 10
//             and 11, which the scroll places anew when the view's page changes, as walking back does)
//   respawn   then the player stands there (type 0, its x high back), shield full, and for
//             RESPAWN_SAFE passes no hit takes shield or life
//   game over --finite: lives as the game counts them (worldrun's infinite-lives poke undone): the
//             game ends at the death that leaves none
//
//   node tools/livestest.mjs DISC.ssd [--passes N] [--finite]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const PASSES = +opt("--passes", 16000), FINITE = flag("--finite");
const disc = args[0];

const m = await startWorldGame(MachineSession, disc);
const { s, cpu, syms } = m;
for (const k of ["player_dead", "player_or_rewind", "respawn", "shield_hit", "respawn_left"])
    if (syms[k] === undefined) throw new Error(`${disc}: no ${k} - not a GAMEPLAY_LIVES build?`);
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const zp = (name) => rd(syms[name])[0];
const COLUMNS = syms.RESPAWN_COLUMNS ?? 80, SAFE = syms.RESPAWN_SAFE ?? 50;
if (FINITE) {
    const k = rd(syms.kill_player, 2);
    if (k[0] === 0xa9 && m.infiniteLives !== "DEBUG_LIVES") s.writeMemory(syms.kill_player, [0xc6]);   // DEC lives again
    else if (m.infiniteLives === "DEBUG_LIVES") throw new Error("--finite needs a build without DEBUG_LIVES");
}
const fails = [];
const fail = (msg) => { if (fails.length < 30) fails.push(`pass ${m.passes}: ${msg}`); };
const view = () => zp("viewport_left_low") + 256 * zp("viewport_left_high");
const movers = () => rd(syms.movers_x_low + 1, 0x21).map((lo, i) => lo + 256 * rd(syms.movers_x_high + 1 + i)[0]);
const ev = { deaths: 0, rewinds: 0, respawns: 0, safeHits: 0, gameOver: null, columns: [] };
let rw = null;                            // the rewind under way
let pendingDeath = null;
cpu.debugInstruction.add((pc) => {
    if (pc === syms.kill_player) { ev.deaths++; pendingDeath = { pass: m.passes, shield: zp("shield") }; }
    if (pc === syms.player_dead && zp("lives") !== 0) {
        rw = { pass: m.passes, view: view(), px: zp("movers_x_low") + 256 * zp("movers_x_high"), last: null };
        ev.rewinds++;
    }
    if (pc === syms.respawn && rw) {
        rw.done = { pass: m.passes, view: view() };
    }
    if (pc === syms.shield_hit && zp("invulnerable") > 0) {
        ev.safeHits++;
        const before = { shield: zp("shield"), lives: zp("lives") };
        setTimeoutCheck(before);
    }
    if (pc === syms.game_over_screen && ev.gameOver === null) ev.gameOver = { pass: m.passes, lives: zp("lives") };
    return false;
});
let safeChecks = [];
function setTimeoutCheck(before) { safeChecks.push({ pass: m.passes, before }); }

const bot = new WorldBot();
let end = "passes", prev = null;
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    if (ev.gameOver) { end = "game over"; break; }
    const now = { view: view(), left: zp("respawn_left"), xh: zp("movers_x_high"), xl: zp("movers_x_low"), movers: movers(),
        shield: zp("shield"), lives: zp("lives"), safe: zp("invulnerable"), type: rd(syms.movers_type_and_colour)[0] };
    for (const c of safeChecks.splice(0)) {
        if (now.shield !== c.before.shield && now.shield < c.before.shield) fail(`a hit while invulnerable took the shield ${c.before.shield} -> ${now.shield}`);
        if (now.lives !== c.before.lives) fail(`a hit while invulnerable took a life`);
    }
    if (rw && !rw.done && prev && prev.left > 0) {        // a pass of the rewind
        if (now.xh !== 0xff) fail(`player not hidden during the rewind (x high &${now.xh.toString(16)})`);
        if (prev.view - now.view !== 1 && prev.view !== 0) fail(`the rewind moved the view ${prev.view} -> ${now.view}`);
        if (((prev.xl - now.xl) & 0xff) !== 1 && prev.view !== 0) fail(`the rewind moved the player ${prev.xl} -> ${now.xl}`);
        const moved = now.movers.map((x, i) => [i + 1, prev.movers[i], x]).filter(([i, a, b]) => a < 0x8000 && b < 0x8000 && a !== b && i !== 10 && i !== 11);   // 10, 11: the enemy helicopters, placed anew by add_enemy_helicopters as the view's page changes (as walking left does)
        if (moved.length) fail(`movers moved during the rewind: ${moved.map(([i, a, b]) => `slot ${i} ${a} -> ${b} (type &${rd(syms.movers_type_and_colour + i)[0].toString(16)})`).join(", ")} (view ${now.view})`);
    }
    if (rw && rw.done) {
        const back = rw.view - rw.done.view, want = Math.min(COLUMNS, rw.view);
        ev.columns.push(back);
        if (back !== want) fail(`the rewind went back ${back} columns from view ${rw.view}, expected ${want}`);
        const px = now.xl + 256 * now.xh;
        if (rw.px - px !== back) fail(`the player came back ${rw.px - px} columns, the view ${back}`);
        if (now.type !== 0) fail(`respawned as type &${now.type.toString(16)}`);
        if (now.shield !== 50) fail(`respawned with shield ${now.shield}`);
        if (now.safe < SAFE - 2) fail(`respawned with ${now.safe} passes of safety`);
        ev.respawns++;
        rw = null;
    }
    prev = now;
    pressKeys(m, bot.step(p, worldState(m)));
}
if (ev.gameOver) end = "game over";
if (FINITE && end !== "game over") fail(`--finite: no game over in ${m.passes} passes (deaths ${ev.deaths})`);
if (FINITE && ev.gameOver && ev.deaths !== (syms.LIVES_START ?? 3)) fail(`--finite: game over after ${ev.deaths} deaths`);
const cols = ev.columns.reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a; }, {});
console.log(`${disc}: ${m.passes} passes (${end}); deaths ${ev.deaths}, rewinds ${ev.rewinds}, respawns ${ev.respawns} (columns back: ${JSON.stringify(cols)}), hits while invulnerable ${ev.safeHits}` +
    (ev.gameOver ? `, game over at pass ${ev.gameOver.pass}` : ""));
console.log(fails.length ? `FAILED (${fails.length}${fails.length === 30 ? "+" : ""}):\n  ` + fails.join("\n  ") : "all rules held");
process.exit(fails.length ? 1 : 0);
