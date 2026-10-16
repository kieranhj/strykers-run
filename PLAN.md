# Plan

Step 1: a buildable, relocatable source. Step 2: optimise (frame rate, flicker) - planned once
step 1's measurements exist.

## Phase 0 - toolchain and skeleton: DONE 2026-10-16
## Phase 1 - byte-identical rebuild: DONE 2026-10-16
All seven files identical to STH; the disc boots and plays on jsbeeb Master.

## Phase 2 - relocatable source: DONE 2026-10-16
Every absolute reference the game and banks make is a symbol: labels, the sprite and routine
address tables (`LO()`/`HI()`, flipped entries as sprite + offset), lo/hi immediate pairs, the
copy-down blocks, vector high bytes, the music's page compares, sound parameter blocks. Layout
facts the code relies on are ASSERTs (mask tables &80 above pixel tables in one page; music
page-aligned; sound blocks ORed; resident part ends by &4000). Proven by decision 7: 30,000
frames cycle-identical, game a page down, banks a page up; an odd game shift (&40) plays.
Left numeric on purpose: hardware and MOS, screen addresses, the OS ROM bytes the mountains and
ground use, the self-modified placeholders (&FFFF), five unused mover sprite table entries.
Not exercised by the scripted play: define controls, instructions, high score entry (checked
statically only).

## Phase 3 - measurement harness: DONE 2026-10-16
`tools/profile.mjs`: passes per second, fields per pass, flat profile by routine with raster
waits and MOS time split out. Baseline in `docs/baseline.md`: 15-17 passes a second, 25-40% of
the CPU waiting for the raster, 20% in the MOS's interrupt handling, 10-20% plotting sprites.

# Step 2 - 50 Hz, flicker free (decisions 11-13)

Speed reference: the original's design rate, 25 passes a second (decision 12): one original pass
of movement per 2 fields. Each layer is measured (`tools/profile.mjs`, `tools/speed.mjs`), gets a
decisions row and a commit.

## Layer 1 - own the interrupt, lock to vsync: DONE 2026-10-16 (`docs/step2-layer1.md`)
Decisions 14-19. In play the game's handler keeps vsync and User VIA T1, the MOS only its
100 Hz tick for the OSWORD 7 sound; the front end is still the MOS's. Pass locked to 2 fields,
keyboard direct, PRNG. Interrupts 21% -> 10.6% of the CPU; 16.8 -> 17.8 passes/s (town),
15.1 -> 17.0 (frame 16000); about half the passes still overrun their slot.
Left for later (KC): the MOS out of the interrupt entirely, with the game's own sound driver
(probably 50 Hz) in place of OSWORD 7 and the MOS envelopes (the tick is still 9-10% of the
CPU, ~6.8% of it sound); then the front end owned too (its music events, `&EC` key reads,
OSBYTE 19 and OSBYTE &81 scans).

## Layer 2 - double buffering in shadow RAM: DONE in jsbeeb 2026-10-16 (`docs/step2-layer2.md`)
Decisions 20-23. The logic no longer draws; a renderer in bank 4 keeps per-screen records and
draws the hidden screen; the vsync interrupt flips main/shadow at the pass lock's field; every
raster wait is gone. Pass lockstep against the single-screen control: game state identical,
shown screen byte-identical on all but 8 of 42,000 passes. Slower: 11.6 passes/s in the town,
10.3 scrolling (layer 1: 17.8, 16.6).
- [ ] b2 and real hardware (KC): the flip and the X bit are jsbeeb-only so far

## Layer 3 - fast enough
- [ ] Profile; speed up `unpack_column_of_sprite`, collisions; layer 2's overheads (the player's
      save-under copied whole, the renderer's zero-page save, the logic's sprite walk); the game's
      own sound driver in place of the MOS's (layer 1, KC: probably 50 Hz)
- [ ] Budget: half an original pass of work, plus double-buffer overhead, under 39,936 cycles.
      Report before layer 4; if it cannot fit, bring the numbers and the options

## Layer 4 - 50 Hz
- [ ] One field = half a pass: player, movers (staggered), helicopters, projectiles each on their
      own cadence; vertical rates halved, pass counters doubled; render every field
- [ ] `tools/speed.mjs` per object type against the design rate

## Layer 5 - quirks and original glitches
- [ ] BUGS #1: a fixed ground texture table; BUGS #2: the legs sprite overrun
- [ ] Check in jsbeeb, then fix: a scroll column lost when moving with `frame` >= 0 (firing in a
      helicopter while moving); the column replotted after a hostile collision
