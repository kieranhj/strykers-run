# How hard the game is: the original, the multi-hit fix, the gameplay rules

Measured 2026-10-21 (jsbeeb 2.10.0, Master 128) with `tools/humanbot.mjs` playing the whole world and
`tools/botcompare.mjs` counting, on branch `gameplay-shield` (`66c7b87` and after). KC's question:
"do you think the game is completable with standard issue 3 lives? (or the original game with 9 hit
points only?)".

## The method

The bot (`tools/humanbot.mjs`) reads the mover tables and plays as a person might: it shoots soldiers
in range, ducks the y 42 bullets (a crouch is 17 high), jumps the lower ones at the top of the jump,
steps out from under falling bombs and grenades, jumps mines, rushes gun emplacements, holds back on
a low shield, runs when the way is clear, with seeded reaction times (3-6 passes). It plays each
build's own controls, read from the build's flags: on the gameplay disc it jumps on UP's press and
fires on the move (`GAMEPLAY_JUMP`, `GAMEPLAY_FIRE`); without them it holds UP to crouch and releases
it to jump, and stops to shoot (a shot stands the player still for 4 updates).

Every run has infinite lives (`startWorldGame` pokes `kill_player`), so a run always reaches the
headquarters and every death is counted; the gameplay disc's deaths rewind the view as its rules say
(decision 45). Keys are chosen by pass, so a seed is one game for a given build.

The discs:

- **1986 original**: `build/strykers-original.ssd`, `make original`'s byte-identical rebuild of the
  reference (with its symbols copied beside it). 9 lives, each hit a life, and BUGS #13: one hit could
  cost several (an explosion left on the player kept hitting; a projectile run into hit twice).
- **Original rules, fixed**: `build/strykers.ssd`, the shipping build (every `GAMEPLAY_` flag off): the
  original's rules with BUGS #13 fixed (layer 5) and step 2's speed (25 passes a second, against the
  original's ~16; the bot plays by pass, so speed does not change its game).
- **Gameplay disc**: `build/strykers-gameplay.ssd`, every `GAMEPLAY_` flag: 3 lives, a two-unit shield
  that recharges (a hit at 0 shield takes a life), the run key, jumping and firing on the move.

## The results

The whole world (to the completion screen), two seeds each:

| Disc | Seed | Passes | Hits | Deaths | Deaths within 10 passes of the one before | Score |
|---|---|---|---|---|---|---|
| 1986 original | 1 | 26,179 | (each a life) | **334** | 172 | 23,350 |
| | 2 | 24,929 | | **301** | 158 | 25,420 |
| Original rules, fixed | 1 | 26,327 | (each a life) | **175** | 57 | 23,630 |
| | 2 | 24,267 | | **190** | (not counted) | 23,730 |
| Gameplay disc | 1 | 20,355 | 112 | **35** | | 25,720 |
| | 2 | 20,187 | 108 | **28** | | 24,340 |

Deaths by 500 columns of the view, seed 1:

| Columns | 0 | 500 | 1000 | 1500 | 2000 | 2500 | 3000 | 3500 | 4000 | 4500 | 5000 | 5500 | 6000 | 6500 | 7000 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1986 original | 1 | 10 | 8 | 9 | 20 | 25 | 23 | 32 | 30 | 16 | 39 | 35 | 64 | 22 | |
| Original rules, fixed | 2 | 5 | 7 | 5 | 11 | 14 | 12 | 12 | 16 | 20 | 21 | 12 | 19 | 17 | 2 |
| Gameplay disc | 1 | | 1 | 1 | 5 | 2 | 1 | 1 | 6 | 3 | 4 | 5 | 7 | 1 | |

(The gameplay disc's row is deaths; its hits by band were 1, -, 1, 1, 17, 7, 5, 5, 18, 9, 10, 14, 21, 3.)

## What they say

- **The multi-hit bug roughly doubles the lives the original takes.** The 1986 original lost 334
  and 301 lives where the fixed build lost 175 and 190, over the same world in about the same number
  of passes: about 1.7-1.9 lives a hit. Almost all of the difference is quick repeats (172 against
  57 within 10 passes of the death before; the fixed build's 57 are the bot walking back into what
  killed it). So in the 1986 game the 9 lives were worth about 5 hits.
- **The original's controls cost the bot too.** Even with the fix, the original's rules took 175-190
  hits where the gameplay disc's took 108-112: stopping to shoot and the late, press-and-release jump
  leave the player exposed for longer (it managed 28-53 jumps in the whole world in the original's
  controls, 111-115 in the gameplay disc's).
- **The shield is the gameplay disc's big step.** About one hit in four becomes a death (112 hits, 35
  deaths), because hits spaced more than the 5 second wait apart are absorbed.
- **There is no wall.** In every disc the deaths spread over the world after its first 2,000 columns
  (the gun nest at ~2,270 is the first hard place); the densest stretches are 4,000-4,500,
  5,000-5,500 and 6,000-6,500.

## What they do not say

The bot is far worse than a practised player: most of its hits it need not take (enemy bullets are
fired 24-48 columns away, 8-20 passes of warning; it jumps into bullets and walks under bombs). So the
numbers compare the discs' difficulty; they do not say whether a person can finish one. To finish the
1986 original on 9 lives a player must take about a twentieth of the bot's hits there; the gameplay
disc on 3 lives, about a tenth of its deaths. A playtest says more, and a count of the hits nobody
could avoid (bullets fired from close range, bombs with nowhere to go) would give a floor.

## Repeating it

```
make original                      # build/strykers-original.ssd
cp build/original/build/strykers.symbols.json build/strykers-original.symbols.json
.\build.ps1 ; .\build.ps1 -Gameplay
node tools/botcompare.mjs build/strykers-original.ssd --bot human --seed 1 --passes 45000
node tools/botcompare.mjs build/strykers.ssd --bot human --seed 1 --passes 40000
node tools/botcompare.mjs build/strykers-gameplay.ssd --bot human --seed 1 --passes 40000
```

Each run takes 10-25 minutes; they can run side by side. `tools/bottrace.mjs` shows the bot's reason
for its keys, pass by pass.
