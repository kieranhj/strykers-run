// menutest.mjs - the release disc (tools/releasedisc.py, docs/briefs/release-disc.md) booted on a Master:
//   menu     after the autoboot, MSCREEN's picture (screen rows 11-29, byte columns 24-62) byte for
//            byte the one releasedisc.py drew (its --screen), the palette shown
//   choice   for 1 and 2: the key, then the game that directory holds: the first 2K of the game's
//            code (&0E00 on, where MGAME's copy-down stub puts it) equal to that directory's MGAME's
//            first 2K, and the title running (its scroll text moving the screen)
//
//   node tools/menutest.mjs RELEASE.ssd [SHOTS_DIR] [--patched O.symbols.json R.symbols.json] [--machine NAME]
//
// The menu's machine label (releasedisc.py --machine) byte for byte too: NAME, else "Master" on a Master and
// "Model B" on any other model.
//
// BEEB_MODEL boots another jsbeeb model (B-DFS1.2 for the Model B's release disc), as every harness.
// --patched: a Model B build's start-up patches its own code and data (bank_patch, decision 74: the
// .bks_* bank selects' immediates, scenery_layer_sprite_banks' 8 bytes), and those bytes are excused,
// named by each directory's build's symbol dump.
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";

const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const patchedAt = args.indexOf("--patched");
const patchSyms = patchedAt < 0 ? [] : args.splice(patchedAt, 3).slice(1);
const [disc, shots] = args;
if (!disc) throw new Error("usage: node tools/menutest.mjs RELEASE.ssd [SHOTS_DIR] [--patched O.symbols.json R.symbols.json]");
const MODEL = process.env.BEEB_MODEL || "Master";
const machineAt = args.indexOf("--machine");
const MACHINE = machineAt < 0 ? (MODEL.startsWith("Master") ? "Master" : "Model B") : args.splice(machineAt, 2)[1];
const MAIN = MODEL.startsWith("Master") ? { shadow: false } : {};    // main RAM (only a Master has shadow to choose from)
function patched(symsFile) {                    // the addresses bank_patch writes: each bks_ site's immediate, the layers' banks
    const out = new Set();
    if (!symsFile) return out;
    for (const sec of JSON.parse(readFileSync(symsFile, "utf8")).assemblies[0].sections)
        for (const [k, v] of Object.entries(sec.labels || {})) {
            if (!v || typeof v.value !== "number") continue;
            if (/^bks_/.test(k)) out.add(v.value + 1);
            if (k === "scenery_layer_sprite_banks") for (let i = 0; i < 8; i++) out.add(v.value + i);
        }
    return out;
}
const excused = { O: patched(patchSyms[0]), R: patched(patchSyms[1]) };
if (shots) mkdirSync(shots, { recursive: true });

function file(dir, name) {                       // a file as the game sees it: unpacked on a packed disc (tools/dfs.py game_files)
    return Buffer.from(execFileSync("python", ["tools/dfs.py", "file", disc, `${dir}.${name}`], { maxBuffer: 1 << 20 }).toString().trim(), "hex");
}

// what MSCREEN should draw: releasedisc.py's own picture of it
const want = (() => {
    const tmp = resolve("build", "menutest-screen.bin");
    execFileSync("python", ["-c", `import sys; sys.path.insert(0, "tools"); import releasedisc as r; from pathlib import Path; ` +
        `Path(r"${tmp.replace(/\\/g, "/")}").write_bytes(r.screen_of(r.mscreen((r.ROOT / "src" / "mscreen.bin").read_bytes())))`]);
    return readFileSync(tmp);
})();

// the machine's label: releasedisc.py's bytes for it, {address: byte}
const label = JSON.parse(execFileSync("python", ["-c", `import sys, json; sys.path.insert(0, "tools"); import releasedisc as r; ` +
    `print(json.dumps(r.label_bytes(sys.argv[1])))`, MACHINE]).toString());

const fails = [];
async function boot() {
    const s = new MachineSession(MODEL);
    await s.initialise();
    await s.boot();
    await s.bootDisc("file:///" + resolve(disc).split("\\").join("/"));
    await s.runFrames(400);
    return s;
}

for (const key of ["1", "2"]) {
    const s = await boot();
    if (key === "1") {
        const scr = s.readMemory(0x3000, 0x5000, MAIN);
        let bad = 0;
        for (let r = 11; r <= 29; r++) for (let c = 24; c < 63; c++) for (let l = 0; l < 8; l++) {
            const o = r * 640 + c * 8 + l;
            if (scr[o] !== want[o]) bad++;
        }
        console.log(`menu: MSCREEN's picture, ${bad} of 5,928 bytes differing`);
        if (bad) fails.push(`menu: ${bad} bytes of the picture differ`);
        const lab = Object.entries(label), badLab = lab.filter(([a, v]) => scr[+a - 0x3000] !== v).length;
        console.log(`menu: the label "${MACHINE}", ${badLab} of ${lab.length} bytes differing`);
        if (badLab) fails.push(`menu: ${badLab} bytes of the label "${MACHINE}" differ`);
        if (shots) writeFileSync(`${shots}/menu.png`, await s.screenshotActive());
    }
    s.keyDown("Digit" + key); await s.runFrames(5); s.keyUp("Digit" + key);
    await s.runFrames(2600);
    const dir = key === "1" ? "O" : "R";
    const mgame = file(dir, "MGAME"), mem = s.readMemory(0x0e00, 0x800, MAIN);
    let same = 0;
    for (let i = 0; i < 0x800; i++) if (mem[i] === mgame[i] || excused[dir].has(0xe00 + i)) same++;
    // the title: its scroll text moves, so two frames apart the screen differs
    const a = s.readMemory(0x3000, 0x5000, MAIN); await s.runFrames(10);
    const b = s.readMemory(0x3000, 0x5000, MAIN);
    let moved = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) moved++;
    console.log(`choice ${key}: the game in memory against ${dir}.MGAME: ${same} of 2,048 bytes equal; the title's screen moving (${moved} bytes in 10 frames)`);
    const diff = []; for (let i = 0; i < 0x800 && diff.length < 16; i++) if (mem[i] !== mgame[i] && !excused[dir].has(0xe00 + i)) diff.push(`&${(0xe00 + i).toString(16)}:${mgame[i].toString(16)}->${mem[i].toString(16)}`);
    if (same !== 0x800) fails.push(`choice ${key}: ${0x800 - same} bytes of the game differ from ${dir}.MGAME (${diff.join(" ")})`);
    if (!moved) fails.push(`choice ${key}: the screen is still (no title?)`);
    if (shots) writeFileSync(`${shots}/choice${key}.png`, await s.screenshotActive());
    s.destroy();
}
console.log(fails.length ? "FAILED:\n  " + fails.join("\n  ") : "all checks held");
process.exit(fails.length ? 1 : 0);
