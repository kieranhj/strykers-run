// frontend.mjs - drive the parts of the game the scripted play does not reach, and check them.
//
//   node tools/frontend.mjs DISC.ssd [PREFIX]
//
// On a Master: the title; the instructions (3, then three keys); define controls (2) with Q W E
// R T Y U I for up, down, right, left, fire, grenade, enter, pause, checked in the `keys` table;
// a game (1) in which E must move the player right and RIGHT must not; pause (I) and unpause;
// ESCAPE with the score poked to 020000, so the game over goes through the high score name entry
// (A, B, RETURN); the music (4) and sound (5) toggles; a second game; ESCAPE again. Saves
// build/<PREFIX>-<step>.png (default PREFIX "frontend") and prints one line per check. Where the
// build has layer 1's irq_owned, it also checks the MOS state handed over and back: the keyboard
// semaphore &0242, the System VIA IRQ mask &0279, the System VIA IER, and &EC on the title.
// Key positions are matrix [col, row], measured 2026-10-16 with the jsbeeb MCP's key_down by name.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, BOOT_FRAMES } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const [disc, prefixArg] = process.argv.slice(2);
if (!disc) { console.error("usage: node tools/frontend.mjs DISC.ssd [PREFIX]"); process.exit(2); }
const PREFIX = prefixArg || "frontend";
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;

const K = {
    K1: [0, 3], K2: [1, 3], K3: [1, 1], K4: [2, 1], K5: [3, 1], SPACE: [2, 6], RETURN: [9, 4],
    Q: [0, 1], W: [1, 2], E: [2, 2], R: [3, 3], T: [3, 2], Y: [4, 4], U: [5, 3], I: [5, 2],
    A: [1, 4], B: [4, 6], RIGHT: [9, 7], ESCAPE: [0, 7], SHIFT: [0, 0],
};
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const rd = (a, n = 1) => [...s.readMemory(a, n)];
const run = (n) => s.runFrames(n);
const press = async (k, hold = 10, after = 40) => { s.keyDownRaw(K[k]); await run(hold); s.keyUpRaw(K[k]); await run(after); };
let step = 0, fails = 0;
const shot = async (name) => writeFileSync(`build/${PREFIX}-${String(++step).padStart(2, "0")}-${name}.png`, await s.screenshotActive({ scale: 1 }));
const check = (what, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ": " + detail : ""}`); if (!ok) fails++; };
let inLoop = 0;
// The title alternates its options with the high score table and only takes 1 from the options.
const startGame = async () => { for (let i = 0; i < 8; i++) { const n = inLoop; await press("K1", 40, 260); if (inLoop > n) return true; } return false; };
cpu.debugInstruction.add((pc) => { if (pc === syms.main_game_loop) inLoop++; return false; });
const layer1 = "irq_owned" in syms;
const mosState = () => {
    cpu.sysvia._catchUp();
    return { owned: layer1 ? rd(syms.irq_owned)[0] : null, sem: rd(0x242)[0], mask: rd(0x279)[0], ier: cpu.sysvia.ier, ec: rd(0xec)[0] };
};
const x = () => rd(syms.movers_x_high)[0] * 256 + rd(syms.movers_x_low)[0];

await run(BOOT_FRAMES); s.keyUpRaw(K.SHIFT);              // SHIFT held through the BREAK boots the disc
await run(2100 - BOOT_FRAMES);
const boot = mosState();
await shot("title");
check("title: main_game_loop not entered", inLoop === 0);

await press("K3", 10, 100); await shot("instructions-1");
await press("SPACE", 10, 100); await shot("instructions-2");
await press("SPACE", 10, 100); await shot("instructions-3");
await press("SPACE", 10, 150); await shot("title-after-instructions");

await press("K2", 10, 100); await shot("define-controls");
for (const k of ["Q", "W", "E", "R", "T", "Y", "U", "I"]) await press(k, 10, 50);
await run(100); await shot("define-controls-done");
const want = [16, 33, 34, 51, 35, 68, 53, 37].map((n) => n ^ 0xff);
const keys = rd(syms.keys, 8);
check("define controls: keys table", JSON.stringify(keys) === JSON.stringify(want), keys.map((b) => b.toString(16)).join(" "));

await startGame(); await run(100); await shot("game-1");
const inGame = mosState();
check("game 1 started", inLoop > 0, `${inLoop} passes`);
if (layer1) check("in play: irq_owned &FF, &0242 0, &0279 bit 1 clear, IER CA2/CB1 off",
    inGame.owned === 0xff && inGame.sem === 0 && (inGame.mask & 2) === 0 && (inGame.ier & 0x11) === 0, JSON.stringify(inGame));
let x0 = x(); s.keyDownRaw(K.E); await run(200); s.keyUpRaw(K.E); await run(20);
check("redefined right (E) moves the player right", x() > x0, `${x0} -> ${x()}`);
x0 = x(); s.keyDownRaw(K.RIGHT); await run(200); s.keyUpRaw(K.RIGHT); await run(20);
check("RIGHT no longer bound", x() === x0, `${x0} -> ${x()}`);
await press("I", 10, 50); const p0 = inLoop; await run(100);
check("pause (I) stops the main loop", inLoop === p0, `${inLoop - p0} passes while paused`);
await shot("paused");
await press("E", 10, 50);
const p1 = inLoop; await run(100);
check("unpause", inLoop > p1, `${inLoop - p1} passes`);

// a score that ranks: 020000, in the game's font offsets (offsets_to_numbers_table)
s.writeMemory(syms.game_over_text + 20, [0x6c, 0x78, 0x6c, 0x6c, 0x6c, 0x6c]);
await press("ESCAPE", 10, 300); await shot("game-over-name-entry");
const back = mosState();
if (layer1) check("title again: MOS state as before the game",
    back.owned === 0 && back.sem === boot.sem && back.mask === boot.mask && (back.ier & 0x13) === (boot.ier & 0x13),
    `boot ${JSON.stringify(boot)} now ${JSON.stringify(back)}`);
await press("A", 10, 40); await press("B", 10, 40); await press("RETURN", 10, 200);
await shot("high-scores");
const names = rd(syms.high_score_names, 18);
check("high score name entered", names[0] === 0x0a && names[1] === 0x0b, names.slice(0, 4).map((b) => b.toString(16)).join(" "));
const l0 = inLoop; await run(600);
check("title does not start a game by itself", inLoop === l0);
await shot("title-again");

await press("K4", 10, 100); await shot("music-toggled");
await press("K5", 10, 100); await shot("sound-toggled");

await startGame(); await run(100); await shot("game-2");
const again = mosState();
check("game 2 started", inLoop > l0, `${inLoop - l0} passes`);
if (layer1) check("game 2: irq_owned &FF, &0242 0", again.owned === 0xff && again.sem === 0, JSON.stringify(again));
await press("ESCAPE", 10, 400); await shot("title-3");
if (layer1) check("title 3: handed back", mosState().owned === 0, JSON.stringify(mosState()));
console.log(`${disc}: ${fails} failed`);
process.exit(fails ? 1 : 0);
