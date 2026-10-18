// scenerycols.mjs DISC OUT.json (layer 4, decision 39): every column of every scenery sprite unpacked by the build's own
// add_column_of_scenery_to_column_buffer (layer 0), both flips, into a buffer of pseudo-random bytes
// at a pseudo-random y; the buffer and registers after each recorded. Compare two builds' OUT.json.
//   node tools/scenerycols.mjs DISC OUT.json     record
//   node tools/scenerycols.mjs A.json B.json     compare: the column buffer and A, X, Y, the sprite address
// 2026-10-18 (jsbeeb 2.5.0): c4e676f against the new unpacker, 2,234 of 2,234 identical.
import { readFileSync, writeFileSync } from "node:fs";
if (process.argv[2]?.endsWith(".json")) {
    const [a, b] = process.argv.slice(2, 4).map((f) => JSON.parse(readFileSync(f, "utf8")));
    let bad = 0;
    a.forEach((x, i) => { const y = b[i]; const k = (r) => JSON.stringify([r.nm, r.col, r.flip, r.y, r.buf, r.a, r.x, r.yreg, r.sa]);
        if (!y || k(x) !== k(y)) { if (bad++ < 5) console.log("differs:", x.nm, "column", x.col, "flip", x.flip); } });
    console.log(`${a.length} columns x flips, ${bad} differing${a.length !== b.length ? " (counts differ)" : ""}`);
    process.exit(bad || a.length !== b.length ? 1 : 0);
}
const T = new URL("./", import.meta.url).href;
const { loadMachineSession } = await import(T + "jsbeeb_src.mjs");
const { makeScript, applyEvents, bootMaster } = await import(T + "playscript.mjs");
const MachineSession = await loadMachineSession();
const [disc, out] = process.argv.slice(2);
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MachineSession, disc);
const cpu = s._machine.processor;
let stop = false, passes = 0;
cpu.debugInstruction.add((pc) => { if (pc === syms.main_game_loop) { passes++; if (stop || passes >= 3) return true; } return false; });
const events = makeScript(6000, 1);
for (let f = 1; f <= 6000 && passes < 3; f++) { applyEvents(events, f, [s]); await s.runFrames(1); }
s.releaseAllKeys();
const rd = (a, n, bank) => [...s.readMemory(a, n, bank === undefined ? { shadow: false } : { bank })];
const wr = (a, bytes) => s.writeMemory(a, bytes);
let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) & 255;
// the sprites, by bank (scenery_sprite_banks indexed by type; addresses from the labels)
const names = Object.keys(syms).filter((k) => /^scenery_sprite_[0-9a-f]{2}$/.test(k)).sort();
const bankOf = rd(syms.scenery_sprite_banks, 0x42);
const results = [];
const L = syms.scenery_layer_sprite_banks;
for (const nm of names) {
    const type = parseInt(nm.slice(-2), 16), bank = bankOf[type];
    let a = syms[nm];
    const mem = rd(a, 4096 > 0xC000 - a ? 0xC000 - a : 4096, bank);
    let i = 0, col = 0;
    while (i < mem.length) {
        if (i > 0 && mem[i] & 0x80) break;
        const colAddr = a + i;
        // run through the column to find its end
        let j = i + 1; while (mem[j] !== 0) { j += (mem[j] & 0xC0) ? 1 : 2; }
        for (const flip of [0, 0x40]) {
            const y = rnd() % 170, buf = Array.from({ length: 200 }, rnd);
            wr(0x300, buf);
            wr(L, [bank]);                                   // scenery_layer_sprite_banks[0]
            wr(syms.scenery_layer_sprite_addresses_high, [colAddr >> 8]);
            wr(syms.scenery_layer_sprite_addresses_low, [colAddr & 255]);
            wr(syms.scenery_layers_y, [y]);
            wr(0xB8, [flip, 0x04]); wr(0xC8, [flip + 0x80, 0x04]);   // pixel and mask table pointers
            wr(0xB7, [0]);                                   // edge_and_layer
            // call it: return to main_game_loop (stop there)
            const ret = syms.main_game_loop - 1;
            cpu.s = (cpu.s - 2) & 255;
            wr(0x101 + cpu.s, [ret & 255, ret >> 8]);
            cpu.y = 0; cpu.pc = syms.add_column_of_scenery_to_column_buffer;
            stop = true;
            await s.runFor(200000);
            const after = rd(0x300, 200);
            results.push({ nm, col, flip, y, pc: cpu.pc, a: cpu.a, x: cpu.x, yreg: cpu.y, sa: rd(0xCE, 2), buf: after.map((v) => v.toString(16).padStart(2, "0")).join("") });
        }
        i = j + 1; col++;
    }
}
writeFileSync(out, JSON.stringify(results));
console.log(disc, results.length, "columns x flips");
