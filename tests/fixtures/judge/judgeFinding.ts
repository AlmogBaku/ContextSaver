import type { Finding } from '../../../hooks/core/types'

/** A validated finding citing two ledger rows by tool_use_id; overrides win. */
export const judgeFinding = (over: Partial<Finding> = {}): Finding => ({
  id: 'execution:full-suite-after-each-edit',
  category: 'execution',
  kind: 'Claude keeps running the whole bun test suite after every single-file edit',
  evidence: ['toolu_03', 'toolu_06'],
  signature: { tool: 'Bash', key: 'test:bun test' },
  why: 'the suite ran in full at turns 4 and 6 after single-file edits',
  alternative: 'Run only the tests covering the files you changed, then the whole suite once per phase.',
  confidence: 0.92,
  estTokensPerTurn: null,
  proposal: null,
  ...over,
})
