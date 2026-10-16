// irqprofile.mjs - what each interrupt costs, by the source it serviced, in the running build.
//
//   node tools/irqprofile.mjs DISC.ssd [FROM_FRAME] [FRAMES] [--json OUT.json]
//
// Plays tools/playscript.mjs (seed 1) to FROM_FRAME (default 4000), then for FRAMES frames
// (default 1000) follows every interrupt from the CPU's IRQ vector to the RTI that ends it,
// charging its cycles to:
//   key       the VIA flags it cleared (IFR & IER at entry, less IFR at the RTI): "sys CA1",
//             "sys T1", "usr T1"... - what was actually serviced, not what the code meant to
//   region    where the cycles went: the game's handlers by name (from the symbol dump), the MOS
//             ROM by page (&C000-&FFFF, "MOS &E4xx"), a paged ROM by bank ("ROM 9"), sideways
//             RAM banks 4-7 by name
// Cycles are the CPU's own counter, as tools/profile.mjs reads it; an interrupt's cost runs from
// the first instruction at the vector to the instruction after its RTI, so the 7-cycle entry is
// charged to the instruction it interrupted (profile.mjs charges it the same way).
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [disc, fromArg, framesArg] = args;
if (!disc) {
    console.error("usage: node tools/irqprofile.mjs DISC.ssd [FROM_FRAME] [FRAMES] [--json OUT.json]");
    process.exit(2);
}
const FROM = parseInt(fromArg || "4000", 10);
const FRAMES = parseInt(framesArg || "1000", 10);

// ---- the game's own interrupt code, by name ----
const secs = JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections;
const syms = {};
for (const sec of secs) for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
// [start, name] for code below &8000 that can run inside an interrupt; anything else is "game ?"
const gameRegions = ["irq1_handler", "title_screen_irq1_handler", "irq_handler", "irq_vsync", "irq_t1"]
    .filter((n) => n in syms && syms[n] < 0x8000).map((n) => [syms[n], n]).sort((a, b) => a[0] - b[0]);
const regionOf = (pc, romsel) => {
    if (pc >= 0xc000) return `MOS &${(pc >> 8).toString(16).toUpperCase()}xx`;
    if (pc >= 0x8000) {
        const bank = romsel & 15;
        return bank >= 4 && bank <= 7 ? `SWRAM ${bank} &${(pc >> 8).toString(16).toUpperCase()}xx` : `ROM ${bank}`;
    }
    let best = null;
    for (const [a, n] of gameRegions) if (a <= pc) best = n;
    return best ? `game ${best}` : `game &${(pc >> 8).toString(16).toUpperCase()}xx`;
};

const SYS_BITS = ["CA2 kbd", "CA1 vsync", "SR", "CB2 lpen", "CB1 adc", "T2", "T1 100Hz"];
const USR_BITS = ["CA2", "CA1", "SR", "CB2", "CB1", "T2", "T1"];
const describe = (sys, usr) => {
    const out = [];
    for (let b = 0; b < 7; b++) if (sys & (1 << b)) out.push(`sys ${SYS_BITS[b]}`);
    for (let b = 0; b < 7; b++) if (usr & (1 << b)) out.push(`usr ${USR_BITS[b]}`);
    return out.length ? out.join(" + ") : "nothing cleared";
};

// ---- run ----
const s = await bootMaster(MachineSession, disc);
const events = makeScript(FROM + FRAMES + 10, 1);
for (let f = 1; f <= FROM; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }

const cpu = s._machine.processor, m = cpu;
const irqVector = s.readMemory(0xfffe, 2)[0] | (s.readMemory(0xffff, 1)[0] << 8);
const cyc = () => cpu.currentCycles + cpu.cycleSeconds * 2000000;
const pending = (via) => { via._catchUp(); return via.ifr & via.ier & 0x7f; };
const flags = (via) => { via._catchUp(); return via.ifr & 0x7f; };

