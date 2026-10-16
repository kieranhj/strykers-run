# Brief: step 2, layer 3 - the late passes

You are continuing a project in `C:\Users\khcon\OneDrive\BEEB\Projects\strykers`: Stryker's Run
(Enhanced), Superior Software 1986, BBC Master 128, rebuilt as Baron 6502 source and being made to
run at a steady 25 frames a second, double buffered, with masked sprites. KC (the owner) wants
**every frame on time: each pass's work inside 2 fields (79,872 cycles)**. Today about 1 frame in
10 is late. **Your job: the three cost cuts below, each proven, measured and committed.** Then
report; KC decides what to do about whatever is still late.

## Read first, in this order
1. `CLAUDE.md` - the rules, build, source layout, tools, memory map
2. `docs/step2-layer3.md` - what layer 3 has done, how it is checked, what was set aside
3. `docs/decisions.md` 18-27 (24: masked sprites, 25: the sound driver, 26: the pass lock no
   longer waits, 27: keys), `BUGS.md` 6 and 7 (both introduced and fixed in layer 3)
4. `src/render.6502` - the renderer (bank 4): classify, mark, close_over_overlaps, take_off,
   scroll, put_on; draw_mover, ren_draw_sprite, draw_column, restore_block, compact
5. The kit's skills in `.claude/skills/` (beeb-buffer-oracle, beeb-frame-drops, beeb-measure-fact)

## Where things stand (measured 2026-10-16, jsbeeb 2.5.0, commit `53076ff`)
`tools/passbench.mjs --detail`, built `-Shift 256 -ShiftEnd -Define DEBUG_LIVES`:
- Seed 1, passes 500-2000: 24.21 passes/s; 298 of 1,500 passes do more than 2 fields of work,
  146 actually take 3 fields or more (decision 26 absorbs some). Over by: 0-5k 98, 5-10k 48,
  10-15k 44, 15-20k 28, 20-30k 46, 30-40k 22, 40k+ 12.
- `--hold RIGHT` (running, the costliest steady state), passes 50-650: 23.72 passes/s; 187 of 600
  over (0-5k 62, 5-10k 31, 10-15k 28, 15-20k 18, 20-30k 38, 30-40k 10).
- A late pass on average: render ~63k (about 370 bytes drawn and 370 restored, 3.3 movers changed
  against 1.9 in all passes), logic ~21k, the scroll's column build 6-8k on scrolling passes.
  Nothing is redrawn needlessly (movers pulled in by an overlap: 0.0 a pass).
- Profile of the late passes alone (per pass): draw_column 21.6k, restore_block 13.7k,
  ren_draw_sprite 6.3k, collision loop 4.2k, render 3.5k, write_column 3.3k, mark_to_draw 1.7k,
  history_push 1.6-1.8k, close_over_overlaps 1.3k, raise_address 1.2k. The byte loops are ~20k
  of the sprite work; the rest (~25k) is per-column and per-cell overhead (~600 cycles a column).
- A scroll (every other pass when running): column build ~11k + history push ~2.5k on the scroll
  pass, then ~3.5k writing the column into each screen (one per pass). So the scroll pass carries
  ~14k more than the next.

## The three items
1. **Column prebuild.** Build the next scroll column on the pass that does not scroll, and use it
   only if the scroll then happens in that direction; otherwise build as now. The catch:
   `scroll_screen_right`/`left` (game.6502) also move the viewport, screen start and CRTC address,
   advance the 8 scenery layers' state (`check_for_scenery_when_scrolling_*`,
   `consider_adding_scenery_*`, `set_scenery_address_for_layer_Y`), the ground positions, can fire
   triggers (`add_new_movers`) and `add_enemy_helicopters`, and set the edge movers' screen
   addresses. Only the column's *pixels* may be computed early; every state change must happen at
   the original moment with the original values, or be provably identical. Measure first whether
   it pays (the build is ~11k; the pixel part of it is the scenery unpack, the clear and the ground).
   Note: `update_screen` (so `history_push`) runs every pass while the player moves, but the column
   is rebuilt only every other pass - the buffer is pushed twice (an attempt to clear it in the
   push broke exactly that).
2. **The sprite pipeline's per-column overhead.** `ren_draw_sprite` (the column walk: header,
   clip, raise, address step) and `draw_column` (record, pointers, cells) and `restore_block`.
   Ideas: merge the walk and the draw (no JSR, fewer temporaries), cheaper cell steps, the raise
   inline, records and pointer arithmetic cut further. Keep the save block's order rules: blocks of
   different movers come off in reverse; within a block, the parts in reverse (a mover's parts
   overlap: the block's 4-byte header holds where parts 2 and 3 start, as offsets - `compact` moves
   blocks); a part's own columns in any order. The byte loops are already lean (draw 37-40 cycles a
   byte, restore 16-19); the target is the ~600 cycles a column around them.
