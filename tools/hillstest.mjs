// hillstest.mjs - DITHER_HILLS's mountain sprites (decisions 70, 71) on a gameplay disc:
//   unpacked  at the first pass, bank 5 from hills_unpacked holds the four dithered sprites (each
//             mountain, and its mirrored copy for the flipped draws) byte for byte as
//             tools/ditherhills.py makes them (from build/strykers.ssd, the build without the flag),
//             and ANDY holds its sprites as the disc carries them (the copy done before the unpack)
//   drawn     HAZEL &C300-&C6FF filled 0, 2, 1, 3 (the mountain layer's bytes, BUGS #9: TWO, TWO
//             flipped, ONE flipped, ONE), RIGHT held: the shown screen saved (SHOTS_DIR) to look at
//
//   node tools/hillstest.mjs DISC [SHOTS_DIR] [PASSES]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { startWorldGame, toWorldPass, pressKeys } from "./playscript.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";

const MachineSession = await loadMachineSession();
const [disc, shots, passes = "300"] = process.argv.slice(2);
if (!disc) throw new Error("usage: node tools/hillstest.mjs DISC [SHOTS_DIR] [PASSES]");
const img = readFileSync(disc);
function file(name) {                           // a file from the disc's catalogue
    const n = img[256 + 5] / 8;
    for (let i = 0; i < n; i++) {
        if (img.subarray(8 + 8 * i, 15 + 8 * i).toString("latin1").trimEnd() !== name) continue;
        const e = img.subarray(256 + 8 + 8 * i, 256 + 16 + 8 * i);
        const len = e[4] | e[5] << 8 | ((e[6] >> 4) & 3) << 16, st = e[7] | (e[6] & 3) << 8;
        return { load: e[0] | e[1] << 8, data: img.subarray(st * 256, st * 256 + len) };
    }
    throw new Error(`${disc}: no ${name}`);
}

const fails = [];
const m = await startWorldGame(MachineSession, disc);
const { s, syms } = m;
for (const k of ["andy_load", "andy_end", "hills_unpacked", "hills_unpacked_size", "DATA2_ORG"])
    if (syms[k] === undefined) throw new Error(`${disc}: no ${k} (not a DITHER_HILLS build?)`);

// the dithered sprites, as the generator makes them
const want = Buffer.from(execFileSync("python", ["-c",
    "import sys; sys.path.insert(0, 'tools'); import ditherhills as d; " +
    "print(d.unpacked('build/strykers.ssd').hex())"]).toString().trim(), "hex");
const got = Buffer.from(s.readMemory(syms.hills_unpacked, syms.hills_unpacked_size, { bank: 5 }));
let bad = 0;
for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) bad++;
console.log(`unpacked: bank 5 &${syms.hills_unpacked.toString(16)}, ${want.length - bad} of ${want.length} bytes the dithered sprites` +
    (want.length === syms.hills_unpacked_size ? "" : ` (the build says ${syms.hills_unpacked_size})`));
if (bad || want.length !== syms.hills_unpacked_size) fails.push(`unpacked: ${bad} bytes differ`);

// ANDY: its sprites as DATA2 carries them
const d2 = file("DATA2"), off = syms.andy_load - syms.DATA2_ORG, n = syms.andy_end - 0x8000;
const romsel = m.cpu.romsel;                    // ANDY paged in at &8000 (ROMSEL bit 7)
m.cpu.romSelect(0x84);
const andy = s.readMemory(0x8000, n);
m.cpu.romSelect(romsel);
const carried = d2.data.subarray(off, off + n);
let abad = 0;
for (let i = 0; i < n; i++) if (andy[i] !== carried[i]) abad++;
console.log(`ANDY: ${n - abad} of ${n} bytes as DATA2 carries them`);
if (abad) fails.push(`ANDY: ${abad} bytes differ`);

// drawn: HAZEL's mountain bytes made to pick both sprites, both ways round
const pattern = Array.from({ length: 0x400 }, (_, i) => [0, 2, 1, 3][i & 3]);
const cpu = m.cpu, acccon = cpu.acccon;
cpu.writeAcccon(acccon | 8); s.writeMemory(0xc300, pattern); cpu.writeAcccon(acccon);
pressKeys(m, ["RIGHT"]);
const r = await toWorldPass(m, +passes);
console.log(`drawn: RIGHT held to pass ${m.passes} (${r})`);
if (shots) {
    mkdirSync(shots, { recursive: true });
    writeFileSync(`${shots}/hills-both.png`, await s.screenshotActive());
    console.log(`  ${shots}/hills-both.png`);
}
s.destroy();
console.log(fails.length ? "FAILED:\n  " + fails.join("\n  ") : "all checks held");
process.exit(fails.length ? 1 : 0);
