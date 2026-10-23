# Brief: `gameplay-shield` into `main`, and one release disc with both games (PLAN)

KC, 2026-10-23: "start planning the merge into main - we can reuse the disk menu from the original
release that has space for two options - (1) original game + performance improvements (2) redux
version with gameplay improvements".

## 1. The merge

- `main` (`d03e4bd`) is an ancestor of `gameplay-shield` (149 commits on, 2026-10-23): the merge is a
  fast-forward, no conflicts. After it `main` is the one line of work; `gameplay-shield` is deleted
  (its PLAN note "kept separate from `main`" goes).
- Every gameplay variation stays behind its flag, off by default (decisions 43-69), so the plain
  build is what it was: the flags-off disc is byte-identical before and after the merge (proved with
  `tools/compare.py`, as each change on the branch was).
- The checks on `main` after it: every build set assembles (shipping, gameplay, `SKY_HELI=0`,
  `DEBUG_FULLREDRAW`, the relocation pair); the grind gate's checks on the shipping build; the
  gameplay harnesses (shield, lives, timer, options, run, selfhit, rupture) on the gameplay disc.

## 2. The release disc: the original's menu

The original release's disc (`reference/sth/StrykersRun.ssd`) boots into a menu: `MENU`, a 259-byte
BASIC program, sets MODE 1 with the palette black, `*RUN MSCREEN` (13,224 bytes at `&2F00`: code that
draws the picture), then shows it: the Stryker's Run logo on green, and a black box: "PLEASE CHOOSE /
(1) Standard version / (2) Enhanced version / Press 1 or 2". 1 runs `SETSCR` (the standard version),
2 `SRRUN` (the enhanced). (`LOAD` and `!BOOT` there are Stairway to Hell's wrapper, not the original's.)

Ours, the same menu with the box's two lines changed:
- **(1) the original game, faster** - the shipping build (every flag off).
- **(2) Redux** - the gameplay build (every flag on).
Exact wording is KC's (below); the box has room for about 20 characters a line.

## 3. The disc's layout

One 80-track side (800 sectors). Each build is the same 8 files (`SRRUN`, `SCREEN`, `MGAME`,
`DATA1`-`DATA4`, `INFO`), so each goes in a DFS directory of its own and keeps its names:
- `$.` the original: as the shipping disc has them (~316 sectors).
- `R.` Redux: as the gameplay disc has them (~330 sectors).
- `$.!BOOT` (`*BASIC`, `CHAIN "MENU"`), `$.MENU`, `$.MSCREEN` (~55 sectors).
About 700 sectors and 20 catalogue entries of 31. The menu picks a build by `*DIR` (`$` or `R`) and
`*RUN SRRUN`: `SRRUN` loads `SCREEN`, `DATA1`-`DATA4` and `MGAME` by name from the current directory,
so neither build changes. Each build's own `!BOOT` settings (`*TV255,1`, `*FX200,3`) move into `MENU`,
as the original's had them.

Built by a new step after the two builds: `tools/releasedisc.py SHIP.ssd GAMEPLAY.ssd OUT.ssd` takes
each build's files into its directory and adds the menu's; `build.ps1 -ReleaseDisc` / `make
release-disc` makes `build/strykers-release.ssd` (both builds `-Release`). The stamp (`INFO`, the
`!BOOT` banner) is each build's, as now.

## 4. The menu's files

- **`MENU`**: the original's lines kept (MODE 1, the black palette, `*RUN MSCREEN`, the palette
  shown, `*FX15,1`, the key loop), the choices changed to `*DIR $` / `*DIR R` then `*RUN SRRUN`. Kept
  as BASIC source in `src/menu.bas`, tokenised at build time (a small tokeniser in
  `tools/releasedisc.py`), so it is readable and diffable.
- **`MSCREEN`**: the original's code and picture, carried as data from the reference disc (as
  `SCREEN`, the loading picture, is: `src/title_data.6502`), with the box's two lines redrawn. First
  job: find how `MSCREEN` draws the box's text (not stored as ASCII: pixels in its data, or a font of
  its own), then either patch those bytes or draw new lines in the game's font at build time.

## 5. Checks

- `tools/menutest.mjs` (new): boot the release disc on a Master, see the menu (the box's pixels against
  a reference picture), press 1, reach the original's title; again with 2, reach Redux's title (its
  "6 GAME RULES" line); BREAK back to the menu.
- The harnesses that boot a disc (`tools/playscript.mjs` `bootMaster`) take a `--menu 1|2` so
  frontend, passlock and the gameplay harnesses can run on the release disc itself, not only on the
  single-build discs; at least frontend on both choices, and one passlock against each single disc.
- `tools/compare.py`-style: each directory's files byte-identical to its single-build disc's.
- The WIP: one link for the release disc; the two current WIP discs stay as they are until KC says.

## Questions for KC

1. **The menu's wording** for the two lines (about 20 characters each), and whether "PLEASE CHOOSE"
   and "Press 1 or 2" stay.
2. **Redux's directory name**: `R.` (one letter: DFS directories are one character).
3. **The single-build discs**: keep `build/strykers.ssd` and `build/strykers-gameplay.ssd` as the
   development discs (the harnesses use them) with the release disc made from them - proposed.
4. **When**: the merge first (it stands alone), then the disc.
