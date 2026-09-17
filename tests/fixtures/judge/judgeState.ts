import { initialState } from '../../../hooks/core/types'
import type { State } from '../../../hooks/core/types'
import { rows } from './rows'
import { turns } from './turns'

/** A session at turn 7 with the ledger and turn fixtures loaded; overrides win. */
export const judgeState = (over: Partial<State> = {}): State => ({
  ...initialState('/work', 200_000),
  turn: 7,
  seq: rows.length,
  rows,
  turns,
  overhead: { memory: 1200, mcp: 3400, agents: 800 },
  ...over,
})
