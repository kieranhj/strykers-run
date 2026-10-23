# Brief: the first gameplay variations - a recharging shield, lives that respawn (BUILT; KC's review and the merge into `main` left: PLAN.md)

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
4. **Lives and the respawn: DONE** (`GAMEPLAY_LIVES`, `74a9dde`): every death is the skeleton;
   at its end, with lives left, the view goes back the respawn distance a column a pass (the
   renderer's history holds one scroll a pass a screen, so no faster: 80 columns take 3.2 s), the
   player hidden and the rest of the logic stopped (`player_or_rewind`), through a main-RAM stub
   that pages bank 4 back after the scroll and the frame (`rewind_column`); then the player stands
   there, shield full, safe for 50 passes, the bar flashing (not the player: the renderer has no
   room to flash a mover). `tools/livestest.mjs`: 43 deaths, rewinds and respawns over 16,000
   passes, all rules held; `--finite`: game over at the third death.
5. **The game rules screen: DONE** (`GAMEPLAY_OPTIONS`): "6 GAME RULES" on the title; 1 cycles the
   lives 1-9 then infinite (shown as an infinity glyph: `lives_digits`' unused entry 10, decision
   46), 2 the rewind 40/80/120/160 columns, 3 the timer off/up/down; ESCAPE back. The hooks in the
   front end replace instructions of the same size, so the music after them stays page-aligned;
   the screen's code is after it (`src/options.6502`, `src/front_gameplay.6502`, which also has
   `shield_new_game`: `start_game` runs with bank 5 paged). An infinite-lives game ended by ESCAPE
   is kept off the high score table; one that reaches the headquarters goes on (`game_completed`).
   `tools/optionstest.mjs`: 15 checks.
