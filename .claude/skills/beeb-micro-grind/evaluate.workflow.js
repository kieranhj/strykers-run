export const meta = {
  name: 'beeb-micro-grind-evaluate',
  description: 'One optimiser per window of annotated 6502 proposes faster or smaller code; 2-3 skeptics with different lenses try to refute each proposal',
  whenToUse: 'The evaluation step of the beeb-micro-grind skill: args {round, windows: build/grind/windows.json entries}',
  phases: [
    { title: 'Optimise', detail: 'one agent per window (two for cold ones): candidates, each written to build/grind/r<round>/' },
    { title: 'Refute', detail: 'skeptics per candidate: semantics, the machine, the project; majority must fail to refute' },
  ],
}

const ROUND = args.round
const DIR = `build/grind/r${ROUND}`
const wins = args.windows
// hot windows alone, cold ones in pairs (they are mostly for bytes)
const batches = []
for (let i = 0; i < wins.length;) {
  const n = wins[i].heat >= (args.pairBelow ?? 20) ? 1 : 2
  batches.push(wins.slice(i, i + n))
  i += n
}
log(`round ${ROUND}: ${wins.length} windows in ${batches.length} optimiser agents`)

const CAND = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          window: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          old: { type: 'string' },
          new: { type: 'string' },
          summary: { type: 'string' },
          claim: {
            type: 'object',
            properties: {
              cycles_per_execution: { type: 'number' },
              executions_a_pass: { type: 'number' },
              cycles_a_pass: { type: 'number' },
              bytes: { type: 'integer' },
            },
            required: ['cycles_per_execution', 'executions_a_pass', 'cycles_a_pass', 'bytes'],
          },
          equivalence: { type: 'string' },
          relies_on: { type: 'string' },
          file_written: { type: 'string' },
        },
        required: ['window', 'file', 'line', 'old', 'new', 'summary', 'claim', 'equivalence', 'relies_on', 'file_written'],
      },
    },
  },
  required: ['candidates'],
}
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

const optimisePrompt = (batch, k) => `You are one optimiser in the beeb-micro-grind skill's evaluation (read .claude/skills/beeb-micro-grind/SKILL.md, "What an optimiser does" and "The rules", before anything else - they are your instructions).

Your window${batch.length > 1 ? 's' : ''}: ${batch.map(w => `${w.path} (${w.file} lines ${w.first}-${w.last}, ${w.heat} cycles a pass measured)`).join('; ')}.

Read each window file, then the source around it (${batch.map(w => w.file).join(', ')}: at least 60 lines either side, every label the window defines or branches to, and every place the source refers to those labels). Find faster or smaller code for the lines inside the window, and only those lines (lines marked PROTECTED never change). Be aggressive and exact: every cycle and byte counted for the 65SC12, every path into and out of the code accounted for.

Write your candidates (possibly none) as JSON {"candidates": [...]} to ${DIR}/opt-${batch[0].id}.json, each candidate's fields as the schema below, "window" its window id; then return the same object. "old" is the exact contiguous lines of the SOURCE file (src/..., not the annotated copy), whitespace and comments included, so that it can be found and replaced verbatim; "new" replaces them. Up to 4 candidates a window, the best first; overlapping candidates are alternatives, and say so in their summaries.`

const LENSES = [
  ['semantics', 'Every path. Find each entry into the changed lines (labels, fall-through from above, branches and JMP/JSR from anywhere, address tables, label+N operand references, RTS-to-pushed-address tricks) and each exit. For each, compare old and new on every register, flag (N, Z, C, V, D) and memory byte that is live afterwards - the annotation\'s in:/out: lists say what is live, but check them against the code that follows. Interrupts: can the interrupt (irq1_handler and what it calls) run in between and see or change something differently? Stack depth and contents at every exit.'],
  ['machine', 'The 65SC12 as the Master 128 has it. Is every opcode and addressing mode real on that CPU (no BBR/BBS/RMB/SMB/WAI/STP; 65C02 timings: decimal-mode ADC/SBC +1, RMW abs,X)? Recount the cycles of old and new for every path with page crossings (+1 on indexed and (zp),Y reads that cross a page; writes do not take the +1 on 65C02, they always cost the full amount) and taken branches (+1, +1 more across a page), and the bytes. Branch ranges. Self-modifying code: an operand that some other code writes (labels like name = * + 1, notes "actually", stores to label+1/+2 anywhere in src/) must stay where those writes put their bytes, with the same meaning. Code read as data. Baron syntax (65C02 opcodes need cmos = TRUE sections, which these are).'],
  ['project', 'This project\'s rules (CLAUDE.md, and SKILL.md "The rules"). Does it touch a PROTECTED line, a generated source, data or a table, raster-timed code, or memory whose meaning other code relies on (zero page is shared by many names: zp.6502; the renderer\'s scratch &C0-&CD is given back by restore_game_zp only where the logic reads)? Does it run with another bank paged (ROMSEL), with ANDY in, or with ACCCON\'s X bit set (then &3000-&7FFF reads shadow RAM), and does the new code still read and write the RAM the old did? Does it fit the free space of its region (SKILL.md "Room")? Does the game still play exactly as the original (rule 1): same state, same screen, same sound, on paths the scripted proofs never reach (the front end, a helicopter, game over, the completion screen, define controls)?'],
]
const refutePrompt = (c, lens, path) => `You are a skeptic in the beeb-micro-grind skill (read .claude/skills/beeb-micro-grind/SKILL.md, "What a skeptic does"). Your lens: ${lens[0]}. ${lens[1]}

The candidate, in ${c.file} at line ${c.line} (window file build/grind/w/${c.window}.txt):
--- old
${c.old}
--- new
${c.new}
---
Its claim: ${JSON.stringify(c.claim)}. Its argument: ${c.equivalence} It relies on: ${c.relies_on}

Try to REFUTE it: find a path, a state or a count where it is wrong. Read the source yourself; do not trust the argument or the annotations without checking them. If you are not sure it is right, it is refuted. Write {"refuted": ..., "reason": "...", "cycles_per_execution_recounted": n, "bytes_recounted": n} to ${path}, then return the same object with file_written set.`

const results = await pipeline(
  batches,
  (batch, _b, k) => agent(optimisePrompt(batch, k), { label: `opt ${batch[0].file.replace('src/', '')}:${batch[0].first}`, phase: 'Optimise', schema: CAND }),
  (res, batch) => {
    const cands = (res?.candidates ?? []).slice(0, 4 * batch.length)
    return parallel(cands.map((c, i) => () => {
      const lenses = (c.claim?.cycles_a_pass ?? 0) >= (args.threeSkepticsFrom ?? 5) ? LENSES : [LENSES[0], LENSES[1]]
      return parallel(lenses.map(lens => () => agent(
        refutePrompt(c, lens, `${DIR}/skeptic-${c.window}-${i}-${lens[0]}.json`),
        { label: `refute ${lens[0]} ${c.file.replace('src/', '')}:${c.line}`, phase: 'Refute', schema: VERDICT })))
        .then(votes => ({ ...c, skeptics: votes.filter(Boolean).map((v, j) => ({ lens: lenses[j][0], ...v })) }))
    }))
  },
)
const all = results.filter(Boolean).flat().filter(Boolean)
const kept = all.filter(c => c.skeptics.filter(v => v.refuted).length * 2 < c.skeptics.length)
log(`${all.length} candidates, ${kept.length} survive their skeptics`)
return { round: ROUND, windows: wins.map(w => w.id), candidates: all }
