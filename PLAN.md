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
  world played through (below).

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
- **D's rest:** building the scroll column (`add_column_of_scenery_to_column_buffer`, the edge
  movers' addresses: ~4.5k on a scrolling pass). `docs/step2-layer3.md` "Next".
- **Scenery runs translated at build time** (RAM for cycles item 6): about half the 3.3k unpack,
  for ~25% more scenery data. `docs/briefs/step2-layer3-ram-for-cycles.md`.
- **Tools with stale addresses:** `tools/soundfx.mjs` (a stub at `&0C00`) and
  `tools/tracediff.mjs` (the game ending at `&46E0`), since decisions 32-34.

## Checks not yet made

- **The whole world.** No harness has reached the headquarters (player x `&1CED`, the
  completion screen): `tools/hazelreach.mjs`, holding RIGHT and jumping, stops at column 3,319.

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
