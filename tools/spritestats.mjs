// spritestats.mjs - the game's run-length sprites, decoded: what a faster format would cost.
//
//   node tools/spritestats.mjs DISC.ssd [--json OUT.json]
//
// Boots, waits for the title (everything loaded and copied down), then decodes every mover sprite
// (unflipped_mover_sprite_addresses_*_table; bank 4 or main RAM) and every scenery sprite
// (unflipped_scenery_sprite_addresses_*_table, the bank in scenery_sprite_banks): columns, rows
// per column, screen bytes, and how each byte would plot through the unflipped green pixel and
// mask tables (&0440 and &04C0: screen = screen AND mask EOR pixel) - transparent (mask &FF,
// pixel 0), opaque (mask 0) or partly masked - and the run-length data's own size.
// Format (src/game.6502 unpack_column_of_sprite): a column is a header byte, then entries
// (1x...... runs of 1 or 3, 01...... of 2, 00nnnnnn then an index byte: a run of n), then 0;
// after the 0 a negative byte ends the sprite, anything else heads the next column.
import { readFileSync, writeFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, BOOT_FRAMES } from "./playscript.mjs";
const MachineSession = await loadMachineSession();
const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json"); const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [disc] = args;
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const s = await bootMaster(MachineSession, disc);
await s.runFrames(BOOT_FRAMES); s.keyUpRaw([0, 0]); await s.runFrames(2100);
const main = (a, n) => s.readMemory(a, n, { shadow: false });
const bankRd = (bank, a, n) => s.readMemory(a, n, a >= 0x8000 ? { bank } : { shadow: false });
const pix = main(0x0440, 64), msk = main(0x04c0, 64);

function decode(bank, addr) {
    const buf = bankRd(bank, addr, 2048);
    let y = 1, cols = [], rle = 0;
    for (let col = 0; col < 64; col++) {
        const rows = [];
        for (;;) {
            const b = buf[y]; if (b === undefined) return null;
            if (b === 0) { y++; break; }
            let run, idx;
            if (b & 0x80) { run = (b & 0x40) ? 3 : 1; idx = b & 0x3f; y++; }
            else if (b & 0x40) { run = 2; idx = b & 0x3f; y++; }
            else { run = b; idx = buf[y + 1] & 0x3f; y += 2; }
            for (let i = 0; i < run; i++) rows.push(idx);
        }
        cols.push(rows);
        if (buf[y] & 0x80) { rle = y + 1; break; }
        y++;                                       // the next column's header
    }
    let t = 0, o = 0, p = 0;
    for (const c of cols) for (const i of c) { if (msk[i] === 0xff && pix[i] === 0) t++; else if (msk[i] === 0) o++; else p++; }
    return { columns: cols.length, rows: Math.max(...cols.map((c) => c.length)), bytes: t + o + p, transparent: t, opaque: o, partial: p, rleBytes: rle };
}
function table(lo, hi, n, bankOf) {
    const L = main(syms[lo], n), H = main(syms[hi], n), out = [], seen = new Set();
    for (let i = 0; i < n; i++) {
        const a = L[i] | (H[i] << 8), bank = bankOf(i);
        if (!a || a < 0x3000 || seen.has(`${bank}:${a}`)) continue;
        seen.add(`${bank}:${a}`);
        const d = decode(bank, a); if (d) out.push({ index: i, bank: a >= 0x8000 ? bank : "main", addr: a.toString(16), ...d });
    }
    return out;
}
const nMover = syms.unflipped_mover_sprite_addresses_high_table - syms.unflipped_mover_sprite_addresses_low_table;
const nScen = syms.unflipped_scenery_sprite_addresses_high_table - syms.unflipped_scenery_sprite_addresses_low_table;
const sceneryBanks = main(syms.scenery_sprite_banks, nScen);
const movers = table("unflipped_mover_sprite_addresses_low_table", "unflipped_mover_sprite_addresses_high_table", nMover, () => 4);
const scenery = table("unflipped_scenery_sprite_addresses_low_table", "unflipped_scenery_sprite_addresses_high_table", nScen, (i) => sceneryBanks[i]);
const sum = (list) => list.reduce((acc, d) => { for (const k of ["bytes", "transparent", "opaque", "partial", "rleBytes"]) acc[k] = (acc[k] || 0) + d[k]; acc.sprites = (acc.sprites || 0) + 1; return acc; }, {});
const report = { movers: sum(movers), scenery: sum(scenery) };
console.log(JSON.stringify(report, null, 1));
console.log("largest movers: " + movers.sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((d) => `#${d.index.toString(16)} ${d.columns}x${d.rows}=${d.bytes}`).join(", "));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ report, movers, scenery }, null, 1));
