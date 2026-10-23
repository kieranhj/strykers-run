# Plan

What is left, most pressing first: what waits on KC, then layer 5's fixes, then the gameplay
variations' open items, then the level editor, then the ideas (KC has not ranked them). What has
landed is in `docs/done.md`, with the numbers that say so.

## Waiting on KC

- **b2 and real hardware.** The flip, ACCCON's X bit and HAZEL left paged in (Y) are seen in
  jsbeeb only (`docs/step2-layer2.md` "Open"); so are the front end's scroll text and credit line,
  run in the vsync interrupt with interrupts re-enabled (decisions 57, 60). The HUD's rupture
  (decision 67) KC has seen on b2 (2026-10-23), not yet on hardware.
- **Which ideas to build** (below): each changes how the original plays (rule 1), so each needs a
  decision first.

## Room (the listings of 2026-10-23, after grind round 3)

Free bytes by region, read off `build/strykers.lst` (the shipping disc) and
`build/strykers-gameplay.lst` (every gameplay flag). Any change that adds code or data in play
starts by finding room; the renderer reads only the first three while it draws.

| Region | Shipping | Gameplay |
|---|---|---|
| main block, below `&3400` (`SKIP unused_3400_original`; the gameplay disc's runs past it) | 97 | 10 |
| bank 4, before `REN_BASE` (`SKIP PAD_END`) | 98 | 26 |
| HAZEL, `hazel_b` below `&E000` | 48 | 1 |
| bank 4 under ANDY (`SKIP &9000 + PAD_START - *`) | 149 | 133 |
| `moved_0a20` (to `&0D00`; gameplay: to `vehicle_hits`, under `HUD_ROW`) | 159 | 21 |
| bank 5: its `&8000` block / before its music / at its end | - / 28 / 9 | 14 / 141 / 3 |
| bank 6 / bank 7, at their ends | 530 / 481 | 26 / 42 |
| the start-up code's carrier in the save arena (`arena_carried_end`) | 43 | 135 |
| `MGAME` under the loading picture (`mgame_end`'s ASSERT) | 223 | 176 |

## Layer 5 - quirks and original glitches (decision 13)

- Check in jsbeeb, then fix: a scroll column lost when moving with `frame` >= 0 (firing in a
  helicopter while moving); the column replotted after a hostile collision.

## Gameplay variations (branch `gameplay-shield`)

Kept separate from `main` for now (KC, 2026-10-21); `main` merged into it as it moves. Each
variation is a flag, off by default (flags off: byte-identical to `main`); `build.ps1 -Gameplay` /
`make gameplay` makes `build/strykers-gameplay.ssd` with all of them, the gameplay WIP. What is
built is in `docs/done.md`; the design, checks and costs in `docs/briefs/gameplay-shield.md`.

Left:
- **KC's choices:** the run meter's two sounds (now the landing's and the jump's, placeholders);
  whether bullets should destroy SAM launchers or stop at dying enemies (both pass through, as in
  the original).
- **Difficulty** (`docs/difficulty.md`, 2026-10-21): the bot finds the gameplay disc far kinder
  than the original (35 deaths against 175); whether 3 lives is enough for a person wants a
  playtest, or a count of the hits nobody could avoid (a floor).
- **KC's review** of play: the rewind's speed and distance, the timer's bonus (10 points a second).
- **`tools/timertest.mjs`'s whole-world run** sees no ticks and the time 0 at the headquarters on
  every build back to before the rupture (2026-10-23): the harness is out of step with the code;
  its `--short` and `--bonus` runs are unaffected. Fix the harness.
- **`tools/shieldtest.mjs`'s two reports** on the gameplay disc (passes 8,740 and 10,969: a hit by
  types `&11` and `&0F` that leaves the shield at 50, with no absorbed-hit sound): the same before
  and after grind round 3's merge (2026-10-23), not yet looked into; the game or the harness.
- **The bench build** (`-Shift 256 -ShiftEnd -Define DEBUG_LIVES`, what the grind proves on) does
  not assemble on this branch: bank 5 over by 247 (239 before round 3's merge; the scroll text's
  moves). Fix before another grind round here.
- **Merging into `main`**, when KC says: then one disc with both builds and a boot menu, for a
  release (the brief, "Discs").
- **Room** is nearly gone on the gameplay disc (above): the next feature there starts by moving
  something out of bank 4 or HAZEL. Five of grind round 3's candidates are off the gameplay disc
  for room (G0426, G0483, G0464, G0502, G0557, under `GAMEPLAY_ANY`: merge `dbeeebf`); room in
  HAZEL, the main block and bank 4 would let them in.

## The level editor, v1 (decision 41)

`docs/briefs/level-editor-v1.md`; the format is `docs/level-format.md`, `tools/worldmap.py` reads it.

## Speed, if it is wanted again

- **Grind round 3 is done** (`docs/done.md`, `docs/grind/README.md`): 77 kept, 2,553.6 / 2,343.1 cycles a pass saved (seed 1 / RIGHT); merged into
  `gameplay-shield` (`dbeeebf`), so `main` has it only when the branches merge. Left from it:
  47 candidates that had no room (`grind.py run --retry 'no room'` once a region grows) and 58
  stale, whose windows a round 4 would evaluate afresh. A round 4 here needs the bench build
  fixed (above).
- Layer 4's leftovers, costed in `docs/step2-layer4-costing.md` "Closed": the generic column path's
  overhead, the logic in the bursts, compiled bodies, the scroll column's rest; sky mode's own (a
  rotor byte cache, ~0.8k a draw; a cheaper leading check, ~0.15k). Most want room the renderer
  can read while it draws.

## Ideas - gameplay variations (not agreed)

Each changes how the original plays (rule 1), so each needs a decision before it is built.

- **Health packs** (KC, 2026-10-17).
- **Music in the game** (KC, 2026-10-17), now 25 Hz holds with time to spare: cycles every field,
  and RAM for the tune.
- **The flip at the next vsync** (not adopted, decision 35): tried unscaled on the gameplay disc,
  2026-10-23 (branch `flip-next-vsync`): 45 frames a second on seed 1, the game 1.8 times fast;
  KC: "leave things locked to 25Hz for now" (`docs/step2-layer4-costing.md` "Unlocked").
- **Weapons to collect** (KC and the community, 2026-10-20): e.g. a shoulder-mounted long-range
  rocket launcher for the machine-gun nests; limited ammunition for some, collected as pickups.
- **Dithering elsewhere** for non-NuLA machines: the hills are done (decision 64); the sky's tints
  were tried and rejected (65, 66).
- **Game rules presets** (KC, 2026-10-21): ORIGINAL / EASY / MEDIUM / HARD, each setting every
  rule on the game rules screen at once.
