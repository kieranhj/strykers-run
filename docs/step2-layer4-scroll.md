# Step 2, layer 4: the scroll column

2026-10-18, branch `layer4-scroll-scenery` from `d879af0`. Two of PLAN.md's layer 4 items: "D's
rest" (building the scroll column: `add_column_of_scenery_to_column_buffer`, the edge movers'
addresses) and "scenery runs translated at build time" (RAM for cycles item 6,
`docs/briefs/step2-layer3-ram-for-cycles.md`). KC: continue with everything else in layer 4.
Decisions 38 and 39.

Measured on **jsbeeb 2.5.0, Master 128 (MOS 3.20)**, the bench build (`-Shift 256 -ShiftEnd
-Define DEBUG_LIVES`), `tools/pcprof.mjs --detail` on passbench's two games (seed 1, passes
500-2000; holding RIGHT, passes 50-650). Every change passed `python tools/grind.py gate` against
the commit before it (state and screen identical, seeds 1 and 3, the full-redraw oracle seed 5,
two helicopter flights, the front end).

## Result

| | work a pass, seed 1 | holding RIGHT | a scroll, seed 1 | holding RIGHT | passes over 2 fields |
|---|---|---|---|---|---|
| `d879af0` (start) | 38,461.9 | 44,854.5 | 3,915 | 3,597 | 46 of 1,499 / 29 of 599 |
| the prebuild's state left in place (decision 38, `48e86a1`) | 38,353.2 | 44,637.7 | | | |
| the right edge by x low byte; the ground's multiply from a table (`c4e676f`) | 38,142.6 | 44,234.9 | | | |
| the unpacker decides each run on its bits (decision 39, `ca825e3`) | 38,101.8 | 44,161.5 | | | 35 / 17 |
| the prebuild with less of the field left (`PRE_T2_MIN` `&D6` -> `&C8`) | **37,888.1** | **43,677.8** | **2,012** | **1,366** | **25 / 1** |

574 / 1,177 cycles a pass less work (1.5% / 2.6%); the scroll itself (`scroll_screen_left/right`)
1,045 -> 537 and 1,669 -> 633 cycles a pass. Late frames (`tools/passbench.mjs`): 6 of 1,998 on
seed 1 and 0 of 598 holding RIGHT, before and after (the late frames are heavy renders, not
scrolls). "Work" leaves out the wait for the flip, where the prebuild runs.

## What changed

**The prebuild leaves its walk's state in place** (decision 38). The column built in the wait
(`src/prebuild.6502`) used to save the 8 layers' state, walk, keep what the walk left and put the
old state back; the scroll then copied the walk's state in (`put_prebuilt_state`, ~450 cycles a
prebuilt scroll, ~110 / ~215 a pass). Now the walk's state stays and the old one is kept:
`pre_cancel` puts it back when the next scroll is not the one it was built for (`start_column`:
a turn, 4 of 400 scrolls on seed 1) or a game starts or ends with one built (`reset_screen_scroll`:
the next game's first scroll pages the last layer's bank, which the ground reads). Only the walk
and `initialise_scenery_layer_addresses` touch that state. The prebuild loses its keep-and-compare
loop too (in the wait).

**The right edge's movers by x low byte** (`edge_right`). A mover is on the right edge only if its x
is the edge's; the loop tested x high (equal for every mover near the screen, several a scroll,
each then looked up by type), now x low first, unrolled (7 cycles a mover, 1 in 256 pass). Those
that pass go through the same routine in the same order; the last mover is still taken in full,
so `&D0` and `mover_width` are left as before. The left edge is unchanged (its test needs the
mover's width; left scrolls are a sixth of seed 1's).

**The ground's multiply** (`ground_square`): `multiply_A_by_X_2f1e` with A = X = 0-3, from a table,
leaving every byte, register and flag the shift-and-add loop leaves (result X * X; multiplicand,
multiplier_low 0; multiplier_high X; A = Y = 0; Z set, N and C clear; V clear unless X = 0). ~210
cycles a scroll. The ground's own loop (~520 a scroll) is BUGS #1's (layer 5): its texture reads
`&0000-&001E`, so it is not made a table here.

