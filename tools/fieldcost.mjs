// fieldcost.mjs - a pass's work by object group and by mover, for costing a 50 Hz schedule (layer 4).
//
//   node tools/fieldcost.mjs DISC.ssd [--from P] [--passes N] [--seed S] [--hold RIGHT] --out PER.json
//
// Plays passbench's game (keys by pass, the same generator and seed) and records, for every pass
// from FROM + 1 to FROM + N, cycles with the interrupts taken out (they are counted apart):
//   logic  by group: top (main_game_loop, the key reads, update_movers' own loop, the pass lock),
//          player (update_player, less:) scroll (scroll_screen_right/left), push (update_screen:
//          history_push), lives (plot_lives); proj (update_projectiles); and each mover update,
//          update_mover (3 a pass, enemy soldiers) and update_enemy_helicopter (1 a pass), with
//          its slot and type. Collision and target searches inside each are counted apart (coll).
//   render each put_on and take_off with its slot, type, bytes and cycles; write_column and
//          ren_plot_lives (count, cycles); compact (each call: screen, cycles; each put_on's
//          save block size, blk, from the arena's top, so a model can say when one is due); the rest of render ("book": classify, mark, overlaps,
//          views, compact); the wait for the flip and the prebuild in it (wait, pre).
//   state  each slot's mover state at render (type, frame and flip, x, y, screen address), what
//          of it differs from the last pass's (1 type/frame, 2 x/y, 4 screen address only), and
//          which logic wrote a changed byte of it (1 player, 2 proj, 4 top, 8 scroll/push,
//          16 << i the pass's update_mover i, 128 its update_enemy_helicopter).
//   time   the cycle the pass starts (t0) and its render ends (rend), the flips in it (flips)
// The simulator is tools/fieldsim.py.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const FROM = +opt("--from", 500), N = +opt("--passes", 1500), SEED = +opt("--seed", 1), HOLD = opt("--hold", null), OUT = opt("--out", null);
const disc = args[0];
const syms = {}, bankOf = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") { syms[k] = v.value; bankOf[k] = sec.name; }
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
// the routines that open a context: main RAM by address; bank 4's (the renderer) only with bank 4
// paged (and below &9000 only without ANDY)
const ENTRY = {
    update_player: "player", update_projectiles: "proj", update_movers: "movers",
    update_mover: "um", update_enemy_helicopter: "eh",
    scroll_screen_right: "scroll", scroll_screen_left: "scroll", update_screen: "push", plot_lives: "lives",
    render_pass: "render", wait_for_flip: "wait", prebuild: "pre", put_on: "on", take_off: "off",
    write_column: "col", ren_plot_lives: "rlives", compact: "compact",
};
for (const k of ["check_for_collision_after_horizontal_move", "check_for_hostile_collision", "check_for_collision_after_vertical_move",
    "check_for_mover_collision_with_movers", "check_for_mover_collision_with_range_of_movers", "check_for_player_collision_with_mover_Y",
    "check_for_mover_collision_with_mover_X", "check_for_collision_with_mover", "check_for_collision_with_friends",
    "search_for_target_with_offset", "search_for_target", "check_for_mover_Y_collision_with_player"]) ENTRY[k] = "coll";
