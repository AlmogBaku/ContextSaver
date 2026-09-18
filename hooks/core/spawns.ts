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

// Anything but a findings list is a report, sized by its text or by the JSON it would print as.
const outcomeOf = (result: unknown): Outcome => {
  if (isRecord(result) && Array.isArray(result['findings'])) return findingsOf(result['findings'])
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

const isEdit = (r: Work): boolean => EDIT_TOOLS.includes(r.tool) || r.paths.length > 0

const isCheck = (r: Work): boolean => CHECK_CLASSES.includes(r.cls)

const isRead = (r: Work): boolean => r.cls === 'read' || r.cls === 'search' || READ_TOOLS.includes(r.tool)

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
