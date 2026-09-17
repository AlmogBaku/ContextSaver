import { agentAliases, aliasOf, baseline, rowsOf, sinks, sumOf } from './evidence'
import { collapseWs, duration, instructionOf, killPrompt, median, pctOf } from './text'
import {
  ALTERNATIVE_MAX, CARD_EVIDENCE, DEBUG_MAX_DROPPED, DEBUG_MAX_LINES, DEBUG_MAX_PATTERNS, FILE_TOOLS,
  JUDGE_BUDGET_SHARE, JUDGE_MAX_BACKOFF, KEY_MAX, KIND_MAX, MAIN_AGENT, MAX_PATTERNS, NO_CALLS, ROW_CAP,
  SETTLE_TURNS, TREND_TURNS, initialState,
} from './types'
import type {
  Action, Artifact, BandModel, Card, Choice, CommandClass, DecidedRow, Evidence, Header, JudgeRun, PaneModel,
  Pattern, Proposal, Row, Signature, Sinks, State, StoredPattern, TurnStat,
} from './types'

// The `:offset-limit` slice `normalize` appends to a Read key: the path is what the details name.
const READ_RANGE = /:\d*-\d*$/

const GROWTH_TURNS = 5     // turns with a context sample the pace to compaction is read from
const GROWTH_SAMPLES = 3   // growth samples below which no pace is stated at all

type Decided = Pattern & { decision: Choice }
type Settle = { pattern: Pattern; ms: number; chars: number; requeue: string | null }

const isSent = (c: Choice | null): boolean => c === 'steer' || c === 'kill'

const isDecided = (p: Pattern): p is Decided => p.decision !== null

const pushUnique = (xs: readonly string[], x: string): string[] => (xs.includes(x) ? [...xs] : [...xs, x])

const queueCard = (cards: readonly string[], id: string): string[] => (cards.includes(id) ? [...cards] : [id, ...cards])

const patternById = (patterns: readonly Pattern[], id: string): Pattern | undefined => patterns.find(p => p.id === id)

const signatureHit = (p: Pattern, row: Pick<Row, 'tool' | 'key'>): boolean =>
  p.signature !== null && p.signature.tool === row.tool && p.signature.key === row.key

const classOfPattern = (state: State, p: Pattern): CommandClass | null => rowsOf(state, p)[0]?.cls ?? null

const turnHandle = (handle: string): number | null => {
  const n = /^turn:(\d+)$/.exec(handle)?.[1]
  return n === undefined ? null : Number(n)
}

const turnsCited = (p: Pattern, rows: readonly Row[]): number[] => {
  const fromHandles = p.hits.map(turnHandle).filter((n): n is number => n !== null)
  return [...rows.map(r => r.turn), ...fromHandles].sort((a, b) => a - b)
}

const newTokens = (t: TurnStat): number => t.input + t.output + t.cacheCreate

/** Sums every new (non-cache-read) token this session's turns reported. */
export const totalTokens = (state: State): number => state.turns.reduce((n, t) => n + newTokens(t), 0)

/** Tokens left before auto-compaction; null while the session's token count is unknown. */
export const tokensToCompaction = (state: State): number | null => {
  const tokens = state.usage.tokens
  if (tokens === undefined) return null
  return (state.usage.compactAt ?? Math.round(state.usage.window * 0.9)) - tokens
}

/** The context after each turn that reported one, oldest first: how full the window was, turn by turn. */
const contexts = (state: State): number[] =>
  state.turns.map(t => t.context).filter((tokens): tokens is number => tokens !== null)

/**
 * Turns left before compaction at the recent pace; null under three growth samples or a zero median.
 *
 * The pace is how fast the window fills, not what a turn is billed: a turn can spend 60k tokens and
 * grow the window by 8k, so the tokens of a turn would have claimed compaction was three turns away.
 * A turn that shrank the window (a compaction, a `/clear`) is no pace at all, so drops are skipped.
 */
export const turnsToCompaction = (state: State): number | null => {
  const left = tokensToCompaction(state)
  const seen = contexts(state).slice(-GROWTH_TURNS)
  const growth = seen.slice(1).map((tokens, at) => tokens - (seen[at] ?? 0)).filter(step => step > 0)
  if (left === null || growth.length < GROWTH_SAMPLES) return null
  const perTurn = median(growth)
  return perTurn === 0 ? null : Math.round(left / perTurn)
}

