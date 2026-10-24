// menutest.mjs - the release disc (tools/releasedisc.py, docs/briefs/release-disc.md) booted on a Master:
//   menu     after the autoboot, MSCREEN's picture (screen rows 11-29, byte columns 24-62) byte for
//            byte the one releasedisc.py drew (its --screen), the palette shown
//   choice   for 1 and 2: the key, then the game that directory holds: the first 2K of the game's
//            code (&0E00 on, where MGAME's copy-down stub puts it) equal to that directory's MGAME's
//            first 2K, and the title running (its scroll text moving the screen)
//
//   node tools/menutest.mjs RELEASE.ssd [SHOTS_DIR]
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";

const MachineSession = await loadMachineSession();
const [disc, shots] = process.argv.slice(2);
if (!disc) throw new Error("usage: node tools/menutest.mjs RELEASE.ssd [SHOTS_DIR]");
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

const fails = [];
async function boot() {
    const s = new MachineSession("Master");
    await s.initialise();
    await s.boot();
    await s.bootDisc("file:///" + resolve(disc).split("\\").join("/"));
    await s.runFrames(400);
    return s;
}

for (const key of ["1", "2"]) {
    const s = await boot();
    if (key === "1") {
        const scr = s.readMemory(0x3000, 0x5000, { shadow: false });
        let bad = 0;
        for (let r = 11; r <= 29; r++) for (let c = 24; c < 63; c++) for (let l = 0; l < 8; l++) {
            const o = r * 640 + c * 8 + l;
            if (scr[o] !== want[o]) bad++;
        }
        console.log(`menu: MSCREEN's picture, ${bad} of 5,928 bytes differing`);
        if (bad) fails.push(`menu: ${bad} bytes of the picture differ`);
        if (shots) writeFileSync(`${shots}/menu.png`, await s.screenshotActive());
    }
    s.keyDown("Digit" + key); await s.runFrames(5); s.keyUp("Digit" + key);
    await s.runFrames(2600);
    const dir = key === "1" ? "O" : "R";
    const mgame = file(dir, "MGAME"), mem = s.readMemory(0x0e00, 0x800, { shadow: false });
    let same = 0;
    for (let i = 0; i < 0x800; i++) if (mem[i] === mgame[i]) same++;
    // the title: its scroll text moves, so two frames apart the screen differs
    const a = s.readMemory(0x3000, 0x5000, { shadow: false }); await s.runFrames(10);
    const b = s.readMemory(0x3000, 0x5000, { shadow: false });
    let moved = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) moved++;
    console.log(`choice ${key}: the game in memory against ${dir}.MGAME: ${same} of 2,048 bytes equal; the title's screen moving (${moved} bytes in 10 frames)`);
    if (same !== 0x800) fails.push(`choice ${key}: ${0x800 - same} bytes of the game differ from ${dir}.MGAME`);
    if (!moved) fails.push(`choice ${key}: the screen is still (no title?)`);
    if (shots) writeFileSync(`${shots}/choice${key}.png`, await s.screenshotActive());
    s.destroy();
}
console.log(fails.length ? "FAILED:\n  " + fails.join("\n  ") : "all checks held");
process.exit(fails.length ? 1 : 0);
