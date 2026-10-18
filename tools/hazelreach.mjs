// hazelreach.mjs DISC [PASSES]: the HAZEL addresses (&C000-&DFFF, ACCCON's Y bit set) the game reads
// while the player goes through the whole world, start to completion screen, played by
// playscript.mjs's WorldBot (as tools/worldrun.mjs: keys by pass from the game's state; infinite
// lives, by DEBUG_LIVES or the same poke). The mountain layer's data starts at &C300 in HAZEL,
// which the MOS leaves paged in: this says how far it goes. (Until 2026-10-18 this held RIGHT and
// jumped, and stopped at view column 3,319: a crouching soldier the player's bullets pass over,
// which only a grenade kills, blocks the way.)
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, passesArg] = process.argv.slice(2);
const PASSES = +(passesArg || 30000);
const m = await startWorldGame(MachineSession, disc);
const { s, cpu } = m;
let lo = 0x10000, hi = -1, n = 0, mlo = 0x10000, mhi = -1;
const byPage = new Map();
// reads outside the mountain layer's run (&C300-&C6FF), the compiled kinds' code and the tables
// after it (HAZEL_ORG to hazel_b_end) and, since decision 40, times_78_lo/hi (&C000/&C100: 256
// bytes each), all from the symbols, are listed with the code that made them
const odd = [];
const { HAZEL_ORG = 0xc700, hazel_b_end = 0xc700 } = m.syms;
const inTimes78 = (a) => ["times_78_lo", "times_78_hi"].some((k) => m.syms[k] >= 0xc000 && a >= m.syms[k] && a < m.syms[k] + 256);
cpu.debugRead.add((a) => { if (m.passes > 0 && a >= 0xc000 && a < 0xe000 && (cpu.acccon & 8)) {
    const mountain = a >= 0xc300 && a < 0xc700;
    if (!mountain && !(a >= HAZEL_ORG && a < hazel_b_end) && !inTimes78(a) && odd.length < 20) odd.push(`&${a.toString(16)} by &${cpu.pc.toString(16)} (ROMSEL &${cpu.romsel.toString(16)}) at pass ${m.passes}`);
    n++; lo = Math.min(lo, a); hi = Math.max(hi, a); if (mountain) { mlo = Math.min(mlo, a); mhi = Math.max(mhi, a); } byPage.set(a >> 8, (byPage.get(a >> 8) || 0) + 1); } return false; });
const bot = new WorldBot();
let r = "pass", p = 1;
for (; p <= PASSES && (r = await toWorldPass(m, p)) === "pass"; p++) {
    const st = worldState(m);
    pressKeys(m, bot.step(p, st));
    if (p % 1000 === 0) console.log(`pass ${p}: view at column ${st.view}; HAZEL reads ${n}, &C300-&C6FF &${mlo.toString(16)}-&${mhi.toString(16)}`);
}
const st = worldState(m);
console.log(odd.length ? "reads outside the mountain layer's, the compiled kinds' and the tables':" : "no reads outside the mountain layer's, the compiled kinds' and the tables'", odd.length ? odd : "");
console.log(`${disc}: ${m.passes} passes (${r}), view at column ${st.view}, player at ${st.px}, completed ${m.completed ? "at pass " + m.completed.pass : "no"}; HAZEL reads ${n}, from &${lo.toString(16)} to &${hi.toString(16)}; in &C300-&C6FF (the mountain layer's) &${mlo.toString(16)}-&${mhi.toString(16)}; by page ${[...byPage].sort((a, b) => a[0] - b[0]).map(([p, c]) => `&${(p << 8).toString(16)}:${c}`).join(" ")}`);
