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
    const m = { passes: 0, target: 1, lastStop: -1, at: [], flips: [] };
    // every flip (the vsync interrupt writes shown_screen): how long each frame stays shown
    cpu.debugWrite.add((a) => { if (a === syms.shown_screen) m.flips.push({ pass: m.passes, field: s.readMemory(0x90, 1)[0] }); return false; });
    cpu.debugInstruction.add((pc) => {
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;
        m.passes++;
        m.at[m.passes] = { c, field: s.readMemory(0x90, 1)[0] };
        if (m.onPass) m.onPass(m.passes, c);
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
    // (the wait includes the work render does in it before waiting - the next scroll's column,
    // src/prebuild.6502 - which is also counted on its own, as pre)
    // drawn and restored; scroll columns written; viewport_left at each pass
    const d = { render: 0, wait: 0, pre: 0, irq: 0, drawn: 0, restored: 0, columns: 0, scroll: 0, offStale: 0, onNew: 0, byOverlap: 0, drawsOn: 0 };
    const snaps = [];          // d at each pass's start, for the per-pass breakdown
    // a flat profile per pass (by the top-level label at or below the PC; interrupts apart),
    // kept for the passes over 2 fields
    // main RAM's labels below &8000, bank 4's (DATA1: the renderer) above: banks 4-7 share addresses
    const labels = [];
    for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
        for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number" && !k.includes(".") && v.value >= 0x400 &&
            (v.value < 0x8000 ? sec.name !== "DATA1" && sec.name !== "DATA2" && sec.name !== "DATA3" && sec.name !== "DATA4" && sec.name !== "andy_data" : sec.name === "DATA1" && v.value < 0xc000)) labels.push([k, v.value]);
    labels.sort((a, b) => a[1] - b[1]);
    const nameAt = new Map();
    const routine = (pc) => { let r = nameAt.get(pc); if (r) return r; let lo = 0, hi = labels.length - 1, best = "?";
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (labels[mid][1] <= pc) { best = labels[mid][0]; lo = mid + 1; } else hi = mid - 1; }
        nameAt.set(pc, best); return best; };
    let passProfile = new Map(), heavyProfile = new Map(), heavyPasses = 0, lastC = 0, lastName = null;
    let scr = null;
    m.onPass = (p, c) => {
        snaps[p] = { ...d, c };
        const a = snaps[p - 1];
        if (a && p - 1 > FROM) { const w = (c - a.c) - (d.wait - a.wait);
            if (w > 79872) { heavyPasses++; for (const [k, v] of passProfile) heavyProfile.set(k, (heavyProfile.get(k) || 0) + v); } }
        passProfile = new Map();
    };
    if (DETAIL) {
        const cyc = () => s.elapsedCycles;
        let inIrq = false, irq0 = 0, lastOp = 0, ren = null, wt = null;
        const b4 = () => (cpu.romsel & 15) === 4;
        // the byte loops: the row-major renderer's (fast and slow_row) or the column renderer's
        const DRAWN = new Set(["ren_draw_sprite.byte", "slow_row.draw_byte", "draw_column.byte", "draw_column.part_byte"].map((k) => syms[k]).filter((v) => v !== undefined));
        const RESTORED = new Set(["restore_part.byte", "slow_row.put_back", "restore_block.byte", "restore_block.part_byte"].map((k) => syms[k]).filter((v) => v !== undefined));
        cpu.debugInstruction.add((pc, op) => {
            if (m.passes <= FROM || m.passes > FROM + N) { lastOp = op; return false; }
            const c = cyc();
            if (lastName) passProfile.set(lastName, (passProfile.get(lastName) || 0) + c - lastC);
            lastC = c; lastName = inIrq ? "(interrupts)" : (pc < 0x400 ? "(zero page/stack code)" : routine(pc));
            if (pc === 0xe59e && !inIrq) { inIrq = true; irq0 = c; } else if (inIrq && lastOp === 0x40) { inIrq = false; d.irq += c - irq0; }
            lastOp = op;
            if (inIrq) return false;
            if (wt && cpu.s > wt.sp) { d.wait += c - wt.c; if (wt.pre) d.pre += c - wt.c; wt = null; }
            if (ren && cpu.s > ren.sp) { d.render += c - ren.c; ren = null; }
            if (scr && cpu.s > scr.sp) { d.scroll += c - scr.c; scr = null; }
            if ((pc === syms.scroll_screen_right || pc === syms.scroll_screen_left) && !scr) scr = { c, sp: cpu.s };
            if (b4()) {
                // why each mover is redrawn: need after classify and mark (bit 7 coming off,
                // bit 6 going on), and what close_over_overlaps adds
                if (pc === syms.close_over_overlaps) { const nd = s.readMemory(syms.need, 34, { bank: 4 }); d._before = [...Array(34).keys()].map((i) => cpu.readmem(syms.need + i));
                    for (const v of d._before) { if (v & 0x80) d.offStale++; else if (v & 0x40) d.onNew++; } }
                if (pc === syms.take_off && d._before) { for (let i = 0; i < 34; i++) { const v = cpu.readmem(syms.need + i); if (v && !d._before[i]) d.byOverlap++; } d._before = null; }
                if (pc === syms.draw_mover) d.drawsOn++;
                if (pc === syms.render && !ren) ren = { c, sp: cpu.s };
                if ((pc === syms.wait_for_flip || pc === syms.prebuild) && !wt) wt = { c, sp: cpu.s, pre: pc === syms.prebuild };
                if (DRAWN.has(pc)) d.drawn++;
                if (RESTORED.has(pc)) d.restored++;
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
    // the frames: how many fields each stayed on screen (a frame shown for 3 or more is late)
    const fl = m.flips.filter((f) => f.pass > FROM && f.pass <= last), shownFor = {};
    for (let i = 1; i < fl.length; i++) { const g = (fl[i].field - fl[i - 1].field + 256) & 255; shownFor[g] = (shownFor[g] || 0) + 1; }
    const lateFrames = Object.entries(shownFor).filter(([g]) => +g > 2).reduce((t, [, k]) => t + k, 0);
    console.log(`  frames: ${fl.length - 1}, shown for (fields) ${JSON.stringify(shownFor)}; late frames ${lateFrames}`);
    if (DETAIL) {
        // each pass's work (everything but the wait for the flip): over 2 fields (79,872) the
        // frame cannot be on time
        const per = [];
        for (let p = FROM + 1; p < last; p++) { const a = snaps[p], b = snaps[p + 1]; if (!a || !b) continue;
            const w = (b.c - a.c) - (b.wait - a.wait);
            per.push({ p, work: w, render: (b.render - a.render) - (b.wait - a.wait), irq: b.irq - a.irq, scroll: b.scroll - a.scroll, drawn: b.drawn - a.drawn, restored: b.restored - a.restored, columns: b.columns - a.columns,
                offStale: b.offStale - a.offStale, onNew: b.onNew - a.onNew, byOverlap: b.byOverlap - a.byOverlap, drawsOn: b.drawsOn - a.drawsOn }); }
        const over = per.filter((x) => x.work > 79872);
        // by how much: what a saving of so many cycles a pass would bring back inside 2 fields
        const by = [5000, 10000, 15000, 20000, 30000, 40000, 1e9].map((lim, i, a) => [lim, over.filter((x) => x.work - 79872 <= lim && (i === 0 || x.work - 79872 > a[i - 1])).length]);
        console.log(`  over by: ${by.map(([lim, n], i) => `${i === 0 ? "0" : by[i - 1][0] / 1000}-${lim > 1e8 ? "" : lim / 1000}k: ${n}`).join(", ")}`);
        console.log(`  passes whose work is over 2 fields: ${over.length} of ${per.length}; worst:`);
        for (const x of over.sort((a, b) => b.work - a.work).slice(0, 10))
            console.log(`    pass ${x.p}: work ${x.work} = render ${x.render} + scroll ${x.scroll} + interrupts ${x.irq} + other logic ${x.work - x.render - x.scroll - x.irq}; drawn ${x.drawn} restored ${x.restored} columns ${x.columns}`);
        const avg = (k, set) => Math.round(set.reduce((t, x) => t + x[k], 0) / Math.max(1, set.length));
        const av = (k, set) => (set.reduce((t, x) => t + x[k], 0) / Math.max(1, set.length)).toFixed(1);
        console.log(`  movers drawn a pass: ${av("drawsOn", per)} (over-2-field passes ${av("drawsOn", over)}): stale ${av("offStale", per)} (${av("offStale", over)}), new ${av("onNew", per)} (${av("onNew", over)}), pulled in by an overlap ${av("byOverlap", per)} (${av("byOverlap", over)})`);
        console.log(`  where the over-2-field passes' cycles go (per pass, the top 22):`);
        for (const [k, v] of [...heavyProfile].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`    ${k.padEnd(48)} ${String(Math.round(v / heavyPasses)).padStart(7)}`);
        console.log(`    the over-2-field passes on average: render ${avg("render", over)} scroll ${avg("scroll", over)} other logic ${avg("work", over) - avg("render", over) - avg("scroll", over) - avg("irq", over)} drawn ${avg("drawn", over)} restored ${avg("restored", over)}`);
    }
    if (DETAIL) console.log(`  a pass: render ${per(d.render - d.wait)} (+ wait for flip ${per(d.wait)}, of which work done in it ${per(d.pre)}), interrupts ${per(d.irq)}, the rest (logic) ${per(cyc - d.render - d.irq)}; bytes drawn ${(d.drawn / n).toFixed(0)}, restored ${(d.restored / n).toFixed(0)}; columns scrolled ${(d.columns / n).toFixed(2)}`);
}
