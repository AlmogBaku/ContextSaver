import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same session before the judge's first run: the two budgets are measured, nothing is said about them. */
export const quietPane: PaneModel = {
  ...twoWasters,
  header: { ...twoWasters.header, judgeTime: null, judgeContext: null, judgeRuns: 0, judgeTokens: 0, judgeShare: 0 },
}
