// drawprof.mjs - where the renderer's cycles go when it draws and restores each mover, and what
// the bytes are: for costing faster sprite drawing (docs/step2-layer4-costing.md, "heavy frames").
//
//   node tools/drawprof.mjs DISC.ssd [--from P] [--passes N] [--seed S] [--hold RIGHT] [--out OPS.json]
//
// Plays passbench's game (keys by pass, stopping at each). For every put_on and take_off with
// pixels: the slot, its type, cycles by renderer label (interrupts out), and counts of parts
// (ren_draw_sprite), columns, cells and bytes. For each byte drawn: its screen address and its
// sprite index, and whether the index's mask is &FF with pixel 0 (transparent: the screen byte
// does not change), mask 0 (opaque), or mixed. Then, against the same slot's last drawing on
// the same screen: the bytes at an address both drew, and of those the ones with the same index
// (the screen byte would not change if the background under it did not).
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const FROM = +opt("--from", 500), N = +opt("--passes", 1500), SEED = +opt("--seed", 1), HOLD = opt("--hold", null), OUT = opt("--out", null);
const disc = args[0];
const syms = {}, labels = [];
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") {
        syms[k] = v.value;
        if (sec.name === "DATA1" && v.value >= 0x9000 && v.value < 0xb400 && !/operand|_lo$|_hi$/.test(k)) labels.push([k, v.value]);
    }
