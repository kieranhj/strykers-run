# Stryker's Run (Enhanced) - buildable source

Stryker's Run was written by Chris Roberts and Philip Meller, with graphics by Nick Elms and music
by Martin Galway, and published by Superior Software for the BBC Micro in 1986. This repository
rebuilds the BBC Master 128 enhanced version from an annotated disassembly into
[Baron](https://github.com/waitingforvsync/baron) source, byte for byte against the Stairway to
Hell disc, as the starting point for optimising its frame rate and removing sprite flicker.

The disassembly (`reference/`) was made by reverse engineering, without access to the original
source; its author asks that it be taken as a tribute. The game remains the copyright of its
authors and publisher; this repository is for study and preservation.

    .\build.ps1        # -> build/strykers.ssd, checked against reference/sth/StrykersRun.ssd

Boot `build/strykers.ssd` on a Master 128 (SHIFT+BREAK). Needs Baron 0.5.3 in `bin/` or on the
PATH, and Python 3.
