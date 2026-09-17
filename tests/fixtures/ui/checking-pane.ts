import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same two wasters while the judge is running. */
export const checkingPane: PaneModel = {
  ...twoWasters,
  header: { ...twoWasters.header, judgeRunning: true },
}
