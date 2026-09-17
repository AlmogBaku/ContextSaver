/** One finding exactly as the judge writes it (row aliases, snake_case estimate); overrides win. */
export const rawFinding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'execution:full-suite-after-each-edit',
  category: 'execution',
  kind: 'Claude keeps running the whole bun test suite after every single-file edit',
  evidence: ['r3', 'r6'],
  signature: { tool: 'Bash', key: 'test:bun test' },
  why: 'r1 was the baseline; the suite then ran in full at turns 4 and 6 after edits to /src/auth.ts alone.',
  alternative: 'Run only the tests covering the files you changed, then the whole suite once when the phase is done.',
  confidence: 0.92,
  est_tokens_per_turn: null,
  proposal: null,
  ...over,
})
