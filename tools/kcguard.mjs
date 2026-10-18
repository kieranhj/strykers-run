// kcguard.mjs - force the kind cache's arena guard (src/kindcache.6502, kc_arena_full) to fire, and
// check the screen against the oracle while it does.
//
//   node tools/kcguard.mjs ORACLE.ssd TEST.ssd [PASSES] [SEED] [END]
//
// ORACLE is TEST's DEBUG_FULLREDRAW twin (both -Shift 256 -ShiftEnd -Define DEBUG_LIVES). In TEST,
// at its first pass, slot 0's masks and pixels move from the arena's end to END (default &3A00: in
// the arena's middle) and the arena's limit with them (kc_arena_lim = END - MAX_BLOCK, its second
// word END + 1), so that any scene with more than ~1,000 bytes of live save blocks runs the arena
// past slot 0's start: the guard has to give the slot up, and blocks are written over its old
// kind. Runs tools/passlock.mjs (state every pass, the shown screen with --screen) and counts
// kc_arena_full's runs, the kind cache's draws from any slot and builds started. KCGUARD_OFF=1
// makes the guard an RTS: the same run must then differ from the oracle, or the test proves nothing.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [oracle, test, passes = "3000", seed = "5", endArg = "3A00"] = process.argv.slice(2);
const syms = {};
for (const sec of JSON.parse(readFileSync(test.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] = v.value;
const END = parseInt(endArg, 16), MAX_BLOCK = 0x2a0;
const w = (v) => [v & 0xff, v >> 8].map((b) => b.toString(16)).join(",");
const lo = (v) => (v & 0xff).toString(16), hi = (v) => (v >> 8).toString(16);
const poke = [
    `4:kc_arena_lim=${w(END - MAX_BLOCK)},${w(END + 1)}`,
    `4:kc_mbl=${lo(END - 1)}`, `4:kc_mbh=${hi(END - 1)}`,          // slot 0's masks at END
    `4:kc_pbl=${lo(END + 256)}`, `4:kc_pbh=${hi(END + 256)}`,      // its pixels 257 on (the tables hold each less 1)
    ...(process.env.KCGUARD_OFF ? ["4:kc_arena_full=60"] : []),   // KCGUARD_OFF=1: the guard an RTS (the control: it must fail)
].join(";");
for (const l of ["kc_arena_lim", "kc_mbl", "kc_pbl"]) if (syms[l] === undefined) { console.error(`no symbol ${l}`); process.exit(1); }
console.log(`slot 0's masks and pixels at &${END.toString(16)}-&${(END + 513).toString(16)}, the arena's limit &${(END - MAX_BLOCK).toString(16)}`);
const r = spawnSync("node", [new URL("./passlock.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), oracle, test, passes, seed, "--screen"],
    { env: { ...process.env, PASSLOCK_POKE: poke, PASSLOCK_COUNT: "kc_arena_full,kc_draw,kg_begin" }, encoding: "utf8" });
const last = r.stdout.trim().split("\n").filter(Boolean).pop();
console.log(last);
process.exit(r.status);
