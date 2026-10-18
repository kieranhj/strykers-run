// passlock.mjs - two builds kept in step pass by pass: the same keys for pass N in both, and the
// game state compared at the start of every pass. The check that a change to how the game DRAWS
// left what it PLAYS alone (step 2 layer 2: the single-screen control against double buffering).
//
//   node tools/passlock.mjs CONTROL.ssd TEST.ssd [PASSES] [SEED] [--screen]
//
// Both boot on a Master and start a game with tools/playscript.mjs's title presses. From the first
// main_game_loop on, each machine is stopped at the start of every pass, given that pass's keys
// (bursts of RIGHT, LEFT, SHIFT, DELETE, A, Z - and CTRL with PASSLOCK_CTRL=1 - from SEED, generated per PASS, not per frame, so two
// builds of different speed see the same input on the same pass), and compared:
//   state   every mover and projectile table (movers_type_and_colour up to movers_state_end, or mover_types_parts before decision 40),
//           the score digits, the helicopter fuel, and the zero-page game variables below
//   screen  (--screen) the bytes of the screen being shown: the control's &4000-&7FFF against the
//           test's, read from shadow RAM when ACCCON bit 0 says the shadow screen is displayed;
//           counted over the 16,000 displayed bytes from the screen start (the ring's other 384
//           are never shown, and are only counted as passes where they differ)
// Prints the first pass whose state differs (and the bytes), or {"passes":N,"identical":true},
// plus with --screen a count of differing screen bytes per pass (summary: passes with none).
// Use DEBUG_LIVES builds, so the game never ends.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { KEY, makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const args = process.argv.slice(2);
const screenAt = args.indexOf("--screen");
const SCREEN = screenAt >= 0; if (SCREEN) args.splice(screenAt, 1);
const dumpAt = args.indexOf("--dump");
const DUMP = dumpAt >= 0 ? args.splice(dumpAt, 2)[1].split(",").map(Number) : [];
const traceAt = args.indexOf("--trace");
const TRACE = traceAt >= 0 ? parseInt(args.splice(traceAt, 2)[1], 10) : 0;
const [discA, discB, passesArg, seedArg] = args;
if (!discB) { console.error("usage: node tools/passlock.mjs CONTROL.ssd TEST.ssd [PASSES] [SEED] [--screen]"); process.exit(2); }
const PASSES = parseInt(passesArg || "2000", 10);
const SEED = parseInt(seedArg || "1", 10);
const CTRL = !!process.env.PASSLOCK_CTRL;             // also press CTRL (ENTER) now and then

const loadSyms = (disc) => {
    const out = {};
    for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
        for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") out[k] = v.value;
    return out;
};
// zero-page game state that lives from pass to pass (not the routines' scratch, not game_over_cooldown,
// which the interrupt counts down, so it follows time, not passes)
const ZP = {
    screen_start: [0x00, 0x01], trigger_offset: [0x7e], new_movers_offset: [0x7f], helicopter_to_update: [0x80],
    player_y_velocity: [0x82], player_jump_direction: [0x83], player_helicopter: [0x84],
    player_firing_cooldown: [0x8e], player_helicopter_explosion: [0x8f], rnd_seed: [0x92, 0x93],
    bottom_palette: [0x94], lives: [0x95], helicopter_fuel: [0x97, 0x98], top_palette: [0x9f], firing_frame: [0xa0],
    crtc_start: [0xb0, 0xb1], viewport_left: [0xb2, 0xba], viewport_right: [0xb3, 0xbb], movers_to_update_base: [0xc0],
};

