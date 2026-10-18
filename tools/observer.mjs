// observer.mjs DISC: observer mode works (BUGS #11). Sets `observer_mode` on the title, starts a
// game, holds RIGHT (the world must scroll right), then LEFT (back), then presses ESCAPE (back to
// the title, observer mode off). Observer mode reads its keys through `check_for_keypress`, a path
// play never takes, so passlock and the front end check never ran it: grind G0038 broke it
// unseen. Prints a line of JSON last, {ok, ...}; exits 1 if not ok. One of tools/grind.py's checks.
import { readFileSync } from "node:fs";
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { bootMaster, KEY, START_AT } from "./playscript.mjs";

const disc = process.argv[2];
if (!disc) { console.error("usage: node tools/observer.mjs DISC"); process.exit(2); }
const syms = {};
for (const sec of JSON.parse(readFileSync(disc.replace(/\.ssd$/, ".symbols.json"), "utf8")).assemblies[0].sections)
    for (const [k, v] of Object.entries(sec.labels || {})) if (v && typeof v.value === "number") syms[k] ??= v.value;
const ESCAPE = [0, 7];                       // internal key &70

const MachineSession = await loadMachineSession();
const s = await bootMaster(MachineSession, disc);
const rd = (a) => s.readMemory(a, 1, { shadow: false })[0];
const view = () => rd(0xb2) + 256 * rd(0xba);
const pc = () => s._machine.processor.pc;
const inLoop = () => pc() >= syms.observer_mode_loop && pc() < syms.observer_mode;
const frames = async (n) => { for (let i = 0; i < n; i++) await s.runFrames(1); };
await frames(50);
s.keyUpRaw(KEY.BOOT_SHIFT);
await frames(START_AT - 50);

const out = { ok: false };
let started = false;
for (let k = 0; k < 12 && !started; k++) {
    s.writeMemory(syms.observer_mode, [1], { shadow: false });
    s.keyDownRaw(KEY.ONE); await frames(40); s.keyUpRaw(KEY.ONE);
    for (let i = 0; i < 260 && !started; i++) { await frames(1); started = view() === 0 && inLoop(); }
}
out.started = started;
if (started) {
    await frames(20);
    const v0 = view();
    s.keyDownRaw(KEY.RIGHT); await frames(150); s.keyUpRaw(KEY.RIGHT);
    await frames(10);
    const v1 = view();
    s.keyDownRaw(KEY.LEFT); await frames(75); s.keyUpRaw(KEY.LEFT);
    await frames(10);
    const v2 = view();
    s.keyDownRaw(ESCAPE); await frames(30); s.keyUpRaw(ESCAPE);
    let left = false;
    for (let i = 0; i < 300 && !left; i++) { await frames(1); left = !inLoop() && rd(syms.observer_mode) === 0; }
    Object.assign(out, { start: v0, afterRight: v1, afterLeft: v2, escaped: left });
    out.ok = v1 > v0 + 20 && v2 < v1 && v2 >= v0 && left;
}
console.log(out.ok ? "observer mode: RIGHT, LEFT and ESCAPE all work" : "observer mode: FAILED");
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
