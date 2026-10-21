// credits.mjs - the title's credit line (decision 60) checked field by field: row 24 (&7C00-&7E7F)
// read after every field on the menu, and matched against both lines drawn at every shift (0-6
// pixels left in each glyph's cell) from the build's own title font (bank 5's
// title_screen_font_data), rendered here independently of credits.6502. Reports the runs of states:
// each line held ~5 s (250 fields), the change a step every 2 fields, out k = 1 .. 6 and in k = 5 .. 0,
// and any field that matches no state.
//
//   node tools/credits.mjs DISC.ssd [FIELDS]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, loadSyms, BOOT_FRAMES, KEY } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, N = "900"] = process.argv.slice(2);
const syms = loadSyms(disc);
const s = await bootMaster(MachineSession, disc);
await s.runFrames(BOOT_FRAMES); s.keyUpRaw(KEY.SHIFT);
await s.runFrames(2100);
const rd = (a, n) => [...s.readMemory(a, n, { shadow: false })];
const font = rd(syms.title_screen_font_data, 6 * 0x30);
const LINES = [
    { name: "(c) SUPERIOR SOFTWARE 1986", at: 32, text: [0x26, 0x25, 0x1c, 0x1e, 0x19, 0x0e, 0x1b, 0x12, 0x18, 0x1b, 0x25, 0x1c, 0x18, 0x0f, 0x1d, 0x20, 0x0a, 0x1b, 0x0e, 0x25, 0x01, 0x09, 0x08, 0x06] },
    { name: "REDUX BY BITSHIFTERS 2026", at: 16, text: [0x1b, 0x0e, 0x0d, 0x1e, 0x21, 0x25, 0x0b, 0x22, 0x25, 0x0b, 0x12, 0x1d, 0x1c, 0x11, 0x12, 0x0f, 0x1d, 0x0e, 0x1b, 0x1c, 0x25, 0x02, 0x00, 0x02, 0x06] },
];
const COLOUR = 0x3e, L = COLOUR & 0xaa, R = COLOUR & 0x55;
function render(line, k) {          // the row as the line shifted k pixels left in each cell
    const row = new Array(640).fill(0);
    line.text.forEach((ch, g) => {
        for (let j = 0; j < 3; j++) {
            const cl = 2 * j + k, cr = cl + 1;
            const fl = cl < 6 ? font[6 * ch + cl] : 0, fr = cr < 6 ? font[6 * ch + cr] : 0;
            for (let y = 0; y < 8; y++) row[line.at + 24 * g + 8 * j + y] = (fl >> y & 1 ? L : 0) | (fr >> y & 1 ? R : 0);
        }
    });
    return row.join(",");
}
const states = new Map();
for (let w = 0; w < 2; w++) for (let k = 0; k <= 6; k++) { const key = render(LINES[w], k); if (!states.has(key)) states.set(key, k === 6 ? "blank" : `${w ? "REDUX" : "(c)"} k${k}`); }
const runs = [];
let unknown = 0;
for (let f = 1; f <= +N; f++) {
    await s.runFrames(1);
    const st = states.get(rd(0x7c00, 640).join(",")) ?? "?";
    if (st === "?") unknown++;
    if (runs.length && runs.at(-1).st === st) runs.at(-1).n++; else runs.push({ st, from: f, n: 1 });
}
console.log(`${disc}: ${N} fields on the menu; ${unknown} fields matching no state`);
console.log(runs.map((r) => `${r.st} x${r.n}`).join(" | "));
