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
- **Micro-optimisation grind, round 3** (2026-10-22/23, branch `grind-2026-10-22`, ledger `a6d41bf`,
  batches to report `ed9a396`; merged into `gameplay-shield` as `dbeeebf`): 89 windows, 208
  candidates, 583 skeptics; 183 approved, 77 kept in 45 batches (58 stale, 47 no room, 25 refuted,
  1 no gain). Work a pass on the bench build 34,422.4 -> 31,868.8 on seed 1, 39,622.9 -> 37,279.8
  holding RIGHT; the gameplay disc 32,519.8 -> 30,386.6 / 35,276.4 -> 33,397.9 (five candidates
  left off it for room). Passlock identical across the merge (`docs/grind/README.md`).
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
- **Explosions and skeletons animate while the player is in them** (`0152c63`, BUGS #13's follow-up).
- **The scroll's two suspected glitches closed, no change** (2026-10-23, `tools/colpush.mjs`): step 2's
  plan had, from reading the code (`762a0d2`), a column lost when moving with `frame` >= 0 (firing in a
  helicopter) and a column replotted after a hostile collision. Neither happens: every scroll's column
  is pushed once and nothing is pushed twice over the whole world (13,000 passes, the WorldBot),
  helilock's flights 2 and 5, a flight firing right throughout (856 scrolling passes) and jumps let go
  in the air. Firing sets `frame` (`&81`) but the move reuses it as scratch, so it is `&80` where
  `update_screen` is decided; a hostile collision leaves it `&7F` with no scroll, so no push either.
- **The loader stops on anything but a Master 128 or Compact** (decision 51, `86a457a`): OSBYTE 0
  (X = 1) 3 or 5, else a message and back to the prompt; jsbeeb B (the message) and Master (frontend
  0 failed); the Compact's value documented, not measured (jsbeeb has none).
- **The enemy helicopters drawn over the sky as self-erasing rectangles** (decision 61, `SKY_HELI`,
  2026-10-22, all builds; supersedes the kind cache): over the whole world the helicopters' cycles a
  pass 9.0k -> 6.25k (two on screen 26.0k -> 19.2k), late frames 336 -> 176; state and every frame
  identical to the full-redraw oracle.

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

## Gameplay variations (branch `gameplay-shield`, decisions 43-68; the gameplay disc)

Each under its own flag, off by default; `build.ps1 -Gameplay` builds them all. The design, checks
and costs are `docs/briefs/gameplay-shield.md`.

- **The shield** (`GAMEPLAY_SHIELD`, decision 44): two units, recharging after 5 s; a blue bar on
  the top line, red when empty, white flash on a hit; an absorbed hit has its own sound.
  `tools/shieldtest.mjs`.
- **Lives that respawn** (`GAMEPLAY_LIVES`, 45): the skeleton, then the view rewinds (40 columns
  by default) and the player returns with the shield full and 2 s safe. `tools/livestest.mjs`.
- **The game rules screen** (`GAMEPLAY_OPTIONS`, 46, 50, 55): "6 GAME RULES" on the title: lives
  1-9 or infinite, the rewind 40/80/120/160, the timer off/up/down, the shield's hits 1/2/3/4/6 and
  its recharge 2/5/8/10 s, the run time and its charge, the timer's limit 3/5/8/10/15 minutes.
  Infinite lives ended by ESCAPE stay off the high score table. `tools/optionstest.mjs`.
- **The timer** (`GAMEPLAY_TIMER`, 47, 59, 63): counting up with a bonus for time under par, or
  counting down to the skeleton and game over; shown as MM:SS.t; the limit 15 minutes by default
  (decision 63, `2c399c2`). `tools/timertest.mjs`.
- **The front end** (`GAMEPLAY_OPTIONS`, 56): any key leaves the high score table for the menu; the
  game rules page's layout; define controls asks for RUN before PAUSE.
- **Hits through a friendly soldier** (decision 49): the original passed a projectile's hit on to
  the player when the mover it hit touched the player; gameplay builds let the mover take it.
  `tools/selfhit.mjs`.
- **The run key** (`GAMEPLAY_RUN`, 48, 52): SHIFT held runs a column a pass for 5 s, then refills
  over 10 s (usable again past half); redefinable; its times on the game rules screen.
  `tools/runmeter.mjs`.
- **Jumping and firing on the move** (`GAMEPLAY_JUMP`, `GAMEPLAY_FIRE`, 53, 54).
- **Vehicles take hits** (`GAMEPLAY_ARMOUR`, decision 62, `2d60ebb`): the player's helicopters and
  tank take 3 hits (a bullet's impact sound) before the one that wrecks them.
- **Dithered hills** (`DITHER_HILLS`, decision 64, merged `91add67`): the far, mid and fore ranges
  dithered (blue 4/16, red 6/16, red 2/16) in `MOUNTAINS_TWO`'s data, in bank 4, no new RAM;
  `MOUNTAINS_ONE` moved to bank 7. The sky tints tried with it were rejected (65, 66).
- **`MOUNTAINS_ONE` dithered too** (decision 70, 2026-10-24): KC saw undithered hills on the release
  disc, where the menu's disc activity leaves HAZEL's mountain bytes (BUGS #9) picking it. 708 bytes
  dithered, packed to 220 in bank 7 and unpacked at start-up over bank 5's dead carrier of ANDY's
  sprites. `tools/hillstest.mjs`: 708 of 708 bytes, ANDY 4,089 of 4,089; passlock, both machines'
  HAZEL forced to both sprites, `DITHER_HILLS` against its `DEBUG_FULLREDRAW` twin, seed 5: 3,226
  passes (to game over) state and screen identical (one machine poked: 1,346 screen bytes differ,
  so the run drew it); frontend on the gameplay disc 0 failed; menutest all held; the release
  disc's choice 2 has it in bank 5 byte for byte. The plain build is identical to before, every file.
- **The hills' dither in phase at flips, `MOUNTAINS_ONE`'s bottom hill at the fore density** (decision 71,
  2026-10-24): KC saw `MOUNTAINS_ONE` at 6/16 to the bottom and pixels pairing up beside `MOUNTAINS_TWO`.
  Its lowest ridge, open at its top, closed (not drawn) so the hill below is the fore tier; each sprite
  also dithered with the pattern mirrored, drawn when flipped, so every flip is in phase. Four sprites,
  2,473 bytes, packed 595 (bank 4) + 229 (bank 7), unpacked at start-up. `tools/hillstest.mjs`: 2,473 of
  2,473 bytes, ANDY 4,089 of 4,089; on its screen (HAZEL picking all four) every row's dither dots in one
  phase of the pattern; passlock as decision 70: 3,226 passes identical (one machine poked: screens
  differ from pass 16); frontend 0 failed; menutest all held; the release disc's choice 2 has the block
  in bank 5 byte for byte. The plain build is identical to before, every file.
- **The scroll text editable** (`fbe4474`, `bd8e1c2`, all builds): `src/scrolltext.txt`, encoded at
  every build by `tools/scrolltext.py`; 28 bytes of room on the shipping disc, 141 on the gameplay
  disc, whose pixel scroller moved to bank 5's `&8000` block. 2026-10-24: KC's line "BITSHIFTERS REDUX
  VERSION IN 2026 BY KIERAN USING CLAUDE CODE." overran the shipping disc by 35, so its scroller moved
  to the `&8000` block too (DATA2 from `&8000` on every disc, 1K more on the disc): 90 bytes left on the
  shipping disc, 45 on the gameplay disc. `tools/scrolltext.mjs` and `tools/frontend.mjs` on both.
- **The discs laid out in load order** (2026-10-24): Baron writes the files in source order, the reverse
  of the boot's (`MGAME` at track 0, `!BOOT` at the end), so every load sought across the disc.
  `tools/dfs.py layout` now rewrites each image after Baron (build.ps1 and the Makefile alike):
  `!BOOT`, `SRRUN`, `SCREEN`, `DATA1`-`4`, `MGAME`, then `INFO`; `tools/releasedisc.py` keeps each
  build's physical order. Boot to `entry_point` in jsbeeb 2.10.2 (which steps the head a track at a
  time): the shipping disc 12.68 s and 120 head steps before, 12.38 s and 32 after (DATA2 1K larger).
- **The screen blank across the loader's display changes** (decision 72, 2026-10-24, KC): SCREEN's mode
  change and CRTC set-up show only black and the picture appears whole; the start-up's CRTC table turns the
  display off until the title has cleared its screen. Every frame captured in jsbeeb around both: no garbage.
- **The release disc's menu blank too, and MODE 7's cursor off for the load** (decision 72's follow-up,
  2026-10-24, KC): MENU (`src/menu.bas`) runs a routine at `&0900` (`tools/menublank.py`, its DATA) that
  does for its MODE 1 change what SCREEN does for MODE 2 (display and cursor off, palette black, memory
  zeroed, the cursor held off by the vsync event), keeps the display off while MSCREEN draws and shows it
  at a vsync; its MODE 7 after a choice, and every `!BOOT`, turn the cursor off (`VDU 23,1,0`). jsbeeb,
  every distinct frame: boot text, black, the menu whole; a choice, black, the loading picture whole.
  menutest held; frontend 0 failed on both discs.
- **The build stamp shown only on debug builds** (2026-10-24, KC): `!BOOT` `*TYPE`s `INFO` when `RELEASE=0`
  and prints nothing when `RELEASE=1` (it printed the stamp itself on every build); `INFO` stays on
  every disc for `*TYPE INFO`. Checked in jsbeeb: the boot screen at SRRUN's start, both builds.
- **The high score table's names alternate** (2026-10-24, KC): "SUPERIOR  SOFTWARE" and "BITSHIFTERS   2026",
  row by row (`src/bank5.6502` `high_score_names`, 18 characters each). frontend 0 failed on both discs.
- **The disc's files packed** (2026-10-24, KC: "do the file packing"): `SCREEN`, `DATA1`-`4` and `MGAME`
  ZX02-packed by `tools/packdisc.py` after Baron (the vendored v3 compressor, `tools/zx02src`; `zx02.py`
  makes the same bytes); SRRUN (`src/loader.6502`) reads each one's load address from the catalogue
  (OSFILE 5), loads it there and unpacks it: SCREEN to `&2100`, DATAn into its bank, MGAME in place to
  `&1900` (its stream ending at `&5A80`, the margin checked by `dfs.check_stream`), then MGAME's stub as
  before. Shipping disc 81,424 bytes -> 48,415 (324 sectors -> 196), gameplay 82,541 -> 50,789; the
  release disc 706 sectors -> 456. Boot to `entry_point` (jsbeeb 2.10.2): shipping 12.38 s -> 11.33,
  gameplay 12.47 -> 11.80. Less than the bytes suggest: jsbeeb reads ~8.8K a second (~230 cycles a byte)
  and the unpack costs ~60 cycles a byte it writes, 0.43-0.6 s a bank, ~2.6 s in all. Checked: booted to
  `entry_point`, main RAM and banks 4-7 equal the unpacked files byte for byte (but the copy-down stub's
  own two operands, which it increments) on both discs; frontend 0 failed on both; scrolltext; hillstest;
  menutest; `make release-disc` = `build.ps1 -ReleaseDisc`. The `-Shift` builds stay unpacked
  (`PACK_FILES`; lockstep 3,000 frames identical). Tools read discs through `dfs.game_files`; it also
  fixed `worldmap.Build`'s DATA2 origin (`&8400`, wrong since DATA2 moved to `&8000`).
- **The HUD's row a CRTC rupture** (`HUD_RUPTURE`, decision 67, `cde5953`, merged `e5b6cae`; BUGS #15
  fixed on the way, `5b0c05a`): one character row read from `HUD_ROW` (`&0B80`) as a CRTC frame of
  its own, drawn once, no copy per screen. `tools/rupture.mjs`: over 10,000 frames the HUD read with
  D 0 and the screen with the shown screen's D (6 of 8,985 fields set D up to 10 characters late,
  in sky). Work a pass (pcprof, seed 1, jsbeeb 2.10.2, 2026-10-23) 32,953.6 -> 32,248.6; passlock
  state identical to the build without it. KC checked it on b2 (2026-10-23).
