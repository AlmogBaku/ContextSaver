import { median } from './text'
import { MAIN_AGENT, RECOVERED_FLAG } from './types'
import type { Pattern, Row, State } from './types'

/** Names every loop in the rows: `main` stays `main`, every agent id becomes `a1`, `a2`… in order of first appearance. */
export const agentAliases = (rows: readonly Pick<Row, 'agent'>[]): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>([[MAIN_AGENT, MAIN_AGENT]])
  for (const row of rows) {
    if (!aliases.has(row.agent)) aliases.set(row.agent, `a${aliases.size}`)
  }
  return aliases
}

/** The alias a loop is named by, falling back to the raw id when the rows never showed it. */
export const aliasOf = (aliases: ReadonlyMap<string, string>, agent: string): string =>
  aliases.get(agent) ?? agent

/** Returns the rows a pattern cites as evidence, in ledger order (turn handles and missing rows ignored). */
export const rowsOf = (state: State, p: Pattern): Row[] => {
  const ids = new Set(p.hits)
  return state.rows.filter(r => ids.has(r.id))
}

/** Returns the summed wall time and in-context chars of the evidence rows handed in. */
export const sumOf = (rows: readonly Row[]): { ms: number; chars: number } =>
  rows.reduce((acc, r) => ({ ms: acc.ms + r.ms, chars: acc.chars + r.chars }), { ms: 0, chars: 0 })

// A rebuilt row's duration was never recorded (it reads 0), so counting it would drag the time median to nothing.
const timed = (r: Row): boolean => !r.flags.includes(RECOVERED_FLAG)

/** Returns the median wall time (timed rows only) and in-context chars of one occurrence of a pattern (0 when no rows). */
export const baseline = (state: State, p: Pattern): { ms: number; chars: number } => {
  const rows = rowsOf(state, p)
  return { ms: median(rows.filter(timed).map(r => r.ms)), chars: median(rows.map(r => r.chars)) }
}
