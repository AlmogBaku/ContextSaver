import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same session in a one-million-token window, where the compaction figure is a six-character number. */
export const millionPane: PaneModel = {
  ...twoWasters,
  header: {
    ...twoWasters.header,
    percent: 5,
    spark: [1, 2, 3, 5],
    tokensToCompaction: 914_000,
    turnsToCompaction: 33,
    savedPct: 0,
    savedMs: 0,
  },
}
