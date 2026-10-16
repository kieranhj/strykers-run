# Step 2, layer 3: where a pass's time goes, and the options

2026-10-16, jsbeeb 2.5.0, Master 128, the layer 2 build (`63892d7`). Tools: `tools/passcost.mjs`
(every cycle charged to the innermost game phase on the call stack, interrupts apart),
`tools/visible.mjs` (movers on screen and their rectangles), `tools/spritestats.mjs` (the sprite
data decoded). Three scenarios: the town (frames 4000-5000), further in (16000-17000,
`DEBUG_LIVES`), and RIGHT held from the start (scrolling whenever the player can).

## The budget

A field is 39,936 cycles. Decision 12's speed is one original pass of movement per 2 fields.
- Locked 25 Hz (one pass per 2 fields): all work under ~79,900 cycles a pass.
- 50 Hz (layer 4: half a pass of logic and a full redraw every field): under ~39,900 a field.

## Today

| | Town | Further in | Scrolling |
|---|---|---|---|
| passes/s | 11.57 | 16.58 | 12.17 |
| cycles a pass | 172,883 (4.33 fields) | 120,653 (3.02) | 164,346 (4.12) |

Cycles per pass by what they are spent on (exclusive):

| | Town | Further in | Scrolling |
|---|---|---|---|
| **Sprite drawing**: the renderer's `plot_mover` calls, erase + draw | **64,455** (37%) | 15,746 | **49,369** (30%) |
| **Player save-under**, taken and put back whole | 16,117 (9%) | 19,409 (16%) | **26,705** (16%) |
| **Renderer overheads**: zero-page save/restore 8,271; records, zones, player test, on-screen tests ~10,000 | ~19,000 (11%) | ~17,000 | ~17,000 |
| **The logic's sprite walk** (`walk_column` + its `plot_mover` set-up) | 16,333 (9%) | 4,955 | 10,490 |
| **Landscape**: column built, pushed, written into both screens, lives digit redrawn | ~1,500 | ~10,500 | **~18,500** (11%) |
| **Game logic**: collisions ~10,000, target search ~4,400, movement, input | ~22,000 (13%) | ~19,000 | ~19,000 |
| **Interrupts**: the MOS's tick (sound) ~90%, vsync, split | 16,639 (10%) | 11,416 | 8,698 |
| **Waiting** for the pass's field | 18,294 (11%) | 24,367 (20%) | 16,899 (10%) |

What the counts say:
- **Sprites cost ~90 cycles per screen byte**: 716 bytes a pass in the town for 64,455 cycles.
  `unpack_column_of_sprite` itself is ~70 a byte (a run-length entry decoded per 1-3 bytes,
  self-modified operands, the row and group arithmetic); the rest, ~2,800 per call, is the
  address and clipping set-up (`subtract_Y_rows` walks a row at a time).
- **Every change is drawn four times**: EOR needs an erase (a full redraw) and a draw, in each
  of the two screens.
- **The save-under copies run at ~62 cycles a byte** (a branch, a pointer increment, a column
  step and a JSR per row, per byte), for 260-435 bytes a pass.
- **A landscape column costs ~37,000 cycles** across both screens:

  | Part | Cycles |
  |---|---|
  | Built: initialise 2,000, scenery layers ~9,000, ground 800, movers on the edge 2,400 | ~15,000 |
  | Copied into the history | 3,100 |
  | Written into each screen, 2 × 6,700 | 13,400 |
  | Lives digit, 2 × 2,700 | 5,400 |

  At the design speed the screen scrolls a column every 2 passes.
- **On screen** (`tools/visible.mjs`): 2-5 movers counting the player (mean 3.3 in the town, 2.2
  further in). Their rectangles total 300-720 bytes on average, 989 at most.
- **The sprite data** (`tools/spritestats.mjs`):

  | | Sprites | Run-length | Decoded bytes | Opaque | Partly masked | Transparent |
  |---|---|---|---|---|---|---|
  | Movers | 74 | 6.4K | 7.7K | 4,553 | 1,381 | 1,740 |
  | Scenery | 62 | 28.5K | 58.8K | 42,918 | 3,609 | 12,278 |

  The mask depends only on the flip; the pixel on the flip and the colour (green or white).

## The options

Estimates are per pass in the town unless they say otherwise. Each would be measured before and
after, as layers 1 and 2 were.

