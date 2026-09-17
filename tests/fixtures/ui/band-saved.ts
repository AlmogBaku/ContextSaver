import type { BandModel } from '../../../hooks/core/types'

/** Nothing waiting and a saving credited: the band shows off what the session got back. */
export const bandSaved: BandModel = {
  state: 'saved',
  fresh: 0,
  costPct: 0,
  costMs: 0,
  savedPct: 24,
  savedMs: 2_700_000,
  calls: 312,
  paneOpen: true,
}
