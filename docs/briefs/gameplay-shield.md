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

0. **The double hit: DONE** (BUGS #13, fixed on `main` for all builds, `8160182`): one hit cost up
   to 14 lives because the explosion it left kept hitting, and a projectile run into hit twice.
   Explosions and skeletons are now walked through and a projectile run into is spent; the whole
   world's hits 655 -> 318, none repeated in one pass or by an explosion (`tools/hitwatch.mjs`, which
   the shield's checks can reuse). Still to note for the shield: a bullet may hit, then a new bullet
   in the same slot hit again a few passes later (that is two bullets, so two hits).
1. **Room: DONE.** The shield's code is in bank 4 under ANDY (`src/shield.6502`, ROMSEL `&04`:
   measured at every hook in play; `start_game` runs with bank 5 paged, so its hook is a 7-byte stub
   in `moved_0a20`). The main block took 7 of its 9 free bytes (the hit hook 3, the tick 3,
   `hit_type`'s `STA` 2, `start_game` -1). Its variables are zero page `&07-&0F` (the dead unpacker's:
   no access in a game, `tools/zpwatch.mjs`). The HUD buffer (80 bytes) and the renderer's zone,
   grown to 24 entries (its bank 4 hole was full), are main RAM `&0C79-&0CF8` after `moved_0a20`, not
   in the file. The renderer copies the HUD instead of indexing the digit table, which is smaller.
2. **The flags: DONE.** `GAMEPLAY_SHIELD` in `build.ps1`, the `Makefile` (both make the same image,
   2026-10-20) and the stamp; `RELEASE` allows it. Every flag off: **byte-identical** to `main`'s
   build (`tools/dfs.py compare`); all 20 flag combinations assemble with no warnings.
3. **The shield: DONE** under `GAMEPLAY_SHIELD`, lives as the original's (a hit at 0 shield is a
   life, on the spot, and the shield is full again). The bar: 6 byte columns (12 pixels, two
   segments of 5) right of the lives digit, rows 1-6, green filled, red empty, all white for 2 passes
   in 4 for 12 passes after a hit; the hit's sound is the original's. Checked (jsbeeb 2.10.0):
   - `tools/shieldtest.mjs` (new): the whole world (11,410 passes, 318 hits, 118 of them lives): the
     damage by type, the lives only at 0, the refill (only after 125 quiet passes, 1 a pass) and the
     bar after every tick (11,408), all as the rules say, judged independently of the code;
   - the renderer against its `DEBUG_FULLREDRAW` twin: identical on seeds 1 and 5 (4,000 passes),
     helicopter flight 5 and the whole world; `tools/frontend.mjs` 15 of 15; observer mode;
   - cost (pcprof work a pass, the bench build with and without the flag): 37,041 -> 37,735 on
     seed 1, 41,606 -> 42,958 holding RIGHT, mostly `ren_plot_lives` copying 80 bytes rather than
     32 at each scroll for each screen; late frames seed 1 5 -> 6 of 1,998, RIGHT 0 -> 0, the whole
     world 355 -> 437 of 11,409. Cheaper: an unrolled copy (bank 4 has the room the smaller
     ren_plot_lives freed), or a narrower bar.
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

- **Discs:** one disc per build for now: `strykers.ssd` the original (every flag off) and
  `strykers-gameplay.ssd` with every `GAMEPLAY_*` flag on (a `make gameplay` / `build.ps1`
  target names the set). Both on one disc with a boot menu (both fit on the 80-track side: 316
  sectors each of 800) is for a release, once the variations settle; one build with everything
  switchable costs room and loses the proof that the original is untouched.
