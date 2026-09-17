import type { BandModel } from '../../../hooks/core/types'
import { bandFull } from './band-full'

/** The band while a judge run is in flight, which it says with the pane closed. */
export const bandChecking: BandModel = { ...bandFull, checking: true }
