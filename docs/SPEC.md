# ContextSaver — v1 build spec

## Context

ContextSaver is a Claude Code function-hooks plugin ("Claude Mod") that watches a session for wasted context and time (the full test suite after every step, unfiltered log dumps, plan re-summaries, duplicated subagent work), shows a one-click card as soon as a waste behaviour repeats, lets the user tell Claude what to do instead, and on demand turns those decisions into CLAUDE.md rules, skills, briefs and permission rules. Product spec: `docs/PRD.md`. Open source, MIT.

Scope: PRD **v1 only**. v2/v3 items are not built (section 10).

Product decisions taken with the user on 2026-09-17 (they override the PRD's wording):
- **A waste pattern is a behaviour**: "Claude keeps running the full test suite after every step instead of at the end of the implementation."
- **Fix… and Fix are prompts to Claude, not tool blocks.** Fix… (`steer`): the user writes the instruction ("do it by the end of each phase"). Fix (`kill`): the plugin writes it from the pattern — "stop this behaviour; from now on <fix>". Both stay in force for the session. Nothing is ever denied at `tool.check`.
- **Detection is the model's job.** Code gathers evidence (the ledger) and asks the judge a narrow question; no code rule ever decides that something is waste.
- Opus implements; Sonnet only scaffolds; Fable (this session) specifies, reviews, integrates and verifies.

Requirements, all checked against Claude Code 2.1.273:
- API declarations: `.claude/types/claude-code.d.ts` (10,740 lines, stamped 2.1.273; regenerate with `/plugin-types`). Bare line numbers below refer to it.
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test [dir]` (hidden without the flag) runs every `*.test.ts`/`*.test.tsx` under dir in a hooks-like sandbox, exit 1 on failure; `claude plugin validate <path> --strict --json` validates the manifest and the hooks.
- `bun` for the dev scripts and `bunx tsc` for the type-check; the flag is not assumed to be in `~/.claude/settings.json`, so every command sets it explicitly.
- Reference conventions: built-in mods at `https://github.com/anthropics/claude-code/tree/main/mods` (`diff/hooks/register.ts`, `diff/tests/register.test.ts`, `mods/README.md`): host table bound at `session.start`, closure state in `register()`, one `describe` per test file, fixtures under `tests/fixtures/` one export per file.
- Review history: three independent reviewers checked this spec against the d.ts and the PRD; six researchers surveyed coding-agent waste (Claude Code issues, other agents, papers, tools, practitioner rules, multi-agent/time), a synthesizer produced the taxonomy (Appendix B) and the judge prompt, and two adversarial critics (false positives, grounding) revised it (Appendix A). All corrections are folded in.

---

## 1. Design principles (first principles, priority order)

1. **It must work.** Code gathers complete, exact evidence; the judge decides what is waste from a narrow, well-formed question over it; the card and the instruction channel are deterministic. The flagship flow is verified live (section 8).
2. **Never act without a click.** Nothing reaches Claude, and nothing is written, without the user pressing a button. Every hook fails open: any exception → `return next(e)`.
3. **Functional core, imperative shell.** All logic is pure functions over one `State` in `hooks/core/*`. Only `hooks/register.ts` touches events and `$`. `register.ts` never assigns to `state` or a pattern; every change is an `Action` through `reduce`.
4. **One state, one reducer, one renderer.** Band and pane are pure renders of `State`; cards are derived from patterns, not stored text.
5. **Smallest vocabulary that covers the PRD.** One `Signature`. Two text queues (`notes` one-shot, `standing` re-sent). One `Artifact`. One prompt.
6. **A wrong card costs more than a missed one.** The judge prefers silence; the user's Ignore is final for the session; instructions are scoped, never blanket bans.
7. **One designed pane, native to Claude Code, hyper-focused.** The ContextSaver pane (docked beside the transcript in fullscreen, inline above the prompt otherwise, exactly like the built-in `/diff` pane) is the product surface: a two-row header, the live wasters as clean blocks with three verbs each, details behind `i`, decisions and rules as single lines. One accent colour for what the eye must land on — the live `●`, the gauge fill, the newest card's frame — dim for everything else, no inner chrome. The band is one teaser line: a mark, one sentence about where the session stands, and `Open`. Toasts only after a click.

---

## 2. Design decisions

**D0. Code gathers evidence; the model decides.** The ledger records every tool call (tool, normalized key, class, agent, turn, duration, in-context size, flags, edit size, edited paths, subagent metadata) and every main-loop turn (tokens, calls, duration, answer length). Code also pre-computes the deterministic facts the judge would otherwise have to count: per `(tool, key)` aggregates over the whole session (count, total time, total chars, turns spanned, median files edited between consecutive runs), per-class and per-agent totals, the costliest single calls. The judge is asked a constrained question (Appendix A): here are the stats, the recent rows, the nine categories, the patterns already known and the user's decisions; name the behaviours that repeated, cite row ids, copy signatures from these keys, propose the fix, return this JSON. No code-side detectors, so no heuristics or guards to maintain. A card appears at the next judge run; `/saver check` runs it on demand.

**D1. The card is non-blocking; nothing waits on a human.** Hooks have a budget of about ten seconds (9759-9761; overrun = skipped, fail-open, 2842-2844). When the judge reports a behaviour the card appears in the band; the user clicks whenever. No hook waits for a press; `tool.check` is not hooked. A single occurrence is never a finding (Appendix A, rule 1), so first occurrences are never interrupted.

**D2. Fix / Fix… / Ignore are decisions about what to tell Claude.** The three decisions are `kill`, `steer` and `keep` in the code (the `Choice` type) and `✓ Fix`, `✎ Fix…` and `– Ignore` on screen; this document names the label wherever it describes what the user sees. *Ignore* → nothing is sent; the pattern is silent for the session and recorded as a previous-session keep for the judge's calibration afterwards. *Fix…* → the user writes the instruction in a text field that opens inside the waster's card (`Input`, pre-filled with the fix, `autoFocus`, Enter sends; 3745-3787), and `/saver fix [n] <text>` does the same from the composer for keyboard-only use (`/saver fix <n>` and `/saver ignore <n>` are the other two verbs, by the number the card wears). *Fix* → the plugin writes `killPrompt(p)` = "Stop this behaviour for the rest of the session: <kind>. From now on: <alternative>." Both texts are delivered once immediately (`notes`) and with every later prompt (`standing`). Every pattern therefore carries a `kind` phrased as the behaviour ("Claude keeps running `bun test` after every step") and an `alternative` phrased as a scoped fix ("run the full test cycle only when a phase of work is complete; until then run only the tests covering the files you changed").

**D3. Instructions ride the `context` channel, never `prompt.section`.** `ToolCallResult.context` (7966-7974, cap 32,000 chars, `readonly string[]`) is read by the model right after that tool result; `PromptSubmitInput.context` (5711-5719) is read with the next prompt, exactly as the `diff` mod rides its "ask". `notes` drain into whichever comes first; `standing` texts are appended to every prompt's context. `prompt.section` is not used (invalidating it spends the prompt cache the judge's fork needs, 2999-3010).

**D4. Ignored instructions come back to the user.** If a steered or killed behaviour recurs (a signature key seen again, or the judge re-reports the id with evidence after the decision), the instruction counts as ignored (PRD: saved = 0, "steer ignored"), and the card returns once so the user can Ignore it or send a different instruction. If it does not recur for two turns, the baseline is credited as saved.

**D5. The judge is `$.model.fork`, detached, from `turn.complete` and from any ledger row inside a long turn.** `fork({ prompt })` is the only field (4146-4157); it runs over the session's own transcript with the shared prompt cache and returns `{ text, usage } | null` (null on cold snapshot or API error) or rejects if another plugin denies it. **It runs on the session's own model** (2019-2034); there is no override. `$.model.complete({ model: 'haiku', … })` (4122-4144) sees no transcript so it cannot judge intent; not used in v1. Since the model is fixed, the prompt is the whole detector (Appendix A). Never awaited inside a hook: `void runJudge('tool.call' | 'turn.complete')` gated by the cadence (tokens and turns, or rows and wall time inside one turn), or `void runJudge('/saver check' | 'load')` from `Check now`, `/saver check` and the check a load armed, each answered with a toast. A plugin loaded into a session that already has history arms one check there (`pendingCheck`) and fires it from `session.start` itself, detached: a session with that much history behind it has run turns, so the snapshot the fork reads is the last one's, not a cold one. The arming is what makes it safe — a fork that does come back null (a genuinely cold snapshot, an API error) leaves it standing, and the first warm opportunity retries it: the person's next prompt, the first ledger row, or the turn's end, whichever comes first and whatever the cadence says.

**D6. Signatures are `(tool, key)` copied from the ledger.** One normalizer computes `key` from the tool's arguments only (reserved `tool`, `tool_use_id`, `agentId`, `consent` stripped; `tool.call` spreads args flat on `e`, 7892-7910). The judge copies `(tool, key)` from one ledger row; `parseReply` validates the pair. Rows are shown with short aliases `r<seq>`; `parseReply` maps them back. Costs are computed by us from evidence rows, never trusted from the model.

**D7. Dedupe by id reuse.** The judge prompt carries known pattern ids and must reuse one for the same waste; a keep silences the behaviour under any id. `$.model.classify` is not used.

**D8. Measure, don't read.** `ms` around `await next(e)` via `$.clock.now()` (BUILD-NOTES line 37: time inside `next()` is excluded from the hook budget; re-verified in section 8); `chars = result.text?.length ?? 0` (in-context cost; a persisted Bash output counts only its preview and is flagged `persist=N`). `pct = chars / 4 / window × 100`. The card leads with time when pct rounds to 0.

**D9. Own calls are filtered.** Rows are skipped when `next.origin.plugin === PLUGIN_NAME`.

