import type { PaneModel } from '../../../hooks/core/types'
import { steeringPane } from './steering-pane'

/** The Steer field with the text the user has typed so far. */
export const draftPane: PaneModel = { ...steeringPane, steerDraft: 'run the full cycle only at the end of each phase' }
