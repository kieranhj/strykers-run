// hazelreach.mjs DISC [PASSES]: the HAZEL addresses (&C000-&DFFF, ACCCON's Y bit set) the game reads
// while the player runs right through the whole world, keys by pass as passbench's --hold RIGHT
// (DEBUG_LIVES, so the run reaches the end), jumping (UP) for 3 passes in every 30 to get over what
// stops a runner. The mountain layer's data starts at &C300 in HAZEL,
// which the MOS leaves paged in: this says how far it goes.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, passesArg] = process.argv.slice(2);
const PASSES = +(passesArg || 20000);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
let passes = 0, target = 1, lastStop = -1, lo = 0x10000, hi = -1, n = 0, completed = false;
const byPage = new Map();
cpu.debugInstruction.add((pc) => {
    if (pc === syms.completion_screen) completed = true;
    if (pc !== syms.main_game_loop) return false;
    const c = s.elapsedCycles; if (c === lastStop) return false;
    passes++; if (passes >= target) { lastStop = c; return true; } return false;
});
// reads outside the mountain layer's run (&C300-&C5FF) are listed with the code that made them
const odd = [];
cpu.debugRead.add((a) => { if (passes > 0 && a >= 0xc000 && a < 0xe000 && (cpu.acccon & 8)) { if ((a < 0xc300 || a >= 0xc600) && odd.length < 20) odd.push(`&${a.toString(16)} by &${cpu.pc.toString(16)} (ROMSEL &${cpu.romsel.toString(16)}) at pass ${passes}`); n++; lo = Math.min(lo, a); hi = Math.max(hi, a); byPage.set(a >> 8, (byPage.get(a >> 8) || 0) + 1); } return false; });
const events = makeScript(6000, 1);
for (let f = 1; f <= 6000 && passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();
s.keyDownRaw(gameKey(s, "RIGHT"));
let vl = 0;
for (let p = 1; p <= PASSES && !completed; p++) {
    target = p;
    let i = 0;
    for (; passes < p && i < 150 && !completed; i++) await s.runFor(400000);
    if (i === 150) { console.log(`no pass at ${p}`); break; }
    if (p % 30 === 0) s.keyDownRaw(gameKey(s, "A")); else if (p % 30 === 3) s.keyUpRaw(gameKey(s, "A"));
    if (p % 1000 === 0) { vl = s.readMemory(0xb2, 1)[0] + 256 * s.readMemory(0xba, 1)[0]; console.log(`pass ${p}: view at column ${vl}; HAZEL reads ${n}, &${lo.toString(16)}-&${hi.toString(16)}`); }
}
vl = s.readMemory(0xb2, 1)[0] + 256 * s.readMemory(0xba, 1)[0];
if (odd.length) console.log("reads outside &C300-&C5FF:", odd);
console.log(`${disc}: ${passes} passes, view at column ${vl}, completed ${completed}; HAZEL reads ${n}, from &${lo.toString(16)} to &${hi.toString(16)}; by page ${[...byPage].map(([p, c]) => `&${(p << 8).toString(16)}:${c}`).join(" ")}`);