- **The HUD's contents** (decision 68, `d77061f` to `2853ce6`): the lives digit, the shield's bar 25
  pixels wide (a pixel 2 of the shield's 50), the score centred, the timer, the progress percentage
  at the right (a percent each 74 columns; 100 at the headquarters over the whole world). Work a
  pass 32,519.8 with all of it (pcprof, seed 1, 2026-10-23). `tools/shieldtest.mjs` reads the bar's
  place from the build.
- **Its own sounds** (decision 69): the shield's hit a metallic tink, its refill a tone rising with the
  bar to full (208 to 625 Hz), the run spent and ready again a falling and a rising blip, in place of
  the original's they borrowed. Passlock identical to the build without them; shieldtest and
  runmeter check them.
- **KC's choices settled** (2026-10-23): bullets keep the original's behaviour (through SAM launchers
  and dying enemies); the game rules keep their defaults.
- Speed: with every flag but the rupture, 6 late frames of 1,998 against 5 with every flag off
  (passbench, seed 1, unshifted `DEBUG_LIVES` builds, 2026-10-21).

## The release disc (2026-10-23, `docs/briefs/release-disc.md`)

- **Both builds on one disc behind the original release's menu** (`tools/releasedisc.py`,
  `build.ps1 -ReleaseDisc`): the Stairway to Hell disc's MENU and MSCREEN, its two choices redrawn
  in the artist's font as "(1) Original, faster" and "(2) Redux, improved" (KC, 2026-10-24); the original in directory `O`, Redux
  in `R`, each started by its own `!BOOT`. `tools/menutest.mjs`: the picture byte for byte, each choice
  its own directory's game to its title.