const applySettlements = (state: State, list: readonly Settle[]): Pick<State, 'patterns' | 'cards' | 'saved'> => ({
  patterns: list.map(s => s.pattern),
  cards: list.reduce<string[]>((cards, s) => (s.requeue === null ? cards : queueCard(cards, s.requeue)), [...state.cards]),
  saved: {
    ms: list.reduce((ms, s) => ms + s.ms, state.saved.ms),
    chars: list.reduce((chars, s) => chars + s.chars, state.saved.chars),
  },
})

const settleWithRow = (state: State, p: Pattern, row: Omit<Row, 'seq'>): Settle => {
  const grown: Pattern = signatureHit(p, row) ? { ...p, hits: pushUnique(p.hits, row.id) } : p
  const still = { pattern: grown, ms: 0, chars: 0, requeue: null }
  if (row.agent !== 'main' || p.openedAtTurn === null || !isSent(p.decision)) return still
  // A row in the decision's own turn was already in flight before Claude could read the instruction.
  if (row.turn <= p.openedAtTurn) return still
  // D4: every ignored instruction brings the card back, so the user can Keep or say something else.
  if (p.signature !== null && row.key === p.signature.key) {
    return { pattern: { ...grown, ignored: p.ignored + 1, openedAtTurn: null }, ms: 0, chars: 0, requeue: p.id }
  }
  if (row.cls !== classOfPattern(state, p)) return still
  const base = baseline(state, p)
  return {
    pattern: { ...grown, openedAtTurn: null },
    ms: Math.max(0, base.ms - row.ms),
    chars: Math.max(0, base.chars - row.chars),
    requeue: null,
  }
}

const settleAtTurn = (state: State, p: Pattern): Settle => {
  // D4: an ignored instruction saves nothing, so a behavioural pattern accrues only while it is still believed.
  const accrued = p.signature === null && isSent(p.decision) && p.ignored === 0 ? (p.estTokensPerTurn ?? 0) * 4 : 0
  if (p.openedAtTurn === null || state.turn - p.openedAtTurn < SETTLE_TURNS) {
    return { pattern: p, ms: 0, chars: accrued, requeue: null }
  }
  const base = baseline(state, p)
  return { pattern: { ...p, openedAtTurn: null }, ms: base.ms, chars: base.chars + accrued, requeue: null }
}

const applyRow = (state: State, row: Omit<Row, 'seq'>): State => {
  const seq = state.seq + 1
  return {
    ...state,
    seq,
    rows: [...state.rows, { ...row, seq }].slice(-ROW_CAP),
    ...applySettlements(state, state.patterns.map(p => settleWithRow(state, p, row))),
  }
}

const grownWith = (p: Pattern, rows: readonly Row[]): Pattern =>
  rows.filter(row => signatureHit(p, row)).reduce((q, row) => ({ ...q, hits: pushUnique(q.hits, row.id) }), p)

// History, not a live call: no turn stats exist for it, nothing settles on it, and nothing was saved by it.
const applyAdopt = (state: State, rows: readonly Omit<Row, 'seq'>[]): State => {
  const seeded = rows.map((row, i) => ({ ...row, seq: state.seq + i + 1 }))
  const seq = state.seq + seeded.length
  return {
    ...state,
    seq,
    turn: Math.max(state.turn, ...seeded.map(row => row.turn)),
    rows: [...state.rows, ...seeded].slice(-ROW_CAP),
    patterns: state.patterns.map(p => grownWith(p, seeded)),
    // The mid-turn cadence starts where the history ends: adopted rows are not new work, so a session
    // joined late waits for JUDGE_MIN_NEW_ROWS of its own. `/saver check` still judges them on request.
    judge: { ...state.judge, lastAtSeq: seq },
  }
}

const applyTurnComplete = (state: State, stat: Omit<TurnStat, 'turn' | 'calls'>): State => ({
  ...state,
  turns: [...state.turns, { ...stat, turn: state.turn, calls: state.rows.filter(r => r.turn === state.turn).length }],
  ...applySettlements(state, state.patterns.map(p => settleAtTurn(state, p))),
})

