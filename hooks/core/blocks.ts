import { agentAliases, aliasOf, sinks } from './evidence'
import { median } from './text'
import { JUDGE_LEDGER_ROWS } from './types'
import type { CommandClass, Row, Sink, State, TurnStat } from './types'

// What one of the two blocks measures: wall time in milliseconds, or in-context size in characters.
type Measure = 'ms' | 'chars'

/** One (tool, key) pair aggregated over the whole session. */
export type KeyStat = {
  tool: string
  key: string
  cls: CommandClass
  count: number
  ms: number
  chars: number
  firstTurn: number
  lastTurn: number
  agents: string[]
  editsBetween: number | null
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

const unique = (xs: string[]): string[] => [...new Set(xs)]

const pairOf = (r: Row): string => `${r.tool}\t${r.key}`

const distinctPaths = (rows: Row[]): number => new Set(rows.flatMap(r => r.paths)).size

// One pass, so neither statOf nor editsBetween rescans the ledger per pair.
const byPair = (rows: Row[]): Map<string, Row[]> => {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const group = groups.get(pairOf(row))
    if (group === undefined) groups.set(pairOf(row), [row])
    else group.push(row)
  }
  return groups
}

const positions = (rows: Row[]): Map<Row, number> => new Map(rows.map((row, i) => [row, i]))

const editsBetween = (rows: Row[], at: Map<Row, number>, hits: Row[]): number | null => {
  if (hits.length < 2) return null
  const idx = hits.map(h => at.get(h) ?? 0)
  return median(idx.slice(1).map((end, i) => distinctPaths(rows.slice((idx[i] ?? 0) + 1, end))))
}

const statOf = (rows: Row[], at: Map<Row, number>, hits: Row[]): KeyStat => {
  const first = hits[0]
  const turns = hits.map(r => r.turn)
  return {
    tool: first?.tool ?? '',
    key: first?.key ?? '',
    cls: first?.cls ?? 'other',
    count: hits.length,
    ms: sum(hits.map(r => r.ms)),
    chars: sum(hits.map(r => r.chars)),
    firstTurn: Math.min(...turns),
    lastTurn: Math.max(...turns),
    agents: unique(hits.map(r => r.agent)),
    editsBetween: editsBetween(rows, at, hits),
  }
}

/** Aggregates rows into one KeyStat per (tool, key), costliest in chars first. */
export const aggregate = (rows: Row[]): KeyStat[] => {
  const at = positions(rows)
  return [...byPair(rows).values()]
    .map(hits => statOf(rows, at, hits))
    .sort((a, b) => b.chars - a.chars)
}

const spawnFlag = (s: NonNullable<Row['spawn']>): string =>
  `agent=${s.type}/${s.resolved ?? s.requested ?? '?'}/${s.status ?? '?'}/${s.tokens ?? '?'}tok/${s.edits ?? '?'}edits/${s.promptChars}pch`

const flagsCell = (row: Row): string => {
  const cells = [
    ...row.flags,
    ...(row.lines !== null ? [`+${row.lines.add}/-${row.lines.del}`] : []),
    ...(row.spawn !== null ? [spawnFlag(row.spawn)] : []),
  ]
  return cells.length > 0 ? cells.join(' ') : '-'
}

const pathsCell = (paths: string[]): string => (paths.length > 0 ? paths.slice(0, 3).join(' ') : '-')

/** Renders one ledger row: r<seq> | tool | key | cls | agent alias | turn | ms | chars | flags | paths. */
export const ledgerLine = (row: Row, aliases: ReadonlyMap<string, string>): string =>
  [
    `r${row.seq}`, row.tool, row.key, row.cls, aliasOf(aliases, row.agent),
    `${row.turn}`, `${row.ms}`, `${row.chars}`, flagsCell(row), pathsCell(row.paths),
  ].join(' | ')

/** Renders a folded history line for rows older than the ledger window. */
export const summaryLine = (tool: string, key: string, count: number, chars: number): string =>
  `~ | ${tool} | ${key} | ×${count} | Σ${chars}ch`

const keyStatLine = (s: KeyStat, aliases: ReadonlyMap<string, string>): string =>
  [
    s.tool, s.key, s.cls, `×${s.count}`, `Σ${s.ms}ms`, `Σ${s.chars}ch`,
    `turns ${s.firstTurn}-${s.lastTurn}`, `edits-between ${s.editsBetween ?? '-'}`,
    s.agents.map(agent => aliasOf(aliases, agent)).join(' '),
  ].join(' | ')

const groupLines = (rows: Row[], nameOf: (r: Row) => string, lineOf: (name: string, g: Row[]) => string): string[] =>
  unique(rows.map(nameOf))
    .map(name => ({ name, group: rows.filter(r => nameOf(r) === name) }))
    .sort((a, b) => sum(b.group.map(r => r.chars)) - sum(a.group.map(r => r.chars)))
    .map(({ name, group }) => lineOf(name, group))

