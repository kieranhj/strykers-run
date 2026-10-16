# CLAUDE.md

Guidance for Claude Code in this repository: a buildable source for **Stryker's Run (Enhanced)**
(Superior Software, 1986; Chris Roberts and Philip Meller, graphics Nick Elms, music Martin
Galway) for the BBC Master 128, made from an annotated disassembly so it can be optimised.
`PLAN.md` is the live plan, `docs/decisions.md` the record of every agreed decision, `BUGS.md`
the bug log. The method is beeb-port-kit's (`C:\Users\khcon\OneDrive\BEEB\Repos\beeb-port-kit`,
`PORTING.md`); its skills are in `.claude/skills/`.

## The rules

- **The original is the specification.** Step 1 rebuilds the game byte for byte; step 2 changes
  how it runs, never what it plays like, unless a decision says otherwise.
- **Deviations are agreed before they are built and written down after**, as numbered entries in
  `docs/decisions.md`.
- **Measure, do not recall.** Every timing number says what it was measured on and when.
- **Verify against the reference, not the screenshot.** `tools/compare.py` for bytes; RAM and
  bank dumps at equal game state for behaviour.

## Target

| | |
|---|---|
| Machine | BBC Master 128 (65SC12, four sideways RAM banks 4-7). The enhanced version needs both |
| Reference | The Stairway to Hell disc, `reference/sth/StrykersRun.ssd` (decision 1): files `MGAME`, `DATA1`-`DATA4`, `SCREEN`, `SRRUN` |
| Disc | Enhanced version only (decision 3): `!BOOT` (stamp, `*TV255,1`, `*FX200,3`) -> `SRRUN` -> `SCREEN`, then `DATA1`-`4` into banks 4-7, then `MGAME` |

## Build

```powershell
.\build.ps1             # build/strykers.ssd, then tools/compare.py against the reference
.\build.ps1 -NoCompare  # step 2: the code deliberately differs from the reference
.\build.ps1 -Release
```

Step 1's byte-identical source is the tag `step1-identical`; from step 2 on, build with `-NoCompare`.
Baron 0.5.3 (`bin\baron.exe`, gitignored; built from `C:\Users\khcon\OneDrive\BEEB\Repos\baron`,
decision 2). One assembly, `src/main.6502`, so the game and the banks share one symbol table.
`build/strykers.lst` is the listing, `build/strykers.symbols.json` the symbol dump: take
addresses from there (`python tools/listing.py symbols build/strykers.symbols.json NAME`).
`build_stamp.py` stamps the last commit's time (`+` if the tree is dirty) into `INFO` and `!BOOT`.

## Source (`src/`)

| File | Contents |
|---|---|
| `main.6502` | the disc: one `SECTION` per file, `MGAME`'s copy-down stub |
| `game.6502` | the game, assembled at `&0E00`; the three blocks it copies down at start-up (`&4000`->`&0004`, `&4200`->`&0400`, `&4600`->`&0880`) are rephased nested sections |
| `bank4.6502`..`bank7.6502` | sideways RAM: `DATA1` (bank 4), `DATA2` (bank 5, from `&8400`: title, high scores, music), `DATA3` (bank 6), `DATA4` (bank 7) |
| `title.6502`, `title_data.6502` | `SCREEN`, the loading picture (scope `title`) |
| `loader.6502` | `SRRUN`, `!BOOT`, `INFO` |
| `zp.6502` | zero-page names (several per address: the game reuses zero page) and fixed workspace |
| `os.6502` | MOS calls, vectors, hardware registers |
| `lib/boot_stamp.6502` | the kit's stamp macros |
| `lib/keydown.6502` | the kit's `keydown_int`, forked (step 2 layer 1): the keyboard read straight off the System VIA |

`game.6502` and `bank*.6502` were generated once by `tools/disasm2baron.py` from
`reference/strykers-run-enhanced-disassembly.txt` and are **hand-maintained**: the converter
refuses to overwrite them. Lines beginning `\ ` keep the disassembly's own annotations; `***`
marks code that differs from the standard version. Watch for self-modifying code: the
disassembly's `actually`/`also` notes say what an operand really is.

## Tools

- `tools/compare.py [built.ssd] [reference.ssd]` - every file byte for byte
- `tools/m6502.py FILE LOAD START [END]` - 65SC12 disassembler for poking at binaries
- `tools/listing.py`, `tools/dfs.py`, `tools/jsbeeb_src.mjs` - the kit's
- `tools/disasm2baron.py` - the one-shot converter (audit trail)
- `tools/playscript.mjs` - the scripted game (boot, start, run/fire/jump); `tools/play.mjs DISC` plays it with screenshots
- `tools/lockstep.mjs A B [FRAMES]` - two builds on the same input, first frame whose screen differs
- `tools/tracediff.mjs CONTROL SHIFTED SHIFT [@FRAME]` - the first instruction or screen write that differs, both stopped there (`DUMP=05` shows the bytes at a zero-page pointer)
- `tools/profile.mjs DISC [FROM] [FRAMES]`, `tools/speed.mjs DISC` - passes/s, fields per pass, flat profile; speed with RIGHT held
- `tools/irqprofile.mjs DISC [FROM] [FRAMES]` - every interrupt by the VIA source it serviced, its cycles by MOS subroutine (nesting handled: the MOS's tick re-enables interrupts)
- `tools/frontend.mjs DISC` - title, instructions, define controls, pause, high score entry, toggles, two games: 14 checks, plus the MOS state handed over and back
- `tools/split.mjs DISC FROM FRAMES`, `tools/splitscroll.mjs DISC` - when the palette writes land after vsync, every field / on scrolling fields
- `tools/soundfx.mjs DISC OUT.json` - each sound effect's SN76489 writes, for comparing two builds

## Memory (MGAME, as the reference lays it out)

`&0000-&00FF` zero page, with game code at `&0004-&0077` (the sprite column unpacker);
`&0300` column buffer; `&0400-&07FF` and `&0880-&095F` copied-down code and data; `&0E00-&3FFF`
code and data; `&4000-&46FF` start-up code, then the screen `&4000-&7FFF` (16K, MODE 2,
hardware-scrolled by the CRTC). Bank 5 `&8000-&83FF` is the player buffer.

Step 2 additions: zero page `&90` (`field_count`), `&92`/`&93` (the PRNG); `&33B9-&33FF` (the
standard version's dead table) holds layer 1's keyboard read, PRNG and two variables, padded so
everything from `&3400` stays put, 3 bytes free (2026-10-16); bank 5 grows only at its end
(`&A3FA-&A463`), because its music is page-aligned. In play the game's `irq1_handler` owns vsync
(`irq_owned` = `&FF`); on the front end the MOS has it (decision 14).
