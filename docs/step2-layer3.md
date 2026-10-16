# Step 2, layer 3: fast enough (in progress)

2026-10-16. Measured on **jsbeeb 2.5.0, Master 128 (MOS 3.20)** with the harnesses in `tools/`.
**Not yet seen on b2 or real hardware.** The analysis and the options KC chose (all of A, B+C, D,
E; A1 index bytes) are in `docs/step2-layer3-analysis.md`. Done so far: C, A, B, parts of the
renderer's and the logic's overheads, and E (our own sound driver). Still to do: D (the landscape
column), and the rest of the list at the end.

## Result so far

Same game in both (keys by pass, `tools/passbench.mjs`, seed 1, passes 500-2000, both built
`-Shift 256 -ShiftEnd -Define DEBUG_LIVES`):

| | Layer 2's control (`0a078b8`, one screen, EOR) | Layer 3 now (two screens, masked) |
|---|---|---|
| passes/s | 17.79 | **20.55** |
| cycles a pass | 112,407 | 97,337 |
| fields per pass | 2: 777, 3: 333, 4: 310, 5: 57, 6+: 23 | 2: 939, 3: 471, 4: 85, 5: 5 |

Frame-timed play (`tools/profile.mjs`, `tools/speed.mjs`; these press keys by frame, so each
build plays a slightly different game and the numbers move a few percent with it):

| | Layer 2 (`63892d7`) | Layer 3 now |
|---|---|---|
| frames 4000-5000 (town), passes/s | 11.57 | 20.58 |
| frames 16000-17000 (`DEBUG_LIVES`), passes/s | 16.58 | 20.08 |
| `tools/speed.mjs` (RIGHT held), passes/s | 10.25 | 19.58 |

