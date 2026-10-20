// sidebyside.mjs - the original and the optimised build playing the same game, side by side, as
// a 50 fps video: what the viewer sees on each machine, field by field, for FIELDS fields.
//
//   node tools/sidebyside.mjs ORIGINAL.ssd STEP2.ssd OUT.mp4 [--fields 3000] [--seed 1]
//        [--scale 1] [--no-sound] [--no-video] [--ffmpeg PATH]
//
// ORIGINAL is step1-byte-identical-rebuild's build (`make original`: build/strykers-original.ssd, with its
// symbols copied beside it as build/strykers-original.symbols.json), STEP2 the shipping build.
// Each boots on its own Master and starts a game with tools/playscript.mjs's title presses. From
// the first pass (main_game_loop) on, keys change BY PASS, from tools/passlock.mjs's generator
// with SEED: the slower original gets the same keys on the same pass, so the two play the same
// game and the faster one gets further in the same time.
//
// The one thing that stops the original replaying by pass is its random numbers: four sites read
// User VIA T2 (decision 17), which follows time, not passes. Step 2 replaced those reads with
// `random`, a xorshift seeded &7A31 at the game's start. On the original the LDA &FE68/&FE69 at
// each site still runs (same cycles, same timer read); the emulator then puts the same xorshift's
// next byte in A before the AND that follows it uses it. Nothing in the original's RAM is written.
// The original's generator is seeded &7A31 at start_game, which step 2's take_irq_for_play
// enters after seeding. Before BUGS #12's fix step 2's state was &92/&93, which the original's
// code also writes as scratch (set_dying_mover_type_and_frame), so in such a build those writes
// change the generator: for it, the original's writes there are mirrored into it (a build after
// the fix keeps the state elsewhere, and nothing is mirrored). The bytes each consumed are compared below
// (the step 2 count ignores the loader's code that runs through `random`'s RTS while booting).
// The other T2 reads (raster positions: update_screen, check_if_raster_is_in_mover) are untouched.
//
// Both machines' game state (passlock.mjs's: the mover and projectile tables, score, fuel, the
// zero-page game variables but the PRNG's) is recorded at the start of every pass and compared
// for the passes both reached; and the random bytes each consumed are compared in order.
//
// Capture: after every field (runFrames(1) stops on the paint) the displayed frame is cropped from
// jsbeeb's completed framebuffer (what screenshotActive takes: the screen the CRTC showed, main or
// shadow, flicker and all), the two put side by side under a caption (the build, its pass count,
// the view's left column and lives, as of its latest pass start), and piped to ffmpeg as raw RGBA:
// H.264, yuv420p, 50 fps. The MODE 2 picture is 640x400 in jsbeeb's framebuffer (4x2 per pixel):
// --scale multiplies that, nearest-neighbour. Sound: each machine's SN76489 as jsbeeb renders it
// (500 kHz, box-filtered to 50 kHz), original left, step 2 right, normalised together; --no-sound
// for silence. Writes OUT.mp4 and OUT.json (the passes, columns and the comparison).
// ffmpeg: --ffmpeg, else $FFMPEG, else the PATH, else Python's imageio-ffmpeg.
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadMachineSession, resolveJsbeebSrc } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey, moverTables, loadSyms, prngAt } from "./playscript.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const FIELDS = parseInt(opt("--fields", "3000"), 10), SEED = parseInt(opt("--seed", "1"), 10);
const SCALE = parseInt(opt("--scale", "1"), 10);
const FFMPEG_OPT = opt("--ffmpeg", null);
const SOUND = !flag("--no-sound"), VIDEO = !flag("--no-video");
const [discA, discB, outPath] = args;
if (!outPath) { console.error("usage: node tools/sidebyside.mjs ORIGINAL.ssd STEP2.ssd OUT.mp4 [--fields N] [--seed S] [--scale K] [--no-sound] [--no-video] [--ffmpeg PATH]"); process.exit(2); }

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

