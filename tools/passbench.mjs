// passbench.mjs - speed on the same game, whatever the build's speed: keys by pass, not by frame.
//
//   node tools/passbench.mjs DISC.ssd [DISC2.ssd ...] [--from P] [--passes N] [--seed S] [--ctrl]
//
// tools/play.mjs-style measurements press keys by frame, so a faster build plays a different
// game from the same script, and the number moves with it. Here keys change by pass, as in
// tools/passlock.mjs (the same generator, so a seed is the same game in both): builds whose game
// state passlock proves identical play identical passes, and only the time differs. Reports, for
// passes FROM to FROM + N (default 500 to 2500, seed 1): passes a second, mean cycles a pass, and
// the fields each pass took (field_count, &90, at main_game_loop).
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { KEY, makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return parseInt(v, 10); };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const FROM = opt("--from", 500), N = opt("--passes", 2000), SEED = opt("--seed", 1), CTRL = flag("--ctrl");
const discs = args;

function passKeys(n) {      // tools/passlock.mjs's generator
    let seed = SEED >>> 0;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) / 65536;
    const keysAt = [];
    for (let p = 0; p < n; ) {
        const len = 10 + Math.floor(rnd() * 70), keys = [];
        if (rnd() < 0.8) keys.push("RIGHT"); else if (rnd() < 0.5) keys.push("LEFT");
        if (rnd() < 0.5) keys.push("SHIFT");
        if (rnd() < 0.15) keys.push("DELETE");
        if (rnd() < 0.2) keys.push("A"); else if (rnd() < 0.1) keys.push("Z");
        if (CTRL && rnd() < 0.1) keys.push("CTRL");
        for (let i = 0; i < len && p < n; i++) keysAt[p++] = keys;
        const gap = Math.floor(rnd() * 10);
        for (let i = 0; i < gap && p < n; i++) keysAt[p++] = [];
    }
    return keysAt;
}

for (const disc of discs) {
    const syms = {};
    for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
        for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
    const s = await bootMaster(MachineSession, disc);
    const cpu = s._machine.processor;
    const m = { passes: 0, target: 1, lastStop: -1, at: [] };
    cpu.debugInstruction.add((pc) => {
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;
        m.passes++;
        m.at[m.passes] = { c, field: s.readMemory(0x90, 1)[0] };
        if (m.passes >= m.target) { m.lastStop = c; return true; }
        return false;
    });
    const events = makeScript(6000, SEED);
    for (let f = 1; f <= 6000 && m.passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
    s.releaseAllKeys();
    const keysAt = passKeys(FROM + N + 2);
    let held = [], stalled = null;
    for (let p = 1; p <= FROM + N; p++) {
        m.target = p;
        for (let i = 0; m.passes < p; i++) { if (i === 150) { stalled = p; break; } await s.runFor(400000); }
        if (stalled) break;
        const want = keysAt[p] || [];
        for (const k of held) if (!want.includes(k)) s.keyUpRaw(KEY[k]);
        for (const k of want) if (!held.includes(k)) s.keyDownRaw(KEY[k]);
        held = want;
    }
    const last = stalled ? stalled - 1 : FROM + N;
    const fields = {}; let cyc = 0;
    for (let p = FROM; p < last; p++) { const d = (m.at[p + 1].field - m.at[p].field + 256) & 255; fields[d] = (fields[d] || 0) + 1; }
    cyc = m.at[last].c - m.at[FROM].c;
    const n = last - FROM;
    console.log(`${disc}: passes ${FROM}-${last} (seed ${SEED}${CTRL ? ", CTRL" : ""}${stalled ? `; stopped making passes at ${stalled}` : ""}): ${(n / (cyc / 2e6)).toFixed(2)} passes/s, ${Math.round(cyc / n)} cycles a pass, fields ${JSON.stringify(fields)}`);
}