// Present values win; `window`/`compactAt` sticky (§5.2, widened so a partial usage dispatch never blanks the header).
// The first sample also dates the mid-turn cadence: without it `lastAtMs` is 0 against a clock reading ms
// since the epoch, so the five-minute floor would be no floor at all. `/saver demo` passes 0 and seeds nothing.
const applyUsage = (state: State, usage: State['usage'], now: number): State => ({
  ...state,
  usage: {
    window: usage.window || state.usage.window,
    compactAt: usage.compactAt ?? state.usage.compactAt,
    tokens: usage.tokens ?? state.usage.tokens,
    percent: usage.percent ?? state.usage.percent,
  },
  judge: state.judge.lastAtMs === 0 && now > 0 ? { ...state.judge, lastAtMs: now } : state.judge,
})

const applyDecide = (state: State, id: string, choice: Choice, text: string | undefined): State => {
  const p = patternById(state.patterns, id)
  if (p === undefined) return state
  const instruction = choice === 'kill' ? killPrompt(p) : (text ?? '')
  if (choice !== 'keep' && instruction.trim() === '') return state
  const sending = choice !== 'keep'
  // Kill rides the same wrapper as Steer (§5.2 "same with killPrompt(p)", Appendix C 5c "the same way"):
  // Claude reads `Instruction from the user (via ContextSaver): Stop this behaviour …`.
  const note = instructionOf(instruction)
  const decided: Pattern = {
    ...p,
    decision: choice,
    decidedAtTurn: state.turn,
    lastDecision: choice,
    instruction: sending ? instruction : p.instruction,
    openedAtTurn: sending ? state.turn : p.openedAtTurn,
  }
  return {
    ...state,
    patterns: state.patterns.map(q => (q.id === p.id ? decided : q)),
    cards: state.cards.filter(c => c !== p.id),
    expanded: state.expanded === p.id ? null : state.expanded,
    steering: null,
    steerDraft: null,
    notes: sending ? pushUnique(state.notes, note) : [...state.notes],
    standing: sending ? pushUnique(state.standing, note) : [...state.standing],
  }
}

const applyJudgeDone = (state: State, a: Extract<Action, { type: 'judge.done' }>): State => {
  const recurred = (p: Pattern): boolean => a.recurred.includes(p.id) && isSent(p.decision)
  const marked = a.patterns.filter(recurred).map(p => p.id)
  const reported = a.patterns.map(p => (recurred(p) ? { ...p, ignored: p.ignored + 1, openedAtTurn: null } : p))
  // A session decision is never lost, even when the judge's registry omits it.
  const patterns = [...reported, ...state.patterns.filter(p => isDecided(p) && patternById(reported, p.id) === undefined)]
  const wanted = [...a.fresh.filter(id => patternById(patterns, id)?.decision === null), ...marked]
  const added = wanted.filter((id, i) => wanted.indexOf(id) === i && !state.cards.includes(id))
  const total = totalTokens(state)
  const spent = state.judge.spent + a.spent
  return {
    ...state,
    patterns,
    cards: [...added, ...state.cards].filter(id => patternById(patterns, id) !== undefined),
    judge: {
      lastAtTokens: total,
      lastAtTurn: state.turn,
      lastAtSeq: state.judge.lastAtSeq,
      lastAtMs: state.judge.lastAtMs,
      running: false,
      runs: state.judge.runs + 1,
      spent,
      backoff: spent > JUDGE_BUDGET_SHARE * total ? Math.min(state.judge.backoff * 2, JUDGE_MAX_BACKOFF) : state.judge.backoff,
      error: a.error,
      focus: a.focus,
      time: a.time,
      context: a.context,
      last: { returned: a.returned, kept: a.kept, dropped: [...a.dropped] },
    },
  }
}

const applyReset = (state: State): State => ({
  ...initialState(state.cwd, state.usage.window),
  overhead: state.overhead,
  columns: state.columns,
  paneOpen: state.paneOpen,
  patterns: state.patterns.map(p => fromStored(toStored(p))),
})

