# Done

What has landed, by step and layer, each with the number that says it landed. The detail is in
the layer's own document; decisions are in `docs/decisions.md`, defects in `BUGS.md`. Every
figure was measured on jsbeeb 2.5.0, Master 128 (MOS 3.20), on the date given.

## Step 1 - a buildable, relocatable source (tag `step1-identical`, `762a0d2`)

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

### Layer 1 - own the interrupt, lock to vsync (2026-10-16; tag `step2-layer1`, `0a078b8`)

`docs/step2-layer1.md`; decisions 14-20. In play the game's handler keeps vsync and User VIA T1,
the MOS only its 100 Hz tick; the pass is locked to 2 fields; the keyboard is read directly; a
PRNG replaces the VIA timer. Interrupts 21% -> 10.6% of the CPU; 16.8 -> 17.8 passes/s (town),
15.1 -> 17.0 (frame 16000). BUGS #3 (the palette split) fixed in `1041a13`, #4 (the soldier jump)
in `0a078b8`.

### Layer 2 - double buffering in shadow RAM (2026-10-16; tag `step2-layer2`, `63892d7`)

`docs/step2-layer2.md`; decisions 21-23. The logic no longer draws; a renderer in bank 4 keeps
per-screen records and draws the hidden screen; the vsync interrupt flips main and shadow; every
raster wait is gone. Pass lockstep against the single-screen control: game state identical, the
shown screen byte-identical on all but 8 of 42,000 passes. Slower then: 11.6 passes/s in the
town, 10.3 scrolling. BUGS #5 fixed here.

### Layer 3 - fast enough (2026-10-16 to 17; not tagged)

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

### Layer 4 - 50 Hz: costed, and the heaviest frames (2026-10-17; in progress)

`docs/step2-layer4-costing.md`.

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

## Tooling

- **Two builds from one repository** (decision 28, `7e60e02`): the POSIX `Makefile` beside
  `build.ps1`, the same images byte for byte; `make original` builds the tag.
- **Harnesses** (each listed in `CLAUDE.md`): lockstep and tracediff (relocation), passlock and
  helilock (two builds in step by pass), passbench (speed by pass), fieldcost and fieldsim (the
  50 Hz model), pcprof and drawprof (per instruction and per draw), frontend (15 checks), and the
  dataflow analyses (`tools/analyse.py`).
