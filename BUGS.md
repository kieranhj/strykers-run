# Bugs and quirks

Numbered, kept when fixed. Each says what was seen, on what, and what fixed it.

## 1. The ground's texture depends on where the mover sprites are (original behaviour; FIXED in layer 5)

Seen 2026-10-16 by the relocation test (tools/tracediff.mjs, jsbeeb 2.5.0): with the game
assembled a page lower, the ground drew different pixels. `add_ground_to_column_buffer` reads its
pattern with `LDA (result),Y` where `result` is 0, 1, 4 or 9 - so from &0000-&001C: the screen
start address, two counters, and the zero-page sprite unpacker, whose self-modified operand at
&0005/&0006 holds the address of the last mover sprite drawn. Move the sprites and the ground
changes. Harmless in the original (the pattern only has to look random), but any step 2 change that
moves sprite data or touches that zero page will change how the ground looks. Decide then whether
to keep it (and accept a different-looking ground) or replace it with a fixed texture.
The relocation test builds (`SHIFT` set) read the pattern from &0A00 instead, identical in both.
2026-10-18 (decision 34): the reach is &0000-&001E (`result` 9 plus Y up to &15), not &001C; those
bytes of the unpacker are kept byte for byte, and the dead rest of it (&001F-&0075) holds the
renderer's variables.
**Fixed** (layer 5, decision 13, 2026-10-20): `add_ground_to_column_buffer` copies the rows from a
fixed 31-byte texture, `ground_columns` (`moved_0a20`), type t's rows 0-21 at `t * t` on, as the
original's were in zero page. The texture is `ground_pixel_values[b AND 7]` for the bytes the
shipping build had at `&0000-&001E` as a scroll leaves them, with the screen start's high byte
(`&01`) fixed at `&40`; so the shipping build's ground is unchanged but where `&01` and
`mover_to_update` (`&03`) used to vary it (seed 1, pass 400: 5 of the 16,000 shown bytes, red-cyan
to red-red). The relocation test builds' patch (the texture from SRRUN's page at `&0A00`, 4 bytes)
is gone, so the bench build's layout is now the shipping build's. Evidence (jsbeeb 2.10.0, bench
builds against `a435fcb`'s): game state identical on seeds 1 and 3 (6,000 and 4,000 passes) and
both helicopter flights; the screen identical to the `DEBUG_FULLREDRAW` oracle on seed 5 (4,000
passes) and the whole world (12,237 passes); an unshifted `DEBUG_LIVES` build and the shifted bench
build now draw the same screen on all 3,000 passes of seed 1 (before, their grounds differed); the
front end and observer mode pass. The copy is faster too (RAM for cycles item 4's "ground textures
as columns"): work a pass (pcprof) 34,825.5 -> 34,794.0 on seed 1, 39,341.1 -> 39,273.5 holding
RIGHT. Its `CLC` also makes true again what `edge_left_loop` assumes on entry (C = 0): since grind
round 2, `ground_square` left C = 1 for ground types 1-3, which only changed the prefilter's
answer for slot 0, the player, never on the edge.

## 2. Drawing the player's legs reads past the end of the sprite (NOT the original's: a step 1 test build's; CLOSED in layer 5)

Seen 2026-10-16 by the relocation test: unpacking `mover_sprite_00` (SPRITE_LEGS_ONE, the last
mover sprite, ending at &3FFF) with the column pointer advanced by clipping, the unpacker read on
past the sprite's last byte - into the screen at &4000 in the original layout, so what it drew
depended on the top-left of the screen at the time. Stopped at `unpack_column_of_sprite`, Y = &1F
from &3FE1 (jsbeeb 2.5.0, frame ~2458 of the lockstep script). Not yet understood why the column
count outruns the data; to look at in step 2, where the sprites will move and this will read
something else. The relocation test builds (`SHIFT` set) put the font after this sprite so the
overrun reads the same bytes in both.
**Closed** (layer 5, 2026-10-20): the original never reads past this sprite, and step 2 cannot.
- *The original* (statically): sprite 0 is 7 columns, headers at `&3FDD`, `&3FDF`, `&3FE7`,
  `&3FEF`, `&3FF9`, `&3FFB`, `&3FFD`, its end marker `&82` at `&3FFF`; both its flipped and
  unflipped addresses are right (`&3FDD`, `&3FFD`); both clip walks stop only on headers and walk
  at most the type's width in columns (6, so 7 columns: all of sprite 0); `end_of_column`'s
  look-ahead reads `&3FFF` at most. *In jsbeeb 2.10.0*, every indexed read based inside a mover
  sprite watched on the step 1 tag's layout (`DEBUG_LIVES`, 4 seeds x 30,000 frames of the
  lockstep script; and the reference build, 12,000 frames): no read past any sprite's end; sprite
  0's bases are exactly its 7 headers.
- *What was seen*: `&3FE1` is `&3FDD + 4`, and `&3FE1 + &1F` is the sprite's own byte 31 of 35.
  The relocation builds' ground patch (BUGS #1) added 4 bytes before the sprites; until
  `unused_3400`'s fragment was shortened by those 4 bytes, the test build's sprite 0 lay at
  `&3FE1-&4003`, its last bytes under the screen, so the unpacker read its own data from `&4000`.
  The report, the patch and the shortening landed in one commit (`12017cb`), so that build cannot
  be rebuilt from git: the arithmetic is the evidence.
- *Step 2*: since layer 3 the renderer draws decoded columns (`tools/sprites.py` stops at the end
  marker) and walks exactly `sprite_column_count` columns, each 2 bytes plus its count (all 72
  straight sprites' counts end exactly at their data); clipping only skips drawing a column;
  `walk_column` reads no sprite data; the logic's plot calls read `dummy_sprite` (32 zero bytes)
  and stay inside it; the compiled kinds are code. No change was needed.
With BUGS #1 fixed as well, nothing depends any more on the data from `&3400` staying where the
original had it.

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
For every other mover the two agree (`tools/worldcheck.mjs`: 6,119 records, none differing - a
count that proved nothing: see #10).
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

## 9. The mountain layer's data is HAZEL, not the MOS ROM (original behaviour; KEPT: decision 31)

Found 2026-10-17 (`tools/hazelwatch.mjs`, jsbeeb 2.5.0, Master 128 MOS 3.20): the MOS leaves ACCCON's
Y bit set from the start of the game on, so HAZEL (the filing system's workspace) is paged in at
`&C000-&DFFF` throughout play, and the mountain layer, whose data address starts at `&C300`
(`initial_scenery_layer_addresses_high`), reads HAZEL there - not the MOS ROM's bytes, as
`docs/briefs/step2-layer3-ram-for-cycles.md` assumed. In jsbeeb HAZEL holds zeros there; on a real
Master it holds whatever the DFS left, so the mountains depend on the machine's last disc activity.
On a Model B (the standard version) `&C300` is the MOS ROM. Reads advance a byte every 11-12
columns: `&C300-&C41B` by column 3,319 (`tools/hazelreach.mjs`; the run could go no further);
extrapolated, about `&C300-&C590` for the whole world. Measured over the whole world 2026-10-18
(`tools/hazelreach.mjs` with `tools/playscript.mjs`'s WorldBot, `-Shift 256 -ShiftEnd -Define
DEBUG_LIVES` at `d879af0`, jsbeeb 2.5.0, 12,233 passes to the completion screen): `&C301-&C56C`,
1,242 reads, and nothing else in HAZEL read but the compiled kinds' code (`&C700-&D8AD`). Kept as it is: layer 4 puts nothing in HAZEL
below `&C700` (decision 29). KC, 2026-10-17: leave it (decision 31) - the mountains stay as the
enhanced version draws them, from whatever HAZEL holds at `&C300`; nothing may be put in
`&C300-&C6FF`.

## 10. A mover clipped at the view's left edge is placed 80 columns right and a row up (layer 3, `c5d760b`; FIXED in layer 4)

Found 2026-10-18 by `tools/worldcheck.mjs`, once it read the records at all (jsbeeb 2.5.0,
`d879af0`). `world_of_address` (`src/render.6502`, BUGS #7's fix) turns a mover's screen address
into its world column and y. A mover partly off the left edge (x 1-11 columns left of
`viewport_left`) has a screen address left of the view's first column: the end of the character
row above. So `record_live` records it, and `list_live` lists it, 80 columns right and 8 lines up
(e.g. a soldier at x 30, y 24 with the view at 31: screen address `&77F7`, screen start `&4378`,
offset `&347F` - row 20, column 79 - recorded at x 110, y 32). Those world positions are what
`span_in_zone` (the scroll's arriving and leaving columns, the lives digit's columns) and
`close_over_overlaps` test.
- Measured (2026-10-18, layer 4's `8ae47e4`, the bench build `-Shift 256 -ShiftEnd -Define
  DEBUG_LIVES`): the whole world (`--world`, 12,233 passes) 984 of 29,847 records disagree, all
  984 this case, none other; 17 types (soldiers, helicopters, mines, the tank, bullets). Seed 1's
  script (`tools/worldcheck.mjs DISC 12000`) 521 of 9,132. The `99185f2` build (before decisions
  32-34) does the same, and decision 40's `eb8fb4f` (46 of 1,330 records over 4,000 frames).
- **Scrolling left past it does not show** (`tools/scrollleft.mjs`, the bench build against its
  `DEBUG_FULLREDRAW` twin, state and newest frame every pass): over the whole world with LEFT held
  for 60 passes wherever a mover is clipped at the left edge, 62 episodes, 1,734 scrolls left,
  3,094 passes with such a mover: 0 of 19,019 frames differ; holding still after the scroll, or
  instead of it, 0 of 20,000 and 0 of 16,803. The +80 is why: on a scroll the zone holds the
  arriving column at one edge and the leaving column at the other, and the column one left of the
  view is, in memory, the last column of the row above - so the misplaced rectangle always takes in
  the other edge's zone column, and the mover is redrawn when it should be. The lives digit's
  columns, the one zone with no partner, are tested alone only when the count changes without a
  scroll, and the digit is in the top row, where no clipped mover was seen.
- **An overlap at the left edge does show.** `close_over_overlaps` misses a clipped mover's
  overlap with a neighbour, so a lower slot that changes (taken off and put back every pass) over a
  higher one that stays wipes it with its save block, and nothing puts it back. Hardly met in play
  (a lower slot over a clipped mover on 3 passes of the 19,019, no frame differing; an overlap
  either way on none of the 36,803 holding still); made by `scrollleft.mjs --left 0
  --still 40 --place` (each time a mover is clipped at the left edge, the lowest-slot soldier below
  it moved onto it: x + 1, its y, its screen address + 8, in both machines; then no key for 40
  passes): over 4,000 passes, 73 frames differ from the oracle (up to 130 bytes), in 2 episodes of
  20 - the red helicopter (type 8, slot 24, x 748, view 749) with soldier 6 walking over it,
  passes 1,521-1,560, and a type &0B (slot 25, x 1,382) with officer 5 over it, from pass 2,850.
  State identical throughout.
- Right-clipped movers: nothing wraps. A mover goes on only with x <= `viewport_right`
  (`check_if_mover_is_on_screen`), so its address is in its own row; only BUGS #7's explosion,
  given an address 6 columns right of its x, could land in the next row's first columns - and is
  drawn there (`draw_mover` clips by x from the address), so that is the place to record.
- **Fixed** in `world_of_address`: a column of 69-79 is the row above only if the mover is in the
  view; if its x is 80 columns left of that place (the low bytes tell: the two cases are 74 apart)
  it is the next row, 80 columns left. A row-25 address (the ring's 48 hidden columns past the
  last row: a mover clipped at the left of the first row) is the first row, 48 columns left. The
  slot comes in `dm_slot` (`put_on` sets it; `list_live` now does, 3 cycles). By the code, the
  fast path costs 4 cycles a call (the column test replaces a CLC; row 25 is the y sum's carry), a
  column of 69-79 in the view 20 more. Measured, work a pass (pcprof, the gate's measure, against `8ae47e4`): 38,446.3 -> 38,432.2
  on seed 1 (14.1 fewer: fewer needless redraws of the misplaced records), 44,844.0 -> 44,846.0
  holding RIGHT (2.0 more). Over the whole world 29,829 records against 29,847: 18 fewer redraws,
  the play the same.
- Proven: worldcheck 0 of 29,829 records over the whole world, 0 of 9,132 on seed 1; the
  constructed overlap 0 of 4,000 frames differing from the oracle (73 before), the scroll-left runs
  0 of 19,019; `tools/grind.py gate` with `8ae47e4` as control: every build assembles, state and
  screen identical over 6,000 passes of seed 1 and 4,000 of seed 3, the `DEBUG_FULLREDRAW` twin
  identical over 4,000 of seed 5, both helicopter flights with no frame differing, the front end's
  15 checks, observer mode.
- `tools/worldcheck.mjs` never compared anything before this was found: `rec_*` are assignments
  (`REN_BASE + n`) in Baron's symbol dump, not labels, and it read only labels, so every address
  was `undefined` and both sides read the same byte. It now reads both (`tools/playscript.mjs`
  `loadSyms`) and counts this case apart from any other.

## 11. Observer mode's keys dead: grind G0038 removed the TXA `check_for_keypress` jumped past (step 2 grind; FIXED in layer 4)

Found 2026-10-18 by the level map's capture harness (`tools/worldshots.mjs`, jsbeeb 2.5.0, Master
128). Grind round 1's G0038 (`d96cb3f`) made `keydown_int` take the key number in X and dropped its
leading TXA, so it now starts with a 2-byte `LDY #`; `check_for_keypress` (observer mode's three
key tests: RIGHT, LEFT, ESCAPE) still did `JSR keydown_int + 1`, into that instruction's operand.
No key worked in observer mode (`tools/observer.mjs` on the broken build: the view stayed at 0 for
150 frames of RIGHT, ESCAPE never left). Play, the front end and define controls never take this
path, so none of the gate's checks ran it, and G0038's skeptics missed the `+ 1` caller. Fixed: the
same ten bytes now `TXA : EOR #&FF : TAX : JSR keydown_int : EOR #&80 : RTS` (RIGHT 0 -> 76, LEFT
back to 37, ESCAPE to the title). `tools/observer.mjs` is now one of `tools/grind.py`'s checks.

## 12. The generator's low byte was the original's scratch: every death set it to the dying mover's slot (step 2, decision 17; FIXED in layer 4)

Found 2026-10-18 by `tools/sidebyside.mjs` (jsbeeb 2.5.0, Master 128: the original and step 2
playing the same game by pass), on seed 1's script: the two parted at pass 571. Decision 17 put
`random`'s 16-bit xorshift state at `&92`/`&93` on a watch that saw "no access after boot in
30,000 frames" (2026-10-16), but the original's own `set_dying_mover_type_and_frame` keeps the
dying mover's slot in `&92` across a call: `STY &92 : LDX &92 : JSR
check_for_player_collision_with_mover_Y : LDY &92`. So each time a mover died the generator's
low byte became the slot. A game still replayed exactly from its input (the clobber is as
deterministic as the rest), but from the first death the numbers were not decision 17's
generator's: each death put a slot (1-&21) in the low byte. And one case would stick it: the player
(slot 0) dying with the high byte 0 leaves the state 0, from which `random` returns 0 for ever.
By the code that is only the player's last death (`kill_player` reaches
`set_dying_mover_type_and_frame` only when `lives` reaches 0), so the game ends soon after and
`start_game` re-seeds; it was not seen.
- Measured on the control (`72ab52b`, the bench build `-Shift 256 -ShiftEnd -Define
  DEBUG_LIVES`), with `tools/passlock.mjs`'s new clobber count (`tools/playscript.mjs`
  `prngClobber`): seed 1, 24 clobbers in 6,000 passes, the first at pass 571; seed 3, 19 in
  4,000 (first at 667); seed 5, 15 in 4,000 (first at 480); the helicopter flights 17 and 13 (first
  at 225); the whole world 98 in 12,237 passes (first at 225). Every one changed the low byte.
- **Fixed**: the state is at **`&BC`/`&BD`** (`src/zp.6502`), and `take_irq_for_play` seeds it
  last, after its two OSBYTEs, just before `JMP start_game`, so the bytes need last only through
  the game. `&92` stays the original's scratch, untouched. `save_game_zp`/`restore_game_zp` no
  longer keep `&92`/`&93` (they were kept for the generator; `&92` is now written before it is
  read, and the renderer never writes either): `zp_save + 12` and `+ 13` are unused.
- **Why `&BC`/`&BD`**: a watch of every write, read and execute of `&92-&93`, `&A2-&A6`,
  `&A8-&AF`, `&BC-&BF` and `&D2-&E6` (`tools/zpwatch.mjs`, new: any harness, by phase - boot,
  front end, game - and the code that made each access) over the front end's 15 checks (two games,
  game over, high score entry, define controls, pause), seed 1's 6,000 passes, both helicopter
  flights (to the explosion and after) and the whole world to the completion text, on the control
  and on the fixed build (the fixed build's seed 1, 3 and 5 runs below watched `&92`/`&93` and
  `&BC`/`&BD` only). In games (from `start_game` to the title's `give_irq_back`) nothing
  touched any of those bytes on the control but `&92`/`&93` (`random`, `save_game_zp`,
  `restore_game_zp`, `set_dying_mover_type_and_frame`); on the fixed build nothing touched
  `&BC`/`&BD` but `random` (and the seeding in `take_irq_for_play`, on the front end), and nothing
  touched the others at all. On the front end after the boot, no write to any of them. The MOS
  (ROM 15) and the DFS (ROM 9, and its NMI code at `&0D00`) write them all while booting, which
  does not matter: `start_game` re-seeds. jsbeeb reports a zero-page read with its address but not
  its value, so reads were counted by address; by the source, no instruction names `&BC`-`&BF`,
  and the only indexed zero-page store (`STA screen_start_address,X`) has X 0-1. Of the candidates,
  `&BC`/`&BD` are the filing system's scratch, next to the `&B0-&BB` the game already takes from it,
  and in play nothing calls a filing system (the NMI workspace `&A0-&A7`, which an Econet
  interrupt could use, and the VDU's and MOS's `&D0-&E6` were passed over).
- **Proven** (jsbeeb 2.5.0, 2026-10-18; control `72ab52b`, test the fix, both the bench build):
  - Up to the first clobber the fix changes nothing: `passlock.mjs CONTROL TEST 600 1 --screen`
    has state and screen identical for passes 1-571 and the first difference at the start of pass
    572, `rnd_seed` only (`&53 &FC` against `&84 &5D`): the first clobber was in pass 571, the first
    of the game in both builds.
  - Against the control with the clobber undone in the emulator (`--unclobber`: after the `LDY
    &92`, the generator's byte put back, which is what the fix does by never losing it), the same
    game: `passlock.mjs` state and screen identical over 6,000 passes of seed 1 (24 undone), 4,000 of
    seed 3 (19) and 4,000 of seed 5 (15); `helilock.mjs` both flights, state every pass and no
    frame differing (variant 5: boarded at 1,201, shot down at 1,251, 1,552 passes, 17 undone;
    variant 2: boarded at 1,201, flying at 3,000, 13 undone); `worldrun.mjs TEST --control CONTROL
    --screen --unclobber` the whole world, both at the completion screen at pass 12,237, state
    identical every pass and 0 of 12,237 frames differing (98 undone).
  - `tools/grind.py gate` against `72ab52b` (its control checks now pass `--unclobber`, which does
    nothing for a control after the fix): every build assembles; state and screen identical over
    6,000 passes of seed 1 and 4,000 of seed 3; the `DEBUG_FULLREDRAW` twin identical over 4,000 of
    seed 5; both helicopter flights with no frame differing; the front end's 15 checks; observer
    mode.
- **Work a pass** (pcprof, the gate's measure, on the same game: the control with `--unclobber`,
  which `tools/pcprof.mjs` now takes too; `build/grind`'s images of the control and the test):
  seed 1 37,967.3 -> 37,934.3 (33.0 fewer), holding RIGHT 44,196.6 -> 44,168.3 (28.3 fewer); by
  pass, 26-30 fewer on almost every pass: the 28 cycles of the two bytes `save_game_zp` and
  `restore_game_zp` no longer keep. The gate's own figures (37,934.3
  and 44,168.3 against the control's 37,862.7 and 43,669.3, "71.6 and 499.0 more") compared
  different games: its measure did not undo the clobber, so from the first death the control
  played another game. Its measure now passes `--unclobber` too (`tools/grind_config.py`).
- `tools/sidebyside.mjs` mirrors the original's writes to `&92`/`&93` into its generator only for a
  step 2 build that keeps the state there (one from before this fix); for the fixed build there is
  nothing to mirror. Seed 1, 4,000 fields, against `make original`: the fixed shipping build plays
  the original's game, state identical over the 1,290 passes both reached and the 492 random bytes
  the same, nothing mirrored; the control, 2 writes mirrored (`&92` at `&294C`), identical over
  1,295 passes. `passlock.mjs`, `helilock.mjs` and `worldrun.mjs` read the generator where each
  build keeps it (`playscript.mjs` `prngAt`), so a fixed build compares with one from before.
## 13. One hit costs many lives: the explosion it leaves keeps hitting the player (original behaviour; FIXED in layer 5)

KC, 2026-10-20: "the player takes multiple hits from a single projectile (e.g. helicopter bomb) when
running into it". Measured with `tools/hitwatch.mjs` (every entry to `kill_player`, with the path and
the culprit's type as it was before `kill_mover` changed it) over the whole world (WorldBot, infinite
lives poked in), jsbeeb 2.10.0, 2026-10-20: the original (the step 1 tag's build) took 634 hits in
12,222 passes, 290 of them from distinct objects and 344 repeats from an object that had already hit
(within 12 passes, same slot); the shipping build 655 (286 objects), the same pattern.
- **The explosion (197 of the 344).** Whatever hits the player, or whatever the player runs into, is
  turned into an explosion in its slot (`kill_mover`, `replace_projectile_with_explosion`), still
  overlapping the player. `check_for_hostile_collision` treats every type from `&0D` up as hostile to
  the player but the SAM, explosions (`&0E`) included, so the player's own move "runs into" it again
  every 1-2 passes (gaps: 198 of 1 pass, 53 of 2) until its animation ends, each a life. By what began
  it: a machine gun run into, 4-14 hits; a mortar 5-8; a heavy gun 9; a bomb run into 1-7; a mine 1-7.
- **The same object twice in one pass (41).** The player's move finds a bullet (or bomb) and kills
  both; the same projectile's own update then finds the player too (`projectile_hit_player`).
- Less certain: bullet "repeats" several passes apart may be a new bullet in the same slot; one run
  of 35 is WorldBot's stall, a crouching soldier the collision holds against the player (PLAN.md's
  whole world notes).
**Fixed** (layer 5, all builds, KC 2026-10-20: "explosions harmless + one hit per pass"):
- The player walks through explosions and skeletons: `check_for_hostile_collision`'s friendly cutoff
  for the player is `&0F` (the bullet), not `&0D`. Skeletons never killed the player
  (`skip_killing_player`) but blocked it, and a fix for the explosions alone exposed why that matters:
  `update_mover` never updates a mover overlapping the player, so a skeleton under a falling player was
  never removed, and the player hung in the air for good (the WorldBot stuck at x 5,772 from pass
  9,440, 10,000+ passes). The original can do the same.
- A projectile the player runs into is spent (`remove_mover`), as one that lands on the player is
  (`replace_projectile_with_explosion` removes an explosion overlapping the player): `kill_mover`
  leaves projectiles alone, so its own update hit the player again in the same pass.
Both fit the grind's spare bytes after `not_tank`: no code moved. Measured (jsbeeb 2.10.0, whole
world, `tools/hitwatch.mjs`): 318 hits (was 655 in the same build's world before), 260 objects, 58
repeats, none in one pass and none from an explosion (28 are the crouching soldier's stall, the rest
bullets, most several passes apart: likely a new bullet in the same slot); the world completes in
11,410 passes (was 12,237), with only the known stall. The renderer against the `DEBUG_FULLREDRAW`
oracle: identical on seeds 1 and 5 (4,000 passes), both helicopter flights and the whole world
(11,410). Front end and observer mode pass. The game plays differently now, so speed is not
comparable with layer 4's figures: seed 1 has 5 late frames of 1,998 (0 at layer 4's close),
holding RIGHT 0 of 598, the whole world 355 of 11,409 (3.1%; 2.8% at the close).
