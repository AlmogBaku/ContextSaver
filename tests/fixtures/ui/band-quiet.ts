import type { BandModel } from '../../../hooks/core/types'

/** A band with nothing to report and the pane open. */
export const bandQuiet: BandModel = {
  percent: null,
  tokensToCompaction: null,
  fresh: 0,
  savedPct: 0,
  paneOpen: true,
  checking: false,
}