/** Applies one action to the state, returning a new state (never mutates its input). */
export const reduce = (state: State, action: Action): State => {
  switch (action.type) {
    case 'turn.start':
      return { ...state, turn: state.turn + 1 }
    case 'row':
      return applyRow(state, action.row)
    case 'adopt':
      return applyAdopt(state, action.rows)
    case 'turn.complete':
      return applyTurnComplete(state, action.stat)
    case 'usage':
      return applyUsage(state, action.usage, action.now)
    case 'overhead':
      return { ...state, overhead: action.overhead }
    case 'compact':
      // The fill a compaction invalidated is forgotten: `tokens` is sticky and a just-compacted window
      // reports none until its next response (d.ts 7023-7025), so the header awaits the next turn instead
      // of announcing two turns to a compaction that just happened.
      return { ...state, compactions: [...state.compactions, state.turn], usage: { ...state.usage, tokens: undefined, percent: undefined } }
    case 'expand':
      return { ...state, expanded: action.patternId === state.expanded ? null : action.patternId }
    case 'steer.begin':
      return { ...state, steering: state.steering === action.patternId ? null : action.patternId, steerDraft: null }
    case 'steer.draft':
      return { ...state, steerDraft: action.text }
    case 'decide':
      return applyDecide(state, action.patternId, action.choice, action.text)
    case 'judge.start':
      return { ...state, judge: { ...state.judge, running: true, lastAtMs: action.now, lastAtSeq: action.seq } }
    case 'judge.done':
      return applyJudgeDone(state, action)
    case 'notes.drained':
      return { ...state, notes: [] }
    case 'standing.add':
      return { ...state, standing: pushUnique(state.standing, action.text) }
    case 'artifact.done':
      return {
        ...state,
        patterns: state.patterns.map(p => (p.id === action.patternId ? { ...p, proposal: null } : p)),
        written: action.written ? pushUnique(state.written, `${action.patternId}:${action.kind}`) : [...state.written],
      }
    case 'pane':
      return { ...state, paneOpen: action.open, autoOpened: action.auto === true ? true : state.autoOpened }
    case 'columns':
      return { ...state, columns: action.columns }
    case 'reset':
      return applyReset(state)
  }
}

const statsOf = (p: Pattern, state: State, rows: readonly Row[]): string => {
  const cost = sumOf(rows)
  const pct = pctOf(cost.chars, state.usage.window)
  const turns = turnsCited(p, rows)
  const first = turns[0]
  const last = turns[turns.length - 1]
  // Zero segments are dropped whole: turn handles and rebuilt rows carry no duration, and `0s` would claim a suite that ran for minutes cost nothing.
  return [
    `${p.hits.length}×`,
    ...(pct > 0 ? [`~${pct}% of context`] : []),
    ...(cost.ms > 0 ? [duration(cost.ms)] : []),
    // One turn is not a range: 'turns 1–1' reads as a bug.
    ...(first === undefined || last === undefined ? [] : [first === last ? `turn ${first}` : `turns ${first}–${last}`]),
  ].join(' · ')
}

// What ran, in the words the person typed or read: the command, the file, or the tool and its key.
const whatRan = (r: Row): string => {
  if (r.tool === 'Bash') return r.key.startsWith(`${r.cls}:`) ? r.key.slice(r.cls.length + 1) : r.key
  if (FILE_TOOLS.includes(r.tool)) return r.key.replace(READ_RANGE, '')
  return `${r.tool} ${r.key}`
}

const citedRows = (rows: readonly Row[], aliases: ReadonlyMap<string, string>): Evidence[] =>
  rows.map(r => ({
    turn: r.turn,
    what: whatRan(r),
    // The loop is named only when it was not the main one: an alias on every row would be noise.
    agent: r.agent === MAIN_AGENT ? null : aliasOf(aliases, r.agent),
    ms: r.ms,
    chars: r.chars,
    head: r.head,
  }))

const citedTurnStats = (p: Pattern, state: State): TurnStat[] =>
  p.hits
    .map(turnHandle)
    .map(n => (n === null ? undefined : state.turns.find(t => t.turn === n)))
    .filter((t): t is TurnStat => t !== undefined)

const evidenceOf = (p: Pattern, state: State, rows: readonly Row[], aliases: ReadonlyMap<string, string>): Evidence[] => {
  const turns: Evidence[] = citedTurnStats(p, state)
    .map(t => ({ turn: t.turn, what: NO_CALLS, agent: null, ms: 0, chars: t.answerChars, head: t.answerHead }))
  // Reversed first, so two calls inside one turn also read newest-first once the stable sort has run.
  return [...citedRows(rows, aliases).reverse(), ...turns]
    .sort((a, b) => b.turn - a.turn)
    .slice(0, CARD_EVIDENCE)
}