**The scenery unpacker** (decision 39, RAM for cycles item 6). Item 6 planned each run stored with
its pixel byte and kind decided at build time, for ~25% more scenery data. The data (30.6K, 63
sprites, 1,091 columns, 24,682 runs, counted from the sources on 2026-10-18) decodes to 63.7K: 21,589 runs are
fills (13,948 of one byte), 1,887 merges, 1,206 clears. The original's unpacker spent ~100 cycles on
a one-byte fill, mostly deciding what the run was. But the kind is in the data already: index 0 is
the only one with mask `&FF` and pixel 0 (in both flips and both palettes: `change_pixel_tables`
changes entries 20, 40, 60), a mask of 0 is a fill, and the top two bits are the length. So
`unpack_scenery_column` decides each run on its own bits, keeps the buffer offset in X and unrolls
runs of 1-3 bytes: 49 cycles a one-byte fill. The data and its format are the original's; no
generator. `tools/scenerycols.mjs` runs every column of every scenery sprite, both flips, into a
buffer of random bytes at a random height (runs wrapping past offset 255 included) through each
build's own `add_column_of_scenery_to_column_buffer`, and compares the buffers and registers:
2,234 of 2,234 identical against `c4e676f`. (Its first run caught a difference only there: the
unrolled stores had used `column_buffer + 1,X`, which does not wrap; the game's columns never
reach offset 255, but the stores now step X between, at the same cost.) The unpack 35% cheaper:
638 -> 417 cycles a pass in the wait and 155 -> 106 in the scroll on seed 1, 1,330 -> 857 and 211
-> 140 holding RIGHT. A translated format could take the mask lookup and the index's own decode
off a run too: what is left of the unpack in the logic is ~100-140 cycles a pass, so at most
~50-70, for ~7.6K more data that banks 5-7, HAZEL and bank 4 cannot hold between them. Not
built.

**The prebuild with less of the field left**. When the flip is one field off, the prebuild starts
only if User VIA T2 shows enough of the field left. It took 9.0k cycles at the median (4.5 ms),
11.1k at p90, 14.4k at most (`ca825e3`, seed 1, 332 prebuilds, interrupts in); `&D6` (9.2 ms left)
left 60 of 400 seed-1 scrolls unbuilt for want of time. `&C8` (5.6 ms) and `&C0` (3.6 ms) both
measured: passes over 2 fields 35 -> 25 / 23 (seed 1) and 17 -> 1 / 1 (RIGHT), late frames 6 -> 6
/ 5 and 0 -> 0 / 0; `&C8` taken, which a prebuild overruns by at most ~1.6 ms.

## Where the code is

The new scroll code is in HAZEL (`src/scroll_hazel.6502`, `&D8AE-&DB57`, after the compiled kinds
in `hazel_b`: carried in `MGAME` after `&4000`, copied in by `unpack_for_play` with them), since
main RAM had 20 bytes; HAZEL is paged in through play whatever ROMSEL holds. Main RAM gained 159
bytes (the old unpacker, the right edge's loop, `install_prebuilt`'s copy).

## Free space after (`ca825e3`, the shipping build's listing)

| | before (`d879af0`) | after |
|---|---|---|
| Main RAM up to `&3400` (`SKIP unused_3400_original`) | 20 | 179 (`&334D`) |
| HAZEL `&D8AE-&DFFF` | 1,874 | 1,192 (`hazel_b_end` `&DB58`) |
| HAZEL `&C000-&C2FE` | 767 | 767 (untouched) |
| `MGAME`'s room under the loading picture | 2,271 | 1,589 (`mgame_end` `&494B`) |
| Bank 4 below `&9000` (under ANDY) | 110 | 418 (`&8E5E`) |
| Bank 4's renderer region, banks 5-7 | unchanged | |

## Not done

- The scroll's ground loop (~520 cycles a scroll): BUGS #1 (layer 5), the textures as columns.
- The left edge's movers (~270 a left scroll on seed 1): its test needs each mover's width.
- Keeping each layer's next column address (RAM for cycles 3(b)): `find_end_of_column_loop` is
  47 cycles a scroll and ~150 a pass in the wait now.
- `history_push` (~230 / ~370 a pass, render.6502): pushes 24 rows when the column was prebuilt
  and the slot free, else 200.
