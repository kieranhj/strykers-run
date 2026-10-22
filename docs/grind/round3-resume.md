# Grind round 3: where it stopped, and how to finish it

Written 2026-10-22 (about 19:15). Branch `grind-2026-10-22`. The evaluation (`evaluate.workflow.js`)
died at about 18:48 when the API connection dropped (the laptop was closed): 551 of its 654 agents
failed with `SSL certificate verification failed`. Nothing was applied; `src/` is untouched, so
every candidate's `old` text still matches. Delete this file when the round is recorded.

## State on disk (`build/grind/`, gitignored: do not clean it until `grind.py add` has run)

| What | Where | Count |
|---|---|---|
| The bench build the windows, profiles and annotations describe | `build/strykers-debug_lives.{ssd,lst,symbols.json}` (HEAD `ff62e12`'s sources) | |
| Profiles | `pc-seed1.json`, `pc-right.json` (+ `pp-*`) | |
| Annotations | `build/annotated/` | 12,911 instructions |
| The round's 89 windows (the hottest, 90% of the cycles) | `docs/grind/r3-windows.json` (committed), window files `build/grind/w/<id>.txt` | 89 |
| Optimisers' results | `build/grind/r3/opt-<window>.json` | 84 of 89 |
| Candidates in them | | 200 |
| Skeptics' verdicts | `build/grind/r3/skeptic-<window>-<i>-<lens>.json` | 19 of 565 wanted |
| Not yet optimised | `402e312ea06a`, `4edc2133499f`, `76cfc1399db0`, `ba449511bac7`, `b3a92e305443` | 5 |

Gate: the unchanged tree passed all 7 checks against itself on 2026-10-22 with the bench build
`-Define DEBUG_LIVES` (the shift builds no longer fit bank 5; `tools/grind_config.py`). Baseline work
a pass: **34,422.4** (seed 1), **39,622.9** (holding RIGHT).

If a source changed since (`git log ff62e12..HEAD -- src/`), the windows, profiles and annotations are
stale: candidates whose `old` text is gone come back `stale` at apply time and their windows are
re-evaluated next round. BUGS #14 and docs do not matter.

## To finish

Cost: 546 skeptic agents (the lens rule: three from 5 cycles a pass, else semantics and machine) and
the five optimisers with their own skeptics: roughly 550-600 agents, about 2-3 hours at the rate seen
(16 at a time).

1. **Same session as the dead run** (`wf_1d2afcbf-882`): the quick way is
   `Workflow({scriptPath: ".claude/skills/beeb-micro-grind/evaluate.workflow.js", resumeFromRunId: "wf_1d2afcbf-882", args: <the same args>})`:
   the 103 agents that finished replay from cache and the failed ones run again. Its args are the
   89 entries of `docs/grind/r3-windows.json` as `{round: 3, windows: [...]}`.
2. **Any other session** (a resume cannot cross sessions): the skeptics read each candidate from its
   `opt-*.json`, so nothing needs the old run.
   ```
   python tools/grind.py todo build/grind/r3 --windows docs/grind/r3-windows.json > build/grind/r3-todo.json
   ```
   prints `{round, items, windows}`: `items` the candidates short of skeptic files (window, i, file,
   line, lenses missing), `windows` the optimisers that have not written a file. Then
   - `Workflow({scriptPath: ".claude/skills/beeb-micro-grind/refute.workflow.js", args: {round: 3, items: <items>}})`
   - `Workflow({scriptPath: ".claude/skills/beeb-micro-grind/evaluate.workflow.js", args: {round: 3, windows: <windows>}})`
     for the five missing windows (their skeptics are included).

   Run `todo` again afterwards: an empty `items` and `windows` means the round is complete; anything
   left is a skeptic that failed, and the same command asks for it again.
3. **Record:** `python tools/grind.py add build/grind/r3`, commit `docs/grind/`. (`add` reads the files,
   not the workflow's result, so it takes a partly finished round too: a candidate with fewer than
   two skeptics heard is `unreviewed`, and is left out of the queue.)
4. **Apply:** `python tools/grind.py run` in the background (about half an hour a batch of four; refuses
   to run on main). Then `grind.py report`, commit, and re-profile for the next round (the skill's step 8;
   `windows --offset 16` on alternate rounds).

## Notes from this round

- One optimiser, `62cecb5f4a40` (`src/game.6502:3540`, the collision search's right-of-range test, high
  byte first), claims 313 cycles a pass and 4 bytes more code, and says it measured 303 / 286 on a copy
  of the bench build. Check that against the gate's number, not its own.
- The cold windows (225 of 314, 10% of the cycles) are not in this round.
- The workflow's concurrency is capped at 16 agents; a closed laptop kills the connection, not the
  files already written.
