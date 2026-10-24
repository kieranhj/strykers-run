# Brief: `gameplay-shield` into `main` (DONE, 2026-10-23), and one release disc with both games (BUILT, 2026-10-23; KC to see it)

KC, 2026-10-23: "start planning the merge into main - we can reuse the disk menu from the original
release that has space for two options - (1) original game + performance improvements (2) redux
version with gameplay improvements".

## 1. The merge

- `main` (`d03e4bd`) is an ancestor of `gameplay-shield` (149 commits on, 2026-10-23): the merge is a
  fast-forward, no conflicts. After it `main` is the one line of work; `gameplay-shield` is deleted
  (its PLAN note "kept separate from `main`" goes).
- Every gameplay variation stays behind its flag, off by default (decisions 43-69). The plain build
  is not byte-identical to `main`'s before (the branch also carries changes for every build: grind
  round 3, the editable scroll text, today's fixes), but plays the same game.
- **Done** (2026-10-23, jsbeeb 2.10.2): `main` fast-forwarded to `gameplay-shield`. Against `main`'s
  `d03e4bd` (`DEBUG_LIVES` builds, the grind gate's checks): passlock seed 1, 6,000 passes, state and
  screen identical; seed 3, 4,000 passes, state identical; the full-redraw oracle, seed 5, 4,000,
  state and screen identical; helilock flights 5 and 2, no frame differing; frontend 0 failed;
  observer mode ok. Every build set assembles (shipping, gameplay, `SKY_HELI=0`, `DEBUG_FULLREDRAW`,
  the relocation pair).
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

## What was built (2026-10-23)

- **The layout changed from section 3:** `$.` holds only the menu's three files (the disc's own
  `!BOOT` is the menu's), the original in `O.`, Redux in `R.`. MENU (`src/menu.bas`) takes 1 or 2 (or
  `!` / `"`, as the original's did), goes to MODE 7, `*DIR O` or `*DIR R`, then `*RUN !BOOT`: that
  build's own boot file (its machine check, its stamp, `*TV255,1`, `*FX200,3`, `*RUN SRRUN`), so
  nothing in either build changed. 21 files, 701 sectors of 800.
- **MSCREEN** (`src/mscreen.bin`, the Stairway to Hell disc's, `releasedisc.py --extract`): a copier
  of 19 character rows of 312 bytes (the mapping in `tools/releasedisc.py`, all 5,928 bytes measured
  against the reference's screen in jsbeeb). The box's text is the artist's own narrow font, not the
  MOS's: `releasedisc.py` cuts its letters from the box's four lines and draws the ones it lacks (g,
  l, comma, f, R, u, x, m, p) in the same style, then redraws the two choices: **"(1) Original, faster"**
  and **"(2) Redux, improved"** (KC, 2026-10-24; first "(2) Redux". "the original, faster" runs 7
  pixels past the box).
- `build.ps1 -ReleaseDisc` / `make release-disc` -> `build/strykers-release.ssd` (both `-Release`);
  the two scripts' discs byte-identical.
- **Checked** (jsbeeb 2.10.2): `tools/menutest.mjs`: the menu's picture 0 of 5,928 bytes differing
  from what `releasedisc.py` drew; 1 loads `O.`'s game (its first 2K in memory equal to `O.MGAME`'s;
  the two games differ in 67 of those bytes) to its title, 2 `R.`'s; each directory's files
  byte-identical to its single disc's; a game started from each choice plays (screenshots).
- The WIP: `strykers-run-release-wip.ssd`.

## Questions for KC

1. **The menu's wording** for the two lines (about 20 characters each), and whether "PLEASE CHOOSE"
   and "Press 1 or 2" stay.
2. **Redux's directory name**: `R.` (one letter: DFS directories are one character).
3. **The single-build discs**: keep `build/strykers.ssd` and `build/strykers-gameplay.ssd` as the
   development discs (the harnesses use them) with the release disc made from them - proposed.
4. **When**: the merge first (it stands alone), then the disc.
