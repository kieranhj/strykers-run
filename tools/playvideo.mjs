// playvideo.mjs - one build playing the whole world, start to completion screen, as a 50 fps video
// with its sound: what the viewer sees, field by field.
//
//   node tools/playvideo.mjs DISC.ssd OUT.mp4 [--bot world|human] [--seed S] [--title T] [--scale 2]
//        [--no-run] [--after 250] [--max-fields 90000] [--ffmpeg PATH]
//
// The game is tools/playscript.mjs's startWorldGame (infinite lives poked in) and a bot: the WorldBot
// (run right, jump every 30 passes, a grenade and shots at what blocks; keepAlive in a GAMEPLAY_SHIELD
// build, so nobody dies or rewinds, and the run key held in a GAMEPLAY_RUN build, --no-run: not), or
// with --bot human tools/humanbot.mjs (it shoots, dodges and rushes; it dies and is rewound as the
// build's rules say; --seed its reaction times). The capture is tools/sidebyside.mjs's: after
// every field the displayed frame is cropped from jsbeeb's completed framebuffer, under a caption
// (pass, column, score, and the shield and time where the build has them), piped to ffmpeg as raw
// RGBA (H.264, yuv420p, 50 fps; --scale nearest-neighbour); the SN76489 as jsbeeb renders it,
// box-filtered to 50 kHz, mono. It runs from the game's first pass to --after fields past the
// completion screen (or --max-fields). Writes OUT.mp4 and OUT.json (passes, fields, columns).
// ffmpeg: --ffmpeg, else $FFMPEG, else the PATH, else Python's imageio-ffmpeg.
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadMachineSession, resolveJsbeebSrc } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, worldState, pressKeys } from "./playscript.mjs";
import { HumanBot, see } from "./humanbot.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const TITLE = opt("--title", "Stryker's Run (Enhanced), BBC Master");
const SCALE = parseInt(opt("--scale", "2"), 10), AFTER = parseInt(opt("--after", "250"), 10);
const BOT = opt("--bot", "world"), SEED = parseInt(opt("--seed", "1"), 10);
const MAX = parseInt(opt("--max-fields", "90000"), 10), FFMPEG_OPT = opt("--ffmpeg", null), NORUN = flag("--no-run");
const [disc, outPath] = args;
if (!outPath) { console.error("usage: node tools/playvideo.mjs DISC.ssd OUT.mp4 [--title T] [--scale K] [--no-run] [--after F] [--max-fields N]"); process.exit(2); }

const MachineSession = await loadMachineSession();
const sharp = createRequire(`${resolveJsbeebSrc().src}/machine-session.js`)("sharp");
function findFfmpeg() {
    if (FFMPEG_OPT) return FFMPEG_OPT;
    if (process.env.FFMPEG) return process.env.FFMPEG;
    const w = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
    if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0];
    const py = spawnSync("python", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" });
    if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
    throw new Error("no ffmpeg: pass --ffmpeg PATH, set FFMPEG, or pip install imageio-ffmpeg");
}

// the game: the bot's keys chosen at each pass's start
const human = BOT === "human";
const bot = human ? new HumanBot({ seed: SEED }) : new WorldBot();
let runKey = false;
const m = await startWorldGame(MachineSession, disc, {
    keepAlive: !human,
    onPass: (mm) => {
        if (mm.completed) return pressKeys(mm, []);
        const k = human ? bot.step(mm.passes, see(mm)) : bot.step(mm.passes, worldState(mm));
        if (runKey) k.push("RUN");
        pressKeys(mm, k);
    },
});
const { s, syms } = m;
runKey = !human && !NORUN && syms.run_state !== undefined;   // (the human bot chooses when to run)
m.target = Infinity;                    // startWorldGame stops at each target pass: here it runs on
m.held = [];                            // startWorldGame released every key after its first pass
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];

// sound: the SN76489 as jsbeeb renders it (500 kHz), box-filtered by 10 to 50 kHz
const AUDIO_RATE = 50000, DECIMATE = 10;
const audio = { data: new Float32Array(AUDIO_RATE * 60), n: 0, acc: 0, k: 0 };
{
    const chip = s._soundChip;
    const push = (v) => {
        audio.acc += v; if (++audio.k < DECIMATE) return;
        if (audio.n === audio.data.length) { const d = new Float32Array(audio.data.length * 2); d.set(audio.data); audio.data = d; }
        audio.data[audio.n++] = audio.acc / DECIMATE; audio.acc = 0; audio.k = 0;
    };
    chip.catchUp();
    let skip = chip.position;
    chip._onBuffer = (buf) => { for (let i = skip; i < buf.length; i++) push(buf[i]); skip = 0; };
    audio.finish = () => { chip.catchUp(); for (let i = skip; i < chip.position; i++) push(chip.buffer[i]); return audio.data.subarray(0, audio.n); };
}
function writeWav(path, mono) {
    let peak = 1e-9;
    for (const v of mono) peak = Math.max(peak, Math.abs(v));
    const gain = 0.9 / peak, n = mono.length, buf = Buffer.alloc(44 + n * 2);
    buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
    buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(AUDIO_RATE, 24); buf.writeUInt32LE(AUDIO_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i] * gain * 32767))), 44 + i * 2);
    writeFileSync(path, buf);
    return { samples: n, seconds: n / AUDIO_RATE };
}

