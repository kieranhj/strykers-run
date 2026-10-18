# Step 2, layer 3: fast enough

**Closed 2026-10-17, tag `step2-layer3` (`07ef49c`).** Its leftovers are in PLAN.md.

2026-10-16. Measured on **jsbeeb 2.5.0, Master 128 (MOS 3.20)** with the harnesses in `tools/`.
**Not yet seen on b2 or real hardware.** The analysis and the options KC chose (all of A, B+C, D,
E; A1 index bytes) are in `docs/step2-layer3-analysis.md`. Done so far: C, A, B, parts of the
renderer's and the logic's overheads, and E (our own sound driver). Still to do: D (the landscape
column), and the rest of the list at the end.

## Result so far

Same game in each (keys by pass, `tools/passbench.mjs`, seed 1, passes 500-2000, built
`-Shift 256 -ShiftEnd -Define DEBUG_LIVES`):

| | passes/s | cycles a pass |
|---|---|---|
| Layer 2's control (`0a078b8`: one screen, EOR sprites) | 17.79 | 112,407 |
| A, B, C and the searches (`2e0fedc`) | 20.55 | 97,337 |
| + E, the 50 Hz sound driver (`828ec7a`) | 21.59 | 92,652 |
| + the pass lock not waiting (decision 26) | 23.38 | 85,535 |
| + D: the column write unrolled, the lives digit from a table | 23.86 | 83,832 |
| + the sprite loops decide per cell, not per byte, where a column ends | 24.00 | 83,350 |
| + D: the scroll's column building; BUGS #6 fixed | 24.11 | 82,948 |
| + records first, restored a part at a time (`53076ff`) | 24.21 | 82,627 |
| + the sprite column walk and draw merged (late passes, item 2, `a12b92b`) | 24.40 | 81,958 |
| + the collision searches' left edge worked out once a search (item 3, `0670ca9`) | 24.42 | 81,905 |
| + the next column built in the wait for the flip (RAM for cycles, item 1, `5ad76a8`) | 24.43 | 81,851 |
| + its rows 24-199 into the history slot in the wait (item 3, `23ace82`) | 24.43 | 81,851 |
| + movers that cannot be on the screen left out of the renderer's list (item 4, `50deb9d`) | 24.61 | 81,266 |
| + `raise_address` in one step; `move_mover`'s multiply from a table (item 4, `ea62708`) | 24.67 | 81,080 |
| + the logic's row stepping in steps, not a row at a time (item 4) | **24.70** | 80,973 |

Frame-timed play (`tools/profile.mjs`, `tools/speed.mjs`; these press keys by frame, so each
build plays a slightly different game and the numbers move a few percent with it):

| | Layer 2 (`63892d7`) | Layer 3 now |
|---|---|---|
| frames 4000-5000 (town), passes/s | 11.57 | **24.14** (2 fields or fewer: 448, 3: 34) |
| frames 16000-17000 (`DEBUG_LIVES`), passes/s | 16.58 | **24.74** (2 or fewer: 472, 3: 22) |
| `tools/speed.mjs` (RIGHT held), passes/s | 10.25 | **24.39** |

Where a pass's time went before E and decision 26 (frames 4000-5000, `tools/passcost.mjs`): waiting for the pass's slot
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
  ACCCON's X bit set). A block opens with a 4-byte header, where its parts 2 and 3 start (as
  offsets, so `compact` can move it); then each column a 3-byte record (count - 1, the address
  of its lowest byte) and its cells, 8 bytes each (the lines not drawn left unused), so moving
  up a cell is the data 8 back, the save block 8 on, the screen `&280` up. Blocks are allocated
  at the arena's top and compacted when the largest possible block (`MAX_BLOCK`, 672 bytes;
  the largest a mover needs is 636, `tools/sprites.py stats` on the layer 2 build) might not fit.
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

