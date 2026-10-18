// pcprof.mjs - passbench's game (keys by pass) with a per-instruction profile: every
// instruction's cycles by its address and bank and the phase it ran in (logic, scroll, render,
// wait, irq), for the cycle budget page (tools/pcagg.py, tools/pccats.py, tools/budgetdata.py).
//
//   PCPROF=PC.json PERPASS=PER.json node tools/pcprof.mjs DISC.ssd --detail [--from P] [--passes N] [--hold RIGHT]
//
// Otherwise tools/passbench.mjs's options and output. PC.json: {passes, pc: {"phase:bank<<16|addr": cycles}};
// PER.json: each pass's work, render, scroll, interrupts, bytes drawn and restored (the byte loops of
// either renderer, and the bytes of each compiled kind drawn: src/compiled_bank*.6502).
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
// --unclobber: BUGS #12's clobber of the generator undone on a build from before the fix
// (tools/passlock.mjs's), so it plays the same game as a build after it and the two measure alike.
import { KEY, makeScript, applyEvents, bootMaster, gameKey, loadSyms, prngClobber } from "./playscript.mjs";
import { makeFlight } from "./flightscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return parseInt(v, 10); };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const FROM = opt("--from", 500), N = opt("--passes", 2000), SEED = opt("--seed", 1), CTRL = flag("--ctrl"), UNCLOBBER = flag("--unclobber");
// --hold A,RIGHT: those keys (the original's names for the actions) held from the first pass on,
// in place of the script; --detail: where each pass's cycles went, and what it did
const holdAt = args.indexOf("--hold"); const HOLD = holdAt >= 0 ? args.splice(holdAt, 2)[1].split(",") : null;
const DETAIL = flag("--detail");
// --flight V: tools/helilock.mjs's helicopter flight (tools/flightscript.mjs), keys chosen each pass from
// the state, in place of the script; the run ends N passes after FROM or 300 passes after the explosion
const FLIGHT = opt("--flight", -1);
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
    if (UNCLOBBER) m.clobbers = prngClobber({ s, syms: loadSyms(disc), get passes() { return m.passes; } }, { undo: true });
    cpu.debugInstruction.add((pc) => {
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;
        m.passes++;
        if (m.passes === 1 && FLIGHT >= 0) s.writeMemory(0x0960, new Array(0x22).fill(0));   // as helilock.mjs
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
    // drawn and restored; scroll columns written; viewport_left at each pass
    const d = { render: 0, wait: 0, irq: 0, drawn: 0, restored: 0, columns: 0, scroll: 0, offStale: 0, onNew: 0, byOverlap: 0, drawsOn: 0 };
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
    let scr = null; const pcCyc = new Map(); let lastPcKey = null, lastPcC = 0; const scrollProfile = new Map(); let lastScr = false; let scrolls = 0, pushes = 0, dupPushes = 0, lastPushVl = -1;
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
        // the compiled kinds: their entries (banks 5-7) and the bytes each draws and puts back
        const KIND = new Map();
        for (const [bk, file] of [[5, "bank5"], [6, "bank6"], [7, "bank7"], [4, "hazel_a"], [4, "hazel_b"]]) { let src = ""; try { src = readFileSync(new URL(`../src/compiled_${file}.6502`, import.meta.url), "utf8"); } catch {}
            for (const m of src.matchAll(/^\.(ck\w+)_draw\r?\n\\ .*?: (\d+) bytes/gm)) KIND.set(`${bk}:${syms[m[1] + "_draw"]}`, +m[2]), KIND.set(`${bk}:${syms[m[1] + "_restore"]}`, -m[2]); }
        cpu.debugInstruction.add((pc, op) => {
            if (m.passes <= FROM || m.passes > FROM + N) { lastOp = op; return false; }
            const c = cyc();
            if (lastPcKey !== null) pcCyc.set(lastPcKey, (pcCyc.get(lastPcKey) || 0) + c - lastPcC); lastPcC = c; lastPcKey = (inIrq ? 'irq' : wt ? 'wait' : ren ? 'render' : scr ? 'scroll' : 'logic') + ':' + (pc >= 0x8000 && pc < 0xc000 ? (cpu.romsel & 15) * 0x10000 + pc : pc);
            if (lastName && lastScr) scrollProfile.set(lastName, (scrollProfile.get(lastName) || 0) + c - lastC); lastScr = !!scr && !inIrq; if (lastName) passProfile.set(lastName, (passProfile.get(lastName) || 0) + c - lastC);
            lastC = c; lastName = inIrq ? "(interrupts)" : (pc < 0x400 ? "(zero page/stack code)" : routine(pc));
            if (pc === 0xe59e && !inIrq) { inIrq = true; irq0 = c; } else if (inIrq && lastOp === 0x40) { inIrq = false; d.irq += c - irq0; }
            lastOp = op;
            if (inIrq) return false;
            if (wt && cpu.s > wt.sp) { d.wait += c - wt.c; wt = null; }
            if (ren && cpu.s > ren.sp) { d.render += c - ren.c; ren = null; }
            if (scr && cpu.s > scr.sp) { d.scroll += c - scr.c; scr = null; }
            if ((pc === syms.scroll_screen_right || pc === syms.scroll_screen_left) && !scr) { scr = { c, sp: cpu.s }; scrolls++; }
            const kb = KIND.get(`${cpu.romsel & 15}:${pc}`);
            if (kb > 0) d.drawn += kb; else if (kb < 0) d.restored -= kb;
            if (b4()) {
                // why each mover is redrawn: need after classify and mark (bit 7 coming off,
                // bit 6 going on), and what close_over_overlaps adds
                if (pc === syms.close_over_overlaps) { const nd = s.readMemory(syms.need, 34, { bank: 4 }); d._before = [...Array(34).keys()].map((i) => cpu.readmem(syms.need + i));
                    for (const v of d._before) { if (v & 0x80) d.offStale++; else if (v & 0x40) d.onNew++; } }
                if (pc === syms.take_off && d._before) { for (let i = 0; i < 34; i++) { const v = cpu.readmem(syms.need + i); if (v && !d._before[i]) d.byOverlap++; } d._before = null; }
                if (pc === syms.draw_mover) d.drawsOn++;
                if (pc === syms.history_push) { const v = s.readMemory(0xb2,1)[0] + 256*s.readMemory(0xba,1)[0]; pushes++; if (v === lastPushVl) dupPushes++; lastPushVl = v; }
                if (pc === syms.render && !ren) ren = { c, sp: cpu.s };
                if ((pc === syms.wait_for_flip || pc === syms.prebuild) && !wt) wt = { c, sp: cpu.s };
                if (DRAWN.has(pc)) d.drawn++;
                if (RESTORED.has(pc)) d.restored++;
                if (pc === syms.write_column) d.columns++;
            }
            return false;
        });
    }
    const vl = [];
    let held = [], stalled = null;
    const flight = FLIGHT >= 0 ? makeFlight(FLIGHT, syms, (a) => s.readMemory(a, 1, { shadow: false })[0]) : null;
    for (let p = 1; p <= FROM + N; p++) {
        m.target = p;
        for (let i = 0; m.passes < p; i++) { if (i === 150) { stalled = p; break; } await s.runFor(400000); }
        if (stalled) break;
        vl[p] = s.readMemory(0xb2, 1)[0] + 256 * s.readMemory(0xba, 1)[0];
        if (flight && flight.done) { stalled = p + 1; break; }
        const want = flight ? flight.keys(p) : keysAt[p] || [];
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
    console.log(`${disc}: passes ${FROM}-${last} (${flight ? `flight ${FLIGHT}: ${flight.log.join(", ")}` : HOLD ? "holding " + HOLD.join("+") : "seed " + SEED}${CTRL ? ", CTRL" : ""}${stalled && !(flight && flight.done) ? `; stopped making passes at ${stalled}` : ""}): ${(n / (cyc / 2e6)).toFixed(2)} passes/s, ${Math.round(cyc / n)} cycles a pass, fields ${JSON.stringify(fields)}; the view moved ${moved} columns, ${(moved / (cyc / 2e6)).toFixed(1)} a second`);
    if (DETAIL) {
        // each pass's work (everything but the wait for the flip): over 2 fields (79,872) the
        // frame cannot be on time
        const per = [];
        for (let p = FROM + 1; p < last; p++) { const a = snaps[p], b = snaps[p + 1]; if (!a || !b) continue;
            const w = (b.c - a.c) - (b.wait - a.wait);
            per.push({ p, work: w, render: (b.render - a.render) - (b.wait - a.wait), irq: b.irq - a.irq, scroll: b.scroll - a.scroll, drawn: b.drawn - a.drawn, restored: b.restored - a.restored, columns: b.columns - a.columns,
                offStale: b.offStale - a.offStale, onNew: b.onNew - a.onNew, byOverlap: b.byOverlap - a.byOverlap, drawsOn: b.drawsOn - a.drawsOn }); }
        const over = per.filter((x) => x.work > 79872); if (process.env.PERPASS) (await import('node:fs')).writeFileSync(process.env.PERPASS, JSON.stringify(per));
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
    if (DETAIL) { console.log(`  pushes ${pushes}, same view as the last ${dupPushes}`); console.log(`  scroll calls ${scrolls}, cycles a scroll by routine:`); for (const [k, v] of [...scrollProfile].sort((a, b) => b[1] - a[1]).slice(0, 200)) console.log(`    ${k.padEnd(48)} ${String(Math.round(v / scrolls)).padStart(7)}`); }
    if (process.env.PCPROF) (await import('node:fs')).writeFileSync(process.env.PCPROF, JSON.stringify({passes: n, pc: Object.fromEntries(pcCyc)}));
    if (DETAIL) console.log(`  a pass: render ${per(d.render - d.wait)} (+ wait for flip ${per(d.wait)}), interrupts ${per(d.irq)}, the rest (logic) ${per(cyc - d.render - d.irq)}; bytes drawn ${(d.drawn / n).toFixed(0)}, restored ${(d.restored / n).toFixed(0)}; columns scrolled ${(d.columns / n).toFixed(2)}`);
}
