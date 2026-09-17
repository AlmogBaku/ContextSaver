import type { PaneModel } from '../../../hooks/core/types'

/** A pane with two undecided wasters, newest first, and no decisions yet. */
export const twoWasters: PaneModel = {
  header: {
    percent: 64,
    spark: [11, 18, 24, 31, 39, 47, 55, 60, 64],
    tokensToCompaction: 41_000,
    turnsToCompaction: 6,
    judgeRuns: 2,
    judgeTokens: 7_400,
    judgeShare: 1.2,
    judgeRunning: false,
    savedPct: 3,
    savedMs: 180_000,
  },
  wasters: [
    {
      patternId: 'execution:full-suite',
      kind: 'Claude keeps running the whole bun test suite after every single-file edit',
      stats: '3× · ~9% context · 3m 12s · turns 5…8',
      why: 'ran in full 3× while only src/auth.ts changed between runs; the user asked for a fix, not full verification',
      fix: 'run only the tests covering the files you changed; run the full suite once when the phase is done',
      killText: 'Stop this behaviour for the rest of the session: Claude keeps running the whole bun test suite after every single-file edit. From now on: run only the tests covering the files you changed',
      evidence: [
        'r50 · t8 · bun test · 60s · 9.9k · 212 passed',
        'r45 · t7 · bun test · 59s · 9.6k · 212 passed',
        'r41 · t5 · bun test · 61s · 9.8k · 212 passed',
      ],
    },
    {
      patternId: 'reading:api-logs',
      kind: 'Claude keeps reading 2000 lines of api logs instead of grepping for the error',
      stats: '2× · ~20% context · turns 11…13',
      why: 'read the whole log twice when one grep would have shown the traceback',
      fix: "grep -nE 'ERROR|Traceback' and read only the 50 lines around the match",
      killText: 'Stop this behaviour for the rest of the session: Claude keeps reading 2000 lines of api logs. From now on: grep for the error and read only the lines around it',
      evidence: ['r61 · t13 · cat logs/api.log · 4s · 41k · GET /health 200'],
    },
  ],
  expanded: null,
  steering: null,
  steerDraft: null,
  decided: [],
  artifacts: [],
}
