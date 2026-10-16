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

## Phase 3 - measurement harness
- [ ] Headless jsbeeb (node, `tools/jsbeeb_src.mjs`): boot, start, scripted input, break at
      `main_game_loop`; cycles and fields per pass, time in plot/unplot/scroll/IRQ
- [ ] Baseline numbers for the original into `docs/`
