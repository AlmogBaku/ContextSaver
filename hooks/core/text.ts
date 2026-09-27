import type { ArtifactKind, Loop, Proposal, Row, Signature, State, StoredPattern, Usage } from './types'

/** Returns the median of the numbers; 0 when there are none. */
export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? (sorted[mid] ?? 0) : (((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

/** Returns chars/4/window*100 rounded to 1 decimal. */
export const pctOf = (chars: number, window: number): number =>
  Math.round((chars / 4 / window) * 1000) / 10

/** Returns 100 - percent, or null when percent is undefined. */
export const pctLeft = (u: Usage): number | null =>
  u.percent !== undefined ? Math.round((100 - u.percent) * 10) / 10 : null

/** Formats milliseconds as '11m', '3m 50s', or '12s'. */
export const duration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`
}

/** Returns what a length of text costs in tokens, four characters to one. */
export const tokensOf = (chars: number): number => Math.round(chars / 4)

/** Formats a count short and rounded: '9.9k', '41k', '800'. */
export const kilo = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`

/** Truncates text to `cells` characters, ending it with '…' when it is cut and never a space before it. */
export const fit = (text: string, cells: number): string =>
  text.length <= cells ? text : `${text.slice(0, Math.max(0, cells - 1)).trimEnd()}…`

/** Returns a kebab-case slug of at most forty characters. */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** Collapses runs of whitespace (including newlines) to a single space and trims. */
export const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Returns JSON with keys sorted, top-level keys in omit removed. */
export const stableJson = (v: unknown, omit: readonly string[]): string => {
  const replacer = (_key: string, val: unknown): unknown => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>
      return Object.keys(obj)
        .filter(k => !omit.includes(k))
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => { acc[k] = obj[k]; return acc }, {})
    }
    return val
  }
  return JSON.stringify(v, replacer)
}

/** Renders a filled/empty gauge of `width` cells for a percentage 0..100. */
export const gauge = (percent: number, width: number): string => {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Wraps a user instruction in the standard ContextSaver prefix. */
export const instructionOf = (text: string): string =>
  `Instruction from the user (via ContextSaver): ${text}`

/** Produces the kill prompt for a stored pattern. */
export const killPrompt = (p: StoredPattern): string =>
  `Stop this behaviour for the rest of the session: ${p.kind}. From now on: ${p.alternative}`

// Reply parsing shared by the habit and process judges: the JSON object, the evidence handles each may
// cite, and the grounded ceiling on what a finding may claim.

export const unique = (xs: string[]): string[] => [...new Set(xs)]

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const isArtifactKind = (v: unknown): v is ArtifactKind =>
  typeof v === 'string' && ['claude-md', 'skill', 'agent-brief', 'settings-allow'].includes(v)

export const parseObject = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export const short = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`)

// The model's own text quoted inside a one-line drop reason: whitespace collapsed first, so a
// heredoc key or a multi-line id can never break the one-reason-per-line contract `debugDump` keeps.
export const cell = (value: unknown, max: number): string => short(collapseWs(str(value)), max)

export const AGENT_HANDLE = /^agent:(.+)$/

// Handles that name no single row: a turn of the main loop, or a whole agent loop.
export const isWide = (handle: string): boolean => /^turn:\d+$/.test(handle) || AGENT_HANDLE.test(handle)

export const handleDrop = (value: unknown, signature: Signature | null): string => {
  const handle = cell(value, 40)
  if (handle.length === 0) return 'evidence handle is not a string'
  if (isWide(handle) && signature !== null) return `evidence ${handle} needs signature null`
  return AGENT_HANDLE.test(handle) ? `evidence ${handle} not in AGENTS` : `evidence ${handle} not in the ledger`
}

// The loop an `agent:<alias>` handle names, under the alias table AGENTS and LEDGER printed — the one the
// prompt was built with, not today's: a judge run takes minutes, and a new agent's first row landing in
// that time (or an old agent's last row falling off ROW_CAP) renumbers every loop the rows never showed.
export const loopOf = (state: State, aliases: ReadonlyMap<string, string>, alias: string): Loop | undefined =>
  state.loops.find(l => aliases.get(l.id) === alias)

export const handleOf = (value: unknown, state: State, visible: Row[], aliases: ReadonlyMap<string, string>, signature: Signature | null): string | null => {
  const handle = str(value)
  const alias = /^r(\d+)$/.exec(handle)
  if (alias !== null) {
    const row = visible.find(r => r.seq === Number(alias[1] ?? ''))
    return row !== undefined ? row.id : null
  }
  if (signature !== null) return null
  const turn = /^turn:(\d+)$/.exec(handle)
  if (turn !== null) {
    const n = Number(turn[1] ?? '')
    return state.turns.some(t => t.turn === n) ? `turn:${n}` : null
  }
  const agent = AGENT_HANDLE.exec(handle)
  if (agent !== null) {
    const loop = loopOf(state, aliases, agent[1] ?? '')
    // Stored by id, not alias: the alias is a naming of the rows in hand and can renumber between runs.
    return loop !== undefined ? `agent:${loop.id}` : null
  }
  return null
}

// A string is the reason the evidence cannot be used; the array is the handles it maps to.
export const evidenceOf = (value: unknown, state: State, visible: Row[], aliases: ReadonlyMap<string, string>, signature: Signature | null): string[] | string => {
  if (!Array.isArray(value) || value.length === 0) return 'evidence must be a non-empty array of row ids'
  const handles = value.map(h => handleOf(h, state, visible, aliases, signature))
  const badAt = handles.indexOf(null)
  if (badAt >= 0) return handleDrop(value[badAt], signature)
  return unique(handles.filter((h): h is string => h !== null))
}

export const citedLoops = (state: State, evidence: string[]): Loop[] =>
  evidence.flatMap(handle => {
    const agent = AGENT_HANDLE.exec(handle)
    const loop = agent === null ? undefined : state.loops.find(l => l.id === agent[1])
    return loop !== undefined ? [loop] : []
  })

export const citedTurns = (state: State, evidence: string[]): number[] =>
  evidence.flatMap(handle => {
    const turn = /^turn:(\d+)$/.exec(handle)
    if (turn !== null) return [Number(turn[1] ?? '')]
    if (AGENT_HANDLE.test(handle)) return citedLoops(state, [handle]).map(l => l.firstTurn)
    const row = state.rows.find(r => r.id === handle)
    return row !== undefined ? [row.turn] : []
  })

export const loopTokens = (l: Loop): number => l.tokens.input + l.tokens.cacheCreate + l.tokens.output

// What one avoided loop would have cost when the finding cites loops alone; else the cited turns' answers.
export const groundedCap = (state: State, evidence: string[]): number => {
  const loops = citedLoops(state, evidence)
  if (loops.length > 0 && !evidence.some(h => /^turn:\d+$/.test(h))) return Math.floor(median(loops.map(loopTokens)))
  const turns = citedTurns(state, evidence)
  return Math.floor(median(state.turns.filter(t => turns.includes(t.turn)).map(t => t.answerChars)) / 4)
}

export const proposalOf = (value: unknown): Proposal | null => {
  if (!isRecord(value)) return null
  const kind = value['kind']
  const title = collapseWs(str(value['title']))
  const body = str(value['body']).trim()
  if (!isArtifactKind(kind) || title.length === 0 || body.length === 0) return null
  if (kind === 'settings-allow' && !/^[A-Za-z][A-Za-z0-9_]*\(.+\)$/.test(body)) return null
  return { kind, title, body }
}
