import type { Pattern } from '../../../hooks/core/types'

/** A signature pattern: the whole test suite after every edit. */
export const suitePattern: Pattern = {
  id: 'execution:full-suite-after-each-edit',
  category: 'execution',
  kind: 'Claude keeps running the whole bun test suite after every single-file edit',
  signature: { tool: 'Bash', key: 'test:bun test' },
  why: 'the suite ran in full at turns 5 and 8 after single-file edits to one file',
  alternative: 'Run only the test files covering the files you changed, then the whole suite once when the phase is done.',
  confidence: 0.92,
  proposal: { kind: 'claude-md', title: 'Targeted tests', body: 'Run only the tests covering the files you changed.' },
  estTokensPerTurn: null,
  lastDecision: null,
  hits: [],
  decision: null,
  decidedAtTurn: null,
  instruction: null,
  openedAtTurn: null,
  ignored: 0,
}
