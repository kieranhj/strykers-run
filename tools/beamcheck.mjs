// beamcheck.mjs - a one-screen build's (MODEL_B, decision 73) screen writes against the beam. Each write
// is for the frame being drawn: the one whose flip is pending (armed, not yet made at its vsync), else
// the one on screen. While the video displays, a write before its frame's flip is "early" if the beam
// has not yet reached the byte (the last frame's field shows it, a field too soon), and one after the
// flip "late" if the beam has passed it (that field shows the byte's old value). In the vertical blank,
// behind the beam before the flip, or ahead of it after, a write is seen when it should be.
//
//   node tools/beamcheck.mjs DISC.ssd [--from P] [--passes N] [--seed S] [--rows] [--who] [--slot]
//
// passbench's game (keys by pass, seed S), passes P+1 to P+N (default 500 and 1000). Every CPU write to
// &4000-&7FFF is placed on the displayed frame: its character row, column and line from the frame's
// start (R12/R13 as the 6845 latched them at the frame's top), the beam's from jsbeeb's 6845 counters.
// Reports frames (the vsync interrupt's flips: writes of shown_screen), how many had early or late
// bytes and how many, the late ones by the frame's field (0 = the field it was first shown in); --rows
// the bytes by character row, --who by routine and cell, --slot by the mover slot being taken off or put on (and the frames each was torn in: its writes after
// the flip partly behind the beam and partly ahead; and the frames that scrolled in which it was late; and
// the frames it missed: a write after the flip that the frame's first field did not show, written behind the
// beam, after that field's display, or in a later field: on a frame that scrolled, shown a column off)
// (take_off's or put_on's X; "column" the scroll's, "lives" the digit's) and the slot's frames. Neither lasts: the next field is right.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey, loadSyms } from "./playscript.mjs";
const MS = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return +v; };
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const FROM = opt("--from", 500), N = opt("--passes", 1000), SEED = opt("--seed", 1), ROWS = flag("--rows"), WHO = flag("--who"), SLOT = flag("--slot");
const [disc] = args;
if (!disc) { console.error("usage: node tools/beamcheck.mjs DISC.ssd [--from P] [--passes N] [--seed S] [--rows] [--who]"); process.exit(2); }
const syms = loadSyms(disc);
const labels = [];
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number" && (v.value < 0x8000 || v.value >= 0xc000 || sec.name === "DATA1")) labels.push([k, v.value]);
labels.sort((a, b) => a[1] - b[1]);
const routine = (pc) => { let lo = 0, hi = labels.length - 1, best = "?"; while (lo <= hi) { const mid = (lo + hi) >> 1; if (labels[mid][1] <= pc) { best = labels[mid][0]; lo = mid + 1; } else hi = mid - 1; } return best; };

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

