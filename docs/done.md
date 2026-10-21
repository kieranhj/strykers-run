# Done

What has landed, by step and layer, each with the number that says it landed. The detail is in
the layer's own document; decisions are in `docs/decisions.md`, defects in `BUGS.md`. Every
figure was measured on jsbeeb 2.5.0, Master 128 (MOS 3.20), on the date given.

## Step 1 - a buildable, relocatable source (tag `step1-byte-identical-rebuild`, `762a0d2`)

- **Phase 0, toolchain and skeleton** (2026-10-16).
- **Phase 1, byte-identical rebuild** (2026-10-16): all seven files identical to the Stairway to
  Hell disc; the disc boots and plays on jsbeeb's Master.
- **Phase 2, relocatable source** (2026-10-16): every absolute reference the game and the banks
  make is a symbol - the labels, the sprite and routine address tables (`LO()`/`HI()`, flipped
  entries as sprite + offset), lo/hi immediate pairs, the copy-down blocks, vector high bytes, the
  music's page compares, the sound parameter blocks. Layout facts the code relies on are ASSERTs
  (mask tables `&80` above pixel tables in one page; the music page-aligned; the sound blocks ORed;
  the resident part ending by `&4000`). Proven by decision 7: 30,000 frames cycle-identical with
  the game a page down and the banks a page up; an odd game shift (`&40`) plays. Left numeric on
  purpose: hardware and MOS addresses, screen addresses, the bytes the mountains (HAZEL `&C300`:
  BUGS #9) and the ground read, the self-modified placeholders (`&FFFF`), five unused mover sprite
  table entries. Not exercised by the scripted play then: define controls, instructions, high score
  entry (checked statically; `tools/frontend.mjs` covers them since).
- **Phase 3, measurement harness** (2026-10-16): `tools/profile.mjs`. Baseline in
  `docs/baseline.md`: 15-17 passes a second, 25-40% of the CPU waiting for the raster, 20% in the
  MOS's interrupt handling, 10-20% plotting sprites.

## Step 2 - fast and flicker free

Speed reference: the original's design rate, 25 passes a second (decision 12). Speed comparisons
from layer 3 on use `tools/passbench.mjs` on builds made `-Shift 256 -ShiftEnd -Define
DEBUG_LIVES`: seed 1, passes 500-2000 ("seed 1"), and holding RIGHT, passes 50-650.

### Layer 1 - own the interrupt, lock to vsync (2026-10-16; tag `step2-layer1-own-interrupt-vsync-lock`, `0a078b8`)

`docs/step2-layer1.md`; decisions 14-20. In play the game's handler keeps vsync and User VIA T1,
the MOS only its 100 Hz tick; the pass is locked to 2 fields; the keyboard is read directly; a
PRNG replaces the VIA timer. Interrupts 21% -> 10.6% of the CPU; 16.8 -> 17.8 passes/s (town),
15.1 -> 17.0 (frame 16000). BUGS #3 (the palette split) fixed in `1041a13`, #4 (the soldier jump)
in `0a078b8`.

### Layer 2 - double buffering in shadow RAM (2026-10-16; tag `step2-layer2-shadow-double-buffer`, `63892d7`)

`docs/step2-layer2.md`; decisions 21-23. The logic no longer draws; a renderer in bank 4 keeps
per-screen records and draws the hidden screen; the vsync interrupt flips main and shadow; every
raster wait is gone. Pass lockstep against the single-screen control: game state identical, the
shown screen byte-identical on all but 8 of 42,000 passes. Slower then: 11.6 passes/s in the
town, 10.3 scrolling. BUGS #5 fixed here.

### Layer 3 - fast enough (2026-10-16 to 17; tag `step2-layer3-fast-enough`, `07ef49c`)

`docs/step2-layer3.md` (its table has every step), analysis `docs/step2-layer3-analysis.md`,
briefs `docs/briefs/step2-layer3-late-passes.md` and `docs/briefs/step2-layer3-ram-for-cycles.md`.

| Built | Commit | Seed 1, passes/s |
|---|---|---|
| Layer 2's control (one screen, EOR sprites) | `0a078b8` | 17.79 |
| C: the logic's sprite walk from a column table; A: masked sprites over save blocks (decision 24); B: the zero-page save cut to what the logic reads; early rejects in the searches | `61a2a57`, `2e0fedc` | 20.55 |
| E: our own 50 Hz sound effect driver (decision 25) | `828ec7a` | 21.59 |
| The next pass's logic runs while the frame waits for its flip (decision 26) | `407ab3d` | 23.38 |
| D in part: the column write unrolled, the lives digit from a table; per-cell column ends; BUGS #6 fixed | `52b97c7`, `3b63b2d`, `0bfe0f0` | 24.11 |
| Records first, restored a part at a time; the column walk and draw merged; the searches' left edge once a search | `53076ff`, `a12b92b`, `0670ca9` | 24.42 |
| RAM for cycles 1 and 3: the next column built in the wait, its history copy too | `5ad76a8`, `23ace82` | 24.43 |
| RAM for cycles 4: off-screen movers out of the list; `raise_address` in one step; tables for the multiply and the row stepping | `50deb9d`, `ea62708`, `07ef49c` | **24.70** (41 late frames of 1,498) |

BUGS #7 (a helicopter's explosion left on one screen) fixed in `c5d760b`. Set aside, with their
measurements in `docs/step2-layer3.md`: compiled enemy sprites (later done for the player, layer
4), the logic a pass ahead (RAM for cycles 5), a room check by mover type, an exact copy of the
MOS's sound, skipping transparent bytes, building the column on the pass before.

### Layer 4 - a steady 25 Hz: 50 Hz costed and set aside, the heaviest frames (2026-10-17 to 20; tag `step2-layer4-steady-25hz`)

`docs/step2-layer4-costing.md`. 50 Hz is off the table: a steady 25 Hz is the target (decision
35, 2026-10-18).

- **Costed** (`7cd0704`): option 2 (50 Hz for the cheap things) and full 50 Hz do not fit. With
  no logic at all, the render alone makes 412-634 of 2,999 frames late on seed 1 (285-446 of
  1,199 holding RIGHT); 1% late needs the render 53-67% cheaper. Recommended: a steady 25 Hz (a
  decision for KC: PLAN.md).
- **Row-major sprites** built, measured slower, set aside (`d79185a`, branch `row-major-sprites`):
  166 late frames of 1,498 against 41.
- **The player's 8 commonest sprite parts compiled**, `draw_column` trimmed (`e72c386`): late
  frames 41 -> 24 (seed 1), 26 -> 10 (holding RIGHT); 50 Hz option 2 529 -> 389.
- **BUGS #8 fixed** (`b10d6b5`, decision 30): game state identical; the screens differ in the
  corrected columns only.
- **The other 6 running parts compiled into HAZEL; the front end's tunes packed** (`c08f9dd`,
  decision 29): late frames 22 (seed 1), 2 (holding RIGHT); 50 Hz option 2 364 / 200.
