import { initialState } from '../../../hooks/core/types'
import type { Pattern, State } from '../../../hooks/core/types'
import { ruleRows } from './rows'

/** Builds a session state in /repo with a 200k window, the fixture rows and the given patterns. */
export const ruleState = (patterns: Pattern[]): State => ({
  ...initialState('/repo', 200_000),
  rows: ruleRows,
  turn: 14,
  patterns,
})
