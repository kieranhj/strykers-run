# Brief: the first gameplay variations - a recharging shield, lives that respawn (PLAN)

KC, 2026-10-20 (decisions 43-46), on branch `gameplay-shield`. The first changes to how the
original *plays* (rule 1: each is a decision before it is built). Every variation is under its own
build flag, off by default, so the shipping build stays the original game and a flag-off build is
proved identical to `main`.

## What the original does (read from `src/game.6502`, 2026-10-20)

- **Lives are hit points.** `lives` (`&95`) starts at 9 (`start_game`). Every hit on the player
  on foot goes to `kill_mover` with Y = 0 -> `kill_player`: `DEC lives`, `plot_lives`, and with
  lives left that is all: no death, no animation, play goes on where the player stands. Only the
  last life turns the player into a skeleton (`MOVER_TYPE_SKELETON`, `&0D`); when its animation
  ends, `DEC lives` makes it negative and the game is over. Nothing ever respawns.
- **What hits the player:** a projectile's own update (`projectile_hit_player`): bullet `&0F`,
  grenade `&10`, bomb `&11`, rocket `&12` (bazookas, helicopter missiles), shell `&1B` (mortars,
  heavy guns); and the player's own move into a hostile mover (`check_for_hostile_collision`, then
  `kill_hostile_mover_and_mover`, which kills both): soldiers, vehicles, mines `&13`, and
  projectiles. Friendly movers and the enemy SAM are walked through.
- **In a helicopter:** the first hit wrecks it (`kill_player_helicopter`), the second blows it up;
  when the explosion ends the player is a soldier again (`set_player_as_soldier`). No life is lost.
- **The display:** the lives count is one digit (`plot_character`, font offset `&6C` + 6 x lives)
  at the top-left of the screen. The renderer owns it (`render.6502` `add_lives_zone`,
  `redraw_lives`): it redraws those 4 columns when the screen scrolls or `lives` changes.
- **The title screen** takes 1 (start), 2 (define controls), 3 (instructions), 4 (music), 5 (sound),
  and I+S for observer mode (`src/bank5.6502` `title_screen_loop`).

## The design (KC's answers, 2026-10-20)

**The shield** (flag `GAMEPLAY_SHIELD`):
- Two units. A hit takes 1 for a bullet or for running into an enemy, 2 for an explosive: grenade,
  bomb, rocket, shell, mine. Damage stops at 0 (a 2-unit hit with 1 left leaves 0, and the player
  lives); a hit with the shield at 0 kills.
- After 5 seconds without damage it refills smoothly, about a unit a second, until full; any hit
  restarts the 5 seconds. Timed in passes (25 a second, the design speed: decision 12), so it
  keeps the game's time, not the frame rate's. Proposed: the shield counts in 1/25ths of a unit
  (0-50); a hit takes 25 or 50; after 125 passes untouched it gains 1 a pass.
- On foot only: in a helicopter the original's rules stand (wreck, explode, walk away), and the
  shield neither drains nor protects there.
- **A bar** on the top line beside the lives: two segments, a unit each, filling as it recharges;
  cyan for the charged part, red for the empty. A hit plays a sound and flashes the bar.

**Lives that respawn** (flag `GAMEPLAY_LIVES`, which needs `GAMEPLAY_SHIELD`):
- A hit at 0 shield is a death: the skeleton plays, a life goes, and with lives left the player
  respawns; with none, the game is over as now.
- **Respawn:** after the skeleton, a fast rewind: the view scrolls back N columns, several a pass,
  the player hidden and the logic stopped; the player appears standing, shield full, and cannot be
  hurt for about 2 seconds (flashing). Enemies and projectiles stay where they are. N is 80 by
  default (a screen), never past the world's start.
- **Lives** 1-9 or infinite, default 3. The top line shows the digit, or a new glyph for infinite.
  An infinite-lives game ends by ESCAPE (not entered on the high score table) or by reaching the
  headquarters (entered as usual).

**The options menu** (flag `GAMEPLAY_OPTIONS`, needed by either of the above to set them): a sixth
title option, 6 OPTIONS, to set lives (1-9, infinite) and the respawn distance (40, 80, 120, 160
columns). Kept for the session (not saved to disc), shown on the title screen. Later variations
add their settings here.

