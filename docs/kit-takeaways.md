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
   in the kit. 256 of 580 proposals kept; a pass's work 43,036 to 31,869 cycles over rounds 1-3.
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
- The MOS sound driver is stateful: 38 of 48 effect pairs end differently over another effect than
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

| Branch | Carries |
|---|---|
| `tstrykers-fixes` | `baron_dbg` nested sections; `dfs` directories, `layout`, `file`, `game_files` |
| `tstrykers-harness` | the pair harness on `harness.mjs`; the relocation proof; harness helpers |
| `tstrykers-lib` | `nmos.6502` + `nmosify.py`; `sfx50` (driver, fitter, capture); `isr_model.py` |
| `tstrykers-tools` | the micro-grind skill and `grind.py`; capture; `zpwatch`; `irqprofile` |
| `tstrykers-docs` | the lessons above into PORTING, gotchas, hardware-facts, verification |
