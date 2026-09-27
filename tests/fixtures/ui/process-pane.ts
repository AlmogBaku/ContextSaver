import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** A process card newest, a habit waster behind it, and one habit fix that reached two subagents. */
export const processPane: PaneModel = {
  ...twoWasters,
  wasters: [
    {
      patternId: 'process:review-per-lane',
      n: 1,
      category: 'process',
      kind: 'Each lane runs Implement → Review → Fix before a whole-branch review',
      stats: '25m · 310k tokens',
      why: 'two lane reviews found what the branch review would have caught',
      fix: 'Change the remaining work: drop the per-lane review and fix rounds and keep the one branch review.',
      lean: 'Implement every lane, review the branch once, fix once',
      total: { unit: 'agents', calls: 3, ms: 1_500_000, chars: 0 },
      evidence: [],
    },
    ...twoWasters.wasters.slice(0, 1).map(card => ({ ...card, n: 2 })),
  ],
  decided: [
    {
      patternId: 'execution:full-suite',
      choice: 'kill',
      kind: 'running the whole suite after every edit',
      savedPct: 0,
      settled: false,
      instruction: null,
      ignored: 0,
      sent: 2,
    },
  ],
  artifacts: [],
}
