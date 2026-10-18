# Plan

What is left, most pressing first: the decision waiting on KC, then layer 4's speed work, then
layer 5's fixes, then the ideas (the order is the doc pass's, 2026-10-17, updated 2026-10-18: KC
has not ranked them). What has landed is in `docs/done.md`.

Now (`acd4c4a`, tag `step2-grind1`, passbench, 2026-10-18): a steady 25 Hz (decision 35) in all
but 6 of 1,998 frames on seed 1 and every one of 598 holding RIGHT. Work a pass (pcprof, the wait
excluded) 38,462 on seed 1 and 44,855 holding RIGHT, of the 79,872 two fields give.

## Waiting on KC

- **b2 and real hardware.** The flip, ACCCON's X bit and HAZEL left paged in (Y) are seen in
  jsbeeb only (`docs/step2-layer2.md` "Open").
- **When layer 4 is closed.** Proposed: no late frames on both passbench games, and the whole
  world played through: it now is (below), with 701 late frames of 12,231.

## Layer 4 - a steady 25 Hz (decision 35)

- **The late frames left are heavy renders** (400-500 bytes). Options, with their costing in
  `docs/step2-layer4-costing.md` "The heaviest frames":
  - the player standing, jumping and facing left compiled (~1K a part; room at `acd4c4a`: bank 4
    797 bytes, HAZEL 2.6K, banks 5-7 about 1.4K, and `MGAME` 2,271 bytes to carry it - the
    build's listing);
  - compaction kept out of the frame; a delta redraw for movers that stay in place;
  - the renderer's bookkeeping (`mark_to_draw`, `close_over_overlaps`);
  - the helicopters as compiled code (~20K: no room).
- **The grind, round 2** (the beeb-micro-grind skill): the windows offset by 16, the code round 1
  changed, the colder windows, and `write_column`'s history reads, which cross a page on every
  load (about 300 cycles a pass, code only). Before it: the skill's fixes in
  `docs/grind/README.md`'s report (label "no gain" apart from "slower"; mark stale a candidate
  that defines a label a kept one added; tell the optimisers round 1's failure patterns).
- **Main RAM is the tight region** (20 bytes up to `&3400`): R2/R3 of the rearrangement study (tables
  into HAZEL and the low pages) give 855, at +165 cycles a pass unless the `movers_*` tables are
  placed page-aware (`docs/decisions.md` 32-34 for the moves already made).
- **The scroll column's rest** (D's rest and RAM for cycles item 6 done on branch
  `layer4-scroll-scenery`, decisions 38-39, `docs/step2-layer4-scroll.md`: a scroll 3.9k / 3.6k
  -> 2.0k / 1.4k): the ground loop (~520 a scroll, with BUGS #1), the left edge's movers, each
  layer's next column address kept, `history_push`'s 200-row copy when the column was not
  prebuilt.

## Checks not yet made

- **The whole world, both builds' late frames** (below) want a closer look before layer 4 closes.

## The whole world (2026-10-18, jsbeeb 2.5.0, `d879af0` and decision 40's `eb8fb4f`)

Played start to completion screen by `tools/worldrun.mjs` (`tools/playscript.mjs`'s WorldBot: run
right, jump 3 passes in 30, and where the player stops, back off, throw a grenade and fire). The
stall at view 3,319 was a crouching soldier (type 3, x 3,358) against the player: bullets pass over
it, `DEBUG_LIVES`'s player cannot die on it, and the collision holds both; a grenade kills it. That
is the only stall: 12,233 passes to the headquarters (player x 7,405), no helicopter needed. The
shipping build plays the same game with infinite lives poked in (`kill_player`'s `DEC lives` made
`LDA #lives`, the bytes `DEBUG_LIVES` assembles). Screenshots: `build/world/`.
- **Against the oracle:** `-Shift 256 -ShiftEnd -Define DEBUG_LIVES` against its
  `DEBUG_FULLREDRAW` twin, every pass: state identical on 12,233 of 12,233, the newest frame
  identical on 12,233 of 12,233 (`d879af0` and `eb8fb4f` alike).
- **worldcheck** (`--world`): 984 of 29,847 records placed elsewhere than the mover's x/y, every
  one a mover clipped at the left edge: BUGS #10, since fixed (0 of 29,829). (It had never
  compared anything before.)
- **HAZEL** (`tools/hazelreach.mjs`): the mountain layer reads `&C301-&C56C` over the whole world
  (BUGS #9); nothing else in HAZEL is read but the compiled kinds and, from decision 40, its tables.
- **Late frames** (passbench's measure, passes 2 to 12,233): 701 of 12,231 frames shown 3 or more
  fields (636 for 3, 63 for 4, 2 for 5) in the bench build and the shipping build alike, 702 on
  `eb8fb4f`; 331 of 7,452 with the player on the ground, 370 of 4,779 in the air; by world column,
  46/57/137/261/50/62/86/2 per 1,000 (3,000-3,999 worst, 15%). 24.28 passes a second, 82,375
  cycles a pass. Passbench's own games over passes 500-2,500: holding RIGHT 7 late of 1,998,
  RIGHT and UP every 30 passes 45. Layer 4's "no late frames" is not met over the whole world.

## Layer 5 - quirks and original glitches (decision 13)

- BUGS #1, a fixed ground texture table (RAM for cycles item 4's ground textures as columns is
  the way); BUGS #2, the legs sprite overrun.
- Check in jsbeeb, then fix: a scroll column lost when moving with `frame` >= 0 (firing in a
  helicopter while moving); the column replotted after a hostile collision.

## Ideas - gameplay variations (KC, 2026-10-17; not agreed)

Each changes how the original plays (rule 1), so each needs a decision before it is built.
- Jump at once, without the player stopping first.
- Fire while running, without stopping.
- Run at the jumping and helicopter speed, which scrolls more smoothly: running moves the view
  0.46 columns a pass, jumping 0.65-0.67 (`docs/step2-layer3.md`).
- Or a run modifier key: today's speed becomes a jog, and the key gives a faster run.
- Health packs.
- Shields.
- Music in the game, now 25 Hz holds with time to spare: cycles every field, and RAM for the
  tune (HAZEL's 2.6K, banks 5-7; the memory map page).
- The flip at the next vsync (not adopted, decision 35): 34-37 frames a second, uneven, the
  movement scaled by the fields each pass took (`docs/step2-layer4-costing.md` "Unlocked").