- **The compiled kind found by index** (`6cc44ba`): `compiled_part` 617 -> 248 cycles a player
  draw; late frames 21 (seed 1, 24.86 passes/s), 1 (holding RIGHT, 25.02).
- **Micro-optimisation grind, round 1** (the beeb-micro-grind skill; `801966e` to `99185f2`): 96 of
  177 candidates kept, each batch gated; work a pass (pcprof, the wait excluded) 43,036 -> 39,112
  on seed 1, 49,857 -> 45,570 holding RIGHT; late frames (passbench) 21 -> 7 of 1,998, 1 -> 0 of
  598. Every candidate and its fate: `docs/grind/README.md`.
- **RAM rearranged** (decisions 32-34: `69f9321`, `0e4a24d`, `acd4c4a`; tag `step2-grind1-ram-rearranged`): the
  renderer's variables in its workspace holes (render.6502's room 68 -> 797 bytes), `MGAME`'s
  start-up code carried in the save arena's bytes (its room 33 -> 2,271), the renderer's 48
  hottest variables in the zero-page unpacker's dead body: work a pass 38,462 (seed 1), 44,855
  (holding RIGHT); late frames 6 of 1,998 and 0 of 598.
- **BUGS #10 fixed** (2026-10-18, on `8ae47e4`): every record's world position right (worldcheck
  0 of 29,829 over the whole world, from 984 of 29,847); a constructed overlap at the left edge
  (`tools/scrollleft.mjs --place`) 0 frames from the oracle, from 73 of 4,000; the gate's checks
  identical; work a pass 14.1 cycles less on seed 1, 2.0 more holding RIGHT.
