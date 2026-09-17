import { median } from './text'
import type { Pattern, Row, State } from './types'

/** Returns the rows a pattern cites as evidence, in ledger order (turn handles and missing rows ignored). */
export const rowsOf = (state: State, p: Pattern): Row[] => {
  const ids = new Set(p.hits)
  return state.rows.filter(r => ids.has(r.id))
}

/** Returns the summed wall time and in-context chars of a pattern's evidence rows. */
export const costOf = (state: State, p: Pattern): { ms: number; chars: number } =>
  rowsOf(state, p).reduce((acc, r) => ({ ms: acc.ms + r.ms, chars: acc.chars + r.chars }), { ms: 0, chars: 0 })

/** Returns the median wall time and in-context chars of one occurrence of a pattern (0 when no rows). */
export const baseline = (state: State, p: Pattern): { ms: number; chars: number } => {
  const rows = rowsOf(state, p)
  return { ms: median(rows.map(r => r.ms)), chars: median(rows.map(r => r.chars)) }
}
