import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same two wasters with the newest one's Fix… field open and empty of a draft. */
export const steeringPane: PaneModel = { ...twoWasters, steering: 'execution:full-suite' }
