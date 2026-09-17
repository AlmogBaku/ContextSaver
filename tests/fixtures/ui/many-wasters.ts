import type { Card, PaneModel } from '../../../hooks/core/types'
import { twoWasters } from './two-wasters'

// One waster, repeated into every seat: what the seat wears is all this fixture is about.
const seated: Card = {
  patternId: 'execution:recheck',
  n: 1,
  category: 'execution',
  kind: 'Claude keeps re-running the type-check with nothing changed since the last one',
  stats: '2× · ~2% of context · 6s · turns 15–17',
  why: 'the check ran twice in a row with no edited path between the two runs',
  fix: 'run a check again only after editing what it covers',
  total: { unit: 'calls', calls: 2, ms: 6_000, chars: 16_000 },
  evidence: [
    { turn: 17, what: 'bunx tsc --noEmit', agent: null, ms: 3_000, chars: 8_000, head: 'Found 0 errors.' },
    { turn: 15, what: 'bunx tsc --noEmit', agent: null, ms: 3_000, chars: 8_000, head: 'Found 0 errors.' },
  ],
}

/** Twelve live wasters: the seats past nine wear two digits, and the inline pane folds the rest. */
export const manyWasters: PaneModel = {
  ...twoWasters,
  wasters: Array.from({ length: 12 }, (_, at) => ({ ...seated, patternId: `${seated.patternId}-${at + 1}`, n: at + 1 })),
}