// tools/passlock.mjs's per-pass keys
function passKeys(n) {
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
const keysAt = passKeys(FIELDS + 10);     // at most a pass a field

// step 2's `random` (src/game.6502), bit for bit: xorshift (7, 9, 8) on rnd_seed_high/low
function xorshift(state = 0x7a31) {
    let hi = state >> 8, lo = state & 0xff;
    const next = () => {
        let c = hi & 1;
        let a = (c << 7) | (lo >> 1); c = lo & 1;     // LDA lo : ROR A
        a ^= hi; hi = a;                              // EOR hi : STA hi
        const c2 = a & 1; a = (c << 7) | (a >> 1); c = c2; // ROR A
        a ^= lo; lo = a;                              // EOR lo : STA lo
        a ^= hi; hi = a;                              // EOR hi : STA hi
        return a;
    };
    next.set = (a, v) => { if (a === 0x92) lo = v; else hi = v; };
    next.seed = () => { hi = 0x7a; lo = 0x31; };
    return next;
}

// zero-page game state that lives from pass to pass (passlock.mjs's list, less the PRNG's state,
// which the original does not have: the random bytes are compared as a sequence instead)
const ZP = {
    screen_start: [0x00, 0x01], trigger_offset: [0x7e], new_movers_offset: [0x7f], helicopter_to_update: [0x80],
    player_y_velocity: [0x82], player_jump_direction: [0x83], player_helicopter: [0x84],
    player_firing_cooldown: [0x8e], player_helicopter_explosion: [0x8f],
    bottom_palette: [0x94], lives: [0x95], helicopter_fuel: [0x97, 0x98], top_palette: [0x9f], firing_frame: [0xa0],
    crtc_start: [0xb0, 0xb1], viewport_left: [0xb2, 0xba], viewport_right: [0xb3, 0xbb], movers_to_update_base: [0xc0],
};
function state(m) {
    const { s, syms } = m;
    const rd = (a, n) => [...s.readMemory(a, n, { shadow: false })];
    const out = {};
    out.movers = rd(...moverTables(syms));
    out.score = rd(syms.game_over_text + 20, 6);
    out.fuel = rd(syms.movers_helicopter_fuel_high ?? 0x0960, 0x22);
    for (const [k, addrs] of Object.entries(ZP)) out[k] = addrs.map((a) => rd(a, 1)[0]);
    if (out.player_helicopter[0] === 0) out.helicopter_fuel = [0, 0];   // the title tune's pointer until then
    return out;
}

// where the step 2 build keeps its generator: &92/&93 before BUGS #12's fix
const STEP2_AT_92 = prngAt(loadSyms(discB))[0] === 0x92;

// the original's four random reads (build/original/build/strykers.lst): LDA usrvia_t2cl/t2ch,
// each followed by the AND that uses it
const ORIGINAL_SITES = [
    [0x2383, [0xad, 0x68, 0xfe], 0x29],    // add_enemy_helicopters: the helicopter's height (AND #&1F)
    [0x3119, [0xad, 0x69, 0xfe], 0x29],    // the soldier's crouch (AND #&0F)
    [0x3169, [0xad, 0x69, 0xfe], 0x29],    // animate_stationery_mover (AND #&20)
    [0x3276, [0xad, 0x68, 0xfe], 0x25],    // rnd_skewed_towards_right_of_world (AND &CE)
];

const CROP = { x: 200, y: 112, w: 640, h: 400 };   // the MODE 2 picture in jsbeeb's 1024x625 framebuffer

async function start(disc, label) {
    const syms = loadSyms(disc);
    const original = syms.random === undefined;
    const s = await bootMaster(MachineSession, disc);
    const cpu = s._machine.processor;
    const m = { s, cpu, syms, disc, label, original, passes: 0, target: 1, lastStop: -1, states: [], rnd: [], rndAt: [],
                held: [], view: 0, lives: 0, pending: -1, audio: null, live: false, seedWrites: {} };
    const next = xorshift();
    const sites = new Map(ORIGINAL_SITES.map(([a]) => [a, a + 3]));
    const randomRts = original ? -1 : syms.random + 19;
    cpu.debugInstruction.add((pc) => {
        if (original) {
            if (sites.has(pc) && cpu.readmem(pc) === 0xad && cpu.readmem(pc + 2) === 0xfe) m.pending = sites.get(pc);
            else if (pc === m.pending) { const v = next(); cpu.a = v; m.rnd.push(v); m.rndAt.push([m.passes, pc - 3]); m.pending = -1; }
        } else if (pc === randomRts) {
            // a real call: the RTS returns past a JSR random (the loader's code runs at this
            // address while the disc boots)
            const ret = cpu.readmem(0x101 + ((cpu.s + 0) & 0xff)) | (cpu.readmem(0x101 + ((cpu.s + 1) & 0xff)) << 8);
            if (cpu.readmem(ret - 2) === 0x20 && (cpu.readmem(ret - 1) | (cpu.readmem(ret) << 8)) === syms.random) { m.rnd.push(cpu.a); m.rndAt.push([m.passes, ret - 2]); }
        }
        if (original && pc === syms.start_game) { next.seed(); m.live = true; }   // where step 2 seeds (take_irq_for_play)
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;
        m.passes++;
        if (m.passes === 1) checkCode(m);
        const st = state(m);
        m.states.push(JSON.stringify(st));
        m.view = st.viewport_left[1] * 256 + st.viewport_left[0];
        m.lives = st.lives[0];
        if (m.passes > 1 || m.target === Infinity) pressKeys(m, keysAt[m.passes] || []);
        if (m.passes >= m.target) { m.lastStop = c; return true; }
        return false;
    });
    // step 2 before BUGS #12's fix keeps the generator's state in &92/&93, which the original also
    // uses as scratch (set_dying_mover_type_and_frame: STY &92 ... LDY &92): there those writes land
    // on the state, so for such a build the original's writes to them from the game's start on are
    // mirrored into the generator. A build after the fix keeps it elsewhere: nothing to mirror.
    if (original && STEP2_AT_92) cpu.debugWrite.add((a, v) => {
        if (m.live && (a === 0x92 || a === 0x93)) {
            next.set(a, v);
            const k = `&${a.toString(16)} at &${cpu.pc.toString(16)}`;
            m.seedWrites[k] = (m.seedWrites[k] || 0) + 1;
        }
        return false;
    });
    const events = makeScript(6000, SEED);
    for (let f = 1; f <= 6000 && m.passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
    if (m.passes < 1) throw new Error(`${disc}: no game started`);
    s.releaseAllKeys();
    m.startFrame = s.frameCount;
    pressKeys(m, keysAt[1] || []);
    m.target = Infinity;
    return m;
}
function checkCode(m) {
    const rd = (a, n) => [...m.s.readMemory(a, n, { shadow: false })];
    if (m.original) {
        for (const [a, bytes, and] of ORIGINAL_SITES) {
            const got = rd(a, 4);
            if (bytes.some((b, i) => got[i] !== b) || got[3] !== and)
                throw new Error(`${m.disc}: &${a.toString(16)} holds ${got.map((v) => v.toString(16)).join(" ")}, not LDA &FE6x : AND`);
        }
    } else if (rd(m.syms.random + 19, 1)[0] !== 0x60) throw new Error(`${m.disc}: random + 19 is not its RTS`);
}
function pressKeys(m, keys) {
    for (const k of m.held) if (!keys.includes(k)) m.s.keyUpRaw(gameKey(m.s, k));
    for (const k of keys) if (!m.held.includes(k)) m.s.keyDownRaw(gameKey(m.s, k));
    m.held = keys;
}

// the SN76489 as jsbeeb renders it (500 kHz), box-filtered by 10 to 50 kHz, from now on
const AUDIO_RATE = 50000, DECIMATE = 10;
function captureSound(m) {
    const chip = m.s._soundChip;
    const out = { data: new Float32Array(AUDIO_RATE * 4), n: 0, acc: 0, k: 0 };
    const push = (v) => {
        out.acc += v; if (++out.k < DECIMATE) return;
        if (out.n === out.data.length) { const d = new Float32Array(out.data.length * 2); d.set(out.data); out.data = d; }
        out.data[out.n++] = out.acc / DECIMATE; out.acc = 0; out.k = 0;
    };
    chip.catchUp();
    let skip = chip.position;           // samples already in the chip's buffer: from before now
    chip._onBuffer = (buf) => { for (let i = skip; i < buf.length; i++) push(buf[i]); skip = 0; };
    out.finish = () => { chip.catchUp(); for (let i = skip; i < chip.position; i++) push(chip.buffer[i]); return out.data.subarray(0, out.n); };
    m.audio = out;
}
function writeWav(path, left, right) {
    const n = Math.min(left.length, right.length);
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const gain = 0.9 / peak;
    const buf = Buffer.alloc(44 + n * 4);
    buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
    buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(AUDIO_RATE, 24); buf.writeUInt32LE(AUDIO_RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
    buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
    const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767)));
    for (let i = 0; i < n; i++) { buf.writeInt16LE(q(left[i]), 44 + i * 4); buf.writeInt16LE(q(right[i]), 46 + i * 4); }
    writeFileSync(path, buf);
    return { samples: n, seconds: n / AUDIO_RATE, peak };
}

