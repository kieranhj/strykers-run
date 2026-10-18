// zpwatch.mjs - a watch of every write, read and execute at chosen addresses, in any harness: loaded
// with node's --import, it hooks every machine the harness boots (MachineSession.loadDisc), so the
// front end, a whole world, a helicopter flight or a pass lock can each be watched without a change
// to the tool that drives it.
//
//   ZPWATCH=a2-a6,a8-af,bc-bf,d2-e6 [ZPWATCH_OUT=build/zpwatch.json] \
//       node --import ./tools/zpwatch.mjs tools/frontend.mjs build/strykers.ssd
//
// Each access is counted by machine, phase, kind and address, with the instruction that made it
// (its PC, and the nearest label before it in the code paged there - main RAM, the bank ROMSEL
// selects, ANDY, HAZEL - from that disc's symbols, or the ROM it is in):
//   phase  "boot" from the reset (the loader, the DFS loading the files) to the first title;
//          "game" from start_game until the next give_irq_back (the title's start: decision 14's
//          hand-back), which takes in the game over and completion screens; "front" the titles,
//          high scores, instructions and define controls between
//   kind   "write", "read", "exec" (an instruction fetched from a watched address); and
//          "harness-write", the harness's own writeMemory (its readMemory is not counted)
// jsbeeb reports a zero-page or stack read (readmemZpStack) with its address but not its value
// (the value argument is 0), so reads are counted by address only; writes are exact. The counts
// and the time each machine ran in each phase (fields of 40,000 cycles) go to ZPWATCH_OUT when the process exits (a
// harness that ends with process.exit still writes it), and a summary to stderr.
import { writeFileSync, readFileSync } from "node:fs";
import { resolveJsbeebSrc } from "./jsbeeb_src.mjs";

const spec = process.env.ZPWATCH || "";
const OUT = process.env.ZPWATCH_OUT || "build/zpwatch.json";
const watched = new Uint8Array(0x10000);
for (const part of spec.split(",").filter(Boolean)) {
    const [a, b] = part.split("-").map((x) => parseInt(x, 16));
    for (let i = a; i <= (b ?? a); i++) watched[i] = 1;
}
if (!spec) console.error("[zpwatch] ZPWATCH is empty: nothing watched");

// the same module instance the harness gets from loadMachineSession (the same URL)
const { src } = resolveJsbeebSrc();
const { MachineSession } = await import(`file:///${src}/machine-session.js`);

