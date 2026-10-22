# Plan

What is left, most pressing first: what waits on KC, then layer 5's fixes, then the level editor,
then the ideas (KC has not ranked them). What has landed is in `docs/done.md`.

Now (layer 4 closed, tag `step2-layer4-steady-25hz`, decision 42; passbench and worldrun on the
bench build, jsbeeb 2.10.0, 2026-10-20): a steady 25 Hz (decision 35), no late frames on seed 1 (0
of 1,998) or holding RIGHT (0 of 598); 339 of 12,235 over the whole world, known and left
(`docs/step2-layer4-costing.md` "Closed"). Work a pass (pcprof, the wait excluded) 34,826 on seed 1
and 39,341 holding RIGHT, of the 79,872 two fields give.

## Waiting on KC

- **b2 and real hardware.** The flip, ACCCON's X bit and HAZEL left paged in (Y) are seen in
  jsbeeb only (`docs/step2-layer2.md` "Open").
- **Which ideas to build** (below): each changes how the original plays (rule 1), so each needs a
  decision first.
- **The front end on hardware**: the scroll text and the credit line run in the vsync interrupt
  with interrupts re-enabled (decisions 57, 60); seen in jsbeeb only.

## Room (the shipping build's listing, 2026-10-20; the main block 2026-10-21)

Next to none where the renderer can read while it draws: the main block 4 bytes (its limit is
`kc_slot0_y` + 257 <= `&3400`, `src/kindcache.6502`, not the `SKIP` after it), bank 4 43, HAZEL 24.
Elsewhere: `moved_0a20` 142, under ANDY 444, banks 5 / 6 / 7 28 + 17 / 530 / 481 (bank 5:
before its music / at its end, after decisions 57 and 60; 2026-10-21),
`MGAME`'s carrying room 849. Any idea below that adds code or data in play starts by finding room.

## Layer 5 - quirks and original glitches (decision 13)

- Check in jsbeeb, then fix: a scroll column lost when moving with `frame` >= 0 (firing in a
  helicopter while moving); the column replotted after a hostile collision.

## Gameplay variations (decisions 43-56, 59, branch `gameplay-shield`)

Kept separate from `main` for now (KC, 2026-10-21); `main` merged into it as it moves. Each
variation is a `GAMEPLAY_*` flag, off by default (flags off: byte-identical to `main`);
`build.ps1 -Gameplay` / `make gameplay` makes `build/strykers-gameplay.ssd` with every flag, the
gameplay WIP. `docs/briefs/gameplay-shield.md` has the design, the checks and the costs.

Built (2026-10-20/21), each with its harness:
- **The shield** (`GAMEPLAY_SHIELD`, decision 44): two units, recharging after 5 s; a blue bar on
  the top line, red when empty, white flash on a hit; an absorbed hit has its own sound.
  `tools/shieldtest.mjs`.
- **Lives that respawn** (`GAMEPLAY_LIVES`, 45): the skeleton, then the view rewinds (40 columns
  by default) and the player returns with the shield full and 2 s safe. `tools/livestest.mjs`.
- **The game rules screen** (`GAMEPLAY_OPTIONS`, 46, 50): "6 GAME RULES" on the title: lives 1-9 or
  infinite, the rewind 40/80/120/160, the timer off/up/down, the shield's hits 1/2/3/4/6 and its
  recharge 2/5/8/10 s, the run time 5/10/15/20 s/off and its charge 5/10/15/20 s, the timer's limit
  3/5/8/10/15 minutes (decision 55). Infinite lives ended by ESCAPE stay
  off the high score table. `tools/optionstest.mjs`.
- **The timer** (`GAMEPLAY_TIMER`, 47, 59): counting up with a bonus for time under par, or counting
  down to the skeleton and game over; shown as MM:SS.t. `tools/timertest.mjs`.
- **The front end** (`GAMEPLAY_OPTIONS`, 56): any key leaves the high score table for the menu; the
  game rules page's layout (heading centred, values right-aligned, "ESCAPE TO RETURN" in the
  copyright's row); define controls asks for RUN before PAUSE. (The front end's changes for every
  build, decisions 51, 57, 58, 60, are `main`'s: `docs/done.md`.)
