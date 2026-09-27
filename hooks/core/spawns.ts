import { RUN_FRESH_MS } from './types'
import type { CommandClass, JournalEntry, Loop, Outcome, Row, Run, State } from './types'

// The tools whose row is an edit whatever its paths say, the classes that are a check, the tools that are a read.
const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']
const CHECK_CLASSES: readonly CommandClass[] = ['test', 'lint', 'typecheck', 'format', 'build']
const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob']

type Severity = 'critical' | 'high' | 'medium' | 'low'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const isSeverity = (v: unknown): v is Severity =>
  v === 'critical' || v === 'high' || v === 'medium' || v === 'low'

// A reviewer's findings, counted by severity; a finding with none of the four names is not counted at all.
const findingsOf = (findings: readonly unknown[]): Outcome =>
  findings.reduce<Extract<Outcome, { kind: 'findings' }>>((counts, f) => {
    const severity = isRecord(f) ? f['severity'] : undefined
    return isSeverity(severity) ? { ...counts, [severity]: counts[severity] + 1 } : counts
  }, { kind: 'findings', critical: 0, high: 0, medium: 0, low: 0 })

// The words a prose review labels a finding with, under the four severities the outcome counts.
const PROSE_SEVERITY: Readonly<Record<string, Severity>> = {
  critical: 'critical', blocker: 'critical', important: 'high', high: 'high', major: 'high',
  medium: 'medium', moderate: 'medium', minor: 'low', low: 'low', nit: 'low',
}

// A label, not a word in a sentence: `(Important)`, `[Minor]`, `**Critical**`, `Severity: high`, or `Minor:` opening a line or a bullet.
const PROSE_LABEL = /\(\s*(\w+)\s*\)|\[\s*(\w+)\s*\]|\*\*(\w+)\*\*|severity:\s*(\w+)|^[\s>*\-\d.)#]*(\w+):/gim

// What follows a label that found nothing under it: `Critical: none`, `**Minor:** 0`, `High: -`.
const PROSE_NONE = /^[\s*_:]*(none|nothing|0|n\/a|na|—|-|no findings)[\s.,;:!*_]*$/i

// A prose reply's labelled severities, counted; null when it labels none, so it stays a report.
const proseOf = (text: string): Outcome | null => {
  const counts = { kind: 'findings' as const, critical: 0, high: 0, medium: 0, low: 0 }
  let labelled = 0
  for (const m of text.matchAll(PROSE_LABEL)) {
    const severity = PROSE_SEVERITY[(m.slice(1).find(g => g !== undefined) ?? '').toLowerCase()]
    if (severity === undefined) continue
    if (PROSE_NONE.test(text.slice(m.index + m[0].length).split('\n')[0] ?? '')) continue
    counts[severity] += 1
    labelled += 1
  }
  return labelled > 0 ? counts : null
}

// A findings list is counted, a prose review's labels are counted; anything else is a report, sized by its text or by the JSON it would print as.
const outcomeOf = (result: unknown): Outcome => {
  if (isRecord(result) && Array.isArray(result['findings'])) return findingsOf(result['findings'])
  const prose = typeof result === 'string' ? proseOf(result) : null
  if (prose !== null) return prose
  return { kind: 'report', chars: typeof result === 'string' ? result.length : (JSON.stringify(result) ?? '').length }
}

const entryOf = (line: string): JournalEntry | null => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  const agentId = str(value['agentId'])
  if (agentId === null) return null
  if (value['type'] === 'started') return { kind: 'started', agentId, label: str(value['label']), phase: str(value['phase']) }
  if (value['type'] === 'result') return { kind: 'result', agentId, outcome: outcomeOf(value['result']) }
  return null
}

/** Reads a workflow journal: one JSON object per line, `started` and `result` entries kept, anything else skipped. */
export const parseJournal = (text: string): JournalEntry[] =>
  text.split('\n').map(entryOf).filter((entry): entry is JournalEntry => entry !== null)

/** The run a `Workflow` result launched locally — its id, name and transcript dir — or null for anything else. */
export const runOf = (value: unknown): { id: string; name: string; dir: string | null } | null => {
  if (!isRecord(value) || value['taskType'] !== 'local_workflow') return null
  const id = str(value['runId'])
  const name = str(value['workflowName'])
  return id === null || name === null ? null : { id, name, dir: str(value['transcriptDir']) }
}

/** The loop an `Agent` result closed — its id, the description it was given and the model that ran it — or null. */
export const agentOf = (value: unknown): { agentId: string; description: string; model: string | null } | null => {
  if (!isRecord(value)) return null
  const agentId = str(value['agentId'])
  return agentId === null ? null : { agentId, description: str(value['description']) ?? '', model: str(value['resolvedModel']) }
}

type Work = Pick<Row, 'tool' | 'cls' | 'paths'>

/** An edit whatever its paths say, or any call that changed a path. */
export const isEdit = (r: Work): boolean => EDIT_TOOLS.includes(r.tool) || r.paths.length > 0

/** A test, lint, typecheck, format or build run. */
export const isCheck = (r: Work): boolean => CHECK_CLASSES.includes(r.cls)

/** A read or a search, by tool or by command class. */
export const isRead = (r: Work): boolean => r.cls === 'read' || r.cls === 'search' || READ_TOOLS.includes(r.tool)