const mainEntry = new Map(), b4Entry = new Map();
for (const [k, tag] of Object.entries(ENTRY)) {
    if (syms[k] === undefined) { console.error(`no symbol ${k}`); process.exit(1); }
    (bankOf[k] === "DATA1" ? b4Entry : mainEntry).set(syms[k], tag);
}
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
// passes counted at main_game_loop, the emulator stopped at each so the keys change exactly there
// (passbench's way: the same game as it plays)
let passes = 0, target = 1, lastStop = -1;
cpu.debugInstruction.add((pc) => {
    if (pc !== syms.main_game_loop) return false;
    const c = s.elapsedCycles;
    if (c === lastStop) return false;
    passes++;
    if (passes > FROM && passes <= FROM + N) startPass(c);    // here: after a stop the other hooks do not see this instruction
    if (passes >= target) { lastStop = c; return true; }
    return false;
});
const events = makeScript(6000, SEED);
for (let f = 1; f <= 6000 && passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();
const keysAt = HOLD ? Array.from({ length: FROM + N + 2 }, () => HOLD.split(",")) : passKeys(FROM + N + 2);

const SL = 34, STATE = syms.movers_type_and_colour, STATE_END = STATE + 7 * SL;
const ARR = ["movers_type_and_colour", "movers_frame_and_flip", "movers_x_low", "movers_x_high", "movers_y", "movers_screen_address_low", "movers_screen_address_high"];
for (let i = 0; i < 7; i++) if (syms[ARR[i]] !== STATE + i * SL) { console.error("mover arrays not contiguous"); process.exit(1); }
const snap = () => { const a = s.readMemory(STATE, 7 * SL, { shadow: false }); return [...Array(SL).keys()].map((i) => [0, 1, 2, 3, 4, 5, 6].map((j) => a[j * SL + i])); };
const GBIT = { player: 1, lives: 1, proj: 2, top: 4, movers: 4, scroll: 8, push: 8 };

const per = [];
let P = null, prev = null;
const stack = [];               // {tag, sp, rec}
let inIrq = false, irq0 = 0, lastOp = 0, lastC = 0, lastKey = null, lastRec = null;
let writers = new Array(SL).fill(0);
const newPass = () => {
    P = { p: passes, t0: s.elapsedCycles, flips: [], logic: {}, coll: {}, um: [], eh: [], ops: [], col: 0, colc: 0, rl: 0, rlc: 0, cmp: [], book: 0, wait: 0, pre: 0, irq: 0, scrolled: 0, pushes: 0 };
    per.push(P);
};
// a pass starts at main_game_loop (called from the pass counter, before the profile below)
function startPass(c) {
    account(c); stack.length = 0; newPass();
    lastC = c; lastKey = "top"; lastRec = null;
}
// where the cycles of the instruction at the top of the stack go
function account(c) {
    if (lastKey === null || !P) return;
    const d = c - lastC;
    if (lastKey === "irq") { P.irq += d; return; }
    if (lastRec) { lastRec.cyc += d; if (lastKey.startsWith("coll:")) lastRec.coll += d; }
    if (lastKey === "compact") { P.cmp[P.cmp.length - 1].cyc += d; return; }
    if (lastKey === "on" || lastKey === "off" || lastKey === "col" || lastKey === "rlives" || lastKey === "wait" || lastKey === "pre" || lastKey === "book") {
        if (lastKey === "col") P.colc += d; else if (lastKey === "rlives") P.rlc += d; else if (lastKey === "wait") P.wait += d; else if (lastKey === "pre") P.pre += d; else if (lastKey === "book") P.book += d;
        return;
    }
    const tgt = lastKey.startsWith("coll:") ? P.coll : P.logic, k = lastKey.startsWith("coll:") ? lastKey.slice(5) : lastKey;
    tgt[k] = (tgt[k] || 0) + d;
}
// the context key: the render's own parts; else the logic group (with coll: if in a search)
function keyOf() {
    let group = "top", coll = false, rec = null, ren = null;
    for (const f of stack) {
        if (f.tag === "render") ren = "book";
        else if (ren) { if (f.tag === "wait" || f.tag === "pre" || f.tag === "compact") { ren = f.tag; rec = null; } else if (ren === "book" && (f.tag === "on" || f.tag === "off" || f.tag === "col" || f.tag === "rlives")) { ren = f.tag; rec = f.rec || rec; } }
        else if (f.tag === "coll") coll = true;
        else if (f.tag === "um" || f.tag === "eh") { group = f.tag; rec = f.rec; }
        else if (f.tag === "scroll" || f.tag === "push" || f.tag === "lives") { if (group === "player" || group === "top") group = f.tag; }
        else if (f.tag === "player" || f.tag === "proj" || f.tag === "movers") group = f.tag;
    }
    if (ren) return [ren, rec];
    return [coll ? "coll:" + group : group, rec];
}
// each flip (the vsync interrupt writes shown_screen), by cycle
cpu.debugWrite.add((a) => { if (a === syms.shown_screen && P) P.flips.push(s.elapsedCycles); return false; });
cpu.debugWrite.add((a, v) => {
    if (a < STATE || a >= STATE_END || inIrq || !P) return false;
    if (cpu.readmem(a) === v) return false;
    const [k, rec] = keyOf();
    const g = k.replace(/^coll:/, "");
    writers[(a - STATE) % SL] |= g === "um" ? 16 << rec.i : g === "eh" ? 128 : GBIT[g] || 4;
    return false;
});
// this screen's arena top (bank 4, at render's paging)
const top = () => { const b = cpu.readmem(syms.back); return cpu.readmem(syms.arena_top_lo + b) + 256 * cpu.readmem(syms.arena_top_hi + b); };
let onRec = null;
const DRAWB = [syms["draw_column.byte"], syms["draw_column.part_byte"]], RESTB = [syms["restore_block.byte"], syms["restore_block.part_byte"]];
cpu.debugInstruction.add((pc, op) => {
    if (passes <= FROM || passes > FROM + N) { lastOp = op; lastKey = null; return false; }
    const c = s.elapsedCycles;
    if (pc === syms.main_game_loop && c === lastC) return false;   // seen by startPass
    account(c);
    lastC = c;
    if (pc === 0xe59e && !inIrq) { inIrq = true; irq0 = c; }
    else if (inIrq && lastOp === 0x40) inIrq = false;
    lastOp = op;
    if (inIrq) { lastKey = "irq"; lastRec = null; return false; }
    while (stack.length && cpu.s > stack[stack.length - 1].sp) { const f = stack.pop(); if (f.tag === "render") P.rend = c; if (f.done) f.done(); }
    const b4 = (cpu.romsel & 15) === 4 && (pc >= 0x9000 || !(cpu.romsel & 0x80));
    const tag = pc < 0x8000 ? mainEntry.get(pc) : (pc < 0xc000 && b4 ? b4Entry.get(pc) : undefined);
    if (tag && !(stack.length && stack[stack.length - 1].tag === tag && stack[stack.length - 1].sp === cpu.s)) {
        const f = { tag, sp: cpu.s };
        if (tag === "um" || tag === "eh") { f.rec = { i: P[tag].length, slot: cpu.y, type: cpu.readmem(STATE + cpu.y), cyc: 0, coll: 0 }; P[tag].push(f.rec); }
        if (tag === "on" || tag === "off") { f.rec = { k: tag, slot: cpu.x, type: cpu.readmem(STATE + cpu.x), bytes: 0, cyc: 0 }; P.ops.push(f.rec); }
        if (tag === "on") { const r = f.rec; r.top0 = top(); f.done = () => { r.blk = top() - r.top0; delete r.top0; }; onRec = r; }
        if (tag === "compact") { P.cmp.push({ screen: cpu.readmem(syms.back), cyc: 0, before: top() }); const r = onRec; f.done = () => { P.cmp[P.cmp.length - 1].after = top(); if (r) r.top0 = top(); }; }
        if (tag === "col") P.col++;
        if (tag === "rlives") P.rl++;
        if (tag === "scroll") P.scrolled++;
        if (tag === "push") P.pushes++;
        if (tag === "render") {
            const cur = snap();
            P.state = cur;
            P.changed = cur.map((st, i) => {
                if (!prev) return 0;
                const q = prev[i]; let m = 0;
                if (st[0] !== q[0] || st[1] !== q[1]) m |= 1;
                if (st[2] !== q[2] || st[3] !== q[3] || st[4] !== q[4]) m |= 2;
                if (!m && (st[5] !== q[5] || st[6] !== q[6])) m |= 4;
                return m;
            });
            P.writers = writers; writers = new Array(SL).fill(0);
            prev = cur;
        }
        stack.push(f);
    }
    [lastKey, lastRec] = keyOf();
    if (lastRec && lastRec.bytes !== undefined) {
        if (lastRec.k === "on" ? (pc === DRAWB[0] || pc === DRAWB[1]) : (pc === RESTB[0] || pc === RESTB[1])) lastRec.bytes++;
    }
    return false;
});
let held = [];
for (let p = 1; p <= FROM + N + 1; p++) {
    target = p;
    for (let i = 0; passes < p && i < 150; i++) await s.runFor(400000);
    const want = keysAt[p] || [];
    for (const k of held) if (!want.includes(k)) s.keyUpRaw(gameKey(s, k));
    for (const k of want) if (!held.includes(k)) s.keyDownRaw(gameKey(s, k));
    held = want;
}
const done = per.filter((x) => x.state);       // whole passes only
const sum = (f) => done.reduce((t, x) => t + f(x), 0);
const n = done.length;
const lg = {}; for (const x of done) for (const [k, v] of Object.entries(x.logic)) lg[k] = (lg[k] || 0) + v;
const cg = {}; for (const x of done) for (const [k, v] of Object.entries(x.coll)) cg[k] = (cg[k] || 0) + v;
const r = (v) => Math.round(v / n);
console.log(`${disc}: ${n} passes (${HOLD ? "holding " + HOLD : "seed " + SEED}, from ${FROM})`);
console.log(`  logic a pass: ${Object.entries(lg).map(([k, v]) => `${k} ${r(v)}`).join(", ")}; collisions in: ${Object.entries(cg).map(([k, v]) => `${k} ${r(v)}`).join(", ")}`);
console.log(`  render a pass: on ${r(sum((x) => x.ops.filter((o) => o.k === "on").reduce((t, o) => t + o.cyc, 0)))}, off ${r(sum((x) => x.ops.filter((o) => o.k === "off").reduce((t, o) => t + o.cyc, 0)))}, columns ${r(sum((x) => x.colc))} (${(sum((x) => x.col) / n).toFixed(2)}), lives ${r(sum((x) => x.rlc))} (${(sum((x) => x.rl) / n).toFixed(2)}), book ${r(sum((x) => x.book))}, compact ${r(sum((x) => x.cmp.reduce((t, k) => t + k.cyc, 0)))} (${sum((x) => x.cmp.length)} calls); wait ${r(sum((x) => x.wait))} (pre ${r(sum((x) => x.pre))}); interrupts ${r(sum((x) => x.irq))}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ disc, seed: SEED, hold: HOLD, from: FROM, passes: done }));