6. **The timer: DONE** (`GAMEPLAY_TIMER`, decision 47): see the decision; `tools/timertest.mjs`.
7. **Speed** (2026-10-20 night, KC: "speed things up as much as you can ... try not to drop any
   more frames"): the HUD drawn 4 bytes a turn; `shield_tick` idle in a pass where nothing
   changed; and on `main`, the lives zone tested as one range (`c10217c`: 61 / 183 cycles a pass
   less in every build); the HUD copied a byte column a turn, rows 1-7 (row 0 is always 0 there:
   `360ab9e`, 151 / 361 cycles a pass less with every flag). The HUD's copy is still most of the
   gameplay builds' cost: 72 bytes with the shield, 128 with the timer, at each scroll on each
   screen. Every flag against flag-off (unshifted `DEBUG_LIVES` builds, passbench, seed 1): 6 late
   frames of 1,998 for 5.
9. **KC's tweaks (2026-10-21):** the bar blue, not green (it shows up better on the sky); the
   rewind 40 columns by default (the screen's first setting); time up shows the skeleton, then the
   game over (`time_up_now`: lives 1 and the shield 0 for a death as at the last life; flying,
   dying or rewinding, the game ends at once as before); an absorbed hit plays its own sound (`&38`,
   a bullet's impact) and not the death's (the hit hook moved to `kill_mover_Y`, before them); more
   RAM: the gameplay builds drop `lives_digits` (the HUD's digit is made from the game's font,
   `src/shield_hi.6502`, in the room it leaves above `&9000`) and let the main block grow over the
   dead BASIC fragment at `&3400`. The branch stays separate (KC).
10. **An idea for the HUD's cost (KC, 2026-10-21):** each screen keeps its own copy of the top line,
   redrawn at every scroll because the hardware scroll moves it. A rupture (the CRTC's vertical
   rupture, a second CRTC frame for the top character row from a fixed address) would give the top
   line one fixed area of RAM, drawn once and only when it changes: no copy at scrolls at all.
   Needs a measured design (the vsync and palette interrupts already time the frame) and b2 or real
   hardware, which jsbeeb alone cannot vouch for.
8. **Room left** (2026-10-21, the listing of the build with every flag): main block 25 bytes (after
   the grind's padding is dropped in gameplay builds, `GAMEPLAY_ANY`); bank 4 2 (the renderer's area)
   and 4 (under ANDY); bank 5 1; bank 6 181 (the timer takes 349); bank 7 481; main RAM after
   `game_completed` (`&0CF2`) 13. The timer and the game rules do not fit the
   relocation test builds' banks (256 bytes smaller, `SHIFT`): ASSERTed; check them unshifted.

11. **A run key: DONE** (`GAMEPLAY_RUN`, decision 48, KC 2026-10-21): SHIFT held while moving on
   the ground updates the player every pass, not one in two: a column a pass, a jump's speed in
   the air. In `-Gameplay` and `make gameplay`. Redefinable (KC): define controls' ninth line,
   "RUN: ", its key at `keys + 8`. Room: gameplay builds free `unused_925f` in bank 5 (a dead copy
   of `&1F5F-&1FFF` before the page-aligned music): 152 bytes left there; main block 21.
   `tools/frontend.mjs` defines nine keys on a `GAMEPLAY_RUN` build and checks the run key.

12. **Hit through a friendly soldier: FIXED** (decision 49, KC 2026-10-21): the original passes a
   projectile's hit on to the player when the mover it hit touches the player; gameplay builds
   let the mover take it. `tools/selfhit.mjs` (and `--point-blank`). Room: the main block's real
   limit is `kc_slot0_y` + 257 <= `&3400` (`src/kindcache.6502`), not the `SKIP` after it: 21 bytes
   (`kc_slot0_y` `&32EA`) in the build with every flag after this fix, which took 13 out; it was 8
   before, not the 21 item 11 said.

13. **The shield on the game rules screen: DONE** (decision 50, KC 2026-10-21): "4 SHIELD" (the
   bullets a full shield takes: 1/2/3/4/6) and "5 RECHARGE" (2/5/8/10 s before it refills); the
   rows now 6-14, two apart (the title font is two rows tall). `tools/optionstest.mjs` (18 checks),
   `tools/shieldtest.mjs --unit U --wait W` (the rules with other settings: 50/50 and 9/250 held
   over 8,000 passes). Bank 5 is full again: 12 bytes left.

14. **The bar contiguous** (KC, 2026-10-21): 6 pixels in a row, not two segments of 3 with a gap,
   then one blank column: `HUD_BAR_COLUMNS` 5 to 4, so the HUD is a byte column narrower (8 bytes
   less to copy at each scroll on each screen; the timer one column left). shieldtest's bar check
   follows; passlock against the `DEBUG_FULLREDRAW` twin (every flag, unshifted `DEBUG_LIVES`), 3,000
   passes: state and screens identical.

15. **Room in bank 5** (2026-10-21, for the run meter's settings): gameplay builds load `DATA2`
   from `&8000` and put `front_gameplay.6502` (with the game rules screen and its text) in bank 5's
   `&8000-&83FF`, the old player buffer, free since masked drawing and never loaded before. Bank 5
   then has 478 bytes free there, 162 before the music and 388 at the end. (Moving a compiled kind
   to bank 7 was costed first: the kinds' sizes, 569-921 bytes, do not pack into what banks 6 and 7
   have.)

16. **The run meter: DONE** (decision 52, KC 2026-10-21): 5 s of running (KC, at first 10), 10 s to refill, half
   full to run again after running dry; no meter on screen, the landing sound when it runs out and
   the jumping sound when it is back (KC: a sound; the effects are placeholders to choose). Game
   rules "6 RUN TIME" (5/10/15/20 s/OFF) and "7 RUN CHARGE" (5/10/15/20 s). Holding RIGHT and the
   run key from pass 20: a column a pass for 250 passes of running, then the original's pace with
   the meter refilling (a death's rewind between refilled it). `tools/runmeter.mjs`.

17. **Jumping and firing on the move: DONE** (decisions 53, 54, KC 2026-10-21): `GAMEPLAY_JUMP`
   jumps on UP's press after one update's crouch, and again on each landing while UP is held;
   `GAMEPLAY_FIRE` fires at once with one update's shooting pose, as a grenade is thrown. Both
   always on in the gameplay disc (no game rules line). passlock, every flag (unshifted,
   `DEBUG_LIVES`) against its `DEBUG_FULLREDRAW` twin, 3,000 passes (the script jumps and fires
   often): state and screens identical.

18. **The timer's limit on the game rules screen: DONE** (decision 55, KC 2026-10-21): "8 TIME
   LIMIT" 3/5/8/10/15 minutes, default 15 (decision 63; was 10), the start counting down and the par counting up; the
   screen two rows higher to hold eight settings.

19. **How hard each disc is** (KC 2026-10-21: "is the game completable with standard issue 3
   lives?"): `docs/difficulty.md`. `tools/humanbot.mjs` (a bot that plays as a person might, each
   build's own controls) over the whole world, infinite lives, every death counted: the 1986
   original 334 / 301 deaths, the original's rules with BUGS #13 fixed 175 / 190, the gameplay disc
   112 / 108 hits and 35 / 28 deaths. The multi-hit bug about doubles the original's cost; the shield
   turns about one hit in four into a death; no single wall. A bot's numbers compare the discs, not
   whether a person can finish one.

20. **The timer as MM:SS.t** (decision 59, KC 2026-10-21): the seconds counted as before, the
   display worked out each pass (the tenths of the pass in the second; counting down, what is left);
   13 HUD columns. Room: `moved_0a20` from `&0982` in gameplay builds, `hud_buffer` at `&0C00`; the
   run meter and the bonus to bank 7. Banks after: 6, 28 bytes; 7, 281.

21. **Vehicles take hits: DONE** (decision 62, KC 2026-10-22): `GAMEPLAY_ARMOUR` gives each of the
   player's vehicles 3 hits, each with the shield's absorbed-hit sound, before the hit that wrecks it
   (then the next explodes it, as before). No HUD. Proven on helilock's flights 5 and 2.

22. **The HUD after the shield: DONE** (decisions 67, 68, 2026-10-22/23): the HUD's cost (item 10) went
    with the row as a CRTC rupture of its own (`HUD_RUPTURE`), and with it the score, the progress
    percentage and a 25-pixel shield bar; `docs/done.md` has the measurements.

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
