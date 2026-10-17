# Plan

What is left, most pressing first: the decisions waiting on KC, then the speed work, then layer
5's fixes, then the ideas (the order is the doc pass's, 2026-10-17: KC has not ranked them). What
has landed is in `docs/done.md`.

Now (`6cc44ba`, passbench, 2026-10-17): a steady 25 Hz in all but 21 of 1,498 frames on seed 1
and 1 of 598 holding RIGHT.

## Waiting on KC

- **25 Hz or 50 Hz** (decision 11 targets 50 Hz). Layer 4's costing says 50 Hz does not fit:
  option 2 would still make 364 of 2,999 frames late on seed 1. Recommended: a steady 25 Hz, as
  a new decision. The rest of layer 4 (below) depends on it.
  `docs/step2-layer4-costing.md` "The answer" and "Recommendation".
- **BUGS #9, the mountains.** They read HAZEL at `&C300`, not the MOS ROM: zeros in jsbeeb,
  whatever the filing system left on a real Master. Choose what they should be.
- **b2 and real hardware.** The flip, ACCCON's X bit and HAZEL left paged in (Y) are seen in
  jsbeeb only (`docs/step2-layer2.md` "Open").
- **Close layer 3.** Every item of its two briefs is built or set aside with measurements: tag
  `step2-layer3`?

## Speed (layer 3's leftovers and layer 4)

- **The late frames left are heavy renders** (400-500 bytes). Options, with their costing in
  `docs/step2-layer4-costing.md` "The heaviest frames":
  - the player standing, jumping and facing left compiled (~1K a part; HAZEL has 2.6K free, banks
    5-7 2.5K, bank 4 about 240 bytes - the build's listing; the start-up block that carries HAZEL's code is nearly full - `MGAME` loads to
    `&5A55`, the loading picture is at `&5A80`);
  - compaction kept out of the frame; a delta redraw for movers that stay in place;
  - the renderer's bookkeeping (`mark_to_draw`, `close_over_overlaps`, ~4.5k a pass);
  - the helicopters as compiled code (~20K: no room).
- **D's rest:** building the scroll column (`add_column_of_scenery_to_column_buffer`, the edge
  movers' addresses: ~4.5k on a scrolling pass). `docs/step2-layer3.md` "Next".
- **Scenery runs translated at build time** (RAM for cycles item 6): about half the 3.3k unpack,
  for ~25% more scenery data. `docs/briefs/step2-layer3-ram-for-cycles.md`.
- **If KC keeps 50 Hz:** one field = half a pass - player, movers (staggered), helicopters and
  projectiles each on their own cadence, vertical rates halved, pass counters doubled, render
  every field; and `tools/speed.mjs` per object type against the design rate.

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
- Music in the game, once 25 Hz holds with time to spare: cycles every field, and RAM for the
  tune (about 2.5K free in banks 5-7 and 2.6K in HAZEL; the memory map page).
