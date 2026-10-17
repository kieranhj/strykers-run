# Bugs and quirks

Numbered, kept when fixed. Each says what was seen, on what, and what fixed it.

## 1. The ground's texture depends on where the mover sprites are (original behaviour; OPEN: layer 5)

Seen 2026-10-16 by the relocation test (tools/tracediff.mjs, jsbeeb 2.5.0): with the game
assembled a page lower, the ground drew different pixels. `add_ground_to_column_buffer` reads its
pattern with `LDA (result),Y` where `result` is 0, 1, 4 or 9 - so from &0000-&001C: the screen
start address, two counters, and the zero-page sprite unpacker, whose self-modified operand at
&0005/&0006 holds the address of the last mover sprite drawn. Move the sprites and the ground
changes. Harmless in the original (the pattern only has to look random), but any step 2 change that
moves sprite data or touches that zero page will change how the ground looks. Decide then whether
to keep it (and accept a different-looking ground) or replace it with a fixed texture.
The relocation test builds (`SHIFT` set) read the pattern from &0A00 instead, identical in both.

## 2. Drawing the player's legs reads past the end of the sprite (original behaviour; OPEN: layer 5)

Seen 2026-10-16 by the relocation test: unpacking `mover_sprite_00` (SPRITE_LEGS_ONE, the last
mover sprite, ending at &3FFF) with the column pointer advanced by clipping, the unpacker read on
past the sprite's last byte - into the screen at &4000 in the original layout, so what it drew
depended on the top-left of the screen at the time. Stopped at `unpack_column_of_sprite`, Y = &1F
from &3FE1 (jsbeeb 2.5.0, frame ~2458 of the lockstep script). Not yet understood why the column
count outruns the data; to look at in step 2, where the sprites will move and this will read
something else. The relocation test builds (`SHIFT` set) put the font after this sprite so the
overrun reads the same bytes in both.

## 3. The palette split is missing from about one field in a hundred (original behaviour; FIXED in layer 1, `1041a13`)