**The pass lock no longer waits** (decision 26, KC). A quarter of each pass (~24k cycles) was
spent waiting for the vsync that ended its 2-field slot - a pass that overran by a little waited
out the whole third field. The logic does not draw (layer 2), so the next pass's logic now starts
as soon as the frame is rendered and its flip armed; only the next render waits for that flip
(`wait_for_flip`), since until then the hidden screen holds the frame still to be shown. Frames
still change at a vsync, at least 2 fields apart. Same game: 21.59 to 23.38 passes/s; fields
between passes (`field_count` at `main_game_loop`, no longer whole slots): 1 or 2 for 1,239 of
1,500, 3 for 252, 4 for 9.

**D, the scroll's column and the lives digit** (part). `write_column` writes its 200 bytes a
character row at a time, unrolled (5.7k to 3.0k a pass with RIGHT held); the renderer writes the
lives digit from a table of the bytes `plot_lives` leaves (`src/lives_digits.6502`, from
`tools/livesdigits.py`: both pixels of every byte are written, so they do not depend on the
screen), 1.8k to ~0.5k a call. Both proved byte for byte: the shown frames of the previous commit
and this one identical over 2 x 3,000 passes. (Counts of 10 or more, which the game does not
reach, would show blank where `plot_lives` read past the font.) Same game: 23.86 passes/s.

**The sprite byte loops** decide once a cell, not once a byte, where the column ends: a cell it
carries on past runs to line 0 on `DEY`/`BPL` alone, the last stops on `CPY`; 4-7 cycles a byte
less, drawing and restoring. Proved byte for byte against the previous commit (2 x 3,000 passes).