**D10. The pane is the surface; the band is the doorbell.** `$.ui.open({ id })` opens one framed region whose body is drawn by the `ui.render` hook for `{ component: 'Pane', requestId }` (1939-1955, 5929-5936); the surface docks it beside the transcript in fullscreen from 110 columns, else seats it inline above the prompt (`e.props.placement`, 6588-6635); it redraws on `$.ui.invalidate('ui.render')` and takes the terminal element table: `Box` (flex layout, borders, `key` + `hover` restyling with no round trip, 518-571), `Text` (colour, dim, bold, wrap, 7814-7836), `Button` (click, or Tab and Enter; digit hotkeys are band-only, 651-659), `Input` (a text field with `onSubmit`, 3745-3787). All four exist on Desktop too, so the pane draws there unchanged; `Raster`/`Client`/`Code` are not needed for v1. `/saver` toggles it and is placed at any width because it answers the person, asking for the keyboard as it opens (`focus: true` is a request the surface grants only from an empty composer, 4915-4922; `ctrl+x tab` is the person's own way to give it, 6586-6596); a fresh card auto-opens it once per session when the terminal is wide (unasked opens wait undrawn below 144 columns, 1943-1945, so the attempt is harmless), like `/diff` opening on the first edit. The AbovePrompt band shows one teaser line — the mark and one sentence: a check in flight, what the waiting cards would save, what the session already saved, else the calls it is watching — and an `Open`/`Close` button. Everything the user can do lives in the pane.

---

## 3. Repository layout

```
ContextSaver/
  .claude-plugin/plugin.json         { name: "contextsaver", version, description, author, license }
  .claude-plugin/marketplace.json    { name: "contextsaver", owner: { name }, plugins: [{ name: "contextsaver", source: "./" }] }
  .claude/types/claude-code.d.ts     the engine's own declarations (committed; regenerate with /plugin-types)
  hooks/hooks.json                   { "description": "...", "modules": ["./register.ts"] }
  hooks/register.ts                  imperative shell (section 6)
  hooks/host.ts                      `Host` type (section 6)
  hooks/core/types.ts                shared contract (section 4)
  hooks/core/text.ts                 pure helpers with fixed signatures (section 5.0)
  hooks/core/ledger.ts               classOf(), normalize(), rowOf()                         (WP1)
  hooks/core/adopt.ts                adoptRows()                                             (section 5.1a; the transcript of a session joined late)
  hooks/core/evidence.ts             rowsOf(), sumOf(), baseline(), agentAliases(), aliasOf()    (done; shared by WP2, WP3 and WP5)
  hooks/core/patterns.ts             reduce, cardOf, paneModel, bandModel, registry (de)serialisation, debugDump   (WP2)
  hooks/core/blocks.ts               aggregate(), ledgerLine(), summaryLine(), statsLines(), the four prompt blocks   (WP3)
  hooks/core/judge.ts                shouldRun(), buildPrompt(), parseReply(), merge(); JUDGE_PROMPT (Appendix A, verbatim)   (WP3)
  hooks/core/rules.ts                propose(), templates, mergeSettings()
  hooks/core/demo.ts                 demoRows(), demoPatterns() — the sample session behind the debug-only `/saver demo`
  hooks/say/en.ts                    the complete bundle and its types: Texts, PartialTexts, EN            (section 12)
  hooks/say/fr.ts                    French, as PartialTexts; es.ts de.ts zh-CN.ts ja.ts likewise
  hooks/say/say.ts                   LANGUAGES, sayOf(), setSay(), say()
  hooks/say/index.ts                 re-exports, so every module imports from one place
  hooks/ui.tsx                       Band(), RulesPane()
  tests/{ledger,adopt,patterns,judge,rules,demo,say}.test.ts  tests/ui.test.tsx  tests/register.test.ts  tests/fixtures/*
  scripts/check.sh  scripts/smoke.sh  tsconfig.json  README.md  LICENSE  .gitignore
```

`tsconfig.json` (verbatim from the d.ts header / `mods/tsconfig.json`):
```json
{ "compilerOptions": { "target": "es2023", "lib": ["es2023"], "types": [], "module": "esnext",
    "moduleResolution": "bundler", "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true,
    "skipLibCheck": true, "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment" },
  "include": [".claude/types", "hooks", "tests"] }
```

---

## 4. Shared contract — `hooks/core/types.ts`

```ts
import type { Elements } from 'claude-code'

export const PLUGIN_NAME = 'contextsaver'
export const PANE_ID = 'saver'
export const PANE_TITLE = 'ContextSaver'
export const PANE_INLINE_ROWS = 18            // body rows requested when seated inline above the prompt (the compact card is framed)
export const AUTO_OPEN_MIN_COLUMNS = 144      // unasked opens wait undrawn below this width (d.ts 1943-1945)
export const STEER_RING_TRIES = 8             // frames the Fix… field's ring is asked for before the composer route is said
export const STEER_RING_WAIT_MS = 40          // a frame and a little: the shown pane redraws at most thirty times a second
export const COMMAND = { name: 'saver', description: 'ContextSaver: toggle the pane · check | fix [n] [text] | ignore <n> | debug | reset', argumentHint: '[check | fix [n] [text] | ignore <n> | debug | reset]' } as const
export const SETTLE_TURNS = 2                 // an instruction not ignored for this many turns is credited
export const JUDGE_MIN_NEW_TOKENS = 30_000
export const JUDGE_MIN_TURNS = 3
export const JUDGE_MIN_ROWS = 8
export const JUDGE_MAX_BACKOFF = 4
export const JUDGE_BUDGET_SHARE = 0.03
export const JUDGE_LEDGER_ROWS = 150          // full rows rendered; older rows are folded into `~` summary lines
export const MAX_FINDINGS = 6
export const MAX_BEHAVIORAL_FINDINGS = 3      // findings with signature: null per judge run (agent findings are signature-null too)
export const MAX_PATTERNS = 50
export const ROW_CAP = 2000
export const KIND_MAX = 120
export const ALTERNATIVE_MAX = 200
export const KEY_MAX = 200
export const DEBUG_MAX_LINES = 40             // `/saver debug` ceiling
export const DEBUG_MAX_PATTERNS = 16          // pattern lines `/saver debug` prints before folding the rest
export const DEBUG_MAX_DROPPED = 6            // dropped-finding reasons `/saver debug` and the debug log print
export const BRIEF_TOOLS = 'Read, Grep, Glob' // the tools an agent brief allows when the proposal names none
export const FILE_TOOLS: readonly string[] = ['Read', 'Edit', 'Write', 'NotebookEdit']   // tools whose ledger key is the path they touched
export const CLAUDE_MD_HEADING = '## ContextSaver'
export const RECOVERED_FLAG = 'recovered'     // `Row.flags` marker for a row rebuilt from the transcript: its `ms` is 0 and its agent reads `main`
export const MAIN_AGENT = 'main'              // `Row.agent` of the main loop; the alias table leaves it as it is
export const NO_CALLS = 'no tool calls'       // `Evidence.what` of a turn handle: that turn ran none
export const CARD_EVIDENCE = 3                // cited calls one card's details show, newest first
export const JUDGE_MIN_NEW_ROWS = 40          // mid-turn cadence: ledger rows since the last run (a turn can last hours)
export const JUDGE_MIN_GAP_MS = 300_000       // mid-turn cadence: at least five minutes between runs
export const TREND_TURNS = 10                 // context samples the header's trend draws
export const SINKS = 3                        // named sinks the Time and Context rows show
export const LOOP_CAP = 400                   // loops kept (oldest dropped)
export const AGENTS_ROWS = 60                 // loop lines the AGENTS block renders in full; older ones fold per run
export const RUN_REFRESH_MS = 10_000          // a running workflow's journal is re-read at most this often
export const RUN_FRESH_MS = 600_000           // a run with no loop yet counts as active this long after its launch

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
  flags: string[]          // 'err' (tool reported an error) | 'denied' (result.deny: the user or a policy said no) | 'dedup' (Read type 'file_unchanged') | 'trunc' (truncatedByTokenCap) | 'bg' (run_in_background or backgroundTaskId) | 'timeout' (timedOutAfterMs) | `persist=${persistedOutputSize}` | 'ask' (AskUserQuestion: ms is the wait for the person) | 'recommended' (an ask whose questions carry '(Recommended)') | 'recovered' (rebuilt from the transcript at load: ms is 0 and agent reads 'main')
  lines: { add: number; del: number } | null   // Edit: gitDiff.additions/deletions else counted from structuredPatch; Write: content line count as add
  paths: string[]          // absolute paths this call edited (Edit/Write filePath unless staged; Bash bashEditDiff.changedFiles)
  spawn: { type: string; requested: string | null; resolved: string | null; status: string | null; tokens: number | null; edits: number | null; promptChars: number } | null   // Agent rows only
}
export type TurnStat = { turn: number; input: number; output: number; cacheRead: number; cacheCreate: number; calls: number; ms: number; answerChars: number; answerHead: string; aborted: boolean; ended: TurnEnd; at: number; idleMs: number; context: number | null }   // answerHead: first 100 chars of e.answer, for evidence quotes; ended: how the turn ended; at: clock at completion; idleMs: wait until the next turn started (0 until it does); context: tokens in the window after the turn (usage), null when unknown — growth between turns is the pace compaction runs at
export type TurnEnd = 'answer' | 'aborted' | 'refusal' | 'error'
export type Tokens = { input: number; output: number; cacheRead: number; cacheCreate: number }
export type Outcome = { kind: 'findings'; critical: number; high: number; medium: number; low: number } | { kind: 'report'; chars: number }
export type Loop = { id: string; run: string | null; label: string | null; phase: string | null; model: string | null; turns: number; ms: number; tokens: Tokens; ended: TurnEnd | null; firstTurn: number; firstSeq: number; outcome: Outcome | null; calls: number; edits: number; checks: number; reads: number }   // one spawned agent loop: `id` is its agentId (the ledger's `agent`), `run` the workflow run that launched it, `ended` null while it runs; calls/edits/checks/reads count its own rows as they land, so the line stays whole once ROW_CAP drops them
export type Folded = { tool: string; key: string; cls: CommandClass; agent: string; count: number; ms: number; chars: number; firstTurn: number; lastTurn: number; flags: { ask: number; recommended: number; err: number } }   // one (tool, key) pair's rows dropped past ROW_CAP: nothing citable, everything counted; `agent` is 'main' or the first loop seen
export type Run = { id: string; name: string; dir: string | null; turn: number; seq: number; at: number; refreshedAt: number }   // at: clock at launch; refreshedAt: last journal read (0 never)
export type JournalEntry = { kind: 'started'; agentId: string; label: string | null; phase: string | null } | { kind: 'result'; agentId: string; outcome: Outcome }
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
  alternative: string              // the fix, one imperative sentence ≤ 200 chars written for Claude; pre-fills Fix…, completes Fix
  confidence: number               // 0.5..1
  proposal: Proposal | null
  estTokensPerTurn: number | null  // judge's estimate for behavioural patterns; null when a signature exists
  lastDecision: Choice | null      // the most recent session's decision, for the judge's calibration
}
/** Session-only fields. */
export type Pattern = StoredPattern & {
  hits: string[]                   // evidence handles: row ids (tool_use_id), `turn:<n>` or `agent:<agentId>`; grows with matching rows; cost/baseline from rows only
  decision: Choice | null
  decidedAtTurn: number | null
  instruction: string | null       // the text sent for steer/kill
  openedAtTurn: number | null      // turn of the last steer/kill; settles saved (credited or ignored)
  ignored: number                  // times the instruction was ignored
}

/** What one fork of the judge cost, in the four token counts the API reports. */
export type JudgeUsage = { input: number; output: number; cacheRead: number; cacheCreate: number }
/** What one judge run reported: findings returned, findings kept, one short line per drop and per cap a kept finding missed, and what the fork cost (null when it returned nothing). */
export type JudgeRun = { returned: number; kept: number; dropped: readonly string[]; usage: JudgeUsage | null }

/** One cited call (or turn) as the details render it: what ran, in which loop, what it cost, what it answered. */
export type Evidence = {
  turn: number
  what: string             // the command for Bash, the path for a file tool, `tool key` otherwise; NO_CALLS for a turn handle
  agent: string | null     // the loop's alias (a1, a2…), null when it was the main loop's own call
  ms: number               // 0 when nothing measured it (a turn handle, a recovered row)
  chars: number            // in-context size of the result, or of the turn's answer
  head: string             // the first line of what came back, quoted under the call; '' when there is none
}
/** One waster as the pane draws it: the behaviour, the stats, the fix, and the receipts behind `i`. */
export type Card = {
  patternId: string
  n: number                // 1-based seat in the pane's list, top to bottom
  category: Category       // the dim tag on the title row
  kind: string
  stats: string
  why: string
  fix: string
  total: { unit: 'calls' | 'turns' | 'agents'; calls: number; ms: number; chars: number }   // cited calls, their wall time and their context; `unit: 'turns'` when the pattern cites turns instead, so `calls` counts turns and `chars` is the per-turn estimate; `unit: 'agents'` when it cites loops, so `calls` counts loops and `ms` is their sum
  evidence: readonly Evidence[]                          // ≤ CARD_EVIDENCE cited calls, newest first
}
export type Artifact = { patternId: string; kind: ArtifactKind; title: string; path: string; content: string; savingPct: number; mode: 'append' | 'write' | 'merge-settings' }
export type Usage = { tokens?: number; window: number; percent?: number; compactAt?: number }

export type State = {
  cwd: string
  turn: number
  seq: number                      // last Row.seq issued
  rows: Row[]                      // capped at ROW_CAP (oldest dropped)
  folded: Record<string, Folded>   // the rows ROW_CAP dropped, folded per `${tool}\t${key}`: STATS, the LEDGER's `~` lines and the sinks count them, so a long session's totals stay whole
  turns: TurnStat[]
  loops: Loop[]                    // every agent loop seen, oldest first, capped at LOOP_CAP (oldest dropped)
  runs: Run[]                      // every Workflow launched this session, oldest first
  usage: Usage
  overhead: { memory: number; mcp: number; agents: number } | null
  compactions: number[]            // turn indices at which session.compact fired
  patterns: Pattern[]
  cards: string[]                  // pattern ids awaiting a decision, newest first (the pane's WASTERS list)
  expanded: string | null          // pattern id whose (i) details are open; one at a time
  steering: string | null          // pattern id whose Fix… field is open
  steerDraft: string | null        // what the person has typed so far: every render draws it back into the field, so a redraw for any other reason never wipes it
  notes: string[]                  // one-shot texts: drained into the next tool result or prompt
  standing: string[]               // texts re-sent with every prompt this session
  written: string[]                // `${patternId}:${kind}` of artifacts written, tried or skipped this session; propose() omits them
  judge: { lastAtTokens: number; lastAtTurn: number; lastAtSeq: number; lastAtMs: number; running: boolean; runs: number; spent: number; backoff: number; error: string | null; focus: string | null; time: string | null; context: string | null; last: JudgeRun | null }   // lastAtSeq/lastAtMs: the mid-turn cadence; time/context: the judge's one-line explanations of where they went
  pendingCheck: boolean            // a check armed at load and not yet answered: a plugin that joined a session with history fires one there and retries it at every warm opportunity until a run answers (§6)
  paneOpen: boolean
  autoOpened: boolean              // the pane auto-opened once this session (like /diff on the first edit)
  columns: number | null           // last band width seen (e.props.bodyColumns), for the auto-open decision
  saved: { ms: number; chars: number }
}

export const initialState = (cwd: string, window: number): State => ({
  cwd, turn: 0, seq: 0, rows: [], folded: {}, turns: [], loops: [], runs: [], usage: { window }, overhead: null, compactions: [], patterns: [], cards: [], expanded: null, steering: null, steerDraft: null, notes: [], standing: [], written: [],
  judge: { lastAtTokens: 0, lastAtTurn: 0, lastAtSeq: 0, lastAtMs: 0, running: false, runs: 0, spent: 0, backoff: 1, error: null, focus: null, time: null, context: null, last: null }, pendingCheck: false, paneOpen: false, autoOpened: false, columns: null, saved: { ms: 0, chars: 0 },
})

export type Action =
  | { type: 'turn.start'; now: number }                        // now: dates the idle wait since the last completed turn
  | { type: 'loop.turn'; agentId: string; model: string | null; ms: number; tokens: Tokens; ended: TurnEnd; turn: number }   // one turn of an agent loop completed
  | { type: 'agent.start'; agentId: string; description: string; model: string | null }   // an Agent tool result: names the loop
  | { type: 'run.start'; run: { id: string; name: string; dir: string | null }; now: number }   // a Workflow tool result: a run launched (an id already present is a resume)
  | { type: 'run.journal'; runId: string; entries: JournalEntry[]; now: number }   // a run's journal read: stages and outcomes of its loops
  | { type: 'row'; row: Omit<Row, 'seq'> }
  | { type: 'adopt'; rows: readonly Omit<Row, 'seq'>[] }      // rows rebuilt from the transcript of a session joined late
  | { type: 'turn.complete'; stat: Omit<TurnStat, 'turn' | 'calls'> }
  | { type: 'usage'; usage: Usage; now: number }
  | { type: 'overhead'; overhead: { memory: number; mcp: number; agents: number } }
  | { type: 'compact' }
  | { type: 'expand'; patternId: string | null }              // (i) toggled; null collapses
  | { type: 'steer.begin'; patternId: string }
  | { type: 'steer.draft'; text: string }
  | { type: 'decide'; patternId: string; choice: Choice; text?: string }   // text required for steer
  | { type: 'judge.start'; now: number; seq: number }        // when and at which ledger row the run began, for the mid-turn cadence
  | { type: 'judge.done'; patterns: Pattern[]; fresh: string[]; recurred: string[]; focus: string | null; time: string | null; context: string | null; spent: number; error: string | null; returned: number; kept: number; dropped: readonly string[]; usage: JudgeUsage | null }
  | { type: 'check.arm' }                                      // the ledger a session.start adopted already passes the row floor: judge it there, and again at the next warm opportunity if that run answers nothing
  | { type: 'notes.drained' }
  | { type: 'standing.add'; text: string }
  | { type: 'artifact.done'; patternId: string; kind: ArtifactKind; written: boolean }   // written: true once the rule is handled — written, tried or skipped — and recorded in state.written
  | { type: 'pane'; open: boolean; auto?: true }
  | { type: 'columns'; columns: number }
  | { type: 'reset' }

/** Judge output after validation (section 5.3). */
export type Finding = { id: string; category: Category; kind: string; evidence: string[]; signature: Signature | null; why: string; alternative: string; confidence: number; estTokensPerTurn: number | null; proposal: Proposal | null }

/** UI ↔ shell interface. */
export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input' | 'Raster'>
export type Site = { bodyColumns: number; maxRows: number }
export type Actions = {
  keep(patternId: string): void
  steer(patternId: string): void          // toggles the Fix… field under the waster's verbs
  steerDraft(text: string): void          // every keystroke: the state keeps the text and the redraw is what paints it
  steerSubmit(patternId: string, text: string): void  // Enter in the field, or /saver fix <text>
  kill(patternId: string): void
  info(patternId: string): void           // toggles the (i) details
  togglePane(): void
  check(): void                           // run the judge now
  write(a: Artifact): void
  tryOnce(a: Artifact): void
  skip(a: Artifact): void
}
/** View models: computed by patterns.ts from State, rendered by ui.tsx. Keeps the UI free of state logic. */
export type Sink = { label: string; amount: number; count: number }   // one named consumer: `tests`, `reads`, `agents`, `git`…; amount in ms (time) or chars (context)
export type Sinks = { total: number; sinks: readonly Sink[] }         // total over every ledger row of the main loop plus the agents' own rows (Agent spawn rows excluded: they contain their loop's rows); the SINKS largest named
export type Header = {
  percent: number | null            // context used, 0..100
  tokensToCompaction: number | null // exact: threshold - tokens
  turnsToCompaction: number | null  // estimate at the recent pace: tokens to compaction / median context growth per turn
  trend: readonly number[]          // context percent after each of the last TREND_TURNS turns, oldest first; [] before the first
  time: Sinks | null                // where the wall-clock went, from the ledger; null before the first row
  context: Sinks | null             // where the context went, from the ledger; null before the first row
  judgeTime: string | null          // the judge's one-line explanation of the time, verbatim; null until it has run
  judgeContext: string | null       // the judge's one-line explanation of the context
  judgeRuns: number
  judgeTokens: number               // tokens the judge has spent this session; the pane's JUDGE row
  judgeShare: number                // those tokens as a percentage of the session's, 1 decimal; 0 while the session has none; `/saver debug` only
  judgeRunning: boolean             // a run is in flight: Check now reads `Checking…`, dims, and ignores presses
  savedPct: number
  savedMs: number
}
export type DecidedRow = {
  patternId: string
  choice: Choice
  kind: string
  savedPct: number | null   // what one avoided repeat is worth; a rate until `settled`, a credit after it
  settled: boolean          // the instruction was neither ignored nor still in flight, so the saving is real
  instruction: string | null   // the sentence the user sent, when it is not the fix the card offered
  ignored: number
}
export type PaneModel = {
  header: Header
  wasters: Card[]                   // undecided patterns, newest first
  expanded: string | null
  steering: string | null
  steerDraft: string | null
  decided: DecidedRow[]             // newest first
  artifacts: Artifact[]
}
/** The band's one teaser line: which of the four states the session is in, and the figures that state names. */
export type BandModel = {
  state: 'died' | 'checking' | 'found' | 'saved' | 'watching'   // the first that applies: the last turn died, a judge run in flight, cards waiting, a saving credited, else watching
  died: TurnEnd | null     // the last turn's `ended` when it was an error or a refusal and no turn has started since
  running: { name: string; loops: number; calls: number; label: string | null } | null   // the newest active workflow run: its loops, their rows, the newest unended loop's stage
  fresh: number            // cards awaiting a decision
  costPct: number          // what those cards have already cost, as a share of the window
  costMs: number           // and in wall time
  savedPct: number
  savedMs: number
  calls: number            // ledger rows watched this session
  paneOpen: boolean
}
export type BandProps = { ui: Ui; model: BandModel; site: Site; actions: Actions }
export type PaneProps = { ui: Ui; model: PaneModel; site: Site; placement: 'dock' | 'inline'; actions: Actions }
```

---

## 5. Module contracts (pure core)

### 5.0 `hooks/core/text.ts` (WP0; signatures fixed so WP1-5 can depend on it)
```ts
export const median = (xs: number[]): number => ...                         // 0 for []
export const pctOf = (chars: number, window: number): number => ...           // chars/4/window*100, 1 decimal
export const pctLeft = (u: Usage): number | null => ...                       // 100 - percent, null when percent undefined
export const duration = (ms: number): string => ...                           // '11m', '3m 50s', '12s'
export const slug = (s: string): string => ...                                // kebab, ≤ 40 chars
export const collapseWs = (s: string): string => ...
export const stableJson = (v: unknown, omit: readonly string[]): string => ...   // sorted keys, omits names at the top level
export const fit = (text: string, cells: number): string => ...               // truncated with '…', never a space before it
export const tokensOf = (chars: number): number => ...                        // chars / 4, rounded
export const gauge = (percent: number, width: number): string => ...          // '████░░░░'
export const instructionOf = (text: string): string => `Instruction from the user (via ContextSaver): ${text}`
export const killPrompt = (p: StoredPattern): string => `Stop this behaviour for the rest of the session: ${p.kind}. From now on: ${p.alternative}`
```

### 5.1 `hooks/core/ledger.ts` (WP1)
- `classOf(command: string): CommandClass` — first token(s) after stripping leading `cd x &&`, `VAR=val`, and `npx|bunx|pnpm|yarn|npm run|bun run|bun x`. Table: test (`jest vitest pytest go test cargo test npm test bun test mocha`), lint (`eslint ruff flake8 golangci-lint biome lint`), format (`prettier black gofmt rustfmt biome format`), typecheck (`tsc mypy pyright`), build (`make build cargo build go build vite webpack docker build`), install (`npm install|npm i|bun install|bun add|pnpm install|pnpm add|yarn add|yarn install|pip install|uv pip|cargo fetch|apt-get install|brew install`), git (`git gh`), read (`cat head tail less ls tree sed`), search (`grep rg ag find fd ast-grep`), else `other`.
- `normalize(tool: string, input: unknown): { key: string; cls: CommandClass }` — reads fields defensively from `input as Record<string, unknown>`:
  - Bash → `cls = classOf(command)`, `key = \`${cls}:${collapseWs(command).slice(0, KEY_MAX)}\``.
  - Read/Edit/Write/NotebookEdit → `key = file_path` (+ `:${offset ?? ''}-${limit ?? ''}` for Read); cls `read` for Read else `other`.
  - Grep/Glob (untyped in this build) → `key = \`${tool}:${pattern ?? ''}:${path ?? ''}\``, cls `search`.
  - Agent → `key = \`agent:${subagent_type ?? 'general'}\``, cls `other`.
  - otherwise → `key = \`${tool}:${stableJson(input, ['tool','tool_use_id','agentId','consent']).slice(0, KEY_MAX)}\``, cls `other`.
- `rowOf(e, result, ms, turn): Omit<Row, 'seq'>` — `normalize(e.tool, e)`; `chars = result.text?.length ?? 0`; `head = stripControl(result.text ?? '').slice(0, 80)`; `flags` per the `Row.flags` legend (`result.isError` → `err`; `result.deny !== undefined` → `denied`; Read `result.type === 'file_unchanged'` → `dedup`, `result.file.truncatedByTokenCap` → `trunc`; Bash `e.run_in_background || result.backgroundTaskId` → `bg`, `result.timedOutAfterMs` → `timeout`, `result.persistedOutputSize` → `persist=N`); `lines` for Edit/Write; `paths` from Edit/Write `result.filePath` unless `staged === true`, Bash `result.bashEditDiff?.changedFiles ?? []`; `spawn` for Agent rows from `e.subagent_type`, `e.model`, `e.prompt.length` and `result.resolvedModel/status/totalTokens/toolStats.editFileCount`. Every field read defensively; result shapes at 10277-10358 (Bash), 10453-10544 (Read), 10378-10411 (Edit), 10707-10738 (Write), 10191-10276 (Agent).
- Tests: class table incl. prefixes and the `install`/`search` classes; normalizer gives the same key for a flat `tool.call` envelope (with `tool_use_id`) and for bare args, for Bash, Read, an MCP tool and an unknown tool; `rowOf` on answered / errored / denied / deduped / persisted / background / Agent fixtures (fixtures carry `text`).
- Rendering rows for the judge (`ledgerLine`, `summaryLine`, `aggregate`, `statsLines`, `sinksBlock`) is the judge's input format and lives in `blocks.ts` (section 5.3), not here. `cls` is also what names a Bash row's sink in the TIME and CONTEXT blocks and in the pane's header (`sinks`, section 5.2), so the class table is read by the judge and by the user, not only by the aggregates.

### 5.1a `hooks/core/adopt.ts` — the transcript of a session joined late
- `adoptRows(messages: readonly SessionMessage[]): readonly Omit<Row, 'seq'>[]` — every finished `toolUse` of every assistant message becomes a row through `rowOf` (`ms = 0`, `turn` derived below, `RECOVERED_FLAG` appended after `flagsOf` so a flag the call earned — `err`, `dedup` — still reads first); the newest `ROW_CAP` rows are kept. So a plugin enabled mid-session has evidence to judge instead of starting blind.
- Two rules the derivation encodes, both deliberately conservative:
  - Only a **prompt** starts a turn — a `role: 'user'` message with typed text and no `toolResults`; a user message of tool_result blocks is the tool loop, and a text-free one is a message the engine queued itself. A row's turn is `max(1, prompts seen so far)`. Truncation, or a call in flight at load, can therefore merge two real turns, but nothing can split one: the judge's "two occurrences in two different turns" shape can only be under-reported from history, never manufactured.
  - A `toolUse` with neither `result` nor `text` is **still in flight** — no size, no outcome — and is not a row.
- The transcript records no duration and no agent, so `ms` is 0 (excluded from `baseline().ms`, section 5.2, or the time half of SAVED would collapse to zero) and `agent` reads `main`; a refusal was stored as its error text, so a `recovered` `err` may be a `denied` — Appendix A tells the judge to read it that way and never as waste.
- Tests (`tests/adopt.test.ts`): a joined transcript becomes rows, one turn per prompt, with the tool loop and a text-free user entry inside the same turn; a call in flight is no row; Edit paths/lines and Agent spawn fields come back; a transcript longer than `ROW_CAP` keeps the newest rows; nothing to adopt yields no rows.

### 5.2 `hooks/core/patterns.ts` (WP2)
- No detectors live here (D0). This module keeps the evidence, applies decisions, accounts savings, and computes the UI's view models.
- `rowsOf`, `sumOf(rows)`, `baseline` and the loop names (`agentAliases(rows)` → `main` stays `main`, every other agent id becomes `a1`, `a2`… in order of first appearance; `aliasOf(aliases, agent)`) are in `hooks/core/evidence.ts` (already written and tested; import them). `baseline().ms` is the median over the **timed** rows only — a `recovered` row's duration was never recorded, so counting its 0 would drag the time half of SAVED to nothing; `baseline().chars` counts every cited row, since transcript text lengths are real.
- `sinks(rows, measure: 'ms' | 'chars'): Sinks` is in `evidence.ts` too — where the wall-clock or the context went, from the rows alone. `total` sums every row except the Agent spawn rows (a spawn row's cost is its own loop's rows again, so counting both would double the agents); a recovered row lends its `chars` and never its unrecorded `ms`. Each row is named by the job it did: a Bash row by its class (`tests`, `git`, `builds`, `installs`, `searches`, `reads` for a read-class command, `commands` otherwise), Read → `reads`, Grep/Glob → `searches`, Edit/Write → `edits`, Agent → `agents` (named beside the total, never inside it), any other tool by its own name. `sinks` returns the `SINKS` largest by amount, each with its `count`, ties broken by label so two draws of the same ledger read the same.
- `paneModel(state, artifacts): PaneModel` and `bandModel(state): BandModel` (types in §4) — the only things `ui.tsx` renders. `header.judgeTokens = judge.spent` (what the pane shows) and `header.judgeShare = round(judge.spent / totalTokens × 1000) / 10`, and 0 while `totalTokens` is 0 — before the first turn reports its tokens there is no denominator, and a share of nothing printed `2394600%` (kept for `/saver debug`, which prints `-` for that no-figure); `wasters = cards.map((id, at) => cardOf(pattern, state, at + 1))` — numbered as they are drawn, so `/saver keep 2` names the card the person is looking at; `decided` = patterns with a decision, newest `decidedAtTurn` first, `savedPct` = `pctOf(baseline.chars, window)` for steer/kill else null, `settled` = that figure is credit rather than a projection (a steer/kill with `openedAtTurn === null` and `ignored === 0`, D4), `instruction` = the sentence a steer sent when it is not the `alternative` the card offered (a kill sends the `kind` and the fix the row already carries, so it shows none); `fresh` = `cards.length`.
- `bandModel(state)` is the band's four states, the first that applies winning: `checking` while `judge.running`, `found` while a card waits, `saved` once `saved.chars` or `saved.ms` is positive, else `watching`. `costPct`/`costMs` are what the waiting cards have already cost — Σ of `totalOf(p)` over `cards`, characters through `pctOf` and milliseconds as they are — `savedPct`/`savedMs` the session's credit, and `calls` = `rows.length`, the row the `watching` line counts.
- The header's own three answers to "where did it go": `trend` = how full the window was after each of the last `TREND_TURNS` turns that reported a `context`, as a percentage of the window, oldest first, turns with no sample skipped (`[]` before the first); `time` = `sinks(rows, 'ms')` and `context` = `sinks(rows, 'chars')`, both null before the first row (a total of zero would read as a session that cost nothing); `judgeTime`/`judgeContext` = `judge.time`/`judge.context` verbatim, the judge's own one-line explanations, null until it has run. `judgeRunning` = `judge.running`, so `Check now` can read `checking…` and the band can say a check is in flight with the pane closed.
- `cardOf(p, state, n): Card` — `n` is the card's seat in the pane's list; `kind = p.kind` (prefixed `ignored · ` when `p.ignored > 0`); `stats = \`${hits}× · ~${pct(Σchars)}% of context · ${duration(Σms)} · turns ${first}–${last}\`` (en dash; `turn ${first}` when one turn carries it all; omit a pct segment that rounds to 0, and the duration when the evidence carries none — turn handles, recovered rows — since `0s` would state a suite that ran for minutes cost nothing); `why = p.why`; `fix = p.alternative` (there is no `killText`: Kill sends `killPrompt(p)`, which is the `kind` and the `fix` the card already shows).
- `cardOf(p, state, n, aliases)`'s numbers and receipts, for the details behind `i`: the pattern's rows are filtered once and handed to every part of the card, and `paneModel` builds `aliases = agentAliases(state.rows)` once for the whole draw rather than once per card (the pane redraws on every ledger row and every keystroke in the Steer field). `total` = `{ unit: 'calls', calls: cited rows, ms: Σms, chars: Σchars }`, or, when no cited row exists (a behavioural finding cites turns), `{ unit: 'turns', calls: cited turns, ms: 0, chars: (estTokensPerTurn ?? 0) × 4 }` — the unit is stated here because a finding may cite rows and turn handles together, so the drawing must never infer it from the three handles it kept; `evidence` = the newest `CARD_EVIDENCE` cited handles as `Evidence` records (§4) — a row gives `what` = the command for Bash (class prefix stripped), the path for a `FILE_TOOLS` tool (a Read's `:offset-limit` slice stripped), else `\`${tool} ${key}\``, `agent` = the loop's alias from `aliases` and **null for the main loop**, `ms`, `chars` and `head` as recorded; a turn handle gives `what = NO_CALLS`, `agent = null`, `ms = 0`, `chars = answerChars`, `head = answerHead`. No string is formatted here: `ui.tsx` lays the record out (§5.5).
- `reduce(state, action): State` — one case per action:
  - `turn.start` → `turn += 1`.
  - `row` → `seq += 1`, append with that seq (drop oldest past `ROW_CAP`); for every pattern whose `signature` equals `(row.tool,row.key)` push `row.id` to `hits`; **settle instructions** (main-loop rows only, and only rows with `row.turn > openedAtTurn`, since a row in the decision's own turn was already in flight before Claude could read the instruction): for each pattern with `openedAtTurn !== null` and `decision ∈ {steer, kill}`: a row with `row.key === p.signature?.key` → ignored (`ignored += 1`, `openedAtTurn = null`, re-queue the card, every time, so the user can respond again); else a row with `row.cls === cls(p)` and a different key → the alternative: `saved += max(0, baseline − rowCost)`, `openedAtTurn = null`.
  - `adopt` → the rows of section 5.1a, in order, as `row` numbers them: `seq` continues where the session left it, oldest dropped past `ROW_CAP`, and a matching `signature` grows its `hits` (so a remembered pattern arrives armed). Then `turn = max(turn, newest adopted turn)` and `judge.lastAtSeq = seq`, so the mid-turn cadence counts from the end of the history: without it a session that adopted three hundred rows forked the judge on its very first tool call, on a ledger of `recovered` rows the prompt forbids reasoning about, with an empty TURNS block (`/saver check` still judges them on request). Nothing settles and nothing is credited: the history predates every decision, and no `TurnStat` exists for a rebuilt turn.
  - `turn.complete` → push `{ ...stat, turn, calls: rows recorded this turn }`; for each pattern with `openedAtTurn !== null && turn − openedAtTurn ≥ SETTLE_TURNS` → `saved += baseline`, `openedAtTurn = null`; behavioural patterns with `decision ∈ {steer, kill}` accrue `saved.chars += (estTokensPerTurn ?? 0) × 4`.
  - `usage` → merge (`window`/`compactAt` sticky; `tokens`/`percent` replaced, and a value the dispatch left out keeps the one already known); the first sample carrying a real `now` also seeds `judge.lastAtMs`, since a `lastAtMs` of 0 against a clock reading milliseconds since the epoch leaves the mid-turn gate no wall-clock floor at all and forty calls in the first two minutes would fork the judge with no completed turn. `overhead` → set. `compact` → `compactions.push(turn)` and `tokens`/`percent` are forgotten: they are sticky, a just-compacted window reports neither until its next response (d.ts 7023-7025), and the pre-compaction fill would announce "about 2 turns to compaction" seconds after one happened.
  - `expand` → `expanded = patternId === expanded ? null : patternId`.
  - `steer.begin` → `steering = steering === patternId ? null : patternId`, `steerDraft = null` (toggles the field; opening it starts from the pattern's `alternative`). `steer.draft` → `steerDraft = text`.
  - `decide` → set `decision`, `decidedAtTurn = turn`, `lastDecision = choice`; remove from `cards`; `steering = null`, `steerDraft = null`; `expanded = null` when it was this pattern; `keep` → nothing else; `steer` (text required, else no-op) → `instruction = text`, `notes.push(instructionOf(text))`, `standing.push(instructionOf(text))` (deduped), `openedAtTurn = turn`; `kill` → same with `killPrompt(p)`.
  - `judge.start` → `running = true`. `judge.done` → `running = false`, `runs += 1`; `patterns` replaced wholesale; `lastAtTokens = totalTokens(state)`, `lastAtTurn = turn`, `spent += spent`, `error`, `focus`, `last = { returned, kept, dropped, usage }` (what the run reported, so "found nothing" and "found things the validator dropped" read differently, and what the fork cost — `usage` is null when it answered nothing); `backoff = totalTokens > 0 && spent > JUDGE_BUDGET_SHARE × totalTokens ? min(backoff × 2, JUDGE_MAX_BACKOFF) : backoff` (a session with no completed turn is no budget to be over: without the guard the first run after a reload doubled the cadence against a total of 0); queue a card for every id in `fresh` (a cited pattern with `decision === null`, new or known, not already queued); for every id in `recurred` (a steered/killed pattern re-reported with evidence after `decidedAtTurn`) → `ignored += 1`, `openedAtTurn = null`, re-queue the card once. Last, `pendingCheck = error === null ? false : pendingCheck`: only a run that came back with a reply audited the session, so a cold snapshot or a refusal leaves a check armed at load standing for the next opportunity (§6) instead of losing the audit.
  - `check.arm` → `pendingCheck = true`; `judge.start` deliberately leaves the flag alone, since a run under way is not yet an answer. The flag's whole clearing rule is therefore the `judge.done` clause above, plus `reset` through `initialState`.
  - `notes.drained` → `notes = []`. `standing.add` → push (deduped). `artifact.done` → `proposal = null`, and when `written` push `${patternId}:${kind}` to `state.written`. `pane` → `paneOpen = open`, and `autoOpened = true` when `auto`. `columns` → set.
  - `reset` → `initialState(cwd, usage.window)` keeping `overhead`, `columns`, `paneOpen` and `patterns` as `{ ...stored, hits: [], decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0 }` (`lastDecision` persists).
- `totalTokens(state) = Σ turns (input + output + cacheCreate)` (new tokens; cache reads excluded on both sides of the judge budget).
- `tokensToCompaction(state): number | null` — `(usage.compactAt ?? round(window × 0.9)) − usage.tokens`; null when `tokens` is unknown. Exact, from the usage API; no time extrapolation (minutes would depend on how fast the user works, so they are not shown).
- `turnsToCompaction(state): number | null` — `tokensToCompaction / median(positive context growth per turn)`, where growth is `context[i] − context[i−1]` over the last 5 turns that reported a `context`, drops (a compaction, a `/clear`) skipped; null with fewer than 3 growth samples or a zero median. Shown as `≈ 6 turns`. **Not** the tokens a turn was billed: at 38% of a million-token window a session spending 60k tokens a turn and growing it by 30k read "about 3 turns to compaction" when it had twenty.
- `parseRegistry(value: unknown): StoredPattern[]` (validate every field; drop junk), `toStored(p)`, `fromStored(s)`, `mergeStored(a, b)` (by id, `b` wins; capped at `MAX_PATTERNS`, dropping entries with `lastDecision === null` and the lowest confidence first, so the per-project store cannot grow without bound).
- `debugDump(state): string` — ≤ 40 lines: the counts (turn, seq, rows, turns, patterns) on the first line, rows by cls, then `time sinks:` and `context sinks:` (the total and the `SINKS` largest named consumers with their counts — the pane's header shows one figure and one sentence, so the breakdown lives here), patterns (`id hits decision ignored`), cards, notes/standing counts, judge stats incl. `focus` and the whole cadence (`lastAt <tokens> tokens / turn <n> / row <seq> / <ms>ms`), then `judge time:` and `judge context:` (the judge's two sentences, `-` when it has not run), then `judge last: N returned · K kept · D dropped` with up to `DEBUG_MAX_DROPPED` (6) dropped reasons indented beneath it and `judge usage: in N · out N · cache read N · cache create N` under them (omitted when the fork answered nothing; the same line the debug log prints after each run, because a cold cache is what makes a run expensive), then `load check: retrying | answered | not armed · reported | not yet reported` (whether the check a load fired is still waiting on an answer, answered, or never armed at all under the row floor, and whether the load lane has already spent its one failure toast — the shell passes the flag in as the second argument, since it is the shell's, not the state's: `debugDump(state, armedSpoke)`), usage, saved. `DEBUG_MAX_PATTERNS` is what holds the whole dump inside the 40 with the reasons and the usage in it.
- Tests: rows grow hits of a matching known pattern; steer requires text and queues note + standing; kill queues `killPrompt`; recurrence → ignored and the card returns once (both via row and via `judge.done recurred`); a narrower same-class row credits `baseline − cost` once; two quiet turns credit baseline; behavioural accrual; cards FIFO without duplicates; `judge.done` never drops a decided pattern; a run before the first completed turn neither backs the cadence off nor prints a share of zero tokens; `reset` keeps stored fields incl. `lastDecision`; `parseRegistry` drops junk; medians; `judge.done` stores `last` — what the run returned, kept, dropped and cost — and `debugDump` prints it with its reasons and its usage line inside the 40 lines, and prints the two budgets' sinks; `sinks` labels a ledger by job, leaves the spawn rows out of the total and counts a recovered row for its size only; the header's `trend` and its growth-paced run to compaction, including the 38%-of-a-million case and the drop that is skipped; `judge.start` stores the row and the clock it began at and `judge.done` stores the two sentences, which the header quotes and `debugDump` prints; `check.arm` arms a check that a run under way does not spend, that a cold or refused run leaves standing and that a run which answered clears, and that a `reset` forgets, and `debugDump` names all three of its states (retrying and reported, answered, and never armed); `cardOf` states its seat number, the stats wording, what the cited calls total, one `Evidence` record per cited call newest first with the alias of a subagent loop and null for the main one, the turns-and-per-turn total of a behavioural finding, and a finding citing recovered rows beside newer turn handles totalling in calls all the same.

### 5.3 `hooks/core/judge.ts` (WP3)
- `hooks/core/blocks.ts` (owned by this package) renders the judge's input: `ledgerLine(row, aliases): string` — `r${seq} | tool | key | cls | agent | turn | ms | chars | flags | paths` exactly as Appendix A documents (`flags` space-joined or `-`; `lines` rendered inside flags as `+a/-d`; at most 3 paths; `spawn` rendered inside flags as `agent=${type}/${resolved ?? requested ?? '?'}/${status ?? '?'}/${tokens ?? '?'}tok/${edits ?? '?'}edits/${promptChars}pch`, so the thin-brief cue the prompt names is evidenceable; the `agent` cell is the row's alias from `agentAliases`, never the raw id — the judge reads `a1`, and the pane's evidence names the same loop the same way, while the rows keep the id so matching stays stable; the alias is a naming of the rows in hand, not an identity — a folded row still consumes its number, so the visible ledger may start past `a1`, and rows dropped past `ROW_CAP` can renumber a loop between runs; nothing matches on the alias, so only prose that quotes one can go stale; `statsLines` and `ledgerBlock` build one alias table from every row they are given, so the numbering agrees across the blocks); `summaryLine(tool, key, count, chars): string` — `~ | tool | key | ×count | Σchars`; `aggregate(rows): KeyStat[]` — one entry per `(tool, key)` over the whole session, `{ tool, key, cls, count, ms, chars, firstTurn, lastTurn, agents, editsBetween: number | null }` (`editsBetween` = median count of distinct `paths` edited by rows between consecutive occurrences; null when count < 2), sorted by `chars` desc (export `KeyStat` from blocks.ts); `statsLines(rows): string[]` — the top 20 `KeyStat`s by chars plus every one with `count ≥ 3` as `tool | key | cls | ×count | Σms | Σchars | turns first-last | edits-between | agents`, then per class `cls | ×count | Σms | Σchars`, then per agent `agent alias | ×count | Σchars` (no row ids: CONTEXT already names the largest single rows, and printing them twice under a header that says "No ids here" was both a contradiction and paid-for tokens); `sinksBlock(rows, measure): string` — the TIME and CONTEXT blocks from `sinks(rows, measure)` (section 5.2): `total Σ<n>ms|ch`, then one line per named sink `label | ×count | Σ<n>ms|ch | share%` (share of the total, rounded to a whole percent; the spawn sink is not in the total, so its cell reads `apart` instead of a share of a denominator it is missing from — a share against the other sinks' total is what printed `agents … 400%`), then `largest rows:` and the five largest single rows **of the ledger window** by that measure as `r<seq> | tool | key | Σ<n>ms|ch` (the totals and the sinks stay whole-session; the named rows stay inside the window `parseReply` accepts evidence from, so every id here is one the judge may cite); `(none)` with no rows; and `knownPatternsBlock(state)`, `decisionsBlock(state)`, `turnsBlock(state)`, `ledgerBlock(state)` as described under `buildPrompt`.
- `JUDGE_PROMPT` — the text of Appendix A, verbatim, as a template with `{{KNOWN_PATTERNS}}`, `{{DECISIONS}}`, `{{STATS}}`, `{{TIME}}`, `{{CONTEXT}}`, `{{TURNS}}`, `{{LEDGER}}`.
- `shouldRun(state, now): boolean` — `!running && rows.length ≥ JUDGE_MIN_ROWS && (turnGate || rowGate)`, where `turnGate` = `totalTokens − lastAtTokens ≥ JUDGE_MIN_NEW_TOKENS × backoff && turn − lastAtTurn ≥ JUDGE_MIN_TURNS` (the ordinary session) and `rowGate` = `seq − lastAtSeq ≥ JUDGE_MIN_NEW_ROWS × backoff && now − lastAtMs ≥ JUDGE_MIN_GAP_MS` (one agentic turn can run for hours, and `turn.complete` is no cadence inside it: the rows and the clock are). Both gates are checked on every ledger row and at every `turn.complete`, so a run lands mid-turn while the behaviour is still going on. Both of the row gate's anchors are seeded rather than left at 0 (section 5.2: `adopt` sets `lastAtSeq`, the first `usage` sets `lastAtMs`), since a zero anchor against three hundred adopted rows and a clock in epoch milliseconds is not a cadence but a run on the first tool call of the session. The one run that does land there is the check armed at load (§6), which is not a cadence run at all: it goes through `pendingCheck` and consults none of these gates, because they count new work and a joined session's work is all behind it.
- `usageOf(u: ModelForkUsage): JudgeUsage` maps the API's four counts onto ours (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `spentOf(u: JudgeUsage) = input + output + cacheCreate` (a read cache is free), and `costOf(u: ModelForkUsage) = spentOf(usageOf(u))`.
- `buildPrompt(state): string` — deterministic substitution of the blocks:
  - KNOWN PATTERNS: one line per pattern `id | kind | <decision or -> @ <decidedAtTurn or ->` plus `| previous: <lastDecision>` when set and no session decision; `(none)` when empty.
  - DECISIONS: one line per pattern with a session decision `id | <key or -> | <choice> @ <turn>`; then previous-session keeps `id | <key or -> | kept in a previous session`; `(none)` when empty.
  - STATS: `statsLines(state.rows)` (section 5.1) — whole-session aggregates so the judge reads "×847 · 41m · 2.1M chars · edits-between 3" instead of counting rows.
  - TIME and CONTEXT: `sinksBlock(state.rows, 'ms')` and `sinksBlock(state.rows, 'chars')` — where the wall-clock and the window went, so the judge can answer "what took so long" instead of only "what repeated".
  - TURNS: one line per `TurnStat` `turn | in | out | cacheCreate | calls | ms | answerChars` (aborted turns suffixed `aborted`); then the facts line `window=<n> overhead: memory=<n> mcp=<n> agents=<n> compactions at turns: <list or none>`.
  - LEDGER: newest `JUDGE_LEDGER_ROWS` rows as `ledgerLine`s in ascending order, preceded by `summaryLine`s for older rows grouped by `(tool, key)`.
- `parseReply(text, state): { findings: Finding[]; focus: string | null; time: string | null; context: string | null; dropped: string[]; returned: number }` — `time` and `context` are the judge's two explanations, whitespace collapsed, kept when they are non-empty strings and cut to 200 characters with an ellipsis when they run longer (the first 200 still say where the time went; anything but a non-empty string is null, because a number is no sentence to draw); neither is ever a finding, but a sentence that had to be cut is named in `dropped` as `time: 340 chars, trimmed to 200`, so a prompt problem never reads like a quiet session. Then: slice first `{` to last `}`; `JSON.parse` in try/catch; validate field by field; never throws. `returned` is how many findings the reply carried (0 on both root failures, so the debug line never claims a reply it could not read returned one). Every reason quoting the model's own text collapses its whitespace first, so a key with a newline in it cannot break the one-line-per-reason contract `debugDump` keeps. `dropped` carries one short reason per finding that did not survive, labelled by the finding's `id` when the id itself validates, else by its place in the reply (`#2`): e.g. `execution:full-suite: evidence r99 not in the ledger`, `#2: kind must start with "Claude keeps "`, `reading:log-dump: signature (Bash, read:cat api.log) matches no row`, `#4: kept this session`, `#7: over MAX_FINDINGS (6)`. A reply that is not JSON is the single reason `reply was not JSON`; a `findings` that is not an array is `findings was not an array`. Every drop path names itself, so a silent run is readable. Per finding: `id` matches `/^[a-z-]+:[a-z0-9-]{1,40}$/` and its category prefix equals `category` (one of the nine); `kind` ≤ `KIND_MAX` and starts with `Claude keeps `; `alternative` ≤ `ALTERNATIVE_MAX`; `evidence` handles are `r<seq>` aliases of rows present in `state.rows` (mapped to `tool_use_id`) or `turn:<n>` with `n` in `state.turns` (only when `signature === null`); ≥ 2 handles unless `why` contains the word "intent"; `signature` is null or a `(tool, key)` pair matching one row; `confidence` in [0.5, 1]; `estTokensPerTurn` coerced to null when a signature exists, else clamped to the median `answerChars / 4` of the cited turns; `proposal` null or `{ kind ∈ ArtifactKind, title non-empty, body non-empty }`, and for `settings-allow` the body must match `/^[A-Za-z][A-Za-z0-9_]*\(.+\)$/`; a finding whose `(tool,key)` belongs to a pattern with a session `keep` is dropped. Keep the first `MAX_FINDINGS`, at most `MAX_BEHAVIORAL_FINDINGS` with `signature: null`.
- `merge(state, findings): { patterns: Pattern[]; fresh: string[]; recurred: string[]; evicted: string[] }` — returns the **complete** registry: existing patterns carried through with session fields intact; an existing id updated in `why/alternative/proposal/confidence/estTokensPerTurn`, its `hits` extended with the cited handles; it is `recurred` when it has a steer/kill decision and any cited row's turn > `decidedAtTurn`; a new id becomes a `Pattern` with `hits` = the cited handles only (no back-fill); `fresh` is every cited id the merged registry holds with `decision === null` that is not already in `state.cards` — an undecided pattern re-reported with evidence is queued again, whether the id is new, remembered by the store or found by an earlier run of this session; capped at `MAX_PATTERNS` (drop lowest-confidence undecided patterns first). `evicted` names the findings the cap pushed out: they never become cards, so the shell counts them as dropped, not kept.
- Tests: cadence gates incl. backoff and the mid-turn gate (rows alone, gap alone, both, and a backoff doubling the rows it wants); the prompt's three opening questions, its legitimacy ladder, the single-long-call excuse, the two `[]` examples and the two reserved reply keys; `sinksBlock` inside `buildPrompt`, with the spawn row named outside the total; `parseReply` keeping the two sentences, cutting an essay to one and refusing a number; `buildPrompt` contains the contract block, the seven block headers, STATS lines with counts, ledger aliases, summary lines, the keep line in DECISIONS; parser on valid / prose-wrapped / broken JSON, an unknown alias, a completed (untruncated) key, a `(tool,key)` mismatch, an over-large `estTokensPerTurn`, a prose `settings-allow` body, a kept key under a new id; one `dropped` reason per drop path (unknown alias, `(tool,key)` mismatch, bad `kind` prefix, kept key, over the cap, a reply that is not JSON, a key with a newline in it that stays one line); the prompt's Counting sentence and its agent example; the LEDGER header's alias sentence, with a subagent's row rendered `a1` and no raw id anywhere in the prompt; merge reuse vs new, a known undecided id queued again unless its card is already up, `recurred`, cap, `evicted`, decisions preserved.

### 5.4 `hooks/core/rules.ts` (WP5)
- `propose(state): Artifact[]` — the pane reads as "make what you decided permanent": a steered pattern with `proposal === null` → the user's `instruction` as a `claude-md` line; a killed pattern with `proposal === null` → its `alternative` (the scoped fix; never the session-scoped kill prompt) as a `claude-md` line; a steered or killed pattern with a judge `proposal` → that proposal. Kept and undecided patterns propose nothing (Keep silences the pattern entirely). Artifacts already written this session (`state.written` holds `${patternId}:${kind}`) are omitted. Sorted by `savingPct` desc; `savingPct = pctOf(baseline.chars × 3, window)`.
- `render(kind, p, cwd): Pick<Artifact, 'path' | 'content' | 'mode'>`: `claude-md` → `${cwd}/CLAUDE.md`, mode `append`, `\n## ContextSaver\n- ${body}\n` (the shell appends only the bullet when the heading exists); `skill` → `${cwd}/.claude/skills/${slug(title)}/SKILL.md`, mode `write`, frontmatter `name`, `description`, body; `agent-brief` → `${cwd}/.claude/agents/${slug(title)}.md`, mode `write`, frontmatter `name`, `description`, `model` (from the body's first `model:` line, else omitted), `tools`; `settings-allow` → `${cwd}/.claude/settings.json`, mode `merge-settings`, `content` = the rule string.
- `mergeSettings(existing: string | null, rule: string): string` — parse (or `{}`), `permissions.allow` += rule if absent, 2-space JSON. Idempotent.
- Tests: each kind → path/content/mode; settings merge idempotent and preserves unrelated keys; propose gating and ordering.

### 5.5 `hooks/ui.tsx` (WP4)
- Keys (explicit and unique; Button `key` defaults to the label and collides, 641-646): `toggle`, `check`, `card:${id}:keep|steer|kill|info` (the keys are the decisions', never the labels'), `card:${id}:text` (the Fix… `Input`), `write:${id}`, `try:${id}`, `skip:${id}`.
- **THE MOCKS ARE MOCKS. The product is native UI.** Every ASCII drawing in this document is a layout sketch made of characters because a document cannot hold a live pane. The built pane uses the surface's real elements: `Button`s the user clicks, tabs to and presses (the surface draws and inverts them; no brackets or glyphs typed to look like a button), a real `Input` with the surface's own cursor, selection and focus ring (no `█` typed as a cursor), `Box` layout that reflows to the pane's width and placement, theme colours resolved by the surface, hover and focus handled by the surface. Only data glyphs (`●`, the gauge, `›`, `↳`, `✓`, `✎`, `–`, `◐`, `◌`, `─`) are literal text. If something in a mock looks like a control, WP4 builds the control.
- **Design brief — "hyper focus", macOS restraint, translated to a monospace grid.** WP4 designs to this brief and the result is reviewed live (section 8, step 1). What makes macOS feel calm is not decoration but four disciplines, each of which has a terminal equivalent:
  1. *Tone before colour.* macOS uses label / secondaryLabel / accentColor. Here: default foreground for content, `dimColor` for everything secondary (labels, meta, hints, rules), and one accent (the theme's accent key, confirmed at first render) reserved for what the user can act on or must notice: the `●` of a live waster, the gauge's filled cells, and the newest waster's card frame. Nothing else is coloured. **The verbs carry no colour:** `ButtonProps` (641-706) has `dimColor` and `hover` and no `color`, and one unknown prop blanks the whole pane, so a Button's tone is the surface's — default at rest, inverted under the focus or the pointer. The accent therefore marks the block the eye must land on (the newest card's frame) rather than the words inside it; `Skip`, `i` and a card's number stay dim, so the tone count is still three. Bold is used once per block, on the waster title. Italic never; inverse only where the surface applies it (focus, pointer). Three keys past the accent earn their place because they carry a fact and not a decoration, and they live behind one table in `ui.tsx` (`TONES = { accent: 'suggestion', good: 'success', warm: 'warning', hot: 'error' }`) so that a key the engine refuses is flipped to the accent in one edit: `good` on what the session got back (the header's `Saved` figure, a `✓` in Decided, a credit that settled), and `warm` above 70% of the window with `hot` above 90% on the gauge's fill, which is the one place in the pane where a number is a warning. The QA pass probes the three live before they are trusted.
  2. *A grid, and one card per waster.* Each live waster is a rounded `Box` — the newest bordered in the accent, the ones behind it `borderDimColor` — and nothing else in the pane is framed: the header, the empty state and the footer are separated by blank rows, since the surface already frames the pane. Inside a card the layout is two columns: a 10-cell dim label gutter and the content column, so every value in the pane starts at the same x, like System Settings; the header, the decided rows and the rules are indented to that same column. A card's cited calls take the whole card width (they carry their own `turn n` column and their quote is indented behind `↳`). Actions sit at the right edge (`justifyContent="space-between"`), verbs at the left of their row three cells apart: `Keep   Steer   Kill`.
  3. *Hierarchy by weight and order, disclosure by intent.* The eye must land on the first waster's title. The header is two rows; the wasters are newest first, the newest in full; decided items and rules are single lines. Details live behind `i` and open in place, one at a time; the Steer field opens in place and nothing else moves. Section headings carry no counts.
  4. *Quiet motion and honest states.* State is expressed by tone, not spinners: `Check now` dims to `Checking…` and says how long a run usually takes; a killed pattern that came back reads `ignored 1×`. Empty states are one dim sentence (`Nothing repeating yet.`). Toasts appear only after a click and never stack. Hover uses the surface's own inversion; no custom hover styling in v1.
  Copy: sentence case, verbs as buttons, no exclamation marks, no emoji; numbers short and rounded (`3×`, `~9%`, `3m 12s`, `9.9k`, `turn 8`), units abbreviated. Glyph set is closed and single-width: `●` `↳` `✓` `✎` `–` `→` `›` `─` `█` `░` `…` `↻` `▸` `◐` `◌` and the sparkline's `▁▂▃▄▅▆▇`, plus the mark's own `▀` `▄`. Every verb wears one (`✓ Fix`, `✎ Fix…`, `– Ignore`, `↻ Check now`, `✎ Write`, `▸ Try`, `– Skip`); the words are what the user reads and `kill`, `steer` and `keep` are still the keys and the actions behind them. Titles wrap to at most 2 rows; every other row truncates with `…` (`wrap="truncate-end"`). Design at three widths (dock 56, dock 80, inline full width) and keep every row within `site.bodyColumns`.
  Design QA (Fable, before WP4 is accepted): at each width count tones (≤ 3), bolds per block (1), colours outside the accent (0), rows over width (0), orphan glyphs (0); check the gutter aligns, the newest waster is the first thing the eye lands on, and the empty pane is calm. Iterate until it passes.
- `ui.tsx` renders view models only (`BandModel`, `PaneModel`, section 4), computed by `patterns.ts`; it never reads `State`. Wherever this section says `state.x`, read `model.x`.
- `Band({ ui, model, site, actions })` — exactly one row: `ContextSaver ${mark}  ${line}` in a `Text` with `wrap="truncate-end"`, and a plain Button `Open` (`Close` when `paneOpen`, key `toggle`) right-aligned (`justifyContent="space-between"`). It is a teaser that pulls the user into the pane, not a dashboard: one mark and one sentence, from `model.state`, the first that applies. `checking` → mark `◐` dim, line dim `checking this session…`. `found` → mark `●` accent, line accent `Found 2 ways to save ~12% of your context and 51m` (`1 way` / `N ways`; the figures are what the waiting cards have already cost — `costPct` and `duration(costMs)` — with `and ${time}` dropped below a minute, and `Found 1 thing worth a look` when a behavioural card has no measured cost at all). `saved` → mark `✓` in the `success` tone, line `saved 24% of context · 45m this session` with the two figures in that tone and the words around them dim. `watching` → mark `◌` dim, line dim `312 calls watched · nothing wasteful yet`, or `watching` before the first row. The found line is phrased against the cells the row has: it gives back the time first, then shortens to `Found 2 wasters`, and `truncate-end` takes whatever a very narrow band still cannot hold — a cut figure would lie. The row is `BAND_RESERVE` cells narrower than `site.bodyColumns`: the engine draws its own collapse control `[-]` over the last cells of the band, and a Button under it is clipped. No cards in the band, and no hotkey on the button: a bare digit typed into an empty composer would fire it.
- `Pane({ ui, model, site, placement, actions })` — the product surface. Sections, in order, each a `Box flexDirection="column"` with `paddingX={1}`:
  1. **Header** — a `Box flexDirection="row"`: the mark as a `Raster` (`key: 'logo'`, from `logoCells()` in `core/logo.ts` — an 8×8 three-tone bitmap of `assets/logo.png` derived once offline and stored as eight lines of `.` `d` `b` `l`, drawn as 8 columns × 4 rows of half-block cells; the ring is open on the right and its navy takes the terminal's own default foreground (`0x01000000`), so the mark reads on a light theme and a dark one alike, while its bright arcs are `#1AA7F0` from 9 o'clock to 12 and `#22D3EE` from 12 to the open end. Where two tones meet inside one cell the navy is the foreground and the bright tone the background, because a default background is the pane rather than the ink), then a column of four rows. **Row 1:** bold `ContextSaver`, then, four cells after it, dim `Judge 2 runs · 7.4k tokens` (omitted before the first run; it gives back the word `tokens`, then the figure, then itself as the row tightens) + plain Button `↻ Check now` (key `check`) right-aligned; while `judgeRunning` the label reads `Checking…`, `dimColor`, and the press does nothing. **Row 2:** `64% of context · 41k tokens to compaction · about 6 turns` (segments omitted when null; before the first turn is measured, dim `awaiting the first turn` and no gauge). **Row 3:** the gauge, `min(30, room)` cells, then two spaces and a 10-cell sparkline of `header.trend` — drawn from two samples up, and only where the gauge's floor and it both fit; its scale is absolute (a sample is a share of the whole window, not of the samples the row holds), so a flat session reads flat and two draws never disagree. **Row 4:** the row the judge's figures left: `Saved ~3% · 3m 12s` (`Saved ` dim, the figures in the `good` tone; blank when the session has saved nothing), and while `judgeRunning` dim `· checking this session… usually 10–20 s` appended, or, where the row cannot hold it and the placement is not inline, drawn as its own row. Then a blank row, and, docked, one row per budget the ledger has measured — **one figure, one sentence**: a dim label in the 10-cell gutter (`Time`, `Context`), then `3h 12m in tools` from `header.time.total` / `410k from tools` from `header.context.total`, then dim ` · ${judgeTime|judgeContext}` — the judge's own explanation of that figure, verbatim, or dim `nothing stands out yet` before its first run — the whole row `truncate-end` on one line, the sentence dropped whole below `HINT_MIN` (12) cells, and the row itself omitted when the budget is null. The `SINKS` named sinks behind each figure stay in the model and in `/saver debug`: the breakdown and its `↳` row crowded the block the eye must land on, and the judge's sentence says the same thing in words. Every row is assembled and measured against the cells it has before it is drawn, the Button's cells reserved first, and a row that does not fit gives back whole segments — the judge's tail, a budget's sentence, the word `tokens`, the judge's figures, `about N turns`, the words `tokens` and `of context`, the trend, then the mark itself — because a cut number lies (a `914k to compaction` cut to `914` reads as a different session). The judge's share of the session is a developer metric that misleads early on, so the name row shows tokens; the share stays in `/saver debug`.
  2. **Wasters** — no section heading; one card per undecided pattern (§5.5 item 2), newest first, separated by a blank row. Title row: the card's dim number `n` in the three cells before the accent `●` (two digits and the space after them), then bold `${kind}` (wraps, ≤ 2 rows), then the dim `${category}` tag and a plain Button `i` (key `card:${id}:info`, dim) at the right edge. The title's cells are what the row has left once **the border (2), the padding (4), the number gutter, `● `, the tag and the gap before it, and the `i`** are all reserved, and every wrapped line is cut to them — a line longer than that pokes through the card's own border, which is what it did at 160 columns. The three widths add up to the row's own, so the `i` lands flush right without a `space-between`. The tag is dropped whole under 60 body columns, and the title takes its cells back. Stats row (dim): `${stats}`. Action row: plain Buttons `✓ Fix`, `✎ Fix…`, `– Ignore` in that order — the fix first, the fix with a note second, the shrug last (keys `card:${id}:kill|steer|keep` — the rename is the label's, never the key's); the `…` says the second one opens a field then dim `→ ${fix}` wrapped to the remaining width (≤ 2 rows). Expanded (`state.expanded === id`, one at a time) the stats row and the fix row are replaced by the details, which are the answer to "why do you say so": `why` → `${why}` wrapped in full (≤ 4 rows, only the last truncated) and `fix` → `${fix}` (≤ 4 rows), both with dim lowercase labels in the 10-cell gutter; then one dim summary row `3 calls · 19s · 6.0k chars of context` (a 0 duration dropped whole; a behavioural finding counts turns instead: `2 turns · ~1.2k tokens per turn`, read from `total.unit` and never inferred from the cited handles; no row at all when the card cites nothing); then one block per cited call from `card.evidence`, newest first: row 1 `turn 14   ${what}   ${agent}   5s · 2.3k ch` — the four columns are measured once over the calls this drawing shows and shared by all of them (the turn and `what` padded to the widest, the wall time right-aligned in its own column), so the sizes read as one column however long the durations are; `what` is truncated to what the row leaves it, the alias is drawn only when the call was not the main loop's and dim, and while the widest row does not fit the drawing gives back the unit `ch`, then the alias, then the cost whole — and row 2, dim, `↳ "${head}"` (≤ 60 characters, omitted when nothing came back). A turn handle reads `turn 14   no tool calls   6.1k answer` with the answer's head quoted the same way. **There is no `kill →` row:** Fix sends the `kind` and the `fix`, both already on the card, so a third copy of them was the noisiest row in the pane. Steering (`state.steering === id`): the verbs row stays (Fix and Ignore remain one click away) and two rows appear beneath it: the field row (`›` in the gutter + `Input`, key `card:${id}:text`, `value = state.steerDraft ?? fix`, `submitLabel = 'send'`, `autoFocus`, `onInput = (t) => actions.steerDraft(t)`, `onSubmit = (t) => actions.steerSubmit(id, t)`), then dim `Enter sends · Fix… again closes · longer: /saver fix <n> <text>`. `Input` is the surface's one-line field (3735-3787), so a steer is one sentence; a longer instruction goes through `/saver steer [n] <text>` in the composer, which is multi-line and names the card by the number the title row draws. The draft lives in state because the pane redraws on every ledger row Claude produces while the user types; rendering it back as `value` means a redraw never wipes the text (whether the surface keeps the cursor position across that redraw is probed in section 8). `Input` has no cancel callback and Esc only returns the keyboard to the prompt, so closing is the `Steer` button again. Empty state, dim: `Nothing repeating yet.` with `Check now` beneath.
  2a. **The Fix… field** (`state.steering === id`) — the `›` row (`Input`, key `card:${id}:text`, `submitLabel="send"`, `autoFocus`) and one dim hint row under it, `Enter sends · Fix… again closes · or /saver fix <n> <text>`, are emitted **immediately after the verbs row and before any detail or stats row, at both placements** — docked the verbs rise with the field rather than staying under the content, so a seat or a scroll can only ever cut detail and the field is never below the fold. That is the whole affordance where the surface will not hand the pane the keyboard: the hint names the composer route rather than a second control. `value` is the text the field holds *when drawn* (3745-3787) and the pane's body is this hook's tree, so every render carries it — `steerDraft` once a keystroke landed, the pattern's `alternative` before that — and the keystroke's own redraw is what paints it; a render that leaves `value` out draws an *empty* field, so it is never left out (verified live at 85 columns). `onSubmit`'s own text is what decides, never the copy the state kept.
  3. **Footer** — a dim `─` rule, then two label rows: `DECIDED   ${glyph} ${word} · ${kind, truncated} · saved ~${pct}% | ~${pct}% per repeat | ignored ${n}×` (one row per decided pattern, newest first, `✓ fixed` / `✎ fixed with a note` / `– ignored` — the glyph alone left the reader to remember what it meant — the `✓ fixed` and a credit that settled in the `good` tone; the row is omitted when there are none) and `RULES     ${title} · ${kindLabel}` + plain Buttons `✎ Write`, `▸ Try`, `– Skip` right-aligned (one row per artifact; `Try` only for `claude-md`, `skill`, `agent-brief`; omitted when none). The figure on a decided row is what one avoided repeat is worth, so it reads `~${pct}% per repeat` until the decision `settled` and only then `saved ~${pct}%`: the header's SAVED shows credit that landed (D4), and a past tense here before it lands would be a second, softer number. When a steer sent something other than the fix, the sentence it sent is a second dim row beneath it, `› ${instruction, truncated}`, so the pane says what Claude was actually told and not only what was offered. A derived rule's `title` is its own first clause (`rules.ts`), never the behaviour: the row invites `Write`, so it must read as the line that would be written.
  3a. **The keyboard row** — the pane's last row, dim, at both placements: `ctrl+x tab focuses this pane · Tab moves · Enter presses · Esc hands the keys back`, and, while a waster is listed and the row still fits, `· /saver fix|ignore <n>` after it. A pane the person did not open themselves holds no keys, and nothing else on screen says which chord gives them to it — the confusion that made the arrow keys read as the engine's own navigation. The phrasings are laddered longest-first, as the band's teaser is: the verbs by number are given back first, then `Enter presses`, then `Tab moves`; the chord itself is never dropped and never cut. Inline the row is budgeted like any other, and where the newest card's own unclippable rows (border, title, verbs, open field) leave the seat nothing, the lesson is what gives way — never a verb, and never a drawing that runs past the seat.
  - `placement === 'inline'` → the same design with the header's four rows beside the mark but no `Time` or `Context` row (the mark's own four rows are paid for either way, so the figures ride along free), the newest waster in full, further wasters as one dim row each (`${n} ● ${kind, truncated} · ${hits}×`), and the footer collapsed to `DECIDED ${n} · RULES ${n} · /saver for the full pane`. It fits the seat the surface really granted (`min(site.maxRows, PANE_INLINE_ROWS)`; `PANE_INLINE_ROWS` is what `$.ui.open` asked for, and the engine grants about a third of the terminal), not a constant: the header's rows, the keyboard row and the card's border, title, verbs and open field are counted first, what is left is the card's content (`why`, `fix` and the summary row at one row each and one cited call when `i` is open, else the stats and the fix), and whatever the card does not need folds the wasters behind it. The verbs and the field are drawn above the content, so a seat smaller than the drawing costs detail and never a verb. `placement === 'dock'` → everything; the engine scrolls a taller tree (6588-6635).
  - Every one-line row is a `Text` with `wrap="truncate-end"`; widths from `site.bodyColumns`.
- Only `Box`, `Text`, `Button`, `Input`, `Raster` with allow-listed props (518-571, 641-706, 3745-3787, 7814-7836); one unknown prop invalidates the whole tree and the pane draws empty. Colour keys are strings the d.ts does not enumerate: WP4 confirms the accent key at first render and records it in README. Never a local named `h`. `ui.tsx` never touches `$`.
- Tests. `tests/logo.test.ts` covers the mark on its own: the bitmap is eight rows of eight pixels in three glyphs, the payload is the padded base64 of the size the `Raster` declares, and the first cell decodes back to the pixels the bitmap holds. `tests/ui.test.tsx` measures every row of the pane from its left edge, through the padding and the borders around it, at 60, 80 and 160 columns, so a wrapped title reaching past a card's frame fails the suite; it renders the band (`$.ui.render({ surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} } })`) and the pane (`{ component: 'Pane', requestId: 'saver', props: { title: 'ContextSaver', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }`) through an inline test plugin with fixture states: empty state text; two wasters with buttons; `$.ui.press` on `card:<id>:kill`, `card:<id>:info` (the details show `why`, `fix`, the summary row and one block per cited call, with a subagent's alias and the `↳` quote, and no `kill →` row), `card:<id>:steer` (the tree now holds an `Input` with the fix as `value`; after a `steer.draft` the `Input` renders the draft, and the field's row and its hint sit directly under the verbs and above any detail row at 56, 85 and 160 columns, both placements, with the keyboard row last), `check`, `write:<id>` and `toggle` call the actions; inline placement shows the compact layout; the band draws each of its four states, gives back the time before the sentence, and never a cut figure.

---

## 6. The shell — `hooks/register.ts` and `hooks/host.ts` (WP6)

`Host` (each member one literal `$.noun.verb`, bound in `session.start` like `mods/diff/hooks/register.ts` lines 594-621):
(`invalidate`, `toast` and `log` return `void`, not promises; the rest return promises.) `now() → $.clock.now()` · `invalidate() → $.ui.invalidate('ui.render')` · `toast(text) → $.ui.toast(text)` · `log(text) → $.ui.log(text)` · `openPane(args) → $.ui.open(args)` · `closePane(args) → $.ui.close(args)` · `focusElement(args) → $.ui.focus(args)` · `registerCommand(spec) → $.command.register(spec)` · `usage(args?) → $.session.usage(args)` · `messages() → $.session.messages()` · `storeGet(key) → $.store.get(key)` · `storeSet(key, v) → $.store.set(key, v)` · `fork(prompt) → $.model.fork({ prompt })` · `readFile(p) → $.fs.read(p)` · `writeFile(p, t) → $.fs.write(p, t)` · `exists(p) → $.fs.exists(p)` · `debugFlag() → $.env.get('CONTEXTSAVER_DEBUG')`.

Closure state: `let state: State`, `let host: Host | null`. `dispatch(a)` = `state = reduce(state, a); host?.invalidate()`; when `state.saved` grew, toast `+${duration} · +~${pct}% context saved`. Every hook body: `try { … } catch { return next(e) }`.

| Event | Matcher | Hook |
|---|---|---|
| `session.start` | — | Bind `host`. `cwd = e.cwd`. `u = await host.usage({ breakdown: 'summary' })` → `state = initialState(cwd, u.context.window)`; `dispatch(usage { window, compactAt: u.context.breakdown?.autoCompactThreshold, tokens, percent })`; `dispatch(overhead { memory: Σ breakdown.memoryFiles[].tokens, mcp: Σ mcpTools[].tokens, agents: Σ agents[].tokens })` (6946-7017; zeros when absent). `stored = parseRegistry(await host.storeGet(\`patterns:${cwd}\`))` → patterns = `stored.map(fromStored)`. `await host.registerCommand(COMMAND)` (catch → `host.log`). Debug flag read once. Then, last, `dispatch(adopt adoptRows(await host.messages()))` (skipped when it yields no rows): the read comes after the usage, the registry and the command, so a transcript the host refuses or answers slowly costs the session nothing it already has, and awaiting it keeps every adopted row below the live rows in `seq` and ledger order; debug → `host.log(\`ContextSaver adopted ${n} rows from the transcript · checking them now\`)`. Then, when the adopted ledger already passes the judge's floor (`state.rows.length >= JUDGE_MIN_ROWS`), `dispatch(check.arm)`, with the flag `host.log(\`ContextSaver fired a check over ${n} adopted rows · armed, so a cold answer retries\`)`, and then `armedCheck()` — the audit runs **here**, at load, not at the person's next keystroke: `$.model.fork` reads the session's last turn's cache-safe snapshot (2019-2034), and a ledger this long is a session that has run turns, which is exactly what a `/reload-plugins`, an edit under `--plugin-dir` or a resume hands us (3106-3111). Detached, never awaited (this hook is awaited by the engine and has a budget, and the run answers in a toast); the arming stays up, so a snapshot that really is cold answers null and the first warm opportunity below retries it — the person's next prompt, Claude's next tool call, or the turn's end. Fewer rows than the floor arm nothing and fork nothing: a fresh session keeps the plain cadence. `return next(e)`. |
| `turn.start` | — | `now = await host.now()`; `dispatch(turn.start { now })` — the wait since the last answer is written onto the turn it followed, so TURNS can say the person was away; `return next(e)`. |
| `tool.call` | — | Own call (`next.origin.plugin === PLUGIN_NAME`) → `return next(e)`. `t0 = await host.now()`; `r = await next(e)`; `t1 = await host.now()`; `ms = t1 − t0`. `dispatch(row rowOf(e, r, ms, state.turn))`; debug → `host.log(\`ContextSaver row r${seq} ${tool} ${key} ${ms}ms ${chars}ch\`)`. Then the spawns: `runOf(r.result)` → `dispatch(run.start { run, now: t1 })` (a `Workflow` launched a run; an id already known is a resume); `agentOf(r.result)`, the value carrying the call's own `description` when the tool is `Agent` → `dispatch(agent.start)`; then `void refreshRuns(launched)` — forced on a launch so the run's journal is read at once, the cadence otherwise; never awaited, the call is answered first. Then one judge lane, from the clock already read (`judgeAt(t1, 'tool.call')`): an armed check first — `armedCheck()`, i.e. `state.pendingCheck && !state.judge.running` → `void runJudge('load')` and `true`, consulting no gate, since `shouldRun` counts new work and a session joined late has all of its work behind it — else the cadence, `if (shouldRun(state, t1)) void runJudge('tool.call')`; a turn that runs for hours is judged while it runs. If `state.notes.length` and `r.deny === undefined`: `const pending = state.notes; dispatch(notes.drained); return { ...r, context: [...(r.context ?? []), ...pending] }`. Else `return r`. |
| `turn.complete` | — | `e.agentId` → `dispatch(loop.turn { agentId: e.agentId, model: e.usage?.model ?? null, ms: e.durationMs, tokens: from e.usage (0 when absent), ended: e.reason, turn: state.turn })`, then `return next(e)` — no usage sample and no cadence: a subagent's turn is its loop's, and the window and the cadence are the main loop's. Main loop: the window is sampled **first**, since how full it is after this turn is the turn's own figure, and **optionally**, since the turn stat may not depend on it: `u = await host.usage().catch(() => null)`, `now = await host.now()`. Then `dispatch(turn.complete { input/output/cacheRead/cacheCreate from e.usage (0 when absent), ms: e.durationMs, answerChars: e.answer.length, answerHead: e.answer.slice(0, 100), aborted: e.isAborted, ended: e.reason, at: now, idleMs: 0, context: u?.context.tokens ?? null })`; `if (u !== null) dispatch(usage { tokens: u.context.tokens, percent: u.context.percent, now })`; then the same one lane as `tool.call`, `judgeAt(now, 'turn.complete')` — an armed check before the cadence. `return next(e)`. A refused `session.usage` costs this turn its context sample and nothing else: recorded first-or-not-at-all, a refusal would empty `state.turns` and take `totalTokens`, the token gate, every `turn:<n>` handle and the header's trend with it. |
| `session.compact` | — | Observe only: `r = await next(e)`; `dispatch(compact)`; `return r`. (Rewriting messages is v2.) |
| `prompt.submit` | — | If `e.origin?.kind === 'plugin'` or the text starts with `/saver` → `next(e)` (the command path runs its own check). `extra = [...state.notes, ...state.standing]`; non-empty → `dispatch(notes.drained)` and `carried = { ...e, context: [...(e.context ?? []), ...extra] }`, else `carried = e`. Then, before returning, `armedCheck()`: the load fired its own check, so this is the retry of one that came back with nothing — the person's next prompt is a warm opportunity too. **No cadence lane here** — a prompt is not new work, only the arming justifies a run — and the fire-and-forget run never changes what the prompt carries. `return next(carried)`. |
| `ui.render` | `{ component: 'AbovePrompt' }` | `e.props.hasSurvey` → `next(e)`. If `e.props.bodyColumns !== state.columns` → `dispatch(columns)` (no invalidate loop: `dispatch` inside a render hook must not call `invalidate`; the shell uses a plain `state = reduce(...)` here). `const { Box, Text, Button } = $.ui.resolve(e)`; `below = await next(e)`; return `<Box flexDirection="column">{below}{Band({ ui, model: bandModel(state), site: { bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows }, actions })}</Box>`. |
| `ui.render` | `{ component: 'Pane', requestId: PANE_ID }` | Step the Fix… ring (the two-render ask above, from `e.props.isFocused`), then `const { Box, Text, Button, Input } = $.ui.resolve(e)`; return `Pane({ ui, model: paneModel(state, propose(state)), site: { bodyColumns: e.props.bodyColumns, maxRows: e.props.scroll.bodyRows }, placement: e.props.placement, actions })`. |
| `command.run` | `{ command: 'saver' }` | `[sub, ...rest] = e.args.trim().split(/\s+/)`: `''` or `rules` → `togglePane()`, `{ text: paneOpen ? 'ContextSaver pane hidden' : 'ContextSaver pane shown' }`; `check` → if a run is in flight → `{ text: 'ContextSaver: already checking' }` (an armed run in flight is that run, and it answers the ask); else `void runJudge('/saver check')`, `{ text: 'ContextSaver: checking this session for waste…' }`; `fix` → the rest of the args, newlines kept; a **leading integer token is always read as a card number** (folding a mistyped one back into the note would fix the wrong card with a garbled sentence), so one outside the list answers `{ text: \`ContextSaver: no card ${n} (1–${cards.length})\` }` exactly as `ignore` does, and without a number the card is `state.steering ?? cards[0]`; no cards → `{ text: 'ContextSaver: nothing to decide on' }` (checked first, so an empty list never reads as a numbering mistake); a number with nothing after it sends the fix the card already offers, exactly as `fix <n>` below; nothing at all, or a card that is no longer listed → `{ text: 'Usage: /saver fix [n] [instruction] (a leading number is the card the pane draws; without one: the card whose Fix… field is open, else card 1)' }`; else `steerSubmit(id, text)`, `{ text: \`ContextSaver: card ${n} — "${fit(kind, 60)}" · fixed with your note: ${text}\` }`; `ignore <n>` / `fix <n>` → the card the pane numbers `n` (its seat in `cards`, live, so a decision renumbers what is left): no cards → `nothing to decide on`; a missing or non-numeric token → the usage line; `n` outside the list → `{ text: \`ContextSaver: no card ${n} (1–${cards.length})\` }`; else `decide(id, choice)` and `{ text: \`ContextSaver: card ${n} — "${fit(kind, 60)}" · ignored | fixed\` }`; `demo` (only with the debug flag set, and never listed in the usage line) → seed `demoUsage()` and four `demoTurns()` stats carrying the context the window held after each (120k, 190k, 250k, 320k of the sample's million) first — the header is part of the drawing, and without a sample it draws `awaiting the first turn` above cards that state a percentage of context, and without the context samples it draws no trend and no run to compaction — then `demoRows`/`demoPatterns` from `core/demo.ts`, `dispatch(judge.done)` with them and `demoForkUsage()` (a cold fork, so the header's name row shows what a run costs), `await openPane()`, `{ text: 'ContextSaver: demo wasters loaded' }`, so the drawing can be looked at without waiting for a real finding (nothing is sent to Claude, nothing is written); `debug` → `{ text: debugDump(state, armedSpoke) }`; `reset` → `resetSession()`, `{ text: 'ContextSaver: session state reset' }`; else `{ text: 'Usage: /saver [check | fix [n] [text] | ignore <n> | debug | reset]' }`. |
| `command.run` | `{ command: ['clear', 'resume'] }` | `r = await next(e)`; `resetSession()`; `return r`. |
| `ui.close` | `{ id: PANE_ID }` | `r = await next(e)`; `dispatch(pane false)`; `return r`. |

Actions:
- `keep(id)` (the `– Ignore` button): `dispatch(decide keep)`; toast `ContextSaver: ignored "${kind}"`; persist.
- `steer(id)` (the `✎ Fix…` button): `dispatch(steer.begin)` (shows or hides the field under that waster's verbs), then, when the field is the one now open, ask for the keys and the ring in that order, each fire-and-forget and each refusal ignored:
  1. `host.openPane({ id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS, focus: true })` — re-opening our own id delivers no second instance, only the title and the focus rewrite (4901-4922), and it is the only way a plugin may ask for the keyboard.
  2. The ring is asked for **from the `ui.render` hook, one render after the field is first drawn**: `$.ui.focus` lands only on an element the *drawn* tree holds, and a tree lands after the hook that built it returns — asked any earlier the engine answers `{ deny: 'no element of its own is drawn under that key' }` (verified live). So the render that first draws the field only asks for one more draw (`host.invalidate()`, once per opening), and the render after it calls `host.focusElement({ requestId: PANE_ID, key: \`card:${id}:text\` })`. `autoFocus` cannot do this: it lands only where a site takes the keyboard *fresh*, and a pane the person already keyed is not a fresh take.
  3. Where that answered `{ deny }` (or failed) **and** the pane was drawing unfocused (`e.props.isFocused === false`), the composer holds the keys and the one route that always works is said once: toast `ContextSaver: the composer has your keys — type /saver fix ${n} <your note>` with the card's own number. A pane that does hold the keyboard is told nothing — the field is one `Tab` away and the keyboard row says so, so the line would be false.
  Pressing `Fix…` again closes the field, as it always did.
- `steerDraft(text)`: `dispatch(steer.draft)` (no toast). The redraw is what paints the keystroke, since the pane's body is the render hook's tree, and the text it draws back is this one — which is also what `/saver fix` sends when the keyboard never reaches the field.
- `steerSubmit(id, text)`: `text = text.trim()`; empty → toast `ContextSaver: write the instruction first`; else `dispatch(decide { id, 'steer', text })`, toast `ContextSaver: fixed with your note — ${first line}${more ? ' …' : ''}`, persist. `/saver fix [n] <text>` calls it with the numbered card, else `state.steering ?? cards[0]`, and `text = e.args` after the word `fix` (and after the number when one was read), newlines preserved (probe in section 8 confirms `e.args` keeps them).
- `kill(id)` (the `✓ Fix` button): `dispatch(decide kill)`; toast `ContextSaver: fixed — ${fix}`; persist.
- `info(id)`: `dispatch(expand id)`.
- `togglePane()`: if `paneOpen` → `await host.closePane({ id: PANE_ID })` (the `ui.close` hook records it); else `await host.openPane({ id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS, focus: true })` then `dispatch(pane true)`. Opened on the person's request it is placed at any width (1943-1945) **and asks for their keyboard**: `focus` is a request, not a grant — the surface focuses and raises the pane only while the prompt has the keys over an empty composer (4915-4922), and every refusal leaves the pane open with the keys where they were. A refused focus is never surfaced. `closeOnEscape` is never set: Escape must hand the keys back, not close the pane.
- `check()`: `host.toast(checkNow())` — the same words `/saver check` replies with, since a press has no reply to write in and a check that says nothing is the bug this fixes.
- Auto-open (shell, after a **cadence** `judge.done` that queued a card — a fresh finding or a steered behaviour that came back): if `!state.paneOpen && !state.autoOpened && (state.columns ?? 0) >= AUTO_OPEN_MIN_COLUMNS` → `await host.openPane({ id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS })` — **no `focus`**, since an open nobody asked for interrupts whatever the person was typing — then `dispatch(pane { open: true, auto: true })`. Below that width the band's `n new wasters [Open]` is the only signal (same rule as `/diff` opening on the first edit). A **REQUESTED** run — `/saver check`, `Check now`, or the check a load armed — opens instead at any width, every time, with `focus: true` (they are waiting for it), and never sets `autoOpened`: the person is waiting for the answer, and a session the plugin joined late is owed the one nobody had to ask for.
- `write(a)`: `append` → `existing = (await exists) ? await readFile : ''`; write `existing + (existing.includes('## ContextSaver') ? bulletOnly : content)`; `write` → `writeFile`; `merge-settings` → `writeFile(path, mergeSettings(existing, rule))`. Then `dispatch(artifact.done)`, toast `Wrote ${path}`. Errors → toast the message.
- `tryOnce(a)`: `dispatch(standing.add a.content-summary)`; `dispatch(artifact.done)`; toast `Trying "${title}" for this session`.
- `skip(a)`: `dispatch(artifact.done)`.

`runJudge(reason: 'tool.call' | 'turn.complete' | '/saver check' | 'load')`, where `REQUESTED = ['/saver check', 'load']` are the lanes the run answers out loud — `load` is the check armed at `session.start`, and the person is owed its outcome as much as the one they typed. A closure flag is raised first (`judge.start` lands one `host.now()` after the decision to run, and a storm of tool calls decides inside that window, so the flag is what stops a second fork), then `now = await host.now()`, `dispatch(judge.start { now, seq: state.seq })`; `try { r = await host.fork(buildPrompt(state)) } catch (err) { r = null; reason = message }`; `r === null` → `dispatch(judge.done { patterns: state.patterns, fresh: [], recurred: [], focus: null, time: null, context: null, spent: 0, error: message ?? 'cold snapshot', returned: 0, kept: 0, dropped: [], usage: null })`; else `{ findings, focus, time, context, dropped, returned } = parseReply(r.text, state)`; `{ patterns, fresh, recurred, evicted } = merge(state, findings)`; `reasons = [...dropped, ...evicted.map(id => \`${id}: evicted, over MAX_PATTERNS (50)\`)]`; `usage = usageOf(r.usage)`; `dispatch(judge.done { patterns, fresh, recurred, focus, time, context, spent: spentOf(usage), error: null, returned, kept: findings.length − evicted.length, dropped: reasons, usage })`; debug → `host.log(\`ContextSaver judge: ${returned} returned · ${kept} kept · ${reasons.length} dropped · from ${reason}\`)` — which lane started the run: the mid-turn cadence, the turn's end, the person, or the check a load armed — then each reason on its own line (at most `DEBUG_MAX_DROPPED`) and `usageLine(usage)`, the same line `/saver debug` prints, inside their own try/catch so a log the surface refuses cannot turn a run that succeeded into an error; persist; the flag comes down in a `finally`, so a run that threw never blocks the next one.

When the reason is REQUESTED, and only then, the run answers the person: `ContextSaver: ${n} new waster(s)` counting every card the run queued — `fresh` **and** `recurred`, since a steered behaviour coming back is the D4 moment the product exists for — `ContextSaver: nothing new` when it queued none, `ContextSaver: check failed — ${reason}` when the fork was refused, was cold or threw — and then the open rule above. A cadence run says nothing at all. An armed run that reported nothing says so once, in its own words — `ContextSaver: could not check yet — ${reason}` — and every later failed `load` run is quiet: its arming survived (§5.2), so a toast per retry would be a storm, while total silence reads exactly like a check that never fired, which is the one thing a person cannot debug. The closure flag that bounds it (`armedSpoke`, beside `forking` and `asked`) comes down only where the session's own state does — `resetSession()` behind `/clear`, `/saver reset` and a resume, and a fresh `register()` — so the next session may speak for its own armed check, and `/saver debug` prints whether this one has. An ask that arrived mid-run is answered as always. `checkNow()` (behind `/saver check` and `check()`) answers `ContextSaver: already checking` while a run is in flight and forks nothing, else `ContextSaver: checking this session for waste…` and `void runJudge('/saver check')`. An ask that arrived mid-run is latched (`asked`, cleared in the same `finally` as the fork flag) and the run in flight answers it as a requested one would: cadence runs are frequent inside a long turn, so `already checking` must never be the last thing the person hears.

`persist()`: `stored = parseRegistry(await host.storeGet(key))`; `await host.storeSet(key, mergeStored(stored, state.patterns.map(toStored)))`; fire-and-forget with `.catch(() => undefined)`.

`refreshRuns(force)`: nothing while `state.runs` is empty (no clock read per tool call); else `now = await host.now()`, and for each run due — every run when `force`, else `activeRuns(state, now)` whose `now - refreshedAt ≥ RUN_REFRESH_MS` — with a `journalPath`: `host.readFile(path)` → `parseJournal` → `dispatch(run.journal { runId, entries, now })`; a read that fails dispatches `entries: []`, so the run is stamped and not retried at once. Fire-and-forget from `tool.call`; awaited once in `judgeOnce`, after `judge.start` and before `buildPrompt`, so AGENTS is read off journals brought up to date. `bandModel(state)` is still called without a clock: the band dates a loopless run's freshness from the newest turn or launch the state holds.

Notes: a hot reload (`--plugin-dir` save, `/reload-plugins`) re-runs `register()` and fires `session.start` again; the registry reloads from the store and the ledger is rebuilt from the transcript, while turn stats, cards and decisions start empty. `session.start` re-initialises `state` before the `adopt` dispatch, so a reload re-derives the rows rather than doubling them. The only awaited work inside hooks is `next(e)`, two `clock.now()`, and the fast `session.start` calls.

---

## 7. Execution plan — workflows, subagents, models

**Roles.** Fable (this session) orchestrates: writes the subagent prompts from this spec, runs the workflows, reads every result, reviews, integrates, runs verification, and makes design and product calls. Fable does not implement unless a package needs its coordination or a judgment call that a subagent cannot make (e.g. tuning the judge prompt after live probes). **Opus** implements and reviews by default. **Sonnet** takes only mechanical work (scaffold, manifests, scripts, README skeleton).

**Workflows** (each a `Workflow` run; results read by Fable between them, two agents at a time):
1. **Scaffold** — one Sonnet agent: WP0. Gate: `scripts/check.sh` green.
2. **Core packages** — `pipeline` over WP1…WP5: an Opus implementer per package in its own git worktree (`isolation: 'worktree'`, since they run concurrently in one repo), then an Opus reviewer per package that checks the code against the spec's contract for that module and section 9, runs `check.sh`, and returns findings; Fable merges the worktrees, applies or delegates fixes. Gate: every package's tests pass together.
3. **Shell + integration** — one Opus agent: WP6, then an Opus reviewer with the register.test.ts of `mods/diff` as the reference; Fable integrates. Gate: `check.sh` green, smoke script.
4. **Design pass** — WP4's pane reviewed by Fable in a live session against the design brief and QA checklist (section 5.5); each iteration is an Opus agent with the exact findings; loop until it passes at three widths.
5. **Verification** — Fable runs section 8 itself (interactive), records probe answers in README.

Every subagent prompt carries: the spec sections for its package (verbatim), the d.ts line ranges for the types it touches, the `mods/diff` file to copy shape from, section 9 in full, and the rule "return `next(e)` on every path you don't own". Subagents return a structured result (files written, tests added, `check.sh` output, open questions); they never widen scope.

Each package: implement the contract, write the listed tests, `scripts/check.sh` green before reporting. Section 9 is mandatory. WP1-WP5 depend only on `types.ts` + `text.ts` and run in parallel; WP6 after them.

| # | Package | Files | Model | Why |
|---|---|---|---|---|
| WP0 | Scaffold | manifests, tsconfig, `.claude/types/`, `types.ts` (verbatim §4), `text.ts` (§5.0 with tests), minimal `register.ts` (session.start binding + command register + `/saver debug` echo) and `host.ts`, `tests/register.test.ts` (one test), `scripts/check.sh`, README skeleton, LICENSE, `.gitignore` | Sonnet | Mechanical; acceptance is `check.sh` green. |
| WP1 | Ledger | `core/ledger.ts`, `tests/ledger.test.ts` | Opus | Normalizer edge cases; defensive result parsing. |
| WP2 | Reducer + accounting | `core/patterns.ts`, `tests/patterns.test.ts` | Opus | State transitions, savings, registry (de)serialisation. |
| WP3 | Judge | `core/blocks.ts`, `core/judge.ts` (prompt verbatim from Appendix A), `tests/blocks.test.ts`, `tests/judge.test.ts` | Opus | Block rendering, strict validation, merge. |
| WP4 | UI (pane + band) | `ui.tsx`, `tests/ui.test.tsx` | Opus | The designed surface: the §5.5 design brief, dock vs inline, allow-listed props. Copies shape from `mods/diff/hooks/views/pane-view.tsx` and `sections/*.tsx`. Accepted only after the live design QA in §5.5 passes at three widths. |
| WP5 | Rules | `core/rules.ts`, `tests/rules.test.ts` | Opus | Templates and settings merge. |
| WP6 | Shell + integration | `register.ts`, `host.ts`, `tests/register.test.ts` (model: `mods/diff/tests/register.test.ts`) | Opus | Cross-cutting. |
| WP7 | Verification + probes | section 8 | Fable | Interactive judgment. |

Each Opus prompt gets: this spec, the d.ts line ranges for its types, the `mods/diff` file to copy shape from, and the rule "return `next(e)` on every path you don't own".

---

## 8. Verification (kept simple)

Automated (`scripts/check.sh`), after every package and at the end:
```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
claude plugin validate . --strict
bun x tsc --noEmit -p .
claude plugin test .
```
Expected: validate lists the hooked events (`session.start turn.start tool.call turn.complete session.compact prompt.submit ui.render command.run ui.close`) and the Host's `$` calls; tsc clean; all tests pass.

Headless smoke (`scripts/smoke.sh`):
```sh
CONTEXTSAVER_DEBUG=1 CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p --plugin-dir . --output-format stream-json --verbose \
  --max-turns 6 --allowedTools Bash "Run the shell command 'echo hi' three separate times using Bash, one call at a time, then say done." \
  | grep -c 'ContextSaver row'
```
Pass = count ≥ 3 (the debug `$.ui.log` line reaches a `-p` host as `ui_log`, 1887-1899). If function hooks do not load under `-p` (undocumented), drop the script; the interactive check is the smoke test.

Interactive check (Fable, once, in this repo, fullscreen terminal ≥ 144 columns, no file saves during the run):
1. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .` → after the first turn the band shows `ContextSaver ◌  … Open`; `/saver` docks the pane beside the transcript with the two-row header and the calm empty state; `/saver` again hides it. Design QA (§5.5) at 56 and 80 dock columns and inline: three tones, one bold per block, gutter aligned, nothing over width.
2. Ask Claude to make three small edits and run `bun x tsc --noEmit -p .` after each → `/saver check` → within ~30 s the pane auto-opens with a waster `● Claude keeps running the full typecheck after every step · 3× · …`; `/saver debug` shows the cited row ids exist (PRD open question 2). Click `Steer` → a one-line field opens under the verbs, pre-filled with the judge's fix; edit in the middle of the text while Claude is still producing tool calls (probe: the cursor stays put across redraws), Enter → toast `ContextSaver: fixed with your note — …`; the waster moves to DECIDED as `✎ fixed with a note`. Also send a multi-line `/saver fix …` from the composer (Shift+Enter between lines) and confirm the newlines survive in `/saver debug` (probe: `e.args` newline handling). Ask Claude to "make one more edit and check" → it runs a narrower check or declines (open question 1); SAVED grows after the narrower call or after two quiet turns.
3. Ask Claude to run `find . -type f | head -300` three times → `/saver check` → new waster; click `✓ Fix` → toast, `✓ fixed` in DECIDED; ask Claude to run it again → it declines, or the waster returns marked `ignored 1×` (D4).
4. Any further waster → `– Ignore` → `– ignored`, never shown again this session.
5. Ask Claude to run `sleep 15` → `/saver debug` shows the row (a long `next(e)` did not expire the hook; D8).
6. RULES FOR NEXT SESSION lists the steer and kill instructions as CLAUDE.md lines; `[Write]` one → `CLAUDE.md` has the bullet; `[Try once]` the other → the next prompt carries it (ask Claude what instructions it received).
7. After ~30k new tokens the header's JUDGE row shows a second run and its share of session tokens (open question 3).
8. Resize below 110 columns → `/saver` seats the compact pane inline above the prompt. `/clear` → session state resets, pane and registry survive (`/saver debug` lists stored patterns with `hits 0`).

Record answers in README "Known behavior".

**Results (2026-09-17, live run in tmux 160×45, Claude Code 2.1.274, Bedrock).** `check.sh` green (135 tests). Plugin loads under `--plugin-dir`; band and pane draw; `/saver` toggles the docked pane; the ledger records rows live (debug lines show tool, key, ms, chars). Hot-reload lesson: editing the plugin's own files in the live session re-registers the plugin and resets session state (registry survives), so the live test bed became a separate scratch project (`~/projects/saver-playground`, four slow verbose test files). With Fable as the session model the judge stayed silent three times, correctly: the repeated checks were either in one turn, explicitly requested, or Fable itself ran targeted tests. With a Sonnet session and a CLAUDE.md rule forcing the full suite after every change, the judge (Sonnet) found `execution:full-suite-no-edit` — "Claude keeps running the full bun test suite after confirming no edit was needed · 3× · 54s", citing STATS `edits-between=0` and excusing the baseline run (open question 2: yes, real ids and real facts). The pane auto-opened once at 160 columns with the card. `/saver steer <text>` recorded the decision, the standing instruction reached Claude, Sonnet stopped running the suite despite its CLAUDE.md rule (open question 1: yes, the context note changes course), and after two quiet turns the saving settled: toast `+18s · +~0.4% context saved`, mirrored in band and pane. The registry persisted to `~/.claude/plugins/store/contextsaver_inline-*.json`. Fork cost ≈ 7-9k new tokens per run (open question 3); the cadence constants stand. Layout defects seen live (band button clipped by the engine's `[-]`, header rows cut at ~70 columns, `i` button off-width, empty CONTEXT before the first turn) are fixed in the design pass. Not exercised live: Write via keyboard focus (covered by tests), Kill (covered by tests), the ignored-recurrence re-card (covered by tests).

---

## 9. Conventions for implementers (verified against the d.ts)

1. **Return something on every path.** `undefined` from a hook is a failure (skipped, fail-open, 4257-4276). End with `return next(e)` or an explicit result.
2. **`$` is spelled literally** `$.noun.verb(...)`, only in `register.ts` (host lambdas). Never assign, destructure, pass, spread or return `$`; never rebind `next`. (5153-5170)
3. **`on('literal', …)`**; one plain hook per event per plugin; matched registrations on one event may repeat (the `diff` mod has two `ui.render` and two `command.run`).
4. **`$` does not exist inside `register()`**; bind the host in `session.start`. (5890-5901, 3204-3210)
5. **`e` is deep-frozen**; rewrite as `next({ ...e, context })`. Pinned: `tool`, `tool_use_id`, `agentId` (tool events), `command`/`presentation`/`origin` (command.run), render `view`/`placement`.
6. **`tool.call` args are flat on `e`** (with `tool_use_id`, `agentId` beside them); the normalizer takes `unknown` and strips reserved keys.
7. **No `await $.model.*` inside any hook.** Judge runs detached.
8. **No npm imports, no Node, no DOM.** Relative imports + `import type … from 'claude-code'`. `$.clock.now()` is async; `Date.now()` forbidden.
9. **`.tsx`:** never declare a local `h`; elements from `$.ui.resolve(e)`; no intrinsic string tags; `context` arrays are `readonly string[]` (build new arrays).
10. **Store:** JSON, 4 MiB total, one file per plugin machine-wide. Persist `StoredPattern[]` under `patterns:${cwd}` with read-merge-write; never rows; numbers not Dates.
11. **Tests:** one `describe` per file. Drive the plugin through the engine's `$` (`$.session.start({ surface: 'terminal', isInteractive: true, cwd })`, `$.tool.call({ tool: 'Bash', command })`, `$.turn.start`, `$.turn.complete({ answer, durationMs, isAborted, turnId, reason, usage? })`, `$.prompt.submit`, `$.command.run({ command: 'saver', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })` (the test's `$` takes the full `CommandRunInput`, so `presentation` is required), `$.ui.render(...)`, `$.ui.press({ plugin: 'contextsaver', key })`). Op verbs the plugin calls are answered by stubs returning the op envelope: `on('store.get', () => ({ value: … }))`, `on('ui.open', () => ({ value: undefined }))`, `on('model.fork', () => ({ value: { text, usage } }))`, `on('command.register', ($, e) => ({ value: { command: e.name } }))`, or `{ deny }`; `mock.clock(on)`, `mock.store(on)`, `mock.env(on, {...})` answer clock/store/env. Engine-event stubs return the event's own result shape and **must carry `text`**: `on('tool.call', () => ({ result: {...}, text: 'x'.repeat(5000) }))`, errors `{ result, text, isError: true }`, refusals `{ deny }` (core sets `text` only for its own results, 7995-8000). After `$.ui.press`, `await clock.settle()` before asserting (`onPress` is `() => void`). Tests ≤ 5000 ms. Fixtures under `tests/fixtures/`, one export per file.
12. **Style:** small pure functions; constants shared across modules live in `types.ts`; a module's private lookup tables and a drawing's layout cells may stay local, named, at the top of the file; no classes; one JSDoc line per exported function.

---

## 10. Deliberately not built (v1)

Code-side waste detectors (D0); `fires_after` (a finding already requires two occurrences, so cards fire on report); blocking any tool at `tool.check` (Fix and Fix… are prompts); `prompt.section` steering; `$.model.classify`; `$.turn.abort`; generated guard mods and `permissions.deny` rules; editing an existing agent's `model:` field; `turn.step`; `engine.create` nouns; Client modules; `claude plugin eval` suites; hover "basis" tooltip; `session.compact` rewriting (v2); next-session measurement (v2); registry export (v3).

---

## 11. v0.4 — Spawns have a size

### 11.0 Why

Waste is anything that bogged a session down, made it longer than it had to be, or spent tokens that created no value: if the same or a better result was reachable with less, the difference is waste. Repetition (§Appendix A's first question) is one case of that, not the whole of it.

Case study: session `fc2f4359` (aos-ui, `hermes-vendored-gateway` worktree), 48 h, 15 workflows, ~190 agents, ~21 h of agent wall-clock, ~55M input tokens, 534 edits. v0.3 caught local repeats (a suite re-run to page its output, a repro retried after a hang). It missed the dominant waste, all of it in spawned work: 11 Sonnet agents per workflow whose only job was to run four passing check commands; review rounds costing as much as implementation and returning lows alone; a research fan-out where 74 of 92 agents were a verification tier that changed no decision; a fix loop that introduced a new `high` every round; the orchestrator re-running an agent's identical gate 41 s later; a question with a recommended default that idled the session 352 min; eight dead turns (provider errors) nobody restarted for ~140 min. Cause: a `Workflow`/`Agent` row records ~50 ms and `-` flags — a spawn has no size — while the API already delivers every subagent's cost (`turn.complete` fires per agent loop with `agentId`, `usage`, `durationMs`, `reason`) and `register.ts` drops it at `e.agentId !== undefined`. Keys fragmented as well: 864 check runs became 710 keys because the key is the whole command line, pipes included, and `timeout N` erased the class.

v0.4 gives a spawn a size, teaches the judge proportion, records how a turn ended, and adds a dev replay harness that runs the plugin's core over a recorded session so this case study is a regression corpus.

### 11.1 Ledger keys and flags (`core/ledger.ts`) — WP-A

- `NOISE` also strips a leading `timeout <duration> ` (`\d+[smhd]?`) and a leading `time `.
- The head token is matched by its basename (`venv/bin/python` → `python`); `RUNNERS` gains `python -m` and `python3 -m`, so `python -m pytest tests` classifies `test`.
- Bash key. For `cls !== 'other'`: `${cls}:${canonical}` where `canonical` is the segment `classOf` classified (the first non-`other` segment of the `&&`/`;`/`||` chain) with noise stripped, cut at the first `|`, `>` or `<` (quoting is not parsed — the same simplification `CHAIN` makes), trailing `2>&1` and whitespace removed, collapsed, cut at `KEY_MAX`. For `cls === 'other'`: unchanged, the whole collapsed command (a `jq` pipeline is its pipes). Rationale: the key names *what ran*; how its output was filtered is not a second behaviour. `bunx vitest run packages/proxy 2>&1 | tail -12` and `… | grep -E "FAIL" | head -4` are one key; 54 runs read `×54 | edits-between 0` in STATS instead of 30 keys at `×1`–`×3`, and a Fix signature matches the next run.
- Required examples (each a test): `bunx vitest run packages/proxy 2>&1 | tail -12` → `test:bunx vitest run packages/proxy`; `timeout 900 bunx vitest run src` → cls `test`, key `test:bunx vitest run src`; `nproc; timeout 900 bunx vitest run src 2>&1 | grep -E "Tests"` → `test:bunx vitest run src`; `cd /tmp/x && timeout 600 bunx vitest run a.test.ts` → `test:bunx vitest run a.test.ts`; `timeout 3000 venv/bin/python -m pytest tests/agent` → `test:venv/bin/python -m pytest tests/agent` (cls from the basename, key keeps the text as typed); `bunx tsc -p tsconfig.proxy.json --noEmit 2>&1 | tail -2; echo "tsc $?"` → `typecheck:bunx tsc -p tsconfig.proxy.json --noEmit`; `jq -r '.x' f.json | tr -d '\n'` → `other:jq -r '.x' f.json | tr -d '\n'` (unchanged); `sed -n '1,40p' a.ts` → `read:sed -n '1,40p' a.ts`.
- Flags: `ask` when `e.tool === 'AskUserQuestion'` (its `ms` is the wait for the person); `recommended` when `ask` and `JSON.stringify(e.questions ?? '')` contains `(Recommended)`. Document both in the `Row.flags` comment.
- Stored signatures carrying old keys stop matching. Accepted: they matched one run in six.
- Tests: `tests/ledger.test.ts` for every example above and the flags; any existing test or fixture that asserts an old key shape is updated, not deleted.

### 11.2 Loops and runs (`core/spawns.ts`, new; `core/types.ts`) — WP-B

Types added to `types.ts`:
```ts
export type TurnEnd = 'answer' | 'aborted' | 'refusal' | 'error'
export type Tokens = { input: number; output: number; cacheRead: number; cacheCreate: number }
export type Outcome = { kind: 'findings'; critical: number; high: number; medium: number; low: number } | { kind: 'report'; chars: number }
export type Loop = { id: string; run: string | null; label: string | null; phase: string | null; model: string | null; turns: number; ms: number; tokens: Tokens; ended: TurnEnd | null; firstTurn: number; firstSeq: number; outcome: Outcome | null }
export type Run = { id: string; name: string; dir: string | null; turn: number; seq: number; at: number; refreshedAt: number }   // at: clock at launch; refreshedAt: last journal read (0 never)
export type JournalEntry = { kind: 'started'; agentId: string; label: string | null; phase: string | null } | { kind: 'result'; agentId: string; outcome: Outcome }
```
`TurnStat` gains `ended: TurnEnd`, `at: number` (clock at completion) and `idleMs: number` (0 until the next turn starts). `State` gains `loops: Loop[]` (cap `LOOP_CAP = 400`, oldest dropped) and `runs: Run[]`. Constants: `LOOP_CAP = 400`, `AGENTS_ROWS = 60` (loop lines rendered in full), `RUN_REFRESH_MS = 10_000`, `RUN_FRESH_MS = 600_000`, `MAX_BEHAVIORAL_FINDINGS = 3` (was 2: agent findings are signature-null).

Actions (reducer in `patterns.ts`):
- `{ type: 'turn.start'; now: number }` — as before, and sets `idleMs = now - at` on the last completed turn when its `at > 0`.
- `{ type: 'loop.turn'; agentId; model: string | null; ms; tokens: Tokens; ended: TurnEnd; turn }` — creates the loop if unknown (`firstTurn = turn`, `firstSeq = state.seq`) and grows it: `turns + 1`, `ms +=`, `tokens +=` fieldwise, `ended` = this one, `model` = this one when not null.
- `{ type: 'agent.start'; agentId; description; model: string | null }` — an `Agent` tool result: the loop is created or labelled `description`, `run` stays null.
- `{ type: 'run.start'; run: { id; name; dir }; now }` — a `Workflow` tool result: appends `Run { turn: state.turn, seq: state.seq, at: now, refreshedAt: 0 }`; an id already present is left as it is (a resume).
- `{ type: 'run.journal'; runId; entries: JournalEntry[]; now }` — `started` entries create or update the loop's `run`, `label`, `phase`; `result` entries set `outcome`; the run's `refreshedAt = now`.
- A `row` whose `agent !== MAIN_AGENT` and names no loop creates a bare loop (`id`, `firstTurn`, `firstSeq`, everything else empty/null), so alias order stays the ledger's order.

`spawns.ts` (pure): `parseJournal(text): JournalEntry[]` — one JSON object per line, bad lines skipped; `{type:'started', agentId, label, phase}` → started; `{type:'result', agentId, result}` → result whose `outcome` is `findings` counts when `result.findings` is an array (`severity` in critical/high/medium/low counted, anything else ignored), else `report` with `chars` = the string's length or the JSON's. `runOf(value: unknown)` — a `Workflow` result with `taskType === 'local_workflow'` → `{ id: runId, name: workflowName, dir: transcriptDir ?? null }`, else null. `agentOf(value)` — an `Agent` result with string `agentId` → `{ agentId, description: description ?? '', model: resolvedModel ?? null }`, else null. `loopStats(rows, loop): { calls; edits; checks; reads }` — over the rows whose `agent === loop.id`: edits = tool Edit/Write/NotebookEdit or `paths.length > 0`; checks = cls in test/lint/typecheck/format/build; reads = cls read/search or tool Read/Grep/Glob. `activeRuns(state, now)` — runs with a loop whose `ended === null`, or with no loop yet and `now - at < RUN_FRESH_MS`. `journalPath(run)` = `${run.dir}/journal.jsonl`. `agentAliases(rows, loops = [])` in `evidence.ts` — rows first, in today's order, then loops not yet named, in `state.loops` order.

### 11.3 Evidence and the judge (`blocks.ts`, `judge.ts`, `patterns.ts`) — WP-B

`agentsBlock(state)`: `(none)` without loops; else one line per run — `${name} | ${id} | loops ${n} | Σ${min}m | Σ${ktok}k tok | edits ${e} | turn ${turn}` — then `loops:` and the newest `AGENTS_ROWS` loops in full, older ones folded per run as `~ ${run name or 'agents'} | ×${n} | Σ${min}m | Σ${ktok}k`. Loop line: `${alias} | ${run name ?? '-'} | ${label ?? '-'} | ${model short: the id's family word, e.g. opus/sonnet/haiku/fable, else the id} | ${turns} | ${min}m | ${ktok}k | edits ${e} | checks ${c} | reads ${r} | ${outcome} | ${ended ?? 'running'}` with `outcome` = findings as `1 high 4 low` (zero counts omitted; `0 findings` when all zero), report as `report ${chars}ch`, null as `-`; `ktok = round((input + cacheCreate + output) / 1000)`; minutes to one decimal.

`turnsBlock`: a turn line appends ` | error`, ` | refusal` or ` | aborted` when `ended !== 'answer'`, and ` | idle ${m}m` when `idleMs ≥ 60_000`. `sinks(rows, measure, loops = [])`: the `SPAWN_SINK` amount for `ms` is `Σ loops.ms` with `count = loops.length` (the Agent/Workflow rows' own 50 ms are dropped from that sink); `chars` unchanged. `buildPrompt` fills a new `{{AGENTS}}` placed before `{{TURNS}}`.

Evidence handles: `agent:<alias>` is accepted only with `signature: null`; the alias must name a loop under `agentAliases(state.rows, state.loops)`; it is stored in `hits` as `agent:${loop.id}`; drop reason `evidence agent:aN not in AGENTS`. `citedTurns` maps an agent handle to `loop.firstTurn`. `estOf`: when the evidence holds agent handles and no turn handles, the cap is the median of the cited loops' `input + cacheCreate + output`; otherwise as today.

Cards: an agent handle renders `Evidence { turn: firstTurn, what: \`${label ?? 'agent'} · ${model ?? '?'}\`, agent: alias, ms: loop.ms, chars: 0, head: \`${ktok}k tokens · ${edits} edits\` }`; `Card.total.unit` gains `'agents'` (rows empty, agent handles present: `calls` = loops cited, `ms` = their sum, `chars = (estTokensPerTurn ?? 0) * 4`). `bandModel` gains `died: TurnEnd | null` (the last turn's `ended` when it is `error` or `refusal` and no turn has started since, i.e. `turns.at(-1).turn === state.turn`) and `running: { name; loops; calls; label: string | null } | null` (the newest active run: its loop count, those loops' row count, the newest unended loop's label). `BandModel.state` gains `'died'`, first in precedence. `debugDump` adds a `runs N · loops N · active N` line.

Prompt (Appendix A regenerated; byte-identical in `JUDGE_PROMPT` and `docs/SPEC.md`; `bun run scripts/appendix-a.ts` green). Exact edits:
1. Paragraph 2: "Answer three narrow questions." → "Answer four narrow questions."; append after the circles sentence: " What was out of proportion: which spawned work — an agent, a workflow stage, a review or verification round — cost far more than what it produced, or did what a shell step would have done (AGENTS below)."
2. Rule 2: after "`turn:<n>` where `<n>` is a `turn` number printed in TURNS" insert ", or `agent:<alias>` where `<alias>` is an `alias` printed in AGENTS"; "turn handles only for findings whose `signature` is null" → "turn and agent handles only for findings whose `signature` is null".
3. Rule 9: "at most two with `signature: null`" → "at most three with `signature: null`".
4. Counting, first bullet: after "is one choice however wide." append " Breadth is one decision; weight is not: every stage of a workflow (each `label` in AGENTS) is a decision of its own, and the same role recurring stage after stage — a check loop per chunk, a review round after every fix — is a repeat."
5. `multi-agent` cues, before "Not:": append "; a loop whose rows are only checks that passed, with `edits 0` and a report as its outcome (AGENTS `checks` > 0) — a shell step given a model; review or verify loops with `edits 0` whose outcome carries no medium, high or critical finding, recurring stage after stage; two or more verifier loops per finding; a run whose tokens per edit are several times the others'; a fix loop followed by a review whose outcome carries a new high in the same stage, twice (regression chasing: stop the loop and re-plan)". Its "Not:" gains "; one review per stage that found a medium or higher; a loop that edited; a fan-out's breadth on its own".
6. `communication` cues, before "Not:": append "; an `ask` row that held the turn for minutes while no agent ran (no rows between it and the next prompt) and whose options carried a recommended default (`recommended`) — proceed on the default and ask beside the work". Its "Not:" gains "; a question whose answer the transcript shows changed the plan".
7. Never report, the Parallelism bullet → "- Parallelism: calls issued together with nothing between them are one decision, and agents on disjoint scopes launched at once are one decision — one, not none: their weight is judged under multi-agent."
8. `est_tokens_per_turn` paragraph: append " For agent handles it is the tokens one avoided loop would have cost, grounded in AGENTS `tok`, conservative end."
9. Two examples appended to Examples: (a) AGENTS lists `a3 | w3 | check:C3 | sonnet | 1 | 1.7m | 48k | edits 0 | checks 4 | reads 0 | report 1600ch | answer` and `a7 | w3 | check:C4 | …` alike, and no row of theirs carries `err`: `{"id":"multi-agent:check-loops-for-shell-steps","kind":"Claude keeps spawning an agent per chunk whose only job is to run four passing check commands","evidence":["agent:a3","agent:a7"],"signature":null,"alternative":"Run a stage's checks as a shell step of the workflow script or inside the reviewer; spawn an agent only for work that needs judgment.","confidence":0.85,"est_tokens_per_turn":48000}`. (b) three `review:*` loops of one run, each `edits 0` with outcome `3 low`, a fix loop after each: `{"id":"multi-agent:review-rounds-that-find-only-lows","kind":"Claude keeps running a full review round after every fix although the last two found only low findings","evidence":["agent:a9","agent:a12"],"signature":null,"alternative":"Route only medium-or-higher review findings to a fix round; end the stage when a review returns lows alone.","confidence":0.8}`.
10. Block docs: TURNS heading → "`turn | in | out | cacheCreate | calls | ms | answerChars`, then `| aborted`, `| error` or `| refusal` when the turn ended that way and `| idle <m>m` when the next prompt came a minute or more later, then the facts line (context window, fixed per-turn overhead, turns where a compaction happened)". LEDGER flags list gains "`ask` (an AskUserQuestion: its `ms` is the wait for the person) `recommended` (its options named a default)". New section before TURNS: "## AGENTS — the loops this session spawned. First one line per run: `name | id | loops | Σmin | Σtok | edits | turn`. Then one line per loop, oldest first: `alias | run | label | model | turns | min | tok | edits | checks | reads | outcome | ended` — `alias` is the LEDGER's `agent` name for that loop, `label` the stage the workflow gave it (`impl:C3`, `check:C3`, `review:C6-r1`), `outcome` what it returned (`1 high 4 low`, `report 5900ch`), `ended` `answer`, `error`, `aborted`, `refusal` or `running`. `tok` counts new tokens (input, cache creation, output) in thousands. Loops older than the window fold into `~ run | ×loops | Σmin | Σtok` lines. Cite a loop as `agent:<alias>`; a line here is a loop's whole cost, so its weight against its `edits` and `outcome` is the proportion question's evidence.\n{{AGENTS}}".

Tests: `tests/spawns.test.ts` (parseJournal tolerant, runOf/agentOf shapes, loopStats, activeRuns), `tests/blocks.test.ts` (AGENTS block, folded lines, TURNS suffixes, TIME agents sink from loops), `tests/judge.test.ts` (agent handles accepted/dropped, est cap, three behavioural findings), `tests/patterns.test.ts` (new actions, idle, died/running band, agent card evidence, debugDump line). `docs/SPEC.md` §4 (`types.ts` verbatim) updated.

### 11.4 Shell and band (`register.ts`, `ui.tsx`) — WP-C

- `turn.start`: `now = await engine.now()`; `dispatch({ type: 'turn.start', now })`.
- `turn.complete` with `e.agentId`: `dispatch({ type: 'loop.turn', agentId: e.agentId, model: e.usage?.model ?? null, ms: e.durationMs, tokens: {…from e.usage, 0 when absent}, ended: e.reason, turn: state.turn })`, then `next(e)` — no usage sample, no cadence. Main loop: the stat gains `ended: e.reason`, `at: now`, `idleMs: 0`.
- `tool.call`, after the row: `runOf(result.result)` → `dispatch run.start` and `void refreshRuns(true)`; `agentOf(result.result)` → `dispatch agent.start`; then `void refreshRuns(false)`.
- `refreshRuns(force)`: for each run in `activeRuns(state, now)` (every run with a `dir` when `force`) whose `now - refreshedAt ≥ RUN_REFRESH_MS` or `force`: `engine.readFile(journalPath(run))` → `parseJournal` → `dispatch run.journal`; a read that fails still stamps `refreshedAt` (dispatch `run.journal` with `entries: []`). Never awaited from `tool.call`; awaited once in `judgeOnce` before `buildPrompt`.
- `host.ts` unchanged (`readFile` exists; `claude plugin test` requires the op to be literally called — it is).
- Band (`ui.tsx`): `BAND_MARK.died = { text: '✕', color: <the existing error/warning tone; else TONES.accent> }`; died line: `Last turn ended in an API error · type anything to continue` / `Last turn ended in a refusal · …`. Watching state with `model.running`: mark stays `◌`, line `${name} · ${label ?? 'running'} · ${loops} agents · ${calls} calls`, dim, longest-first fitting like `foundLines`. The pane's evidence wording for `unit: 'agents'` reads `N agents`.
- `tests/register.test.ts`: the subagent `turn.complete` test becomes "records the loop" (tokens, ms, model, ended); a `Workflow` tool result → `run.start` and a journal read through an `on('fs.read', …)` stub → labels in the AGENTS block of the next fork's prompt; an `Agent` result → labelled loop; a main turn with `reason: 'error'` → band `died` line, cleared by the next `turn.start`; an active run → the running line; `idle` on the next turn.start.
- `plugin.json` → `0.4.0`; README "Known behaviour": one line on what the band says after a dead turn and while a workflow runs; §6 of this spec: the four hook changes.

### 11.5 Replay harness (dev, `scripts/replay.ts`) — WP-R

Outside `tsconfig` like `scripts/appendix-a.ts`, run with `bun run scripts/replay.ts`; not plugin code, imports `hooks/core/*` only. It feeds a recorded session through `reduce` and prints what the judge would have seen, and optionally what it says.

Input: one or more session ids or paths of main transcripts (`~/.claude/projects/<dir>/<id>.jsonl`); for each, its `<id>/subagents/**/agent-*.jsonl` (with `.meta.json` beside: `model`, `description`, `workflowPhase`) and `<id>/subagents/workflows/wf_*/journal.jsonl`. Events from every file are merged by timestamp.
- A main `user` line that is a prompt (not `isMeta`, string content or text blocks without `tool_use_id`, not starting `<task-notification>`, `<local-command`, `<command-name>`) → `turn.start { now }` (now = its timestamp in ms).
- An assistant `tool_use` and the `user` line holding its `tool_result` → `row` via `rowOf({ ...input, tool: name, tool_use_id: id, agentId? }, { result: toolUseResult, text }, ms, turn)` — `ms` = result timestamp − use timestamp; `text` = the tool_result content's text; `toolUseResult` = that user line's `toolUseResult` field (this is what carries `runId`/`transcriptDir`/`agentId`); `agentId` = the agent file's id (`agent-<id>.jsonl`) for agent files, absent for main. Then `runOf`/`agentOf` on the same value → `run.start`/`agent.start`.
- A workflow's journal → `run.journal` dispatched when the first row of any of its agents lands, and again after its last.
- End of a main turn: the `system` line with `subtype: 'turn_duration'` → `turn.complete` with tokens summed over the turn's assistant `message.usage`, `ms = durationMs`, `answerChars`/`answerHead` from the last assistant text, `ended`: `'error'` when the turn's last assistant message is an API error (find the field the transcript uses — grep once for `isApiErrorMessage`, `api_error`, `Server error` — and document which), `'aborted'` when the next user line starts `[Request interrupted`, else `'answer'`; `at` = its timestamp; `context: null`.
- An agent file's end → `loop.turn` with `model` from meta, `ms` = last − first timestamp, tokens summed, `ended 'answer'` (`'error'` when its last message is an API error).
- `usage`: `{ window: --window (default 1_000_000) }` once at start.
Options: `--at <ISO>` (repeatable): stop feeding at that time and judge there — one checkpoint each; default one checkpoint at the end. `--prompt`: print `buildPrompt(state)` and exit. `--summary`: print the STATS, TIME, AGENTS and TURNS blocks only. `--judge`: pipe the prompt to `claude -p --model <$REPLAY_MODEL, default 'sonnet'> --output-format json`, `parseReply` the text against the state, `merge`, and print kept findings (id, kind, evidence, confidence, alternative) and dropped reasons. Output JSON on stdout, a readable summary on stderr. It must handle a 16 MB main transcript and 190 agent files in well under a minute (stream lines; never `JSON.parse` a whole file).

Acceptance corpus: sessions `3ee71a8b-d477-45da-841e-682cc0304ea7` (both project dirs: `-home-anakin-projects-aos-ui` and `-home-anakin-projects-aos-ui--claude-worktrees-hermes-vendored-gateway`) then `fc2f4359-1088-42df-ba04-bdfe424d1c1b` (the worktree dir), judged at three checkpoints: `2026-09-16T22:45:00Z` (research done), `2026-09-17T14:00:00Z` (W3 done), `2026-09-18T16:20:00Z` (end). Expected in the blocks (`--summary`): E1 `bunx vitest run packages/proxy` as one STATS key with ×50+; E2 AGENTS shows the W3 `check:*` loops with `edits 0`, `checks ≥ 3`, a report outcome; E3 review loops with `edits 0` and low-only outcomes, and the C6 `review:*` chain with a `high` in each; E4 the 74 `verify*` loops of the research run; E5 an `ask` `recommended` row of ~352 min (21,000,000 ms) in the LEDGER or STATS; E6 TURNS lines with `| error` and `| idle` for the dead turns on 09-17 14:57–18:53 and 09-18 17:22–18:07. Expected from the judge (`--judge`): at least E2 and one of E3/E4 as findings at checkpoint 2 or 3, and E5 at checkpoint 2. Whatever the judge does or does not return is reported verbatim; the harness is not tuned until it passes.

### 11.7 Round two — what the first replay showed (WP-D)

The first replay (three checkpoints, Sonnet judge) kept E2 at 0.92 with ten loops cited, and returned E3 and E4 three times — every one discarded by `parseReply` on a character cap (`kind` 131 and 137 chars, `alternative` 204 and 206 chars) or an uppercase `C6` in an id. E5 was under the row cap (~2,900 rows below it at checkpoint 2), and loops older than the window read `edits 0 | checks 0` because `loopStats` counts surviving rows. Fixes, all mechanical:

- **Lenient validation** (`judge.ts`): the id's slug is lowercased before `ID_SHAPE` is tested. `kind` and `alternative` are accepted up to twice their max; over the max and under twice it, the finding is kept as returned and the run report notes `kind: 131 chars, over 120` (as `explanationDrop` does for `time`); only over twice the max is it dropped. The pane wraps, so nothing is cut. A model cannot count characters; a cap it misses by ten should cost a note, not the finding.
- **Counters on the loop** (`types.ts`, `patterns.ts`, `spawns.ts`, `blocks.ts`): `Loop` gains `calls`, `edits`, `checks`, `reads`, incremented by the reducer on every `row` whose `agent` names the loop (the same rules `loopStats` applies now). `loopStats` is replaced by these fields; the AGENTS block reads them, so a loop's line is whole whether or not its rows survive the cap.
- **Aggregates beyond the cap** (`types.ts`, `patterns.ts`, `blocks.ts`, `evidence.ts`): `State.folded: Record<string, Folded>` keyed `${tool}\t${key}`, `Folded = { tool; key; cls; agent: string /* 'main' or the first loop seen */; count; ms; chars; firstTurn; lastTurn; flags: { ask: number; recommended: number; err: number } }`, grown when `applyRow` drops a row past `ROW_CAP` (the dropped row is folded, never lost). `aggregate` for STATS merges `folded` with the rows' own stats per pair (count/ms/chars summed, `firstTurn` min, `lastTurn` max, `editsBetween` from rows alone); the `~` lines of LEDGER come from the same merged fold of rows before the window; TIME and CONTEXT totals and sinks include the folded amounts, and their `largest rows` stay citable rows. STATS gains, under `per call:`, a `waits:` line when any folded or live row carries `ask`: `AskUserQuestion | ×n | Σms | recommended ×m` — not citable, but the `time` sentence and the communication cue can name it. `applyReset` clears `folded`.
- **Review lows**: `scripts/replay.ts` dispatches `agent.start` from an agent file's `.meta.json` `description`/`model` at the loop's first event (label `-` was all the judge saw of the two Explore agents); the AbovePrompt render hook in `register.ts` reads `now` once (`await engine.now()`, falling back to `bandModel(state)` on failure) and calls `bandModel(state, now)` so a loopless run's freshness ages by the clock.
- Prompt: the STATS heading gains "then `waits:` — every AskUserQuestion this session, its total wait and how many carried a recommended default; not citable, but the time it held the session is a fact to explain". (Appendix A regenerated, byte-identical.)
- Acceptance, re-run as §11.5 states: E2 kept; at least one of E3/E4 kept (not merely returned); E5 named in a `time` sentence or a communication finding at checkpoint 2; W3 loops at checkpoint 3 read their whole `edits`/`checks`.

### 11.6 Not built in v0.4

Agent facts in the pane header; a size for a spawn whose loop never reaches `turn.complete` (only its rows count); subagent transcripts (API limit); a finding for dead turns (not Claude's behaviour — the band shows it instead).

---

## 12. v0.5 — The mod speaks your language

### 12.0 Why

A card is an interruption written to be read at a glance, mid-work. Read in a second language it is read
slower, and a card read slower is a card dismissed. The whole surface moves together or the translation is
worth little: the pane, the band, what `/saver` answers — and the findings themselves, since a French pane
whose cards say *Claude keeps running the whole suite* is a pane in two languages.

Nothing about this is any one language. English is the bundle every other is typed against; the system is
what makes the next one cheap. v0.5 ships six: `en`, `fr`, `es`, `de`, `zh-CN`, `ja`.

### 12.1 The bundle (`hooks/say/`) — WP-L1

`en.ts` holds the types and the one complete bundle, in six groups: `pane`, `band`, `command`,
`categories`, `judge`, `config`. A line that takes an argument is a function, never a template assembled at
the call site — word order and plural are the translator's, and a caller gluing two halves together would
have decided both for them.

A language is a file of `PartialTexts`: the keys it translated and no others. `sayOf(tag)` lays it over
English group by group, so a half-finished translation draws its own words where it has them and English
where it has not; a misspelt key is a compile error, and a tag no file answers to is English, silently —
the option is written by hand and outlives the files beside it.

`setSay` settles the bundle once, at `register`, and `say()` reads it. The holder exists so that a language
does not have to be carried down through every view model, the reducer and each pure function's parameters.
Writing the `/config` row reloads the module, which calls `setSay` again with the new value, so there is
nothing to keep in step.

What is **not** in the bundle is deliberate: the glyphs, `ContextSaver` itself, `/saver` and its
subcommands, the nine `Category` enum values inside an id, the evidence handles, the signatures and the
sink labels. A word that is typed or matched may not move with the language.

### 12.2 Where it reaches — WP-L2

- `ui.tsx` — every label, hint and ladder rung. `CHECK_CELLS` and `RULES_CELLS` were constants counted off
  the English labels; they are now measured off the words in hand, since a translation is free to spend
  more cells and a reserve that is too small squeezes the buttons at the row's right edge. A row of
  controls gives back its glyphs, then its gaps (`controlsFitting`); the rules footer, whose three German
  verbs still leave the title nothing, stacks the controls under the title instead — a row that costs
  nothing on a pane that scrolls, and never drawn on the inline one, which draws a count line.
- `patterns.ts` — a card's stats line, its `ignored ·` prefix and the line quoted under a cited loop.
- `text.ts` — `instructionOf` and `killPrompt`, the two texts a decision is sent to Claude inside.
- `register.ts` — every reply and every toast, and the command's `description` and `argumentHint`. It takes
  `options` now, and reads `options.language` there and nowhere else.
- `config.describe` on `contextsaver.language` — the row's label, and its help extended with the tags
  `LANGUAGES` really has. The options themselves cannot be rewritten from a hook, so the manifest lists
  them: that is the one duplication, and adding a language means touching it.

### 12.3 Cells, not characters — WP-L5

A terminal gives an East Asian ideograph two cells and a Latin letter one, and every reserve, ladder and
column in the drawing is a number of cells. Measuring `.length` was right for as long as every bundle was
Latin; `zh-CN` and `ja` would have been laid out at half their real width and run through every border on
screen. So `core/text.ts` gained `widthOf` (Unicode TR #11 Wide and Fullwidth → 2, the rest → 1),
`padCells`, and a `fit` that truncates by cells; `ui.tsx` measures with them throughout. For a Latin
bundle `widthOf` is `length`, so nothing about English, French, Spanish or German moved.

`linesOf` also had to learn to break a word: Chinese and Japanese are written without spaces, so a whole
`why` sentence arrives at the wrap as one word and would otherwise have been one truncated line. `pieces`
cuts it where those scripts wrap, at a character, and each full piece then takes a line of its own — so no
space is inserted inside a sentence that never had one.

Two more places a non-Latin bundle reached:

- `slug` whitelisted `a-z0-9`, so a rule the judge titled in Japanese slugged to nothing and a skill would
  have been written to `…/skills//SKILL.md`. It keeps any letter or digit now (`\p{Letter}`, `\p{Number}`),
  which for a Latin title is the same expression it always was, and `rules.ts` falls back through the body
  to a constant so a path can never have a hole in it.
- `sayOf` matches a tag without case against the real keys, so `zh-CN` keeps the spelling BCP 47 gives it
  in the manifest, in the menu and in `LANGUAGES` alike.

### 12.4 The judge — WP-L3

`JUDGE_PROMPT` stays English: it is the model's instruction sheet, and translating three thousand words of
counting rules would be a second prompt to keep correct. Instead it gains a `{{LANGUAGE}}` placeholder
between the LEDGER and its last line, filled from `say().judge.directive`. English fills it with nothing —
the placeholder and the blank line under it are replaced as one string, so the prompt English is handed is
this document's, to the character.

A language that wants its findings in its own words fills two keys:

- `judge.directive` — the paragraph, written in English because a consigne in the prompt's own language is
  the one that is followed. It names the fields whose prose moves (`kind`, `why`, `alternative`, `time`,
  `context`, a proposal's `title` and `body`) and, explicitly, everything that does not: the JSON keys, the
  id and its slug, the nine category names, the evidence handles, the signature copied character for
  character from a row, and the proposal's `kind`. A translated one of those discards the finding.
- `judge.kindPrefix` — the words every `kind` opens with. The prompt asks for them and `findingOf` tests
  for them, off this one key, so the two can never drift. None of the six carries an apostrophe: a prefix
  matched character for character is no place for one the model may straighten.

English's `Claude keeps ` runs into a gerund, and only two of the five follow it there. The prefix is the
one place the grammar of a language is the plugin's problem, so each directive says what comes after it:

| | prefix | what follows |
|---|---|---|
| `fr` | `Claude continue de ` | infinitive — *relancer toute la suite* |
| `es` | `Claude sigue ` | gerund — *ejecutando toda la suite* |
| `de` | `Claude wiederholt ` | a noun phrase, since German cannot carry on with a gerund — *den kompletten Testlauf nach jeder Änderung* |
| `zh-CN` | `Claude 反复` | the verb, with no space after the prefix — *在每次单文件编辑后运行整个测试套件* |
| `ja` | `Claude は繰り返し` | the clause, its verb at the end — *単一ファイルの編集ごとにテストスイート全体を実行しています* |

Leaving both out is a complete answer: the chrome is translated and the cards keep coming back in English.

### 12.5 Testing a language — WP-L4

`scripts/replay.ts` takes `--lang <tag>` and calls `setSay` before anything is built, so the harness of
§11.5 is what checks a translation over a real session rather than a fixture:

```sh
bun run scripts/replay.ts <session-id> --prompt --lang fr | tail -8   # the directive the fork is handed
bun run scripts/replay.ts <session-id> --judge  --lang fr             # the findings it comes back with
```

`--prompt` shows the paragraph landing after the LEDGER and before the last line; `--judge` reads the
reply back through that language's own `kindPrefix`, so a translation whose directive the model ignores
shows up as `returned N, kept 0` with the prefix named in the drop reason. A tag `LANGUAGES` does not
carry is refused here rather than falling back: the plugin is silent about an unknown tag on purpose, a
dev tool told to replay in a language that does not exist has misunderstood its operator.

Beside it: `tests/say.test.ts` covers the bundle, the merge, the two judge contracts and the two gutter
labels a translation cannot degrade out of; the width test in `tests/ui.test.tsx` runs thirteen pane
models and four band models over eight widths in every language the plugin ships — which is what caught
the two reserves counted off the English labels, and then the German rules footer.

### 12.6 Not built in v0.5

Numbers stay as they are — `9.9k`, `3m 50s`, `~4%` — rather than taking the language's own decimal mark:
`/saver debug` and the replay harness read them back, and a comma there would be a second format to parse.
`/saver demo`'s sample cards stay English; they are a drawing aid behind `CONTEXTSAVER_DEBUG`, not a
session's own words. Patterns already in the store keep the language they were found in until the behaviour
is found again — they are the judge's sentences, and re-translating them would be inventing evidence.

---

## Appendix A — The judge prompt (verbatim; `JUDGE_PROMPT` in `core/judge.ts`)

Merged from the synthesized draft and both critics' revisions; every column it names exists in `Row`/`TurnStat`/`KeyStat` (sections 4, 5.1) and is rendered by `buildPrompt` (section 5.3). Static part ≈ 3,050 words (whitespace-separated) / ≈ 19 kB.

```text
You are auditing THIS session for wasted context and wasted time. The transcript above is your own: read it for intent — what the user asked for, what you were told, what you already decided. The blocks below are the only evidence of what actually ran; nothing outside them exists for this audit.

Answer four narrow questions. What repeated: which behaviours have already happened more than once, separated by other work, or have you said you will keep doing — and what should be done instead? Where the time and the context went: which of the largest sinks below are repetition or work nobody asked for rather than the work this session needed. What is going in circles: the same failing command retried with no diagnostic step between, read/edit/read on one path with nothing finished, an edit failing on one path over and over. What was out of proportion: which spawned work — an agent, a workflow stage, a review or verification round — cost far more than what it produced, or did what a shell step would have done (AGENTS below).

You are writing an interruption. Every finding can put a card in front of the user mid-work and can become a standing instruction that constrains you for the rest of the session. A wrong finding costs more than a missed one: it interrupts correct work, teaches a bad rule, and makes the user distrust the next card. Prefer silence to a guess. `"findings": []` is a correct and common answer.

## Rules
1. Report behaviours, not incidents. A finding needs two unexcused occurrences of the same behaviour separated by other work (see Counting), or one occurrence plus your own stated intent to keep doing it ("I'll re-run the suite after each fix"). A single expensive call is never a finding.
2. `evidence`: row ids copied from the LEDGER `id` column (`r12`), or `turn:<n>` where `<n>` is a `turn` number printed in TURNS, or `agent:<alias>` where `<alias>` is an `alias` printed in AGENTS — turn and agent handles only for findings whose `signature` is null. Copy ids exactly; never renumber, abbreviate or reformat one. A finding with an id that is not in these blocks is discarded whole. STATS lines and `~` summary lines carry no id: use them for counts and history in `why` (they are the whole session, counted for you), never cite them as evidence, and never assume the oldest full row is the first occurrence.
3. `signature`: copy `key` character-for-character from one LEDGER row and `tool` from that same row. Keys are cut at 200 characters — copy the cut, never complete a command from memory. A pair that does not match a row discards the finding. Choose a key that only the wasteful version of the call carries; when no single recurring call carries the behaviour, use `"signature": null`.
4. Reuse ids. If KNOWN PATTERNS already names the behaviour, return that exact `id` with fresh evidence. The same command, file or lens under a different slug or category is the same waste: scan KNOWN PATTERNS and DECISIONS before minting an id.
5. Respect DECISIONS. A `keep` silences that behaviour under any id, category or wording for this session, and a kept occurrence may not be cited as evidence inside another finding. A behaviour kept in a previous session may be reported only with three or more occurrences and confidence 0.8 or higher. A `steer` or `kill` may be reported again only if it recurred after that turn: cite rows whose `turn` is greater and say so in `why`.
6. `kind`: one sentence of at most 120 characters, starting exactly `Claude keeps `, naming the concrete thing — the command, the file, the agent.
7. `alternative`: one imperative sentence of at most 200 characters addressed to Claude. It is sent to Claude verbatim, may be re-sent with every prompt for the rest of the session, and may be written into CLAUDE.md, so it must be safe to obey in situations you did not see: scope it ("run only the tests covering the files you changed, then the full suite once per phase"), never ban a capability outright ("never run the test suite"). If you cannot phrase the fix without forbidding something legitimate, drop the finding.
8. `why`: one or two sentences of evidence — how many times, what changed between occurrences, what the transcript shows — and the legitimate explanation you considered and what rules it out. Never a count or a cost these blocks do not contain.
9. At most six findings, at most three with `signature: null`, ordered by the sum of `chars` over the rows cited, largest first. Six is a ceiling, not a target; never split one behaviour into two findings.

## Counting — what makes two occurrences a repeat
- Separated by other work. Two occurrences of the same behaviour count as two decisions when at least one other row sits between them — an edit, a read, another command — whether in the same turn or a later one; a run after an edit is a second decision, not a second call in one batch — whether it is excused is the category's own question. Calls issued together with nothing between them are one batch and count once: a parallel set of Reads, or a fan-out of subagents launched at once, is one choice however wide. Breadth is one decision; weight is not: every stage of a workflow (each `label` in AGENTS) is a decision of its own, and the same role recurring stage after stage — a check loop per chunk, a review round after every fix — is a repeat.
- Both unexcused. An occurrence the "Never report" list excuses does not count and may not be cited. Subtract the excused ones first; if fewer than two remain, there is no finding. A baseline suite run at the start plus the check before a commit is zero findings.
- Same side of a compaction. TURNS lists the turns where a compaction happened; content dropped by it must be re-acquired. Count only occurrences after the last compaction.
- Same behaviour, not the same shape. For a signature finding that means the same `key`; two Read keys differing only in `:offset-limit` are different slices, not a repeat. For a null-signature finding you must name one behaviour and show it in each cited turn; do not staple unrelated expensive turns together.
- Agents are loops of their own. The `agent` column names the loop; a repeat inside one agent's rows counts exactly like a repeat in the main loop, and the main loop re-doing after an agent returns what that agent's rows show it already did (the same Read key, the same check) is a repeat across loops.
- Short ledgers. With fewer than about 12 rows or fewer than 4 turns, report only behaviours with three or more surviving occurrences, or one plus explicit stated intent.
- The legitimacy ladder. A sink needed once is nothing, however large. A sink repeated because its inputs changed between the runs — an edit, an install, a migration — is nothing. A sink repeated with nothing changed between, or work the transcript shows nobody asked for, is a finding, and the excuse you considered is written into `why`.

## Categories — the nine names are the whole enum; the cues are examples and `kind` is free text
- execution — the whole suite/build/typecheck after each edit; re-running a check with nothing edited since it last passed; the same failing command retried with no diagnostic step between; `sleep` polling or a watch/dev server run as a blocking call (`bg` absent, large `ms`). Not: a run after any intervening edit, install, migration or config change; the session's baseline run; broad verification after shared code changed; the last check before a commit; one retry of a transient failure. The error text is not in these blocks, so you cannot claim two failures were the same failure.
- reading — the same path read again with nothing having changed it; whole-file reads where a range would do (`trunc`); unfiltered log/diff/verbose dumps (large `chars`, `persist=`); a Bash read of a file that is then Read again; wide greps with no path scope and no edit after them. Not: a read after your own edit or after any command that could have rewritten the file; a read after a compaction; paging (a second read at a new offset, especially after `trunc`); the first look at an unfamiliar file or log; a row flagged `dedup` (core charged nothing).
- production — whole-file rewrites for small changes (`+a/-d` near the file's size); edits that cancel out; tests or docs nobody asked for; the same Edit failing on one path over and over. Not: a new file; a rewrite the user asked for; call-site updates the change requires.
- behavior — read/edit/read oscillation with nothing finished; approach flip-flops; repeating what the user already corrected. Not: read-edit-verify cycles that are the working method, or a step that depends on the previous result.
- communication — turns with `calls 0` and large `answerChars` that restate the plan or recap finished work; stopping to ask what the transcript, the repo or your instructions already answer; an `ask` row that held the turn for minutes while no agent ran (no rows between it and the next prompt) and whose options carried a recommended default (`recommended`) — proceed on the default and ask beside the work. Not: the turn that answers a question the user asked; a plan or explanation you were asked for; the session's last turn; plan mode, where making no tool call is required; a question whose answer the transcript shows changed the plan. `out` includes thinking, so point at the restated content, not the token shape.
- multi-agent — parallel agents each re-reading the same large file the parent already had; agents with a thin brief (small `promptChars`, large `tokens`); results never read; agents spawned again after a limit error; mechanical agents on the premium model (`agent=` flag shows the resolved model and `edits`); the main loop re-reading files or re-running checks an agent's rows already covered, after it returned; a brief that pastes in whole files (large `promptChars`) to an agent whose rows then Read the same paths anyway; a workflow whose later agents re-read what earlier agents read (the same Read keys under successive `agent` values, spread over turns); a loop whose rows are only checks that passed, with `edits 0` and a report as its outcome (AGENTS `checks` > 0) — a shell step given a model; review or verify loops with `edits 0` whose outcome carries no medium, high or critical finding, recurring stage after stage; two or more verifier loops per finding; a run whose tokens per edit are several times the others'; a fix loop followed by a review whose outcome carries a new high in the same stage, twice (regression chasing: stop the loop and re-plan). Not: agents with disjoint file sets each reading one shared spec; two agents touching one path unless the ledger shows a conflict (an errored edit right after another agent's edit, or a re-edit in the main loop after they returned); a re-read whose brief the transcript shows is a review or verification pass; every agent reading the one spec its brief names; the parent reading an agent's result; one review per stage that found a medium or higher; a loop that edited; a fan-out's breadth on its own.
- environment — installs repeated with no manifest edit; Bash used where Read/Grep/Edit is cheaper; fixed per-turn overhead (memory files, agent descriptions, MCP schemas in the facts line) larger than the work. Not: the user's own denials (`denied`); a single approval prompt.
- process — many tiny commits or amends on one change; work declared done with no check run; re-deriving after a compaction what was settled before it. Not: docs- or config-only changes with no check to run, or a check the environment cannot run.
- other — a repetition none of the above names. Name it plainly.

## Never report
- A first occurrence, or anything with fewer than two unexcused occurrences after the Counting rules.
- A single long call that was needed once, however long it ran: the largest row in TIME or CONTEXT is a fact to explain, never a finding on its own.
- Orientation: the first look at any file, directory or log, an unfamiliar area, or a scope the user left open ("audit every call site", "review the repo").
- Parallelism: calls issued together with nothing between them are one decision, and agents on disjoint scopes launched at once are one decision — one, not none: their weight is judged under multi-agent.
- Occurrences a compaction separates, and any re-read a compaction made necessary. Compaction, prompt-cache reads and the host's own truncation are the harness working as designed.
- A denied call (`denied`): the user or a policy said no, never your waste. The only reportable version is re-running an unchanged command already declined twice, and then the fix is a `settings-allow` proposal, not a rebuke.
- A file change you cannot see: the `paths` column records only Edit/Write and Bash calls the host diffed, and nothing for a staged edit. Treat an intervening formatter, codegen, migration, install, `git checkout|stash|pull|apply`, `sed -i`, MCP edit or another agent's edit as having changed the file.
- Volume alone. A large read is waste only when a cheaper call would have answered the same question for the same purpose; if the output was the deliverable (the diff under review, the log you were asked to explain, a file about to be rewritten) it is not a finding.
- Turns spent thinking on a genuinely hard decision.
- A cue whose evidence is not in these columns (an error message, a file's true size, worktree isolation): if you cannot see it, you cannot evidence it.
- The duration of a `recovered` row, or which agent ran it: neither was recorded, and its `err` may be a refusal the transcript stored as error text, so treat a `recovered` `err` row as `denied` and never as waste.
- Anything the user asked for this session, however wasteful it looks. Read the transcript before you accuse.

## Confidence
`confidence` runs 0.5 to 1.0. 0.9+: the same key three or more times with other work between each, nothing changed between, no request for it in the transcript. 0.7-0.9: the repetition is plain and the transcript offers no legitimate reason. 0.5-0.7: the repetition is real but a legitimate reason is plausible — report here only if you looked for that reason and `why` names what rules it out; if it could plausibly have been the right call, drop it. Below 0.5: say nothing.

`est_tokens_per_turn`: null whenever `signature` is an object. For a null signature it is an integer grounded in the `answerChars` of the cited turns divided by four, conservative end, or 0 when you cannot ground it; the user sees it multiplied into a savings figure every turn after a decision. For agent handles it is the tokens one avoided loop would have cost, grounded in AGENTS `tok`, conservative end.

`proposal`: null unless the fix should outlive the session. Otherwise `{"kind","title","body"}` where body is, per kind: `claude-md` one imperative rule line; `skill` the workflow as the body of a SKILL.md; `agent-brief` the brief, whose first line may be `model: haiku` or `model: sonnet`; `settings-allow` nothing but a permission rule such as `Bash(bun test:*)`.

## Contract — the shape of your reply, stated once (documentation, not a template to echo)
```json
{"focus": "<one line: what this session is doing>",
 "time": "<one sentence, at most 200 chars: where the wall-clock went>",
 "context": "<one sentence, at most 200 chars: where the context went>",
 "findings": [{"id": "<category>:<kebab-slug, at most 40 chars>",
   "category": "execution|reading|production|behavior|communication|multi-agent|environment|process|other",
   "kind": "<one sentence, at most 120 chars, starts 'Claude keeps '>",
   "evidence": ["<row id>", "turn:<n>"],
   "signature": {"tool": "<the row's tool cell>", "key": "<the row's key cell, verbatim>"},
   "why": "<one or two sentences>",
   "alternative": "<one imperative sentence, at most 200 chars>",
   "confidence": 0.85,
   "est_tokens_per_turn": null,
   "proposal": null}]}
```
`time` and `context` explain where each went, for the user to read and in the words of the work: "45 min per chunk: the full proxy suite runs after every fix round and each chunk gets two review rounds". Neither is an accusation and neither is a finding by itself, so write both even when `findings` is `[]` — the examples below leave them out where they are not the point, your reply never does.

`findings` may be `[]`. `signature` is that object or `null`. No other keys, and never null where a string is specified. Reply with one JSON object: first character `{`, last character `}`, no prose before or after, no code fence.

## Examples — evidence, then what it justifies
Rows `r41`, `r45`, `r50` carry `test:bun test` in turns 7, 8, 9 while only `/src/auth.ts` was edited between them, `r41` being the session's baseline run: `{"focus":"fixing the auth token refresh in /src/auth.ts","findings":[{"id":"execution:full-suite-after-each-edit","category":"execution","kind":"Claude keeps running the whole bun test suite after every single-file edit","evidence":["r45","r50"],"signature":{"tool":"Bash","key":"test:bun test"},"why":"r41 was the baseline and is excused; the suite then ran in full at turns 8 and 9 after single-file edits to /src/auth.ts alone, about a minute and 9.7k characters each. Nothing shared changed, and the user asked for a fix, not full verification.","alternative":"Run only the test files covering the files you changed, then the whole suite once when the phase is done.","confidence":0.92,"est_tokens_per_turn":null,"proposal":{"kind":"claude-md","title":"Targeted tests","body":"Run only the tests covering the files you changed; run the full suite at the end of a phase."}}]}`
Rows `r12` Read `/src/api.ts:-`, `r15` Edit `/src/api.ts`, `r16` Read `/src/api.ts:-` with `dedup`, all in turn 4: `{"focus":"a one-file change in /src/api.ts","findings":[]}` — the second read follows your own edit and the third was deduped, so no unexcused occurrence remains.
Rows `r08` `test:bun test` (turn 2, baseline), `r23` `test:bun test test/db.test.ts` (turn 6, after an edit), `r40` `test:bun test` (turn 11) followed by `r41` `git:git commit …`: `{"focus":"a db pool fix, verified narrowly then once before the commit","findings":[]}` — both full runs are excused, so nothing survives the Counting rules.
Rows `r61` and `r72` both `read:docker compose logs api --tail 2000` in turns 11 and 13, each ~40k `chars` with `persist=`: the same shape as the first example with `"id":"reading:unfiltered-log-dump"`, `"kind":"Claude keeps reading 2000 lines of api logs instead of grepping for the error"`, `"alternative":"Pipe log commands through grep -nE 'ERROR|Traceback' and tail -50 instead of reading the whole tail."`, `"confidence":0.85`, `"proposal":null`.
TURNS shows turns 14 and 15 with `calls 0` and `answerChars` 5400 and 6100 after a single edit at turn 13, neither answering a question: `"id":"communication:restates-plan-each-turn"`, `"evidence":["turn:14","turn:15"]`, `"signature":null`, `"est_tokens_per_turn":1200`, `"alternative":"State the result in one or two lines and take the next action; do not restate the plan or recap completed steps."`.
Rows `r80`-`r83` under `agent` `a1` Read four files, then `r84` Agent `agent:general-purpose` flagged `agent=general-purpose/opus/completed/41000tok/0edits/300pch` closes that loop (a spawn row lands after the rows it caused), then `r90`-`r93` in the main loop Read the same four keys in the next turn: `"id":"multi-agent:re-reads-what-the-agent-read"`, `"kind":"Claude keeps re-reading the files a subagent already read for it"`, `"evidence":["r80","r83","r90","r93"]` (a row from each loop is the repeat; the four main-loop reads together are one batch), `"signature":null` (no single key carries it), `"alternative":"Use the subagent's report; re-read a file it covered only to edit it."`, `"confidence":0.8`, `"est_tokens_per_turn"` grounded in the cited turns' `answerChars` or 0.
KNOWN PATTERNS lists `execution:full-suite-after-each-edit | … | steer @ 9` and rows `r70` (turn 12) and `r76` (turn 14) carry `test:bun test` again: return that same id with `"evidence":["r70","r76"]` and a `why` that names turns 12 and 14 as after the steer at turn 9.
Agent rows `r30`, `r58` and `r91` run about 40 minutes each, a review agent follows each, every loop reads a different module and no key repeats: `{"focus":"rewriting three modules, one agent each","time":"2h 40m in three module rewrites of about 40 minutes each, plus one review pass per module; nothing ran twice.","context":"1.1M chars, three quarters of it the agents' own reads of the modules they rewrote.","findings":[]}` — a long session is not a wasteful one.
Four suite runs with an install or a migration between every pair, and `agents | ×3 | Σ2100000ms | apart` above them in TIME: `{"focus":"a schema migration and the call sites it broke","time":"68m, most of it four suite runs, each after a migration or an install changed what the suite covers.","context":"620k chars, over half the migration diff and the failures it produced.","findings":[]}` — every repeat had changed inputs, so the ladder stops at nothing.
AGENTS lists `a3 | w3 | check:C3 | sonnet | 1 | 1.7m | 48k | edits 0 | checks 4 | reads 0 | report 1600ch | answer` and `a7 | w3 | check:C4 | …` alike, and no row of theirs carries `err`: `{"id":"multi-agent:check-loops-for-shell-steps","kind":"Claude keeps spawning an agent per chunk whose only job is to run four passing check commands","evidence":["agent:a3","agent:a7"],"signature":null,"alternative":"Run a stage's checks as a shell step of the workflow script or inside the reviewer; spawn an agent only for work that needs judgment.","confidence":0.85,"est_tokens_per_turn":48000}`
Three `review:*` loops of one run, each `edits 0` with outcome `3 low`, a fix loop after each: `{"id":"multi-agent:review-rounds-that-find-only-lows","kind":"Claude keeps running a full review round after every fix although the last two found only low findings","evidence":["agent:a9","agent:a12"],"signature":null,"alternative":"Route only medium-or-higher review findings to a fix round; end the stage when a review returns lows alone.","confidence":0.8}`

## KNOWN PATTERNS — `id | kind | decision @ turn | previous`. Reuse these ids; never mint a second id or signature for waste listed here.
{{KNOWN_PATTERNS}}

## DECISIONS — `id | key | keep|steer|kill @ turn`, then previous-session keeps. A `keep` key is off limits under any id this session.
{{DECISIONS}}

## STATS — the whole session, counted for you. Per call: `tool | key | cls | ×count | Σms | Σchars | turns first-last | edits-between | agents` (edits-between: median number of files edited between consecutive runs; 0 means it re-ran with nothing changed), then `waits:` — every AskUserQuestion this session, its total wait and how many carried a recommended default; not citable, but the time it held the session is a fact to explain. Then per class and per agent. No ids here; cite LEDGER rows.
{{STATS}}

## TIME — where the wall-clock went. `total`, then `label | ×count | Σms | share%` for the largest sinks, then the five longest rows as `r<seq> | tool | key | Σms`. An Agent row holds its own loop's rows, so it is listed apart and never added in; `ms` includes any wait on a permission prompt.
{{TIME}}

## CONTEXT — where the context went. The same shape measured in `chars`: the total, the largest sinks with their share, then the five largest rows. An Agent row is listed apart and never added in.
{{CONTEXT}}

## AGENTS — the loops this session spawned. First one line per run: `name | id | loops | Σmin | Σtok | edits | turn`. Then one line per loop, oldest first: `alias | run | label | model | turns | min | tok | edits | checks | reads | outcome | ended` — `alias` is the LEDGER's `agent` name for that loop, `label` the stage the workflow gave it (`impl:C3`, `check:C3`, `review:C6-r1`), `outcome` what it returned (`1 high 4 low`, `report 5900ch`), `ended` `answer`, `error`, `aborted`, `refusal` or `running`. `tok` counts new tokens (input, cache creation, output) in thousands. Loops older than the window fold into `~ run | ×loops | Σmin | Σtok` lines. Cite a loop as `agent:<alias>`; a line here is a loop's whole cost, so its weight against its `edits` and `outcome` is the proportion question's evidence.
{{AGENTS}}

## TURNS — `turn | in | out | cacheCreate | calls | ms | answerChars`, then `| aborted`, `| error` or `| refusal` when the turn ended that way and `| idle <m>m` when the next prompt came a minute or more later, then the facts line (context window, fixed per-turn overhead, turns where a compaction happened)
{{TURNS}}

## LEDGER — `id | tool | key | cls | agent | turn | ms | chars | flags | paths`, oldest first (a spawn row lands after the rows it caused: an agent's own calls finish before its Agent row does). Agents are named `a1`, `a2`… in order of first appearance; `main` is the main loop. `ms` is wall time and includes any wait on a permission prompt, so a long `ms` alone is not machine cost. A row flagged `recovered` was rebuilt from the transcript before this plugin joined the session: its `ms` is 0 and its agent reads `main`, so never reason about its duration or which loop ran it. flags: `err` `denied` `dedup` `trunc` `bg` `timeout` `persist=<bytes>` `ask` (an AskUserQuestion: its `ms` is the wait for the person) `recommended` (its options named a default) `+adds/-dels` `agent=<type>/<model>/<status>/<tokens>tok/<edits>edits/<promptChars>pch`, or `-`. Rows older than the window are folded into `~ | tool | key | ×count | Σchars` lines: no id, never citable, key usable as a signature only if it also appears in a full row.
{{LEDGER}}

{{LANGUAGE}}

Return the JSON object only.
```

`{{LANGUAGE}}` and the blank line under it are replaced together (section 12.3): English asks for nothing there and the prompt above is what it is handed, to the character.

---

## Appendix B — Waste taxonomy (research-derived; design-time input to the prompt's cues and guards)

Twenty-five behaviours from six research angles (Claude Code issues #90487, #82565, #83833, #94329, #24147, #93053, #89831, #91629; Anthropic best-practices and cost docs; Aider, Cline/Roo, Goose, Cognition writeups; SWE-agent/OpenHands trajectory papers arXiv 2405.15793, 2607.06184, 2608.05144, 2509.02360; NoLiMa 2502.05167). One line each: behaviour → ledger signals → fix. Legitimate variants are the "Never report" and "Not:" clauses in Appendix A.

- execution / full-suite-after-every-edit → same `test` key across turns with ≤3 edited paths between → run only covering tests; full suite once per phase.
- execution / recheck-with-nothing-changed → same lint/typecheck/format/build key with no `paths` between → re-run a check only after editing what it covers.
- execution / retry-storm-without-diagnosis → same key with `err` ≥3 times, no Read/Grep between, tiny `ms` → after two failures read the error and change approach.
- execution / foreground-wait-and-poll → `sleep`/watch keys, large `ms`, `bg` absent → start long work in the background and continue.
- reading / reread-known-state → same Read key, no `paths` on it between, no `dedup` → do not re-read unchanged files.
- reading / whole-file-over-read → Read with no offset, `trunc`, followed by Grep on the same path → Grep first, then Read a range.
- reading / unfiltered-output-dump → Bash `chars` > 8k, `persist=`, no grep/head/tail in the key → filter where the output is produced.
- reading / bash-read-then-read-double-pay → Bash `read` key with `persist=` then Read of the same path → Read for files, Bash for commands.
- reading / unbounded-search-sweep → ≥8 consecutive read/search rows without `paths` → one scoped Grep, then act.
- production / full-file-rewrite-and-churn → Write on a Read path, `+a/-d` ≈ file size, alternating edits → edit the smallest region.
- production / unrequested-scope-creep → `paths` outside the files the request named, new test/doc files → change only what the request needs.
- production / failed-edit-cascade → same Edit key with `err` repeatedly, Read with `dedup` between → re-read the exact lines with a range, then edit.
- behavior / phase-oscillation → read/edit alternation over ≥6 rows with no path finished → finish exploring, then commit to a plan.
- behavior / instruction-drift → a steered/killed key recurring after the decision → follow the instruction or say why it does not apply.
- communication / narration-and-restated-plans → `calls 0` turns with large `answerChars` → state the result in a line, then act.
- communication / unnecessary-confirmation → `calls 0` turns ending in a question already answerable → decide and act; ask once with a recommendation.
- multi-agent / premium-model-fan-out → ≥4 Agent rows in a turn, `agent=` resolved premium, `0edits` → haiku/sonnet for mechanical agents.
- multi-agent / fan-out-duplicate-reads → same Read key under ≥2 `agent` values in one turn → put shared material in the brief.
- multi-agent / unread-or-briefless-agents → `async_launched` agents never referenced, small `promptChars`, respawn after a limit error → spawn only what you will read; brief fully.
- multi-agent / agent-write-collision → same path in `paths` of two agents, errored edit after → disjoint file sets per agent.
- environment / approval-and-install-thrash → repeated `install` keys with no manifest in `paths`; `denied` repeats → install once; ask for an allow rule.
- environment / fixed-overhead-outweighs-work → facts line overhead > Σ output → trim CLAUDE.md, move workflow to skills, disable unused MCP.
- process / unverified-completion → edit turns with no test/typecheck/lint/build row and a completion claim → run the narrowest proving check.
- process / rework-after-compaction → keys repeating right after a compaction turn → read your notes first; keep a status file.
- other / novel-repeating-waste → any key repeating ≥3 times among the costliest with no `paths` between → name it and do the cheapest equivalent.

---

## Appendix C — UX walkthrough (the behaviour contract, with terminal mocks)

**These are mocks.** They show layout and copy in characters. The product is native: real buttons, a real text field, real layout and theme colours from the surface (section 5.5, first bullet). Nothing below is to be reproduced as text.

**1. Session start.** The plugin loads, registers `/saver`, loads this project's pattern registry, samples the context window. After the first turn one line sits above the prompt; `/saver` toggles the pane at any width.

```
ContextSaver ◌  312 calls watched · nothing wasteful yet                                          Open
> █
```

**2. Watching (silent).** Every tool call becomes a ledger row (with a short quote of its result); every turn end records tokens, calls, duration, answer length. Nothing is shown, nothing is sent to Claude.

**3. The judge runs** after ~30k new tokens and 3 turns, or on `/saver check` / `Check now`: one `$.model.fork` over the session's own transcript plus STATS, TURNS and LEDGER (Appendix A). New findings become wasters. The first time, in a wide fullscreen terminal, the pane docks itself beside the transcript (like `/diff` on the first edit); otherwise the band teases it: `ContextSaver ●  Found 2 ways to save ~12% of your context and 51m`. The ASCII below is a layout sketch, not the design: WP4 designs to the brief in section 5.5 (tones, grid, disclosure) and the result is reviewed live.

```
 CONTEXT   ██████████░░░░░░  64%   41k to compaction ≈ 6 turns
 JUDGE     2 runs · 7.4k tokens   SAVED  ~3% · 3 min                Check now

 ╭───────────────────────────────────────────────────────────────────────╮
 │ 1 ● Claude keeps running the whole bun test suite after every       i  │
 │     single-file edit                                                  │
 │     3× · ~9% of context · 3m 12s · turns 5–8                          │
 │     ✓ Fix   ✎ Fix…   – Ignore  → run only the tests covering the files │
 │                                  you changed; suite once per phase     │
 ╰───────────────────────────────────────────────────────────────────────╯

 ╭───────────────────────────────────────────────────────────────────────╮
 │ 2 ● Claude keeps reading 2000 lines of api logs instead of grepping i  │
 │     for the error                                                     │
 │     2× · ~20% of context · 8s · turns 11–13                           │
 │     ✓ Fix   ✎ Fix…   – Ignore  → grep -nE 'ERROR|Traceback' | tail -50 │
 ╰───────────────────────────────────────────────────────────────────────╯

 ─────────────────────────────────────────────────────────────────────────
 DECIDED   ✎ fixed with a note · re-reading src/auth.ts · saved ~1%
           ›  read src/auth.ts once and keep the summary
 RULES     Re-read only after edits · CLAUDE.md           Write  Try  Skip

 ctrl+x tab focuses this pane · Tab moves · Esc hands the keys back
```
Three tones only: default text for content, dim for everything secondary (a card's number among them), the theme accent for `●`, the gauge fill and the newest card's frame (a `Button` takes no colour, so the verbs are the surface's own tone, inverted under the focus or the pointer). Buttons are clicked, or reached with ctrl+x tab and pressed with Enter. Nothing blocks Claude, who keeps working.

**4. `i` opens the details in place**, one waster at a time; labels dim and lowercase in the gutter, then what the evidence adds up to and the calls behind the claim (the head of each result quoted behind `↳`). No `kill →` row: Kill sends the behaviour and the fix, and both are already on the card.

```
 1 ● Claude keeps running the whole bun test suite after every            i
     single-file edit
     why       ran in full 3× while only src/auth.ts changed between runs;
               the user asked for a fix, not full verification
     fix       run only the tests covering the files you changed; run the
               full suite once when the phase is done
     3 calls · 3m 12s · 72k chars of context
     turn 8   bun test         1m 2s · 24k ch
     ↳ "212 pass · 0 fail · ran 1284 expect() calls in 61.98s"
     turn 7   bun test   a1      59s · 24k ch
     ↳ "212 pass · 0 fail"
     turn 5   bun test        1m 11s · 24k ch
     ✓ Fix   ✎ Fix…   – Ignore
```

**5a. Ignore.** The waster moves to DECIDED as `– ignored`; silent for the session; recorded for the judge's calibration next session. Nothing is sent to Claude.

**5b. Fix… (a fix with a note).** A one-line field opens directly under the verbs — before any detail row, at both placements — pre-filled with the fix and with the cursor in it (the pane asks for the keyboard, then for the ring one render later; §6). One Enter sends the suggestion as the user's own instruction; rewriting it first is the normal case. Fix and Ignore stay one click away; `Fix…` again closes the field. `/saver fix [n] <text>` from the composer does the same — with the number the card wears, or without one for the card whose field is open, else card 1 — and takes a multi-line body for longer instructions. The typed text is kept in state and drawn back on every render, so the pane's constant redraws never wipe it; where the surface will not give the field the keys at all, the hint row's `/saver fix <n> <text>` is the way in.
```
 1 ● Claude keeps running the whole bun test suite after every          i
     single-file edit
     3× · ~9% of context · 3m 12s · turns 5–8
     ✓ Fix   ✎ Fix…   – Ignore
     ›  run the full test cycle only at the end of each phase; until then
        Enter sends · Fix… again closes · or /saver fix <n> <text>
```
Toast `ContextSaver: fixed with your note — …`; the waster moves to DECIDED as `✎ fixed with a note`. Claude receives, attached to its very next tool result (mid-turn, invisible to the user) and then with every later prompt:
```
Instruction from the user (via ContextSaver): run the full test cycle only at the end of each phase; until then run tests/auth.test.ts only
```

**5c. Fix (the fix as it stands).** No typing. Toast `ContextSaver: fixed — run only the tests covering…`; `✓ fixed` in DECIDED. Claude receives `killPrompt(p)` — the behaviour and the fix the card shows — wrapped in the same `Instruction from the user (via ContextSaver): …` prefix as a note of the user's own, so both channels read as the user's word.

**6. Savings.** When Claude next runs a narrower same-class command (`bun test tests/auth.test.ts`, 4 s, 900 chars) the difference to the median full run is credited: toast `+2m 58s · +~3% context saved`, SAVED and the band update. Two quiet turns credit the full baseline. Until one of those lands, the decided row states the rate rather than the credit — `~3% per repeat`, not `saved ~3%` — because SAVED never shows a figure that has not settled. If the behaviour recurs anyway, saved stays 0 and the waster returns to WASTERS marked `ignored 1×` so the user can Keep or say something else.

**7. Rules for next session.** `[Write]` appends the bullet under a `## ContextSaver` heading in the project's CLAUDE.md (or writes a skill, an agent brief, or a `permissions.allow` rule when the judge proposed one). `[Try once]` keeps the rule for this session only. `[Skip]` drops the proposal. Nothing is written without a click.

**8. Commands.** `/saver` toggles the pane; `/saver check` runs the judge now; `/saver fix [n] <text>` sends a fix with a note; `/saver fix <n>` sends the fix as it stands and `/saver ignore <n>` shrugs the card off, both by the number the pane draws beside it, and every reply names the card it took; `/saver debug` prints ledger, patterns, judge cost, savings; `/saver reset` and `/clear` drop session state (registry and last decisions persist per project).

**9. Narrow terminals.** Below 110 columns, or on the main screen, `/saver` seats a compact pane inline above the prompt: the CONTEXT row, the newest waster in full (its details compacted to `why`, `fix`, the summary row and one cited call), the others as one dim numbered row each, and a `DECIDED n · RULES n · /saver for the full pane` line.

**10. What never happens.** No tool is blocked or slowed; no text reaches Claude and no file is written without a click; the band yields to Claude Code's own surveys; a failing hook falls back to normal behaviour; headless runs record rows and show nothing.

---

## Appendix D — Theme and layout, as built (moved out of the README)

What WP4 confirmed at first render and how the pane spends its cells. The README keeps only the accent key.

The pane's one accent is the theme key `suggestion` (rgb(87,105,247), ansi blue) — the engine has no
`accent` key; `suggestion` carries the same value as `permission` and the engine's own
`rate_limit_fill`. It is used on the newest waster's card border, a live waster's `●`, the gauge's
filled cells and the band's mark and line while a card waits; `ButtonProps` (641-706) carries `dimColor` and `hover` and **no
`color`**, and one unknown prop blanks the whole pane, so the verbs, `Check now` and `Write` take their
tone from the surface — default at rest, inverted under the focus or the pointer. The accent marks the
block the eye must land on rather than the words inside it, and the spec says so (§5.5 item 1). The
d.ts enumerates no colour names at all (`TextProps.color` is "a theme key or a raw color", and the only
keys it ever names are `promptBorder`, `inactive` and `permission`), so there is no documented `warning`
or `error` key: the gauge's fill is the accent at every level rather than changing colour as the context
fills.

Every other waster's card is drawn with `borderDimColor`, which is the whole hierarchy of the list: the
eye lands on the accent frame first. The header, the empty state and the footer carry no rules or
frames — a blank row separates blocks, and the surface already frames the pane.

The header, the decided rows, the rules and the command hint are indented to the cards' content column
(`paddingX = 1 + 1 + CARD_PAD`), so every value in the pane — a header label, a card title, a decision, a
rule — starts at one x. The gauge is the spec's 16 cells and gives cells back only when the row cannot
hold them. Inside a card's details the cited calls are their own four columns, measured over the calls
that drawing shows: the turn and what ran padded to the widest, the wall time right-aligned, the size
last, so `· 24k ch` lands at one x on every row of the block. The glyph set is closed: `→` prefixes a card's fix row, `↳` prefixes the quote of what a cited call
returned, `✓` `✎` `–` are the three verbs and the three decided rows behind them, `◐` `●` `✓` `◌` are the
band's four states, and `›` is the user's own words — the Fix… field, and under a decided row the
sentence that field sent.

Inline, the drawing is budgeted against the seat the surface granted (`min(site.maxRows,
PANE_INLINE_ROWS)`), never against a constant: the header's rows, then the card's border, title, verbs
and open field, and what is left is the card's content — `why`, `fix` and the summary row at one row each and one cited
call with `i` open, else the stats and the fix — with the remainder folding the wasters behind it. The verbs and
the field are drawn above the content, so a seat smaller than the drawing costs detail, never a verb.

The pane's layout numbers (the 10-cell gutter, the number and glyph cells, the gauge's cells, the cells reserved for a
Button at a row's right edge, the rows each block spends, the glyph set, the copy strings) live at the
top of `hooks/ui.tsx` rather than in `hooks/core/types.ts`: they are private to this drawing and
`types.ts` is the shared contract, which carries no cells. Constants that more than one module reads —
the row and debug caps, the CLAUDE.md heading, the agent brief's default tools — do live in
`types.ts`.
