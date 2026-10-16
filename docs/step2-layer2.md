# Step 2, layer 2: double buffering in shadow RAM

2026-10-16. Measured on **jsbeeb 2.5.0, Master 128 (MOS 3.20)** with the harnesses in `tools/`.
**Not yet seen on b2 or real hardware** (KC is checking on b2; see "Open" below).

## Result

Every frame is drawn into the screen that is not being shown and shown whole at the vsync the
pass lock picks: no raster chasing and no flicker. The game plays exactly as before. The price
is speed: each change is now drawn into both screens, and layer 3 has to make that up.

| | Layer 1 | Layer 2 |
|---|---|---|
| Frames 4000-5000 (town), passes/s | 17.78 | **11.57** |
| fields per pass | 2: 176, 3: 81, 4: 88, 5: 10 | 3: 49, 4: 93, 5: 58, 6: 31 |
| Frames 16000-17000 (`DEBUG_LIVES`), passes/s | 17.03 | 16.58 |
| fields per pass | 2: 165, 3: 75, 4: 70, 5: 17, 6: 13 | 2: 100, 3: 137, 4: 85, 5: 9 |
| `tools/speed.mjs` (RIGHT held, scrolling every pass), passes/s | 16.58 | **10.25** |
| time in interrupts | 10.6% | 10.2% |

(The byte-identical original: 16.78 and 15.07 passes/s, 13.52 with RIGHT held: layer 2 is slower
than the original in the town and when scrolling, and about as fast further in.)

Where a pass's time goes now (frames 4000-5000): sprite plotting 28.9%, waiting for the pass's
slot 10.5%, the MOS's tick 8.6%, the player's save-under copies 8.5%, the zero-page save around
the renderer 4.8%, the logic's walk of each sprite (below) 4.3%, collisions 5%, the renderer's own
bookkeeping ~4%. Layer 3's list: the plotter, the save-under (two whole copies a redraw), the
zero-page save (only the bytes the logic reads before writing need keeping), the column walk.

## How it works (decisions 20-23)

**The logic no longer draws** (decision 21, KC: per-buffer records). Its calls to `plot_mover` work
everything out as before but write nothing; the player's save-under routines, the edge column's
movers, the lives digit and the raster waits are gone from the logic; the scroll hands its new
edge column (scenery only) to `history_push` instead of writing it.

**The renderer** (`src/render.6502`, sideways bank 4, run at the end of each pass) keeps, for each
screen and each of the 34 mover slots, a record of what that screen shows (type, frame, x, y,
screen address). For the screen not shown it: takes the player off (its save-under) if anything
near it changes; erases every stale mover by drawing its record again by EOR (the record copied
into the live slot for the call); writes the edge columns that screen has not had, oldest first,
each with the view and the lives digit that went with it; draws every live mover on screen it
does not show; and puts the player back, save-under first. A mover is stale if it is drawn in
another state than the live one, or overlaps a column the scroll writes or leaves, or the lives
digit about to be redrawn.

**Making the logic not notice** took three things, each found by the pass lockstep:
- `walk_column`: the original's logic reads what the plotter leaves behind - `mover_x_low`
  stepped on a column at a time (the patrol turn compares it with a limit), `delta_high`, which
  is also `frame_and_flip`, `screen_address`, `sprite_data_offset`. The logic's plot calls now
  walk the sprite's run-length data the way the plotter does, sharing its column step
  (`consider_plotting_next_column_of_mover`), and leave the same bytes, without drawing.
- The renderer saves the game's zero page (`&00-&D1`, `&F8/&F9`, less the interrupt's counters)
  and puts it back afterwards: the logic reads, at the start of a pass, what the previous pass's
  drawing left there.
- BUGS #4 (fixed first, in its own commit: the control for this layer).

**Two screens** (decision 23): main RAM and the Master's shadow RAM, both at `&4000-&7FFF` with the
16K hardware wrap, so the scroll code is unchanged. While the renderer draws into shadow, ACCCON's
X bit is set and `&3000-&7FFF` is shadow RAM to the CPU too: so shadow `&3000-&3FFF` is a copy of
main's (code and data), taken with the screen at every game start, and everything the interrupt
reads lives below `&3000`. `tools/shadowaudit.mjs` (20,000 frames): with X set the renderer reads
only code and constant data in `&3000-&3FFF` (`plot_lives`, `plot_character`, the font, sprites);
the only bytes written there in play are `pass_start` and the score digits; none is read with
X set. **The flip**: the pass lock picks the field the pass ends on (with interrupts off) and the
vsync interrupt, on that field, writes R12/R13 and ACCCON's D bit for the finished screen. At the
game over and completion, `render_to_main` brings the main screen up to date and shows it, so the
text and the title go where they always did.

