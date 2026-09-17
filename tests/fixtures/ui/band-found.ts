import type { BandModel } from '../../../hooks/core/types'

/** The band with two cards waiting: the teaser that says what they have already cost. */
export const bandFound: BandModel = {
  state: 'found',
  fresh: 2,
  costPct: 12,
  costMs: 3_060_000,
  savedPct: 0,
  savedMs: 0,
  calls: 312,
  paneOpen: false,
}
