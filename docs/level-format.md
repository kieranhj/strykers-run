# The level format

How Stryker's Run (Enhanced) builds its one level, read from the source (`src/game.6502`,
`src/bank*.6502`, `src/zp.6502`) and the original's disassembly, as `main` had it at
`d879af0` (2026-10-18). It is groundwork for a level editor. `tools/worldmap.py` draws the whole
world from a build's bytes with the rules below. Its pictures were checked against the emulator
(see "Checked against the emulator"). Addresses are the shipping build's
(`build/strykers.symbols.json`). Take them from there, not from here: they move when the code
moves.

## Coordinates

- **World column.** One MODE 2 byte, two pixels wide. The world starts at column 0. The screen
  shows 80 columns, `viewport_left` (`&BA`/`&B2`) to `viewport_right` (`&BB`/`&B3`), and
  `viewport_right = viewport_left + 79`.
- **Row.** The play screen is 200 rows: 25 character rows, `&4000-&7FFF`, hardware-scrolled.
  `column_buffer` (`&0300`, 200 bytes) holds one column. Index 0 is the bottom row and index 199
  the top. A scenery sprite's `y`, and a mover's `movers_y`, is the buffer index of its bottom
  row. Sprites are drawn upwards from it. Screen row = 199 - y (`&C7 - y` in
  `calculate_screen_addresses_for_mover_on_edge`).
- **The player and the view.** Every column the player walks scrolls the screen one column
  (`move_mover` calls `scroll_screen_right`/`left`), so the player's x is always
  `viewport_left + &26`. The game starts with the player at x `&26` and the view at 0. Trigger
  points are given as player x, so a trigger at T fires when the screen shows columns T - 38 to
  T + 41.
- **The world's extent.** `main_game_loop` ends the game at player x `&1CED` (7,405), where
  scenery one's second `HEADQUARTERS_SIGN` starts. The view is then at 7,367, so the last column
  the game ever shows is 7,446: **7,447 columns** in all (29,788 MODE 2 pixels). The data runs a
  little past that. Those bytes are only seen in observer mode (below), and they include a
  garbage sprite (see "The data's ends").

## Where the level lives

All of the level's own tables are in MGAME (main RAM), packed together at its start, with code
straight after them:

