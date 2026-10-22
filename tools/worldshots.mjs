// worldshots.mjs DISC OUTDIR COLUMN [COLUMN ...]: the real screen at chosen places in the world,
// for checking tools/worldmap.py against the emulator. Boots DISC on a Master, sets the game's
// observer mode (the C+H+R+I+S cheat: `observer_mode` non-zero) on the title, starts a game and
// holds the cursor RIGHT key, which in observer mode scrolls the world a column a loop with no
// player and no logic (so the run never stalls, as play holding RIGHT does at column 3,319).
// At each COLUMN (the viewport's left edge, ascending) it lets go, waits for the screens to
// settle and writes OUTDIR/shot-<left>.png (screenshotActive, scale 1) and OUTDIR/shot-<left>.json
// (the viewport, the CRTC start, the movers' slots). The movers in observer mode are the ones the
// triggers made, drawn where they started: nothing moves them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, KEY, START_AT } from "./playscript.mjs";

const [disc, outdir, ...cols] = process.argv.slice(2);
if (!disc || !outdir || !cols.length) {
    console.error("usage: node tools/worldshots.mjs DISC OUTDIR COLUMN [COLUMN ...]");
    process.exit(2);
}
const targets = cols.map(Number).sort((a, b) => a - b);
mkdirSync(outdir, { recursive: true });
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] ??= v.value;

const MachineSession = await loadMachineSession();
const s = await bootMaster(MachineSession, disc);
const rd = (a, n = 1) => s.readMemory(a, n, { shadow: false });
const view = () => rd(0xb2)[0] + 256 * rd(0xba)[0];
let f = 0;
const frames = async (n) => { for (let i = 0; i < n; i++, f++) await s.runFrames(1); };
await frames(50);
s.keyUpRaw(KEY.BOOT_SHIFT);
await frames(START_AT - 50);
// Observer mode reads its keys with check_for_keypress, which enters keydown_int + 1 past a TXA
// that grind G0038 (d96cb3f) removed: it now asks the matrix about X (the INKEY number) with Y
// unset, so no key works. Mend it in the emulated RAM only (TXA EOR #&FF TAX JSR keydown_int
// EOR #&80 RTS, the same 10 bytes) unless the build has been fixed.
{
    const kd = syms.keydown_int, at = syms.check_for_keypress;
    const fix = [0x8a, 0x49, 0xff, 0xaa, 0x20, kd & 0xff, kd >> 8, 0x49, 0x80, 0x60];
    const cur = rd(at, 10);
    const broken = cur[3] === 0x20 && (cur[4] | cur[5] << 8) === kd + 1;
    if (broken) { s.writeMemory(at, fix, { shadow: false }); console.log("check_for_keypress mended in RAM (enters keydown_int + 1)"); }
}
// observer mode, then 1 (on the options page) until the game has scrolled into the world
let started = false;
for (let k = 0; k < 12 && !started; k++) {
    s.writeMemory(syms.observer_mode, [1], { shadow: false });
    s.keyDownRaw(KEY.ONE); await frames(40); s.keyUpRaw(KEY.ONE);
    for (let i = 0; i < 260 && !started; i++) {
        await frames(1);
        started = view() === 0 && s._machine.processor.pc >= syms.observer_mode_loop && s._machine.processor.pc < syms.observer_mode;
    }
}
if (!started) { console.error("observer mode never started"); process.exit(1); }
await frames(20);
console.log(`observer mode at frame ${f}, view at ${view()}`);
const hexs = (a) => a.map((v) => v.toString(16).padStart(2, "0")).join("");
for (const t of targets) {
    if (view() < t) {
        s.keyDownRaw(KEY.RIGHT);
        while (view() < t) await frames(1);
        s.keyUpRaw(KEY.RIGHT);
    }
    await frames(12);                       // both screens drawn at the last column, the flip done
    const left = view();
    const movers = [];
    for (let slot = 0; slot < 0x22; slot++) {
        const xh = rd(syms.movers_x_high + slot)[0];
        if (xh & 0x80) continue;
        movers.push({ slot, type: rd(syms.movers_type_and_colour + slot)[0], x: rd(syms.movers_x_low + slot)[0] + 256 * xh,
                      y: rd(syms.movers_y + slot)[0], frame: rd(syms.movers_frame_and_flip + slot)[0] });
    }
    const info = { left, frame: f, crtc: (rd(0xb0)[0] << 8) | rd(0xb1)[0], screen_start: rd(0)[0] | rd(1)[0] << 8,
                   trigger_offset: rd(0x7e)[0], zp_0000: hexs(rd(0, 0x20)), mos_e000: hexs(rd(0xe000, 256)), movers };
    writeFileSync(`${outdir}/shot-${left}.png`, await s.screenshotActive({ scale: 1 }));
    writeFileSync(`${outdir}/shot-${left}.json`, JSON.stringify(info, null, 1));
    console.log(`column ${t}: view at ${left} (frame ${f}), ${movers.length} movers`);
}