// A pattern with no row in hand cites turns, not calls: it counts them, and its context cost is the
// judge's per-turn estimate. The unit is stated here, so the drawing never has to guess it back.
const totalOf = (p: Pattern, state: State, rows: readonly Row[]): Card['total'] => {
  if (rows.length > 0) return { unit: 'calls', calls: rows.length, ...sumOf(rows) }
  return { unit: 'turns', calls: citedTurnStats(p, state).length, ms: 0, chars: (p.estTokensPerTurn ?? 0) * 4 }
}

/** Derives the waster card in seat `n` from a pattern, the evidence it cites and the ledger's loop aliases. */
export const cardOf = (p: Pattern, state: State, n: number, aliases: ReadonlyMap<string, string>): Card => {
  const rows = rowsOf(state, p)
  return {
    patternId: p.id,
    n,
    category: p.category,
    kind: p.ignored > 0 ? `ignored · ${p.kind}` : p.kind,
    stats: statsOf(p, state, rows),
    why: p.why,
    fix: p.alternative,
    total: totalOf(p, state, rows),
    evidence: evidenceOf(p, state, rows, aliases),
  }
}

const judgeShare = (state: State): number =>
  Math.round((state.judge.spent / Math.max(1, totalTokens(state))) * 1000) / 10

// How full the window was after each of the last turns that reported it: the shape the header draws.
const trendOf = (state: State): number[] =>
  contexts(state)
    .slice(-TREND_TURNS)
    .map(tokens => Math.round((tokens / Math.max(1, state.usage.window)) * 1000) / 10)

// Before the first row nothing was measured, and a total of zero would read as a session that cost nothing.
const sinksOf = (state: State, measure: 'ms' | 'chars'): Sinks | null =>
  state.rows.length === 0 ? null : sinks(state.rows, measure)

const headerOf = (state: State): Header => ({
  percent: state.usage.percent ?? null,
  tokensToCompaction: tokensToCompaction(state),
  turnsToCompaction: turnsToCompaction(state),
  trend: trendOf(state),
  time: sinksOf(state, 'ms'),
  context: sinksOf(state, 'chars'),
  judgeTime: state.judge.time,
  judgeContext: state.judge.context,
  judgeRuns: state.judge.runs,
  judgeTokens: state.judge.spent,
  judgeShare: judgeShare(state),
  judgeRunning: state.judge.running,
  savedPct: pctOf(state.saved.chars, state.usage.window),
  savedMs: state.saved.ms,
})

const decidedRowOf = (state: State, p: Decided): DecidedRow => ({
  patternId: p.id,
  choice: p.decision,
  kind: p.kind,
  savedPct: isSent(p.decision) ? pctOf(baseline(state, p).chars, state.usage.window) : null,
  // D4: the figure is a projection of one avoided repeat until the instruction settled — nothing ignored
  // it and nothing is still in flight — so the drawing can say `per repeat` before it says `saved`.
  settled: isSent(p.decision) && p.openedAtTurn === null && p.ignored === 0,
  // What Kill sends is the kind and the fix the row already carries; only a steer's own sentence is news.
  instruction: p.decision === 'steer' && p.instruction !== null && collapseWs(p.instruction) !== collapseWs(p.alternative)
    ? p.instruction
    : null,
  ignored: p.ignored,
})

/** Builds everything the pane renders: header, wasters, decisions and rules. */
export const paneModel = (state: State, artifacts: Artifact[]): PaneModel => {
  // One alias table for the whole draw: the naming is the ledger's, not a card's, and the pane
  // redraws on every ledger row and every keystroke in the Steer field.
  const aliases = agentAliases(state.rows)
  return {
    header: headerOf(state),
    // Numbered as they are drawn, so `/saver keep 2` names the card the person is looking at.
    wasters: state.cards
      .map(id => patternById(state.patterns, id))
      .filter((p): p is Pattern => p !== undefined)
      .map((p, at) => cardOf(p, state, at + 1, aliases)),
    expanded: state.expanded,
    steering: state.steering,
    steerDraft: state.steerDraft,
    decided: state.patterns
      .filter(isDecided)
      .sort((a, b) => (b.decidedAtTurn ?? 0) - (a.decidedAtTurn ?? 0))
      .map(p => decidedRowOf(state, p)),
    artifacts,
  }
}