const classLines = (rows: Row[]): string[] =>
  groupLines(rows, r => r.cls, (name, g) =>
    `${name} | ×${g.length} | Σ${sum(g.map(r => r.ms))}ms | Σ${sum(g.map(r => r.chars))}ch`)

const agentLines = (rows: Row[], aliases: ReadonlyMap<string, string>): string[] =>
  groupLines(rows, r => r.agent, (name, g) => `${aliasOf(aliases, name)} | ×${g.length} | Σ${sum(g.map(r => r.chars))}ch`)

const costliestLines = (rows: Row[]): string[] =>
  [...rows]
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 5)
    .map(r => `r${r.seq} | ${r.tool} | ${r.key} | ${r.chars}ch`)

/** Renders the whole-session aggregates the judge reads instead of counting rows. */
export const statsLines = (rows: Row[]): string[] => {
  if (rows.length === 0) return ['(none)']
  const stats = aggregate(rows)
  const aliases = agentAliases(rows)
  return [
    'per call:',
    ...stats.filter((s, i) => i < 20 || s.count >= 3).map(s => keyStatLine(s, aliases)),
    'per class:',
    ...classLines(rows),
    'per agent:',
    ...agentLines(rows, aliases),
    'costliest rows:',
    ...costliestLines(rows),
  ]
}

const block = (lines: string[]): string => (lines.length > 0 ? lines.join('\n') : '(none)')

const measured = (row: Row, measure: Measure): number => (measure === 'ms' ? row.ms : row.chars)

const amountCell = (amount: number, measure: Measure): string => `Σ${amount}${measure === 'ms' ? 'ms' : 'ch'}`

const sinkLine = (s: Sink, total: number, measure: Measure): string =>
  `${s.label} | ×${s.count} | ${amountCell(s.amount, measure)} | ${Math.round((s.amount / Math.max(1, total)) * 100)}%`

const largestLines = (rows: readonly Row[], measure: Measure): string[] =>
  [...rows]
    .sort((a, b) => measured(b, measure) - measured(a, measure))
    .slice(0, 5)
    .map(r => `r${r.seq} | ${r.tool} | ${r.key} | ${amountCell(measured(r, measure), measure)}`)

/** TIME and CONTEXT: the total, the largest named sinks with their share of it, then the largest single rows. */
export const sinksBlock = (rows: readonly Row[], measure: Measure): string => {
  if (rows.length === 0) return '(none)'
  const where = sinks(rows, measure)
  return block([
    `total ${amountCell(where.total, measure)}`,
    ...where.sinks.map(s => sinkLine(s, where.total, measure)),
    'largest rows:',
    ...largestLines(rows, measure),
  ])
}

/** KNOWN PATTERNS: one line per pattern with its decision and previous-session calibration. */
export const knownPatternsBlock = (state: State): string =>
  block(state.patterns.map(p => {
    const previous = p.lastDecision !== null && p.decision === null ? ` | previous: ${p.lastDecision}` : ''
    return `${p.id} | ${p.kind} | ${p.decision ?? '-'} @ ${p.decidedAtTurn ?? '-'}${previous}`
  }))

/** DECISIONS: this session's decisions, then the keys kept in a previous session. */
export const decisionsBlock = (state: State): string =>
  block([
    ...state.patterns
      .filter(p => p.decision !== null)
      .map(p => `${p.id} | ${p.signature?.key ?? '-'} | ${p.decision} @ ${p.decidedAtTurn ?? '-'}`),
    ...state.patterns
      .filter(p => p.decision === null && p.lastDecision === 'keep')
      .map(p => `${p.id} | ${p.signature?.key ?? '-'} | kept in a previous session`),
  ])

const turnLine = (t: TurnStat): string =>
  [`${t.turn}`, `${t.input}`, `${t.output}`, `${t.cacheCreate}`, `${t.calls}`, `${t.ms}`, `${t.answerChars}`]
    .join(' | ') + (t.aborted ? ' | aborted' : '')

const factsLine = (state: State): string => {
  const o = state.overhead ?? { memory: 0, mcp: 0, agents: 0 }
  const at = state.compactions.length > 0 ? state.compactions.join(', ') : 'none'
  return `window=${state.usage.window} overhead: memory=${o.memory} mcp=${o.mcp} agents=${o.agents} compactions at turns: ${at}`
}

/** TURNS: one line per main-loop turn, then the session's fixed facts. */
export const turnsBlock = (state: State): string =>
  [block(state.turns.map(turnLine)), factsLine(state)].join('\n')

/** LEDGER: folded summaries of the older rows, then the newest JUDGE_LEDGER_ROWS in ascending order. */
export const ledgerBlock = (state: State): string => {
  const cut = Math.max(0, state.rows.length - JUDGE_LEDGER_ROWS)
  const folded = aggregate(state.rows.slice(0, cut)).map(s => summaryLine(s.tool, s.key, s.count, s.chars))
  const aliases = agentAliases(state.rows)
  return block([...folded, ...state.rows.slice(cut).map(row => ledgerLine(row, aliases))])
}