## Redux Lite: the Model B (branch `model-b-lite`, decisions 73-79; `docs/briefs/model-b-lite.md`)

- **NMOS** (2026-10-24, `3d564af`): every 65SC12 instruction given an NMOS form behind `NMOS`
  (`src/lib/nmos.6502`, `tools/nmosify.py` and its `check`/`check --nmos` proofs); without the flag
  every build is byte-identical. The whole world: state and finished frames identical.
- **One screen** (`MODEL_B`, 2026-10-24, `8872f42`): drawn in the beam's order, clusters taken off and
  put on as units; 25.04 passes/s, 0 late frames on the bench; 24 frames in 1,000 with late bytes.
- **No ANDY or HAZEL** (2026-10-25, `73e1e40`, `8c77f43`): the whole world identical to the
  double-buffered build (frames too); the cycles given for RAM listed in decision 75.
- **The Model B boot** (2026-10-25, `f1cc2f2`): `SWR` finds the sideways RAM, the start-up patches the
  bank selects; on jsbeeb's BBC B (DFS 1.2) the front end's 15 checks pass, 25.04 passes/s.
  BUGS #16 fixed on the way (every disc); BUGS #17 open.
- **The gameplay disc on the Model B** (2026-10-25, decision 76): the compiled kinds dropped, the rest placed
  for free (hills unpacked in banks 6 and 7, sky code in bank 4, the shield's tick and HUD in bank 7); every
  gameplay flag, the dithered hills, the HUD rupture and sky mode kept. The whole world's state identical to
  the Master gameplay disc on both machines; every rules harness passes on jsbeeb's BBC B; late frames 558
  against 248.
- **The player in place for its field on both Model B discs** (2026-10-25, decision 78; 77's hold superseded):
  the player's cluster after the scroll's column, before the zone's movers go back on. Frames whose first
  field missed the player 48 -> 4 in 1,000 (gameplay disc), 30 -> 1 (plain); the whole world's late frames
  548 -> 458 and 244 -> 203.
- **The edges' helicopters in place too on the Model B gameplay disc** (2026-10-25, decision 79): helicopter 0 in
  sky mode whatever bank holds its body (the image builder also in bank 4), and the zone's top rows (the sky's
  helicopters, the columns' top) behind the beam in the last frame's field. Frames missing the player 0 and
  helicopter 0 4 in 1,000 (decision 78: 8 and 43); the whole world's late frames 458 -> 336.
- **The Model B's release disc** (2026-10-25): both Model B builds behind the original release's menu
  (`-ReleaseDisc -Define NMOS,MODEL_B`, `make release-disc-b`); each release disc names its machine in the
  menu's bottom right corner.

## Tooling

- **Two builds from one repository** (decision 28, `7e60e02`): the POSIX `Makefile` beside
  `build.ps1`, the same images byte for byte; `make original` builds the tag.
- **Harnesses** (each listed in `CLAUDE.md`): lockstep and tracediff (relocation), passlock and
  helilock (two builds in step by pass), passbench (speed by pass), fieldcost and fieldsim (the
  50 Hz model), pcprof and drawprof (per instruction and per draw), frontend (15 checks), and the
  dataflow analyses (`tools/analyse.py`).
- **Bots and videos** (2026-10-21): `startWorldGame`'s `keepAlive` (the WorldBot finishes the gameplay
  disc's world); `tools/humanbot.mjs` (plays as a person might, each build's controls),
  `tools/botcompare.mjs`, `tools/bottrace.mjs`; `tools/playvideo.mjs` (a whole-world video, either
  bot); the difficulty comparison, `docs/difficulty.md`.
- **`build/` kept tidy** (2026-10-21, `44291cd`): the shipping, gameplay and original discs by
  name, harness screenshots in `build/shots/`, the rest a session's scratch (CLAUDE.md).
