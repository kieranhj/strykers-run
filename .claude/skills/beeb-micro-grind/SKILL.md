---
name: beeb-micro-grind
description: An aggressive, repeatable micro-optimisation grind over a BBC Micro port's hand-written 6502 - beebgame's static analyses annotate every instruction (flags, registers, memory operand ranges, liveness), the code is cut into 32-instruction windows weighted by measured cycles, an army of optimiser agents proposes faster or smaller code for each window, skeptic agents try to refute every proposal, and the survivors are applied one batch at a time through the full proof gate, kept only if every check passes and the game is no slower. Iterates until a round finds nothing. Expensive (hundreds of agents a round). Use when asked to grind, micro-optimise the whole codebase, or squeeze cycles out of everything.
---

# The micro-optimisation grind

KC's brief, 2026-10-17: "an aggressive micro-optimisation grind over the whole codebase; get static
analysis tools from github.com/ebenupton/beebgame; run to annotate lines with flags, regs, memory
operand ranges; spawn army of agents to evaluate every 32-instruction consecutive sequence of
annotated instructions for better implementations; record candidates; apply serially with
skeptic; iterate indefinitely."

**It is expensive.** A round is one optimiser agent per hot window (one per two cold ones) and two
or three skeptics per candidate: at Stryker's Run's size (232 windows, 78 of them 90% of the
measured cycles) a round over the hot code is 300-600 agents. Say so before starting one, and run
the hottest windows first: most of the cycles are in a few windows, and later rounds reach the rest.

**Pieces** (all in the project):
- `tools/analyse.py annotate`: beebgame's analyses, vendored and pinned (the beeb-dataflow skill).
  Every instruction gets the state before it: A, X, Y, the flags, the memory operand's value or
  range (`?` unknown, `0..9`, `{...}`, `≡$C3` equal to that byte), and `in:/out:` liveness.
- `tools/grind.py`: the windows, the ledger, the gate and the serial run (its docstring).
- `tools/grind_config.py`: this project's protected code, generated sources, builds and checks.
- `evaluate.workflow.js` (beside this file): the optimisers and the skeptics.
- `docs/grind/ledger.jsonl` (every candidate ever, its votes, its fate), `docs/grind/seen.txt`
  (windows already evaluated, by content hash), `docs/grind/README.md` (`grind.py report`).

## A round

1. **On a branch** (`git checkout -b grind-<date>`): the serial run commits each batch it keeps.
   Build everything first; a clean tree.
2. **Profile and annotate the build the proofs use** (here the bench build, `-Shift 256 -ShiftEnd
   -Define DEBUG_LIVES`), so addresses, cycles and annotations all describe the same image:
   ```
   PCPROF=build/grind/pc-seed1.json PERPASS=build/grind/pp-seed1.json node tools/pcprof.mjs BENCH.ssd --detail --passes 1500
   PCPROF=build/grind/pc-right.json PERPASS=build/grind/pp-right.json node tools/pcprof.mjs BENCH.ssd --detail --hold RIGHT --from 50 --passes 600
   python tools/analyse.py --listing BENCH.lst --symbols BENCH.symbols.json --disc BENCH.ssd annotate
   ```
   `annotate` must end `N instructions annotated` and its summary must not say `NOT sound`; if it
   stops on `isr_model: the config names sites the interrupt does not reach`, the interrupt's exits
   in `tools/dataflow_config.py` need updating (they are found by label: see its `_at`).
3. **Cut the windows:** `python tools/grind.py windows --profile build/grind/pc-seed1.json
   build/grind/pc-right.json` (`--offset 16` on alternate rounds, so a sequence cut in two by one
   round is whole in the next; `--all` to ignore seen.txt). It prints how many windows hold 50, 90
   and 99% of the cycles.
4. **Evaluate:** run the workflow with the windows to do (hottest first; a round can take a slice):
   `Workflow({scriptPath: ".claude/skills/beeb-micro-grind/evaluate.workflow.js", args: {round: N,
   windows: <entries of build/grind/windows.json>}})`. Each optimiser writes
   `build/grind/rN/opt-<window>.json`, each skeptic `skeptic-<window>-<i>-<lens>.json`.
5. **Record:** `python tools/grind.py add build/grind/rN` - every candidate into the ledger, approved
   (at least two skeptics heard, fewer than half refuting), refuted or unreviewed; the windows into
   seen.txt. Commit the ledger.
6. **Apply serially:** `python tools/grind.py run` (in the background: a gate is about half an
   hour). Best claim first, one candidate per region of a file in a batch of four: apply, gate,
   keep and commit if every check passes and neither game is slower and something is gained, else
   revert and bisect down to the candidate that fails. A candidate whose old text is gone (an
   earlier one changed it) is marked stale and its window comes back next round.
7. **Report** (`grind.py report`, then commit): candidates by status, what was kept and what it saved.
8. **Iterate:** re-profile and re-annotate the new build, cut the windows again (changed code has
   new hashes, so it is evaluated afresh; unchanged code is not), and go round. Stop when a round
   keeps nothing, twice running, or when told to.

## What an optimiser does

Reads its window file, then the source around it: at least 60 lines either side, every label in
or next to the window, and every reference to them anywhere in `src/` (grep). Proposes up to four
replacements for lines inside the window, best first, each as the exact source lines it replaces
(`old`, verbatim from `src/`, comments and all) and their replacement (`new`). Aggressive: the
annotations exist so that facts the code re-establishes can be used instead. What to look for:
- a flag already known (a `CLC` where `C=0` is shown, a `CMP #0` after a load), a register already
  holding the value, a load whose value is already in A, X or Y, a store nothing reads (`out:`);
