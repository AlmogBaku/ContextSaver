import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same session about to compact: the gauge's fill is hot and the judge is mid-run. */
export const fullPane: PaneModel = {
  ...twoWasters,
  header: { ...twoWasters.header, percent: 94, trend: [71, 78, 84, 89, 94], tokensToCompaction: 4_000, turnsToCompaction: 1, judgeRunning: true },
}
