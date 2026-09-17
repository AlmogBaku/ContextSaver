import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same session with the window filling: the gauge's fill has earned its warm tone. */
export const fillingPane: PaneModel = {
  ...twoWasters,
  header: { ...twoWasters.header, percent: 78, trend: [51, 58, 64, 71, 78], tokensToCompaction: 21_000, turnsToCompaction: 3 },
}
