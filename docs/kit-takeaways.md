# What Stryker's Run gives back to beeb-port-kit

Written 2026-10-25 (strykers `4dcf37a`, beeb-port-kit `7edccf7`), from a read of this repo's
decisions (1-80), BUGS (#1-#17), the layer docs, the briefs, the grind ledger and the 382 commits,
against an inventory of the kit. The kit was built from Paradroid, Edge Grinder and 1942 and did
not mention this project. Stryker's Run is a different kind of job from those three: an original
rebuilt byte for byte from a disassembly, then optimised (the Master), then cut down (the Model B).
The kit's `docs/verification.md` names the gap this project's tools fill: "no A/B *pair* harness
... ships with it yet".

The work landed in the kit as five branches merged into `takeaways-strykers`, as 1942's did
(`takeaways-1942`); the last section says what each carried.

## 1. Fixes, both ways

- **Kit bug: `baron_dbg.py` loses everything a section emits after a nested SECTION.** The kit's
  copy ends the current section at any ENDSECTION, so a rephased copy-down block truncates its
  parent. Strykers' fork (2026-10-16) keeps the sections as a stack and takes a nested section's
  bytes from the disc file of the one that carries it.
- **Kit bug: `dfs.read_image` keys files by name alone**, so `O.MGAME` and `R.MGAME` collide (the
  release disc's case, `tools/releasedisc.py`).
- **Kit gains from `tools/dfs.py`:** `layout IMAGE NAME...` (a disc re-laid in load order: head
  steps 120 to 32, 12.68 s to 12.38 s, commit `4abea60`), `file IMAGE NAME` (one file's bytes for
  the JS harnesses), and `game_files` (packed files unpacked), generalised to take the packed list.
- **Strykers behind the kit:** `tools/jsbeeb_src.mjs` predates the kit's pin resolution (it takes
  the highest jsbeeb in any npx cache); the skills `beeb-buffer-oracle`, `beeb-close-layer`,
  `beeb-cycle-timing`, `beeb-sound-verify`, `beeb-start-port` are older than the kit's. Pulled down.

## 2. Tools that generalise, by value

1. **The pair harness** (`passlock.mjs`, `passbench.mjs`, the key generator in `playscript.mjs`):
   two builds given the same keys per game-loop pass, not per frame, so builds of different speed
   play the same game; state compared every pass. Frame-timed keys played a different game (31
   against 41 late frames on one seed, layer 4 costing). The generator was copied into four tools.
2. **The relocation proof** (`lockstep.mjs`, `tracediff.mjs`): the source built shifted by whole
   pages against a control padded the other way, so both load in the same time and run cycle for
   cycle (30,000 frames, decision 7); the first differing instruction mapped back through the
   shift to a label in both builds. Found BUGS #1 and #2.
3. **Master to NMOS** (`src/lib/nmos.6502`, `tools/nmosify.py`): one macro per 65SC12 instruction,
   byte-identical without `NMOS`, the cheapest legal NMOS form with it, chosen per site from the
   dataflow annotations; `check` and `check --nmos`. Two forms each safe alone clashed (Model B
   brief step 1), hence both checks.
4. **A 50 Hz sound effect driver** (`src/lib/sfx50.6502`, `tools/sfx50.py`, `tools/sfxcapture.mjs`):
   ramps of 6 bytes fitted to the MOS's captured SOUND/ENVELOPE output. The kit's `irq.6502` takes
   IRQ1V and loses the MOS's driver; this replaces it. Interrupts 10.9% to 2.2% of the CPU, 8
   effects in 158 bytes (decision 25).
5. **The micro-grind** (`.claude/skills/beeb-micro-grind`, `tools/grind.py`, `grind_config.py`): not
   in the kit. The method is Eben Upton's, beebgame's "suggested farm" (`tools/dataflow/README.md`:
   annotated windows, a reviewer then a skeptic, survivors behind an equivalence gate); this project
   turned it on cycles and wrote its bookkeeping. 256 of 580 proposals kept; a pass's work 43,036 to 31,869 cycles over rounds 1-3.
6. **Video and sound capture** (`sidebyside.mjs`, `playvideo.mjs`): fields to ffmpeg at 50 fps, the
   SN76489 to a WAV, muxed; and an original's timer-read randomness replaced by injecting the PRNG's
   byte into A, without touching its RAM.
7. **Small instruments:** `zpwatch.mjs` (watches added to any harness through `node --import`),
   `irqprofile.mjs` (interrupts by source, nesting handled), `isr_model.py` (what an interrupt that
   exits into the MOS reads and writes; without it the dataflow finds no known values), and
   `playscript.mjs`'s `callFrom`, `runToPc`, matrix-position keys and `loadSyms` (labels and
   assignments both).