**The build flags.** `GAMEPLAY_*` join `DEBUG_*` in `build.ps1`'s `$flags`, the `Makefile`'s `FLAGS`
and the stamp, are allowed in `-Release` (they are not debug flags), and each gives its own file
name (`build/strykers-gameplay_shield.ssd`, as `-Define` does now). With `DEBUG_LIVES` on, a
death respawns whatever the lives, so the test scripts still never end.

## The steps

0. **The double hit** (KC, 2026-10-20: "the player takes multiple hits from a single projectile
   (e.g. helicopter bomb) when running into it"). In the original first: reproduce it in jsbeeb
   (a bomb under a helicopter, the player run into it; count `kill_player` calls per projectile),
   find the cause, write it up as a BUGS.md entry. The likely cause, to check: running into it,
   `kill_hostile_mover_and_mover` kills the bomb and the player, and the bomb's own update
   (`projectile_hit_player`) may hit the player too in the same pass, or the bomb's explosion
   counts as a hit. Fix it in the shipping build if it is a bug in all builds (decision 13: the
   original's glitches are fixed), and in any case before the shield is built: a 2-unit hit
   counted twice is a death.
1. **Room.** Measure the new code before placing it; the candidates, from the 2026-10-20 build:
   - the logic's code (the shield, the timer, the respawn) must be readable in play:
     `moved_0a20` 142 bytes (main RAM, always paged), main RAM's 9, HAZEL 24; and, now nothing
     ties it to the original layout (BUGS #1, #2 closed), the region from `&3400` (the 13 dead
     bytes of `unused_3400`'s BASIC fragment, and repacking `dummy_sprite`, the font and
     `player_save`);
   - the bar's drawing, in the renderer (bank 4: 43 bytes below `REN_BASE`), or the bar's bytes
     built by the logic into a small buffer that the renderer copies as it does the digit;
   - the options menu: bank 5, 388 bytes (the front end runs from it).
   If that is not enough: the kind cache's slot 1 and the save arena are the next trades, each
   with its late-frame cost measured.
2. **The flags** in `build.ps1`, the `Makefile` and the stamp; `RELEASE` allows them. Proof: every
   flag off builds byte-identical to `main` (`tools/dfs.py compare`, the stamp ignored).
3. **The shield** under `GAMEPLAY_SHIELD`, with lives as the original's (each death still a lost
   life, on the spot): damage by type in `kill_player`'s path, the timer and the refill once a
   pass in `update_player`, the bar's zone in the renderer.
4. **Lives and the respawn** under `GAMEPLAY_LIVES`: the skeleton's end respawns rather than ends
   the game; the rewind (step 4a: measure how many left scrolls a pass fit with the logic stopped,
   in `tools/pcprof.mjs`); the invulnerability and its flashing; the infinite-lives glyph.
5. **The options menu** under `GAMEPLAY_OPTIONS`: the title's sixth line, the settings screen.
6. **Checks**, each flag combination:
   - flags off: byte-identical to `main`;
   - each on: game state identical to its `DEBUG_FULLREDRAW` twin and the screen to it
     (`tools/passlock.mjs`, `tools/worldrun.mjs --control`), so the renderer draws the bar and
     the respawn right;
   - a new `tools/shieldtest.mjs`: hits of each kind forced (a projectile poked onto the player,
     as `kcguard` pokes), the shield's value after each, the refill's start after 125 passes and
     its rate, death at 0, the respawn's column (N back, clamped at the world's start), the
     invulnerability's length, the lives and game over, infinite lives;
   - `tools/frontend.mjs` extended for 6 OPTIONS; the build matrix assembles (`baron --check`);
   - speed: `tools/passbench.mjs` late frames and pcprof work a pass against flags off.
7. **Docs:** decisions 43-46 marked built with their measurements, a `docs/gameplay-shield.md`
   with what was measured and rejected, BUGS.md for the double hit, PLAN.md.

## Answered (KC, 2026-10-20)

- **High scores with infinite lives:** a game with infinite lives ends only by ESCAPE or by
  reaching the headquarters. ESCAPE leaves it off the high score table; reaching the headquarters
  puts it on as usual. (A timer mechanic comes later.)
- **Feedback for a shield hit:** a sound and the bar flashing.
- **The bar's colours:** cyan for the charged part, red for the empty.

## Open (KC)

- **Which discs to make** for testers (the options are in the reply of 2026-10-20; to be written
  here once chosen).
