// passcost.mjs - where a pass's time goes, by phase of the game, in the running build.
//
//   node tools/passcost.mjs DISC.ssd [FROM_FRAME] [FRAMES] [--right] [--json OUT.json]
//
// Plays tools/playscript.mjs (seed 1) to FROM_FRAME, then for FRAMES frames (default 1000)
// charges every cycle to the innermost PHASE on the call stack (a routine below, entered by JSR
// or JMP; left when the stack pointer rises above where it was entered), and reports per pass:
// exclusive and inclusive cycles for each phase, interrupts apart (the vsync handler, the User
// VIA T1 split, the MOS's tick). plot_mover is split by who called it: the logic's own calls
// (which only walk the sprite since layer 2), and the renderer's erase, draw and player calls.
// --right holds RIGHT throughout (scrolling every pass it can), as tools/speed.mjs does.
// Counts per pass: unpack_column_of_sprite's screen bytes (its STA), sprite columns, renderer
// erases and draws, edge columns built and written, save-under bytes.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { KEY, makeScript, applyEvents, bootMaster, START_AT, gameKey } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const rightAt = args.indexOf("--right");
const RIGHT = rightAt >= 0; if (RIGHT) args.splice(rightAt, 1);
const [disc, fromArg, framesArg] = args;
const FROM = parseInt(fromArg || (RIGHT ? String(START_AT + 1300) : "4000"), 10);
const FRAMES = parseInt(framesArg || "1000", 10);

const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;

// the phases: [label, bank (null = main RAM)]
const PHASES = [
    "check_for_player_input", "update_player", "update_projectiles", "update_movers", "update_mover",
    "update_enemy_helicopter", "move_mover", "animate_mover",
    "check_for_mover_collision_with_movers", "check_for_mover_collision_with_range_of_movers",
    "check_for_player_collision_with_mover_Y", "check_for_collision_with_friends", "search_for_target",
    "search_for_target_with_offset", "add_new_movers", "add_enemy_helicopters", "play_sound",
    "scroll_screen_right", "scroll_screen_left", "initialise_column_buffer",
    "add_column_of_scenery_to_column_buffer", "consider_adding_scenery_when_scrolling_right",
    "consider_adding_scenery_when_scrolling_left", "check_for_scenery_when_scrolling_right",
    "check_for_scenery_when_scrolling_left", "change_pixel_tables", "add_ground_to_column_buffer",
    "calculate_screen_addresses_for_movers_on_edge", "add_movers_to_column_buffer", "update_screen",
    "plot_mover", "plot_lives", "walk_column",
    "render", "history_push", "save_game_zp", "restore_game_zp", "player_needs_redrawing",
    "restore_save_under", "take_save_under", "write_column", "record_differs", "span_in_zone",
    "swap_record_in", "swap_record_out", "record_live", "check_if_mover_is_on_screen",
    "wait_for_pass_slot", "wait_for_flip", "wait_for_field_count_2242",
    "mark_to_draw", "close_over_overlaps", "take_off", "put_on", "draw_mover", "ren_draw_sprite",
    "draw_column", "restore_block", "raise_address", "up_a_cell", "compact",
].filter((n) => n in syms);
const entry = new Map(PHASES.map((n) => [syms[n], n]));
const isBank4 = (a) => a >= 0x8000 && a < 0xc000;
const irqLo = syms.irq1_handler, irqHi = syms.multiply_A_by_X_2f1e;

const s = await bootMaster(MachineSession, disc);
const events = makeScript(FROM + FRAMES + 10, 1);
for (let f = 1; f <= FROM; f++) { if (!RIGHT || f <= START_AT + 1000) applyEvents(events, f, [s]); await s.runFrames(1); }
if (RIGHT) { s.releaseAllKeys(); s.keyDownRaw(gameKey(s, "RIGHT")); }

