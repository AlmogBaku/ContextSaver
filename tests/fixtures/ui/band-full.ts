import type { BandModel } from '../../../hooks/core/types'

/** A band with every segment: context, compaction, fresh cards and savings. */
export const bandFull: BandModel = {
  percent: 29,
  tokensToCompaction: 133_000,
  fresh: 2,
  savedPct: 3,
  paneOpen: false,
  checking: false,
}