async function start(disc) {
    const syms = loadSyms(disc);
    const s = await bootMaster(MachineSession, disc);
    const cpu = s._machine.processor;
    const m = { s, cpu, syms, passes: 0, target: 0, lastStop: -1 };
    cpu.debugInstruction.add((pc) => {
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;          // resuming from the stop: already counted
        m.passes++;
        // the fuel table's entries hold what !BOOT left (its stamp, which names the debug flags)
        // until a helicopter is added: the same in both machines from the first pass
        if (m.passes === 1) s.writeMemory(0x0960, new Array(0x22).fill(0));
        if (m.passes >= m.target) { m.lastStop = c; return true; }
        return false;
    });
    // the title: the script's presses of 1 until the first pass
    const events = makeScript(6000, SEED);
    m.target = 1;
    for (let f = 1; f <= 6000 && m.passes < 1; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
    if (m.passes < 1) throw new Error(`${disc}: no game started`);
    s.releaseAllKeys();
    return m;
}
// false if the machine makes no pass in 1,500 fields: the game has left its main loop for good
// (the world completed: its screen waits for a key the pass script never presses)
async function toPass(m, n) {
    m.target = n;
    for (let i = 0; m.passes < n; i++) { if (i === 150) return false; await m.s.runFor(400000); }
    return true;
}
let stalledAt = null;
function state(m) {
    const { s, syms } = m;
    const rd = (a, n) => [...s.readMemory(a, n, { shadow: false })];
    const out = {};
    out.movers = rd(syms.movers_type_and_colour, (syms.movers_state_end ?? syms.mover_types_parts) - syms.movers_type_and_colour);
    out.score = rd(syms.game_over_text + 20, 6);
    out.fuel = rd(0x0960, 0x22);
    for (const [k, addrs] of Object.entries(ZP)) out[k] = addrs.map((a) => rd(a, 1)[0]);
    // &97/&98 is the title tune's pointer until the player first takes a helicopter
    if (out.player_helicopter[0] === 0) out.helicopter_fuel = [0, 0];
    return out;
}
// the newest frame: the one waiting for its flip if there is one (decision 26: a pass can start
// before its frame is shown), else the one shown
function shown(m) {
    const pending = m.syms.flip_pending !== undefined && (m.s.readMemory(m.syms.flip_pending, 1, { shadow: false })[0] & 0x80);
    const shadow = pending ? !!m.s.readMemory(m.syms.flip_screen, 1, { shadow: false })[0] : !!(m.cpu.acccon & 1);
    return { shadow, bytes: m.s.readMemory(0x4000, 0x4000, { shadow }) };
}

// per-pass keys, from SEED: a burst of keys held for 10-80 passes, then 0-10 passes of none
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
        if (CTRL && rnd() < 0.1) keys.push("CTRL");          // enter or leave a helicopter or the tank
        for (let i = 0; i < len && p < n; i++) keysAt[p++] = keys;
        const gap = Math.floor(rnd() * 10);
        for (let i = 0; i < gap && p < n; i++) keysAt[p++] = [];
    }
    return keysAt;
}

