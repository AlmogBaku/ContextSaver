import type { PaneModel } from '../../../hooks/core/types'

/** A pane with two undecided wasters, newest first, and no decisions yet. */
export const twoWasters: PaneModel = {
  header: {
    percent: 64,
    tokensToCompaction: 41_000,
    turnsToCompaction: 6,
    trend: [],
    time: null,
    context: null,
    judgeTime: null,
    judgeContext: null,
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
      n: 1,
      category: 'execution',
      kind: 'Claude keeps running the whole bun test suite after every single-file edit',
      stats: '3× · ~9% of context · 3m 12s · turns 5–8',
      why: 'ran in full 3× while only src/auth.ts changed between runs; the user asked for a fix, not full verification',
      fix: 'run only the tests covering the files you changed; run the full suite once when the phase is done',
      total: { unit: 'calls', calls: 3, ms: 192_000, chars: 72_000 },
      evidence: [
        { turn: 8, what: 'bun test', agent: null, ms: 62_000, chars: 24_000, head: '212 pass · 0 fail · ran 1284 expect() calls in 61.98s' },
        { turn: 7, what: 'bun test', agent: 'a1', ms: 59_000, chars: 24_000, head: '212 pass · 0 fail' },
        { turn: 5, what: 'bun test', agent: null, ms: 71_000, chars: 24_000, head: '' },
      ],
    },
    {
      patternId: 'reading:api-logs',
      n: 2,
      category: 'reading',
      kind: 'Claude keeps reading 2000 lines of api logs instead of grepping for the error',
      stats: '2× · ~20% of context · 8s · turns 11–13',
      why: 'read the whole log twice when one grep would have shown the traceback',
      fix: "grep -nE 'ERROR|Traceback' and read only the 50 lines around the match",
      total: { unit: 'calls', calls: 2, ms: 8_000, chars: 160_000 },
      evidence: [
        { turn: 13, what: 'cat logs/api.log', agent: null, ms: 4_000, chars: 80_000, head: 'GET /health 200 12ms · GET /v1/users 200 41ms' },
      ],
    },
  ],
  expanded: null,
  steering: null,
  steerDraft: null,
  decided: [],
  artifacts: [],
}
