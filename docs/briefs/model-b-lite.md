# Brief: Redux Lite - the plain disc on a Model B with 64K sideways RAM (branch `model-b-lite`, from 2026-10-24)

KC, 2026-10-24, from a community question (Integra-B): "Do some investigation into the feasibility
and trade offs that would be required to make a Model B + 64K SWRAM rather than the Master." Then,
on the scope below: "Let's go build this on a branch. Start with the plain disc. No disc loading to
start with. Keep dither and helis. Find and patch banks at load, same as Paradroid."

## Why not the Integra-B or the B+ as they are

- **Integra-B**: 20K of shadow RAM, but the CPU's only (SHEN, `&FE34` bit 7, with MEMSEL, `&FE30`
  bit 7, page it at `&3000-&7FFF`); the video always shows main RAM (the board sits in the CPU
  socket; its manual's table is the CPU's paging only; BeebEm models its shadow as an array the video
  never reads). So decision 23's two screens, shown in turn, cannot be done. Its latches are write-only
  (IBOS keeps copies at `&F4`, `&037F`). Neither jsbeeb nor b2 emulates it (BeebEm does).
- **B+**: its shadow can be shown, but the CPU's reads and writes go with the display (KC,
  2026-10-24): it cannot draw one screen while showing the other.

So the Lite build draws into **one screen, the one shown**, and needs no shadow RAM: a Model B with
four sideways RAM banks, and so an Integra-B or a B+ too, as plain Model Bs.

## Agreed (KC, 2026-10-24)

- **The plain disc first** (no `GAMEPLAY_*` flags), **with `DITHER_HILLS` and `SKY_HELI`** ("keep
  dither and helis": the plain disc has no dither today, so the Lite build adds it).
- **No disc loading in play**: everything in memory, as now (the front end stays resident).
- **Banks found at load and patched, as Paradroid** (its `src/swram.asm`, `docs/layer-13-compatibility.md`
  decisions 1-3: stnicc-beeb's probe, banks the MOS found no ROM in only, the four highest RAM banks,
  Solidisk detected and refused, no detector means 4-7). Here the bank selects are patched at load
  from a build-made list of sites (Paradroid's "not built" variant: cycle-neutral), not read from a
  table, since the renderer pages banks in its hot paths.

## The target

Model B, NMOS 6502, MOS 1.20, a DFS (PAGE `&1900`), four 16K sideways RAM banks written through
ROMSEL. No shadow RAM, ANDY, HAZEL or private RAM.

Carries over as it is: the logic, the 50 Hz sound effects (decision 25), the keyboard read off the
System VIA, the vsync interrupt and its CRTC writes, the loader's packed files (`MGAME` already loads
at `GAME_LOAD = &1900`), and the front end's MOS calls (OSBYTE `&13`, `&81`, `&8C`, `&90`, `&9A`, `&B2`,
`&E9`, `&0D`/`&0E`, events: all MOS 1.20's). The loader's OSBYTE 0 Master check goes.

## 1. The renderer: one screen, in beam order

The CRTC shows 80 x 25 cells, 16,000 of the screen's 16,384 bytes, so there is no hidden column: the
column the scroll brings in at the right is the left column one row down, shown until the frame
ends. The screen start (R12/R13) is taken at the top of a frame; between the last displayed line and
the next frame's first are 112 blank lines, 14,336 cycles (R4 38, R6 25, R7 32: vsync 56 lines before
the top). The rules:

- in that blank, the new edge column (built ahead, 200 bytes) and then **the player**, who stays put on
  screen while the scroll moves the screen under them: they must be redrawn before the beam reaches
  them or they shake by a column;
- every other mover (with all it overlaps) off and on in one go, either **ahead of the beam or
  behind it**, never with the beam inside it; masked, over save blocks, never EOR on the shown screen,
  so no flicker;
- at 25 Hz a frame is shown for two fields, the second unchanged: a mover done behind the beam shows
  one field (20 ms) late, not torn. A frame is late only if the render is not done before the beam
  comes round in the second field;
- records for one screen, not two (index `slot + 64 * screen` goes), the two-column history goes, and
  each render catches up one pass, not two (at 25 Hz each screen is two passes behind: about 1.46
  columns a render at 0.73 a pass). Probably cheaper; not measured.

Measured today (2026-10-24, local jsbeeb, `tools/pcprof.mjs build/strykers-gameplay.ssd --detail
--passes 1500`, seed 1), cycles a pass:

| | p50 | p90 | p99 | max | mean |
|---|---|---|---|---|---|
| work (logic + render + interrupts) | 28,181 | 47,783 | 67,285 | 80,113 | 30,384 |
| render | 18,311 | 32,876 | 45,358 | 60,472 | 19,869 |
| logic | 7,574 | 13,787 | 20,629 | 37,205 | |

A pass is 79,872 cycles; the mean wait is 47,650. The one-screen render has the blank and a field
(about 54K) to finish in: p99 fits, the maximum does not (late frames, as now). Unknown until built:
what keeping to the beam's order costs, and where on the screen the peaks fall.

## 2. Memory: about 12K without a home

To move (gameplay disc's listing; the plain disc is close):

| What | Bytes | Now |
|---|---|---|
| 53 sprites | 4,092 | ANDY, read with bank 4 paged |
| 6 compiled player parts | 3,817 | HAZEL `&C700-&D5E9` |
| tables, scroll column code, sky geometry | 2,583 | `hazel_b` |
| sky image builder | 222 | `hazel_c`, `&C200` |
| `times_78_lo/hi` | 512 | HAZEL `&C000`, made at start-up |
| NMOS code (worst case) | ~577 | everywhere |

Main RAM and every bank are full (bank 4 to `&B3E6` under its workspace, banks 6 and 7 to `&BFE6`
and `&BFD5`). Where room can come from, with no disc loading:

- **ANDY's sprites stay in bank 5**, where they are carried (`andy_load`), drawn by a copy of the
  masked draw loop there (as `compiled_call` pages a compiled kind's bank). But `DITHER_HILLS` unpacks
  its 2,473 bytes over that carrier: they need a home of their own.
- **HAZEL's 6 compiled parts drawn as straight sprites** (their compiling was worth late frames 24 ->
  22 on seed 1, 10 -> 2 holding RIGHT: `c08f9dd`).
- **One screen's records** in bank 4's workspace: about 1.5K.
- **The front end's tunes kept packed in play** and unpacked at each game over: most of their 4.4K at
  `&9300` (net about 3.4K).
- Past that, features measured for room (decision 40's way, at a larger scale).

On a Model B `&C300` is the MOS 1.20 ROM: the mountain layer picks fixed sprites from its bytes, as
the standard version's do (BUGS #9).

## 3. NMOS

349 CMOS instructions in the gameplay build (137 STZ, 118 BRA, 48 INC/DEC A, 25 PHX/PHY/PLX/PLY, 9
`(zp)`, 6 TSB/TRB, 6 BIT `#`/`zp,X`). Weighted by how often each ran in the profile above, their NMOS
forms cost **at most 683 cycles a pass** (0.9%), over half in bank 4. Baron's `cmos = FALSE` on a
section rejects every one at assembly (checked: "CMOS-only instruction").

## 4. Banks and paging

About 40 ROMSEL writes carry a bank number: each becomes a labelled site the build lists, and the
loader patches them from the probe's answer. `&84`/`&85` (ANDY) go. Only boards written through
ROMSEL are supported.

## 5. Testing

jsbeeb's Model B (`B-DFS1.2`) has RAM in banks 0-7 (`models.js` `beebSwram`), and its NMOS core trips
on any CMOS opcode left. The logic is unchanged, so passlock against the Master build should hold game
state pass for pass and the screen field for field; a beam check in `tools/rupture.mjs`'s way proves no
write lands where the beam is.

## Order, each proven on the Master before the next

1. **NMOS-clean source** (the `NMOS` flag): below. Done.
2. **The one-screen renderer** behind a flag (`MODEL_B`): needs no shadow, so it runs on the Master
   too, against the plain build and the `DEBUG_FULLREDRAW` oracle. Moved ahead of the memory work
   (2026-10-24): one screen frees the second screen's records, its history column and the flip, room
   the memory work needs.
3. **Nothing in ANDY or HAZEL**, still on the Master.
4. **The Model B boot**: the bank probe and patching, the loader; then the target matrix and real hardware.

## Step 1: NMOS (2026-10-24)

- `NMOS` (build.ps1 and the Makefile, 0 by default): every section is `cmos = CMOS` (`CMOS = NMOS = 0`),
  so Baron rejects a 65SC12 instruction left. `src/lib/nmos.6502`'s macros are the 65SC12 instruction
  without `NMOS` - the plain, dither and gameplay discs stay byte-identical (`tools/dfs.py compare`,
  every file but the stamp's `INFO` and `!BOOT`) - and with it the NMOS form named.
- `tools/nmosify.py` chose each site's form from the dataflow analysis (`tools/analyse.py annotate`):
  281 sites in the plain-with-dither build, 232 by rule (a register known 0, a flag known for a
  branch, a register or C dead), 49 by hand (`IF NMOS` blocks, the hand-checked macros marked
  `(hand)`). `check` re-proves them after any change, in two halves, both needed: on a build without
  `NMOS`, that each form's register or flag is free there; on an `NMOS` build (`check --nmos`), that
  what an NMOS form newly reads - a branch's flag, a register known 0, C - is as the NMOS code leaves
  it. Two bugs were found that way, both from one form's change meeting another's new read: a
  `CLC`/`ADC #1` before a `BRA` made `BCS` (`render.6502` `draw_column`), and a `BIT abs,X` made
  `LDA`/`ASL` before a `BRA` made `BCS` and another made `BVS` (now `AND #&40`, and that `BVS` a `BNE`).
- Room: `ROOM_ANY` (= `GAMEPLAY_ANY OR NMOS`) drops the main block's unexecuted padding as the gameplay
  builds do, and `moved_0a20` starts at `&0982` (decision 59); the renderer's workspace (`REN_BASE`) is a
  page higher in `NMOS` builds; the credit line moves into bank 5's `&8000` block.
- A start-up write of the IRQ vector's high byte to `leave_irq1_handler + 7` (a fixed offset into code
  the NMOS exit lengthened) is now `previous_irq1_vector_low + 1`. Every other `label + n` into code checked.
- Measured (jsbeeb 2.10.2, 2026-10-24), the `NMOS` build against the same flags without it
  (`-Define DITHER_HILLS`): passlock seed 1, 4,000 passes, state identical; `tools/frontend.mjs` 0 failed;
  passbench seed 1, passes 500-2,500: 25.04 passes/s, 79,867 cycles a pass, 0 late frames, both;
  the whole world (`WORLDRUN_HAZEL=0 tools/worldrun.mjs --control --screen`, at `17180e0`): 11,412 passes to the
  completion screen, state identical every pass, the newest frame identical every pass; late frames 143 against
  130 (24.88 against 24.90 passes/s). `WORLDRUN_HAZEL=0` fills HAZEL `&C300-&C6FF` alike in both machines: the
  mountain layer picks its sprites from those bytes, which the DFS leaves as each disc's loads do (BUGS #9), and
  the two discs' files differ (5 bytes differ at the game's start; without it the newest frames differ on 499
  passes, in the mountains only).

## Step 2: the one-screen renderer (`MODEL_B`, 2026-10-24)

Stage 1, built: `MODEL_B` (needs `NMOS`) draws into main RAM only, in today's order, from the moment the
beam has shown the last displayed line of the field before the frame's (`render.6502` `wait_for_window`:
the frame's field T is the last frame's + 2, or the next if that has begun; T2 from the vsync past
`&BEFF`, 16,640 us, the display ending at 16,384). The flip (R12/R13 at T's vsync, 56 lines on) is
armed there and then: with one screen the frame need not be finished first, only drawn ahead of the
beam (the scroll's column in the blank) or behind it, where it is seen a field late. Waiting for the
last flip first matters: a quick pass otherwise moved the target on while a flip was pending (a frame
lost, its predecessor shown 4 fields). No ACCCON X or D, no shadow copies; the vsync interrupt still
writes `shown_screen` (0) at each flip, as the harnesses count frames by it. A page pad in the target
search put a `BPL` out of reach in this layout: it now picks `BMI`/`JMP` where it must.

Measured (jsbeeb 2.10.2, 2026-10-24; `-Define DITHER_HILLS,NMOS,MODEL_B` against `-Define DITHER_HILLS,NMOS`):
- passbench seed 1, passes 500-2,500: 25.04 passes/s, 79,865 cycles a pass, 1,997 frames each shown 2
  fields, 0 late;
- the whole world (`WORLDRUN_HAZEL=0` worldrun `--control --screen`): 11,412 passes, state and the
  finished frame identical every pass; late frames 123 against the double-buffered build's 143;
- frontend 0 failed (the game over screen's hash the double-buffered build's), observer mode works;
- `tools/beamcheck.mjs` (new: every screen write placed against jsbeeb's 6845 beam), passes 501-1,500:
  of 999 frames, 100 had late bytes (899 none), 14,124 of 211,861 writes, all in a frame's first field:
  the sky helicopters' drawing at the top left (`sky_draw`, rows 5-8, about 8,400), the lives digit
  (row 0, columns 0-3, 2,341), movers (`draw_column`, about 3,000), the scroll column (about 130). Work
  done late in the render's order lands near the top after the beam has passed it.

Stages 2 and 3, built (`src/render_clusters.6502` under ANDY, `render.6502`): the work in the beam's order.
- **Clusters**: after the overlap closure each changing list entry joins every changing entry it overlaps,
  through any chain (`cluster_build`, labels relabelled on each join); an entry shown in the scroll's zone
  (need bit 5, set in classify) or whose rectangle - where shown and where it goes - meets a zone column
  (`span_in_zone`) joins the one zone cluster, since the scroll's columns and the lives digit are written
  over what is there. A cluster is taken off (the player first, then reverse slot order) and put on (slot
  order, the player last) as a unit; clusters do not overlap, so their order cannot change the frame.
- **Order**: render starts as the field before the frame's begins (`wait_for_field`, the flip armed then).
  While that field displays, each cluster whose lowest line the beam has passed (a row to spare: its bytes
  sit a column right, or at the right edge a row down, in the last frame) is drawn behind the beam
  (`behind_beam`, from T2: line about 4 * (&FF - T2CH) - 56); none is started from line 168, and the
  display's end is awaited. Then, in the blank, the zone's cluster with the scroll's column and the lives
  digit; then the rest from the one reaching highest down, ahead of the beam in the frame's field.
- The cluster state lives in screen 1's halves of the record arrays (unused with one screen).

Measured (jsbeeb 2.10.2, 2026-10-24, `tools/beamcheck.mjs`, now counting before a frame's flip writes ahead
of the beam as early, after it writes behind the beam as late):

| build | game | frames | with early or late bytes | late bytes | early bytes |
|---|---|---|---|---|---|
| stage 1 (today's order, from the display's end) | seed 1, passes 501-1,500 | 999 | 100 | 14,124 | 0 |
| stage 2 (clusters, zone first, from the display's end) | seed 1, passes 501-1,500 | 999 | 57 | 7,417 | 0 |
| stage 3 (behind the beam first) | seed 1, passes 501-1,500 | 1,000 | 24 | 711 | 0 |
| stage 3 | seed 2, passes 501-1,500 | 1,000 | 17 | 660 | 0 |
| stage 3 | seed 1, passes 2,001-4,000 | 2,000 | 43 | 4,293 | 0 |

What is left late is the player (rows 19-21) and the helicopters (row 5) in the heaviest frames. Speed
unchanged: passbench seed 1, 25.04 passes/s, 1,998 frames each shown 2 fields, 0 late; the arenas' top
`&3D27`. Finished frames identical to the double-buffered build's (worldrun, the whole world: 11,412 passes, state and the
finished frame identical every pass; late frames 120 against 143). The `-Define DITHER_HILLS` and `NMOS` builds
unchanged by it (every file).

## Step 3: nothing in ANDY or HAZEL (decision 75, 2026-10-25)

Part 1 (`73e1e40`): ANDY's 53 sprites stay where `DATA2` carries them in bank 5 and are drawn from
there by bank 5's copy of the column loop (`src/render_b5.6502`, through `call_b5` in main RAM:
`sprite_in_b5` says which); HAZEL's 6 compiled kinds are refused before their save entry is written
and drawn straight; the renderer's workspace compacted for one screen (`REN_BASE` `&B800`, records
at a `&40` stride, the clusters' state at `REN_CL`); sky mode's image builder at bank 5's end, its
tables copied there.

Part 2 (`8c77f43`): what `hazel_b` held, by where it is read (`tools/hazelbanks.mjs`-style scratch:
every HAZEL execution and table read with the ROMSEL it ran under, 3,000 passes):

| what | bytes | where (MODEL_B) |
|---|---|---|
| the scroll column's code (`pre_cancel`, `edge_right` as a loop, `ground_square`, `unpack_scenery_column`), mover widths, the player helicopters' speeds, `times_78_of_a` | 460 | `mb_low`, `&0BC8-&0D94` (after `moved_0a20`; under the MOS's extended vectors at `&0D9F`; the DFS's NMI page is idle once loaded) |
| the player helicopters' initial x | 30 | the main block's free room (`&33E1`) |
| sky mode's geometry and column checks (`sky_hazel`) | 430 | helicopter 1's sky image's room, `&3E40-&3FEE` (helicopter 1 masked) |
| the animation table, `sprites_y_offset`, the other mover type tables | 524 | bank 4 (only read with it paged) |
| `times_78_lo/hi` | 512 | none: computed |

The arena may not run into code now: `sky_room` asks for the mover type's largest block
(`src/sprite_blocks.6502`, `tools/sprites.py blocks`), not `MAX_BLOCK`, which refused small draws;
none refused over 12,000 passes. No ACCCON write in `MODEL_B`.

Measured (jsbeeb 2.10.2, Master, 2026-10-25): the whole world against the double-buffered NMOS build,
state identical, every finished frame identical (11,412), late frames 244 (126); helilock flights 2,
5, 8 identical; passbench 25.04 passes/s, 1 late frame; beamcheck 37 frames in 1,000 with late
bytes (24 at step 2), 0 early.

### The cycles given for RAM (to win back)

1. HAZEL's 6 compiled kinds drawn straight: the larger part of the late frames' rise (126 -> 251).
2. ANDY's sprites through `call_b5` (a bank switch there and back a column draw).
3. Sky mode for helicopter 0 only, and only with a body sprite bank 5 holds.
4. `times_78_of_a`: ~100 cycles a moved mover where the table took ~25.
5. `edge_right` looped: ~10 cycles a mover on each right scroll.
6. The arena's room test by mover type: ~30 cycles where it tests.

Ways back: the save arena single (one screen) is 2,294 bytes, its live blocks peak near 2,000, so
part of it can hold code; bank 6 has ~530 and bank 7 ~480 bytes free; the gameplay disc needs its
own sums (its HUD buffer and rules code).

## Step 4: the Model B boot (decision 74, 2026-10-25, `f1cc2f2`)

`!BOOT` (no Master check) runs `SWR`, the probe (`src/swr.6502`: Paradroid's, after stnicc-beeb), then
SRRUN, which fills the banks found; the game's start-up patches its bank selects (`bank_patch`: 20
immediates labelled `.bks_*`, `scenery_sprite_banks`, `ck_bank`, and an unset layer's bank pointed at a
bank with no ROM the game does not use). The disc runs on a Master too (the probe finds 4-7).

Measured (jsbeeb 2.10.2, `B-DFS1.2`: BBC B, DFS 1.2, banks 0-7 RAM, 2026-10-25): boots, probes
("Sideways RAM found: 7 6 5 4 3 2 1 0 / Using banks: 4 5 6 7"), frontend's 15 checks 0 failed, observer
ok, passbench 25.04 passes/s and 1 late frame, beamcheck 37 in 1,000 late and 0 early, helilock flight
5 state identical to the Master build; the whole world with the banks at 0-3 or permuted, state
identical every pass (BUGS #17: 28-32 frames at the headquarters' approach differ).

The Model B's screen differs from the Master's in two places the original takes from what the machine
has: the ground's texture (the MOS ROM at `&E000` as a random stream) and the mountain layer's choice
of sprite (HAZEL's bytes on a Master, BUGS #9; MOS 1.20's ROM at `&C300` on a B). Both are the
original's behaviour on that machine.

Not done yet: real hardware and other emulators (b2, b-em; `beeb-target-matrix`); Paradroid's ROM
image as the fourth bank; BUGS #17.

## Step 5: the gameplay disc on the Model B (decision 76, 2026-10-25)

Its code's NMOS forms first (2026-10-25, `2ebf85d`: 72 sites and 4 by hand). Then KC, 2026-10-25: "Drop the remaining compiled sprites to get the gameplay version built." Built as
`.\build.ps1 -Gameplay -Define NMOS,MODEL_B` (`make DEFINES=NMOS,MODEL_B,GAMEPLAY_SHIELD,...,HUD_RUPTURE`, the same
image): every gameplay flag, `DITHER_HILLS`, `HUD_RUPTURE` and sky mode kept. `MB_GAMEPLAY` (`MODEL_B` with
`GAMEPLAY_SHIELD`) lays it out; `COMPILED` is 0 there. Every other build is byte-identical to before (plain,
gameplay, NMOS, the plain Model B disc: every game file).

What went where:

| what | from | to | cycles |
|---|---|---|---|
| the 8 compiled kinds (banks 5-7), `compiled_table`, `compiled_call`, `player_save` | | gone: the player drawn straight, its saves in the arena (117 bytes larger) | the price (below) |
| the dithered hills (2,473 bytes) | packed in banks 4 and 7, unpacked into ANDY's carrier | unpacked on the disc (`DATA3`/`DATA4` are packed anyway): `MOUNTAINS_ONE` and its mirror in bank 6, `MOUNTAINS_TWO` and its mirror in bank 7 (`src/hills_dither_b6/b7.6502`, `tools/ditherhills.py`); no `unpack_hills` | none |
| sky mode's code (`sky_main`, 506) and geometry (`sky_hazel`, 430) | main RAM | bank 4 (only the renderer calls them, bank 4 paged); its state and helicopter 0's image stay in main RAM (`src/sky_state.6502`) | none |
| the shield's tick, the HUD's builders and the score/progress (`shield_tick`, `shield_hi`, `hud_extra`, `hud_extra_init`, ~720) | bank 4 | bank 7, called by `timer_tick_call` after it pages bank 7 for the run meter (the tick first, as `main_game_loop` called it just before); `time_up_now`'s death through `time_up_b4` (main RAM: bank 4 for `shield_hit`'s path, bank 7 back) | none a pass |
| `rupture_on`, `rupture_off` (119) | main RAM | bank 5 (the front end calls them, bank 5 paged) | none |
| the gameplay front end (`front_gameplay`) | bank 5's `&8000` block | bank 5's end | none |
| the rupture's tables HAZEL held (triggers, `new_helicopter_types`, `level_movers_x_low`, `ground_columns`, T1 counts), the player helicopters' speeds, the mover widths | HAZEL / `mb_low` | the main block | none |
| `mb_low` (the scroll's code, `times_78_of_a`) | `&0BC8`, under the HUD row now | helicopter 1's image's room, `&3E40-&3FEF`, copied by `initialisation` | none |

On a Model B `&FE34` is ROMSEL, so the rupture's two ACCCON writes (D for the HUD's frame and the
screen's) are left out under `MODEL_B` (one screen, main RAM's); `tools/rupture.mjs` expects none there.

Free (2026-10-25): bank 4 885 bytes, bank 5 1,167 at its end and 114 in its `&8000` block, bank 6 967,
bank 7 96, the main block 97, helicopter 1's image's room 16, `moved_0a20` 22.

Measured (jsbeeb 2.10.2, 2026-10-25):

- The whole world (WorldBot, `keepAlive`) against the Master gameplay disc: on jsbeeb's Model B (`B-DFS1.2`),
  state identical every pass to completion (11,412 passes); on the Master, state identical and every frame
  identical but 28 (with `WORLDRUN_HAZEL=0`: the mountain layer reads HAZEL's DFS workspace, which each
  disc's catalogue leaves different, BUGS #9), the last 28 passes, the headquarters' approach, up to 22
  bytes in the right edge's columns: BUGS #17's.
- The price: the whole world's late frames 558 against the gameplay disc's 248 (Master; on the B 548
  against 242), 23.88 passes/s against 24.76. passbench (passes 500-2500) on the B: 25.00 passes/s, 7
  late frames, as the Master gameplay disc (25.00, 7). beamcheck on the B: 56 frames in 1,000 with late
  bytes (the plain Model B disc 37), 0 early.
- On the B: frontend 17 checks 0 failed; optionstest 0 failed (it now waits for the high score table's
  key loop: the B draws the table more slowly, and a key pressed while it draws is, by design, not taken);
  timertest over the whole world, `--bonus`, and `--short` (a `GAMEPLAY_TIMER=2` build: time up, the
  skeleton, game over through `time_up_b4`) all held; livestest 3,000 passes (8 deaths, rewinds,
  respawns) held; shieldtest held, with `--wait 10` (30 refill tones through bank 7's `tick_sound`) the
  same game as the Master disc's; runmeter held; observer ok; rupture: every CRTC write in place, the HUD
  and screen read right; the sound effects' values the Master disc's, in order. helilock does not board
  on the gameplay disc (Master against Master too), so the flights rest on the whole world (4,513 passes
  in the air).

### The cycles given for RAM (to win back)

Decision 75's six, and: (7) the 8 remaining compiled kinds drawn straight (the larger part of the
whole world's late frames, 248 -> 558). Ways back: bank 4's 885 and bank 6's 967 free bytes (some
compiled kinds again, or `times_78`'s 512-byte table if its reads are all with bank 4 paged).

## Step 6: the player never torn (decision 77, 2026-10-25; superseded by 78, step 7)

KC, 2026-10-25: "it is a little flickery around the player sometimes. can you tighten up the timing for the player
sprite plotting specifically?" `tools/beamcheck.mjs --slot` (new: late bytes by the slot being drawn, and the frames
each was torn in, its writes after the flip partly behind the beam and partly ahead) on the gameplay disc, seed 1,
passes 501-1,500: the player (slot 0) late in 42 frames of 1,000, torn in 38. Traced: its cluster went after every
cluster reaching higher, and its put on alone is about 9,500 cycles (p50; p90 10,500, p99 22,000: 74 lines and more,
most of it bank 5's column loop, the compiled kinds gone), its take off about 3,700; in heavy frames the zone's
cluster ran 150-180 lines into the field first.

`PLAYER_HOLD` (the gameplay disc; the plain disc's bank 4 is 87 bytes short): `player_first`, after the zone's
cluster, draws the player's if `PLAYER_E` (28 T2 counts, 112 lines) fits before the beam reaches its top line in T;
else holds it (`cl_pdef`, skipped by `pick_cluster`) and `player_behind`, after the others, draws it once the beam is
`PLAYER_SPARE` (a row) past its cluster's threshold, or at once if T has gone. A held player is whole, a field late.

| disc | player torn | player late bytes | whole world late frames | passbench (B) |
|---|---|---|---|---|
| decision 76 | 38 | 2,057 | 548 (23.89 passes/s) | 25.00, 7 late |
| player's cluster first after the zone's | 33 | 1,825 | | |
| held, `PLAYER_E` 28, threshold as the others' | 9 | 762 | | |
| held, `PLAYER_E` 36 | 11 | 1,154 | 691 | |
| held, `PLAYER_E` 28, a row more (built) | 2 | 86 | 686 (23.75) | 24.97, 12 late |

(jsbeeb 2.10.2 Model B, 2026-10-25.) The 2 left: an arena compaction inside the player's put on (130 lines and more).
Held: 48 of about 400 player draws. The whole world's state identical to the Master gameplay disc every pass. The
cost is the wait for the beam: the cheaper way to fewer holds is a cheaper player (compiled kinds again in bank 5's
1,167 free bytes and bank 6's 967: the commonest, `ck2`, `ck3`, `ck1`, 569 bytes each).

## Step 7: the player in place for the field (decision 78, 2026-10-25)

KC, 2026-10-25: "the problem with deferring the player to the second field is that you more often get ghosting with
the player not staying centered in the screen. they are offset by one column due to the mismatch of when the sprite
is plotted vs the scroll. let's fix this!" Decision 77's hold only turned a torn player into one shown a column off.
`tools/beamcheck.mjs --slot` now counts, per slot, the frames whose first field missed its bytes (written behind
the beam, after that field's display, or in a later field; beamcheck had not judged writes in the blank), and of
them the frames that scrolled. Traced: in those frames the zone's cluster (most often an edge helicopter) went back
on until rows 7-13 of the field before the player's started. `PLAYER_NEXT` (both Model B discs): `player_next`
draws the player's cluster after the scroll's column and the lives digit, before the zone's movers go back on
(clusters do not overlap, so the order cannot change the frame).

jsbeeb 2.10.2 Model B, 2026-10-25, beamcheck seed 1, passes 501-1,500 (missed: frames whose first field missed a
slot's bytes; of the player's, all but a few on frames that scrolled):

| disc | player missed | torn | column missed | helicopter 0 missed | whole world late frames |
|---|---|---|---|---|---|
| gameplay, decision 76 | 48 | 38 | 7 | 31 | 548 (23.89 passes/s) |
| gameplay, decision 77 (held) | 50 | 2 | 8 | 33 | 686 (23.75) |
| gameplay, zone and player behind the beam from line 184 (dropped) | 42 | 36 | 8 | 29 | |
| gameplay, `player_next` (built) | 4 | 4 | 8 | 40 | 458 (23.99) |
| plain, decision 75 | 30 | | 1 | 1 | 244 |
| plain, `player_next` (built) | 1 | | 1 | 14 | 203 (24.80) |

The whole world's state identical to the Master discs' every pass (11,412 passes each); passbench on the gameplay
disc 25.00 passes/s, 6 late frames (7 before); no early bytes. The price: the zone's movers (the edges' helicopters
most often) miss their field more often (gameplay disc slots 17 and 3 also 36 -> 41 and 6 -> 17). The dropped try:
the zone's and the player's clusters behind the beam in the last frame's field from line 184 (T2's count 60):
with the HUD row on top each screen row shows 8 lines later than the T2 mapping `behind_beam` uses, so
`write_column` wrote rows 23-24 ahead of the beam (126 frames with early bytes), and the player still missed 42.

## Step 8: the edges' helicopters in place too (decision 79, 2026-10-25)

KC, 2026-10-25: "now fix that new bug - I've definitely seen this on my playthroughs" (decision 78's price: the
zone's movers, the edges' helicopters most often, missing their field). Measured (a per-slot cost of every take
off and put on, passbench's game): helicopter 0's put on about 15,600 cycles (p50; p90 25,000), its take off
6,300: always the masked draw, as its body (sprite &45) is one of bank 4's and decision 75 built sky images in
bank 5 only (item 3). And with it in sky mode (10,600 p50, much of it `sky_draw` and the arena's compaction) the
blank still could not hold the columns, the helicopter and the player: zone first, the player missed 23 frames
and helicopter 0 14; the player first, 0 and 38.

- `SKY_B4`: `sky_hazel_c.6502` again in bank 4 (`sky_b4`, a scope whose `SKY_BLK_LO`/`HI`/`SKY_RB` are bank 4's
  own tables: Baron lets a scope's assignment shadow a global one, measured), called by `sky_image` for the
  bodies bank 4 holds; `sky_put_on` no longer refuses them.
- `ZONE_SPLIT`: the sky's helicopters are near the top, which the beam passes early in the last frame's field.
  `zone_split` (after `cluster_build`) makes the zone's movers wholly above `SPLIT_ROWS` (12) character rows a
  cluster of their own (`cl_ztop`; a mover across the split: no split); `behind_beam` runs `zone_top` once the beam
  is past the split (`ZT_E`, cluster_thresholds' count for line 95, 2 more for the HUD row): their take off, the
  columns' rows above the split (each the last frame's left column a row down, passed), their put on. At the
  display's end `write_column` writes only the rows below (`wc_from`, and `wc_stop` for zone_top's). The field
  begun before zone_top: `zone_merge` puts the zone back whole. Only with `HUD_RUPTURE`'s HUD (no lives digit on
  the screen, which the scroll writes over the zone).
- `tools/beamcheck.mjs` was wrong on the gameplay disc: it took the screen frame's start when the 6845's row count
  went back to 0, which with `HUD_RUPTURE` is the HUD row's frame's (the screen frame starts at row 0 again), and
  it judged 25 rows where that frame shows 24. Now the start is the 6845's row address in a frame's first row (a
  HUD row's, below &600, kept apart: the beam above every screen row while it shows), the rows R6's. Step 7's
  gameplay-disc figures were measured with the old tool; remeasured below.

jsbeeb 2.10.2 Model B, 2026-10-25, beamcheck `--slot` (fixed) seed 1, passes 501-1,500, frames whose first field
missed each slot's bytes:

| gameplay disc | player | helicopter 0 | slot 17 | column | frames with late bytes | whole world late frames |
|---|---|---|---|---|---|---|
| decision 76 | 50 | 34 | 39 | 7 | 61 | 548 (23.89 passes/s) |
| decision 78 | 8 | 43 | 44 | 8 | 75 | 458 (23.99) |
| `SKY_B4` only, the player first | 0 | 38 | 20 | 1 | | |
| `SKY_B4` only, the zone first | 23 | 14 | 17 | 1 | | |
| `SKY_B4` and `ZONE_SPLIT` (built) | 0 | 4 | 12 | 1 | 25 | 336 (24.65) |

(The `SKY_B4`-only rows with the old tool.) No early bytes. The whole world on the B: state identical to the
Master gameplay disc every pass; on the Master, every frame identical to the Master gameplay disc's but BUGS #17's
28, so bank 4's images are the Master's. passbench 25.02 passes/s, 4 late frames. The plain, gameplay and plain
Model B discs' game files unchanged.