// the frame's start: the 6845's address in a frame's first row (vertCounter 0). HUD_RUPTURE (decision 67) makes
// each field two frames, the HUD row's (one row from HUD_ROW, below &3000: an address under &600) then the
// screen's: the screen frame's start is kept, and while the HUD row shows the beam is above every screen row (inH)
let startMa = 0, lastV = -1, fieldsSinceFlip = 0, inH = false;
cpu.debugInstruction.add(() => {
    const v = video.vertCounter;
    if (v === 0 && lastV !== 0) fieldsSinceFlip++;
    if (v === 0) { const la = video.lineStartAddr & 0x3fff; inH = la < 0x600; if (!inH) startMa = la; } else inH = false;
    lastV = v;
    return false;
});
const on = () => m.passes > FROM && m.passes <= FROM + N;
let cur = "?";                          // --slot: the drawing's owner
const slotBytes = new Map(), slotFrames = new Map();
if (SLOT) {
    const at = new Map([[syms.take_off, "x"], [syms["put_on.going_on"], "x"], [syms.write_column, "column"], [syms.ren_plot_lives, "lives"], [syms.restore_game_zp, "?"]]);
    cpu.debugInstruction.add((pc) => { const w = at.get(pc); if (w) cur = w === "x" ? `slot ${cpu.x}` : w; return false; });
}
const frames = [], rows = new Array(26).fill(0), who = new Map(), cells = new Map();
const newFrame = () => ({ pass: m.passes, late: 0, early: 0, writes: 0, byField: {} });
let frame = null, next = null, lastStart = -1;          // the frame shown; the one whose flip is pending
cpu.debugWrite.add((a) => {
    if (a === syms.shown_screen) {
        const st = cpu.readmem(syms.flip_crtc_lo) | cpu.readmem(syms.flip_crtc_hi) << 8;   // the frame's start: moved = it scrolled
        if (on()) { frame = next || newFrame(); frame.pass = m.passes; frame.scrolled = st !== lastStart; frames.push(frame); next = null; }
        lastStart = st; fieldsSinceFlip = -1; return false;
    }
    if (a < 0x4000 || a > 0x7fff || !on() || (cpu.acccon & 4)) return false;
    const pending = !!(cpu.readmem(syms.flip_pending) & 0x80);
    const fr = pending ? (next ??= newFrame()) : frame;
    if (!fr) return false;
    fr.writes++;
    if (SLOT && !pending && on() && fr && (fieldsSinceFlip >= 1 || (fieldsSinceFlip === 0 && (!(video.dispEnabled & VDISP) || video.vertCounter >= video.regs[6]))))
        (fr.missed ??= new Set()).add(cur);     // after its frame's first field has shown the whole screen: missed it entirely
    if (!(video.dispEnabled & VDISP) || video.vertCounter >= video.regs[6]) return false;
    const off = ((a >> 3) - startMa) & 0x7ff, row = Math.floor(off / 80), col = off % 80, line = a & 7;
    if (off >= 80 * video.regs[6]) return false;            // past the rows the frame displays (R6: 25, or HUD_RUPTURE's screen frame 24): never shown
    const v = video.vertCounter, sc = video.scanlineCounter, h = video.horizCounter;
    const passed = !inH && (row < v || (row === v && (line < sc || (line === sc && col < h))));
    if (SLOT && !pending && fieldsSinceFlip === 0 && passed) (fr.missed ??= new Set()).add(cur);
    if (SLOT && !pending) { const w = ((fr.slotW ??= new Map()).get(cur) ?? [0, 0]); w[passed ? 0 : 1]++; fr.slotW.set(cur, w); }
    if (pending ? passed : !passed) return false;
    if (pending) fr.early++; else { fr.late++; const f = Math.max(0, fieldsSinceFlip); fr.byField[f] = (fr.byField[f] || 0) + 1; }
    rows[row]++;
    if (SLOT && !pending) { slotBytes.set(cur, (slotBytes.get(cur) || 0) + 1); fr.slots ??= new Set(); if (!fr.slots.has(cur)) { fr.slots.add(cur); slotFrames.set(cur, (slotFrames.get(cur) || 0) + 1); } }
    if (WHO) { const r = (pending ? "early " : "") + routine(cpu.pc); who.set(r, (who.get(r) || 0) + 1); const k = `r${row} c${col}`; cells.set(k, (cells.get(k) || 0) + 1); }
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
const bad = frames.filter((f) => f.late || f.early);
const torn = new Map();                 // --slot: frames where a slot's writes after the flip were partly behind the beam, partly ahead
const missed = new Map(), missedScrolled = new Map();   // --slot: frames whose first field showed a slot's bytes not yet written (and of them, frames that scrolled)
for (const f of frames) for (const k of f.missed || []) { missed.set(k, (missed.get(k) || 0) + 1); if (f.scrolled) missedScrolled.set(k, (missedScrolled.get(k) || 0) + 1); }
const scrolledLate = new Map();         // --slot: frames that scrolled in which a slot had late bytes (shown a column off where late)
for (const f of frames) for (const [k, [late, ok]] of f.slotW || []) {
    if (late && ok) torn.set(k, (torn.get(k) || 0) + 1);
    if (late && f.scrolled) scrolledLate.set(k, (scrolledLate.get(k) || 0) + 1);
}
const byField = {}; let late = 0, early = 0;
for (const f of frames) { late += f.late; early += f.early; for (const [k, n] of Object.entries(f.byField)) byField[k] = (byField[k] || 0) + n; }
const hist = {}; for (const f of bad) { const n = f.late + f.early, b = n < 10 ? "1-9" : n < 100 ? "10-99" : n < 1000 ? "100-999" : "1000+"; hist[b] = (hist[b] || 0) + 1; }
console.log(JSON.stringify({ disc, passes: `${FROM + 1}-${FROM + N}`, seed: SEED, frames: frames.length,
    framesWithEarlyOrLateBytes: bad.length, framesWithLateBytes: frames.filter((f) => f.late).length, framesWithEarlyBytes: frames.filter((f) => f.early).length,
    lateBytes: late, earlyBytes: early, writes: frames.reduce((a, f) => a + f.writes, 0), lateByField: byField, framesByBadBytes: hist,
    worst: bad.sort((a, b) => b.late + b.early - a.late - a.early).slice(0, 8).map((f) => `${f.pass}:${f.late}+${f.early}`),
    ...(ROWS ? { badByRow: rows } : {}),
    ...(SLOT ? { lateBySlot: Object.fromEntries([...slotBytes].sort((a, b) => b[1] - a[1])), framesBySlot: Object.fromEntries([...slotFrames].sort((a, b) => b[1] - a[1])),
        tornBySlot: Object.fromEntries([...torn].sort((a, b) => b[1] - a[1])),
        scrolledFrames: frames.filter((f) => f.scrolled).length,
        missedBySlot: Object.fromEntries([...missed].sort((a, b) => b[1] - a[1])),
        missedInScrolledFramesBySlot: Object.fromEntries([...missedScrolled].sort((a, b) => b[1] - a[1])),
        lateInScrolledFramesBySlot: Object.fromEntries([...scrolledLate].sort((a, b) => b[1] - a[1])) } : {}),
    ...(WHO ? { badBy: Object.fromEntries([...who].sort((a, b) => b[1] - a[1]).slice(0, 16)), badCells: Object.fromEntries([...cells].sort((a, b) => b[1] - a[1]).slice(0, 24)) } : {}) }));
process.exit(0);