/** Builds the one summary line the band shows above the prompt. */
export const bandModel = (state: State): BandModel => ({
  percent: state.usage.percent ?? null,
  tokensToCompaction: tokensToCompaction(state),
  fresh: state.cards.length,
  savedPct: pctOf(state.saved.chars, state.usage.window),
  paneOpen: state.paneOpen,
  checking: state.judge.running,
})

const isFilled = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const isText = (v: unknown, max: number): v is string => isFilled(v) && v.length <= max

const isOneOf = <T extends string>(v: unknown, options: readonly T[]): v is T =>
  typeof v === 'string' && (options as readonly string[]).includes(v)

const fields = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const signatureOf = (v: unknown): Signature | null | undefined => {
  if (v === null) return null
  const o = fields(v)
  const tool = o?.['tool']
  const key = o?.['key']
  return isText(tool, KEY_MAX) && isText(key, KEY_MAX) ? { tool, key } : undefined
}

const proposalOf = (v: unknown): Proposal | null | undefined => {
  if (v === null) return null
  const o = fields(v)
  const kind = o?.['kind']
  const title = o?.['title']
  const body = o?.['body']
  if (!isOneOf(kind, ['claude-md', 'skill', 'agent-brief', 'settings-allow'])) return undefined
  return isFilled(title) && isFilled(body) ? { kind, title, body } : undefined
}

const storedOf = (v: unknown): StoredPattern | null => {
  const o = fields(v)
  if (o === null) return null
  const id = o['id']
  const category = o['category']
  const kind = o['kind']
  const why = o['why']
  const alternative = o['alternative']
  const confidence = o['confidence']
  const estTokensPerTurn = o['estTokensPerTurn']
  const lastDecision = o['lastDecision']
  const signature = signatureOf(o['signature'])
  const proposal = proposalOf(o['proposal'])
  if (typeof id !== 'string' || !/^[a-z-]+:[a-z0-9-]{1,40}$/.test(id)) return null
  if (!isOneOf(category, ['execution', 'reading', 'production', 'behavior', 'communication', 'multi-agent', 'environment', 'process', 'other'])) return null
  if (!isText(kind, KIND_MAX) || !isText(alternative, ALTERNATIVE_MAX) || typeof why !== 'string') return null
  if (typeof confidence !== 'number' || !(confidence >= 0.5) || !(confidence <= 1)) return null
  if (estTokensPerTurn !== null && !(typeof estTokensPerTurn === 'number' && Number.isFinite(estTokensPerTurn) && estTokensPerTurn >= 0)) return null
  if (lastDecision !== null && !isOneOf(lastDecision, ['keep', 'steer', 'kill'])) return null
  if (signature === undefined || proposal === undefined) return null
  return { id, category, kind, signature, why, alternative, confidence, proposal, estTokensPerTurn, lastDecision }
}

/** Reads a stored registry from the plugin store, dropping every entry that does not validate. */
export const parseRegistry = (value: unknown): StoredPattern[] => {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, StoredPattern>()
  for (const item of value) {
    const stored = storedOf(item)
    if (stored !== null) byId.set(stored.id, stored)
  }
  return [...byId.values()]
}

/** Strips a pattern's session fields, leaving what is persisted per project. */
export const toStored = (p: Pattern): StoredPattern => ({
  id: p.id,
  category: p.category,
  kind: p.kind,
  signature: p.signature,
  why: p.why,
  alternative: p.alternative,
  confidence: p.confidence,
  proposal: p.proposal,
  estTokensPerTurn: p.estTokensPerTurn,
  lastDecision: p.lastDecision,
})

/** Revives a stored pattern with empty session fields. */
export const fromStored = (s: StoredPattern): Pattern => ({
  ...s, hits: [], decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0,
})

// What a stored entry is worth when the registry overflows: a decision outranks any confidence.
const rankOf = (p: StoredPattern): number => (p.lastDecision === null ? p.confidence : 2 + p.confidence)

const capStored = (entries: readonly StoredPattern[]): StoredPattern[] => {
  if (entries.length <= MAX_PATTERNS) return [...entries]
  return [...entries.entries()]
    .sort(([atA, a], [atB, b]) => rankOf(b) - rankOf(a) || atA - atB)
    .slice(0, MAX_PATTERNS)
    .sort(([atA], [atB]) => atA - atB)
    .map(([, p]) => p)
}