const one = (yes: boolean): number => (yes ? 1 : 0)

/** The loop with one more of its own rows counted: a call, and an edit, a check or a read when the row was one — counted as it lands, so the count outlives the row. */
export const countRow = (loop: Loop, row: Work): Loop => ({
  ...loop, calls: loop.calls + 1, edits: loop.edits + one(isEdit(row)), checks: loop.checks + one(isCheck(row)), reads: loop.reads + one(isRead(row)),
})

/** What a loop's own surviving rows did: how many calls, and how many of them edited, checked or read; the loop's own counters are the whole figure. */
export const loopStats = (rows: readonly Row[], loop: Loop): { calls: number; edits: number; checks: number; reads: number } => {
  const own = rows.filter(r => r.agent === loop.id)
  return { calls: own.length, edits: own.filter(isEdit).length, checks: own.filter(isCheck).length, reads: own.filter(isRead).length }
}

// A run is going while one of its loops is, or while it is young enough that its first loop may not have reported yet.
const isActive = (state: State, run: Run, now: number): boolean => {
  const loops = state.loops.filter(l => l.run === run.id)
  return loops.length === 0 ? now - run.at < RUN_FRESH_MS : loops.some(l => l.ended === null)
}

/** The runs still going: one with an unended loop, or one launched less than RUN_FRESH_MS ago with no loop yet. */
export const activeRuns = (state: State, now: number): Run[] => state.runs.filter(run => isActive(state, run, now))

/** Where a run's journal is written; null for a run that reported no transcript dir. */
export const journalPath = (run: Run): string | null => (run.dir === null ? null : `${run.dir}/journal.jsonl`)

// One token of a script's source: a string literal's value, or a single punctuation or word character run.
type Token = { kind: 'string' | 'word' | 'punct'; text: string }

// Reads the source as tokens, comments skipped, stopping at the first string or comment left open.
const lex = (source: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i] ?? ''
    if (/\s/.test(c)) { i += 1; continue }
    if (c === '/' && source[i + 1] === '/') { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue }
    if (c === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); if (end < 0) return tokens; i = end + 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      let text = ''
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') j += 1
        text += source[j] ?? ''
        j += 1
      }
      if (j >= source.length) return tokens
      tokens.push({ kind: 'string', text })
      i = j + 1
      continue
    }
    const word = /^[\w$]+/.exec(source.slice(i, i + 200))
    if (word !== null) { tokens.push({ kind: 'word', text: word[0] }); i += word[0].length; continue }
    tokens.push({ kind: 'punct', text: c })
    i += 1
  }
  return tokens
}

const OPEN: Readonly<Record<string, string>> = { '{': '}', '[': ']', '(': ')' }

// The index just past the bracket that closes the one at `at`, or -1 when the literal never closes.
const closeOf = (tokens: readonly Token[], at: number): number => {
  const stack: string[] = []
  for (let i = at; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t === undefined || t.kind !== 'punct') continue
    const close = OPEN[t.text]
    if (close !== undefined) stack.push(close)
    else if (t.text === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return i + 1
    }
  }
  return -1
}

// A key of the object at depth one: a word or a quoted name followed by a colon.
const isKey = (tokens: readonly Token[], i: number, name: string): boolean =>
  tokens[i]?.text === name && tokens[i]?.kind !== 'punct' && tokens[i + 1]?.text === ':'

// The value token range of `name` inside the object whose `{` is at `at`, or null.
const valueAt = (tokens: readonly Token[], at: number, end: number, name: string): number | null => {
  for (let i = at + 1, depth = 0; i < end - 1; i += 1) {
    const t = tokens[i]
    if (t?.kind === 'punct' && OPEN[t.text] !== undefined) depth += 1
    else if (t?.kind === 'punct' && Object.values(OPEN).includes(t.text)) depth -= 1
    else if (depth === 0 && isKey(tokens, i, name)) return i + 2
  }
  return null
}

// The titles of a phases array literal: a bare string element or an object's `title` string; null when an element is anything else.
const titlesOf = (tokens: readonly Token[], at: number, end: number): string[] | null => {
  const titles: string[] = []
  let i = at + 1
  while (i < end - 1) {
    const t = tokens[i]
    if (t?.kind === 'string') { titles.push(t.text); i += 1 }
    else if (t?.text === '{') {
      const close = closeOf(tokens, i)
      const value = valueAt(tokens, i, close, 'title')
      const title = value === null ? undefined : tokens[value]
      if (title?.kind !== 'string') return null
      titles.push(title.text)
      i = close
    } else return null
    if (tokens[i]?.text === ',') i += 1
  }
  return titles
}

/** The phase titles a Workflow script's `meta` literal declares, read as a literal and never run; [] when there is no readable `meta.phases`. */
export const phasesOf = (script: string): string[] => {
  const tokens = lex(script)
  const meta = tokens.findIndex((t, i) => t.text === 'meta' && tokens[i + 1]?.text === '=' && tokens[i + 2]?.text === '{')
  if (meta < 0) return []
  const open = meta + 2
  const close = closeOf(tokens, open)
  if (close < 0) return []
  const value = valueAt(tokens, open, close, 'phases')
  if (value === null || tokens[value]?.text !== '[') return []
  const end = closeOf(tokens, value)
  return end < 0 ? [] : (titlesOf(tokens, value, end) ?? [])
}
