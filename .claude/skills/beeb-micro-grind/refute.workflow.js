export const meta = {
  name: 'beeb-micro-grind-refute',
  description: 'The skeptics of an interrupted grind round: one agent per missing (candidate, lens), the candidate read from the round's opt-<window>.json on disk',
  whenToUse: 'Resuming evaluate.workflow.js after it died between the optimisers and the skeptics (or in another session, where resumeFromRunId cannot help): args = the output of `python tools/grind.py todo build/grind/rN`, {round, items}',
  phases: [
    { title: 'Refute', detail: 'a skeptic per missing lens, writing build/grind/r<round>/skeptic-<window>-<i>-<lens>.json as evaluate.workflow.js does' },
  ],
}

// The skeptics of evaluate.workflow.js, with the candidate read from disk (a workflow script has no
// file access, and 200 candidates are too big for args): the VERDICT schema and LENSES are copied
// from it verbatim, so `python tools/grind.py add build/grind/rN` sees no difference.
const ROUND = args.round
const DIR = `build/grind/r${ROUND}`

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    cycles_per_execution_recounted: { type: 'number' },
    bytes_recounted: { type: 'integer' },
    file_written: { type: 'string' },
  },
  required: ['refuted', 'reason', 'file_written'],
}

const LENSES = [
  ['semantics', 'Every path. Find each entry into the changed lines (labels, fall-through from above, branches and JMP/JSR from anywhere, address tables, label+N operand references, RTS-to-pushed-address tricks) and each exit. For each, compare old and new on every register, flag (N, Z, C, V, D) and memory byte that is live afterwards - the annotation\'s in:/out: lists say what is live, but check them against the code that follows. Interrupts: can the interrupt (irq1_handler and what it calls) run in between and see or change something differently? Stack depth and contents at every exit.'],
  ['machine', 'The 65SC12 as the Master 128 has it. Is every opcode and addressing mode real on that CPU (no BBR/BBS/RMB/SMB/WAI/STP; 65C02 timings: decimal-mode ADC/SBC +1, RMW abs,X)? Recount the cycles of old and new for every path with page crossings (+1 on indexed and (zp),Y reads that cross a page; writes do not take the +1 on 65C02, they always cost the full amount) and taken branches (+1, +1 more across a page), and the bytes. If the byte count changes, everything after it in the region moves: check in the listing (build/strykers.lst) whether a hot branch or indexed table read after it starts or stops crossing a page, and count that. Branch ranges. Self-modifying code: an operand that some other code writes (labels like name = * + 1, notes "actually", stores to label+1/+2 anywhere in src/) must stay where those writes put their bytes, with the same meaning. Code read as data. Baron syntax (65C02 opcodes need cmos = TRUE sections, which these are).'],
  ['project', 'This project\'s rules (CLAUDE.md, and SKILL.md "The rules"). Does it touch a PROTECTED line, a generated source, data or a table, raster-timed code, or memory whose meaning other code relies on (zero page is shared by many names: zp.6502; the renderer\'s scratch &C0-&CD is given back by restore_game_zp only where the logic reads)? Does it run with another bank paged (ROMSEL), with ANDY in, or with ACCCON\'s X bit set (then &3000-&7FFF reads shadow RAM), and does the new code still read and write the RAM the old did? Does it fit the free space of its region (SKILL.md "Room")? Does the game still play exactly as the original (rule 1): same state, same screen, same sound, on paths the scripted proofs never reach (the front end, a helicopter, game over, the completion screen, define controls)?'],
]

const refutePrompt = (it, lens, path) => `You are a skeptic in the beeb-micro-grind skill (read .claude/skills/beeb-micro-grind/SKILL.md, "What a skeptic does"). Your lens: ${lens[0]}. ${lens[1]}

The candidate is number ${it.i} (counting from 0) of the "candidates" array in ${DIR}/opt-${it.window}.json: read that file and take that element. Its "old" and "new" are the exact lines of ${it.file} (around line ${it.line}) it replaces and what replaces them, "claim" the cycles and bytes it says it saves, "equivalence" its argument that nothing else changes, "relies_on" what the argument assumes. The window file is build/grind/w/${it.window}.txt (the annotated lines; if it is gone, annotate again: tools/analyse.py annotate). The other candidates in that file are alternatives to it or independent of it; judge only this one.

Try to REFUTE it: find a path, a state or a count where it is wrong. Read the source yourself; do not trust the argument or the annotations without checking them. If you are not sure it is right, it is refuted. Write {"refuted": ..., "reason": "...", "cycles_per_execution_recounted": n, "bytes_recounted": n} to ${path}, then return the same object with file_written set.`

const jobs = []
for (const it of args.items) for (const name of it.lenses) jobs.push([it, LENSES.find(l => l[0] === name)])
log(`round ${ROUND}: ${args.items.length} candidates, ${jobs.length} skeptics to run`)

const votes = await pipeline(
  jobs,
  ([it, lens]) => agent(refutePrompt(it, lens, `${DIR}/skeptic-${it.window}-${it.i}-${lens[0]}.json`),
    { label: `refute ${lens[0]} ${it.file.replace('src/', '')}:${it.line}`, phase: 'Refute', schema: VERDICT }),
)
const done = votes.filter(Boolean)
log(`${done.length} of ${jobs.length} skeptics answered (${done.filter(v => v.refuted).length} refuted); the rest: run grind.py todo again`)
return { round: ROUND, asked: jobs.length, answered: done.length }