// the composed frame: a caption band over each half, a gap between
const GAP = 16, BAND = 44;
const W = CROP.w * 2 + GAP, H = BAND + CROP.h;
const frame = Buffer.alloc(W * H * 4);
const BG = [24, 24, 24];
const captionCache = new Map();
async function caption(title, line) {
    const key = title + "|" + line;
    let c = captionCache.get(key);
    if (c) return c;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CROP.w}" height="${BAND}">
<rect width="100%" height="100%" fill="rgb(${BG.join(",")})"/>
<text x="${CROP.w / 2}" y="19" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="bold" fill="#ffffff" text-anchor="middle">${title}</text>
<text x="${CROP.w / 2}" y="38" font-family="Consolas, 'Courier New', monospace" font-size="14" fill="#c8c8c8" text-anchor="middle" xml:space="preserve">${line}</text>
</svg>`;
    c = await sharp(Buffer.from(svg)).flatten({ background: { r: BG[0], g: BG[1], b: BG[2] } }).ensureAlpha().raw().toBuffer();
    if (captionCache.size > 4000) captionCache.clear();
    captionCache.set(key, c);
    return c;
}
function blitBand(x0, band) {
    for (let y = 0; y < BAND; y++) band.copy(frame, (y * W + x0) * 4, y * CROP.w * 4, (y + 1) * CROP.w * 4);
}
function blitScreen(x0, m) {
    const fb = m.s._completeFb8;
    for (let y = 0; y < CROP.h; y++) {
        const src = ((CROP.y + y) * 1024 + CROP.x) * 4;
        frame.set(fb.subarray(src, src + CROP.w * 4), ((BAND + y) * W + x0) * 4);
        for (let x = 0; x < CROP.w; x++) frame[((BAND + y) * W + x0 + x) * 4 + 3] = 255;
    }
}
function fillBg() {
    for (let i = 0; i < W * H; i++) { frame[i * 4] = BG[0]; frame[i * 4 + 1] = BG[1]; frame[i * 4 + 2] = BG[2]; frame[i * 4 + 3] = 255; }
}

const A = await start(discA, "Original (1986)"), B = await start(discB, "Optimised (step 2)");
console.log(`first pass: ${A.disc} at field ${A.startFrame}, ${B.disc} at field ${B.startFrame}`);
if (SOUND) { captureSound(A); captureSound(B); }

let ff = null, ffmpeg = null, videoTmp = null;
let ffDone = false;
mkdirSync(dirname(outPath) || ".", { recursive: true });
if (VIDEO) {
    ffmpeg = findFfmpeg();
    console.log(`ffmpeg: ${ffmpeg}`);
    videoTmp = SOUND ? outPath.replace(/\.mp4$/i, "") + ".video.mp4" : outPath;
    const vf = SCALE > 1 ? ["-vf", `scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`] : [];
    ff = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", "50", "-i", "-",
        ...vf, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoTmp],
        { stdio: ["pipe", "inherit", "inherit"] });
    ff.on("close", (code) => { if (!ffDone) { console.error(`ffmpeg exited (${code}) before the last frame`); process.exit(1); } });
    fillBg();
}
const write = (buf) => new Promise((res, rej) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once("drain", res); ff.stdin.once("error", rej); });

const t0 = Date.now();
const passesAt = [];
for (let f = 0; f < FIELDS; f++) {
    for (const m of [A, B]) {
        const r = await m.s.runFrames(1);
        if (!r.completed) throw new Error(`${m.disc}: field ${f} did not complete`);
    }
    passesAt.push([A.passes, B.passes]);
    if (VIDEO) {
        let x = 0;
        for (const m of [A, B]) {
            blitBand(x, await caption(m.label, `pass ${String(m.passes).padStart(4)}   column ${String(m.view).padStart(4)}   lives ${m.lives}`));
            blitScreen(x, m);
            x += CROP.w + GAP;
        }
        await write(Buffer.from(frame));
    }
    if ((f + 1) % 500 === 0) console.log(`field ${f + 1}: original pass ${A.passes} (column ${A.view}), step 2 pass ${B.passes} (column ${B.view}); ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
