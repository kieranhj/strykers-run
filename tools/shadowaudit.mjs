// shadowaudit.mjs - is anything the renderer reads in &3000-&3FFF, with ACCCON's X bit set (the
// CPU seeing shadow RAM), written during play? Shadow &3000-&3FFF is a copy of main's taken when
// a game starts (render_reset), so such a byte would be stale on the shadow side.
//
//   node tools/shadowaudit.mjs DISC.ssd [FRAMES]
//
// Plays tools/playscript.mjs (seed 1) for FRAMES frames (default 20000) from the boot and logs,
// from the first render_reset on: every write to &3000-&3FFF with X clear (main), every write
// to it with X set (shadow), every read of it with X set. Prints each set by address and the PC
// that touched it, and the addresses read with X set that were written in play (the problem).
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { makeScript, applyEvents, bootMaster } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const [disc, framesArg] = process.argv.slice(2);
const FRAMES = parseInt(framesArg || "20000", 10);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const symAt = {}; for (const [k, v] of Object.entries(syms)) if (v < 0x8000) (symAt[v] ||= k);
const near = (pc) => { for (let a = pc; a > pc - 0x300; a--) if (symAt[a] !== undefined) return `${symAt[a]}+${pc - a}`; return "&" + pc.toString(16); };
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
const events = makeScript(FRAMES + 10, 1);
let armed = false;
const writesMain = new Map(), writesShadow = new Map(), readsShadow = new Map();
const note = (m, a) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(near(cpu.pc)); };
cpu.debugInstruction.add((pc) => { if (pc === syms.render_reset) armed = true; return false; });
cpu.debugWrite.add((a) => { if (armed && a >= 0x3000 && a < 0x4000) note(cpu.acccon & 4 ? writesShadow : writesMain, a); return false; });
cpu.debugRead.add((a) => { if (armed && a >= 0x3000 && a < 0x4000 && (cpu.acccon & 4)) note(readsShadow, a); return false; });
for (let f = 1; f <= FRAMES; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
const show = (title, m) => {
    console.log(`${title}: ${m.size} addresses`);
    const byPc = new Map();
    for (const [a, pcs] of m) for (const pc of pcs) { if (!byPc.has(pc)) byPc.set(pc, []); byPc.get(pc).push(a); }
    for (const [pc, as] of byPc) console.log(`  ${pc}: &${Math.min(...as).toString(16)}-&${Math.max(...as).toString(16)} (${as.length})`);
};
show("written in play, X clear (main)", writesMain);
show("written in play, X set (shadow)", writesShadow);
show("read with X set", readsShadow);
const stale = [...readsShadow.keys()].filter((a) => writesMain.has(a));
console.log(`read with X set AND written in play: ${stale.length}` + (stale.length ? ` - ${stale.map((a) => "&" + a.toString(16)).join(" ")}` : ""));
