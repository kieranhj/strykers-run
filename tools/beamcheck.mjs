// beamcheck.mjs - a one-screen build's (MODEL_B, decision 73) screen writes against the beam: which land
// where the beam has already been in the field on screen ("late": that byte shows its old value until
// the next field) and which ahead of it or in the vertical blank (seen as written).
//
//   node tools/beamcheck.mjs DISC.ssd [--from P] [--passes N] [--seed S] [--rows]
//
// passbench's game (keys by pass, seed S), passes P+1 to P+N (default 500 and 1000). Every CPU write to
// &4000-&7FFF is placed on the displayed frame: its character row, column and line from the frame's
// start (R12/R13 as the 6845 latched them at the frame's top), the beam's from jsbeeb's 6845 counters.
// A write is late if the video is displaying (rows 0-24) and the beam is past the byte. Reports frames
// (the vsync interrupt's flips: writes of shown_screen), how many had late bytes and how many, the
// late bytes by the frame's field (0 = the field the frame was first shown in), and with --rows by
// character row. A late byte is not wrong for long: the next field shows it; a frame's first field
// with late bytes shows part of the frame before it there.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey, loadSyms } from "./playscript.mjs";
const MS = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return +v; };
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const FROM = opt("--from", 500), N = opt("--passes", 1000), SEED = opt("--seed", 1), ROWS = flag("--rows"), WHO = flag("--who");
const [disc] = args;
if (!disc) { console.error("usage: node tools/beamcheck.mjs DISC.ssd [--from P] [--passes N] [--seed S] [--rows]"); process.exit(2); }
const syms = loadSyms(disc);
// --who: the late writes by the routine that made them (the nearest label at or below the PC; bank 4's above &8000)
const labels = [];
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number" && (v.value < 0x8000 || v.value >= 0xc000 || sec.name === "DATA1")) labels.push([k, v.value]);
labels.sort((a, b) => a[1] - b[1]);
const routine = (pc) => { let lo = 0, hi = labels.length - 1, best = "?"; while (lo <= hi) { const mid = (lo + hi) >> 1; if (labels[mid][1] <= pc) { best = labels[mid][0]; lo = mid + 1; } else hi = mid - 1; } return best; };
const who = new Map(), cells = new Map();

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
        for (let i = 0; i < len && p < n; i++) keysAt[p++] = keys;
        const gap = Math.floor(rnd() * 10);
        for (let i = 0; i < gap && p < n; i++) keysAt[p++] = [];
    }
    return keysAt;
}

const s = await bootMaster(MS, disc);
const cpu = s._machine.processor, video = cpu.video;
const VDISP = 1;
const m = { passes: 0, target: 1, lastStop: -1 };
cpu.debugInstruction.add((pc) => {
    if (pc !== syms.main_game_loop) return false;
    const c = s.elapsedCycles; if (c === m.lastStop) return false;
    m.passes++;
    if (m.passes >= m.target) { m.lastStop = c; return true; }
    return false;
});
const events = makeScript(6000, SEED);
for (let f = 1; f <= 6000 && m.passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();

// the frame's start: latched when the 6845 starts a frame (vertCounter back to 0)
let startMa = 0, lastV = -1, fieldsSinceFlip = 0;
const frames = [];          // per flip: { pass, late, lateByField: {}, writes }
let frame = null;
const rows = new Array(26).fill(0);
cpu.debugInstruction.add(() => {
    const v = video.vertCounter;
    if (v === 0 && lastV !== 0) { startMa = (video.regs[13] | (video.regs[12] << 8)) & 0x3fff; fieldsSinceFlip++; }
    lastV = v;
    return false;
});
const on = () => m.passes > FROM && m.passes <= FROM + N;
cpu.debugWrite.add((a) => {
    if (a === syms.shown_screen) { if (on()) { frame = { pass: m.passes, late: 0, writes: 0, byField: {} }; frames.push(frame); } fieldsSinceFlip = -1; return false; }
    if (a < 0x4000 || a > 0x7fff || !frame || !on() || (cpu.acccon & 4)) return false;
    frame.writes++;
    if (!(video.dispEnabled & VDISP) || video.vertCounter > 24) return false;
    const off = (((a >> 3) - startMa) & 0x7ff), row = Math.floor(off / 80), col = off % 80, line = a & 7;
    if (off >= 2000) return false;                          // the ring's 384 bytes never shown
    const v = video.vertCounter, sc = video.scanlineCounter, h = video.horizCounter;
    const passed = row < v || (row === v && (line < sc || (line === sc && col < h)));
    if (passed) { frame.late++; const f = Math.max(0, fieldsSinceFlip); frame.byField[f] = (frame.byField[f] || 0) + 1; rows[row]++;
        if (WHO) { const r = routine(cpu.pc); who.set(r, (who.get(r) || 0) + 1); const k = `r${row} c${col}`; cells.set(k, (cells.get(k) || 0) + 1); } }
    return false;
});

const keysAt = passKeys(FROM + N + 2);
let held = [];
for (let p = 1; p <= FROM + N; p++) {
    m.target = p;
    for (let i = 0; m.passes < p; i++) { if (i === 150) { console.log(`stalled at pass ${p}`); process.exit(1); } await s.runFor(400000); }
    const want = keysAt[p] || [];
    for (const k of held) if (!want.includes(k)) s.keyUpRaw(gameKey(s, k));
    for (const k of want) if (!held.includes(k)) s.keyDownRaw(gameKey(s, k));
    held = want;
}
const withLate = frames.filter((f) => f.late);
const byField = {}; let late = 0;
for (const f of frames) { late += f.late; for (const [k, n] of Object.entries(f.byField)) byField[k] = (byField[k] || 0) + n; }
const hist = {}; for (const f of withLate) { const b = f.late < 10 ? "1-9" : f.late < 100 ? "10-99" : f.late < 1000 ? "100-999" : "1000+"; hist[b] = (hist[b] || 0) + 1; }
console.log(JSON.stringify({ disc, passes: `${FROM + 1}-${FROM + N}`, seed: SEED, frames: frames.length, framesWithLateBytes: withLate.length,
    lateBytes: late, writes: frames.reduce((a, f) => a + f.writes, 0), lateByField: byField, framesByLateBytes: hist,
    worst: withLate.sort((a, b) => b.late - a.late).slice(0, 8).map((f) => `${f.pass}:${f.late}`), ...(ROWS ? { lateByRow: rows } : {}),
    ...(WHO ? { lateBy: Object.fromEntries([...who].sort((a, b) => b[1] - a[1]).slice(0, 16)), lateCells: Object.fromEntries([...cells].sort((a, b) => b[1] - a[1]).slice(0, 24)) } : {}) }));
process.exit(0);