if (VIDEO) { ffDone = true; ff.stdin.end(); await new Promise((res) => ff.on("close", res)); }

// the comparison: game state at every pass both reached, and the random bytes in order
const common = Math.min(A.states.length, B.states.length);
let firstDiff = null;
for (let p = 0; p < common && !firstDiff; p++) {
    if (A.states[p] === B.states[p]) continue;
    const a = JSON.parse(A.states[p]), b = JSON.parse(B.states[p]);
    for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        const bytes = []; a[k].forEach((v, i) => { if (v !== b[k][i]) bytes.push(`+${i}: ${v.toString(16)} vs ${b[k][i].toString(16)}`); });
        // the fuel table holds !BOOT's stamp (which differs) until a helicopter is added: a byte the
        // same as at the first pass in each machine is that stamp, not a difference
        if (k === "fuel") {
            const a1 = JSON.parse(A.states[0]).fuel, b1 = JSON.parse(B.states[0]).fuel;
            if (a[k].every((v, i) => v === b[k][i] || (v === a1[i] && b[k][i] === b1[i]))) continue;
        }
        firstDiff = { pass: p + 1, what: k, bytes: bytes.slice(0, 12) };
        break;
    }
}
const rCommon = Math.min(A.rnd.length, B.rnd.length);
let rDiff = null;
for (let i = 0; i < rCommon; i++) if (A.rnd[i] !== B.rnd[i]) { rDiff = i; break; }
const summary = {
    fields: FIELDS, seconds: FIELDS / 50, seed: SEED,
    original: { disc: A.disc, writesToRandomsState: A.seedWrites, passes: A.passes, viewLeft: A.view, lives: A.lives, randomBytes: A.rnd.length, passesPerSecond: +(A.passes / (FIELDS / 50)).toFixed(2) },
    step2: { disc: B.disc, passes: B.passes, viewLeft: B.view, lives: B.lives, randomBytes: B.rnd.length, passesPerSecond: +(B.passes / (FIELDS / 50)).toFixed(2) },
    passesCompared: common, stateIdentical: !firstDiff, firstDifference: firstDiff,
    randomBytesCompared: rCommon, randomIdentical: rDiff === null, firstRandomDifference: rDiff,
    firstRandomDifferenceAt: rDiff === null ? null : [A, B].map((m) => m.rndAt.slice(Math.max(0, rDiff - 3), rDiff + 3).map(([p, a], i) => `pass ${p} &${a.toString(16)} = ${m.rnd[Math.max(0, rDiff - 3) + i]}`)),
    stepTwoAtOriginalsEnd: (() => { const s = JSON.parse(B.states[A.states.length - 1] || "null"); return s && { pass: A.states.length, viewLeft: s.viewport_left[1] * 256 + s.viewport_left[0] }; })(),
};
if (SOUND) {
    const wav = outPath.replace(/\.mp4$/i, "") + ".wav";
    summary.sound = writeWav(wav, A.audio.finish(), B.audio.finish());
    summary.sound.wav = wav;
    if (VIDEO) {
        const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-i", videoTmp, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", outPath], { stdio: "inherit" });
        if (r.status !== 0) throw new Error("ffmpeg mux failed");
        unlinkSync(videoTmp);
    }
}
summary.video = VIDEO ? { path: outPath, width: W * SCALE, height: H * SCALE, fps: 50 } : null;
writeFileSync(outPath.replace(/\.mp4$/i, "") + ".json", JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