/** Merges two stored registries by id (`b` wins), dropping the weakest undecided entries past the cap. */
export const mergeStored = (a: readonly StoredPattern[], b: readonly StoredPattern[]): StoredPattern[] => {
  const byId = new Map<string, StoredPattern>(a.map(p => [p.id, p]))
  for (const p of b) byId.set(p.id, p)
  return capStored([...byId.values()])
}

const classCounts = (rows: readonly Row[]): string => {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.cls, (counts.get(r.cls) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => `${cls}×${n}`).join(' ') || '(none)'
}

const oneLine = (text: string | null): string => (text === null ? '-' : `"${text.replace(/\n/g, '\\n').slice(0, 120)}"`)

const patternLine = (p: Pattern): string =>
  `  ${p.id} · hits ${p.hits.length} [${p.hits.slice(0, 5).join(' ')}] · ${p.decision ?? '-'} @ ${p.decidedAtTurn ?? '-'} · previous ${p.lastDecision ?? '-'} · ignored ${p.ignored} · opened ${p.openedAtTurn ?? '-'} · sent ${oneLine(p.instruction)}`

const patternLines = (state: State): string[] => {
  const shown = state.patterns.slice(0, DEBUG_MAX_PATTERNS).map(patternLine)
  const rest = state.patterns.length - shown.length
  return rest > 0 ? [...shown, `  … ${rest} more patterns`] : shown
}

// What the last run reported, and why anything it returned never reached the user.
const judgeRunLines = (run: JudgeRun | null): string[] =>
  run === null
    ? []
    : [
        `judge last: ${run.returned} returned · ${run.kept} kept · ${run.dropped.length} dropped`,
        ...run.dropped.slice(0, DEBUG_MAX_DROPPED).map(reason => `  ${reason}`),
      ]

/** Renders the whole state for `/saver debug` in at most 40 lines. */
export const debugDump = (state: State): string => {
  const j = state.judge
  const u = state.usage
  const o = state.overhead
  return [
    `ContextSaver · turn ${state.turn} · seq ${state.seq} · rows ${state.rows.length} · turns ${state.turns.length} · patterns ${state.patterns.length}`,
    `rows ${classCounts(state.rows)}`,
    ...patternLines(state),
    `cards ${state.cards.length}${state.cards.length === 0 ? '' : `: ${state.cards.join(', ')}`}`,
    `notes ${state.notes.length} · standing ${state.standing.length} · written ${state.written.length}${state.written.length === 0 ? '' : `: ${state.written.join(', ')}`}`,
    `judge runs ${j.runs} · spent ${j.spent} tokens (${judgeShare(state)}% of the session) · backoff ${j.backoff} · running ${j.running} · lastAt ${j.lastAtTokens} tokens / turn ${j.lastAtTurn} / row ${j.lastAtSeq} / ${j.lastAtMs}ms · error ${j.error ?? '-'} · focus ${oneLine(j.focus)}`,
    `judge time: ${oneLine(j.time)}`,
    `judge context: ${oneLine(j.context)}`,
    ...judgeRunLines(j.last),
    `usage ${u.percent ?? '-'}% · ${u.tokens ?? '-'} / ${u.window} tokens · compactAt ${u.compactAt ?? '-'} · toCompaction ${tokensToCompaction(state) ?? '-'} · turnsLeft ${turnsToCompaction(state) ?? '-'} · session ${totalTokens(state)} new`,
    `overhead ${o === null ? '-' : `memory ${o.memory} · mcp ${o.mcp} · agents ${o.agents}`}`,
    `compactions ${state.compactions.length === 0 ? 'none' : state.compactions.join(', ')}`,
    `pane ${state.paneOpen ? 'open' : 'closed'} · autoOpened ${state.autoOpened} · columns ${state.columns ?? '-'} · expanded ${state.expanded ?? '-'} · steering ${state.steering ?? '-'}`,
    `saved ${duration(state.saved.ms)} · ~${pctOf(state.saved.chars, u.window)}% · ${state.saved.chars} chars`,
  ].slice(0, DEBUG_MAX_LINES).join('\n')
}