const A = await start(discA), B = await start(discB);
const keysAt = passKeys(PASSES + 2);
let held = [];
const screenDiffs = [];
let inHelicopter = 0, hiddenDiffs = 0;
const traces = [];
function arm(m) {
    const t = { writes: [], trail: [] };
    const lo = process.env.TRACE_LO ? parseInt(process.env.TRACE_LO, 16) : m.syms.movers_type_and_colour, hi = process.env.TRACE_HI ? parseInt(process.env.TRACE_HI, 16) : (m.syms.movers_state_end ?? m.syms.mover_types_parts);
    const names = {}; for (const [k, v] of Object.entries(m.syms)) if (v < 0x4000) (names[v] ||= k);
    const near = (pc) => { for (let a = pc; a > pc - 0x200; a--) if (names[a]) return `${names[a]}+${pc - a}`; return pc.toString(16); };
    m.cpu.debugInstruction.add((pc) => { if (m.tracing && pc < 0x8000) { t.trail.push(pc); if (t.trail.length > 40) t.trail.shift(); } return false; });
    m.cpu.debugWrite.add((a, v) => { if (m.tracing && a >= lo && a < hi) t.writes.push({ off: a - lo, v, pc: near(m.cpu.pc), trail: t.trail.slice(-25).map(near) }); return false; });
    return t;
}
// WATCH=&addr (with WATCH_PASS=P): every write to that screen byte on the test machine during pass
// P, with the CPU's X bit, the renderer's slot (ren_i) and the routine trail
const WATCH = process.env.WATCH ? parseInt(process.env.WATCH, 16) : 0;
const [WATCH_FROM, WATCH_TO] = (process.env.WATCH_PASS || "0").split("-").map(Number).concat([NaN]).map((v, i, a) => isNaN(v) ? a[0] : v);
const watching = () => B.passes >= WATCH_FROM && B.passes <= WATCH_TO;
if (WATCH) {
    const names = {}; for (const [k, v] of Object.entries(B.syms)) (names[v] ||= k);
    const near = (pc) => { for (let a = pc; a > pc - 0x300; a--) if (names[a] !== undefined) return `${names[a]}+${pc - a}`; return "&" + pc.toString(16); };
    const trail = [];
    B.cpu.debugInstruction.add((pc) => { if (watching()) { const n = near(pc).replace(/\+\d+$/, ""); if (trail[trail.length - 1] !== n) { trail.push(n); if (trail.length > 12) trail.shift(); } } return false; });
    const slotTypes = () => { const t = B.s.readMemory(B.syms.movers_type_and_colour, 34, { shadow: false }), x = B.s.readMemory(B.syms.movers_x_low, 34, { shadow: false }), h = B.s.readMemory(B.syms.movers_x_high, 34, { shadow: false }); return [0, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].filter((i) => h[i] < 0x80).map((i) => `${i}:t${(t[i] & 0x7f).toString(16)}@${h[i] * 256 + x[i]}`).join(" "); };
    B.cpu.debugRead.add((a, v) => { if (watching() && a === WATCH && (B.cpu.acccon & 4)) console.log(`  pass ${B.passes} read  &${a.toString(16)} = ${v.toString(16)} ren_i=${B.s.readMemory(B.syms.ren_i, 1, { bank: 4 })[0]} :: ${trail.slice(-4).join(" > ")} [${slotTypes()}]`); return false; });
    B.cpu.debugWrite.add((a, v) => { if (watching() && a === WATCH && (B.cpu.acccon & 4)) console.log(`  pass ${B.passes} write &${a.toString(16)} = ${v.toString(16)} X=${(B.cpu.acccon >> 2) & 1} ren_i=${B.s.readMemory(B.syms.ren_i, 1, { bank: 4 })[0]} back=${B.s.readMemory(B.syms.back, 1, { bank: 4 })[0]} :: ${trail.join(" > ")}`); return false; });
}
for (let p = 1; p <= PASSES; p++) {
    const okA = await toPass(A, p), okB = await toPass(B, p);
    if (!okA || !okB) {
        // both must stall together: one alone is a difference
        if (okA !== okB) { console.log(JSON.stringify({ firstDifference: p, what: okA ? "test made no pass" : "control made no pass" })); process.exit(1); }
        const v = state(A).viewport_left;
        console.log(`pass ${p}: both stopped making passes (viewport ${v[1] * 256 + v[0]}): compared to pass ${p - 1}`);
        stalledAt = p; break;
    }
    if (TRACE && p === TRACE - 1) { traces.push(arm(A), arm(B)); A.tracing = B.tracing = true; }
    if (TRACE && p === TRACE) {
        A.tracing = B.tracing = false;
        const [ta, tb] = traces;
        const n = Math.min(ta.writes.length, tb.writes.length);
        let i = 0; while (i < n && ta.writes[i].off === tb.writes[i].off && ta.writes[i].v === tb.writes[i].v) i++;
        console.log(`pass ${TRACE - 1}: ${ta.writes.length} / ${tb.writes.length} writes to the mover tables, first difference at write ${i}`);
        for (const [name, t] of [["control", ta], ["test", tb]]) { const w = t.writes[i]; if (w) console.log(`${name}: +${w.off} = ${w.v.toString(16)} at ${w.pc}
  trail: ${w.trail.join(" ")}`); }
        process.exit(0);
    }
    const sa = state(A), sb = state(B);
    if (sa.player_helicopter[0]) inHelicopter++;
    for (const k of Object.keys(sa)) {
        if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) {
            const diff = [];
            sa[k].forEach((v, i) => { if (v !== sb[k][i]) diff.push(`+${i}: ${v.toString(16)} vs ${sb[k][i].toString(16)}`); });
            console.log(JSON.stringify({ firstDifference: p, what: k, bytes: diff.slice(0, 12) }));
            process.exit(1);
        }
    }
    if (SCREEN) {
        const a = shown(A).bytes, b = shown(B);
        // only what can be seen: 16,000 bytes from the screen start; the other 384 of the 16K ring
        // are never displayed (each comes into view as part of a freshly written edge column)
        const ss = A.s.readMemory(0, 2, { shadow: false }); const start = ss[0] + ss[1] * 256;
        let d = 0, hidden = 0;
        for (let i = 0; i < 0x4000; i++) if (a[i] !== b.bytes[i]) { if (((i + 0x4000 - start + 0x4000) & 0x3fff) < 16000) d++; else hidden++; }
        screenDiffs.push(d); hiddenDiffs += hidden ? 1 : 0;
        if (DUMP.includes(p)) {
            // where on screen: character column/row from the control's screen start (&00/&01)
            const ss = A.s.readMemory(0, 2, { shadow: false }); const start = ss[0] + ss[1] * 256;
            const cells = new Map();
            for (let i = 0; i < 0x4000; i++) if (a[i] !== b.bytes[i]) {
                const off = (i + 0x4000 - start + 0x4000) & 0x3fff, row = Math.floor(off / 640), col = Math.floor((off % 640) / 8);
                const k = `r${row} c${col}`; cells.set(k, (cells.get(k) || 0) + 1);
            }
            console.log(`pass ${p}: ${d} bytes in ${cells.size} cells: ${[...cells.entries()].slice(0, 60).map(([k, n]) => k + ":" + n).join(" ")}`);
            const other = B.s.readMemory(0x4000, 0x4000, { shadow: !b.shadow });
            for (let i = 0, k = 0; i < 0x4000 && k < 6; i++) if (a[i] !== b.bytes[i]) { k++;
                console.log(`  &${(0x4000 + i).toString(16)}: control ${a[i].toString(16)}, test shown (${b.shadow ? "shadow" : "main"}) ${b.bytes[i].toString(16)}, test hidden ${other[i].toString(16)}`); }
            const { writeFileSync } = await import("node:fs");
            writeFileSync(`build/passlock-${p}-control.png`, await A.s.screenshotActive({ scale: 1 }));
            writeFileSync(`build/passlock-${p}-test.png`, await B.s.screenshotActive({ scale: 1 }));
            const mv = (m) => { const r = (a, n) => [...m.s.readMemory(a, n, { shadow: false })]; const x = r(m.syms.movers_x_low, 34), xh = r(m.syms.movers_x_high, 34), t = r(m.syms.movers_type_and_colour, 34);
                return x.map((v, i) => xh[i] < 0x80 ? `${i}:t${(t[i] & 0x7f).toString(16)}@${xh[i] * 256 + v}` : null).filter(Boolean).join(" "); };
            console.log(`  movers: ${mv(A)}; viewport ${A.s.readMemory(0xb2, 1)[0] + 256 * A.s.readMemory(0xba, 1)[0]}`);
        }
    }
    const want = keysAt[p] || [];
    for (const k of held) if (!want.includes(k)) { A.s.keyUpRaw(gameKey(A.s, k)); B.s.keyUpRaw(gameKey(B.s, k)); }
    for (const k of want) if (!held.includes(k)) { A.s.keyDownRaw(gameKey(A.s, k)); B.s.keyDownRaw(gameKey(B.s, k)); }
    held = want;
    if (p % 500 === 0) console.log(`pass ${p}: state identical` + (SCREEN ? `, screen bytes differing this pass ${screenDiffs[screenDiffs.length - 1]}` : ""));
}
const end = state(A);
const out = { passes: stalledAt ? stalledAt - 1 : PASSES, stalledAt, identical: true, viewportLeft: end.viewport_left[1] * 256 + end.viewport_left[0], lives: end.lives[0], passesInHelicopter: inHelicopter, score: end.score.map((d) => d.toString(16)).join(" ") };
if (SCREEN) {
    out.screenPassesIdentical = screenDiffs.filter((d) => d === 0).length;
    out.screenMaxDiff = Math.max(...screenDiffs);
    out.screenFirstDiffPass = screenDiffs.findIndex((d) => d > 0) + 1 || null;
    out.passesWithHiddenBytesDiffering = hiddenDiffs;
    out.screenDiffPasses = screenDiffs.map((d, i) => d ? `${i + 1}:${d}` : null).filter(Boolean).slice(0, 16);
}
console.log(JSON.stringify(out));
