// rupture.mjs - where HUD_RUPTURE's CRTC writes land, field by field, in the running build (decision 67).
//
//   node tools/rupture.mjs DISC.ssd [FROM_FRAME] [FRAMES]
//
// Plays tools/playscript.mjs (seed 1) to FROM_FRAME (default 2600, in play), then for FRAMES frames
// (default 1000) measures the cycles from the System VIA CA1 (vsync) flag rising to each write the
// interrupt makes to the CRTC's R4 (vertical total: 0 in the HUD's row, &25 in M's first) and to the
// palette (&FE21, row 111's). The HUD row is the displayed area's first character row; its window is
// worked out from the row-111 palette write as tools/split.mjs measures it (128 cycles a scanline at
// 2 MHz): each R4 write must land inside its row - 0 in the HUD row, &25 in the next - or the frame
// breaks. Prints each write's spread and the fields with a write outside its row or missing.
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
const cpu = s._machine.processor;
const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
let prev = 0, rise = null, reg = -1, field = null;
const fields = [];
cpu.debugInstruction.add(() => {
    cpu.sysvia._catchUp();
    const f = cpu.sysvia.ifr & 2;
    if (f && !prev) { if (field) fields.push(field); rise = cyc(); field = { r4: [], pal: [] }; }
    prev = f;
    return false;
});
cpu.debugWrite.add((addr, v) => {
    if (addr === 0xfe00) reg = v & 0x1f;
    else if (addr === 0xfe01 && reg === 4 && field) field.r4.push([cyc() - rise, v]);
    else if (addr === 0xfe21 && field && cyc() - rise > 5000) field.pal.push(cyc() - rise);
    return false;
});
for (let f = FROM + 1; f <= FROM + N; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
const stat = (a) => a.length ? { n: a.length, min: Math.min(...a), max: Math.max(...a) } : { n: 0 };
const pal = fields.flatMap((x) => x.pal), e1 = [], e2 = [];
for (const x of fields) for (const [t, v] of x.r4) (v === 0 ? e1 : e2).push(t);
// the HUD row from the palette's row 111: row 0 starts 111 * 8 scanlines before it
const palMode = pal.slice().sort((a, b) => a - b)[Math.floor(pal.length / 2)];
const row0 = palMode - 111 * 128, hud = [row0, row0 + 8 * 128], m0 = [row0 + 8 * 128, row0 + 16 * 128];
// a field is the rupture's when it has its R4 writes (0 or &25); rupture_off's &26 and the title's
// fields (none) are counted apart
let bad = 0, on = 0, offFields = 0;
const badFields = [];
fields.forEach((x, i) => {
    const mine = x.r4.filter(([, v]) => v === 0 || v === 0x25);
    if (!mine.length) { offFields++; return; }
    on++;
    const a = mine.filter(([, v]) => v === 0).map(([t]) => t), b = mine.filter(([, v]) => v === 0x25).map(([t]) => t);
    const ok = a.length === 1 && b.length === 1 && a[0] >= hud[0] && a[0] < hud[1] && b[0] >= m0[0] && b[0] < m0[1];
    if (!ok) { bad++; if (badFields.length < 10) badFields.push({ field: i, r4: x.r4, pal: x.pal, before: fields[i - 1]?.r4, after: fields[i + 1]?.r4 }); }
});
console.log(JSON.stringify({ disc, fields: fields.length, rupturedFields: on, otherFields: offFields, hudRow: hud, firstRowOfM: m0,
    r4HudRow: stat(e1), r4FirstRowOfM: stat(e2), palette: stat(pal), rupturedFieldsOutsideTheirRows: bad, examples: badFields }));
