import type { Pattern } from '../../../hooks/core/types'

/** A known pattern for the full-suite behaviour; overrides win. */
export const judgePattern = (over: Partial<Pattern> = {}): Pattern => ({
  id: 'execution:full-suite-after-each-edit',
  category: 'execution',
  kind: 'Claude keeps running the whole bun test suite after every single-file edit',
  signature: { tool: 'Bash', key: 'test:bun test' },
  why: 'the suite ran in full at turns 2, 4 and 6',
  alternative: 'Run only the tests covering the files you changed, then the whole suite once per phase.',
  confidence: 0.9,
  proposal: null,
  estTokensPerTurn: null,
  lastDecision: null,
  hits: ['toolu_01'],
  decision: null,
  decidedAtTurn: null,
  instruction: null,
  openedAtTurn: null,
  ignored: 0,
  ...over,
})
