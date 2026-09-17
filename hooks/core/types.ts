import type { Elements } from 'claude-code'

export const PLUGIN_NAME = 'contextsaver'
export const PANE_ID = 'saver'
export const PANE_TITLE = 'ContextSaver'
export const PANE_INLINE_ROWS = 14            // body rows requested when seated inline above the prompt
export const AUTO_OPEN_MIN_COLUMNS = 144      // unasked opens wait undrawn below this width (d.ts 1943-1945)
export const COMMAND = { name: 'saver', description: 'ContextSaver: toggle the pane · check | steer <text> | debug | reset', argumentHint: '[check | steer <text> | debug | reset]' } as const
export const SETTLE_TURNS = 2                 // an instruction not ignored for this many turns is credited
export const JUDGE_MIN_NEW_TOKENS = 30_000
export const JUDGE_MIN_TURNS = 3
export const JUDGE_MIN_ROWS = 8
export const JUDGE_MAX_BACKOFF = 4
export const JUDGE_BUDGET_SHARE = 0.03
export const JUDGE_LEDGER_ROWS = 150          // full rows rendered; older rows are folded into `~` summary lines
export const MAX_FINDINGS = 6
export const MAX_BEHAVIORAL_FINDINGS = 2      // findings with signature: null per judge run
export const MAX_PATTERNS = 50
export const ROW_CAP = 2000
export const KIND_MAX = 120
export const ALTERNATIVE_MAX = 200
export const KEY_MAX = 200
export const SAMPLE_CAP = 30                  // usage samples kept (State.usageSamples: "last 30")
export const DEBUG_MAX_LINES = 40             // `/saver debug` ceiling
export const DEBUG_MAX_PATTERNS = 20          // pattern lines `/saver debug` prints before folding the rest
export const BRIEF_TOOLS = 'Read, Grep, Glob' // the tools an agent brief allows when the proposal names none
export const CLAUDE_MD_HEADING = '## ContextSaver'

export type CommandClass = 'test' | 'lint' | 'format' | 'typecheck' | 'build' | 'install' | 'git' | 'read' | 'search' | 'other'
export type Category = 'execution' | 'reading' | 'production' | 'behavior' | 'communication' | 'multi-agent' | 'environment' | 'process' | 'other'
export type Choice = 'keep' | 'steer' | 'kill'

export type Row = {
  seq: number              // 1-based, monotonically increasing; the judge sees `r${seq}`
  id: string               // tool_use_id
  tool: string; key: string; cls: CommandClass
  agent: string            // e.agentId ?? 'main'
  turn: number
  ms: number; chars: number
  head: string             // first 80 chars of result.text, control characters stripped; quoted as evidence in the pane, never sent to the judge
  flags: string[]          // 'err' (tool reported an error) | 'denied' (result.deny: the user or a policy said no) | 'dedup' (Read type 'file_unchanged') | 'trunc' (truncatedByTokenCap) | 'bg' (run_in_background or backgroundTaskId) | 'timeout' (timedOutAfterMs) | `persist=${persistedOutputSize}`
  lines: { add: number; del: number } | null   // Edit: gitDiff.additions/deletions else counted from structuredPatch; Write: content line count as add
  paths: string[]          // absolute paths this call edited (Edit/Write filePath unless staged; Bash bashEditDiff.changedFiles)
  spawn: { type: string; requested: string | null; resolved: string | null; status: string | null; tokens: number | null; edits: number | null; promptChars: number } | null   // Agent rows only
}
export type TurnStat = { turn: number; input: number; output: number; cacheRead: number; cacheCreate: number; calls: number; ms: number; answerChars: number; answerHead: string; aborted: boolean }   // answerHead: first 100 chars of e.answer, for evidence quotes
export type Signature = { tool: string; key: string }
export type ArtifactKind = 'claude-md' | 'skill' | 'agent-brief' | 'settings-allow'
export type Proposal = { kind: ArtifactKind; title: string; body: string }

/** Persisted across sessions, per project. */
export type StoredPattern = {
  id: string                       // `${category}:${slug}`, slug ≤ 40
  category: Category
  kind: string                     // the behaviour, one sentence ≤ 120 chars: "Claude keeps running `bun test` after every step"
  signature: Signature | null      // null = behavioural, no single command carries it
  why: string
  alternative: string              // the fix, one imperative sentence ≤ 200 chars written for Claude; pre-fills Steer, completes Kill
  confidence: number               // 0.5..1
  proposal: Proposal | null
  estTokensPerTurn: number | null  // judge's estimate for behavioural patterns; null when a signature exists
  lastDecision: Choice | null      // the most recent session's decision, for the judge's calibration
}
/** Session-only fields. */
export type Pattern = StoredPattern & {
  hits: string[]                   // evidence handles: row ids (tool_use_id) or `turn:<n>`; grows with matching rows; cost/baseline from rows only
  decision: Choice | null
  decidedAtTurn: number | null
  instruction: string | null       // the text sent for steer/kill
  openedAtTurn: number | null      // turn of the last steer/kill; settles saved (credited or ignored)
  ignored: number                  // times the instruction was ignored
}

export type Card = { patternId: string; kind: string; stats: string; why: string; fix: string; killText: string; evidence: string[] }   // evidence: ≤3 quotes built from the cited rows/turns
export type Artifact = { patternId: string; kind: ArtifactKind; title: string; path: string; content: string; savingPct: number; mode: 'append' | 'write' | 'merge-settings' }
export type Usage = { tokens?: number; window: number; percent?: number; compactAt?: number }

