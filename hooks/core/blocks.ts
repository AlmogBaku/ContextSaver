import { SPAWN_SINK, agentAliases, aliasOf, pairKey, sinks } from './evidence'
import { median } from './text'
import { AGENTS_ROWS, JUDGE_LEDGER_ROWS } from './types'
import type { CommandClass, Folded, Loop, Outcome, Row, Run, Sink, State, TurnStat } from './types'

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

const distinctPaths = (rows: Row[]): number => new Set(rows.flatMap(r => r.paths)).size

// One pass, so neither statOf nor editsBetween rescans the ledger per pair.
const byPair = (rows: Row[]): Map<string, Row[]> => {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const group = groups.get(pairKey(row))
    if (group === undefined) groups.set(pairKey(row), [row])
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

// One pair's surviving rows with the rows the cap dropped added back in: the counts and the costs sum and the
// turn span widens, while `editsBetween` stays the rows' own — what sat between the dropped ones is gone.
const withFold = (s: KeyStat, f: Folded | undefined): KeyStat =>
  f === undefined ? s : {
    ...s,
    count: s.count + f.count, ms: s.ms + f.ms, chars: s.chars + f.chars,
    firstTurn: Math.min(s.firstTurn, f.firstTurn), lastTurn: Math.max(s.lastTurn, f.lastTurn),
    agents: unique([f.agent, ...s.agents]),
  }

// A pair whose every row the cap dropped: still counted, with no rows left to measure the edits between.
const foldStat = (f: Folded): KeyStat => ({
  tool: f.tool, key: f.key, cls: f.cls, count: f.count, ms: f.ms, chars: f.chars,
  firstTurn: f.firstTurn, lastTurn: f.lastTurn, agents: [f.agent], editsBetween: null,
})

/** Aggregates rows into one KeyStat per (tool, key), costliest in chars first; a fold of rows past the cap is counted into its pair. */
export const aggregate = (rows: Row[], folded: Readonly<Record<string, Folded>> = {}): KeyStat[] => {
  const at = positions(rows)
  const groups = byPair(rows)
  return [
    ...[...groups.entries()].map(([pair, hits]) => withFold(statOf(rows, at, hits), folded[pair])),
    ...Object.entries(folded).filter(([pair]) => !groups.has(pair)).map(([, fold]) => foldStat(fold)),
  ].sort((a, b) => b.chars - a.chars)
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

// Every question this session put to the person, folded rows and live ones alike: how long they held it up and
// how many named a default. No id, so nothing here is citable — the wait is a fact the `time` sentence explains.
const waitLines = (rows: readonly Row[], folded: Readonly<Record<string, Folded>>): string[] => {
  const asks = rows.filter(r => r.flags.includes('ask'))
  const folds = Object.values(folded).filter(f => f.flags.ask > 0)
  const count = asks.length + sum(folds.map(f => f.flags.ask))
  if (count === 0) return []
  const ms = sum(asks.map(r => r.ms)) + sum(folds.map(f => f.ms))
  const recommended = asks.filter(r => r.flags.includes('recommended')).length + sum(folds.map(f => f.flags.recommended))
  return ['waits:', `AskUserQuestion | ×${count} | Σ${ms}ms | recommended ×${recommended}`]
}

/** Renders the whole-session aggregates the judge reads instead of counting rows; the folds past the cap are counted in, and `aliases` is the naming AGENTS and LEDGER print, so a loop only the folds remember is still named by its alias. */
export const statsLines = (rows: Row[], folded: Readonly<Record<string, Folded>> = {}, aliases: ReadonlyMap<string, string> = agentAliases(rows)): string[] => {
  if (rows.length === 0) return ['(none)']
  const stats = aggregate(rows, folded)
  return [
    'per call:',
    ...stats.filter((s, i) => i < 20 || s.count >= 3).map(s => keyStatLine(s, aliases)),
    ...waitLines(rows, folded),
    'per class:',
    ...classLines(rows),
    'per agent:',
    ...agentLines(rows, aliases),
  ]
}

const block = (lines: string[]): string => (lines.length > 0 ? lines.join('\n') : '(none)')

const measured = (row: Row, measure: Measure): number => (measure === 'ms' ? row.ms : row.chars)

const amountCell = (amount: number, measure: Measure): string => `Σ${amount}${measure === 'ms' ? 'ms' : 'ch'}`

// The spawn sink is not in the total, so it is given no share of it: a percentage of a denominator a
// label is missing from is a number the judge cannot use, and 400% is one it would have to explain away.
const sinkLine = (s: Sink, total: number, measure: Measure): string =>
  [s.label, `×${s.count}`, amountCell(s.amount, measure),
    s.label === SPAWN_SINK ? 'apart' : `${Math.round((s.amount / Math.max(1, total)) * 100)}%`].join(' | ')

const largestLines = (rows: readonly Row[], measure: Measure): string[] =>
  [...rows]
    .sort((a, b) => measured(b, measure) - measured(a, measure))
    .slice(0, 5)
    .map(r => `r${r.seq} | ${r.tool} | ${r.key} | ${amountCell(measured(r, measure), measure)}`)

/** TIME and CONTEXT: the total, the largest named sinks with their share of it, then the largest single rows; with loops given, the agents sink's time is theirs, and the folds are in every total. */
export const sinksBlock = (rows: readonly Row[], measure: Measure, loops: readonly Loop[] = [], folded: Readonly<Record<string, Folded>> = {}): string => {
  if (rows.length === 0) return '(none)'
  const where = sinks(rows, measure, loops, folded)
  return block([
    `total ${amountCell(where.total, measure)}`,
    ...where.sinks.map(s => sinkLine(s, where.total, measure)),
    'largest rows:',
    // Only rows the LEDGER window still shows: `parseReply` validates evidence against exactly those, so
    // naming an older row here would offer the judge an id its own citation of it is discarded for.
    ...largestLines(rows.slice(Math.max(0, rows.length - JUDGE_LEDGER_ROWS)), measure),
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

const IDLE_MIN_MS = 60_000   // a wait shorter than a minute before the next prompt is the person reading, not away

const turnLine = (t: TurnStat): string =>
  [
    `${t.turn}`, `${t.input}`, `${t.output}`, `${t.cacheCreate}`, `${t.calls}`, `${t.ms}`, `${t.answerChars}`,
    ...(t.ended !== 'answer' ? [t.ended] : []),
    ...(t.idleMs >= IDLE_MIN_MS ? [`idle ${Math.round(t.idleMs / 60_000)}m`] : []),
  ].join(' | ')

const factsLine = (state: State): string => {
  const o = state.overhead ?? { memory: 0, mcp: 0, agents: 0 }
  const at = state.compactions.length > 0 ? state.compactions.join(', ') : 'none'
  return `window=${state.usage.window} overhead: memory=${o.memory} mcp=${o.mcp} agents=${o.agents} compactions at turns: ${at}`
}

/** TURNS: one line per main-loop turn, then the session's fixed facts. */
export const turnsBlock = (state: State): string =>
  [block(state.turns.map(turnLine)), factsLine(state)].join('\n')

/** LEDGER: folded summaries of the older rows — the rows past the cap among them — then the newest JUDGE_LEDGER_ROWS in ascending order; `aliases` names the loops too, so a loop AGENTS lists and a row LEDGER shows agree. */
export const ledgerBlock = (state: State, aliases: ReadonlyMap<string, string> = agentAliases(state.rows, state.loops)): string => {
  const cut = Math.max(0, state.rows.length - JUDGE_LEDGER_ROWS)
  const older = aggregate(state.rows.slice(0, cut), state.folded).map(s => summaryLine(s.tool, s.key, s.count, s.chars))
  return block([...older, ...state.rows.slice(cut).map(row => ledgerLine(row, aliases))])
}

const minutes = (ms: number): string => `${(ms / 60_000).toFixed(1)}m`

const ktok = (loops: readonly Loop[]): string =>
  `${Math.round(loops.reduce((n, l) => n + l.tokens.input + l.tokens.cacheCreate + l.tokens.output, 0) / 1000)}k`

const sumMs = (loops: readonly Loop[]): number => sum(loops.map(l => l.ms))

// The family word of a model id (`claude-opus-4-1` → `opus`), or the id itself when it names no family.
const modelShort = (model: string | null): string => model === null ? '?' : (/(opus|sonnet|haiku|fable)/.exec(model)?.[1] ?? model)

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

const outcomeCell = (o: Outcome | null): string => {
  if (o === null) return '-'
  if (o.kind === 'report') return `report ${o.chars}ch`
  const counts = SEVERITIES.filter(s => o[s] > 0).map(s => `${o[s]} ${s}`)
  return counts.length > 0 ? counts.join(' ') : '0 findings'
}

const runName = (runs: readonly Run[], id: string | null): string | null =>
  id === null ? null : (runs.find(r => r.id === id)?.name ?? null)

// The counts are the loop's own, kept as its rows landed: whole whether or not the rows survived ROW_CAP.
const loopLine = (state: State, aliases: ReadonlyMap<string, string>, l: Loop): string =>
  [
    aliasOf(aliases, l.id), runName(state.runs, l.run) ?? '-', l.label ?? '-', modelShort(l.model), `${l.turns}`,
    minutes(l.ms), ktok([l]), `edits ${l.edits}`, `checks ${l.checks}`, `reads ${l.reads}`,
    outcomeCell(l.outcome), l.ended ?? 'running',
  ].join(' | ')

const runLine = (state: State, run: Run): string => {
  const loops = state.loops.filter(l => l.run === run.id)
  return `${run.name} | ${run.id} | loops ${loops.length} | Σ${minutes(sumMs(loops))} | Σ${ktok(loops)} tok | edits ${sum(loops.map(l => l.edits))} | turn ${run.turn}`
}

// Loops past the window fold per run, in the order the runs first appear among them; loops of no run fold as `agents`.
const foldedLoopLines = (state: State, older: readonly Loop[]): string[] =>
  unique(older.map(l => l.run ?? '')).map(run => {
    const group = older.filter(l => (l.run ?? '') === run)
    return `~ ${runName(state.runs, run || null) ?? 'agents'} | ×${group.length} | Σ${minutes(sumMs(group))} | Σ${ktok(group)}`
  })

/** AGENTS: one line per run, then the newest AGENTS_ROWS loops in full with the older ones folded per run; `aliases` is the naming shared with LEDGER. */
export const agentsBlock = (state: State, aliases: ReadonlyMap<string, string> = agentAliases(state.rows, state.loops)): string => {
  if (state.loops.length === 0) return '(none)'
  const cut = Math.max(0, state.loops.length - AGENTS_ROWS)
  return block([
    ...state.runs.map(run => runLine(state, run)),
    'loops:',
    ...foldedLoopLines(state, state.loops.slice(0, cut)),
    ...state.loops.slice(cut).map(l => loopLine(state, aliases, l)),
  ])
}
