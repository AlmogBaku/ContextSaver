import type { BandModel } from '../../../hooks/core/types'
import { bandFound } from './band-found'

/** A judge run in flight, which the band says with the pane closed. */
export const bandChecking: BandModel = { ...bandFound, state: 'checking' }
