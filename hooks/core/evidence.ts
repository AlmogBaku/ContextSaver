import { median } from './text'
import { MAIN_AGENT, RECOVERED_FLAG, SINKS } from './types'
import type { Pattern, Row, Sink, Sinks, State } from './types'

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

// The job a Bash command did, named by its class; a class with no name of its own is just a command.
const BASH_SINKS: Readonly<Record<string, string>> = {
  test: 'tests', git: 'git', build: 'builds', install: 'installs', search: 'searches', read: 'reads',
}

/** The sink a spawn row is named by: it holds its own loop's rows, so it is listed apart and never added in. */
export const SPAWN_SINK = 'agents'

// The job a tool does, whatever it was asked to do it to; a tool not listed here answers under its own name.
const TOOL_SINKS: Readonly<Record<string, string>> = {
  Read: 'reads', Grep: 'searches', Glob: 'searches', Edit: 'edits', Write: 'edits', Agent: SPAWN_SINK,
}

const sinkOf = (r: Row): string =>
  r.tool === 'Bash' ? (BASH_SINKS[r.cls] ?? 'commands') : (TOOL_SINKS[r.tool] ?? r.tool)

// A spawn row's cost is its own loop's rows over again, so it is named beside them and never added to them.
const isSpawn = (r: Row): boolean => r.tool === 'Agent'

const amountOf = (r: Row, measure: 'ms' | 'chars'): number =>
  measure === 'chars' ? r.chars : timed(r) ? r.ms : 0

const byAmount = (a: Sink, b: Sink): number =>
  b.amount - a.amount || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)

/** Where the wall time (`ms`) or the context (`chars`) went: the total, and the SINKS largest named consumers. */
export const sinks = (rows: readonly Row[], measure: 'ms' | 'chars'): Sinks => {
  const named = new Map<string, Sink>()
  let total = 0
  for (const r of rows) {
    const label = sinkOf(r)
    const seen = named.get(label)
    const amount = amountOf(r, measure)
    named.set(label, { label, amount: (seen?.amount ?? 0) + amount, count: (seen?.count ?? 0) + 1 })
    if (!isSpawn(r)) total += amount
  }
  return { total, sinks: [...named.values()].sort(byAmount).slice(0, SINKS) }
}
