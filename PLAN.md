# Plan

Step 1: a buildable, relocatable source. Step 2: optimise (frame rate, flicker) - planned once
step 1's measurements exist.

## Phase 0 - toolchain and skeleton: DONE 2026-10-16
## Phase 1 - byte-identical rebuild: DONE 2026-10-16
All seven files identical to STH; the disc boots and plays on jsbeeb Master.

## Phase 2 - relocatable source
- [ ] Symbolise the remaining numeric operands (17 absolute, 178 zero page) and the immediates
      that are halves of addresses (`LDA #&xx` pairs without a comment)
- [ ] Symbolise the pointer tables: scenery/mover sprite address tables (lo/hi, flipped and
      unflipped, which bank), routine address tables, trigger tables, text pointers
- [ ] Self-modified operands: name each with `name = * + 1`
- [ ] Shift test: `-D SHIFT=n` inserts padding at test points in the game and each bank; the
      SHIFT=0 build stays identical, shifted builds play identically (scripted run, state hash)

## Phase 3 - measurement harness
- [ ] Headless jsbeeb (node, `tools/jsbeeb_src.mjs`): boot, start, scripted input, break at
      `main_game_loop`; cycles and fields per pass, time in plot/unplot/scroll/IRQ
- [ ] Baseline numbers for the original into `docs/`