- **BUGS #12 fixed** (2026-10-18, on `72ab52b`): the generator's state moved from `&92`/`&93`
  (`&92` is the original's scratch: every death set its low byte) to `&BC`/`&BD`, which nothing
  else touches in a game (`tools/zpwatch.mjs`). Against the control with the clobber undone in the
  emulator (`--unclobber`): seeds 1, 3 and 5, both helicopter flights and the whole world, state
  and screen identical; work a pass 33.0 cycles less on seed 1, 28.3 holding RIGHT.

- **The scroll column in HAZEL, the scenery unpacker, the tables moved** (decisions 38-40,
  `48e86a1`, `ca825e3`, `eb8fb4f`; `docs/step2-layer4-scroll.md`): a scroll 3.9k / 3.6k -> 2.0k /
  1.4k cycles; main RAM 20 -> 1,044 bytes free.
- **BUGS #11 fixed** (`a5618e0`): observer mode's keys, dead since grind G0038; `tools/observer.mjs`
  in the gate.
- **The kind cache and the overlap rule by draw order** (decisions 36-37, `a9c2e97` to `a13c1dd`,
  branch `layer4-late-frames`): the helicopters' bodies drawn from kinds built in the waits; the
  whole world's late frames 644 -> 406.
- **The whole world played through** (`tools/worldrun.mjs`, `5714760`): 12,233 passes to the
  headquarters, state and newest frame identical to the full-redraw oracle on every pass.
- **Micro-optimisation grind, round 2** (`af3881e` to `ccaa7b3`, report `cc80d16`): 179 of 372
  candidates kept over both rounds; work a pass at the close 34,826 on seed 1, 39,341 holding
  RIGHT (pcprof, the wait excluded; 36,779 / 41,141 on `layer4-late-frames`).
- **Closed** (2026-10-20, decision 42; `docs/step2-layer4-costing.md` "Closed"): late frames 0 of
  1,998 on seed 1, 0 of 598 holding RIGHT, 339 of 12,235 over the whole world (known and left).
  The milestone tags renamed for what each achieved.

### Layer 5 - the original's quirks (decision 13; from 2026-10-20, in progress)

- **BUGS #1 fixed** (`7517558`): the ground's texture from a fixed 31-byte table, not whatever
  zero page held; game state identical to the control, the screen to the full-redraw oracle (seed
  5, the whole world); an unshifted and a shifted build now draw the same ground; work a pass
  34,825.5 -> 34,794.0 (seed 1), 39,341.1 -> 39,273.5 (holding RIGHT).
- **BUGS #2 closed, no change**: the original never reads past the legs sprite (jsbeeb, 4 seeds x
  30,000 frames on the step 1 layout); the read step 1 saw was its test build's own data, moved
  under the screen by the ground patch's 4 bytes. Step 2's renderer walks counted, decoded columns.
- **BUGS #13 fixed** (all builds): one hit cost up to 14 lives (the explosion it left kept hitting;
  a projectile run into hit twice). Explosions and skeletons are walked through, a projectile run into
  is spent; the whole world's hits 655 -> 318, no repeat in one pass or from an explosion
  (`tools/hitwatch.mjs`); a skeleton soft-lock found and fixed on the way.

### The front end (2026-10-21, all builds)

- **The loader stops on anything but a Master 128 or Compact** (decision 51, `86a457a`, `ee37141`):
  OSBYTE 0 (X = 1) 3 or 5, else "Needs a BBC Master 128 or Compact." and back to the prompt; jsbeeb B
  (the message) and Master (frontend 0 failed); the Compact's value documented, not measured.
- **The scroll text a pixel every 2 fields** (decision 57, `9c00de9`): the original moved 2 pixels
  every 4; `scroll_pixel`, the same 25 pixels a second, run with interrupts on (the MOS's 100 Hz
  tick, the music, unharmed). `tools/scrolltext.mjs`: 197 exact one-pixel steps in 400 fields.
- **Define controls aligned on its colons; "OPTIONS" gone from the menu** (decision 58, `dd44f04`).
- **The credit line cycles with "REDUX BY BITSHIFTERS 2026"** (decision 60, `2216a31`): every 5 s,
  each glyph wiped a pixel at a time in its cell, a step every 2 fields on the fields the scroll text
  does not use. `tools/credits.mjs`: every field matched against both lines at every shift.

## Tooling

- **Two builds from one repository** (decision 28, `7e60e02`): the POSIX `Makefile` beside
  `build.ps1`, the same images byte for byte; `make original` builds the tag.
- **Harnesses** (each listed in `CLAUDE.md`): lockstep and tracediff (relocation), passlock and
  helilock (two builds in step by pass), passbench (speed by pass), fieldcost and fieldsim (the
  50 Hz model), pcprof and drawprof (per instruction and per draw), frontend (15 checks), and the
  dataflow analyses (`tools/analyse.py`).
