# Brief: step 2, layer 1 - own the interrupt, lock the loop to vsync

You are continuing a project in `C:\Users\khcon\OneDrive\BEEB\Projects\strykers`: Stryker's Run
(Enhanced), Superior Software 1986, BBC Master 128, rebuilt as Baron 6502 source. Step 1 is done
(byte-identical rebuild, relocatable source, measurement harness). Step 2 is making the game run at
a locked 50 Hz, flicker free, with double buffering in shadow RAM. **Your job is layer 1 only.**

## Read first, in this order
1. `CLAUDE.md` - the rules, build, source layout, tools
2. `PLAN.md` - step 2, layers 1-5; you do layer 1
3. `docs/decisions.md` - especially 7-13; decision 12 is the speed: **25 passes a second**, one
   original pass every 2 fields
4. `docs/baseline.md` - the measured profile you are improving on
5. `BUGS.md` - two original quirks (layer 5's, not yours: leave them alone)
6. The kit: `C:\Users\khcon\OneDrive\BEEB\Repos\beeb-port-kit\PORTING.md`, `docs/hardware-facts.md`
   (VIA, vsync, IRQ, Master facts), `docs/gotchas.md`, `lib/irq.6502`, `lib/keydown.6502`. Its skills
   are in `.claude/skills/` (beeb-cycle-timing, beeb-frame-drops, beeb-key-numbers, beeb-measure-fact,
   beeb-smoke-test, beeb-sound-verify).

## What the game does now (measured / read; line numbers drift, search for the labels)
- `irq1_handler` (game.6502): on vsync restarts User VIA T2 from &FFFF (a raster clock the game
  reads), arms User VIA T1 one-shot &2900 for the palette split, writes `top_palette_value`,
  `DEC game_over_cooldown`; on T1 writes `bottom_palette_value`. **Every IRQ then JMPs to the MOS**
  through the saved vector: 20% of all cycles ("MOS <- irq1_handler" in the profile).
- `main_game_loop`: 9 x OSBYTE &81 key checks (`check_for_keypress`, `check_for_player_input`),
  `update_player`, `update_projectiles`, `update_movers`. `update_movers` starts System VIA T2 as a
  stopwatch and `wait_for_timer_281a` spins until ~1.84 fields have passed: the original's minimum
  pass length. Passes take 2-8 fields (15-17/s measured).
- Sound: OSWORD 7 (`play_sound`), envelopes in the MOS - so the MOS's sound processing (its
  centisecond interrupt) must keep running.
- Random numbers come from User VIA T2 low byte (`rnd_skewed_towards_right_of_world`,
  `add_enemy_helicopters`, the soldier crouch choice, `animate_stationery_mover`).
- `wait_for_vsync_2242` uses OSBYTE 19 and re-arms the VIA timers itself; `update_screen` busy-waits
  on User VIA T2. Leave the raster waits other than `wait_for_timer_281a` for layer 2.

## Layer 1 tasks
1. **Measure the MOS's 20% first** (before changing anything): what the MOS does when the game's
   handler chains to it - per interrupt source (vsync, User VIA T1/T2, System VIA T1 centisecond,
   keyboard, anything offered to the paged ROMs). Use jsbeeb (MCP or a node harness like
   `tools/profile.mjs`) with breakpoints/hooks; write the numbers into a new
   `docs/step2-layer1.md`.
2. **Own IRQ1V**: the game's handler services vsync and User VIA T1 itself and does NOT pass them
   to the MOS; it passes on only what the MOS needs for sound (and keep the MOS's keyboard handling
   out if you replace the keyboard read). Keep a field counter in the vsync handler. The palette
   split must look exactly as before (compare screenshots against the shipping build).
3. **Lock the pass to 2 fields** with the field counter, replacing `wait_for_timer_281a`'s floor:
   a pass that finishes early waits for its 2-field slot; one that overruns takes whole fields.
