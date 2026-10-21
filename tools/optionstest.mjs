// optionstest.mjs - GAMEPLAY_OPTIONS checked (decision 46): the game rules screen and what it sets.
//   the title       "6" opens the game rules screen (options_screen)
//   the settings    "1" cycles the lives 1-9 then infinite (10), "2" the rewind 40/80/120/160 columns,
//                   "3" the timer off/up/down, "4" the shield's hits 1/2/3/4/6, "5" its recharge
//                   2/5/8/10 s (decision 50), with GAMEPLAY_RUN "6" the run time 5/10/15/20 s or off
//                   and "7" its charge 5/10/15/20 s (decision 52), "8" the timer's limit 3/5/8/10/15
//                   minutes (decision 55); ESCAPE goes back to the title
//   a game          starts with them: lives, respawn_columns, timer_mode, shield_unit(2),
//                   shield_recharge; with infinite lives the
//                   HUD's digit is lives_digits' entry 10 (the infinite glyph)
//   high scores     an infinite-lives game ended by ESCAPE does not reach the name entry, with a
//                   score that would rank (poked to 020000); a 3-lives game ended the same way does
// Saves build/shots/<PREFIX>-<step>.png (default "options").
//
//   node tools/optionstest.mjs DISC.ssd [PREFIX]
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("build/shots", { recursive: true });   // screenshots, apart from the discs
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, loadSyms } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, PREFIX = "options"] = process.argv.slice(2);
const syms = loadSyms(disc);
for (const k of ["options_screen", "opt_lives", "shield_new_game", "finished_shuffling_names"])
    if (syms[k] === undefined) throw new Error(`${disc}: no ${k} - not a GAMEPLAY_OPTIONS build?`);