labels.sort((a, b) => a[1] - b[1]);
const nameAt = new Map();
const routine = (pc) => { let r = nameAt.get(pc); if (r) return r; let lo = 0, hi = labels.length - 1, best = "?";
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (labels[mid][1] <= pc) { best = labels[mid][0]; lo = mid + 1; } else hi = mid - 1; }
    nameAt.set(pc, best); return best; };
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
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
let passes = 0, target = 1, lastStop = -1;
cpu.debugInstruction.add((pc) => {
    if (pc !== syms.main_game_loop) return false;
    const c = s.elapsedCycles;
    if (c === lastStop) return false;
    passes++;
    if (passes >= target) { lastStop = c; return true; }
    return false;
});
const events = makeScript(6000, SEED);
for (let f = 1; f <= 6000 && passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();
const keysAt = HOLD ? Array.from({ length: FROM + N + 2 }, () => HOLD.split(",")) : passKeys(FROM + N + 2);

const A = syms, rd = (a) => cpu.readmem(a), rw = (a) => cpu.readmem(a) | (cpu.readmem(a + 1) << 8);
// the compiled kinds (layer 4): their entries and the bytes each draws (+) and puts back (-), by
// the bank paged when they run (HAZEL's run with bank 4's)
const KIND = new Map();
for (const [bk, file] of [[5, "bank5"], [6, "bank6"], [7, "bank7"], [4, "hazel_a"], [4, "hazel_b"]]) { let src = ""; try { src = readFileSync(new URL(`../src/compiled_${file}.6502`, import.meta.url), "utf8"); } catch {}
    for (const m of src.matchAll(/^\.(ck\w+)_draw\r?\n\\ .*?: (\d+) bytes/gm)) KIND.set(`${bk}:${syms[m[1] + "_draw"]}`, +m[2]), KIND.set(`${bk}:${syms[m[1] + "_restore"]}`, -m[2]); }
const ops = [];             // {k, slot, type, pass, screen, cyc, by: {label: cycles}, parts, cols, cells, bytes, tr, op, mx, same, sameIdx, prevBytes}
const last = new Map();     // slot + 64 * screen -> Map(addr -> index) of its last drawing there
let op = null, inIrq = false, lastOp = 0, lastC = 0, lastName = null;
cpu.debugInstruction.add((pc, opc) => {
    const c = s.elapsedCycles;
    if (op && lastName) { const d = c - lastC; op.cyc += d; op.by[lastName] = (op.by[lastName] || 0) + d; }
    lastC = c; lastName = null;
    if (pc === 0xe59e && !inIrq) inIrq = true; else if (inIrq && lastOp === 0x40) inIrq = false;
    lastOp = opc;
    if (inIrq || passes <= FROM || passes > FROM + N) return false;
    const kb = op && KIND.get(`${cpu.romsel & 15}:${pc}`);
    if (kb > 0) op.bytes += kb; else if (kb < 0) op.restored -= kb;
    if ((cpu.romsel & 15) !== 4 || pc < 0x9000 || pc >= 0xc000) { if (op) lastName = kb !== undefined || (pc >= 0xc000 && pc < 0xe000) || (cpu.romsel & 15) > 4 ? "(compiled kinds)" : "(game code)"; return false; }
    if (op && cpu.s > op.sp) {
        if (op.bytes || op.restored) {
            if (op.k === "on") {
                const key = op.slot + 64 * op.screen, prev = last.get(key);
                op.prevBytes = prev ? prev.map.size : 0;
                op.moved = prev ? +(prev.sa !== op.sa) : -1;
                if (prev) for (const [a, i] of op.drawn) if (prev.map.has(a)) { op.same++; if (prev.map.get(a) === i) op.sameIdx++; }
                last.set(key, { map: op.drawn, sa: op.sa });
            }
            delete op.drawn; delete op.sp; ops.push(op);
        }
        op = null;
    }
    if (!op && (pc === A.put_on || pc === A.take_off))
        op = { k: pc === A.put_on ? "on" : "off", slot: cpu.x, type: rd(A.movers_type_and_colour + cpu.x) & 0x7f, frame: rd(A.movers_frame_and_flip + cpu.x),
               pass: passes, screen: rd(A.back), sp: cpu.s, cyc: 0, by: {}, parts: 0, cols: 0, cells: 0, bytes: 0, restored: 0,
               tr: 0, op: 0, mx: 0, same: 0, sameIdx: 0, drawn: new Map(), partList: [],
               sa: rd(A.movers_screen_address_low + cpu.x) + 256 * rd(A.movers_screen_address_high + cpu.x) };
    if (!op) return false;
    lastName = routine(pc);
    if (pc === A.ren_draw_sprite) { op.parts++; op.partList.push([cpu.a, op.frame >> 7, -1, 0]); }
    else if (pc === A.draw_column && op.partList.length) op.partList[op.partList.length - 1][2] = rd(0xcd);   // ds_line (render.6502: zero page)
    else if (pc === A["ren_draw_sprite.chunk"] && op.partList.length && op.partList[op.partList.length - 1][2] < 0)
        op.partList[op.partList.length - 1][2] = rd(0xc2) & 7;                  // row-major: the bottom row's line in its cell
    else if (pc === A["draw_column.each"] || pc === A["ren_draw_sprite.fast"] || pc === A.slow_row) op.cols++;   // columns, or rows
    else if (pc === A["draw_column.cell"]) op.cells++;
    else if (pc === A["draw_column.byte"] || pc === A["draw_column.part_byte"] || pc === A["ren_draw_sprite.byte"] || pc === A["slow_row.draw_byte"]) {
        // the byte's index and screen address: the column loop's (Y the line in the cell), the
        // row loop's (X the stream's place, Y the offset in the row), slow_row's (Y the place)
        let i, addr;
        if (pc === A["ren_draw_sprite.byte"]) { i = rd(rw(A["ren_draw_sprite.data_op"]) + cpu.x); addr = rw(0xc2) + cpu.y; }
        else if (pc === A["slow_row.draw_byte"]) { i = rd(rw(0xc0) + cpu.y); addr = rw(0xc9); }
        else { i = rd(rw(0xc0) + cpu.y); addr = rw(0xc2) + cpu.y; }
        const mo = A["ren_draw_sprite.mask_op"] ?? A["draw_column.mask_operand"], po = A["ren_draw_sprite.pix_op"] ?? A["draw_column.pix_operand"];
        const m = rd(rw(mo) + i), p = rd(rw(po) + i);
        op.bytes++; if (m === 0xff && p === 0) op.tr++; else if (m === 0) op.op++; else op.mx++;
        op.drawn.set(addr, i); if (op.partList.length) op.partList[op.partList.length - 1][3]++;
    }
    else if (pc === A["restore_block.byte"] || pc === A["restore_block.part_byte"] || pc === A["restore_part.byte"] || pc === A["slow_row.put_back"]) op.restored++;
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
// the report: by slot group, drawing and restoring
const G = [["player", (x) => x === 0], ["enemies", (x) => x >= 1 && x <= 9], ["enemy helicopters", (x) => x === 10 || x === 11], ["projectiles", (x) => x >= 12 && x <= 23]];
console.log(`${disc}: ${N} passes (${HOLD ? "holding " + HOLD : "seed " + SEED}, from ${FROM}); cycles and counts a pass`);
for (const [name, f] of G) for (const k of ["on", "off"]) {
    const sel = ops.filter((o) => o.k === k && f(o.slot)); if (!sel.length) continue;
    const sum = (key) => sel.reduce((t, o) => t + o[key], 0), cyc = sum("cyc"), b = k === "on" ? sum("bytes") : sum("restored");
    console.log(`  ${name} ${k}: ${(cyc / N).toFixed(0)} cycles, ${(b / N).toFixed(1)} bytes (${(cyc / Math.max(1, b)).toFixed(1)} a byte), ${(sel.length / N).toFixed(2)} calls`
        + (k === "on" ? `, ${(sum("parts") / sel.length).toFixed(1)} parts, ${(sum("cols") / sel.length).toFixed(1)} columns (row-major: rows), ${(sum("cells") / sel.length).toFixed(1)} cells, ${(b / sel.length).toFixed(1)} bytes a call;`
            + ` transparent ${(100 * sum("tr") / b).toFixed(1)}%, opaque ${(100 * sum("op") / b).toFixed(1)}%, mixed ${(100 * sum("mx") / b).toFixed(1)}%;`
            + ` at an address its last drawing on this screen drew ${(100 * sum("same") / b).toFixed(1)}%, and with the same index ${(100 * sum("sameIdx") / b).toFixed(1)}%` : ""));
    const by = {}; for (const o of sel) for (const [l, v] of Object.entries(o.by)) by[l] = (by[l] || 0) + v;
    console.log("    " + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([l, v]) => `${l} ${(v / N).toFixed(0)}`).join(", "));
}
for (const [name, f] of G) {
    const sel = ops.filter((o) => o.k === "on" && f(o.slot) && o.moved >= 0);
    for (const mv of [0, 1]) { const q = sel.filter((o) => o.moved === mv), b = q.reduce((t, o) => t + o.bytes, 0);
        if (q.length) console.log(`  ${name}, ${mv ? "moved" : "same place"}: ${(q.length / N).toFixed(2)} draws a pass, ${(b / N).toFixed(1)} bytes; same address ${(100 * q.reduce((t, o) => t + o.same, 0) / b).toFixed(1)}%, same index there ${(100 * q.reduce((t, o) => t + o.sameIdx, 0) / b).toFixed(1)}%`); }
}
// the player's parts: how many (sprite, flip, line in the cell) there are, and the share of its bytes the commonest cover
{
    const parts = new Map();
    for (const o of ops) if (o.k === "on" && o.slot === 0) for (const [sp, fl, ln, b] of o.partList) { const k = `${sp},${fl},${ln}`; const e = parts.get(k) || { n: 0, b: 0, size: 0 }; e.n++; e.b += b; e.size = Math.max(e.size, b); parts.set(k, e); }
    const all = [...parts.entries()].sort((a, b) => b[1].b - a[1].b), tot = all.reduce((t, [, e]) => t + e.b, 0);
    let acc = 0, accSize = 0; const cover = [];
    all.forEach(([k, e], i) => { acc += e.b; accSize += e.size; if ([4, 8, 16, 32, 64].includes(i + 1) || i === all.length - 1) cover.push(`${i + 1}: ${(100 * acc / tot).toFixed(0)}% (${accSize} bytes)`); });
    const sprites = new Set(all.map(([k]) => k.split(",").slice(0, 2).join(",")));
    console.log(`  the player's parts: ${all.length} (sprite, flip, line) kinds over ${sprites.size} (sprite, flip); the commonest cover of its bytes drawn: ${cover.join(", ")}`);
    const lines = {}; for (const [k, e] of all) { const l = k.split(",")[2]; lines[l] = (lines[l] || 0) + e.b; }
    console.log(`  its bytes by the part's line in the cell: ${Object.entries(lines).map(([l, b]) => `${l}: ${(100 * b / tot).toFixed(0)}%`).join(", ")}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(ops));
