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

## Layer 1 - own the interrupt, lock to vsync
- [ ] Measure the MOS's 20%: what it does on each of the game's interrupts (keyboard scan, sound,
      centisecond tick, unclaimed User VIA interrupts offered to ROMs)
- [ ] The game's own IRQ1V: vsync (field counter, palette top, T1 for the split), T1 (palette
      bottom); hand the MOS only what sound needs
- [ ] The pass locked to 2 fields by the field counter, replacing `wait_for_timer_281a`
- [ ] Keyboard read direct from the System VIA (kit `keydown.6502`); a PRNG for the User VIA T2
      reads (a deviation: timing is now fixed, so T2 would repeat)

## Layer 2 - double buffering in shadow RAM
- [ ] Screens at &4000-&7FFF in main and shadow (same addresses: the wrap code is unchanged);
      &3000-&3FFF mirrored into shadow at start-up, its 33 written bytes moved below &3000
- [ ] Per buffer: a record of what was EOR-plotted (address, type, frame/flip, clip), the
      player's save-under, the scroll position; new edge columns plotted into both
- [ ] Flip (ACCCON D, R12/R13) in the vsync IRQ; every raster wait deleted
- [ ] Verified by a buffer oracle (screen against a fresh redraw) and on b2/beebjit

## Layer 3 - fast enough
- [ ] Profile; speed up `unpack_column_of_sprite`, collisions, player buffering, the MOS sound path
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