**The palette split** is set only by the interrupt now: steady at the same cycle every field
(decision 22, KC). `tools/split.mjs`: top write 124/125 cycles after vsync, bottom 21,190/21,191,
in all 1,000 fields, none missed; `tools/splitscroll.mjs`: no field re-armed by the game.

## Checks

- **Pass lockstep against the control** (`tools/passlock.mjs`: the single-screen game with the
  same logic, `0a078b8`; both built `-Shift 256 -ShiftEnd -Define DEBUG_LIVES` so the ground
  pattern is fixed, BUGS #1): **game state identical** at the start of every pass in seven runs of
  6,000 passes (seeds 1, 3, 5, 9; and 2, 4, 6 pressing CTRL as well). **The screen being shown is
  byte-identical to the control's** on 5,999 of 6,000 passes in six of them (all but the first,
  before which the original draws the player), and on 5,992 in the seventh: there, twice, an
  explosion or a bullet next to the player shows a pass early or late for up to five passes,
  because the renderer draws the state as it stands at the end of a pass and the original drew
  where its own calls happened to leave things. That is the one way the picture can differ.
  (In the 384 bytes of the 16K ring that are never displayed, two runs differ on ~100 passes.)
- **Front end** (`tools/frontend.mjs`, 15 checks, all pass): two games, define controls, pause,
  high score entry, toggles; **the game over screen, hashed as `text_screen` finishes it, is
  byte-identical to the original's** (`1754be00fa0ba297`).
- **Sound** (`tools/soundfx.mjs`): each of the 8 effects writes the same bytes at the same tick
  spacing on its own channel as the original.
- **Relocation**: `-Shift 256` against `-Shift 256 -ShiftEnd`, 30,000 frames identical; `-Shift
  64` and the release build assemble.
- **Interrupts**: 10.2% of the CPU; the vsync handler 196 cycles with the flip.

## Found on the way

- **BUGS #5, a layer 1 regression**: OSBYTE 19 returns registers its callers use (MOS 3.20: Y =
  `(&0301+X)`, X = `(&0300+X)`), and layer 1's field-count wait did not, so the game over and
  completion text was read from the wrong place in the layer 1 build. Fixed; the front-end
  harness now hashes that screen.
- `tools/frontend.mjs` must read and write `&3000-&7FFF` with `{ shadow: false }`: the renderer
  can have the CPU on shadow RAM when the harness looks.

## Rejected

- **Replaying each pass's draws into the other screen** (KC chose records): least new code and an
  exact copy of the original's screens, but every draw twice (~+37k cycles a pass, measured).
- **The logic's plot calls doing nothing at all**: the original's logic reads the plotter's
  leftovers (above); measured by the lockstep, which diverged within 1,745-4,261 passes.
- **Saving only the zero-page bytes the renderer touches**: the plotter's scratch bytes are many
  of the logic's names; the whole range is simpler and checked. A layer 3 saving.

## Memory (2026-10-16, from the listing)

- Main RAM: 517 bytes free at `&31FB-&33FF` (the player's edge-buffered save-under, ~650 bytes,
  is gone; `walk_column`, the flip and the hooks came in). Everything from `&3400` is where it was.
- Zero page: `&9B` drawing flag, `&9C/&9D` the walk's and the renderer's pointer, `&9E` free.
- Bank 4: the renderer `&9782-&9F75`; free `&9F76-&AFFF`; workspace `&B000-&BAFF` (records,
  two edge columns, two save-unders, the zero-page copy). Bank 5 `&8000-&83FF` is free.

## Open

- **b2 and real hardware** (KC): the flip of ACCCON's D bit and R12/R13 in vsync, and ACCCON's X
  bit while drawing, have only been seen in jsbeeb. Worth watching: the first frames of a game
  (the shadow copy), the switch to the game over text and back to the title, scrolling.
- Speed: layer 3.
