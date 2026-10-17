// screendiff.mjs A.ssd B.ssd [PASS] [SEED]: both builds played to PASS on passlock's game (keys by
// pass, stopping at main_game_loop), then both screens (main and shadow &4000-&7FFF) of each
// compared: the differing bytes listed by address, with each build's value, and the movers'
// slots, types and screen addresses at that pass - for chasing a renderer difference.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [discA, discB, passArg, seedArg] = process.argv.slice(2);
const PASS = +(passArg || 3), SEED = +(seedArg || 1);
function passKeys(n) {      // tools/passlock.mjs's generator
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
async function play(disc) {
    const syms = {};
    for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
        for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
    const s = await bootMaster(MachineSession, disc);
    const cpu = s._machine.processor;
    let passes = 0, target = 1, lastStop = -1;
    cpu.debugInstruction.add((pc) => {
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
    const main = s.readMemory(0x4000, 0x4000, { shadow: false }), shadow = s.readMemory(0x4000, 0x4000, { shadow: true });
    const st = s.readMemory(syms.movers_type_and_colour, 7 * 34, { shadow: false });
    return { main, shadow, st, shown: s.readMemory(syms.shown_screen, 1, { shadow: false })[0] };
}
const A = await play(discA), B = await play(discB);
for (const scr of ["main", "shadow"]) {
    const d = [];
    for (let i = 0; i < 0x4000; i++) if (A[scr][i] !== B[scr][i]) d.push(i);
    console.log(`${scr}: ${d.length} bytes differ` + (d.length ? `, from &${(0x4000 + d[0]).toString(16)} to &${(0x4000 + d[d.length - 1]).toString(16)}` : ""));
    for (const i of d.slice(0, 40)) console.log(`  &${(0x4000 + i).toString(16)}: ${A[scr][i].toString(16).padStart(2, "0")} ${B[scr][i].toString(16).padStart(2, "0")}`);
}
console.log(`shown ${A.shown} ${B.shown}; live movers:`);
for (let i = 0; i < 34; i++) if (A.st[3 * 34 + i] < 0x80) console.log(`  slot ${i}: type ${A.st[i].toString(16)} frame ${A.st[34 + i].toString(16)} x ${A.st[3 * 34 + i] * 256 + A.st[2 * 34 + i]} y ${A.st[4 * 34 + i]} screen &${(A.st[6 * 34 + i] * 256 + A.st[5 * 34 + i]).toString(16)}`);