**A. Masked sprites over a saved background, in a straight format** (KC's request). Each mover's
rectangle is saved before it is drawn and put back to remove it (no EOR erase), and drawn through
its mask. The sprite data is converted at build time from run-length into straight columns: per
column a first row and a length, then the bytes. Two ways to hold the bytes:
- **A1. Index bytes** (one per screen byte, looked up in the existing pixel and mask tables for
  colour and flip at draw time): ~8-9K, ~26 cycles a byte to draw.
- **A2. Mask and pixel pre-expanded**: ~21 cycles a byte, but 15K per colour-and-flip; all four
  is ~61K, only the combinations used perhaps ~30K. RAM for cycles - see "RAM" below.

A screen-address table by row (~0.5K) replaces the row-at-a-time arithmetic, and copies unrolled a
character cell at a time run at ~10 cycles a byte. Order matters with masks: a mover is put back
before anything under it, so the renderer restores the changed movers and any they overlap, in
reverse order, then redraws them in order (with 2-5 movers, overlaps are uncommon).
Per mover change per screen: ~4,500 cycles (a soldier) against ~25,000 now. **Sprite drawing plus
the player's save-under: ~80,000 a pass → ~15,000-20,000.** Visible change: sprites overlap
cleanly (no EOR colour mixing), as the player always did - a decision row.

**B. Renderer overheads** (~19,000 → ~5,000). Save only the zero-page bytes the logic reads
before it writes them (a dozen or so, found with the pass lockstep or the kit's dataflow tools),
not 212; simpler records once A replaces the EOR bookkeeping.

**C. The logic's sprite walk** (~16,000 → ~1,500). It exists only to leave the bytes the original
plotter left (decision 21). A table built from the sprite data at build time (per sprite: column
count, the column step's results) gives the same bytes without walking; the lockstep proves it.

**D. The landscape** (~37,000 a column → ~12,000):
- Build the column straight into the history slot (no 3,100 copy).
- Write it with an unrolled routine (~1,600 a screen, not 6,700).
- Draw the lives digit from pre-shifted glyph bytes (~300, not 2,700).
- Clear the column buffer unrolled.
- Keep each layer's position in its scenery sprite from one column to the next instead of
  finding it again.

Whole-world caching is out: the mountain and cloud layers are chosen from the world data, not a
repeating pattern, and the world is ~7,400 columns of 200 bytes.

**E. Sound off the MOS** (already planned, KC: probably 50 Hz): the tick is ~3,900 cycles a
field in the town; our own driver ~800. **~10,000 a pass.**

**F. Game logic** (~22,000): leave for now. The biggest single item is
`check_for_mover_collision_with_range_of_movers`, ~93 calls a pass at ~92 cycles; an early-out
on x would be the first thing to try, proved by the lockstep. Changes here are the riskiest to
the game playing exactly as it did.

**Waiting** falls by itself as the work does: whole fields are the unit.

## Where that would leave us

| Town, per pass | Today | With A-E |
|---|---|---|
| Sprites and save-unders | 80,600 | ~18,000 |
| Renderer overheads | 19,000 | ~5,000 |
| Logic's sprite walk | 16,300 | ~1,500 |
| Landscape (scrolling: 18,500) | 1,500 | ~600 (scrolling ~6,000) |
| Game logic | 22,000 | 22,000 |
| Interrupts | 16,600 | ~6,000 |
| **Total work** | **~155,000** | **~53,000** |

That is inside the 2-field pass with room to spare, so the game would hold 25 passes a second.
It is also the shape layer 4 needs: per field, half the logic (~11,000) plus a redraw of what
moved (~8,000-12,000) plus a quarter of a scroll column (~3,000) plus interrupts (~1,500) -
**~25,000 of 39,936**.

## RAM

Free now, and what A-E would want:

| Where | Free | Notes |
|---|---|---|
| Sideways bank 4 | ~4.2K | after the renderer |
| Sideways bank 5 | ~8K | `&A464-&BFFF` and `&8000-&83FF` |
| Sideways banks 6, 7 | ~2.6K, ~2.3K | |
| ANDY | 3.3K (4K with no `*KEY`/`VDU 23` in play) | kit hardware-facts |
| HAZEL `&C300-&DEFF` | ~7K | while DFS still does OSFILE loads; the game does none after start |
| Main | 517 bytes | |

The rest of the space:
- A1 needs ~9K plus ~2K of tables and routines: it fits.
- A2 with all four colour-and-flip combinations (~61K) does not fit. The combinations actually
  used could, if HAZEL and ANDY are taken.
- The run-length mover data (6.4K) is still needed for the original's leftovers until option C
  replaces it with a table; after that it can go.

## Disc loading during play

Possible but not needed for A-E, and costly:
- The loader selects `*TAPE` at start, so DFS's workspace is given up today. Keeping DFS means
  keeping its workspace and either masking or chaining interrupts during each load (kit
  hardware-facts: a load blocks for whole fields, nine for a single sector).
- The world is one continuous scroll with no natural pause except a death.

Worth keeping in mind if A2's full set of variants, or more scenery detail, is ever wanted.
