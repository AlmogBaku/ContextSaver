import type { Pattern } from '../../../hooks/core/types'

/** Builds a pattern with the given overrides on top of an undecided full-suite waster. */
export const rulePattern = (over: Partial<Pattern>): Pattern => ({
  id: 'execution:full-suite-after-each-edit',
  category: 'execution',
  kind: 'Claude keeps running the whole bun test suite after every single-file edit',
  signature: { tool: 'Bash', key: 'test:bun test' },
  why: 'the suite ran in full while only src/auth.ts changed between runs',
  alternative: 'Run only the tests covering the files you changed, then the whole suite once when the phase is done.',
  confidence: 0.92,
  proposal: null,
  estTokensPerTurn: null,
  lastDecision: null,
  hits: ['t1', 't2'],
  decision: null,
  decidedAtTurn: null,
  instruction: null,
  openedAtTurn: null,
  ignored: 0,
  ...over,
})