Seen 2026-10-16 by the palette-split probe (`tools/split.mjs`, jsbeeb 2.5.0, Master 128, frames
4000-5000 of the scripted game): in the byte-identical build, 12 fields of 1,000 had neither the
top nor the bottom palette write from `irq1_handler`. The handler checks for vsync, finds none,
and chains the interrupt (the MOS's 100 Hz tick, or the User VIA T1 fire) to the MOS; a vsync
arriving in the ~30 cycles before the MOS's dispatcher reads the VIA is taken by the MOS, which
tests vsync before its timer and acknowledges it, so the game never sees that field: no split,
no User VIA T2 restart for the raster waits, no `game_over_cooldown` tick. Fixed by decision 14:
in play the MOS's System VIA IRQ mask (`&0279`) leaves vsync to the game, and the User VIA T1
fire is never chained (decision 15). 0 fields of 1,000 since. On the title the MOS still has
vsync, so the race remains there, where the only effect is the palette.

## 4. Soldiers sometimes jump 1-6 columns when they move (original behaviour; FIXED, `0a078b8`)

Seen 2026-10-16 (jsbeeb 2.5.0, Master 128, 20,000 frames of scripted play with `DEBUG_LIVES`):
at the start of `move_mover`, straight after `unplot_and_move_mover` erases the mover, the
mover's x in `mover_x_low`/`&C5` was not its real x in 81 of 8,495 moves - always a soldier
(types 1-3, the three-part sprites), 1 to 6 columns ahead. The plotter advances `mover_x_low`
column by column as it draws, and the clipping loops advance it past clipped columns; for a
mover whose last part is wider than a column, or which is clipped, the erase leaves it moved on,
and `move_mover_right`/`left` start from there. So the soldier skips forward. Fixed (KC: let it
go, decision 13's policy) by reloading the mover's x after the erase; in layer 2 the logic no
longer draws, so the cause goes too. After the fix, 8,569 of 8,569 moves start from the real x.

## 5. Layer 1's vsync wait lost OSBYTE 19's registers: the game over text was garbage (FIXED in layer 2, `63892d7`)

Found 2026-10-16 in layer 2, when the second game would not start: `text_screen` had written into
the renderer's code in bank 4. `text_screen` keeps its text's low byte in Y across
`reset_screen_scroll` (which leaves Y = `&FF`) and `clear_screen`, whose `wait_for_vsync_2242` was
OSBYTE 19 - and MOS 3.20's OSBYTE 19 falls out of its wait into `LDY &0301,X : LDA &0300,X : TAX`
(`&F0FF`), so it returns Y = `&0400`'s 0 there. Layer 1 replaced OSBYTE 19 with a wait on
`field_count` that kept Y, so the game over and completion text was read from `&FF` bytes on: the
wrong screen, and stray writes. The layer 1 front-end checks did not look at that screen. Fixed by
returning OSBYTE 19's X and Y. Checked by `tools/frontend.mjs`: the game over screen, hashed as
`text_screen` finishes it, is `1754be00fa0ba297` in the byte-identical build and in layer 2, and
was `ea8f2e8221426d18` in layer 1.

## 6. Bank 4's last sprites under the renderer's records (layer 3, `52b97c7` to `9debfee`; FIXED, `0bfe0f0`)

Found 2026-10-16 by a 5,000-pass screen lockstep: the frames of two builds that differed only in
how `history_push` copies parted at pass 4,139, at a soldier-type mover on the right edge. The
lives table (`52b97c7`) took bank 4's contents past `&B000`, the start of the renderer's
workspace: `DATA1` ended at `&B0E9`, then `&B128`, so the last ~230-300 bytes of the straight sprite
data in bank 4 lay under `rec_type` and `rec_frame`, which the renderer writes as it draws. Those
sprites drew as garbage once overwritten; where they ended depended on the code before them, so
two builds disagreed. The WIP published from `9debfee` has it. The check guarded only the
renderer's own variables (`render_end <= REN_BASE`), not the data after them. Fixed by moving the
workspace up to `&B600` (to `&BEFF`; `&BFFF` in the relocation builds) and ASSERTing that bank 4's
contents end below it. (`c5d760b` moved the workspace back to `&B400`, `REN_BASE`, with the
ASSERT kept: `src/main.6502`.) Checked: the frames of the fixed build and of `678ea21` (the last commit
before the overrun) identical over 2 x 6,000 passes.

## 7. A shot-down helicopter's explosion left on one screen (layer 2 and 3; FIXED, `c5d760b`)

Seen by KC 2026-10-16 on b2: the explosion of the helicopter he was flying stayed drawn on one of
the two screens, flickering. `kill_player_helicopter` turns the player's bullet and grenade slots
(&11, &0C) into the explosion with `use_player_position_for_mover_Y`, which copies the player's x
and screen address but not its y - and gives &0C a screen address 6 columns right of its x. So
the slots are drawn where their x and y are not (measured in `tools/helilock.mjs`: the wreck at
y 124, explosion &11 drawn over it with y 0, &0C drawn 6 columns right at y 115). The renderer
worked out what overlaps what from x, y and the type's size; with the explosion "on the ground",
the wreck could stay put while the explosion came off and on beside it, and when the explosion
ended, the wreck's save block - taken with explosion pixels under it - put them back. Fixed by
placing each record where it was drawn: `world_of_address` turns the screen address into the
world column and y (by the view it was drawn in), for the overlap rectangles and the scroll zone.
For every other mover the two agree (`tools/worldcheck.mjs`: 6,119 records, none differing).
`tools/helilock.mjs` boards a helicopter, flies until it is shot down and compares two builds
every pass; it did not catch the original case (the wreck changed every pass there), but runs
the fixed build's flights identical to its `DEBUG_FULLREDRAW` twin, and the state through a
flight identical to the control's.

## 8. A new scenery sprite's first column drawn through stale table pointers (original behaviour; FIXED in layer 4, `b10d6b5`)

Found 2026-10-17 by `tools/hazelreach.mjs` (jsbeeb 2.5.0, running right through the world): the
scroll's unpacker read HAZEL at `&C9C0-&C9FD` with `LDA (mask_table_address),Y` (`&1D09`). A
scenery sprite that starts on an edge has its first column unpacked by
`add_column_of_scenery_to_column_buffer` before `calculate_sprite_address_for_column_of_scenery`
has set the mask table pointer and the tables' page for it (`&C8`/`&C9`, `&B9`); only the pixel
table's low byte (its flip) was set. So that column used whatever was there: the last layer's mask
table (the other flip's, if theirs differed), or the multiply's leftovers, or `mover_y_max`
(`&C9`) - a mover's y, which points the reads into HAZEL in play (layer 3 measured this as 3% of
walks, for clouds). Fixed (KC; decision 30): `get_scenery_y_sprite_and_flip_for_layer_Y` sets the
mask table and the page as `calculate_sprite_address_for_column_of_scenery` does. Checked: game
state identical to `e72c386` over 6,000 passes on seeds 1 and 3; the screens (see the layer 4
costing doc for the count: 591 and 627 passes of 6,000 differ, by 5 to 11 bytes).

## 9. The mountain layer's data is HAZEL, not the MOS ROM (original behaviour; OPEN: KC)

Found 2026-10-17 (`tools/hazelwatch.mjs`, jsbeeb 2.5.0, Master 128 MOS 3.20): the MOS leaves ACCCON's
Y bit set from the start of the game on, so HAZEL (the filing system's workspace) is paged in at
`&C000-&DFFF` throughout play, and the mountain layer, whose data address starts at `&C300`
(`initial_scenery_layer_addresses_high`), reads HAZEL there - not the MOS ROM's bytes, as
`docs/briefs/step2-layer3-ram-for-cycles.md` assumed. In jsbeeb HAZEL holds zeros there; on a real
Master it holds whatever the DFS left, so the mountains depend on the machine's last disc activity.
On a Model B (the standard version) `&C300` is the MOS ROM. Reads advance a byte every 11-12
columns: `&C300-&C41B` by column 3,319 (`tools/hazelreach.mjs`; the run could go no further);
extrapolated, about `&C300-&C590` for the whole world. Kept as it is: layer 4 puts nothing in HAZEL
below `&C700` (decision 29). Fixing it means choosing what the mountains should be: KC.