export type State = {
  cwd: string
  turn: number
  seq: number                      // last Row.seq issued
  rows: Row[]                      // capped at ROW_CAP (oldest dropped)
  turns: TurnStat[]
  usage: Usage
  usageSamples: { turn: number; percent: number }[]   // one per main turn, last 30; feeds the header sparkline
  overhead: { memory: number; mcp: number; agents: number } | null
  compactions: number[]            // turn indices at which session.compact fired
  patterns: Pattern[]
  cards: string[]                  // pattern ids awaiting a decision, newest first (the pane's WASTERS list)
  expanded: string | null          // pattern id whose (i) details are open; one at a time
  steering: string | null          // pattern id whose Steer field is open
  steerDraft: string | null        // the field's current text (kept in state so redraws never wipe it)
  notes: string[]                  // one-shot texts: drained into the next tool result or prompt
  standing: string[]               // texts re-sent with every prompt this session
  written: string[]                // `${patternId}:${kind}` of artifacts written, tried or skipped this session; propose() omits them
  judge: { lastAtTokens: number; lastAtTurn: number; running: boolean; runs: number; spent: number; backoff: number; error: string | null; focus: string | null }
  paneOpen: boolean
  autoOpened: boolean              // the pane auto-opened once this session (like /diff on the first edit)
  columns: number | null           // last band width seen (e.props.bodyColumns), for the auto-open decision
  saved: { ms: number; chars: number }
}

export const initialState = (cwd: string, window: number): State => ({
  cwd, turn: 0, seq: 0, rows: [], turns: [], usage: { window }, usageSamples: [], overhead: null, compactions: [], patterns: [], cards: [], expanded: null, steering: null, steerDraft: null, notes: [], standing: [], written: [],
  judge: { lastAtTokens: 0, lastAtTurn: 0, running: false, runs: 0, spent: 0, backoff: 1, error: null, focus: null }, paneOpen: false, autoOpened: false, columns: null, saved: { ms: 0, chars: 0 },
})

export type Action =
  | { type: 'turn.start' }
  | { type: 'row'; row: Omit<Row, 'seq'> }
  | { type: 'turn.complete'; stat: Omit<TurnStat, 'turn' | 'calls'> }
  | { type: 'usage'; usage: Usage; now: number }
  | { type: 'overhead'; overhead: { memory: number; mcp: number; agents: number } }
  | { type: 'compact' }
  | { type: 'expand'; patternId: string | null }              // (i) toggled; null collapses
  | { type: 'steer.begin'; patternId: string }
  | { type: 'steer.draft'; text: string }
  | { type: 'decide'; patternId: string; choice: Choice; text?: string }   // text required for steer
  | { type: 'judge.start' }
  | { type: 'judge.done'; patterns: Pattern[]; fresh: string[]; recurred: string[]; focus: string | null; spent: number; error: string | null }
  | { type: 'notes.drained' }
  | { type: 'standing.add'; text: string }
  | { type: 'artifact.done'; patternId: string; kind: ArtifactKind; written: boolean }   // written: true once the rule is handled — written, tried or skipped — and recorded in state.written
  | { type: 'pane'; open: boolean; auto?: true }
  | { type: 'columns'; columns: number }
  | { type: 'reset' }

/** Judge output after validation (section 5.3). */
export type Finding = { id: string; category: Category; kind: string; evidence: string[]; signature: Signature | null; why: string; alternative: string; confidence: number; estTokensPerTurn: number | null; proposal: Proposal | null }

/** UI ↔ shell interface. */
export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>
export type Site = { bodyColumns: number; maxRows: number }
export type Actions = {
  keep(patternId: string): void
  steer(patternId: string): void          // toggles the Steer field under the waster's verbs
  steerDraft(text: string): void          // every keystroke, so redraws keep the text
  steerSubmit(patternId: string, text: string): void  // Enter in the field, or /saver steer <text>
  kill(patternId: string): void
  info(patternId: string): void           // toggles the (i) details
  togglePane(): void
  check(): void                           // run the judge now
  write(a: Artifact): void
  tryOnce(a: Artifact): void
  skip(a: Artifact): void
}
/** View models: computed by patterns.ts from State, rendered by ui.tsx. Keeps the UI free of state logic. */
export type Header = {
  percent: number | null            // context used, 0..100
  spark: number[]                   // percent per recent turn, for the sparkline
  tokensToCompaction: number | null // exact: threshold - tokens
  turnsToCompaction: number | null  // estimate at the recent pace
  judgeRuns: number
  judgeTokens: number               // tokens the judge has spent this session; the pane's JUDGE row
  judgeShare: number                // those tokens as a percentage of the session's, 1 decimal; `/saver debug` only
  judgeRunning: boolean
  savedPct: number
  savedMs: number
}
export type DecidedRow = { patternId: string; choice: Choice; kind: string; savedPct: number | null; ignored: number }
export type PaneModel = {
  header: Header
  wasters: Card[]                   // undecided patterns, newest first
  expanded: string | null
  steering: string | null
  steerDraft: string | null
  decided: DecidedRow[]             // newest first
  artifacts: Artifact[]
}
export type BandModel = { percent: number | null; tokensToCompaction: number | null; fresh: number; savedPct: number; paneOpen: boolean }
export type BandProps = { ui: Ui; model: BandModel; site: Site; actions: Actions }
export type PaneProps = { ui: Ui; model: PaneModel; site: Site; placement: 'dock' | 'inline'; actions: Actions }
