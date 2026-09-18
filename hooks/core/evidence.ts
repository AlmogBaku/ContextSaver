import { median } from './text'
import { MAIN_AGENT, RECOVERED_FLAG, SINKS } from './types'
import type { Folded, Loop, Pattern, Row, Sink, Sinks, State } from './types'

/** Names every loop: `main` stays `main`, every agent id becomes `a1`, `a2`… — the rows' loops first in order of first appearance, then the loops the rows never showed, in their own order. */
export const agentAliases = (rows: readonly Pick<Row, 'agent'>[], loops: readonly Pick<Loop, 'id'>[] = []): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>([[MAIN_AGENT, MAIN_AGENT]])
  for (const id of [...rows.map(r => r.agent), ...loops.map(l => l.id)]) {
    if (!aliases.has(id)) aliases.set(id, `a${aliases.size}`)
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

/** The key one (tool, key) pair is counted under, in the state's folds and in the blocks' aggregates alike. */
export const pairKey = (r: Pick<Row, 'tool' | 'key'>): string => `${r.tool}\t${r.key}`

// One dropped row on its pair's fold: the first row folded names the loop, and the flags that are figures are counted.
const folding = (fold: Folded | undefined, row: Row): Folded => {
  const flag = (name: string): number => (row.flags.includes(name) ? 1 : 0)
  return {
    tool: row.tool, key: row.key, cls: row.cls, agent: fold?.agent ?? row.agent,
    count: (fold?.count ?? 0) + 1, ms: (fold?.ms ?? 0) + row.ms, chars: (fold?.chars ?? 0) + row.chars,
    firstTurn: Math.min(fold?.firstTurn ?? row.turn, row.turn),
    lastTurn: Math.max(fold?.lastTurn ?? row.turn, row.turn),
    flags: {
      ask: (fold?.flags.ask ?? 0) + flag('ask'),
      recommended: (fold?.flags.recommended ?? 0) + flag('recommended'),
      err: (fold?.flags.err ?? 0) + flag('err'),
    },
  }
}

/** The rows the ledger cap dropped, folded onto their pairs: no id survives the drop, every count does. */
export const foldRows = (folded: Readonly<Record<string, Folded>>, dropped: readonly Row[]): Record<string, Folded> =>
  dropped.reduce<Record<string, Folded>>((all, row) => ({ ...all, [pairKey(row)]: folding(all[pairKey(row)], row) }), { ...folded })

// The job a Bash command did, named by its class; a class with no name of its own is just a command.
const BASH_SINKS: Readonly<Record<string, string>> = {
  test: 'tests', git: 'git', build: 'builds', install: 'installs', search: 'searches', read: 'reads',
}

/** The sink a spawn row is named by: it holds its own loop's rows, so it is listed apart and never added in. */
export const SPAWN_SINK = 'agents'

// The job a tool does, whatever it was asked to do it to; a tool not listed here answers under its own name.
const TOOL_SINKS: Readonly<Record<string, string>> = {
  Read: 'reads', Grep: 'searches', Glob: 'searches', Edit: 'edits', Write: 'edits', Agent: SPAWN_SINK, Workflow: SPAWN_SINK,
}

// What a row, or a fold of rows the cap dropped, did: the two carry the same two cells the sink is read from.
type Job = Pick<Row, 'tool' | 'cls'>

const sinkOf = (r: Job): string =>
  r.tool === 'Bash' ? (BASH_SINKS[r.cls] ?? 'commands') : (TOOL_SINKS[r.tool] ?? r.tool)

// A spawn row's cost is its own loop's rows over again, so it is named beside them and never added to them.
const isSpawn = (r: Job): boolean => sinkOf(r) === SPAWN_SINK

const amountOf = (r: Row, measure: 'ms' | 'chars'): number =>
  measure === 'chars' ? r.chars : timed(r) ? r.ms : 0

const byAmount = (a: Sink, b: Sink): number =>
  b.amount - a.amount || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)

// The loops' own wall time is the spawn sink once loops are known: a Workflow row's 50 ms is the launch, not
// the run, and an Agent row's ms is the wait for a loop whose time the loop itself now states.
const loopsSink = (loops: readonly Loop[]): Sink =>
  ({ label: SPAWN_SINK, amount: loops.reduce((ms, l) => ms + l.ms, 0), count: loops.length })

/** Where the wall time (`ms`) or the context (`chars`) went: the total, and the SINKS largest named consumers; with loops given, the spawn sink's time is theirs, and the folds count wherever their rows would have. */
export const sinks = (rows: readonly Row[], measure: 'ms' | 'chars', loops: readonly Loop[] = [], folded: Readonly<Record<string, Folded>> = {}): Sinks => {
  const named = new Map<string, Sink>()
  let total = 0
  const spend = (job: Job, amount: number, count: number): void => {
    const label = sinkOf(job)
    const seen = named.get(label)
    named.set(label, { label, amount: (seen?.amount ?? 0) + amount, count: (seen?.count ?? 0) + count })
    if (!isSpawn(job)) total += amount
  }
  for (const r of rows) spend(r, amountOf(r, measure), 1)
  // The rows past the cap are gone and their cost is not: a long session's total is the folds plus the rows.
  for (const f of Object.values(folded)) spend(f, measure === 'chars' ? f.chars : f.ms, f.count)
  if (measure === 'ms' && loops.length > 0) named.set(SPAWN_SINK, loopsSink(loops))
  return { total, sinks: [...named.values()].sort(byAmount).slice(0, SINKS) }
}
