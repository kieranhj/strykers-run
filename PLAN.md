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

## Room (the listings of 2026-10-23)

Free bytes by region, read off `build/strykers.lst` (the shipping disc) and
`build/strykers-gameplay.lst` (every gameplay flag). Any change that adds code or data in play
starts by finding room; the renderer reads only the first three while it draws.

| Region | Shipping | Gameplay |
|---|---|---|
| main block, below `&3400` (`SKIP unused_3400_original`; the gameplay disc's runs past it) | 193 | 9 |
| bank 4, before `REN_BASE` (`SKIP PAD_END`) | 131 | 10 |
| HAZEL, `hazel_b` below `&E000` | 155 | 1 |
| bank 4 under ANDY (`SKIP &9000 + PAD_START - *`) | 29 | 13 |
| `moved_0a20` (to `&0D00`; gameplay: to `vehicle_hits`, under `HUD_ROW`) | 142 | 4 |
| bank 5: its `&8000` block / before its music / at its end | - / 28 / 17 | 14 / 141 / 11 |
| bank 6 / bank 7, at their ends | 530 / 481 | 26 / 42 |
| the start-up code's carrier in the save arena (`arena_carried_end`) | 27 | 119 |
| `MGAME` under the loading picture (`mgame_end`'s ASSERT) | 330 | 176 |

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
- **Merging into `main`**, when KC says: then one disc with both builds and a boot menu, for a
  release (the brief, "Discs").
- **Room** is nearly gone on the gameplay disc (above): the next feature there starts by moving
  something out of bank 4 or HAZEL.

## The level editor, v1 (decision 41)

`docs/briefs/level-editor-v1.md`; the format is `docs/level-format.md`, `tools/worldmap.py` reads it.

## Speed, if it is wanted again

- **Grind round 3**, paused mid-run: `docs/grind/round3-resume.md` on branch `grind-2026-10-22`
  (the optimisers done, most of the skeptics to run). Its candidates are against that branch's
  code, so resume it there.
- Layer 4's leftovers, costed in `docs/step2-layer4-costing.md` "Closed": the generic column path's
  overhead, the logic in the bursts, compiled bodies, the scroll column's rest; sky mode's own (a
  rotor byte cache, ~0.8k a draw; a cheaper leading check, ~0.15k). Most want room the renderer
  can read while it draws.

## Ideas - gameplay variations (not agreed)

Each changes how the original plays (rule 1), so each needs a decision before it is built.

- **Health packs** (KC, 2026-10-17).
- **Music in the game** (KC, 2026-10-17), now 25 Hz holds with time to spare: cycles every field,
  and RAM for the tune.
- **The flip at the next vsync** (not adopted, decision 35): 34-37 frames a second, uneven, the
  movement scaled by the fields each pass took (`docs/step2-layer4-costing.md` "Unlocked").
- **Weapons to collect** (KC and the community, 2026-10-20): e.g. a shoulder-mounted long-range
  rocket launcher for the machine-gun nests; limited ammunition for some, collected as pickups.
- **Dithering elsewhere** for non-NuLA machines: the hills are done (decision 64); the sky's tints
  were tried and rejected (65, 66).
- **Game rules presets** (KC, 2026-10-21): ORIGINAL / EASY / MEDIUM / HARD, each setting every
  rule on the game rules screen at once.
