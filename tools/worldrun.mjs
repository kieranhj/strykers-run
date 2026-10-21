// worldrun.mjs - the whole world, start to completion screen: the player run from the first pass
// to the headquarters (player x &1CED, main_game_loop's test) by tools/playscript.mjs's WorldBot.
//
//   node tools/worldrun.mjs DISC.ssd [--control CONTROL.ssd [--screen] [--unclobber]] [--shots DIR] [--passes N]
//
// Any build: one without DEBUG_LIVES (the shipping build) is given infinite lives by the poke
// DEBUG_LIVES assembles (playscript.mjs startWorldGame). Keys are chosen each pass from the game's
// state (WorldBot: run right, jump, and where a hostile mover blocks the way, back off and throw a
// grenade), so the run is the same game in any build whose state is the same, whatever its speed.
// Reports, for DISC (and CONTROL):
//   the run     passes to the completion screen, the stalls the bot broke, the view at the end
//   frames      as tools/passbench.mjs: passes a second, cycles and fields a pass, and how many
//               fields each frame stayed on screen (a frame shown 3 or more is late), with the
//               late frames' passes and view columns
// --control: CONTROL is run in step with DISC, pass by pass (the keys from CONTROL's state), and
//   the game state compared at the start of every pass as tools/passlock.mjs does (every mover and
//   projectile table, the score, the fuel table, the zero-page game variables): the first
//   difference stops the run. --screen also compares the newest frame each pass (passlock's: the
//   frame waiting for its flip if there is one, else the one shown; the 16,000 displayed bytes).
//   For the renderer: CONTROL = the DEBUG_FULLREDRAW twin of DISC (both -Shift 256 -ShiftEnd, so
//   the ground pattern is fixed: BUGS #1). The generator's state is read where each build keeps
//   it; --unclobber undoes BUGS #12's clobber of it on a build from before the fix (as
//   tools/passlock.mjs's), so that build is the control for one after it. Each machine's
//   `clobbers` (playscript.mjs prngClobber) say how many there were and the first's pass.
// --shots DIR: DIR/worldrun-<build>-hq.png (the last frame of play, at completion_screen),
//   -hq-approach.png (the first pass with the player within 40 columns of the headquarters) and
//   -completion.png (the completion text, as text_screen waits in its delay loop).
import { writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys, runToPc, moverTables, prngAt, prngClobber } from "./playscript.mjs";
const MS = await loadMachineSession();

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const CONTROL = opt("--control"), SHOTS = opt("--shots"), PASSES = +(opt("--passes") || 20000), SCREEN = flag("--screen"), UNCLOBBER = flag("--unclobber");
const [disc] = args;
if (!disc) { console.error("usage: node tools/worldrun.mjs DISC.ssd [--control CONTROL.ssd [--screen]] [--shots DIR] [--passes N]"); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const HQ = 0x1ced;

// every flip (the vsync interrupt writes shown_screen), by pass and field_count: passbench's frames
function watchFrames(m) {
    m.flips = []; m.at = [];
    m.cpu.debugWrite.add((a) => { if (a === m.syms.shown_screen) m.flips.push({ pass: m.passes, field: m.s.readMemory(m.syms.field_count, 1)[0] }); return false; });
}
const onPass = (m, c) => { if (m.at) m.at[m.passes] = { c, field: m.s.readMemory(m.syms.field_count, 1)[0] }; };

// passlock.mjs's state: zero-page game variables that live from pass to pass
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
    out.fuel = rd(syms.movers_helicopter_fuel_high, 0x22);
    for (const [k, addrs] of Object.entries(ZP)) out[k] = addrs.map((a) => rd(a, 1)[0]);
    out.rnd_seed = prngAt(syms).map((a) => rd(a, 1)[0]);      // where this build keeps it (BUGS #12)
    if (out.player_helicopter[0] === 0) out.helicopter_fuel = [0, 0];   // the title tune's pointer until a helicopter
    return out;
}
function newest(m) {
    const pending = m.s.readMemory(m.syms.flip_pending, 1, { shadow: false })[0] & 0x80;
    const shadow = pending ? !!m.s.readMemory(m.syms.flip_screen, 1, { shadow: false })[0] : !!(m.cpu.acccon & 1);
    return m.s.readMemory(0x4000, 0x4000, { shadow });
}
const shot = async (m, what) => { if (!SHOTS) return; const f = `${SHOTS}/worldrun-${basename(m.disc, ".ssd")}-${what}.png`; writeFileSync(f, await m.s.screenshotActive({ scale: 1 })); console.log(`  ${f}`); };

