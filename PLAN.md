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

# Step 2 - optimise (to be planned with KC)

Candidates, from the baseline:
1. Double buffer in shadow RAM (&3000-&7FFF): no racing the beam, no flicker. Needs the game's
   resident &3000-&3FFF moved (code/data the CPU must see while drawing to shadow), and the
   hardware-scrolled screen kept in step in both buffers.
2. Own IRQ1V: the palette split and a frame counter without the MOS; keyboard read direct.
3. A fixed frame rate (25 Hz?) locked to vsync - the game's speed is tied to the pass rate today.
4. Faster sprite plotting (the zero-page run-length unpacker).
Open questions in BUGS.md #1 and #2 (original quirks that relocation exposes).
