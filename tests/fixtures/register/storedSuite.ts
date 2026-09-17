import type { StoredPattern } from '../../../hooks/core/types'

/** The registry one earlier session left in the store for /work: one killed full-suite pattern. */
export const storedSuite: StoredPattern = {
  id: 'execution:full-suite-after-each-edit',
  category: 'execution',
  kind: 'Claude keeps running the whole bun test suite after every single-file edit',
  signature: { tool: 'Bash', key: 'test:bun test' },
  why: 'the suite ran in full after each edit last session',
  alternative: 'Run only the tests covering the files you changed, then the whole suite once when the phase is done.',
  confidence: 0.9,
  proposal: null,
  estTokensPerTurn: null,
  lastDecision: 'kill',
}
