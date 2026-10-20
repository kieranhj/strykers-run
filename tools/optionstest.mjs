// optionstest.mjs - GAMEPLAY_OPTIONS checked (decision 46): the game rules screen and what it sets.
//   the title       "6" opens the game rules screen (options_screen)
//   the settings    "1" cycles the lives 1-9 then infinite (10), "2" the rewind 40/80/120/160 columns,
//                   "3" the timer off/up/down; ESCAPE goes back to the title
//   a game          starts with them: lives, respawn_columns, timer_mode; with infinite lives the
//                   HUD's digit is lives_digits' entry 10 (the infinite glyph)
//   high scores     an infinite-lives game ended by ESCAPE does not reach the name entry, with a
//                   score that would rank (poked to 020000); a 3-lives game ended the same way does
// Saves build/<PREFIX>-<step>.png (default "options").
//
//   node tools/optionstest.mjs DISC.ssd [PREFIX]
import { writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, loadSyms } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, PREFIX = "options"] = process.argv.slice(2);
const syms = loadSyms(disc);
for (const k of ["options_screen", "opt_lives", "shield_new_game", "finished_shuffling_names"])
    if (syms[k] === undefined) throw new Error(`${disc}: no ${k} - not a GAMEPLAY_OPTIONS build?`);
const K = { K1: [0, 3], K2: [1, 3], K3: [1, 1], K6: [4, 3], ESCAPE: [0, 7] };
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const run = (fields) => s.runFor(40000 * fields);
const press = async (k, hold = 10, after = 40) => { s.keyDownRaw(K[k]); await run(hold); s.keyUpRaw(K[k]); await run(after); };
let step = 0, fails = 0;
const shot = async (name) => writeFileSync(`build/${PREFIX}-${String(++step).padStart(2, "0")}-${name}.png`, await s.screenshotActive({ scale: 1 }));
const check = (what, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ": " + detail : ""}`); if (!ok) fails++; };
const seen = { options: 0, loop: 0, entry: 0, newGame: 0 };
cpu.debugInstruction.add((pc) => {
    const b5 = (cpu.romsel & 15) === 5;
    if (pc === syms.options_screen && b5) seen.options++;
    if (pc === syms.main_game_loop) seen.loop++;
    if (pc === syms.finished_shuffling_names && b5) seen.entry++;
    if (pc === syms.shield_new_game && b5) seen.newGame++;
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
check("6 opens the game rules screen", await toOptions());
await shot("game-rules");
const o0 = opts();
check("the defaults", o0.lives === (syms.LIVES_START ?? 3) && o0.respawn === 1 && o0.timer === 1, JSON.stringify(o0));
await press("K1"); await press("K2"); await press("K3");
const o1 = opts();
check("1, 2, 3 step each setting", o1.lives === o0.lives + 1 && o1.respawn === 2 && o1.timer === 2, JSON.stringify(o1));
for (let i = o1.lives; i < 10; i++) await press("K1");
await press("K2"); await press("K2");
const o2 = opts();
check("lives to infinite (10), the rewind round to 40, the timer down", o2.lives === 10 && o2.respawn === 0 && o2.timer === 2, JSON.stringify(o2));
await shot("game-rules-set");
await press("K1"); const wrap = opts().lives; await press("K3"); const toff = opts().timer;
check("lives wrap infinite -> 1, the timer down -> off", wrap === 1 && toff === 0, `lives ${wrap}, timer ${toff}`);
for (let i = 1; i < 10; i++) await press("K1");
await press("K3"); await press("K3");                      // back to infinite, the timer down
const loops = seen.loop;
await press("ESCAPE", 10, 200);
check("ESCAPE goes back to the title (no game)", seen.loop === loops);
check("game 1 (infinite lives) started", await startGame());
await run(100);
const g1 = { lives: rd(syms.lives)[0], cols: rd(syms.respawn_columns)[0], timer: rd(syms.timer_mode)[0] };
check("the game took the settings", g1.lives === 10 && g1.cols === 40 && g1.timer === 2, JSON.stringify(g1));
const digit = rd(syms.hud_buffer, 32), inf = [...s.readMemory(syms.lives_digits + 320, 32)];
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
