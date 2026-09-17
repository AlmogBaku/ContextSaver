import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** The same two wasters with the newest one's details open behind i. */
export const expandedPane: PaneModel = { ...twoWasters, expanded: 'execution:full-suite' }