Where a pass's time goes now (frames 4000-5000, `tools/passcost.mjs`): waiting for the pass's slot
25%; drawing sprites (`draw_column`) 16%; the interrupts (nearly all the MOS's 100 Hz sound tick)
10%; putting the background back (`restore_block`) 9%; collisions 5%; the sprite column walk
(`ren_draw_sprite`) 4%; the renderer's own bookkeeping ~9%. `tools/passhist.mjs` shows a pass's
work follows the bytes drawn and restored: about 70k cycles at 250 bytes, 120-160k at 400-500.

## What changed

**C - the logic's sprite walk is arithmetic** (commit `61a2a57`): `walk_column` leaves the bytes
the logic reads (`mover_x_low`, `frame_and_flip`, `screen_address`) from a table of column counts
(`src/sprite_columns.6502`), not by walking run-length data.

**A - masked sprites** (decision 24, KC). The movers' run-length sprites are gone; each is stored
straight (A1: per column the first row drawn, the count, then pixel/mask table indices top-down),
generated once by `tools/sprites.py straight` into `src/sprite_andy.6502` (53 sprites, 4,089
bytes, copied into ANDY `&8000-&8FFF` at start-up from the end of `DATA2`) and
`src/sprite_straight.6502` (the rest and the pointer tables, in bank 4). The renderer draws them
with ANDY paged in (ROMSEL `&84`), so it and its tables start at `&9000`.
- Each byte drawn: the screen byte saved, then `(screen AND mask) EOR pixel`, from the game's own
  mask and pixel tables for the mover's flip and colour (the player's rule, now everyone's).
- **Save blocks.** Each mover drawn on a screen has a save block in that screen's arena:
  `save_arena`, `&34D5-&3FFF` (2,859 bytes), freed by the main-RAM run-length sprites, in main
  RAM for the main screen and in shadow RAM for the shadow screen (the renderer draws with
  ACCCON's X bit set). A column's bytes take 8 per character cell (the lines not drawn left
  unused), so moving up a cell is the data 8 back, the save block 8 on, the screen `&280` up;
  after its cells, a 4-byte record (length, count, address). Blocks are allocated at the arena's
  top and compacted when the largest block (656 bytes, `tools/sprites.py stats`) might not fit.
- **Order.** Overlapping movers must come off in the reverse of the order they went on. A mover
  overlapping one that changes (or the scroll's columns, or the lives digit) comes off and goes
  back on too (`close_over_overlaps`, over a list of rectangles); they go on in slot order with
  the player last, and come off the player first, then from the last slot down.
- `DEBUG_FULLREDRAW` takes every mover off and puts it back every pass: the oracle for the change
  tracking (its screens must equal the normal build's).

**B - the zero-page save is the bytes the logic reads.** `tools/zplive.mjs` (four seeds, 30,000
frames each): after a render, the logic's first access to only 59 or 60 zero-page bytes is ever a
read, and the renderer's own work changes 13 of them. `save_game_zp`/`restore_game_zp` keep 34
(those, less the unpacker's code and the MOS's, plus margin), unrolled: 8.3k cycles a pass to 0.5k.

**The logic's searches.** `check_for_mover_collision_with_range_of_movers`, `search_for_target`
and `check_for_collision_with_friends` pass over a mover 256 columns or more right or left of the
range without looking up its type, width and height, except in the last two checks of a loop
(the last one that runs leaves A, Y, `&78` and `&7A` as the original did). 7.6k to 4.8k a pass
for the first; the same results, proved by the lockstep.

**The renderer's loops** walk a list of the slots that are shown or live, not all 34.

**E - our own sound driver** (decision 25, KC: approximate is fine, and reusable). First tried:
calling the MOS's own tick (`&F416`) twice from the vsync interrupt, exact by construction, saved
only the MOS's dispatch (20.55 to 20.79 passes/s). Then `src/lib/sfx50.6502`: each effect a few
ramps (period and amplitude stepping linearly over N fields, 6 bytes a ramp; the game's eight
take 158 bytes), fitted by `tools/sfx50.py` to the MOS's playing of each, captured by
`tools/sfxcapture.mjs` (kept as `tools/sfx-mos320.json`). Two of them are silent tone sweeps
that set the pitch of the explosions' noise (noise mode 7 takes tone 2's period). `play_sound`
posts effect + 1 by chip channel in `sfx_request` (below `&3000`); the vsync interrupt pages bank
5 in (restoring ROMSEL from `&F4`, which every bank switch in play writes first) and runs the
driver. Compared field by field (`tools/soundfx.mjs`): within a step or two of period and
amplitude, sometimes half a field apart. Interrupts: 10.9% of the CPU to 2.2% (765 cycles a field,
frames 4000-5000). Same game: 21.59 passes/s.

## Checks

- `tools/passlock.mjs` against layer 2's control, game state every pass: identical over
  4 x 6,000 passes (seeds 1, 3, 6, and 4 with CTRL).
- `tools/passlock.mjs --screen`, the `DEBUG_FULLREDRAW` build against the normal one: the shown
  screen identical on every pass of 3 x 6,000 (seeds 3, 5, and 2 with CTRL).
- `tools/frontend.mjs`: 15 of 15, two games.
- `passlock` now stops, and says so, when a game makes no pass for 1,500 fields; one machine
  stalling alone is a difference. Its fuel comparison is cleared at the first pass (the table's
  unused entries held `!BOOT`'s stamp, which names the debug flags).

## Found on the way

- **`compact` could loop for ever** (introduced with A, fixed before any commit): a mover drawn
  wholly clipped has an empty save block, which can share its start with the next; picking blocks
  by address alone picked it again and again. Each block is now moved once. The hang came after
  ~13,000 frames of seed 1; builds KC tried on b2 during this work may have had it.
- **A save pointer 256 bytes low** (the first cell format, fixed before any commit): a cell drawn
  to line 0 stops at "line -1", `&FF`, which an unsigned sum read as 255.

## Measured and set aside

- **An exact copy of the MOS's sound**: `tools/sfxcapture.mjs --pairs` shows it is stateful: in
  38 of 48 cases an effect started over another on its channel leaves the chip in a different
  state from the same effect started from silence (pitch and amplitude carry on). Its tick costs
  1,200-2,200 cycles, twice a field, nearly all in the sound code (`&F4xx-&F6xx`). KC: not needed;
  the effects are approximated (above).
- **Skipping fully transparent bytes**: 679 of 6,486 sprite bytes; a test on every byte costs
  about what the skipped ones save.

## Next

- D: the landscape column (build into the history slot, unrolled write, the lives digit).
- The sprite loops' remaining overhead per column; the renderer's `mark_to_draw` and
  `close_over_overlaps` (~5k a pass together).
- A test with helicopters: none of the lockstep runs boarded one (`passesInHelicopter` 0).