- **Hits through a friendly soldier** (decision 49, KC's bug): the original passed a projectile's hit
  on to the player when the mover it hit touched the player; gameplay builds let the mover take
  it. `tools/selfhit.mjs`.
- **The run key** (`GAMEPLAY_RUN`, 48, 52): SHIFT held runs a column a pass, a jump's speed, not
  half a column, for 5 s, then refills over 10 s (usable again past half; sounds, no meter);
  redefinable in define controls; its times on the game rules screen.
- **Jumping and firing on the move** (`GAMEPLAY_JUMP`, `GAMEPLAY_FIRE`, decisions 53, 54): the jump
  on UP's press after one update's crouch (again on each landing while held); the bullet at once
  with one update's shooting pose, as a grenade's throw.
- **Vehicles take hits** (`GAMEPLAY_ARMOUR`, decision 62): the player's helicopters and tank take 3
  hits (a bullet's impact sound) before the one that wrecks them; the count stays with a parked vehicle.
- **Dithered hills** (`DITHER_HILLS`, decision 64, branch `dither-hills`): the hills band's far, mid and
  fore ranges dithered (blue 4/16, red 6/16, red 2/16) in `MOUNTAINS_TWO`'s data; `MOUNTAINS_ONE`, which
  only a real Master shows, is not (no room: 708 bytes). The sky tints tried with it were dropped (65, 66).
- Speed: the HUD copied a byte column a turn; every flag on, 6 late frames of 1,998 against 5 with
  every flag off (passbench, seed 1, unshifted `DEBUG_LIVES` builds, 2026-10-21).

Left:
- **KC's choices:** the run meter's two sounds (now the landing's and the jump's, placeholders);
  whether bullets should destroy SAM launchers or stop at dying enemies (both pass through, as in
  the original: what KC saw as a bullet passing through an enemy, 2026-10-21).
- **Difficulty** (`docs/difficulty.md`, 2026-10-21): the bot finds the gameplay disc far kinder
  than the original (35 deaths against 175 with the multi-hit fix, 334 without); whether 3 lives is
  enough for a person wants a playtest, or a count of the hits nobody could avoid (a floor).
- **KC's review** of play: the rewind's speed and distance, the timer's bonus (10 points a second).
- **The HUD's cost: built** (`HUD_RUPTURE`, decision 67): the HUD's row a CRTC frame of its own from
  `HUD_ROW` (`&0B80`, 80 columns), 3.2% of a pass saved. Wants b2 or real hardware before a release.
  Next on it (KC): the progress percentage and the score.
- **Merging into `main`**, when KC says: then one disc with both builds and a boot menu, for a
  release (the brief, "Discs").
- **Room** in the build with every flag (2026-10-21, after decision 60): bank 4 2 and 4 under ANDY
  (nearly gone), main block 29 below `kc_slot0_y`'s limit, bank 6 28, bank 7 281, bank 5 155 + 16 + 17 (its &8000 block, before the music, at its end)
  (the brief, items 8, 15 and 20).
  The timer and the game rules need the unshifted banks.

## The level editor, v1 (decision 41)

`docs/briefs/level-editor-v1.md`; the format is `docs/level-format.md`, `tools/worldmap.py` reads it.

## Speed, if it is wanted again

Layer 4's leftovers, costed in `docs/step2-layer4-costing.md` "Closed" (its kind cache since
replaced by decision 61's sky mode, whose own leftovers are a rotor byte cache, ~0.8k a draw, and a
cheaper leading check, ~0.15k: both want room): the generic column path's overhead, the logic in the bursts, compiled bodies, the scroll column's
rest, a grind round 3. Most want room the renderer can read while it draws.

## Ideas - gameplay variations (not agreed)

Each changes how the original plays (rule 1), so each needs a decision before it is built.

KC, 2026-10-17:
- Jump at once, without the player stopping first; fire while running, without stopping: built
  (decisions 53, 54, above).
- Run at the jumping speed, or a run modifier key: the key built (`GAMEPLAY_RUN`, decision 48,
  above).
- Health packs.
- Shields: built (`GAMEPLAY_SHIELD`, above).
- Music in the game, now 25 Hz holds with time to spare: cycles every field, and RAM for the
  tune (HAZEL's 2.6K, banks 5-7; the memory map page).
- The flip at the next vsync (not adopted, decision 35): 34-37 frames a second, uneven, the
  movement scaled by the fields each pass took (`docs/step2-layer4-costing.md` "Unlocked").

KC and the community, 2026-10-20 (gameplay first, rather than cheats; "more fun and 'modern'"):
- The recharging shield and lives that respawn: built (decisions 44-45, above).
- A timer, and an end-of-game bonus for the time taken; against the clock mode: built
  (`GAMEPLAY_TIMER`, decision 47, above).
- **Weapons to collect**: e.g. a shoulder-mounted long-range rocket launcher for the machine-gun
  nests; limited ammunition for some, collected as pickups.
- **A dithering option for non-NuLA machines**, to make the palette easier on the eye. Tried for the hills: decision 64, branch
  `dither-hills` (`DITHER_HILLS`), on trial; mocks of the sky and hills in the session's artifact.

KC, 2026-10-21:
- **Game rules presets**: ORIGINAL / EASY / MEDIUM / HARD, each setting every rule on the game
  rules screen at once (ORIGINAL as close to the original game as the gameplay build allows).
- The timer's value configurable: built ("8 TIME LIMIT", decision 55, above).

KC, 2026-10-22:
- **How far through the game**, as a percentage on the right of the HUD (the player's x against the
  headquarters' column, as `tools/flightscript.mjs`'s WorldBot measures it).
- **The score on the HUD**. Probably wants the HUD's rupture first (above, "The HUD's cost"): today
  the HUD is copied at every scroll on both screens, so each new column of it costs every pass.