4. **Read the keyboard direct** from the System VIA (fork the kit's `keydown.6502` into `src/lib/`,
   keep its header) instead of OSBYTE &81, keeping the game's redefinable key table working
   (`keys`, define-controls in bank 5 which uses OSBYTE &81 too). Measure key numbers, don't recall
   them (skill beeb-key-numbers).
5. **A PRNG** for the User VIA T2 random reads (timing is now fixed, so T2 would repeat). Any decent
   8-bit generator; seeded so a game is reproducible.
6. Measure: `node tools/profile.mjs` (passes/s, fields per pass, profile) and `tools/speed.mjs`
   before and after; sound unchanged (skill beeb-sound-verify, or at least listen via MCP sound
   capture); title screen, high scores, define controls and instructions still work.

## Rules (the project's - see CLAUDE.md)
- **Every deviation from the original is a numbered row in `docs/decisions.md`**, written when
  agreed. Owning the IRQ, the direct keyboard read and the PRNG are agreed in PLAN.md; anything else
  (dropping a MOS feature, changing a timing) - stop and ask the user (KC) first.
- **Measure, do not recall.** Every hardware number in code or docs says what it was measured on
  and when (jsbeeb version, model).
- Step 2 changes the game, so the build is no longer byte-identical to the reference: build with
  `.\build.ps1 -NoCompare`. The byte-identical original stays in git history (tag it
  `step1-identical` on commit 762a0d2 before your first change). Keep the relocation test passing
  if you touch anything address-sensitive (CLAUDE.md "The relocation test").
- Commit at the end of the layer with the measurements in the message; update PLAN.md (tick
  layer 1), `docs/decisions.md`, BUGS.md if you find bugs. Push to origin (public repo
  github.com/kieranhj/strykers-run). Never commit anything from `reference/` (gitignored, copyright).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Gotchas learned in step 1 (they cost time)
- Baron `NOT` on a number is bitwise: `IF NOT(SHIFT)` is true for SHIFT=256. Write `IF SHIFT = 0`.
- Baron cannot default a -D symbol (`IF NOT(DEFINED(x)) : x = 0` never settles). Every flag is passed
  by `build.ps1` on every build; add new DEBUG_ flags to its `$flags` table, to `DEBUG_ANY` in
  `src/main.6502`, and a `BOOT_FLAG` line in `src/loader.6502`.
- Baron chooses zero-page addressing whenever an operand is < &100; an absolute-encoded zp operand
  needs `EQUB opcode : EQUW addr`.
- Baron's `-v` listing goes to `build/strykers*.lst`; addresses come from `build/*.symbols.json`
  (`python tools/listing.py symbols build/strykers.symbols.json NAME`), never from docs.
- When editing source with Python heredocs, backslash comments (`\ `) and `\b` get mangled; prefer
  the Edit tool, or write strings with chr(92).
- The game's ground texture and the legs sprite depend on where data lies (BUGS #1, #2): expect
  visual differences in the ground if you move zero page or sprites; that is known.
- jsbeeb: `tools/jsbeeb_src.mjs` finds jsbeeb 2.5.0 (the MCP runs 2.3.2). Keys in harnesses are
  pressed by matrix position (`tools/playscript.mjs` KEY). The scripted game: `node tools/play.mjs
  DISC FRAMES EVERY PREFIX` saves screenshots; `-Define DEBUG_LIVES` gives infinite lives.
- A User VIA / System VIA interrupt not acknowledged hangs the machine; on a Master a null IRQ1V
  handler hangs DFS loads (kit hardware-facts) - the game installs its handler after loading, keep
  it that way.

## Done when
The game plays as before (same palette split, sound, controls, title/high-score/instructions), the
main loop is locked to 2-field passes when it fits (count with tools/profile.mjs: fields-per-pass
histogram), the MOS IRQ share is gone or explained, the profile and speed are recorded in
`docs/step2-layer1.md`, and the layer is committed and pushed. Report the before/after numbers and
anything that needs the user's decision.
