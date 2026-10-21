// timertest.mjs - GAMEPLAY_TIMER's rules checked (decision 47): the WorldBot plays a timer build
// (infinite lives poked in, as tools/worldrun.mjs does) and the timer is judged every pass:
//   the time   a second (BCD, timer_hi/timer_lo) every 25 passes: up from 0 (GAMEPLAY_TIMER=1, held
//              at 999), or down from the limit (=2; timer_limit, 600 by default: decision 55)
//   the bonus  at the headquarters (completion_screen), the score rises by 10 a second under the par
//              (timer_limit)
//              (counting up) or left (counting down), and by nothing else
//   time up    --short (counting down only): the timer poked to 5 seconds at the start; at 0 the
//              player turns into the skeleton (KC, 2026-10-21), then the game is over (game_over_screen)
//   the digits hud_buffer shows the time (the 3x5 font, black), after every tick
//
//   --bonus    the bonus by itself: set times and limits, timer_bonus_call called directly
//
//   node tools/timertest.mjs DISC.ssd [--passes N] [--short] [--bonus]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const PASSES = +opt("--passes", 16000), SHORT = flag("--short"), BONUS = flag("--bonus");
const disc = args[0];

const m = await startWorldGame(MachineSession, disc, { keepAlive: !SHORT });   // to the headquarters (the bonus): no deaths' rewinds
const { s, cpu, syms } = m;
for (const k of ["timer_tick", "timer_bonus", "timer_hi", "hud_buffer"])
    if (syms[k] === undefined) throw new Error(`${disc}: no ${k} - not a GAMEPLAY_TIMER build?`);
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const zp = (name) => rd(syms[name])[0];
const bcd = (hi, lo) => (hi & 15) * 100 + (lo >> 4) * 10 + (lo & 15);
const toBcd = (n) => [Math.floor(n / 100), (Math.floor(n / 10) % 10) * 16 + n % 10];
const score = () => rd(syms.game_over_text + 20, 6).map((b) => (b - 0x6c) / 6).reduce((a, d) => a * 10 + d, 0);
const fails = [];
const fail = (msg) => { if (fails.length < 30) fails.push(`pass ${m.passes}: ${msg}`); };
const FONT = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1], [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];
const HUD_TIMER = syms.HUD_TIMER;
// --bonus: the bonus by itself, the bot not needed to reach the headquarters: at pass 30 each case's
// mode, time and limit (decision 55) are set and timer_bonus_call is called from the stopped pass;
// the score it added is read where it pages bank 4 back
if (BONUS) {
    const { callFrom } = await import("./playscript.mjs");
    await toWorldPass(m, 30);
    let back = false;
    cpu.debugInstruction.add((pc) => { if (pc === syms.bank4_back) back = true; return false; });
    const cases = [[1, 120, 180], [1, 179, 180], [1, 200, 180], [1, 0, 900], [2, 45, 600], [2, 0, 300], [0, 100, 600]];
    for (const [mode, t, limit] of cases) {
        s.writeMemory(syms.timer_mode, [mode]); s.writeMemory(syms.timer_hi, toBcd(t)); s.writeMemory(syms.timer_limit, toBcd(limit));
        const before = score();
        back = false; callFrom(s, syms.timer_bonus_call, 0);
        for (let i = 0; i < 400 && !back; i++) await s.runFor(2000);
        const got = score() - before, want = 10 * (mode === 2 ? t : mode === 1 ? Math.max(0, limit - t) : 0);
        console.log(`  mode ${mode}, time ${t} s, limit ${limit} s: +${got}${got === want ? "" : `, expected +${want}`}`);
        if (!back) fail(`mode ${mode} ${t}/${limit}: timer_bonus_call never came back`);
        else if (got !== want) fail(`mode ${mode} ${t}/${limit}: the bonus ${got}, expected ${want}`);
    }
    console.log(fails.length ? `FAILED:\n  ` + fails.join("\n  ") : "all rules held");
    process.exit(fails.length ? 1 : 0);
}
let bonus = null, ticks = 0, gameOverAt = null, zeroAt = null, quietUntil = 0, skeletonAt = null;
const checkDigits = () => {
    const t = bcd(zp("timer_hi"), zp("timer_lo")), digits = [Math.floor(t / 100), Math.floor(t / 10) % 10, t % 10];
    const hud = rd(syms.hud_buffer + HUD_TIMER, 56);
    for (let d = 0; d < 3; d++) for (let r = 0; r < 8; r++) {
        const f = r >= 2 && r <= 6 ? FONT[digits[d]][r - 2] : 0;
        const c0 = (f & 4 ? 0x28 : 0) | (f & 2 ? 0x14 : 0), c1 = f & 1 ? 0x28 : 0;
        if (hud[16 * d + r] !== c0 || hud[16 * d + 8 + r] !== c1) { fail(`timer digit ${d} row ${r} wrong for ${t}`); return; }
    }
    if (hud.slice(48).some((b) => b)) fail("the timer's last column is not blank");
};
cpu.debugInstruction.add((pc) => {
    if (pc === syms.timer_bonus && (cpu.romsel & 15) === 6 && !bonus) bonus = { score: score(), t: bcd(zp("timer_hi"), zp("timer_lo")) };
    if (pc === syms.render_finish && bonus && bonus.after === undefined) bonus.after = score();
    if (pc === syms.bank4_back && m.passes > 2 && m.passes > quietUntil && !bonus) { ticks++; checkDigits(); }   // (bonus: timer_bonus_call returns here too)   // timer_tick_call, after its JSR timer_tick
    if (pc === syms.game_over_screen && gameOverAt === null) gameOverAt = m.passes;
    if (pc === syms.kill_player && zeroAt !== null && skeletonAt === null) skeletonAt = m.passes;
    return false;
});
const bot = new WorldBot();
let end = "passes", prev = null, down = null;
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    if (gameOverAt !== null) { end = "game over"; break; }
    const t = bcd(zp("timer_hi"), zp("timer_lo")), f = zp("timer_frac");
    if (p === 3) {
        down = t !== 0;
        if (SHORT) {
            if (!down) throw new Error("--short is for a counting-down build");
            const [h, l] = toBcd(5); s.writeMemory(syms.timer_hi, [h, l]); quietUntil = p + 26;   // the digits show the poke from the next second
            if (m.infiniteLives !== "DEBUG_LIVES") s.writeMemory(syms.kill_player, [0xc6]);        // DEC lives again: the time-up death must end the game
        }   // the digits show the poke from the next second
    }
    if (prev && p > 3 && zeroAt === null) {
        const want = f === 0 ? (down ? Math.max(0, prev.t - 1) : Math.min(999, prev.t + 1)) : prev.t;
        if (t !== want && !(down && prev.t === 0)) fail(`time ${prev.t} (${prev.f}) -> ${t} (${f})`);
        if (f !== (prev.f + 1) % 25 && !(down && t === 0)) fail(`pass count in the second ${prev.f} -> ${f}`);
    }
    if (down && t === 0 && zeroAt === null) zeroAt = p;
    prev = { t: bcd(zp("timer_hi"), zp("timer_lo")), f: zp("timer_frac") };
    pressKeys(m, bot.step(p, worldState(m)));
}
if (gameOverAt !== null) end = "game over";
if (end === "completed") await m.s.runFor(4000000);      // on from completion_screen (where startWorldGame stops): the bonus and render_finish
if (bonus) {
    const par = syms.timer_limit !== undefined ? bcd(...rd(syms.timer_limit, 2)) : 600;
    const want = 10 * (down ? bonus.t : Math.max(0, par - bonus.t));
    if (bonus.after - bonus.score !== want) fail(`the bonus at ${bonus.t} s was ${bonus.after - bonus.score}, expected ${want}`);
}
if (SHORT) {
    if (zeroAt === null) fail("--short: the time never reached 0");
    else if (gameOverAt === null || gameOverAt - zeroAt > 400) fail(`--short: time up at pass ${zeroAt}, game over ${gameOverAt === null ? "never" : "at pass " + gameOverAt}`);
    else if (skeletonAt === null || skeletonAt - zeroAt > 2) fail(`--short: no skeleton at time up (kill_player ${skeletonAt === null ? "never" : "at pass " + skeletonAt})`);
}
console.log(`${disc}: ${m.passes} passes (${end}), counting ${down ? "down" : "up"}; ${ticks} ticks with the digits checked` +
    (bonus ? `; at the headquarters at ${bonus.t} s the score ${bonus.score} -> ${bonus.after}` : "") + (zeroAt ? `; time up at pass ${zeroAt}, the skeleton at ${skeletonAt}` : "") + (gameOverAt ? `, game over at pass ${gameOverAt}` : ""));
console.log(fails.length ? `FAILED (${fails.length}${fails.length === 30 ? "+" : ""}):\n  ` + fails.join("\n  ") : "all rules held");
process.exit(fails.length ? 1 : 0);
