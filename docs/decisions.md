# Decisions

| # | Date | Decision | Where |
|---|------|----------|-------|
| 1 | 2026-10-16 | **The reference build is the Stairway to Hell disc** (`reference/sth/StrykersRun.ssd`), not the Disc999 image first supplied. Its `MGAME` matches the disassembly's scenery tables; Disc999's `game` has seven scenery bytes zeroed (`&1042`, `&1043`, `&104A`, `&1078`, `&1088`-`&108A`), which no code writes, so they look like corruption. Both discs share the four data files. STH sets CRTC R8 = `&00` (interlace off) where the disassembly and Disc999 have `&01`; the build follows STH. (KC) | `tools/disasm2baron.py` CORRECTIONS, `src/game.6502` |
| 2 | 2026-10-16 | Baron 0.5.3, built from the local repo (`Repos/baron`, commit 50ba7a6), copied into `bin/` (gitignored). (KC) | `build.ps1` |
| 3 | 2026-10-16 | **The disc is the enhanced version only.** STH's BASIC menu (`LOAD`, `MSCREEN`, `MENU`), the standard version (`GAME`, `SETSCR`) and its loading screen are dropped. A new `!BOOT` (machine code, `*OPT 4,2`) prints the build stamp and does what the menu did for option 2: `*TV255,1`, `*FX200,3`, `*RUN SRRUN`. Every other file is STH's, byte for byte. (KC) | `src/loader.6502` |
| 4 | 2026-10-16 | git, with a private GitHub repo. (KC) | |
| 5 | 2026-10-16 | Catalogue load/exec addresses are host addresses (`&FFFFxxxx`) for every file; STH's `DATA1`-`4` and `SRRUN` had `&0000xxxx`. No effect without a second processor; with one, the files now stay in the host. | `src/main.6502` |
| 6 | 2026-10-16 | The disassembly's typos are corrected by the converter, each checked against both discs: wrong addresses at `&2187`, `&2402`, `&3C98`, `&2D0E`; wrong hex at `&19D0`, `&2287`; the score text `&3367` holds `&6C` digits, not `&66`. | `tools/disasm2baron.py` CORRECTIONS |