// The MOS re-enables interrupts inside its 100 Hz tick, so interrupts nest: a stack of them, each
// charged only its own cycles (exclusive), the outer one paused while an inner one runs.
// Inside the MOS, cycles go to the innermost subroutine called (JSR target) since the interrupt
// began, so the big buckets can be looked up in the ROM: "MOS sub &F9xx".
const stack = [];           // { c0, own, sys, usr, regions: Map, calls: [], nested }
const byKey = new Map();    // key -> { count, cycles, nestedIn, regions: Map }
let lastOpcode = 0, lastPc = 0, lastCyc = 0, lastRegion = null, inIrqCycles = 0;
const finish = (r, c) => {
    const key = describe(r.sys & ~flags(m.sysvia), r.usr & ~flags(m.uservia));
    const k = byKey.get(key) || { count: 0, cycles: 0, nestedIn: 0, regions: new Map() };
    k.count++; k.cycles += r.own; k.nestedIn += r.nested ? 1 : 0; inIrqCycles += r.own;
    for (const [g, n] of r.regions) k.regions.set(g, (k.regions.get(g) || 0) + n);
    byKey.set(key, k);
};
cpu.debugInstruction.add((pc, opcode) => {
    const c = cyc();
    const top = stack[stack.length - 1];
    if (top && lastRegion !== null) {
        top.own += c - lastCyc;
        top.regions.set(lastRegion, (top.regions.get(lastRegion) || 0) + (c - lastCyc));
    }
    if (top && lastOpcode === 0x40) finish(stack.pop(), c);     // the instruction after an RTI
    else if (top && lastOpcode === 0x20) top.calls.push(pc);     // just entered a subroutine
    else if (top && lastOpcode === 0x60 && top.calls.length) top.calls.pop();
    // an IRQ (or a BRK, which the game never executes) lands on the vector
    if (pc === irqVector) stack.push({ own: 0, sys: pending(m.sysvia), usr: pending(m.uservia), regions: new Map(), calls: [], nested: stack.length > 0 });
    const cur = stack[stack.length - 1];
    if (cur) {
        lastRegion = regionOf(pc, cpu.romsel);
        if (lastRegion.startsWith("MOS")) {
            const sub = cur.calls.length ? cur.calls[cur.calls.length - 1] : null;
            lastRegion = sub !== null && sub >= 0xc000 ? `MOS sub &${sub.toString(16).toUpperCase()}` : `MOS ${lastRegion.slice(4)} (no sub)`;
        }
    } else lastRegion = null;
    lastOpcode = opcode; lastPc = pc; lastCyc = c;
    return false;
});
const c0 = cyc();
for (let f = FROM + 1; f <= FROM + FRAMES; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
const total = cyc() - c0;

// ---- report ----
const pct = (n) => +(100 * n / total).toFixed(2);
const rows = [...byKey.entries()].sort((a, b) => b[1].cycles - a[1].cycles);
const result = {
    disc, from: FROM, frames: FRAMES, cycles: total, irqVector: irqVector.toString(16),
    inInterrupts: inIrqCycles, inInterruptsPct: pct(inIrqCycles),
    sources: rows.map(([key, k]) => ({
        serviced: key, count: k.count, nested: k.nestedIn, cycles: k.cycles, pct: pct(k.cycles),
        meanCycles: Math.round(k.cycles / k.count), perField: +(k.count / FRAMES).toFixed(2),
        regions: [...k.regions.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ region: r, cycles: n, pct: pct(n) })),
    })),
};
console.log(`${disc}: frames ${FROM}-${FROM + FRAMES}, ${total} cycles; IRQ vector &${result.irqVector}`);
console.log(`in interrupts: ${inIrqCycles} cycles = ${result.inInterruptsPct}%`);
for (const r of result.sources) {
    console.log(`\n${r.serviced}: ${r.count} (${r.perField}/field), ${r.cycles} cycles = ${r.pct}%, mean ${r.meanCycles}`);
    for (const g of r.regions.slice(0, 12)) console.log(`    ${g.region.padEnd(34)} ${String(g.cycles).padStart(9)}  ${g.pct.toFixed(2).padStart(5)}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
