# Stryker's Run (Enhanced) - buildable source

Stryker's Run was written by Chris Roberts and Philip Meller, with graphics by Nick Elms and music
by Martin Galway, and published by Superior Software for the BBC Micro in 1986. This repository
rebuilds the BBC Master 128 enhanced version as [Baron](https://github.com/waitingforvsync/baron)
source - byte for byte identical to the original at the tag `step1-byte-identical-rebuild` - and is now
making it run smoothly and without its sprite flicker.

**Where it stands** (2026-10-20): the game draws into two screens in turn (shadow RAM), its
sprites masked, so nothing flickers, and runs at a steady 25 frames a second - the speed the
original was designed for - against the original's 15-17 and its flicker: every frame on time on a
busy scripted game (1,998 frames) and holding RIGHT (598), and 97% over the whole world played start
to finish (layer 4, tag `step2-layer4-steady-25hz`). 25 Hz is the target (decision 35): 50 Hz was
costed and does not fit. Next are the original's own glitches (layer 5), a level editor, and
gameplay ideas not yet agreed. What has landed is in `docs/done.md`, what is left in `PLAN.md`.
Seen in the jsbeeb emulator only so far, not yet on real hardware.

The game remains the copyright of its authors and publisher. This repository is for study and
preservation; it does not include the original disc images or the disassembly it was made from.

## Credits

- **The disassembly** this source was converted from is the annotated *Stryker's Run (Enhanced
  version)* disassembly by **Level 7** ([www.level7.org.uk](https://www.level7.org.uk)),
  `strykers-run-enhanced-disassembly.txt`. Its labels and comments are carried through into
  `src/`; the author asks that it be taken as a tribute to the original authors, and so is this.
- **The reference build** is the Stairway to Hell disc image of the game, `StrykersRun.ssd`
  (www.stairwaytohell.com), whose files the build reproduces exactly.

## Building

### Two builds

| | Source | Build | Image |
|---|---|---|---|
| **The optimised version** (step 2, in progress: a steady 25 Hz, no flicker) | `main` | `make`, or `.\build.ps1` | `build/strykers.ssd` |
| **The original**, byte for byte the Stairway to Hell disc's game | the tag `step1-byte-identical-rebuild` (`762a0d2`) | `make original`, or the tag's own `build.ps1` in a worktree of it (below) | `build/strykers-original.ssd` |
| **The gameplay variations** (decisions 43-47: a recharging shield, lives that respawn, a timer, a game rules screen; branch `gameplay-shield`) | `gameplay-shield` | `make gameplay`, or `.uild.ps1 -Gameplay` (add `RELEASE=1` / `-Release` for testers) | `build/strykers-gameplay.ssd` |

`make original` exports the tag's `src/` and `tools/` into `build/original/` (`git archive`, so it
needs a clone with its tags: `git fetch --tags`), assembles them with the flags the tag's
`build.ps1` used, and checks every file against the reference disc if you have it. Its image is
the one the tag's own `build.ps1` makes in a checkout of the tag, build stamp included
(`sha256 9f50c254...`, 2026-10-17). On Windows without make, check the tag out beside this one
(`bin\` and `reference\` are not in git, so point `$env:BARON` at Baron and copy the reference
disc across):

    git worktree add ../strykers-original step1-byte-identical-rebuild
    cd ../strykers-original
    .\build.ps1        # -> build\strykers.ssd, compared with reference\sth\StrykersRun.ssd

**Milestone tags.** As each stage of the optimised version closes, its commit is tagged with
what it achieved (decision 42, which renamed the earlier `step1-identical` and `step2-layerN`):

| Tag | Commit | What it is |
|---|---|---|
| `step1-byte-identical-rebuild` | `762a0d2` | the source rebuilt byte for byte from the original disc |
| `step2-layer1-own-interrupt-vsync-lock` | `0a078b8` | the interrupt owned, the pass locked to 2 fields (layer 2's control) |
| `step2-layer2-shadow-double-buffer` | `63892d7` | double buffered in shadow RAM, drawn from per-screen records |
| `step2-layer3-fast-enough` | `07ef49c` | 24.70 passes a second, the original's design rate 25 |
| `step2-grind1-ram-rearranged` | `acd4c4a` | the grind's round 1 and the RAM rearranged: 6 late frames of 1,998 |
| `step2-layer4-steady-25hz` | the layer's close | a steady 25 Hz: no late frames on seed 1 or holding RIGHT, 339 of 12,235 over the whole world |

Each tag builds with the build script it carries; check one out with
`git worktree add ../strykers-<tag> <tag>`.

### Tools

Baron 0.5.3 and Python 3; Node.js and jsbeeb for the test harnesses. Both builds look for Baron
in `$BARON`, then `bin/` (`bin/baron`, or `bin\baron.exe`), then the PATH. To build Baron from
source (C17, CMake; a C compiler and `cmake`):

    git clone --recurse-submodules --branch v0.5.3 https://github.com/waitingforvsync/baron.git
    cmake -S baron -B baron/build -DCMAKE_BUILD_TYPE=Release
    cmake --build baron/build
    cp baron/build/src/baron bin/          # or: make BARON=/path/to/baron

Baron's own README has the details. The language is still moving, so use 0.5.3: it is the version
this source is assembled with (`docs/decisions.md` 2).

### Linux, macOS, BSD: the `Makefile`

```sh
make                 # the optimised version -> build/strykers.ssd
make release         # RELEASE=1: the build for other people, every debug flag off
make original        # the original -> build/strykers-original.ssd, checked against the reference
make clean           # remove what the build made (the harnesses' files in build/ stay)
make help            # every target and option
```

`python3` comes from the PATH; `PYTHON=` overrides it. The options are `build.ps1`'s:

| `build.ps1` | `make` | Image |
|---|---|---|
| *(no options)* | *(no options)* | `build/strykers.ssd` |
| `-Compare`: check against the reference | `COMPARE=1` | `build/strykers.ssd` |
| `-Release` | `release`, or `RELEASE=1` | `build/strykers.ssd` |
| `-Define DEBUG_LIVES,DEBUG_FULLREDRAW` | `DEFINES=DEBUG_LIVES,DEBUG_FULLREDRAW` | `build/strykers-debug_lives-debug_fullredraw.ssd` |
| `-Shift 256` | `SHIFT=256` | `build/strykers-shift256.ssd` |
| `-Shift 256 -ShiftEnd` | `SHIFT=256 SHIFTEND=1` | `build/strykers-shift256end.ssd` |

Comparing is off by default in both builds: from step 2 the code deliberately differs from the
reference, so on `main` the comparison can only fail. Each build writes its listing
(`build/strykers.lst`) and symbol dump (`build/strykers.symbols.json`) beside the image, and
prints the image's SHA256. The Makefile has been run with GNU Make 4.4.1 on Windows (Git Bash);
reports from other makes and systems are welcome.

### Windows: `build.ps1`

```powershell
.\build.ps1                       # the optimised version -> build\strykers.ssd
.\build.ps1 -Release              # the build for other people
```

**The two build scripts make the same image**, byte for byte, given the same source. The build
stamp in `INFO` and `!BOOT` is the time of the last commit, with `+` when the tree has
uncommitted changes, so two machines building the same commit get the same SHA256;
`SOURCE_DATE_EPOCH` overrides it. `python tools/dfs.py compare A.ssd B.ssd` compares two images.

Boot the image on a Master 128 (SHIFT+BREAK). The enhanced version needs the Master's four
sideways RAM banks.

## Playing

The latest work-in-progress build runs in the browser, in jsbeeb as a Master 128:
<https://bbc.xania.org/?disc=https://bitshifters.github.io/content/wip/strykers-run-wip.ssd&autoboot&model=Master>

| Key | |
|---|---|
| Z, X | left, right |
| K, M | up (jump), down |
| L | fire |
| SPACE | grenade |
| RETURN | enter |
| P | pause |

These are this version's defaults (`docs/decisions.md` 27; the original's were A, Z, RIGHT, LEFT,
SHIFT, DELETE, CTRL, P); define controls on the title screen changes them. Two debug flags exist
for test builds (`-Define`, or `DEFINES=`): `DEBUG_LIVES`, infinite lives, and
`DEBUG_FULLREDRAW`, the renderer redrawing every sprite every frame (the oracle the tests compare
against). `-Release` turns every debug flag off.

### Reference files

The builds check their output byte for byte against the reference disc when you have it. Put the
files the project was made from in `reference/` (gitignored):

| File | What | Used by |
|---|---|---|
| `reference/sth/StrykersRun.ssd` | the Stairway to Hell disc | `build.ps1`, `make COMPARE=1`, `make original`, `tools/compare.py` (skipped if absent) |
| `reference/strykers-run-enhanced-disassembly.txt` | Level 7's disassembly | `tools/disasm2baron.py` (the one-time conversion) |
| `reference/disc999/Disc999-StrykersRunEnhanced.ssd` | another copy, with seven corrupted scenery bytes (`docs/decisions.md` 1) | nothing; kept for the record |

`CLAUDE.md` holds the project's rules and how its tools are used, `PLAN.md` what is left to do,
`docs/done.md` what has landed, `docs/decisions.md` every decision, `BUGS.md` every defect found;
the rest of `docs/` has each layer's measurements.
