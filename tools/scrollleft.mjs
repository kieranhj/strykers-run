// scrollleft.mjs - BUGS #10's case: the view scrolled left past a mover clipped at its left edge.
// Two builds in step (worldrun.mjs's --control --screen: the keys from CONTROL's state, the game
// state compared every pass, and the newest frame's 16,000 displayed bytes), played through the
// world by playscript.mjs's WorldBot. Whenever CONTROL has a mover (not the player) clipped at the
// view's left edge - x 1 to 11 columns left of viewport_left, x + width reaching the view - the
// bot is interrupted (once per 60 columns of the view): LEFT held for --left passes (the view
// follows the player left, so the mover comes into view a column a pass), then the bot runs on.
// Every pass is compared; the summary counts the passes with a mover clipped at the left edge and
// those where a lower slot overlaps one (what close_over_overlaps must see).
// For the renderer, CONTROL = the DEBUG_FULLREDRAW twin of TEST (both -Shift 256 -ShiftEnd: BUGS #1).
//
//   node tools/scrollleft.mjs CONTROL.ssd TEST.ssd [--passes N] [--left K] [--still S] [--episodes E] [--shots DIR]
//   (each episode: LEFT for K passes, 60 by default, then no key for S, 10: movers move on over it)
//   --place: at each episode's start, the lowest-slot soldier (types 1-4, below the clipped mover's
//   slot) is moved, in both machines alike, to the clipped mover's y and one column right of its x
//   (x, y and screen address written together), so it walks on over it: a lower slot that changes
//   every pass over a higher one that stays, at the left edge (what close_over_overlaps must see)
//
// Prints each episode (pass, the mover's slot, type, x and y, the view, frames differing in it) and
// a summary: passes, episodes, the scrolls left made in them, frames compared and differing (the
// first 40 as pass@view:bytes, with the clipped movers then as slot/type and the slots under them).
import { writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys, moverTables, readAt } from "./playscript.mjs";
const MS = await loadMachineSession();

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const PASSES = +opt("--passes", 20000), LEFT = +opt("--left", 60), EPISODES = +opt("--episodes", 1000), STILL = +opt("--still", 10), SHOTS = opt("--shots", null);
const PLACE = args.includes("--place"); if (PLACE) args.splice(args.indexOf("--place"), 1);
const [control, test] = args;
if (!test) { console.error("usage: node tools/scrollleft.mjs CONTROL.ssd TEST.ssd [--passes N] [--left K] [--episodes E] [--shots DIR]"); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ZP = [0x00, 0x01, 0x7e, 0x7f, 0x80, 0x82, 0x83, 0x84, 0x8e, 0x8f, 0x92, 0x93, 0x94, 0x95, 0x97, 0x98, 0x9f, 0xa0,
    0xb0, 0xb1, 0xb2, 0xba, 0xb3, 0xbb, 0xc0];                // passlock.mjs's zero-page game state
function state(m) {
    const rd = (a, n) => [...m.s.readMemory(a, n, { shadow: false })];
    const zp = ZP.map((a) => rd(a, 1)[0]);
    if (zp[7] === 0) { zp[14] = 0; zp[15] = 0; }              // helicopter_fuel: the title tune's pointer until a helicopter
    return JSON.stringify([rd(...moverTables(m.syms)), rd(m.syms.game_over_text + 20, 6), rd(m.syms.movers_helicopter_fuel_high, 0x22), zp]);
}
function newest(m) {
    const pending = m.s.readMemory(m.syms.flip_pending, 1, { shadow: false })[0] & 0x80;
    const shadow = pending ? !!m.s.readMemory(m.syms.flip_screen, 1, { shadow: false })[0] : !!(m.cpu.acccon & 1);
    return m.s.readMemory(0x4000, 0x4000, { shadow });
}
function screenDiff(a, b) {
    const x = newest(a), y = newest(b);
    const ss = a.s.readMemory(0, 2, { shadow: false }), start = ss[0] + ss[1] * 256;
    let d = 0;
    for (let i = 0; i < 0x4000; i++) if (x[i] !== y[i] && ((i + 0x4000 - start + 0x4000) & 0x3fff) < 16000) d++;
    return d;
}
// movers clipped at the left edge (slots 1 on: 0 is the player): x 1-11 left of the view, reaching
// it; and, for each, the other movers whose rectangles overlap its own, the lower slots (drawn
// before it) and the higher (drawn after it): what close_over_overlaps must see (BUGS #10)
const SLOTS = 0x22;
function leftClipped(m) {
    const { syms } = m, rd = (a, n) => [...m.s.readMemory(a, n, { shadow: false })];
    const xl = rd(syms.movers_x_low, SLOTS), xh = rd(syms.movers_x_high, SLOTS), ty = rd(syms.movers_type_and_colour, SLOTS), y = rd(syms.movers_y, SLOTS);
    const width = readAt(m.s, syms.mover_types_width_table, 128), height = readAt(m.s, syms.mover_types_height_table, 128);
    const view = worldState(m).view, out = [];
    const rect = (i) => { const t = ty[i] & 0x7f; return { x1: xh[i] * 256 + xl[i], x2: xh[i] * 256 + xl[i] + width[t], y1: y[i], y2: y[i] + height[t] }; };
    for (let j = 1; j < SLOTS; j++) {
        if (xh[j] & 0x80) continue;
        const r = rect(j);
        if (!(r.x1 < view && view - r.x1 <= 11 && r.x2 >= view)) continue;
        const under = [], over = [];
        for (let i = 1; i < SLOTS; i++) {
            if (i === j || (xh[i] & 0x80)) continue;
            const q = rect(i);
            if (q.x1 <= r.x2 && r.x1 <= q.x2 && q.y1 <= r.y2 && r.y1 <= q.y2) (i < j ? under : over).push(i);
        }
        out.push({ slot: j, type: (ty[j] & 0x7f).toString(16), x: r.x1, y: y[j], view, under, over });
    }
    return out;
}
// --place: a soldier below slot j moved over j (x + 1, j's y, j's screen address + 8), in C and T
function place(j) {
    const { syms } = C, rd = (a, n) => [...C.s.readMemory(a, n, { shadow: false })];
    const ty = rd(syms.movers_type_and_colour, SLOTS), xh = rd(syms.movers_x_high, SLOTS);
    let i = 1;
    for (; i < j.slot; i++) if (!(xh[i] & 0x80) && (ty[i] & 0x7f) >= 1 && (ty[i] & 0x7f) <= 4) break;
    if (i >= j.slot) return null;
    const lo = rd(syms.movers_screen_address_low + j.slot, 1)[0], hi = rd(syms.movers_screen_address_high + j.slot, 1)[0];
    let a = hi * 256 + lo + 8; if (a >= 0x8000) a -= 0x4000;
    const x = j.x + 1;
    for (const m of [C, T]) {
        const w = (t, v) => m.s.writeMemory(t + i, [v]);
        w(syms.movers_x_low, x & 255); w(syms.movers_x_high, x >> 8); w(syms.movers_y, j.y);
        w(syms.movers_screen_address_low, a & 255); w(syms.movers_screen_address_high, a >> 8);
    }
    return { slot: i, type: (ty[i] & 0x7f).toString(16), x, y: j.y };
}
const shot = async (m, what) => { if (!SHOTS) return; const f = `${SHOTS}/scrollleft-${basename(m.disc, ".ssd")}-${what}.png`; writeFileSync(f, await m.s.screenshotActive({ scale: 1 })); console.log(`  ${f}`); };

const C = await startWorldGame(MS, control), T = await startWorldGame(MS, test);
const bot = new WorldBot();
let plan = [], episode = null, end = null, firstStateDiff = null, nextAt = 0;
const episodes = [], diffs = [];
let compared = 0, differing = 0, inEpisodes = 0, worst = 0, lefts = 0, clippedPasses = 0, overlapPasses = 0, shotTaken = false;
for (let p = 1; p <= PASSES; p++) {
    const r = [await toWorldPass(C, p), await toWorldPass(T, p)];
    if (r.some((x) => x !== "pass")) { end = { pass: p, how: r.join("/") }; break; }
    if (state(C) !== state(T)) { firstStateDiff = p; console.log(JSON.stringify({ firstStateDifference: p })); break; }
    const st = worldState(C), clipped = leftClipped(C);
    if (clipped.length) clippedPasses++;
    if (clipped.some((c) => c.under.length || c.over.length)) overlapPasses++;
    const d = screenDiff(C, T);
    compared++;
    if (d) {
        differing++; worst = Math.max(worst, d);
        if (diffs.length < 40) diffs.push(`${p}@${st.view}:${d}${episode ? " (episode)" : ""}${clipped.length ? " clipped " + clipped.map((c) => `${c.slot}/${c.type}${c.under.length ? " over " + c.under.join(",") : ""}${c.over.length ? " under " + c.over.join(",") : ""}`).join(" ") : ""}`);
        if (!shotTaken) { shotTaken = true; await shot(C, `oracle-${p}`); await shot(T, `test-${p}`); }
    }
    if (episode) {
        episode.passes++;
        if (d) { inEpisodes++; episode.differing++; if (episode.first === null) episode.first = { pass: p, bytes: d, view: st.view }; }
        if (st.view < episode.lastView) { lefts++; episode.lefts++; }
        episode.lastView = st.view;
    }
    let keys;
    if (plan.length) {
        keys = plan.shift();
        if (!plan.length) {                                  // episode over: the bot runs on from here
            console.log(JSON.stringify(episode)); episodes.push(episode); episode = null;
            bot.best = st.px; bot.bestAt = p;
        }
    } else if (episodes.length < EPISODES && p > 20 && st.view >= nextAt && clipped.length) {
        episode = { ...clipped[0], pass: p, passes: 0, lefts: 0, differing: 0, first: null, lastView: st.view };
        if (PLACE) episode.placed = place(episode);
        nextAt = st.view + 60;                               // the next a little further on
        plan = new Array(LEFT).fill(["LEFT"]).concat(new Array(STILL).fill([]));
        keys = plan.shift();
    } else keys = bot.step(p, st);
    pressKeys(C, keys); pressKeys(T, keys);
    if (p % 1000 === 0) console.log(`pass ${p}: player at ${st.px}, view ${st.view}, ${episodes.length} episodes, frames differing ${differing} of ${compared}`);
}
console.log(JSON.stringify({ control, test, passes: C.passes, end, stateIdentical: firstStateDiff === null, firstStateDiff,
    episodes: episodes.length, scrollsLeft: lefts, passesWithLeftClipped: clippedPasses, passesWithLeftEdgeOverlap: overlapPasses,
    framesCompared: compared, framesDiffering: differing, inEpisodes, worstBytes: worst,
    episodesDiffering: episodes.filter((e) => e.differing).length, diffs }));
