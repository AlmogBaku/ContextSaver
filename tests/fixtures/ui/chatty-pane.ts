import { NO_CALLS } from '../../../hooks/core/types'
import type { PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

/** One behavioural waster with its details open: turns cited, no call to show, an estimate per turn. */
export const chattyPane: PaneModel = {
  ...twoWasters,
  wasters: [
    {
      patternId: 'communication:restates-plan-each-turn',
      n: 1,
      category: 'communication',
      kind: 'Claude keeps restating the plan in turns that make no tool call',
      stats: '2× · turns 14–15',
      why: 'turns 14 and 15 made no call and restated the plan already agreed',
      fix: 'State the result in one or two lines and take the next action; do not restate the plan.',
      total: { unit: 'turns', calls: 2, ms: 0, chars: 4_800 },
      evidence: [
        { turn: 15, what: NO_CALLS, agent: null, ms: 0, chars: 6_100, head: 'To recap the plan before I touch anything' },
        { turn: 14, what: NO_CALLS, agent: null, ms: 0, chars: 5_400, head: 'Here is the plan again' },
      ],
    },
  ],
  expanded: 'communication:restates-plan-each-turn',
}
