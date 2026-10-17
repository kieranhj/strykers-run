// hazelwatch.mjs DISC [FRAMES]: what touches HAZEL (&C000-&DFFF with ACCCON's Y bit, bit 3, set)
// after the game has started - the boot, the title, a scripted game (playscript's) - and whether
// any code runs in &C000-&DFFF while HAZEL is paged. Also proves the emulator pages HAZEL: a byte
// written with Y set must read back with Y set and not with it clear (the MOS ROM).
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, framesArg] = process.argv.slice(2);
const FRAMES = +(framesArg || 6000);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
let started = false, frame = 0;
const reads = new Map(), writes = new Map(), runs = new Map();      // page -> {n, first frame, pc}
const note = (m, a, pc) => { const p = a >> 8; const e = m.get(p) || { n: 0, frame, pc }; e.n++; m.set(p, e); };
cpu.debugInstruction.add((pc) => {
    if (pc === syms.entry_point) started = true;
    if (started && pc >= 0xc000 && pc < 0xe000 && (cpu.acccon & 8)) note(runs, pc, pc);
    return false;
});
cpu.debugRead.add((a) => { if (started && a >= 0xc000 && a < 0xe000 && (cpu.acccon & 8)) note(reads, a, cpu.pc); return false; });
cpu.debugWrite.add((a) => { if (started && a >= 0xc000 && a < 0xe000 && (cpu.acccon & 8)) note(writes, a, cpu.pc); return false; });
const events = makeScript(FRAMES, 1);
for (frame = 1; frame <= FRAMES; frame++) { applyEvents(events, frame, [s]); await s.runFrames(1); }
const show = (name, m) => console.log(`${name}: ${m.size} pages` + [...m].sort((a, b) => a[0] - b[0]).map(([p, e]) => `\n  &${(p << 8).toString(16)}: ${e.n} (first frame ${e.frame}, PC &${e.pc.toString(16)})`).join(""));
console.log(`${disc}: ${FRAMES} frames from boot; the game started: ${started}`);
show("HAZEL read with Y set, after the start", reads);
show("HAZEL written with Y set, after the start", writes);
show("code run in &C000-&DFFF with Y set, after the start", runs);
// does the emulator page HAZEL? (written and read back by poking ACCCON from here)
const acc = cpu.acccon;
cpu.writeAcccon ? cpu.writeAcccon(acc | 8) : (cpu.acccon = acc | 8);
const before = cpu.readmem(0xc123);
cpu.writemem(0xc123, before ^ 0x5a);
const withY = cpu.readmem(0xc123);
cpu.writeAcccon ? cpu.writeAcccon(acc & ~8) : (cpu.acccon = acc & ~8);
const withoutY = cpu.readmem(0xc123);
console.log(`paging: wrote &${(before ^ 0x5a).toString(16)} at &C123 with Y set; read back &${withY.toString(16)} with Y set, &${withoutY.toString(16)} with Y clear (the ROM's)`);
