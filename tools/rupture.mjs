// rupture.mjs - HUD_RUPTURE's CRTC and ACCCON writes and what the video reads, field by field, in the
// running build (decision 67).
//
//   node tools/rupture.mjs DISC.ssd [FROM_FRAME] [FRAMES]
//
// Plays tools/playscript.mjs (seed 1) to FROM_FRAME (default 2600, in play), then for FRAMES frames
// (default 1000) watches the beam (jsbeeb's 6845: its row, scanline and character counters, and its
// address) at every write the interrupt makes, and at every instruction while the video displays:
//   - R4 0 (the HUD's frame ends after one row) must be written in the HUD's frame (its address in
//     HUD_ROW's characters), row 0, before its last scanline's C0 = 1, where the 6845 latches the
//     frame's end (jsbeeb's video.js, after the Hitachi part);
//   - D, ACCCON bit 0, must be written in the horizontal blank after the HUD's last scanline (row 0,
//     scanline 7, character 80 on): with D set the CRTC's addresses below &3000 read ANDY and HAZEL
//     (KC, 2026-10-23), so the HUD row is shown with D = 0 and the screen with D = shown_screen;
//   - R4 &25 must be written after the HUD's frame's end has latched (its last scanline, C0 1 on) and
//     before M's own last scanline of row 0;
//   - R12/R13 (the 6845 loads them at a frame's start) must be written in the frame before the one
//     they start: M's start in the HUD's frame, HUD_ROW's in M's (after M has begun);
//   - while the video displays, the HUD's addresses must be read with D = 0 and the screen's with
//     D = shown_screen.
// Prints each write's beam positions, the palette's row-111 write (cycles from the vsync's CA1 flag,
// as tools/split.mjs), and the fields where anything is out of place.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MS = await loadMachineSession();
const [disc, fromA, nA] = process.argv.slice(2);
const FROM = +(fromA ?? 2600), N = +(nA ?? 1000);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] ??= v.value;
const s = await bootMaster(MS, disc);
const ev = makeScript(FROM + N + 10, 1);
for (let f = 1; f <= FROM; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
const cpu = s._machine.processor, video = cpu.video;
const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const HDISP = 2, VDISP = 1;
const hudMa = (syms.HUD_ROW ?? 0x0b80) >> 3;
const inHud = (ma) => ma >= hudMa && ma < hudMa + 80 * 2;      // the row's characters (and the next, should it run on)
const where = () => ({ row: video.vertCounter, line: video.scanlineCounter, char: video.horizCounter, ma: video.addr });
const t1Code = (pc) => syms.rupture_t1 !== undefined && pc >= syms.rupture_t1 && pc < syms.rupture_t1 + 0x80;
let prev = 0, rise = null, reg = -1, field = null, shown = 0;
let displayed = 0, hudSamples = 0, screenSamples = 0, hudWrongD = 0, screenWrongD = 0;
const fields = [];
cpu.debugInstruction.add(() => {
    cpu.sysvia._catchUp();
    const f = cpu.sysvia.ifr & 2;
    if (f && !prev) { if (field) fields.push(field); rise = cyc(); field = { r4: [], d: [], pal: [], start: [] }; }
    prev = f;
    if ((video.dispEnabled & (HDISP | VDISP)) === (HDISP | VDISP)) {
        displayed++;
        const ma = video.addr, d = cpu.acccon & 1;
        if (inHud(ma)) { hudSamples++; if (d) hudWrongD++; }
        else if (ma >= 0x0800) { screenSamples++; if (d !== shown) screenWrongD++; }
    }
    return false;
});
cpu.debugWrite.add((addr, v) => {
    if (addr === 0xfe00) reg = v & 0x1f;
    else if (addr === 0xfe01 && reg === 4 && field) field.r4.push({ v, at: cyc() - rise, ...where() });
    else if (addr === 0xfe01 && (reg === 12 || reg === 13) && field && t1Code(cpu.pc)) field.start.push({ reg, v, ...where() });
    else if (addr === 0xfe21 && field && cyc() - rise > 5000) field.pal.push(cyc() - rise);
    else if (addr === syms.shown_screen) shown = v & 1;
    else if (addr === 0xfe34 && field && t1Code(cpu.pc)) field.d.push({ v, ...where() });
    return false;
});
for (let f = FROM + 1; f <= FROM + N; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }

const stat = (a) => a.length ? { n: a.length, min: Math.min(...a), max: Math.max(...a) } : { n: 0 };
const hist = (a) => Object.entries(a.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {})).sort((x, y) => y[1] - x[1]).slice(0, 6);
const ONE_SCREEN = syms.call_b5 !== undefined;                       // a MODEL_B build (its bank 5 call: no other build has one)
let ruptured = 0, bad = 0;
const badFields = [], r4hud = [], r4m = [], dAt = [], startAt = [];
fields.forEach((x, i) => {
    const h = x.r4.filter((w) => w.v === 0), m = x.r4.filter((w) => w.v === 0x25);
    if (!h.length && !m.length && !x.d.length) return;               // the rupture is off (the title)
    ruptured++;
    h.forEach((w) => r4hud.push(`row ${w.row} line ${w.line}`));
    m.forEach((w) => r4m.push(`row ${w.row} line ${w.line}`));
    x.d.forEach((w) => dAt.push(`row ${w.row} line ${w.line} char ${w.char}`));
    const okH = h.length === 1 && inHud(h[0].ma) && h[0].row === 0 && (h[0].line < 7 || (h[0].line === 7 && h[0].char < 1));
    const okD = ONE_SCREEN ? x.d.length === 0                       // MODEL_B (decision 76): one screen, main RAM's, no D to write
        : x.d.length === 1 && inHud(x.d[0].ma) && x.d[0].row === 0 && x.d[0].line === 7 && x.d[0].char >= 80;
    const okM = m.length === 1 && m[0].row === 0 && ((inHud(m[0].ma) && m[0].line === 7 && m[0].char >= 1) ||   // after H's end latched
        (m[0].ma >= 0x0800 && m[0].line < 7));                                                              // or M's, before its own
    // by the frame the beam is in: written in H, they are M's start (and must be M's); in M, H's (HUD_ROW's)
    const inH = x.start.filter((w) => inHud(w.ma)), inM = x.start.filter((w) => w.ma >= 0x0800);
    const hudHi = hudMa >> 8, hudLo = hudMa & 0xff;
    inM.forEach((w) => startAt.push(`HUD's R${w.reg}: row ${w.row} line ${w.line} char ${w.char}`));
    const okS = inH.length === 2 && inM.length === 2 && inM.every((w) => w.v === (w.reg === 12 ? hudHi : hudLo)) &&
        inM.every((w) => w.row === 0) && x.start.length === 4;
    if (!(okH && okD && okM && okS)) { bad++; if (badFields.length < 8) badFields.push({ field: i, r4: x.r4, d: x.d, start: x.start, pal: x.pal }); }
});
console.log(JSON.stringify({ disc, fields: fields.length, rupturedFields: ruptured, fieldsWithAWriteOutOfPlace: bad,
    r4HudFrame: hist(r4hud), dWritten: hist(dAt), r4ScreenFrame: hist(r4m), hudStartWritten: hist(startAt), paletteCycles: stat(fields.flatMap((x) => x.pal)),
    video: { instructionsWhileDisplaying: displayed, hudSamples, screenSamples, hudReadWithShadowD: hudWrongD, screenReadWithWrongD: screenWrongD },
    examples: badFields }));
process.exit(0);
