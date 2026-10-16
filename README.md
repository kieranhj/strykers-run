# Stryker's Run (Enhanced) - buildable source

Stryker's Run was written by Chris Roberts and Philip Meller, with graphics by Nick Elms and music
by Martin Galway, and published by Superior Software for the BBC Micro in 1986. This repository
rebuilds the BBC Master 128 enhanced version as [Baron](https://github.com/waitingforvsync/baron)
source - byte for byte identical to the original - as the starting point for optimising it to
50 Hz and removing its sprite flicker.

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

Needs Baron 0.5.3 (`bin/baron.exe` or on the PATH) and Python 3; Node.js and jsbeeb for the
test harnesses.

    .\build.ps1        # -> build/strykers.ssd

Boot `build/strykers.ssd` on a Master 128 (SHIFT+BREAK).

The build checks its output byte for byte against the reference disc when you have it. Put the
files the project was made from in `reference/` (gitignored):

| File | What | Used by |
|---|---|---|
| `reference/sth/StrykersRun.ssd` | the Stairway to Hell disc | `build.ps1` / `tools/compare.py` (skipped if absent) |
| `reference/strykers-run-enhanced-disassembly.txt` | Level 7's disassembly | `tools/disasm2baron.py` (the one-time conversion) |
| `reference/disc999/Disc999-StrykersRunEnhanced.ssd` | another copy, with seven corrupted scenery bytes (`docs/decisions.md` 1) | nothing; kept for the record |

`CLAUDE.md`, `PLAN.md` and `docs/` describe the project, its decisions and its measurements.
