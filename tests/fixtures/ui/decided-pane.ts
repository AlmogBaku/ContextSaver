import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The two wasters with one settled steer behind them, one ignored kill, and one rule proposed. */
export const decidedPane: PaneModel = {
  ...twoWasters,
  decided: [
    {
      patternId: 'reading:re-read',
      choice: 'steer',
      kind: 're-reading src/auth.ts',
      savedPct: 1,
      settled: true,
      instruction: 'read src/auth.ts once and keep the summary',
      ignored: 0,
    },
    {
      patternId: 'process:plan-resummary',
      choice: 'kill',
      kind: 're-summarising the plan every turn',
      savedPct: 0,
      settled: false,
      instruction: null,
      ignored: 1,
    },
  ],
  artifacts: [
    {
      patternId: 'reading:re-read',
      kind: 'claude-md',
      title: 'Re-read only after edits',
      path: '/work/CLAUDE.md',
      content: '- Re-read a file only after you edited it.',
      savingPct: 1,
      mode: 'append',
    },
  ],
}