const K = { K1: [0, 3], K2: [1, 3], K3: [1, 1], K4: [2, 1], K5: [3, 1], K6: [4, 3], K7: [4, 2], K8: [5, 1], ESCAPE: [0, 7] };
const RUN = syms.opt_run_time !== undefined;
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const run = (fields) => s.runFor(40000 * fields);
const press = async (k, hold = 10, after = 40) => { s.keyDownRaw(K[k]); await run(hold); s.keyUpRaw(K[k]); await run(after); };
let step = 0, fails = 0;
const shot = async (name) => writeFileSync(`build/shots/${PREFIX}-${String(++step).padStart(2, "0")}-${name}.png`, await s.screenshotActive({ scale: 1 }));
const check = (what, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ": " + detail : ""}`); if (!ok) fails++; };
const seen = { options: 0, loop: 0, entry: 0, newGame: 0, table: 0, title: 0 };
cpu.debugInstruction.add((pc) => {
    const b5 = (cpu.romsel & 15) === 5;
    if (pc === syms.options_screen && b5) seen.options++;
    if (pc === syms.main_game_loop) seen.loop++;
    if (pc === syms.finished_shuffling_names && b5) seen.entry++;
    if (pc === syms.shield_new_game && b5) seen.newGame++;
    if (pc === syms.display_high_scores && b5) seen.table++;
    if (pc === syms.display_title_screen && b5) seen.title++;
    return false;
});
const opts = () => { const [l, r, t] = [rd(syms.opt_lives)[0], rd(syms.opt_respawn)[0], rd(syms.opt_timer)[0]]; return { lives: l, respawn: r, timer: t }; };
const toOptions = async () => { for (let i = 0; i < 10; i++) { const n = seen.options; await press("K6", 10, 60); if (seen.options > n) return true; } return false; };
const startGame = async () => { for (let i = 0; i < 8; i++) { const n = seen.loop; await press("K1", 40, 260); if (seen.loop > n) return true; } return false; };
const toTitle = async () => { s.keyDownRaw(K.ESCAPE); await run(20); s.keyUpRaw(K.ESCAPE); await run(1200); };

await run(2000);
s.releaseAllKeys();                     // the boot's SHIFT (SHIFT+BREAK): get_keypress waits for it to go
await run(50);
await shot("title");
{   // decision 56: any key on the high score table goes back to the menu (and is not taken as an option)
    const t0 = seen.table;
    for (let i = 0; i < 40 && seen.table === t0; i++) await run(50);   // the title cycles to the table by itself
    await run(30);
    const title0 = seen.title, loop0 = seen.loop;
    await press("K1", 10, 60);                                         // "1": on the menu it would start a game
    check("any key on the high score table: back to the menu, no game", seen.table > t0 && seen.title > title0 && seen.loop === loop0,
        `table ${seen.table - t0}, menu ${seen.title - title0}, game passes ${seen.loop - loop0}`);
    await shot("after-table-key");
}
check("6 opens the game rules screen", await toOptions());
await shot("game-rules");
const o0 = opts();
check("the defaults (rewind 40)", o0.lives === (syms.LIVES_START ?? 3) && o0.respawn === 0 && o0.timer === 1, JSON.stringify(o0));
await press("K1"); await press("K2"); await press("K3");
const o1 = opts();
check("1, 2, 3 step each setting", o1.lives === o0.lives + 1 && o1.respawn === 1 && o1.timer === 2, JSON.stringify(o1));
for (let i = o1.lives; i < 10; i++) await press("K1");
await press("K2"); await press("K2"); await press("K2");
const o2 = opts();
check("lives to infinite (10), the rewind round to 40, the timer down", o2.lives === 10 && o2.respawn === 0 && o2.timer === 2, JSON.stringify(o2));
await shot("game-rules-set");
await press("K1"); const wrap = opts().lives; await press("K3"); const toff = opts().timer;
check("lives wrap infinite -> 1, the timer down -> off", wrap === 1 && toff === 0, `lives ${wrap}, timer ${toff}`);
const sh = () => ({ hits: rd(syms.opt_hits)[0], recharge: rd(syms.opt_recharge)[0] });
const sh0 = sh();
check("the shield's defaults (2 hits, 5 s)", sh0.hits === 1 && sh0.recharge === 1, JSON.stringify(sh0));
await press("K4"); const h2 = sh().hits;
for (let i = 0; i < 3; i++) await press("K4");
const h0 = sh().hits;
await press("K5"); await press("K5"); await press("K5"); const r0 = sh().recharge;
await press("K5"); await press("K5");
check("4 steps the hits and wraps 6 -> 1, 5 the recharge and wraps 10 s -> 2 s", h2 === 2 && h0 === 0 && r0 === 0 && sh().recharge === 2, `hits ${h2}, ${h0}; recharge ${r0}, ${sh().recharge}`);
await shot("game-rules-shield");
{
    const l0 = rd(syms.opt_limit)[0];
    await press("K8"); const l1 = rd(syms.opt_limit)[0];         // 10 -> 15 min
    await press("K8"); const l2 = rd(syms.opt_limit)[0];         // 15 -> 3 min
    check("the timer's limit: 10 min by default, 8 steps and wraps 15 -> 3", l0 === 3 && l1 === 4 && l2 === 0, `${l0} ${l1} ${l2}`);
}
if (RUN) {
    const rn = () => ({ time: rd(syms.opt_run_time)[0], charge: rd(syms.opt_run_charge)[0] });
    const r0 = rn();
    check("the run's defaults (5 s, 10 s)", r0.time === 0 && r0.charge === 1, JSON.stringify(r0));
    for (let i = 0; i < 4; i++) await press("K6");             // 5 -> 10 -> 15 -> 20 -> off
    const off = rn().time;
    await press("K6"); await press("K6");                      // off -> 5 -> 10
    await press("K7"); await press("K7"); await press("K7"); await press("K7"); await press("K7");   // 10 -> 15 -> 20 -> 5 -> 10 -> 15
    check("6 steps the run time to off and round, 7 the charge round", off === 4 && rn().time === 1 && rn().charge === 2, `off at ${off}, then ${JSON.stringify(rn())}`);
    for (let i = 0; i < 3; i++) await press("K6");             // 10 -> 15 -> 20 -> off: an unlimited run for game 1
    await shot("game-rules-run");
}
for (let i = 1; i < 10; i++) await press("K1");
await press("K3"); await press("K3");                      // back to infinite, the timer down
const loops = seen.loop;
await press("ESCAPE", 10, 200);
check("ESCAPE goes back to the title (no game)", seen.loop === loops);
check("game 1 (infinite lives) started", await startGame());
await run(100);
const g1 = { lives: rd(syms.lives)[0], cols: rd(syms.respawn_columns)[0], timer: rd(syms.timer_mode)[0] };
check("the game took the settings", g1.lives === 10 && g1.cols === 40 && g1.timer === 2, JSON.stringify(g1));
const lim = rd(syms.timer_limit, 2), t0 = (rd(syms.timer_hi)[0] & 15) * 100 + (rd(syms.timer_lo)[0] >> 4) * 10 + (rd(syms.timer_lo)[0] & 15);
check("the timer took the limit: 3 min, counting down from 180", lim[0] === 0x01 && lim[1] === 0x80 && t0 <= 180 && t0 >= 170, `limit &${lim.map((b) => b.toString(16)).join(" ")}, the time ${t0}`);
const g1s = { unit: rd(syms.shield_unit)[0], unit2: rd(syms.shield_unit2)[0], recharge: rd(syms.shield_recharge)[0] };
check("the shield took them: 1 hit, 8 s", g1s.unit === 50 && g1s.unit2 === 100 && g1s.recharge === 200, JSON.stringify(g1s));
if (RUN) {
    const r16 = (a) => rd(a)[0] + 256 * rd(a + 1)[0];
    const g1r = { drain: r16(syms.run_drain), charge: r16(syms.run_charge), state: rd(syms.run_state)[0] };
    check("the run took them: off (no drain), 15 s charge (171)", g1r.drain === 0 && g1r.charge === 171 && (g1r.state & 0x80 || g1r.state === 0x7f), JSON.stringify(g1r));
}
const digit = rd(syms.hud_buffer, 32), glyph = [0x18, 0x24, 0x18, 0x18, 0x24, 0x18], inf = [];
for (let c = 0; c < 3; c++) for (let y = 0; y < 8; y++) inf.push((glyph[2 * c] >> y & 1 ? 0x28 : 0) | (glyph[2 * c + 1] >> y & 1 ? 0x14 : 0));
for (let y = 0; y < 8; y++) inf.push(0);
check("the HUD shows the infinite glyph", (cpu.romsel & 15) === 4 && digit.every((b, i) => b === inf[i]));
await shot("game-infinite");
s.writeMemory(syms.game_over_text + 20, [0x6c, 0x78, 0x6c, 0x6c, 0x6c, 0x6c]);   // score 020000: it would rank
let entries = seen.entry;
await toTitle();
check("infinite lives, ended by ESCAPE: no name entry", seen.entry === entries, `entries ${seen.entry - entries}`);
await shot("after-infinite-escape");
check("back to the game rules screen", await toOptions());
for (let i = 0; i < 3; i++) await press("K1");             // 10 -> 1 -> 2 -> 3
check("lives 3 again", opts().lives === 3, JSON.stringify(opts()));
await press("ESCAPE", 10, 200);
check("game 2 (3 lives) started", await startGame());
await run(100);
check("game 2 has 3 lives", rd(syms.lives)[0] === 3);
s.writeMemory(syms.game_over_text + 20, [0x6c, 0x78, 0x6c, 0x6c, 0x6c, 0x6c]);
entries = seen.entry;
await toTitle();
check("3 lives, ended by ESCAPE: the name entry, as before", seen.entry > entries);
await shot("name-entry");
console.log(`${disc}: ${fails} failed`);
process.exit(fails ? 1 : 0);
