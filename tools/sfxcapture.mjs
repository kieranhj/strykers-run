// sfxcapture.mjs - each of the game's 8 sound effects as the MOS plays it: the SN76489 writes,
// by centisecond tick from the SOUND call, from silence (step 2 layer 3, option E).
//
//   node tools/sfxcapture.mjs DISC.ssd OUT.json [--pairs]
//
// As tools/soundfx.mjs: plays tools/playscript.mjs (seed 1) to frame 4000, pauses the game, and
// fires each effect from a stub in the pause loop. The MOS's tick is System VIA T1, every
// 20,000 cycles; a write is put in the tick it falls in, counted from the first tick after the
// call. --pairs also fires every effect B a few ticks into every effect A on the same channel,
// and checks the chip's state from B's start against B's from silence: if they agree, an
// effect is the same whatever it replaces, and its script can simply restart.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster, gameKey } from "./playscript.mjs";
const MS = await loadMachineSession();
const args = process.argv.slice(2);
const PAIRS = args.includes("--pairs");
const [disc, out] = args.filter((a) => !a.startsWith("--"));
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MS, disc); const ev = makeScript(4100, 1);
for (let f = 1; f <= 4000; f++) { applyEvents(ev, f, [s]); await s.runFrames(1); }
s.releaseAllKeys(); await s.runFrames(20);
s.keyDownRaw(gameKey(s, "P")); await s.runFrames(10); s.keyUpRaw(gameKey(s, "P")); await s.runFrames(300);   // P: pause, let sounds end
const cpu = s._machine.processor; const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const chip = cpu.soundChip; const orig = chip.poke.bind(chip);
let log = null; chip.poke = (v) => { if (log) log.push([cyc(), v]); return orig(v); };
const W = syms.wait_for_unpause, PS = syms.play_sound, CP = syms.check_for_player_input, STUB = 0x0c00;
let fired = [];
cpu.debugInstruction.add((pc) => { if (pc === STUB) { s.writeMemory(W + 1, [CP & 255, CP >> 8]); fired.push(cyc()); } return false; });
// the MOS's ticks: entries to the IRQ vector with System VIA T1's flag up
const ticks = [];
cpu.debugInstruction.add((pc) => { if (pc === 0xe59e && log && (s.readMemory(0xfe4d, 1)[0] & 0x40)) ticks.push(cyc()); return false; });
async function fire(off) {
    s.writeMemory(STUB, [0xA9, off, 0x20, PS & 255, PS >> 8, 0x4C, CP & 255, CP >> 8]);
    s.writeMemory(W + 1, [STUB & 255, STUB >> 8]);
    const n = fired.length; while (fired.length === n) await s.runFrames(1);
    return fired[fired.length - 1];
}
// writes -> per tick lists, from the first tick after t0
function byTick(writes, t0) {
    const tk = ticks.filter((t) => t > t0);
    const res = [];
    for (const [c, v] of writes) { if (c < t0) continue; let i = tk.findIndex((t, j) => c >= t && (j + 1 === tk.length || c < tk[j + 1])); res.push([i, v]); }
    return res;
}
// the chip's registers after each tick, from a list of [tick, byte]
function states(list, ticksN, init) {
    const r = init ? { ...init } : { t0: 0x3ff, t1: 0x3ff, t2: 0x3ff, n: 0, v0: 15, v1: 15, v2: 15, v3: 15 };
    let latch = null; const outS = []; let k = 0;
    for (let t = 0; t < ticksN; t++) {
        while (k < list.length && list[k][0] === t) {
            const v = list[k][1]; k++;
            if (v & 0x80) { const ch = (v >> 5) & 3, vol = v & 0x10; latch = { ch, vol };
                if (vol) r["v" + ch] = v & 15; else if (ch === 3) r.n = v & 7; else r["t" + ch] = (r["t" + ch] & 0x3f0) | (v & 15); }
            else if (latch && !latch.vol && latch.ch < 3) r["t" + latch.ch] = (r["t" + latch.ch] & 15) | ((v & 63) << 4);
        }
        outS.push({ ...r });
    }
    return outS;
}
const effects = {};
for (let off = 0; off < 0x40; off += 8) {
    log = []; ticks.length = 0;
    const t0 = await fire(off);
    await s.runFrames(200);
    effects[off] = byTick(log, t0);
    log = null; await s.runFrames(50);
}
const result = { effects };
if (PAIRS) {
    const chan = (off) => s.readMemory(syms.sound_data_0880 + off, 1)[0] & 3;
    const report = [];
    for (let a = 0; a < 0x40; a += 8) for (let b = 0; b < 0x40; b += 8) {
        if (chan(a) !== chan(b)) continue;
        for (const gap of [3, 9, 25]) {
            log = []; ticks.length = 0;
            const ta = await fire(a); await s.runFrames(Math.ceil(gap / 2));
            const tb = await fire(b); await s.runFrames(200);
            const pair = byTick(log, tb); log = null; await s.runFrames(80);
            // compare B's own channel: from B's start, against B alone
            const N = 300, alone = states(effects[b], N), both = states(pair, N);
            const keys = chan(b) === 0 ? ["n", "v3"] : ["t" + (3 - chan(b)), "v" + (3 - chan(b))];
            let firstDiff = null;
            for (let t = 1; t < N && firstDiff === null; t++) for (const kk of keys) if (alone[t][kk] !== both[t][kk]) { firstDiff = { tick: t, reg: kk, alone: alone[t][kk], after: both[t][kk] }; break; }
            report.push({ a: a.toString(16), b: b.toString(16), gap, firstDiff });
        }
    }
    result.pairs = report;
    console.log(report.filter((r) => r.firstDiff).length, "of", report.length, "pairs differ");
    for (const r of report.filter((r) => r.firstDiff).slice(0, 20)) console.log(JSON.stringify(r));
}
writeFileSync(out, JSON.stringify(result));
console.log(disc, Object.entries(effects).map(([k, v]) => `&${(+k).toString(16)}: ${v.length} writes over ${v.length ? v[v.length - 1][0] + 1 : 0} ticks`).join("; "));