// the frame: a caption band over the picture
const CROP = { x: 200, y: 112, w: 640, h: 400 }, BAND = 44, W = CROP.w, H = BAND + CROP.h;
const frame = Buffer.alloc(W * H * 4), BG = [24, 24, 24];
const captions = new Map();
async function caption(line) {
    let c = captions.get(line);
    if (c) return c;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND}">
<rect width="100%" height="100%" fill="rgb(${BG.join(",")})"/>
<text x="${W / 2}" y="19" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="bold" fill="#ffffff" text-anchor="middle">${TITLE}</text>
<text x="${W / 2}" y="38" font-family="Consolas, 'Courier New', monospace" font-size="14" fill="#c8c8c8" text-anchor="middle" xml:space="preserve">${line}</text>
</svg>`;
    c = await sharp(Buffer.from(svg)).flatten({ background: { r: BG[0], g: BG[1], b: BG[2] } }).ensureAlpha().raw().toBuffer();
    if (captions.size > 4000) captions.clear();
    captions.set(line, c);
    return c;
}
const bcd = (hi, lo) => (hi & 15) * 100 + (lo >> 4) * 10 + (lo & 15);
let lastLine = "", deaths = 0;
if (syms.kill_player !== undefined) m.cpu.debugInstruction.add((pc) => { if (pc === syms.kill_player) deaths++; return false; });
function line() {
    if (m.completed) return lastLine.replace(/   shield.*$/, "") + "   HEADQUARTERS";   // the completion screen reuses the score's bytes
    const view = rd(syms.viewport_left_low)[0] + 256 * rd(syms.viewport_left_high)[0];
    const score = rd(syms.game_over_text + 20, 6).map((b) => (b - 0x6c) / 6).join("");
    let t = `pass ${String(m.passes).padStart(5)}   column ${String(view).padStart(4)}   score ${score}`;
    if (syms.shield !== undefined) t += `   shield ${String(Math.round(rd(syms.shield)[0] * 2)).padStart(3)}%`;
    if (syms.timer_hi !== undefined && rd(syms.timer_mode)[0]) t += `   time ${bcd(rd(syms.timer_hi)[0], rd(syms.timer_lo)[0])} s`;
    if (human) t += `   deaths ${deaths}`;
    return (lastLine = t);
}

mkdirSync(dirname(outPath) || ".", { recursive: true });
const ffmpeg = findFfmpeg();
const videoTmp = outPath.replace(/\.mp4$/i, "") + ".video.mp4";
const vf = SCALE > 1 ? ["-vf", `scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`] : [];
let ffDone = false;
const ff = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", "50", "-i", "-",
    ...vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoTmp],
    { stdio: ["pipe", "inherit", "inherit"] });
ff.on("close", (code) => { if (!ffDone) { console.error(`ffmpeg exited (${code}) before the last frame`); process.exit(1); } });
ff.stdin.on("error", (e) => { console.error(`ffmpeg: ${e.message}`); process.exit(1); });
const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once("drain", res); });
for (let i = 0; i < W * H; i++) { frame[i * 4] = BG[0]; frame[i * 4 + 1] = BG[1]; frame[i * 4 + 2] = BG[2]; frame[i * 4 + 3] = 255; }

const t0 = Date.now();
let f = 0, endAt = null;
for (; f < MAX; f++) {
    let r = await s.runFrames(1);
    if (!r.completed) r = await s.runFrames(1);      // the completion screen's stop (startWorldGame's, once)
    if (m.completed && endAt === null) endAt = f + AFTER;
    const band = await caption(line());
    band.copy(frame, 0, 0, W * BAND * 4);
    const fb = s._completeFb8;
    for (let y = 0; y < CROP.h; y++) {
        const src = ((CROP.y + y) * 1024 + CROP.x) * 4;
        frame.set(fb.subarray(src, src + CROP.w * 4), (BAND + y) * W * 4);
        for (let x = 0; x < CROP.w; x++) frame[((BAND + y) * W + x) * 4 + 3] = 255;
    }
    await write(Buffer.from(frame));
    if ((f + 1) % 2500 === 0) console.log(`field ${f + 1}: pass ${m.passes}, ${line()}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (endAt !== null && f >= endAt) { f++; break; }
}
ffDone = true; ff.stdin.end(); await new Promise((res) => ff.on("close", res));
const wav = outPath.replace(/\.mp4$/i, "") + ".wav";
const sound = writeWav(wav, audio.finish());
const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", videoTmp, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
    "-movflags", "+faststart", outPath], { stdio: "inherit" });
if (r.status !== 0) throw new Error("ffmpeg mux failed");
unlinkSync(videoTmp); unlinkSync(wav);
const summary = { disc, bot: BOT, seed: human ? SEED : undefined, deaths: human ? deaths : undefined, fields: f, seconds: +(f / 50).toFixed(1), passes: m.passes, completed: m.completed, runKey, sound, video: { path: outPath, width: W * SCALE, height: H * SCALE, fps: 50 } };
writeFileSync(outPath.replace(/\.mp4$/i, "") + ".json", JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