| Table | Address | Bytes | Encoding | Read by |
|---|---|---|---|---|
| `enemy_helicopters_initial_x` | `&0E00` | 2 | x low of the two enemy helicopters each page brings: `&29`, `&57` | `add_enemy_helicopters` (also its "random" type stream: below) |
| `scenery_data_one` | `&0E02` | 471 | 2-byte records: sprite\|flip, x low (235 records and a stray byte) | scenery one layer; **also the cloud layer**, 1 byte a record |
| `scenery_data_two` | `&0FD9` | 183 | 3-byte records: sprite\|flip, x low, y (61 records) | scenery two layer |
| `trigger_points_x_low_table` / `_high_table` | `&1090` / `&10B5` | 37 / 38 | player x of each trigger. Entry 0 = `&FEFF` and entry 37 = `&63FE` (whose low byte is the high table's first) are sentinels, so 36 real ones | `scroll_screen_right` (entry `trigger_offset + 1`), `scroll_screen_left` (entry `trigger_offset`, x - 1) |
| `new_movers_type` | `&10DB` | 117 | mover type, bit 7 = enemy: 39 groups of 3 | `add_new_movers` |
| `new_movers_initial_x_low` | `&1150` | 117 | x low | `add_new_movers` |
| `new_movers_initial_x_high_and_flags` | `&11C5` | 117 | bits 0-5 x high, bits 6-7 behaviour | `add_new_movers` |
| `new_helicopter_types` | `&123A` | 8 | the enemy helicopter types, picked 1 of 8 | `add_enemy_helicopters` |
| `player_helicopters_type` / `_initial_x_low` / `_initial_x_high` | `&18C1` / `&18CB` / `&18D5` | 10 each | the craft the player can board (slots `&18-&21`) | `start_game` |
| `initial_scenery_layer_addresses_high` / `_low` | `&236A` / `&236E` | 4 + 4 | where each layer's data starts: `scenery_data_one`, `scenery_data_two`, `&C300` (mountains), `scenery_data_one` (clouds) | `initialise_scenery_layer_addresses` |

What the level draws with, also in MGAME:

| Table | Address | Bytes | What |
|---|---|---|---|
| `scenery_sprite_banks` | `&1287` | 66 | sideways bank (4, 6 or 7) of each scenery sprite `&00-&41` |
| `flipped_` / `unflipped_scenery_sprite_addresses_low/high_table` | `&12C9`-`&13D0` | 4 x 66 | each sprite's last column (flipped) and first column (unflipped) |
| `scenery_sprite_width_table` | `&13D1` | 66 | columns **minus one** (checked: true of all 965 placed runs) |
| `scenery_layers_table` | `&1AC9` | 8 | record size of each layer: left edge 0-3, right edge 4-7 = `02 03 01 01` (scenery one, scenery two, mountains, clouds) |
| `scenery_layers_y_positions` | `&1AD1` | 8 | `&17` for scenery one and mountains. The cloud entries (3, 7) are rewritten from `clouds_y_table` |
| `mountains_table` / `clouds_table` / `clouds_y_table` | `&1AD9` / `&1ADD` / `&1AE1` | 4 each | sprite for each value of a 1-byte record's low 2 bits, and the cloud's y: `&AA &A7 &A3 &A1` |
| `ground_edge_bottom_pixel_values`, `_top_`, `_masks`, `ground_pixel_values` | `&1C8C`-`&1C9F` | 4, 4, 4, 8 | the ground's two edge rows and its texture's pixel bytes |
| pixel and mask tables | `&0400-&057F` (`moved_0400`, carried at `moved_0400_load` and copied down) | 384 | index (6 bits) -> MODE 2 byte: green flipped `&0400`, unflipped `&0440`; masks `&0480`/`&04C0`; white (enemies) `&0500`/`&0540` |
| mover type tables | `&1683`-`&18C0` | | `mover_types_parts`, `_first_sprite_animation_offsets`, `_second_sprite_offset`, `_third_sprite`, `_width_table`, `_height_table`, `animation_table`, `sprites_y_offset`: which sprites make a mover, frame by frame |

The pictures:

- **Scenery sprites** (66; `&03` HELICOPTER and `&18` CRANE are never placed) are in the
  original's run-length format. Bank 4 holds `&00-&12` and `&16` at `&8000-&8B17`. Main RAM
  holds `&13-&15` at `&0580-&07FF`, in the `moved_0400` block. Bank 6 holds `&17-&2F` at
  `&8000-&B574`, and bank 7 holds `&30-&41` at `&8000-&B712`.
- **Mover sprites**, in step 2, are in the renderer's straight format (decision 24):
  `straight_sprite_lo/hi` and `sprite_column_count` (bank 4), with the data in ANDY (carried in
  bank 5 at `andy_load`) and bank 4. The original's run-length mover sprites are gone, and
  MGAME's mover sprite address tables point at `dummy_sprite`.

### The data's ends

- `scenery_data_one`. The last record that matters, `&0FD2`, starts at column 7,443. The
  disassembly marks the three records after it "Not displayed": the next starts at 7,449,
  beyond the last column shown. The table ends in the middle of a record (`&0FD8` = `&17`).
- `scenery_data_two`. Its last record (`&108D`, a signpost at 7,318) is followed by no
  sentinel. The walk carries on into `trigger_points_x_low_table` and reads `FF 44 08` as
  sprite `&7F`, flipped, at x low `&44`. That is past the 66 sprites, so its bank and address
  come from whatever bytes follow the tables. It appears at column 7,492, which only observer
  mode shows. The emulator draws it there too, as a striped strip.
- The clouds read `scenery_data_one` from its first byte, one byte a cloud. By column 7,446
  they have read only to `&0E36`.
- The mountains read HAZEL `&C300` to `&C56C` by column 7,446: 621 mountains of 12 columns.

## The background

### The layers

The scroll keeps eight layers: four for the left edge (`edge_and_layer` 0-3) and four for the
right (4-7). Each has its data pointer (`scenery_layer_addresses_*`), and, while a sprite is
under way, that sprite's current column, bank, y and flip (`scenery_layer_*`). A pointer high
byte of 0 means the layer is idle. Scrolling right builds the new right-hand column from layers
7, 6, 5 and 4, in that order, so a later layer draws over an earlier one:

| Layer (right / left) | Data | Record | y | Placement |
|---|---|---|---|---|
| 7 / 3 clouds | `scenery_data_one`, byte by byte | 1 byte: low 2 bits pick `clouds_table` and `clouds_y_table` | `&AA`, `&A7`, `&A3`, `&A1` (170-161) | starts when `viewport_right_low` = the byte itself |
| 6 / 2 mountains | HAZEL `&C300` on (the high byte is negative) | 1 byte: low 2 bits pick `mountains_table` | `&17` | starts **at once**: mountains are back to back |
| 5 / 1 scenery two | `scenery_data_two` | sprite\|flip, x low, y | the record's (used: `&17`, `&14` runways, `&00` bridges) | starts when `viewport_right_low` = x low |
| 4 / 0 scenery one | `scenery_data_one` | sprite\|flip, x low | `&17` | starts when `viewport_right_low` = x low |

The sprite byte is the sprite number (bits 0-6) and bit 7, set for flipped (mirrored).

**Placement rule.** Records in a layer are drawn one after another, never overlapping. When a
sprite's last column has been drawn, the layer moves to its next record and waits for the first
column whose low byte equals that record's x. Only the low byte is stored, so a record's
absolute start is `prev_end + 1 + ((x - (prev_end + 1)) mod 256)`. The gap after a sprite is
0-255 columns. A larger gap needs a filler record. The first record waits from column 0. In the
shipped data the gaps reach 224 (scenery one), 255 (scenery two) and 250 (clouds).

**Scrolling left.** Layers 0-3 walk the same data backwards for the left edge. They start a
sprite when `viewport_left_low` = x + width (the width table is columns minus one), from the
sprite's other end. For the two directions to agree, every gap must be under 256 columns and the
width table must be right. `scroll_into_world` builds columns 0-79 scrolling right from the
initial pointers, then resets the left layers to the data's start once the view reaches column
0.

**The cloud's y** is in `scenery_layers_y_positions` entries 3 and 7, and those entries are
rewritten every time a mountain or cloud record is looked at (`get_mountain_or_cloud_type`).
Scrolling right, the cloud layer looks at its own record just before it starts, so its y is its
own. The mountain layer then writes its own value into the same entries.

### The scenery sprite format

A sprite is its columns one after another, left to right. Each column is:

- one byte: the length in bytes of the previous column (0 for the first column), which the
  backward walk uses;
- runs, each `10pppppp` (1 row), `01pppppp` (2), `11pppppp` (3), or `00nnnnnn` followed by a
  pixel byte (n rows);
- then `&00`.

After a column's `&00`, a byte with bit 7 set ends the sprite, and its low 7 bits are the last
column's length. Each run's 6-bit index `pppppp` looks up the pixel table and the mask table.
Rows go upwards from y, and each row is `(buffer AND mask) EOR pixel`, so index 0 (black, mask
`&FF`) is transparent. A flipped sprite is walked from its last column backwards
(`flipped_scenery_sprite_addresses_*` point there) through the flipped tables, which swap the
byte's two pixels: a mirror image. The pixel index carries two 3-bit colours (0-7), left pixel
and right pixel. The game rewrites the tables' three cyan entries before the layers
(`change_pixel_tables`, `&55`: background cyan = logical colour 15) and again before the ground
and movers (`&14`: colour 6). Mover sprites use the same indices in a different layout (per
column: first row, count, indices top-down; `tools/sprites.py`).

### The ground

`add_ground_to_column_buffer` runs after the layers, for the column at `ground_right_x_low`
(column & `&FF`):

1. The ground type is `t = MOS ROM[&E000 + (column & &FF)] AND 3`. These are MOS 3.20's bytes,
   used as a pseudo-random stream, and they are not level data.
2. `column_buffer + 9` non-zero (a bridge, scenery two at y 0): no ground at all.
3. `column_buffer + 21` non-zero (a runway at y `&14`): rows 0-19 only, no edge.
4. Otherwise row 22 = `ground_edge_bottom_pixel_values[t]`, and row 23 =
   `(row AND ground_edge_masks[t]) EOR ground_edge_top_pixel_values[t]`, which merges with the
   scenery standing there. Then rows 0-21.
5. Each texture row Y = `ground_pixel_values[ZP[t*t + Y] AND 7]` (red and black). It reads zero
   page `&0000-&001E` (BUGS #1), and these are bytes of ours, not level data:
   - `&00/&01` the screen start, `&4000 + 8 * (column + 1)` wrapped, known for every column;
   - `&02` `count`, `scroll_into_world`'s, then 0;
   - `&03` `mover_to_update`. Each scroll leaves it at `&22`, so it is `&22` in observer mode.
     In play the logic between scrolls changes it, which changes a few ground rows;
   - `&04-&1E` the dead unpacker's bytes, kept byte for byte (decision 34), with `&05/&06`
     holding `dummy_sprite`'s address as `set_sprite_address` leaves them.

### The mountains (BUGS #9)

They read HAZEL from `&C300`, which the MOS leaves paged in (decision 31: left as it is). In
jsbeeb HAZEL holds zeros, so every mountain is record 0: `MOUNTAINS_TWO`, unflipped, 12 columns,
back to back. `tools/worldmap.py` draws them that way unless `--hazel` gives it other bytes. On
a real Master they depend on what the DFS left in HAZEL.

### Colours

Play's palette is set at start-up and by `irq1_handler`:

| Logical colours | Physical colour |
|---|---|
| 1-5, 7 | the MODE 2 colours: red, green, yellow, blue, magenta, white |
| 6, 15 | black. These are the two "cyans": 6 for the foreground (ground and movers), 15 for the background |
| 8 | white |
| 9 | black |
| 10-14 | green, yellow, blue, magenta, cyan (no flashing) |
| 0 | **split**: cyan (the sky) from vsync, magenta from screen row 111 down. User VIA T1 fires `&2900` us after vsync and writes `bottom_palette_value` (`&02`) |

Row 111 is measured: it is where `tools/worldmap.py` matches the screen. Every pixel the scenery
leaves at colour 0 is sky above that row and "far hills" magenta below it.

## How one column is built

`scroll_screen_right` (and `layers_right`, which `src/prebuild.6502` may run ahead in the wait
for the flip):

1. Clear `column_buffer`, or take the prebuilt column (`start_column`). Move the view one column.
   If `viewport_right_high` changed, `add_enemy_helicopters`.
2. Layers 7 to 4 (layers 3 to 0 only keep their state). For each layer:
   - If a sprite is under way, step one column through it: forward, or backward if flipped.
   - If the sprite is still going, draw that column at its y.
   - If it has ended, move the data pointer on one record and consider the next record. If that
     record starts in this column, set its bank, y and flip and draw its first column.
3. `change_pixel_tables` to the foreground state, then the ground.
4. The movers on the edge: the original drew them into the column. In step 2 the column is
   scenery only, and the renderer draws the movers. `add_movers_to_column_buffer` just leaves
   the state the original's loop left, including `mover_to_update` = `&22`, which the next
   column's ground reads at `&03`.
5. The trigger check: if the player's x = `trigger_points[trigger_offset + 1]`, then
   `add_new_movers`.
6. The column goes to the screen. In step 2 that is `history_push`: the renderer's edge history
   gets the column, and both screens catch up.

## Objects and enemies

### Movers placed by the level: groups and triggers

- **Groups.** The three `new_movers_*` tables hold 39 groups of 3 records. Group g uses slots
  `(g mod 3) + 1`, `+3` and `+6`, so it has 3 of the 9 enemy slots `&01-&09`. The record
  numbers are 3g, 3g+1 and 3g+2.
- **A record** gives the type (bit 7 = enemy) and x (14 bits). y is always `&18`, on the
  ground. Frame and flip start at 0, facing right. Behaviour is in bits 6-7 of the high byte
  (`movers_flags`):

  | Bits 6-7 | Behaviour |
  |---|---|
  | `&00` | stationary |
  | `&80` | stationary, lifts its gun now and then |
  | anything else (`&40` in the data) | patrols between `max(x_low - &1E, 0)` and that `+ &3C` (`&FF` at most), by low byte only, so patrols do not cross a page |

  The data: 48 patrol, 37 are stationary, 32 lift their gun.
- **At the start** (`start_game`): groups 0, 1 and 2, with `trigger_offset` 0.
- **Scrolling right.** When the player's x reaches trigger point i (1-36), group i + 2 replaces
  group i - 1 in that slot set.
- **Scrolling left.** Going back past trigger i, at its x - 1, group i - 1 comes back.

  So groups g, g + 1 and g + 2 are live between triggers g and g + 1. Each group exists from
  trigger g - 2 to trigger g + 1, and `world.json` lists both points for every mover.
- **No despawn.** A mover is not removed when it leaves the screen. A killed one is gone until
  its group is added again (going back past its trigger).
- **The data's spawns.** In the 36 triggers and 117 records:

  | Type | Enemy | Ally |
  |---|---|---|
  | trooper with rifle | 43 | |
  | SAM | 14 | |
  | officer | 13 | 2 |
  | bazooka trooper | 11 | |
  | soldier with rifle | | 10 |
  | mine (`&13`) | | 8 |
  | machine gun | 7 | 1 |
  | mortar | 5 | 1 |
  | heavy gun | 2 | |

### Enemy helicopters

- Two at a time, in slots `&0A` and `&0B`. Each time `viewport_right` enters a new 256-column
  page p, `add_enemy_helicopters` puts them at x `p:&29` and `p:&57`. They patrol x low
  `&01`-`&65` and `&2F`-`&93`, at a height of `&73 + (random AND &1F)`. That height is the step
  2 PRNG (decision 17), not level data.
- **Their type** is `new_helicopter_types[MGAME byte (enemy_helicopters_initial_x + slot + p) AND
  7]`, so it comes from bytes `&0E0A-&0E28`. Those are the first records of `scenery_data_one`:
  **editing scenery one's first 20 records changes the helicopters.**
- They are not tied to triggers.

### Things to board

The 10 slots `&18-&21` come from `player_helicopters_*` at the start, on the ground (y `&18`),
as allies:

- red helicopters at 748 and 3,663;
- blue craft at 1,382 and 5,327;
- helicopters at 3,651 and 13,000;
- helicopters with missiles at 2,522, 4,545 and 4,586;
- **the tank** at 2,056.

The helicopter at 13,000 (`&32C8`) is beyond the world, so it is never seen. Its x high byte
`&32` is probably a slip in the original.

### Mines

Mines are movers, type `&13` without the enemy bit, placed like the others (8 in the data).

### The headquarters

It is not an object. The completion check is code: `main_game_loop` compares the player's x
with `&1CED`. The sign is scenery: `HEADQUARTERS_SIGN` in scenery one at 20 (the start) and
7,405.

### Scenery is only a picture

Nothing reads `column_buffer` or the scenery data for play, apart from the ground's bridge and
runway tests. The player stands at y `&18` everywhere (`check_if_player_is_on_ground`), and
bridges, runways and buildings have no collision.

## Limits an editor must respect

**Sizes and counts** (today's layout):

- Scenery one: 235 two-byte records. Scenery two: 61 three-byte records.
- Triggers: 36, plus the two sentinels.
- Mover groups: 39, each exactly 3, which must be the number of triggers + 3.
- Boardable craft: 10 slots. Enemy helicopters: 2 per page, with 8 types.
- Mover slots are fixed: 9 for the level's movers, 2 for enemy helicopters, 10 for craft.
  `MOVER_SLOTS` = `&22` in the renderer.

**Ordering:**

- Each layer's records are in world order, with gaps under 256 columns.
- The scenery width table must be columns minus one.
- Trigger x is ascending, entries 0 and 37 are sentinels, and the comparison is exact equality.
  The player moves a column at a time.
- Group g is reachable only between triggers g - 2 and g + 1. Its movers should stand there.

**Couplings that are code, not data:**

- the clouds are `scenery_data_one`'s bytes;
- the helicopter types are bytes `&0E0A-&0E28`;
- the ground type is the MOS ROM;
- the mountains are HAZEL;
- the completion x is in `main_game_loop`;
- the player starts at `&26`, and the game starts at the view's column 0;
- the movers' y is always `&18`.

**Heights.** A scenery column must end below row 200: y plus the column's rows at most 200.
`column_buffer` is `&0300-&03C7`, and a taller column would run on into the MOS's workspace at
`&03C8`. The renderer copies the buffer into 200-byte history columns (`hist0`/`hist1`), with
its own variables in the 56 bytes after each one (decision 32). `src/prebuild.6502` notes that the walk never writes above row 192 (a cloud
170 rows up, 23 high).

**Where the data lives:**

- **MGAME's tables are packed** at `&0E00-&18DE`, with code after them, and main RAM has 20
  bytes free (`SKIP unused_3400_original`). Everything from `&3400` must stay put (BUGS #1, #2).
  Larger tables must move, and they are read with absolute,X/Y addressing, so a table must stay
  under 256 bytes, or be split, or have its code changed. `scenery_data_*` are read by pointer,
  so they can be any size and anywhere the scroll can see.
- **Scenery sprites:**
  - bank 4: below `&9000` only. The renderer draws with ANDY over `&8000-&8FFF`, so the scroll
    and the prebuild read scenery with ROMSEL `&04`. 110 bytes are free (`&8F92-&8FFF`).
  - banks 6 and 7: scenery, then layer 4's compiled sprites (decision 29), ASSERTed to `&C000`.
    530 and 481 bytes are free.
  - bank 5 holds no scenery, and 437 bytes are free.
  - main RAM `&0580-&07FF` holds three sprites.
- **HAZEL** `&C300-&C6FF` is the mountains' and must stay untouched (decision 31). `&C700-&D8AD`
  is compiled sprites.

**What step 2 assumes:**

- **The column walk's inputs** are only the layers' state (57 bytes, `PRE_LAYERS`), the y
  positions, the edges' low bytes and the scenery data. That is what lets `prebuild` run it
  ahead and keep the result. A format that reads anything else, such as the player or movers,
  breaks the prebuild.
- **The walk writes** exactly the 16 zero-page bytes in `pre_zp_list` and `&F4`.
- **The renderer** stores 200-row edge columns. `history_push` copies the whole buffer, and the
  prebuild's history slot (item 3) keeps rows 24-199.
- **Movers** are drawn masked over save blocks sized by `MAX_BLOCK` (`&2A0`, the largest mover).
  A new or bigger mover sprite must fit that and `player_save` (`tools/sprites.py stats`).
- **Speed.** Layer 4's costing (`docs/step2-layer4-costing.md`, decision 35) measured this
  world. Building a scroll column is about 4.5k cycles a scrolling pass, with the unpack about
  3.3k. Denser scenery (more overlapping layers, more runs a column) costs cycles in every
  scrolling pass, and the 25 Hz budget has little to spare.

## Checked against the emulator

Checked on 2026-10-18, jsbeeb 2.5.0, Master 128, build `d879af0`.

**How.**

- `tools/worldshots.mjs` boots the disc, sets `observer_mode`, starts a game and holds the
  cursor RIGHT key. It stops at chosen view positions and saves `screenshotActive` and the mover
  slots.
- Observer mode scrolls a column a loop with no logic, so it reaches the headquarters. Play
  holding RIGHT stalls at 3,319.
- `tools/worldmap.py --crop LEFT --observed DIR` renders the same 80 columns.

**Results.**

- **Background.** At 15 view positions (0, 99, 600, 1,234, 1,900, 2,499, 3,100, 3,319, 3,700,
  4,321, 4,900, 5,555, 6,100, 6,789 and 7,367), every pixel the background shows agrees. At view
  0, with no movers drawn, all 32,000 MODE 2 pixels match. Elsewhere, 113-1,197 pixels differ,
  and all of them are under movers.
- **Movers.** Drawing the movers the emulator listed, at its x and y, leaves 113-172 differing
  pixels a shot. All of them are one sprite: the player, drawn in the sky in observer mode,
  where nothing updates its screen address.
- **The lives digit** (the HUD) is masked.
- **At view 0** the observer mode screen has no movers yet, so drawing them there makes 445
  differences.
- **Placements.** The emulator's mover slots (type and x) at all 16 positions agree with
  `worldmap.py`'s placements from the tables: 336 of 336, including the groups each
  `trigger_offset` implies, the enemy helicopters' types page by page and the 10 craft.
- **Past the end** (view 7,420), the data's garbage sprite appears at 7,492 in both.

**Observer mode is broken in this build.** Grind G0038 (`d96cb3f`) removed `keydown_int`'s
leading `TXA`. `check_for_keypress` still enters at `keydown_int + 1`, so it now asks the matrix
about the INKEY number in X, with Y unset, and no key works. The harness mends those 10 bytes in
the emulated RAM (`TXA EOR #&FF TAX JSR keydown_int EOR #&80 RTS`). The source is untouched.

## What an editor would need

**Read:**

- the tables above, by symbol, from a build;
- or, better, from `src/game.6502`'s `EQUB` blocks, which keep the disassembly's names in their
  comments;
- the scenery sprites from banks 4, 6 and 7 and the `moved_0400` block, decoded as above;
- the mover sprites from the straight data.

`tools/worldmap.py`'s `Build`, `World`, `Movers` and `placements` already do all of this, and
`--json` writes every placement: each scenery run's record address, sprite, flip, y, start and
end column; each mover's group, slot, type, x, flags, patrol, and spawn and replace points; the
triggers; the helicopters.

**Edit, in world terms:** place, move, flip and delete scenery in either layer. The editor works
in absolute columns and converts to x-low records itself:

- insert fillers where a gap exceeds 255;
- refuse overlaps within a layer;
- check heights;
- place movers in groups of 3 with a behaviour;
- move triggers, keeping them ascending, with groups = triggers + 3;
- place the boardable craft;
- show the couplings: the clouds and helicopter types that come from scenery one's bytes.

**Write back:**

- generated `EQUB` blocks for `scenery_data_one`, `scenery_data_two`, the trigger tables, the
  three `new_movers_*` tables, `player_helicopters_*` and, if wanted, `new_helicopter_types`;
- best as one generated include (as `src/sprite_*.6502` and `src/compiled_*.6502` are today),
  which is a source change and needs a decision.

Rebuild, then check that:

- every table is no bigger than its room;
- the ASSERTs pass;
- `tools/worldmap.py` re-renders it;
- the game state passes the usual gates (`tools/passlock.mjs` etc. play the world, so a changed
  level changes their reference games).

**Preview:** `tools/worldmap.py` for the whole world, observer mode in the emulator (`tools/observer.mjs`; fixed, BUGS #11), and `tools/worldshots.mjs` for crops.

## The editor, v1 (decision 41, KC 2026-10-18)

- **The app:** Python and PyGame, scrolling controls, a swatch to select and place items.
- **Output:** source, a generated include; the build checks it.
- **Placed by the editor:** scenery (existing sprites only), movers (y fixed at `&18`, patrols within a
  256-column page), triggers, boardable craft, enemy helicopter types, and the level's length (the
  completion point).
- **Not placed:** clouds, ground and mountains (effectively random, or from data bytes).
- **v1.1:** enemy helicopters' positions and heights more precisely.
- **The original's slips are fixed:** the craft at 13,000, scenery two's missing sentinel, scenery
  one's half record.
- **Left-scroll consistency:** the editor writes only consistent worlds, and the build checks it.
- **Verification:** code changes are always proved against the original level; new levels are
  experimental.
- **Open:** chained or absolute scenery records (question 7 below).

## Open questions for an editor

1. **Clouds, helicopter types, ground and mountains are not level data.** The clouds are scenery
   one's bytes, the helicopter types are bytes `&0E0A+`, the ground is the MOS ROM and the
   mountains are HAZEL. Should an editor own them? Each needs a code change: separate cloud and
   helicopter tables, a ground table (BUGS #1, decision 13's layer 5), or mountain data in the
   build (revisiting decision 31).
2. **Where a bigger level goes.** Main RAM has 20 bytes and the banks about 0.5K each. PLAN's
   "scenery runs translated at build time" and any change to the scenery format, which another
   agent may be making, change the sprite side. The records' side (x-low, chained) could stay as
   it is or become absolute.
3. **Source or binary.** Editing a generated include means agreeing a decision and a
   `tools/level.py`-style generator. Patching the built disc would sidestep the source and the
   gates.
4. **New scenery sprites.** This needs an art path into the run-length format, the width table
   and a bank with room. Bank 4's ANDY rule applies: below `&9000`.
5. **Left-scroll consistency** (gaps under 256 and the width table) is checked nowhere today. An
   editor would have to enforce it, or the game's left scroll would show a different world.
6. **Fixed behaviours.** Movers always stand at y `&18` and patrols stay inside one page. The
   helicopters' heights are random, and their x are fixed per page. Are these part of the format
   or for changing?
7. **The original's slips:** the boardable helicopter at 13,000, scenery two's missing
   sentinel, and scenery one's half record. Keep them byte for byte, or fix them?
8. **Observer mode** is the natural in-game preview. Its keys work again (BUGS #11), but it draws the
   player as a ghost.
