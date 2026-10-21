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

## Room (the shipping build's listing, 2026-10-20)

Next to none where the renderer can read while it draws: main RAM 9 bytes (`&33F7-&33FF`), bank 4
43, HAZEL 24. Elsewhere: `moved_0a20` 142, under ANDY 444, banks 5 / 6 / 7 388 / 530 / 481,
`MGAME`'s carrying room 849. Any idea below that adds code or data in play starts by finding room.

## Layer 5 - quirks and original glitches (decision 13)

- Check in jsbeeb, then fix: a scroll column lost when moving with `frame` >= 0 (firing in a
  helicopter while moving); the column replotted after a hostile collision.

## Gameplay variations: the shield and lives that respawn (decisions 43-46)

Branch `gameplay-shield`, `docs/briefs/gameplay-shield.md`: the double hit is fixed (BUGS #13, on
`main`); built (2026-10-20/21): the shield (`GAMEPLAY_SHIELD`, 44), lives that respawn
(`GAMEPLAY_LIVES`, 45), the game rules screen (`GAMEPLAY_OPTIONS`, 46) and the timer
(`GAMEPLAY_TIMER`, 47, KC's request, its details for KC to review). Left: the gameplay disc's
make target, KC's review (hit sound, rewind speed and distance, the timer's par and bonus), the
HUD's cost (KC's idea: rupture the screen so the top line is one fixed area of RAM, drawn once:
the brief, item 10), and the branch kept separate for now (KC, 2026-10-21). Open for KC: high scores with infinite lives, hit feedback, the bar's
colours, which discs to make.

## The level editor, v1 (decision 41)

`docs/briefs/level-editor-v1.md`; the format is `docs/level-format.md`, `tools/worldmap.py` reads it.

## Speed, if it is wanted again

Layer 4's leftovers, costed in `docs/step2-layer4-costing.md` "Closed": a third kind cache slot,
the generic column path's overhead, the logic in the bursts, compiled bodies, the scroll column's
rest, a grind round 3. Most want room the renderer can read while it draws.

## Ideas - gameplay variations (not agreed)

Each changes how the original plays (rule 1), so each needs a decision before it is built.

KC, 2026-10-17:
- Jump at once, without the player stopping first.
- Fire while running, without stopping.
- Run at the jumping and helicopter speed, which scrolls more smoothly: running moves the view
  0.46 columns a pass, jumping 0.65-0.67 (`docs/step2-layer3.md`).
- Or a run modifier key: today's speed becomes a jog, and the key gives a faster run.
- Health packs.
- Shields.
- Music in the game, now 25 Hz holds with time to spare: cycles every field, and RAM for the
  tune (HAZEL's 2.6K, banks 5-7; the memory map page).
- The flip at the next vsync (not adopted, decision 35): 34-37 frames a second, uneven, the
  movement scaled by the fields each pass took (`docs/step2-layer4-costing.md` "Unlocked").

KC and the community, 2026-10-20 (gameplay first, rather than cheats; "more fun and 'modern'"):
- (The recharging shield and lives that respawn: planned above, decisions 44-45.)
- **A timer, and an end-of-game bonus for the time taken**, into the high score (to balance the
  infinite lives).
- **Against the clock mode**: reach the headquarters before the timer runs out, or bad things
  happen.
- **Weapons to collect**: e.g. a shoulder-mounted long-range rocket launcher for the machine-gun
  nests; limited ammunition for some, collected as pickups.
- **A dithering option for non-NuLA machines**, to make the palette easier on the eye.