// labels by where their code runs: main RAM, a sideways bank (DATA1-4: banks 4-7; ANDY's sprites
// are data), or HAZEL (hazel_a/hazel_b: the compiled kinds' code)
function symbols(disc) {
    const regions = { ram: [], hazel: [], 4: [], 5: [], 6: [], 7: [] }, named = {};
    try {
        const secs = JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections;
        const byName = Object.fromEntries(secs.filter((s) => s.name).map((s) => [s.name, s]));
        const top = (s) => { let n = 0; while (s && s.parent && byName[s.parent] && n++ < 8) { if (/^DATA[1-4]$/.test(s.name) || /^hazel/.test(s.name)) break; s = byName[s.parent]; } return s; };
        for (const sec of secs) {
            const t = top(sec), bank = t && /^DATA([1-4])$/.exec(t.name), hz = /^hazel/.test(sec.name);
            for (const [k, v] of Object.entries(sec.labels || {})) {
                if (!v || typeof v.value !== "number") continue;
                named[k] ??= v.value;
                const a = v.value;
                const r = hz && a >= 0xc000 ? "hazel" : a >= 0x8000 && a < 0xc000 && bank ? String(+bank[1] + 3) : a < 0x8000 ? "ram" : null;
                if (r) regions[r].push([a, k]);
            }
        }
    } catch { /* no symbols: PCs only */ }
    for (const l of Object.values(regions)) l.sort((x, y) => x[0] - y[0]);
    return { regions, named };
}
function near(labels, pc) {
    let lo = 0, hi = labels.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (labels[mid][0] <= pc) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best >= 0 && pc - labels[best][0] < 0x400 ? `${labels[best][1]}+${pc - labels[best][0]}` : "?";
}
// what the instruction at `at` is: a label in the code paged there, or whose ROM it is
function where(cpu, { regions }, at) {
    const h = `&${at.toString(16)}`;
    if (at < 0x8000) return `${h} (${near(regions.ram, at)})`;
    if (at < 0xc000) {
        const bank = cpu.romsel & 15;
        if ((cpu.romsel & 0x80) && at < 0x9000) return `${h} ANDY`;
        return regions[bank] ? `${h} bank ${bank} (${near(regions[bank], at)})` : `${h} ROM ${bank}`;
    }
    if (at < 0xe000 && (cpu.acccon & 8)) return `${h} HAZEL (${near(regions.hazel, at)})`;
    return `${h} MOS`;
}
const machines = [];
const orig = MachineSession.prototype.loadDisc;
MachineSession.prototype.loadDisc = function (path, ...rest) {
    const r = orig.call(this, path, ...rest);
    if (this._zpwatch) return r;
    const cpu = this._machine.processor, syms = symbols(path);
    const m = { disc: path, phase: "boot", counts: {}, fields: { boot: 0, front: 0, game: 0 }, games: 0 };
    this._zpwatch = m;
    machines.push(m);
    const start = syms.named.start_game, back = syms.named.give_irq_back;
    let pc = 0;
    const count = (kind, addr, at) => {
        const k = `${m.phase} ${kind} &${addr.toString(16)} at ${where(cpu, syms, at)}`;
        m.counts[k] = (m.counts[k] || 0) + 1;
    };
    cpu.debugInstruction.add((at) => {
        pc = at;
        if (at === start) { m.phase = "game"; m.games++; }
        else if (at === back) m.phase = "front";
        if (watched[at]) count("exec", at, at);
        return false;
    });
    // the harness's own readMemory/writeMemory go through the same hooks: counted apart
    let harness = false;
    for (const name of ["readMemory", "writeMemory"]) {
        const fn = this[name];
        this[name] = function (...a) { harness = true; try { return fn.apply(this, a); } finally { harness = false; } };
    }
    cpu.debugWrite.add((addr) => { if (watched[addr]) count(harness ? "harness-write" : "write", addr, pc); return false; });
    cpu.debugRead.add((addr) => { if (watched[addr] && addr !== pc && !harness) count("read", addr, pc); return false; });
    // the time each phase ran, in fields (40,000 cycles), by the phase at the start of each run
    for (const name of ["runFrames", "runFor"]) {
        const fn = this[name];
        this[name] = async function (...a) { const ph = m.phase, c0 = this.elapsedCycles; const res = await fn.apply(this, a); m.fields[ph] += (this.elapsedCycles - c0) / 40000; return res; };
    }
    return r;
};

process.on("exit", () => {
    const out = { watched: spec, machines: machines.map((m) => ({ disc: m.disc, games: m.games, fields: Object.fromEntries(Object.entries(m.fields).map(([k, v]) => [k, Math.round(v)])),
        accesses: Object.fromEntries(Object.entries(m.counts).sort()) })) };
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    for (const m of out.machines) {
        const e = Object.entries(m.accesses), early = e.filter(([k]) => !k.startsWith("game")), game = e.filter(([k]) => k.startsWith("game"));
        console.error(`[zpwatch] ${m.disc}: ${m.games} game(s), fields: ${m.fields.boot.toFixed(0)} boot, ${m.fields.front.toFixed(0)} front end, ${m.fields.game.toFixed(0)} in games; ` +
            `${early.length} distinct accesses at boot and on the front end (in the file), ${game.length} in games${game.length ? ":" : ""}`);
        for (const [k, v] of game.slice(0, 80)) console.error(`  ${k}: ${v}`);
    }
    console.error(`[zpwatch] -> ${OUT}`);
});
