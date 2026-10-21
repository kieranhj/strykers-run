// runmeter.mjs - GAMEPLAY_RUN's meter checked (decision 52, docs/briefs/gameplay-shield.md): the
// WorldBot plays the whole world with the run key held as well (or only every --every passes for
// --hold of them), and every pass is judged against the rules, from the meter as the pass began:
//   running   a pass in which the player ran (run_state &7F when the tick comes: only &80 DECs)
//   drain     a pass of running takes run_drain (8.8) from the meter; below 0 it is empty, run_state
//             0 (tired) and the out sound plays
//   charge    a pass not running gives back run_charge, up to RUN_FULL.0
//   half      tired, it may run again (run_state &80, the ready sound) at the first pass the meter is
//             over half (RUN_FULL / 2), and not before
//
//   node tools/runmeter.mjs DISC.ssd [--passes N] [--every E --hold H] [--drain D --charge C]
//   (--drain/--charge: 8.8 steps poked in at the first pass, as the game rules screen would set them)
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { WorldBot, startWorldGame, toWorldPass, worldState, pressKeys } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const PASSES = +opt("--passes", 6000), EVERY = +opt("--every", 0), HOLD = +opt("--hold", 0);
const DRAIN = opt("--drain", null), CHARGE = opt("--charge", null);
const disc = args[0];

const m = await startWorldGame(MachineSession, disc);
const { s, cpu, syms } = m;
for (const k of ["run_tick", "run_meter", "run_state"]) if (syms[k] === undefined) throw new Error(`${disc}: no ${k} - not a GAMEPLAY_RUN build with the meter?`);
const rd = (a, n = 1) => [...s.readMemory(a, n, { shadow: false })];
const w16 = (a, v) => s.writeMemory(a, [v & 255, v >> 8]);
if (DRAIN !== null) w16(syms.run_drain, +DRAIN);
if (CHARGE !== null) w16(syms.run_charge, +CHARGE);
const r16 = (a) => { const [lo, hi] = rd(a, 2); return hi * 256 + lo; };
const FULL = (syms.RUN_FULL ?? 250) * 256, drain = r16(syms.run_drain), charge = r16(syms.run_charge);
const fails = [];
const fail = (msg) => { if (fails.length < 30) fails.push(`pass ${m.passes}: ${msg}`); };
let sounds = [], before = null;
const ev = { ran: 0, tiredPasses: 0, outs: 0, readies: 0 };
cpu.debugInstruction.add((pc) => {
    if (pc === syms.run_tick) before = { state: rd(syms.run_state)[0], meter: r16(syms.run_meter), pass: m.passes };
    if (pc === syms.play_sound && before && before.pass === m.passes) sounds.push(cpu.a);
    return false;
});

const bot = new WorldBot();
let end = "passes", prevState = null;
for (let p = 1; p <= PASSES; p++) {
    const r = await toWorldPass(m, p);
    if (r !== "pass") { end = r; break; }
    // the tick at the start of this pass judged last pass's running: before = the meter then
    if (before && prevState !== null && before.pass === p - 1) {
        // the state the tick left: the pass's run check may have DECed it since (&80 -> &7F)
        const now = rd(syms.run_state)[0], after = { state: now === 0x7f ? 0x80 : now, meter: r16(syms.run_meter) };
        const ran = before.state === 0x7f;
        if (ran) {
            ev.ran++;
            const want = before.meter - drain;
            if (want < 0) {
                if (after.meter !== 0 || after.state !== 0) fail(`spent: meter ${after.meter}, state &${after.state.toString(16)}`);
                if (!sounds.includes(syms.RUN_OUT_SOUND ?? 0x28)) fail(`spent without the out sound`);
                ev.outs++;
            } else if (after.meter !== want || after.state !== 0x80) fail(`drained ${before.meter} -> ${after.meter} (want ${want}), state &${after.state.toString(16)}`);
        } else {
            const want = Math.min(FULL, before.meter + (before.meter >= FULL ? 0 : charge));
            if (after.meter !== want) fail(`charged ${before.meter} -> ${after.meter} (want ${want})`);
            if (before.state === 0) {
                ev.tiredPasses++;
                const over = (after.meter >> 8) > (FULL >> 9);
                if (over !== (after.state === 0x80)) fail(`tired at ${after.meter >> 8}: state &${after.state.toString(16)}`);
                if (over) { ev.readies++; if (!sounds.includes(syms.RUN_READY_SOUND ?? 0x30)) fail(`ready without its sound`); }
            } else if (after.state !== before.state) fail(`state &${before.state.toString(16)} -> &${after.state.toString(16)} not running`);
        }
        sounds = [];
    }
    const st = worldState(m);
    prevState = 0;
    const keys = bot.step(p, st);
    const run = EVERY ? p % EVERY < HOLD : true;
    if (run) keys.push("RUN");
    pressKeys(m, keys);
}
console.log(`${disc}: ${m.passes} passes (${end}); drain ${drain}, charge ${charge} (8.8); ran ${ev.ran} passes, ${ev.outs} times spent, ` +
    `${ev.tiredPasses} passes tired, ${ev.readies} times ready again`);
console.log(fails.length ? `FAILED (${fails.length}${fails.length === 30 ? "+" : ""}):\n  ` + fails.join("\n  ") : "all rules held");
process.exit(fails.length ? 1 : 0);
