import type { PaneModel } from '../../../hooks/core/types'

/** A pane with nothing repeating yet: the header, and the empty state beneath it. */
export const emptyPane: PaneModel = {
  header: {
    percent: 12,
    tokensToCompaction: null,
    turnsToCompaction: null,
    trend: [],
    time: null,
    context: null,
    judgeTime: null,
    judgeContext: null,
    judgeRuns: 0,
    judgeTokens: 0,
    judgeShare: 0,
    judgeRunning: false,
    savedPct: 0,
    savedMs: 0,
  },
  wasters: [],
  expanded: null,
  steering: null,
  steerDraft: null,
  decided: [],
  artifacts: [],
}