const cpu = s._machine.processor;
const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const excl = new Map(), incl = new Map(), calls = new Map();
const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
const counts = { unpackBytes: 0, unpackColumns: 0, erases: 0, draws: 0, playerDraws: 0, columnsBuilt: 0, columnsWritten: 0, saveBytes: 0, logicPlots: 0, maskedBytes: 0, segments: 0, restoredBytes: 0 };
let stack = [], lastC = cyc(), lastName = "top level", inIrq = false, lastPc = 0, lastOp = 0, passes = 0;
const unpackSta = syms.unpack_run_loop + 6;                // STA &EEEE in the run loop
const consider = syms.consider_plotting_next_column_of_mover;
const renderSites = {};                                    // return address -> erase / draw / player
const label = (pc) => { let best = null; for (const n of ["render.erase", "render.draw", "render.player_done", "render"]) if (n in syms && syms[n] <= pc && (!best || syms[n] > syms[best])) best = n; return best; };
cpu.debugInstruction.add((pc, op) => {
    const c = cyc(), d = c - lastC; lastC = c;
    const irqCode = (pc >= 0xc000) || (pc >= irqLo && pc < irqHi);
    // charge the last instruction
    if (passes > 0) {
        if (inIrq) add(excl, lastName, d);
        else { add(excl, lastName, d); for (const n of new Set(stack.map((f) => f.name))) add(incl, n, d); }
    }
    // interrupts: entered at the IRQ vector, left after RTI; MOS called by play_sound is play_sound's
    if (pc === 0xe59e && !inIrq) { inIrq = true; lastName = "interrupts (vsync, split, MOS tick)"; }
    else if (inIrq && lastOp === 0x40) { inIrq = false; }
    if (!inIrq) {
        while (stack.length && cpu.s > stack[stack.length - 1].s) stack.pop();
        const bankOk = !isBank4(pc) || (cpu.romsel & 15) === 4;
        if (entry.has(pc) && bankOk) {
            let name = entry.get(pc);
            if (name === "plot_mover") {
                if (s.readMemory(0x9b, 1)[0] & 0x80) {
                    const ret = s.readMemory(0x100 + ((cpu.s + 1) & 0xff), 2); const site = (ret[0] | ret[1] << 8) + 1;
                    const where = renderSites[site] ||= label(site);
                    name = where === "render.erase" ? "plot_mover (render: erase)" : where === "render.draw" ? "plot_mover (render: draw)" : "plot_mover (render: player)";
                    if (name.includes("erase")) counts.erases++; else if (name.includes("draw")) counts.draws++; else counts.playerDraws++;
                } else { name = "plot_mover (logic: walk only)"; counts.logicPlots++; }
            }
            if (name === "initialise_column_buffer") counts.columnsBuilt++;
            if (name === "write_column") counts.columnsWritten++;
            stack.push({ name, s: cpu.s }); add(calls, name, 1);
        }
        lastName = stack.length ? stack[stack.length - 1].name : "main loop, other";
    }
    if (passes > 0) {
        if (pc === unpackSta) counts.unpackBytes++;
        if (pc === consider) counts.unpackColumns++;
        if (pc === syms["rect_copy.column"]) counts.saveBytes++;
        if (pc === syms["draw_column.byte"]) counts.maskedBytes++;
        if (pc === syms["draw_column.cell"]) counts.segments++;
        if (pc === syms["restore_block.byte"]) counts.restoredBytes++;
    }
    if (pc === syms.main_game_loop && !inIrq) passes++;
    lastPc = pc; lastOp = op;
    return false;
});
const c0 = cyc();
for (let f = FROM + 1; f <= FROM + FRAMES; f++) { if (!RIGHT) applyEvents(events, f, [s]); await s.runFrames(1); }
const total = cyc() - c0, P = Math.max(1, passes - 1);
const rows = [...excl.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ phase: n, perPass: Math.round(v / P), pct: +(100 * v / total).toFixed(1), inclusivePerPass: Math.round((incl.get(n) || v) / P), callsPerPass: +((calls.get(n) || 0) / P).toFixed(2) }));
const perPass = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(v / P).toFixed(1)]));
console.log(`${disc}: frames ${FROM}-${FROM + FRAMES}${RIGHT ? " (RIGHT held)" : ""}: ${P} passes, ${(P / (total / 2e6)).toFixed(2)}/s, ${Math.round(total / P)} cycles = ${(total / P / 39936).toFixed(2)} fields a pass`);
console.log("phase (exclusive)                                 per pass     %   inclusive  calls");
for (const r of rows) console.log(`  ${r.phase.padEnd(46)} ${String(r.perPass).padStart(8)} ${r.pct.toFixed(1).padStart(5)} ${String(r.inclusivePerPass).padStart(10)} ${String(r.callsPerPass).padStart(6)}`);
console.log("per pass: " + JSON.stringify(perPass));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ disc, from: FROM, frames: FRAMES, right: RIGHT, passes: P, cyclesPerPass: Math.round(total / P), rows, perPass }, null, 1));