- strength reduction, a table instead of arithmetic, arithmetic instead of a branch, a branch
  arranged so the hot path falls through, the hot path with the fewest taken branches;
- 65C02 instructions (STZ, BRA, PHX/PLX/PHY/PLY, TSB/TRB, INC A/DEC A, `(zp)` without Y, BIT #,
  BIT zp,X), self-modified immediates or operands in place of zero-page loads, loops unrolled or
  split where the bytes are there, work hoisted out of a loop, indexes counted down to zero;
- page crossings on indexed reads in hot loops.
Claims: cycles saved an execution on the hot path (count both paths if they differ), executions a
pass (the line's measured cycles ÷ its cycles an execution), their product, and bytes saved
(positive = smaller). The argument for equivalence covers every entry, every exit and everything
live after each. Nothing is better than a wrong candidate: return none if none is right.

## What a skeptic does

One lens each - **semantics** (every path in and out, every live register, flag and byte, the
interrupt, the stack), **the machine** (the 65SC12's real opcodes and cycle counts, page
crossings, branch ranges, self-modifying operands, code read as data, the assembler), **the
project** (the rules below, the free space, paths the proofs never reach). Two skeptics (semantics
and machine) for small claims, all three from 5 cycles a pass. Each reads the source itself, tries
to refute, and refutes when unsure. A skeptic's recount of cycles and bytes is kept with its vote.

## The rules

The project's `CLAUDE.md` rules hold (the original is the specification; measure, do not recall).
For a grind in particular:
- **Same behaviour on every path**, not only the ones the proofs run: the proofs (state and screen
  in lockstep with the control, the full-redraw oracle, helicopter flights, the front end) catch a
  lot, but the front end, define controls, game over, the completion screen and many collisions
  are run little or never. The skeptics' reasoning is the only check there.
- **Protected code is never changed** (`tools/grind_config.py` PROTECT, PROTECT_BYTES; marked in
  the window). Here: the interrupt's raster-timed palette writes (decision 22) and
  `wait_for_vsync_2242` (BUGS #5, timed from the vsync); the zero-page unpacker's bytes
  `&0004-&001C`, which the shipping build's ground texture reads as data (BUGS #1) - the proofs run
  on the `-Shift` builds, which read it elsewhere, so they would not see it change.
- **Generated sources are not hand-edited** (GENERATED): an improvement there is a change to the
  generator (`tools/compiled.py`, `tools/sprites.py`, ...), proposed and gated like any other but
  outside the window workflow.
- **No data moves, no new RAM.** Tables, workspace, zero page and the save arena stay as they are,
  and so does everything from `&3400` up in main RAM (BUGS #1, #2). A byte the annotations show
  dead may be reused as a temporary only if nothing else - the interrupt included - can read it
  in between, and the skeptics agree.
- **Self-modifying code** (`name = * + 1` labels; the disassembly's `actually` notes; stores to
  `label + 1` anywhere): the operand some code writes must still be where it writes it.
- **Paging.** Code in bank 4 runs with ROMSEL `&84` (ANDY in) or `&04`; compiled kinds with their own
  bank; with ACCCON's X bit set `&3000-&7FFF` is shadow RAM. New code must read and write the same
  RAM the old did in each state.
- **Each kept batch is a commit** with its ids, the checks it passed and the cycles it saved; the
  ledger is committed with it.

## Room

Where each source's code lives, and its free space at `6cc44ba` (2026-10-17; read the current
figure off the build's listing, the SKIP that pads the region):

| Source | Region | Free | Listing line |
|---|---|---|---|
| `game.6502`, `lib/keydown.6502` | main RAM, up to `&3400` | 31 | `SKIP unused_3400_original - *` |
| `game.6502` `moved_0a20` | `&0A20-&0AFF` | 86 | `&0AAA-&0AFF` (CLAUDE.md) |
| `render.6502` | bank 4, `&9000-&B3FF` | 102 | `SKIP PAD_END` in DATA1 |
| `render_zp.6502`, `prebuild.6502` | bank 4 under ANDY | 137 | `SKIP &9000 + PAD_START - *` |
| `bank5.6502`, `lib/sfx50.6502` | bank 5 | 424 | `SKIP PAD_END` in DATA2 |

A candidate that grows its region past the free space fails to assemble (the regions are
ASSERTed), and the gate reports it.

## The gate

`python tools/grind.py gate` (also what `run` calls): the control is HEAD, built in a worktree once
per commit (`build/grind/ctl-<commit>/`); the test is the working tree. Every build of
grind_config.BUILDS must assemble, then CHECKS run (at most 4 emulators at once): state and shown
screen identical to the control over 6,000 passes on seed 1 and 4,000 on seed 3, the test's
DEBUG_FULLREDRAW twin identical to it over 4,000 on seed 5, both helicopter flights with no frame
differing, and the front end's 15 checks. Then MEASURE: pcprof's work a pass (the wait for the
flip excluded) on seed 1 and holding RIGHT, against the control's - deterministic, so a difference
is exact. `gate --quick` runs seed 1 only, for trying something by hand.

## Reporting

After a round: windows evaluated, candidates by status (approved, refuted, unreviewed; then
accepted, failed, slower, stale), what was kept with its measured saving per batch, and what the
skeptics refuted most often (the next round's optimiser prompt can say so). Never add up claimed
savings as a result: only the gate's measurements count.
