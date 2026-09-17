import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The pane before the first turn has been measured: no percentage yet, one judge run behind it. */
export const awaitingPane: PaneModel = {
  ...twoWasters,
  header: {
    ...twoWasters.header,
    percent: null,
    tokensToCompaction: null,
    turnsToCompaction: null,
    trend: [],
    time: null,
    context: null,
    judgeTime: null,
    judgeContext: null,
    judgeRuns: 1,
  },
}