**Running is the costliest steady state** (measured 2026-10-16, `tools/passbench.mjs --hold`,
600 passes each). Holding RIGHT: 23.43 passes/s, 104 of 600 passes over 2 fields; jumping on the
spot: 24.73; ducking: 25.04 (every pass in 2 fields). What a running pass adds is the scroll: the
logic costs ~22k against ~12.6k standing, the column built (~15k a scroll, every other pass)
before the renderer writes it into each screen. Jumping while running *feels* faster because it
is: the view moves 0.65-0.67 columns a pass jumping and 0.46 running - in the control too (278
and 390 columns over the same 600 passes), so it is the original's design, not the frame rate.
(At the original's ~16 passes/s running moved 7.7 columns a second; now 10.9.)

**D, the scroll's column building**: the scenery unpacker passes over runs that cannot change the
buffer (mask `&FF`, pixel 0) and fills those that replace it (mask 0), 3.0k to 2.1k a pass
running; the column buffer is cleared 8 bytes a time, and copied into the history 8 at a time;
`calculate_screen_addresses_for_movers_on_edge` passes over movers whose x high byte cannot put
their edge on the screen's (1.2k to 0.66k). Each leaves the registers, flags and zero page the
logic reads as the original did: the first versions of the clear and of the clear-run skip
returned with the carry flag different, and moving the clear into `history_push` broke the
passes where the player moves without the column being rebuilt (it pushes every pass). Proved by
the frames against `678ea21` and the state against the control (BUGS #6 below came out of it).

**The late passes** (brief `docs/briefs/step2-layer3-late-passes.md`; measured 2026-10-17,
`tools/passbench.mjs --detail`, `-Shift 256 -ShiftEnd -Define DEBUG_LIVES`). Passes whose work
is over 2 fields (79,872 cycles), and by how much:

| | seed 1, passes 500-2000 | holding RIGHT, passes 50-650 |
|---|---|---|
| before (`53076ff`) | 24.21/s; 298 late: 0-5k 98, 5-10k 48, 10-15k 44, 15-20k 28, 20-30k 46, 30-40k 22, 40k+ 12 | 23.72/s; 187 late: 62, 31, 28, 18, 38, 10, 0 |
| the column walk and draw merged | 24.40/s; 228 late: 59, 46, 40, 24, 43, 9, 7 | 23.96/s; 151 late: 45, 34, 16, 19, 36, 1, 0 |
| the searches' left edge once a search | 24.42/s; 223 late: 57, 46, 39, 25, 41, 9, 6 | 23.98/s; 144 late: 39, 33, 16, 19, 36, 1, 0 |
| the next column built in the wait (RAM for cycles 1) | 24.43/s; 210 late: 57, 43, 38, 21, 36, 9, 6 | 24.10/s; 129 late: 34, 31, 14, 16, 33, 1, 0 |
| and its history copy in the wait (3) | 24.43/s; 205 late: 54, 41, 38, 21, 36, 9, 6 | 24.12/s; 128 late: 34, 31, 14, 17, 31, 1, 0 |
| off-screen movers out of the renderer's list (4) | 24.61/s; 165 late: 45, 36, 26, 19, 26, 10, 3 | 24.45/s; 104 late: 33, 18, 23, 18, 11, 1, 0 |
| `raise_address` in one step, the multiply from a table (4) | 24.67/s; late frames 44 of 1,498 | 24.49/s; late frames 27 of 598 |
| the logic's row stepping in steps (4) | 24.70/s; late frames 41 of 1,498 | 24.51/s; late frames 26 of 598 |

- **The sprite column walk and draw merged** (`ren_draw_sprite` sets up a part and falls into
  `draw_column`, which loops over its columns): no call a column; the column's bottom kept as
  its character cell (`b_ptr`, zero page) with the part's line in the cell, so the first row is
  reached by moving the screen pointer alone (a cell at a time) instead of `raise_address`; each
  column's record (count - 1, address) goes 8 bytes after the previous column's last cell, so
  one pointer add a column (+11 to the first cell) replaces two (the record's +3 and the next
  record's +8), in `restore_block` too; the cell test folds in the "exactly fills the cell"
  case, so a full cell no longer tests for the column's end after it. The clip test works from
  the columns left (`ds_c`) and runs only for parts that can clip. Late-pass profile:
  `draw_column` + `ren_draw_sprite` + `raise_address` 29.1k to 27.9k, `restore_block` 13.7k to
  13.4k a late pass (more bytes drawn in the late set: 385 against 369). Proved: frames identical
  to `678ea21` over 2 x 6,000 passes and to `DEBUG_FULLREDRAW` over 6,000 and a helicopter
  flight; state identical to the control over 3 x 6,000 and a flight; front end 15/15.
- **The collision searches' left edge once a search** (`set_cm_left`): the three searches
  (`check_for_mover_collision_with_range_of_movers`, `check_for_collision_with_friends`,
  `search_for_target`) tested each mover's left edge as its x + `MOVER_WIDEST` against the
  mover's x; they now compare its x with the mover's x - `MOVER_WIDEST` (0 if that is below 0),
  worked out once before the loop. The range search also keeps its "in full from here" index
  (`last_mover` + 3) in a variable instead of working it out a mover. Leaves A, X, Y and the
  carry as the old tests did at every exit (the overflow flag differs, and nothing in the game
  reads it). `check_for_mover_collision_with_range_of_movers_loop` 4,255 to 3,424 cycles a late
  pass (seed 1), 3,005 to 2,421 holding RIGHT.
- **The next column built in the wait** (`docs/briefs/step2-layer3-ram-for-cycles.md` item 1,
  `src/prebuild.6502`): after a scroll's column is pushed, `render` (before `wait_for_flip`, if the
  flip is two fields off, or one with User VIA T2 showing about 9,000 us of it left) runs the 8
  layers' walk for the same direction on the real state, into `column_buffer`, keeps the state it
  leaves and puts the old back. The next scroll, if in that direction from the same viewport,
  keeps the column and takes that state (`start_column`, `install_prebuilt`): no clear, no walk.
  The walks became subroutines (`layers_right`, `layers_left`). What the walk reads and writes
  in zero page was measured over 3 x 20,000 frames (`zpafter`): nothing it writes is read before
  being written again, so the scroll does not set it; and in 3% of walks a cloud starts before
  any layer has set the table pointers (`&B9`, `&C8/&C9`), so the original's first column of it
  uses whatever the multiply left - the prebuild cannot know that and gives up on those. A push
  with no scroll since the last (the original's, after a hostile collision) takes the last column
  from its history slot, since `column_buffer` may hold the next one; the prebuild waits while a
  built column is unpushed (the original's lost column). `&0982-&0CFF` turned out never read or
  written after start-up (50,000 frames, front end and play), kept for items 3 and 2. Holding
  RIGHT, 75% of scrolls take the prebuilt column, 56% on seed 1 (the rest: no time in the wait,
  a change of direction, or unusable); the logic 19.2k to 17.0k a pass holding RIGHT, and the
  prebuild's 3.6k is in the wait (`passbench` now counts work `render` does before it waits as
  wait, and reports it). One bug on the way: a state change to 0 was missed (the flag was the
  new value); the frames against `678ea21` caught it and a per-push column comparison found it.
- **Its history copy in the wait** (RAM for cycles item 3): when neither screen is more than one
  push behind (so neither needs the slot the next push fills), the prebuild also copies rows
  24-199 of the column into that slot; the ground is only rows 0-23, so a scroll that takes the
  prebuilt column pushes 24 rows, not 200. Logic 17.0k to 16.3k a pass holding RIGHT (the slot is
  often still needed when the prebuild runs: jumping and scrolling every pass).
- **Movers that cannot be on the screen left out** (item 4): `render`'s list of the slots that
  matter took every live mover, ~22 holding RIGHT, most of them far off (allied helicopters
  thousands of columns away), and `mark_to_draw` called the game's `get_mover_Y_x` and
  `check_if_mover_is_on_screen` for each, every pass. A mover not drawn on this screen whose x
  high byte is past the right edge's, or more than one below the left edge's (widths are under
  256), can never be marked to go on: it is no longer listed. Render 34.6k to 31.1k a pass on
  seed 1; frames taking 3 fields 121 to 97 (seed 1) and 70 to 52 (holding RIGHT).
- **`raise_address` in one step; the multiply from a table** (item 4): `raise_address` (once a
  sprite part) works out the cells to go up and the line it ends on, and takes the whole
  `&280` multiple from an 8-entry table, instead of a cell at a time. `move_mover`'s
  `multiply_A_by_X_2f1e` with X = `&4E` (every move) became `multiply_by_78`: a 512-byte table
  at `&0B00` (made at start-up), leaving every byte, register and flag the shift-and-add loop
  leaves (result; multiplicand and multiplier_low 0; multiplier_high `&4E`; A the result's high
  byte, X `&4E`, Y 0, C clear, Z set, N clear). From here the late frames are counted as frames
  (`passbench`'s flips): 51 to 44 of 1,498 on seed 1, 30 to 27 of 598 holding RIGHT.
- **The logic's row stepping in steps** (item 4): `subtract_Y_rows_from_screen_address_in_AX`
  went up a screen address a row at a time, crossing a character cell with
  `subtract_delta_from_screen_address_in_AX`. `rows_up` does the rows inside the cell, the whole
  cells and the last crossing (by that same routine) in a step each, and leaves what the loop
  leaves: A = Y = the low byte, X the high, `unused_0076` 0, Z set, N clear; if it crossed a cell,
  `delta_low/high` `&79/&02` (they are also `last_mover` and others) and C and V as the last
  crossing left them; if not, C and V as they came. It and `multiply_by_78` live in a block
  copied to `&0A20-&0AA9` at start-up (`moved_0a20`), as the original copies its own blocks: main
  RAM below the font has 24 bytes left. `&0A00-&0A1F` is kept clear (the relocation test builds
  read it as the ground).

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

- **Compiled sprites** (RAM for cycles item 2, 2026-10-17). Which sprites the renderer draws
  (`build/j2`, `spriteuse`): an enemy helicopter's body (`&45`, 170 bytes, 21% of the drawing on
  seed 1, 17% holding RIGHT), the flying scooter (`&48`, 11%), then the player's parts. In MODE 2
  a column crosses character cells `&280` apart at lines that depend on where the sprite stands,
  so code per sprite byte needs a branch every byte (or 8 copies a sprite): ~15-17 bytes of code
  a sprite byte, ~11K for those two alone, for an estimated 1-2.5k a pass. Not built.
- **The logic a pass ahead** (item 5, which KC had agreed to on an estimate of mine that was
  wrong: it took a pass to cost the larger of its logic and its render, as if both could run at
  once). `tools/pipesim.py` replays each pass's measured logic and render cycles (one CPU,
  vsync every 39,936, a frame flipped at the first vsync after its render and 2 fields after the
  last): late frames now 75 (seed 1) and 53 (holding RIGHT) - which matches the fields the runs
  measured - against 73 and 55 with the logic one pass ahead, 72 and 52 two ahead. Decision 26
  already gives the wait to the next logic; a late frame is a heavy render, which no ordering
  hides. Not built (and no latency added). The same model says what does help: 10 cycles less a
  byte drawn takes the late frames to 48 and 32, 20 cycles to 29 and 12; 4,000 less render every
  pass to 48 and 33. (Note: "late passes", work over 2 fields, overstate it: 223 such passes
  made 75 late frames.)

- **A room check by mover type** (each type's largest save block, so the arena fills further
  before compacting): every frame identical, but 23.96 passes/s against 24.00 - compacting less
  often moves more when it does. Reverted.

- **An exact copy of the MOS's sound**: `tools/sfxcapture.mjs --pairs` shows it is stateful: in
  38 of 48 cases an effect started over another on its channel leaves the chip in a different
  state from the same effect started from silence (pitch and amplitude carry on). Its tick costs
  1,200-2,200 cycles, twice a field, nearly all in the sound code (`&F4xx-&F6xx`). KC: not needed;
  the effects are approximated (above).
- **Skipping fully transparent bytes**: 679 of 6,486 sprite bytes; a test on every byte costs
  about what the skipped ones save.

- **Building the next scroll column on the pass that does not scroll** (item 1 of the late-pass
  brief). Measured 2026-10-17, holding RIGHT, 278 scrolls: a scroll costs 10.0k, of which the
  column's pixels are 5.1k (the clear 1.3k, the scenery unpack 3.2k, the ground 0.65k) and the
  rest is state - the 8 layers' walk (`find_end_of_column_loop` alone 1.1k), the viewport, the
  edge movers. The pixels depend on that state as the scroll leaves it, so building them a pass
  early means running the scroll's state changes on a copy (~5k) besides the pixels, plus saving
  and restoring that state: ~10.5k on the pass before, to save ~4.8k on the scroll pass. Applied
  to the measured passes (each scroll pass less 4.8k, the pass before it more 10.5k): seed 1,
  298 late passes to 305; holding RIGHT, 187 to 185. Even at no cost beyond the pixels the gain
  is 298 to 259. Not built. (The brief's other note, that `update_screen` pushes the same
  column twice while the player moves: it does not now - 278 pushes for 278 scrolls holding
  RIGHT, 400 for 400 on seed 1, none with the view of the push before.)

## Next

- The passes still over 2 fields (about 1 in 9 on the benchmark) are the ones that redraw the
  most: 400-500 bytes. What is left per byte and per column in the sprite loops, the renderer's
  bookkeeping (`mark_to_draw`, `close_over_overlaps`, ~4.5k a pass), the collisions (~4.8k).

- D's rest: building the column (`add_column_of_scenery_to_column_buffer`, `history_push`, the
  edge movers' addresses: ~4.5k on a scrolling pass). Done in layer 4: `docs/step2-layer4-scroll.md`.
- A test with helicopters: done since, `tools/helilock.mjs` (boards one, flies, is shot down; two
  builds compared every pass).
- Later work on the heavy frames is in layer 4 (`docs/step2-layer4-costing.md`); what is still open
  is in PLAN.md.
