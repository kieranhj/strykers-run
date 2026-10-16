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
import { KEY, makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return parseInt(v, 10); };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const FROM = opt("--from", 500), N = opt("--passes", 2000), SEED = opt("--seed", 1), CTRL = flag("--ctrl");
// --hold A,RIGHT: those keys (the original's names for the actions) held from the first pass on,
// in place of the script; --detail: where each pass's cycles went, and what it did
const holdAt = args.indexOf("--hold"); const HOLD = holdAt >= 0 ? args.splice(holdAt, 2)[1].split(",") : null;
const DETAIL = flag("--detail");
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
    // a held key "K@N" is down for the first 3 passes of every N (a jump wants pressing, not holding)
    const holdAt = (p) => HOLD.filter((k) => { const [name, every] = k.split("@"); return !every || p % +every < 3; }).map((k) => k.split("@")[0]);
    const keysAt = HOLD ? Array.from({ length: FROM + N + 2 }, (_, p) => holdAt(p)) : passKeys(FROM + N + 2);
    // detail: cycles in render (less its wait for the flip), in the wait, in interrupts; bytes
    // drawn and restored; scroll columns written; viewport_left at each pass
    const d = { render: 0, wait: 0, irq: 0, drawn: 0, restored: 0, columns: 0 };
    if (DETAIL) {
        const cyc = () => s.elapsedCycles;
        let inIrq = false, irq0 = 0, lastOp = 0, ren = null, wt = null;
        const b4 = () => (cpu.romsel & 15) === 4;
        cpu.debugInstruction.add((pc, op) => {
            if (m.passes <= FROM || m.passes > FROM + N) { lastOp = op; return false; }
            const c = cyc();
            if (pc === 0xe59e && !inIrq) { inIrq = true; irq0 = c; } else if (inIrq && lastOp === 0x40) { inIrq = false; d.irq += c - irq0; }
            lastOp = op;
            if (inIrq) return false;
            if (wt && cpu.s > wt.sp) { d.wait += c - wt.c; wt = null; }
            if (ren && cpu.s > ren.sp) { d.render += c - ren.c; ren = null; }
            if (b4()) {
                if (pc === syms.render && !ren) ren = { c, sp: cpu.s };
                if (pc === syms.wait_for_flip && !wt) wt = { c, sp: cpu.s };
                if (pc === syms["draw_column.byte"] || pc === syms["draw_column.part_byte"]) d.drawn++;
                if (pc === syms["restore_block.byte"] || pc === syms["restore_block.part_byte"]) d.restored++;
                if (pc === syms.write_column) d.columns++;
            }
            return false;
        });
    }
    const vl = [];
    let held = [], stalled = null;
    for (let p = 1; p <= FROM + N; p++) {
        m.target = p;
        for (let i = 0; m.passes < p; i++) { if (i === 150) { stalled = p; break; } await s.runFor(400000); }
        if (stalled) break;
        vl[p] = s.readMemory(0xb2, 1)[0] + 256 * s.readMemory(0xba, 1)[0];
        const want = keysAt[p] || [];
        for (const k of held) if (!want.includes(k)) s.keyUpRaw(gameKey(s, k));
        for (const k of want) if (!held.includes(k)) s.keyDownRaw(gameKey(s, k));
        held = want;
    }
    const last = stalled ? stalled - 1 : FROM + N;
    const fields = {}; let cyc = 0;
    for (let p = FROM; p < last; p++) { const d = (m.at[p + 1].field - m.at[p].field + 256) & 255; fields[d] = (fields[d] || 0) + 1; }
    cyc = m.at[last].c - m.at[FROM].c;
    const n = last - FROM;
    const per = (v) => Math.round(v / n);
    const moved = vl[last] - vl[FROM];
    console.log(`${disc}: passes ${FROM}-${last} (${HOLD ? "holding " + HOLD.join("+") : "seed " + SEED}${CTRL ? ", CTRL" : ""}${stalled ? `; stopped making passes at ${stalled}` : ""}): ${(n / (cyc / 2e6)).toFixed(2)} passes/s, ${Math.round(cyc / n)} cycles a pass, fields ${JSON.stringify(fields)}; the view moved ${moved} columns, ${(moved / (cyc / 2e6)).toFixed(1)} a second`);
    if (DETAIL) console.log(`  a pass: render ${per(d.render - d.wait)} (+ wait for flip ${per(d.wait)}), interrupts ${per(d.irq)}, the rest (logic) ${per(cyc - d.render - d.irq)}; bytes drawn ${(d.drawn / n).toFixed(0)}, restored ${(d.restored / n).toFixed(0)}; columns scrolled ${(d.columns / n).toFixed(2)}`);
}