3. **Logic trims.** The collision searches (`check_for_mover_collision_with_range_of_movers` and
   friends already reject far movers before the type lookup - see the comments there), the
   logic's sprite walk (`plot_mover` "walk only" + `walk_column`, ~3k), `mark_to_draw` /
   `close_over_overlaps`. Any change to game logic must leave every register, flag and zero-page
   byte that later code reads exactly as the original did (two first attempts in layer 3 changed
   the carry flag and broke things - the lockstep caught both).

## How every change is proven (all of these, every time, before committing)
Build variants: `.\build.ps1 -NoCompare` with `""`, `-Shift 256`, `-Define DEBUG_LIVES`,
`-Define DEBUG_LIVES,DEBUG_FULLREDRAW`, `-Shift 256 -ShiftEnd -Define DEBUG_LIVES`. Copy the
outputs (ssd + symbols.json) to a folder of their own before running proofs: later builds
overwrite `build/`.
- **Game state** against the control `build/control/strykers-shift256end-debug_lives.ssd` (layer 2's
  control, built from `0a078b8`): `node tools/passlock.mjs CONTROL TEST 6000 SEED` for seeds 1, 3
  and `PASSLOCK_CTRL=1` seed 4. Must say `"identical":true`, 6,000 passes.
- **Frames byte for byte** against `build/head/clean.ssd` (commit `678ea21`, the last before BUGS
  #6; rebuild it from a `git archive` copy with `SOURCE_DATE_EPOCH` set if it is missing):
  `node tools/passlock.mjs build/head/clean.ssd NEW-debug_lives.ssd 6000 SEED --screen` - expect
  `"screenMaxDiff":0`. Rendering changes must also hold against the full-redraw oracle:
  `node tools/passlock.mjs FULLREDRAW NORMAL 6000 5 --screen`.
- **A helicopter flight**: `node tools/helilock.mjs FULLREDRAW NORMAL 2500 8` (frames identical
  through boarding, flight and explosion) and `node tools/helilock.mjs CONTROL TEST-shift 2500 4`
  (state identical; frames differ by design there).
- **The front end**: `node tools/frontend.mjs build/strykers.ssd NAME` - 15 of 15.
- **Measure**: `node tools/passbench.mjs SHIFTED --passes 1500 --detail` and
  `--hold RIGHT --from 50 --passes 600 --detail`; report passes/s, late passes and the "over by"
  histogram against the numbers above. Use passbench (keys by pass) to compare builds, not the
  frame-timed tools, which play a different game whenever the speed changes.

## Rules (the project's - CLAUDE.md)
- The original is the specification: the game must play exactly as before (the state lockstep).
- Deviations are agreed with KC before they are built, then written into `docs/decisions.md`.
  Pure speed-ups that the proofs show change nothing need no decision; write them into
  `docs/step2-layer3.md`.
- Measure, do not recall: every number says what it was measured on.
- Commit each proven step on its own, message with the measurements, ending with the attribution
  lines the session gives you; push to origin main. Update `docs/step2-layer3.md` (results table,
  what changed, what was set aside), `PLAN.md`, `CLAUDE.md`'s memory map if layout changes.
- KC checks builds on b2; to publish a WIP use the user's `publish-wip` skill (same name every time,
  `strykers-run-wip.ssd`), only when asked.

## Gotchas learned in layer 3 (they cost time)
- Bank 4 is full: `DATA1` must end below `REN_BASE` (ASSERTed; BUGS #6). The workspace is
  `&B400-&BEFF` (`&BFFF` in `-Shift 256`). ANDY (`&8000-&8FFF`) is paged over bank 4 while the
  renderer draws (ROMSEL `&84`), so renderer code and its data start at `&9000`.
- The renderer may run with ACCCON's X bit set: `&3000-&7FFF` is then shadow RAM. Anything the
  interrupt or both screens share lives below `&3000`.
- Zero page: the renderer may use `&C0-&CD` (and its own); `restore_game_zp` gives the logic back
  only the 34 bytes it reads (`tools/zplive.mjs`). Using another zero-page byte means checking it
  is not one the logic reads.
- Every bank switch in play writes `&F4` before ROMSEL (the vsync interrupt restores from `&F4`).
- Self-modified operands in the renderer: both byte loops' `mask_operand`/`pix_operand` (and the
  `_2` copies), `write_column`'s and `history_push`'s, `mark_part`'s. Moving code moves them.
- Branches out of range are common after a change; Baron's FOR is `FOR n = 0..7`.
- Python heredocs in bash mangle backslashes (the source's comments start with `\`): use `B=chr(92)`
  or the Edit tool. Search for labels; line numbers drift.
- `passlock` stops and says so when both games stop making passes (the world completed); one
  stopping alone is a difference. A frame difference that starts and never ends is usually a
  sprite or record corruption - check `DATA1`'s end and the workspace first.

## Done when
Each of the three is either committed (proven as above, measured, documented) or set aside with
its measurement in `docs/step2-layer3.md`. Then report to KC: passes/s, late passes, the "over by"
histogram before and after, what is left and what it would take.
