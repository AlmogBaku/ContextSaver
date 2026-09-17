import type { BandModel } from '../../../hooks/core/types'

/** Nothing found, nothing saved: the band counts the calls it is watching. */
export const bandWatching: BandModel = {
  state: 'watching',
  fresh: 0,
  costPct: 0,
  costMs: 0,
  savedPct: 0,
  savedMs: 0,
  calls: 312,
  paneOpen: false,
}