8. **Medium value:** `beamcheck`, `rupture`, `shadowaudit` (with a config); the BASIC tokeniser and
   multi-directory catalogue of `releasedisc.py`; `m6502.py`.

## 3. Lessons

### Hardware and MOS

- The MOS's 100 Hz tick takes about 16% of the CPU in play (sound 6.8%, the key scan 6.3% while a
  key is held), and re-enables interrupts (`CLI` at `&E720`): interrupts nest (layer 1).
- An IRQ the MOS does not recognise goes to every paged ROM as service call 5: 1,165 cycles a field
  for a User VIA split (decision 15).
- Chaining an IRQ to the MOS loses vsyncs (12 in 1,000 fields): mask the System VIA's vsync in
  `&0279` (OSBYTE `&E9`), owning before masking, unmasking before giving back (BUGS #3).
- MOS 3.20's OSBYTE 19 returns X and Y from `&0300+X`/`&0301+X`; the original relied on it (BUGS #5).
- ACCCON X puts shadow under the CPU for all of `&3000-&7FFF`: what the interrupt reads lives below
  `&3000`, and code in `&3000-&3FFF` is mirrored (decision 23).
- With ACCCON D set, the CRTC's reads below `&3000` see ANDY and HAZEL (BUGS #15); found late
  because the checks timed writes, not what the video read.
- The 6845 latches a CRTC frame's end at its last scanline: R4 rewritten before scanline 7 of a
  one-row frame (decision 67).
- The Master MOS leaves HAZEL paged in play; the original's mountains read DFS leftovers there, so
  their look depended on the last disc activity, and on a Model B they read the MOS ROM (BUGS #9).
- `&FE34` is ROMSEL on a Model B; OSBYTE 0 X=1 names the machine (decisions 51, 76).
- No other shadow RAM does the Master's: the B+'s CPU follows the displayed screen, the Integra-B's
  is CPU-only. A Model B means one screen raced against the beam (Model B brief).
- Indexed reads crossing pages add up: 824 bytes of slide cost 165 cycles a pass; tables laid out
  by counted crossings saved 15.6 (decision 40).
- The MOS sound driver is stateful: 27 of 48 effect pairs (38 before BUGS #19's tick fix) end differently over another effect than
  from silence (layer 3).

### Bug classes

- A watch proves only the paths it ran: "no access in 30,000 frames" missed the death routine; found
  by the original and step 2 playing one game side by side (BUGS #12).
- An optimiser broke a `JSR label+1` caller; the gate never ran that path (BUGS #11).
- A walk ran off one table into the next, harmless until the next table's values changed (BUGS #17).
- A wrong value that happened to be harmless (bank 0 empty on a Master) hid a bug for 7 days (BUGS
  #16): permuting banks or load addresses is a cheap fault injector.
- The logic read what the plotter left in zero page: a "draw nothing" build plays another game
  (decision 21, BUGS #4).
- A test compared nothing: assignments read as labels gave `undefined` on both sides (`worldcheck`).
- A breakpoint in sideways RAM must check ROMSEL (30+ false failures, commits `1fd31bd`, `76bff0b`).
- A fix judged by the wrong count: tearing fell 38 to 2 while the player ghosted; counting missed
  fields instead led to decision 78 (48 to 4).
- jsbeeb zeroes HAZEL: users saw machine-dependent graphics before any test (decisions 70, 71).

### Optimisation

- Paid: the interrupt owned (21.0% to 10.6%); masked sprites over save blocks, not EOR's four draws
  (decision 24); only the zero page the logic reads saved (8.3k to 0.5k cycles a pass); the logic
  not waiting for the flip (21.59 to 23.38 passes/s, decision 26); compiled sprites for the
  commonest kinds only (decision 29); self-erasing rectangles over sky after measuring 94.6% of
  draws sky-only (decision 61); the existing compressed format decoded by its own bits, not a new
  format (35% cheaper, 7.6K not spent, decision 39); a CRTC rupture for the HUD (decision 67).
- Lost: row-major sprites (costed on an average row; 166 against 41 late frames); the logic a pass
  ahead (my estimate; replayed by `pipesim`, no gain); 50 Hz, modelled first and found not to fit
  (decision 35, a dead-end build avoided); and the list in layer 4's costing.

### Process

- Choose the reference by its bytes (decision 1: one disc had 7 zeroed scenery bytes).
- Byte-identical rebuild, relocation proof, then optimise: a project kind of its own.
- An oracle build (`DEBUG_FULLREDRAW`) kept independent of every fast path.
- A fixed PRNG seed; keys by pass; whole-world bots, which found BUGS #10, #13 and #17.
- A fixed bug undone inside an old control's emulator (`--unclobber`), so old and new play one game.
- Gameplay changes under flags off by default, flag-off builds proven identical (decision 43).
- Bank selects patched at start-up from a table of sites (decision 74).
- Loader sizes asserted (a one-page `!BOOT` 38 bytes over, `ee37141`); what each emulator has
  confirmed listed.

## 4. What landed in the kit

On beeb-port-kit's branch `takeaways-strykers` (`b4f356c`, 2026-10-25; not yet merged to `master`):

| Branch | Carries |
|---|---|
| `tstrykers-fixes` | `baron_dbg` nested SECTIONs (`read_disc` hook); `dfs` keys `D.NAME`, `game_files`, `layout`, `file` |
| `tstrykers-harness` | `passplay.mjs` (keys by pass, one module), `pairlock.mjs`, `passbench.mjs`; `lockstep.mjs`, `tracediff.mjs` (the shift map from both dumps); `harness.mjs` helpers (`keyDownRaw`, `callFrom`, bank-aware hooks, `hang`); the template's `-Shift 256 [-ShiftEnd]` |
| `tstrykers-lib` | `lib/nmos.6502` + `nmosify.py`; `lib/sfx50.6502`, `py/beeb_port_kit/sfx50.py`, `sfxcapture.mjs`; `isr_model.py` behind `ISR_MODEL` |
| `tstrykers-tools` | `skills/beeb-micro-grind`, `grind.py`, `grind_config.py`, `pcprof.mjs`; `capture.mjs` + `video.mjs`; `irqprofile.mjs`, `memwatch.mjs` (`zpwatch` generalised), `keyscript.mjs` |
| `tstrykers-docs` | PORTING 2.1c (rebuilding a BBC original), 5.3, 5.5-5.7, 9, 9b (Master to Model B), 10-13; 21 gotchas; 15 hardware facts; verification procedures 20-23 |

Proven on the merged branch (jsbeeb 2.10.2): py 196 tests OK; the template's suite 15 of 15 with
its negative controls failing; lib tests exit 0; and on this repo's discs, the kit's `pairlock`
gave `passlock`'s verdict on every pair tried, `irqprofile` on the original 18.8% in interrupts
(layer 1: 21.0% on jsbeeb 2.5.0), the fitter remade `src/sfx_data.6502`'s 158 bytes.

## 5. Found here on the way (all four fixed 2026-10-25: BUGS #18, #19)

- **`tools/tracediff.mjs` is stale for bank 5 on the plain disc's shift pair**: it maps every
  bank's PC back by `-SHIFT` (line 108), but since 2026-10-23 the plain build's relocation moves
  bank 5 a page lower (`B5_OFF = -PAD_START`, `src/main.6502`), so it reports a false divergence
  at `title_screen` (control `&8C27`, shifted `&8B27`). The kit's `tracediff` reads the map from
  the dumps and passes the same pair (400M cycles identical).
- **The 50 Hz effects end a field early**: `sfx50` silences a channel in the tick that plays its
  last field, so each shipped effect was 20 ms short of the MOS's. The kit's fitter has `--pad-end`;
  here `tools/sfx50.py` now pads by default (BUGS #18).
- **`tools/sfxcapture.mjs` counts ticks by IRQ entries with T1's flag up**, which double counts
  (entries 300 cycles apart) and skips; the fitted bytes came out right regardless. Now a grid,
  as the kit's (BUGS #19).
- **`tools/nmosify.py` matches the annotation to today's sources by line**: on the 2026-10-25
  annotation it reports 47 failures that are drift (the kit's, reading the annotation alone: 0).
