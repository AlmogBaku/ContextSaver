import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same session past the compaction threshold, its savings counted in time only. */
export const overrunPane: PaneModel = {
  ...twoWasters,
  header: { ...twoWasters.header, tokensToCompaction: -3_000, turnsToCompaction: 0, savedPct: 0, savedMs: 180_000 },
}
