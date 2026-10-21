// scrolltext.mjs - the title's scroll text (decision 57): the row (&7480-&76FF, character row 21)
// read every field on the title screen, and judged: each change a one-pixel shift left (every byte the
// next pixel along: its right pixel as its left, the next byte's left as its right; column 79's right
// pixel new), one every 2 fields; the MOS's clock (TIME, 100 Hz) 2 ticks a field, none lost to the
// vsync handler. Also prints the original's pattern for a build without scroll_pixel (2 pixels a
// change, every 4 fields).
//
//   node tools/scrolltext.mjs DISC.ssd [FIELDS]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, loadSyms, BOOT_FRAMES, KEY } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, N = "400"] = process.argv.slice(2);
const syms = loadSyms(disc);
const s = await bootMaster(MachineSession, disc);
await s.runFrames(BOOT_FRAMES); s.keyUpRaw(KEY.SHIFT);
await s.runFrames(2100);
const row = () => [...s.readMemory(0x7480, 640, { shadow: false })];
const time = () => { const t = [...s.readMemory(0x292, 5, { shadow: false })], u = [...s.readMemory(0x297, 5, { shadow: false })];
    const v = (a) => a.reduce((x, b) => x * 256 + b, 0); return Math.max(v(t), v(u)); };   // TIME: two copies, big-endian
const L = (b) => (b & 0x55) << 1, R = (b) => (b & 0xaa) >> 1;
let prev = row(), gaps = [], last = 0, kinds = { pixel: 0, byte: 0, other: 0 }, f;
const t0 = time();
for (f = 1; f <= +N; f++) {
    await s.runFrames(1);
    const r = row();
    if (r.every((b, i) => b === prev[i])) continue;
    gaps.push(f - last); last = f;
    let pixel = true, byte = true;
    for (let c = 0; c < 80; c++) for (let y = 0; y < 8; y++) {
        const i = c * 8 + y, want = c < 79 ? (L(prev[i]) | R(prev[i + 8])) : L(prev[i]);
        if ((c < 79 ? r[i] : r[i] & 0xaa) !== want) pixel = false;
        if (c < 79 && r[i] !== prev[i + 8]) byte = false;
    }
    kinds[pixel ? "pixel" : byte ? "byte" : "other"]++;
    prev = r;
}
const ticks = time() - t0, g = {};
for (const x of gaps.slice(1)) g[x] = (g[x] || 0) + 1;
console.log(`${disc}: ${N} fields on the title: ${gaps.length} changes (${JSON.stringify(kinds)}), fields between them ${JSON.stringify(g)}; TIME ${ticks} ticks (${(ticks / N).toFixed(2)} a field)`);
