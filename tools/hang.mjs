// hang.mjs DISC PASS [SEED]: play passlock's game (keys by pass) to PASS, then run 2 fields more,
// logging the first time execution leaves the code it should be in, and where the CPU is after:
// PC, ROMSEL, ACCCON, the stack - for a build that stops making passes.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, passArg, seedArg] = process.argv.slice(2);
const PASS = +passArg, SEED = +(seedArg || 1);
const syms = {}, labels = [];
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") { syms[k] = v.value; labels.push([k, v.value, sec.name]); }
function passKeys(n) {
    let seed = SEED >>> 0; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) / 65536;
    const keysAt = [];
    for (let p = 0; p < n; ) {
        const len = 10 + Math.floor(rnd() * 70), keys = [];
        if (rnd() < 0.8) keys.push("RIGHT"); else if (rnd() < 0.5) keys.push("LEFT");
        if (rnd() < 0.5) keys.push("SHIFT"); if (rnd() < 0.15) keys.push("DELETE");
        if (rnd() < 0.2) keys.push("A"); else if (rnd() < 0.1) keys.push("Z");
        for (let i = 0; i < len && p < n; i++) keysAt[p++] = keys;
        const gap = Math.floor(rnd() * 10); for (let i = 0; i < gap && p < n; i++) keysAt[p++] = [];
    }
    return keysAt;
}
const near = (pc, bank) => { let best = null; for (const [k, v, s] of labels) if (v <= pc && pc - v < 0x200 && (!best || v > best[1]) && (pc < 0x8000 || s === `DATA${bank - 3}` || (bank === 4 && s === "DATA1"))) best = [k, v]; return best ? `${best[0]}+${pc - best[1]}` : "?"; };
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
let passes = 0, target = 1, lastStop = -1;
const trail = [];
cpu.debugInstruction.add((pc) => {
    trail.push([pc, cpu.romsel & 0xff]); if (trail.length > 60) trail.shift();
    if (pc !== syms.main_game_loop) return false;
    const c = s.elapsedCycles; if (c === lastStop) return false;
    passes++; if (passes >= target) { lastStop = c; return true; } return false;
});
const events = makeScript(6000, SEED);
for (let f = 1; f <= 6000 && passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();
const keysAt = passKeys(PASS + 2); let held = [];
for (let p = 1; p <= PASS; p++) {
    target = p;
    for (let i = 0; passes < p && i < 150; i++) await s.runFor(400000);
    const want = keysAt[p] || [];
    for (const k of held) if (!want.includes(k)) s.keyUpRaw(gameKey(s, k));
    for (const k of want) if (!held.includes(k)) s.keyDownRaw(gameKey(s, k));
    held = want;
}
target = 1e9;
// the first BRK, or a jump to an address no label is near
let bad = null;
cpu.debugInstruction.add((pc, op) => { if (!bad && (op === 0x00 || (pc < 0xc000 && near(pc, cpu.romsel & 15) === "?"))) bad = { pc, romsel: cpu.romsel, trail: trail.slice(-40) }; return false; });
await s.runFor(80000);
console.log(`passes ${passes}; PC &${cpu.pc.toString(16)} ROMSEL &${cpu.romsel.toString(16)} S &${cpu.s.toString(16)}`);
if (bad) {
    console.log(`first bad: &${bad.pc.toString(16)} ROMSEL &${bad.romsel.toString(16)}; before it:`);
    for (const [pc, rs] of bad.trail) console.log(`  &${pc.toString(16)} (&${rs.toString(16)}) ${near(pc, rs & 15)}`);
}
