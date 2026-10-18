// flightscript.mjs - tools/helilock.mjs's helicopter flight as keys chosen each pass from the
// machine's state, for the single-machine benches (tools/passbench.mjs and tools/pcprof.mjs
// `--flight VARIANT`): run right to the first ally helicopter, jump past it, walk back onto it,
// board it, fly (climbing VARIANT * 10 passes in each 100, grenades every 7th pass of the rest)
// until it is shot down, then run on for 300 passes after the explosion.
//
//   const f = makeFlight(variant, syms, rd);   // rd(addr) -> byte, main RAM (shadow: false)
//   keys = f.keys(p);                           // after reaching pass p; f.done once it is over
//
// The same choices as helilock.mjs (keep the two in step), so `--flight 5` is helilock's game.
export function makeFlight(VARIANT, syms, rd) {
    const x = (i) => rd(syms.movers_x_high + i) * 256 + rd(syms.movers_x_low + i);
    const f = { phase: "run", target: null, exploded: null, boardedAt: null, done: false, log: [] };
    f.keys = (p) => {
        const px = x(0), heli = rd(0x84), expl = rd(0x8f);
        let keys = [];
        if (f.phase === "run") {
            let best = null;
            for (let i = 0x18; i <= 0x21; i++) { const xh = rd(syms.movers_x_high + i); if (xh < 0x80 && x(i) >= px - 2 && (best === null || x(i) < x(best))) best = i; }
            if (best !== null && x(best) - px < 12) { f.target = best; f.phase = "over"; }
            keys = p % 15 < 2 ? ["RIGHT", "A"] : ["RIGHT"];
        } else if (f.phase === "over") {
            if (px > x(f.target) + 14) f.phase = "back";
            keys = p % 12 < 2 ? ["RIGHT", "A"] : ["RIGHT"];
        } else if (f.phase === "back") {
            if (px <= x(f.target) + 8) f.phase = "board";
            keys = ["LEFT"];
        } else if (f.phase === "board") {
            if (heli) { f.phase = "fly"; f.boardedAt = p; f.log.push(`pass ${p}: in helicopter ${heli}`); }
            else { const k = p % 20; keys = k < 6 ? ["CTRL"] : k < 10 ? [] : k < 12 ? ["LEFT"] : []; }
        } else if (f.phase === "fly") {
            keys = p % 100 < VARIANT * 10 ? ["RIGHT", "A"] : p % 7 < 2 ? ["RIGHT", "DELETE"] : ["RIGHT", "SHIFT"];
            if (expl && f.exploded === null) { f.exploded = p; f.log.push(`pass ${p}: helicopter exploding`); }
            if (f.exploded !== null && !expl) { f.log.push(`pass ${p}: explosion over`); f.phase = "after"; }
        } else if (f.phase === "after") {
            keys = p % 15 < 2 ? ["RIGHT", "A"] : ["RIGHT"];
            if (p > f.exploded + 300) f.done = true;
        }
        return keys;
    };
    return f;
}
