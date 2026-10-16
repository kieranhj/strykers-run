// helilock.mjs - two builds in step through a helicopter flight: run right to the first ally
// helicopter, jump past it, walk back onto it, board it, and fly (climbing and firing) until it is
// shot down and the explosion ends. Keys are chosen each pass from machine A's state and pressed
// on both, as tools/passlock.mjs does; the game state and the newest frame are compared every pass.
// The scripted games of passlock never board a helicopter (BUGS #7 was a helicopter explosion).
//
//   node tools/helilock.mjs CONTROL.ssd TEST.ssd [PASSES] [VARIANT 0-9]
//
// For the renderer: TEST = a build, CONTROL = its DEBUG_FULLREDRAW twin (or the build before a
// change). Both DEBUG_LIVES. Prints where the flight got to and the first frame that differs.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MS = await loadMachineSession();
const [discA, discB, passesArg, variantArg] = process.argv.slice(2);
// VARIANT: how the flight goes - climbing for VARIANT * 10 passes in each 100, grenades (DELETE)
// every 7th pass of the rest, so the grenade slot the explosion reuses has a y of its own
const VARIANT = parseInt(variantArg || "5", 10);
const PASSES = parseInt(passesArg || "2500", 10);
const loadSyms = (disc) => {
    const o = {};
    for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
        for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") o[k] = v.value;
    return o;
};
async function start(disc) {
    const syms = loadSyms(disc), s = await bootMaster(MS, disc), cpu = s._machine.processor;
    const m = { s, cpu, syms, passes: 0, target: 1, lastStop: -1, held: [] };
    cpu.debugInstruction.add((pc) => {
        if (pc !== syms.main_game_loop) return false;
        const c = s.elapsedCycles;
        if (c === m.lastStop) return false;
        m.passes++;
        if (m.passes === 1) s.writeMemory(0x0960, new Array(0x22).fill(0));
        if (m.passes >= m.target) { m.lastStop = c; return true; }
        return false;
    });
    const ev = makeScript(6000, 1);
    for (let f = 1; f <= 6000 && m.passes < 1; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
    s.releaseAllKeys();
    return m;
}
async function toPass(m, n) { m.target = n; for (let i = 0; m.passes < n; i++) { if (i === 150) return false; await m.s.runFor(400000); } return true; }
const rdm = (m, a, n = 1) => [...m.s.readMemory(a, n, { shadow: false })];
// passlock's game variables (not field_count &90 or game_over_cooldown &96: they count fields)
const ZP = [0x00, 0x01, 0x7e, 0x7f, 0x80, 0x82, 0x83, 0x84, 0x8e, 0x8f, 0x92, 0x93, 0x94, 0x95, 0x9f, 0xa0, 0xb0, 0xb1, 0xb2, 0xba, 0xb3, 0xbb, 0xc0];
const state = (m) => JSON.stringify([rdm(m, m.syms.movers_type_and_colour, m.syms.mover_types_parts - m.syms.movers_type_and_colour), ZP.map((a) => rdm(m, a)[0])]);
function newest(m) {
    const pending = rdm(m, m.syms.flip_pending)[0] & 0x80;
    const shadow = pending ? !!rdm(m, m.syms.flip_screen)[0] : !!(m.cpu.acccon & 1);
    return m.s.readMemory(0x4000, 0x4000, { shadow });
}
const press = (m, keys) => { for (const k of m.held) if (!keys.includes(k)) m.s.keyUpRaw(gameKey(m.s, k)); for (const k of keys) if (!m.held.includes(k)) m.s.keyDownRaw(gameKey(m.s, k)); m.held = keys; };

const A = await start(discA), B = await start(discB);
const x = (i) => rdm(A, A.syms.movers_x_high + i)[0] * 256 + rdm(A, A.syms.movers_x_low + i)[0];
let phase = "run", target = null, exploded = null, firstDiff = null, diffs = 0;
const log = [];
for (let p = 1; p <= PASSES; p++) {
    if (!(await toPass(A, p)) || !(await toPass(B, p))) { log.push(`pass ${p}: a machine stopped making passes`); break; }
    if (state(A) !== state(B)) { log.push(`pass ${p}: game state differs`); break; }
    const a = newest(A), b = newest(B);
    let d = 0; for (let i = 0; i < 0x4000; i++) if (a[i] !== b[i]) d++;
    if (d) { diffs++; if (firstDiff === null) firstDiff = `pass ${p} (${phase}): ${d} bytes`; }
    const px = x(0), heli = rdm(A, 0x84)[0], expl = rdm(A, 0x8f)[0];
    if (process.env.SHOTS && (expl || (exploded !== null && p < exploded + 12))) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(`build/heli-${VARIANT}-${p}.png`, await B.s.screenshotActive({ scale: 1 }));
        const sl = (i) => `${i}:t${(rdm(A, A.syms.movers_type_and_colour + i)[0] & 0x7f).toString(16)} x${x(i)} y${rdm(A, A.syms.movers_y + i)[0]} s${(rdm(A, A.syms.movers_screen_address_high + i)[0] * 256 + rdm(A, A.syms.movers_screen_address_low + i)[0]).toString(16)}`;
        log.push(`pass ${p}: ${[0, 12, 17].filter((i) => rdm(A, A.syms.movers_x_high + i)[0] < 0x80).map(sl).join("  ")}; view ${rdm(A, 0xb2)[0] + 256 * rdm(A, 0xba)[0]}`);
    }
    let keys = [];
    if (phase === "run") {
        let best = null;
        for (let i = 0x18; i <= 0x21; i++) { const xh = rdm(A, A.syms.movers_x_high + i)[0]; if (xh < 0x80 && x(i) >= px - 2 && (best === null || x(i) < x(best))) best = i; }
        if (best !== null && x(best) - px < 12) { target = best; phase = "over"; }
        keys = p % 15 < 2 ? ["RIGHT", "A"] : ["RIGHT"];
    } else if (phase === "over") {
        if (px > x(target) + 14) phase = "back";
        keys = p % 12 < 2 ? ["RIGHT", "A"] : ["RIGHT"];
    } else if (phase === "back") {
        if (px <= x(target) + 8) phase = "board";
        keys = ["LEFT"];
    } else if (phase === "board") {
        if (heli) { phase = "fly"; log.push(`pass ${p}: in helicopter ${heli}`); }
        else { const k = p % 20; keys = k < 6 ? ["CTRL"] : k < 10 ? [] : k < 12 ? ["LEFT"] : []; }
    } else if (phase === "fly") {
        keys = p % 100 < VARIANT * 10 ? ["RIGHT", "A"] : p % 7 < 2 ? ["RIGHT", "DELETE"] : ["RIGHT", "SHIFT"];
        if (expl && exploded === null) { exploded = p; log.push(`pass ${p}: helicopter exploding`); }
        if (exploded !== null && !expl) { log.push(`pass ${p}: explosion over`); phase = "after"; }
    } else if (phase === "after") {
        keys = p % 15 < 2 ? ["RIGHT", "A"] : ["RIGHT"];
        if (p > exploded + 300) break;
    }
    press(A, keys); press(B, keys);
}
console.log(log.join("\n"));
console.log(JSON.stringify({ passes: A.passes, phase, boarded: log.some((l) => l.includes("in helicopter")), exploded, framesDiffering: diffs, firstDiff }));