const T = await startWorldGame(MS, disc, { onPass, keepAlive: true });   // gameplay builds: no deaths' rewinds
const C = CONTROL ? await startWorldGame(MS, CONTROL, { onPass, keepAlive: true }) : null;
const machines = C ? [C, T] : [T];
for (const m of machines) { watchFrames(m); m.view = worldState(m).view; m.clobbers = prngClobber(m, { undo: UNCLOBBER }); console.log(`${m.disc}: game started; infinite lives: ${m.infiniteLives}`); }
const lead = C || T;                                  // the keys come from this machine's state
const bot = new WorldBot();
let firstDiff = null, approach = false, screenPasses = 0, screenDiffCount = 0, screenDiffPasses = [], screenMax = 0, end = null;
for (let p = 1; p <= PASSES; p++) {
    const r = [];
    for (const m of machines) r.push(await toWorldPass(m, p));
    if (r.some((x) => x !== "pass")) {
        if (new Set(r).size > 1) firstDiff = { pass: p, what: `${machines.map((m, i) => `${basename(m.disc)} ${r[i]}`).join(", ")}` };
        end = { pass: p, how: r.join("/") };
        break;
    }
    for (const m of machines) { const w = worldState(m); m.view = w.view; if (m.at[p]) { m.at[p].view = w.view; m.at[p].air = w.py !== 24; } }
    if (C) {
        const a = state(C), b = state(T);
        for (const k of Object.keys(a)) {
            if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
            const bytes = []; a[k].forEach((v, i) => { if (v !== b[k][i]) bytes.push(`+${i}: ${v.toString(16)} vs ${b[k][i].toString(16)}`); });
            firstDiff = { pass: p, what: k, bytes: bytes.slice(0, 12) }; break;
        }
        if (firstDiff) { console.log(JSON.stringify({ firstDifference: firstDiff })); await shot(C, `diff-${p}`); await shot(T, `diff-${p}`); break; }
        if (SCREEN) {
            const x = newest(C), y = newest(T);
            const ss = C.s.readMemory(0, 2, { shadow: false }), start = ss[0] + ss[1] * 256;
            let d = 0;
            for (let i = 0; i < 0x4000; i++) if (x[i] !== y[i] && ((i + 0x4000 - start + 0x4000) & 0x3fff) < 16000) d++;
            screenPasses++;
            if (d) { screenDiffCount++; if (screenDiffPasses.length < 20) screenDiffPasses.push(`${p}:${d}`); screenMax = Math.max(screenMax, d);
                if (screenDiffCount === 1) { await shot(C, `screen-${p}`); await shot(T, `screen-${p}`); } }
        }
    }
    const st = worldState(lead);
    if (!approach && st.px >= HQ - 40) { approach = true; for (const m of machines) await shot(m, "hq-approach"); }
    pressKeys(lead, bot.step(p, st));
    if (C) pressKeys(T, lead.held);
    if (p % 1000 === 0) console.log(`pass ${p}: player at ${st.px}, view ${st.view}${C ? ", state identical" + (SCREEN ? `, ${screenDiffCount ? "frames differing " + screenDiffCount : "every frame identical"}` : "") : ""}`);
}
const out = [];
for (const m of machines) {
    const st = worldState(m);
    const res = { disc: m.disc, infiniteLives: m.infiniteLives, completed: m.completed ? m.completed.pass : null, passes: m.passes, player: st.px, view: st.view, clobbers: m.clobbers };
    if (m.completed) {
        await shot(m, "hq");
        // the completion text: text_screen's delay loop, a few fields later
        if (await runToPc(m.s, m.syms.delay_loop, 400)) { await m.s.runFrames(3); await shot(m, "completion"); res.completionText = true; }
    }
    // frames, passes 2 to the last pass made (the first is the game's start)
    const last = m.completed ? m.completed.pass : m.passes;
    // late frames listed as pass@view:fields, and counted by 1,000 columns of the world and by
    // whether the player was in the air (y not 24, the ground) at that pass: jumping scrolls faster
    const fl = m.flips.filter((f) => f.pass >= 2 && f.pass <= last), shownFor = {}, late = [], byWorld = {}, byAir = { ground: [0, 0], air: [0, 0] };
    for (let i = 1; i < fl.length; i++) {
        const g = (fl[i].field - fl[i - 1].field + 256) & 255; shownFor[g] = (shownFor[g] || 0) + 1;
        const at = m.at[fl[i - 1].pass] || {}, k = at.air ? "air" : "ground", w = `${Math.floor((at.view || 0) / 1000) * 1000}-`;
        byAir[k][1]++; byWorld[w] ||= [0, 0]; byWorld[w][1]++;
        if (g > 2) { late.push(`${fl[i - 1].pass}@${at.view ?? "?"}:${g}`); byAir[k][0]++; byWorld[w][0]++; }
    }
    const ratio = (o) => Object.fromEntries(Object.entries(o).map(([k, [a, b]]) => [k, `${a} of ${b}`]));
    const fields = {};
    for (let p = 2; p < last; p++) { if (!m.at[p + 1]) continue; const d = (m.at[p + 1].field - m.at[p].field + 256) & 255; fields[d] = (fields[d] || 0) + 1; }
    const cyc = m.at[last - 1].c - m.at[2].c, n = last - 3;
    Object.assign(res, { passesPerSecond: +(n / (cyc / 2e6)).toFixed(2), cyclesAPass: Math.round(cyc / n), fieldsAPass: fields, frames: fl.length - 1, shownFor, lateFrames: late.length, lateByWorldColumns: ratio(byWorld), lateByPlayer: ratio(byAir), late: late.slice(0, 40) });
    out.push(res);
}
const summary = { stalls: bot.stalls, end };
if (C) Object.assign(summary, { stateIdentical: !firstDiff, firstDifference: firstDiff, passesCompared: firstDiff ? firstDiff.pass - 1 : (end ? end.pass - 1 : PASSES) },
    SCREEN ? { framesCompared: screenPasses, framesDiffering: screenDiffCount, screenMaxDiff: screenMax, screenDiffPasses } : {});
for (const r of out) console.log(JSON.stringify(r));
console.log(JSON.stringify(summary));
