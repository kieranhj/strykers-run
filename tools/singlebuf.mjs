// singlebuf.mjs DISC [--hold RIGHT] [--from P] [--passes N] [--seed S] [--out per.json]: how much of
// the double-buffered renderer's work a single screen would not need. For each pass: the bytes
// drawn and put back, split by whether the mover changed in this pass's logic (a single screen
// redraws only those) or only in the one before (the other screen catching up), the scroll columns
// written, and the pass's logic and render cycles (passbench's game: keys by pass).
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const FROM = +opt("--from", 500), N = +opt("--passes", 1500), SEED = +opt("--seed", 1), HOLD = opt("--hold", null), OUT = opt("--out", null);
const disc = args[0];
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
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
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const rdm = (a, n) => [...s.readMemory(a, n, { shadow: false })];
// passes counted at main_game_loop, the emulator stopped at each so the keys change exactly there
// (passbench's way, so this is the game passbench plays; after a stop the other hooks do not see
// that instruction, so the pass's start is noted here)
let passes = 0, target = 1, lastStop = -1, lStart = 0, scrolledNow = false;
cpu.debugInstruction.add((pc) => {
    if (pc !== syms.main_game_loop) return false;
    const c = s.elapsedCycles;
    if (c === lastStop) return false;
    passes++; lStart = c; scrolledNow = false;
    if (passes >= target) { lastStop = c; return true; }
    return false;
});
const events = makeScript(6000, SEED);
for (let f = 1; f <= 6000 && passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();
const keysAt = HOLD ? Array.from({ length: FROM + N + 2 }, () => HOLD.split(",")) : passKeys(FROM + N + 2);
// the movers' state the renderer compares (type, frame and flip, x, y, screen address), per slot
const SL = 34;
const snap = () => [syms.movers_type_and_colour, syms.movers_frame_and_flip, syms.movers_x_low, syms.movers_x_high, syms.movers_y, syms.movers_screen_address_low, syms.movers_screen_address_high]
    .map((a) => rdm(a, SL));
let prev = null, cur = null;
const per = []; let P = null;
// the byte loops, drawing and putting back: the row-major renderer's or the column renderer's
const BYTES = new Set([...["ren_draw_sprite.byte", "slow_row.draw_byte", "draw_column.byte", "draw_column.part_byte"], ...["restore_part.byte", "slow_row.put_back", "restore_block.byte", "restore_block.part_byte"]].map((k) => syms[k]).filter((v) => v !== undefined));
let op = null;   // {kind, slot, sp, bytes}
let inRender = false, renderSp = 0, rStart = 0, wait = 0, wStart = 0, wSp = 0;
cpu.debugInstruction.add((pc) => {
    if (passes <= FROM || passes > FROM + N) return false;
    const b4 = (cpu.romsel & 15) === 4;
    if (pc === syms.scroll_screen_right || pc === syms.scroll_screen_left) scrolledNow = true;
    if (b4 && pc === syms.render && !inRender) {
        inRender = true; renderSp = cpu.s; rStart = s.elapsedCycles; wait = 0;
        prev = cur; cur = snap();
        P = { p: passes, logic: rStart - lStart, scroll: scrolledNow, drawnNew: 0, drawnOld: 0, restNew: 0, restOld: 0, cols: 0, render: 0 };
        per.push(P);
    }
    if (!inRender) return false;
    if (b4 && (pc === syms.wait_for_flip || pc === syms.prebuild) && !wSp) { wSp = cpu.s; wStart = s.elapsedCycles; }
    else if (wSp && cpu.s > wSp) { wait += s.elapsedCycles - wStart; wSp = 0; }
    if (b4 && pc === syms.write_column) P.cols++;
    if (b4 && (pc === syms.put_on || pc === syms.take_off) && !op) op = { kind: pc === syms.put_on ? "d" : "r", slot: cpu.x, sp: cpu.s, bytes: 0 };
    else if (op && cpu.s > op.sp) {
        // changed in this pass's logic, or the scroll's zone now: a single screen would redo it
        const ch = !prev || cur.some((t, i) => t[op.slot] !== prev[i][op.slot]) || scrolledNow;
        if (op.kind === "d") { if (ch) P.drawnNew += op.bytes; else P.drawnOld += op.bytes; }
        else { if (ch) P.restNew += op.bytes; else P.restOld += op.bytes; }
        op = null;
    }
    else if (op && BYTES.has(pc)) op.bytes++;
    if (cpu.s > renderSp && pc !== syms.render) { inRender = false; P.render = s.elapsedCycles - rStart - wait; }
    return false;
});
let held = [];
for (let p = 1; p <= FROM + N; p++) {
    target = p;
    for (let i = 0; passes < p && i < 150; i++) await s.runFor(400000);
    const want = keysAt[p] || [];
    for (const k of held) if (!want.includes(k)) s.keyUpRaw(gameKey(s, k));
    for (const k of want) if (!held.includes(k)) s.keyDownRaw(gameKey(s, k));
    held = want;
}
const sum = (k) => per.reduce((t, x) => t + x[k], 0);
console.log(JSON.stringify({ disc, passes: per.length, drawnNew: sum("drawnNew"), drawnOld: sum("drawnOld"), restNew: sum("restNew"), restOld: sum("restOld"), cols: sum("cols"), scrolls: per.filter((x) => x.scroll).length }));
if (OUT) writeFileSync(OUT, JSON.stringify(per));
