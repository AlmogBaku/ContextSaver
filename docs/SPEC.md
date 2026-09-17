# ContextSaver — v1 build spec

## Context

ContextSaver is a Claude Code function-hooks plugin ("Claude Mod") that watches a session for wasted context and time (the full test suite after every step, unfiltered log dumps, plan re-summaries, duplicated subagent work), shows a one-click card as soon as a waste behaviour repeats, lets the user tell Claude what to do instead, and on demand turns those decisions into CLAUDE.md rules, skills, briefs and permission rules. Product spec: `docs/PRD.md`. Open source, MIT.

Scope: PRD **v1 only**. v2/v3 items are not built (section 10).

Product decisions taken with the user on 2026-09-17 (they override the PRD's wording):
- **A waste pattern is a behaviour**: "Claude keeps running the full test suite after every step instead of at the end of the implementation."
- **Steer and Kill are prompts to Claude, not tool blocks.** Steer: the user writes the instruction ("do it by the end of each phase"). Kill: the plugin writes it from the pattern — "stop this behaviour; from now on <fix>". Both stay in force for the session. Nothing is ever denied at `tool.check`.
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
6. **A wrong card costs more than a missed one.** The judge prefers silence; the user's Keep is final for the session; instructions are scoped, never blanket bans.
7. **One designed pane, native to Claude Code, hyper-focused.** The ContextSaver pane (docked beside the transcript in fullscreen, inline above the prompt otherwise, exactly like the built-in `/diff` pane) is the product surface: a two-row header, the live wasters as clean blocks with three verbs each, details behind `i`, decisions and rules as single lines. One accent colour for what you can act on, dim for everything else, no inner chrome. The band is one summary line with `Open`. Toasts only after a click.

---

## 2. Design decisions

**D0. Code gathers evidence; the model decides.** The ledger records every tool call (tool, normalized key, class, agent, turn, duration, in-context size, flags, edit size, edited paths, subagent metadata) and every main-loop turn (tokens, calls, duration, answer length). Code also pre-computes the deterministic facts the judge would otherwise have to count: per `(tool, key)` aggregates over the whole session (count, total time, total chars, turns spanned, median files edited between consecutive runs), per-class and per-agent totals, the costliest single calls. The judge is asked a constrained question (Appendix A): here are the stats, the recent rows, the nine categories, the patterns already known and the user's decisions; name the behaviours that repeated, cite row ids, copy signatures from these keys, propose the fix, return this JSON. No code-side detectors, so no heuristics or guards to maintain. A card appears at the next judge run; `/saver check` runs it on demand.

**D1. The card is non-blocking; nothing waits on a human.** Hooks have a budget of about ten seconds (9759-9761; overrun = skipped, fail-open, 2842-2844). When the judge reports a behaviour the card appears in the band; the user clicks whenever. No hook waits for a press; `tool.check` is not hooked. A single occurrence is never a finding (Appendix A, rule 1), so first occurrences are never interrupted.

**D2. Keep / Steer / Kill are decisions about what to tell Claude.** *Keep* → nothing is sent; the pattern is silent for the session and recorded as a previous-session keep for the judge's calibration afterwards. *Steer* → the user writes the instruction in a text field that opens inside the waster's card (`Input`, pre-filled with the fix, `autoFocus`, Enter sends; 3745-3787), and `/saver steer <text>` does the same from the composer for keyboard-only use. *Kill* → the plugin writes `killPrompt(p)` = "Stop this behaviour for the rest of the session: <kind>. From now on: <alternative>." Both texts are delivered once immediately (`notes`) and with every later prompt (`standing`). Every pattern therefore carries a `kind` phrased as the behaviour ("Claude keeps running `bun test` after every step") and an `alternative` phrased as a scoped fix ("run the full test cycle only when a phase of work is complete; until then run only the tests covering the files you changed").

**D3. Instructions ride the `context` channel, never `prompt.section`.** `ToolCallResult.context` (7966-7974, cap 32,000 chars, `readonly string[]`) is read by the model right after that tool result; `PromptSubmitInput.context` (5711-5719) is read with the next prompt, exactly as the `diff` mod rides its "ask". `notes` drain into whichever comes first; `standing` texts are appended to every prompt's context. `prompt.section` is not used (invalidating it spends the prompt cache the judge's fork needs, 2999-3010).

**D4. Ignored instructions come back to the user.** If a steered or killed behaviour recurs (a signature key seen again, or the judge re-reports the id with evidence after the decision), the instruction counts as ignored (PRD: saved = 0, "steer ignored"), and the card returns once so the user can Keep or send a different instruction. If it does not recur for two turns, the baseline is credited as saved.

**D5. The judge is `$.model.fork` from `turn.complete`, detached.** `fork({ prompt })` is the only field (4146-4157); it runs over the session's own transcript with the shared prompt cache and returns `{ text, usage } | null` (null on cold snapshot or API error) or rejects if another plugin denies it. **It runs on the session's own model** (2019-2034); there is no override. `$.model.complete({ model: 'haiku', … })` (4122-4144) sees no transcript so it cannot judge intent; not used in v1. Since the model is fixed, the prompt is the whole detector (Appendix A). Never awaited inside a hook: `void runJudge()` gated by cadence or `/saver check`.

**D6. Signatures are `(tool, key)` copied from the ledger.** One normalizer computes `key` from the tool's arguments only (reserved `tool`, `tool_use_id`, `agentId`, `consent` stripped; `tool.call` spreads args flat on `e`, 7892-7910). The judge copies `(tool, key)` from one ledger row; `parseReply` validates the pair. Rows are shown with short aliases `r<seq>`; `parseReply` maps them back. Costs are computed by us from evidence rows, never trusted from the model.

**D7. Dedupe by id reuse.** The judge prompt carries known pattern ids and must reuse one for the same waste; a keep silences the behaviour under any id. `$.model.classify` is not used.

**D8. Measure, don't read.** `ms` around `await next(e)` via `$.clock.now()` (BUILD-NOTES line 37: time inside `next()` is excluded from the hook budget; re-verified in section 8); `chars = result.text?.length ?? 0` (in-context cost; a persisted Bash output counts only its preview and is flagged `persist=N`). `pct = chars / 4 / window × 100`. The card leads with time when pct rounds to 0.

**D9. Own calls are filtered.** Rows are skipped when `next.origin.plugin === PLUGIN_NAME`.

**D10. The pane is the surface; the band is the doorbell.** `$.ui.open({ id })` opens one framed region whose body is drawn by the `ui.render` hook for `{ component: 'Pane', requestId }` (1939-1955, 5929-5936); the surface docks it beside the transcript in fullscreen from 110 columns, else seats it inline above the prompt (`e.props.placement`, 6588-6635); it redraws on `$.ui.invalidate('ui.render')` and takes the terminal element table: `Box` (flex layout, borders, `key` + `hover` restyling with no round trip, 518-571), `Text` (colour, dim, bold, wrap, 7814-7836), `Button` (click, or Tab and Enter; digit hotkeys are band-only, 651-659), `Input` (a text field with `onSubmit`, 3745-3787). All four exist on Desktop too, so the pane draws there unchanged; `Raster`/`Client`/`Code` are not needed for v1. `/saver` toggles it and is placed at any width because it answers the person; a fresh card auto-opens it once per session when the terminal is wide (unasked opens wait undrawn below 144 columns, 1943-1945, so the attempt is harmless), like `/diff` opening on the first edit. The AbovePrompt band shows one line — context used, tokens to compaction, new wasters, savings — and an `Open`/`Close` button. Everything the user can do lives in the pane.

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
  hooks/core/evidence.ts             rowsOf(), costOf(), baseline()                          (done; shared by WP2 and WP5)
  hooks/core/patterns.ts             reduce, cardOf, paneModel, bandModel, registry (de)serialisation, debugDump   (WP2)
  hooks/core/blocks.ts               aggregate(), ledgerLine(), summaryLine(), statsLines(), the four prompt blocks   (WP3)
  hooks/core/judge.ts                shouldRun(), buildPrompt(), parseReply(), merge(); JUDGE_PROMPT (Appendix A, verbatim)   (WP3)
  hooks/core/rules.ts                propose(), templates, mergeSettings()
  hooks/ui.tsx                       Band(), RulesPane()
  tests/{ledger,patterns,judge,rules}.test.ts  tests/ui.test.tsx  tests/register.test.ts  tests/fixtures/*
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
  written: string[]                // `${patternId}:${kind}` of artifacts written or tried this session; propose() omits them
  judge: { lastAtTokens: number; lastAtTurn: number; running: boolean; spent: number; backoff: number; error: string | null; focus: string | null }
  paneOpen: boolean
  autoOpened: boolean              // the pane auto-opened once this session (like /diff on the first edit)
  columns: number | null           // last band width seen (e.props.bodyColumns), for the auto-open decision
  saved: { ms: number; chars: number }
}

export const initialState = (cwd: string, window: number): State => ({
  cwd, turn: 0, seq: 0, rows: [], turns: [], usage: { window }, usageSamples: [], overhead: null, compactions: [], patterns: [], cards: [], expanded: null, steering: null, steerDraft: null, notes: [], standing: [],
  judge: { lastAtTokens: 0, lastAtTurn: 0, running: false, spent: 0, backoff: 1, error: null, focus: null }, paneOpen: false, autoOpened: false, columns: null, saved: { ms: 0, chars: 0 },
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
  | { type: 'artifact.done'; patternId: string; kind: ArtifactKind; written: boolean }   // written: true after Write/Try once (recorded in state.written); false after Skip
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
export type BandProps = { ui: Ui; state: State; site: Site; actions: Actions }
export type PaneProps = { ui: Ui; state: State; artifacts: Artifact[]; site: Site; placement: 'dock' | 'inline'; actions: Actions }
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
export const sparkline = (values: number[], width: number): string => ...     // '▁▂▃▄▅▆▇█' over the last `width` values scaled 0..100
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
- Rendering rows for the judge (`ledgerLine`, `summaryLine`, `aggregate`, `statsLines`) is the judge's input format and lives in `blocks.ts` (section 5.3), not here.

### 5.2 `hooks/core/patterns.ts` (WP2)
- No detectors live here (D0). This module keeps the evidence, applies decisions, accounts savings, and computes the UI's view models.
- `rowsOf`, `costOf`, `baseline` are in `hooks/core/evidence.ts` (already written and tested; import them).
- `paneModel(state, artifacts): PaneModel` and `bandModel(state): BandModel` (types in §4) — the only things `ui.tsx` renders. `header.spark` = `usageSamples.map(s => s.percent)`; `header.judgeTokens = judge.spent` (what the pane shows) and `header.judgeShare = round(judge.spent / max(1, totalTokens) × 1000) / 10` (kept for `/saver debug`); `wasters = cards.map(id => cardOf(pattern, state))`; `decided` = patterns with a decision, newest `decidedAtTurn` first, `savedPct` = `pctOf(baseline.chars, window)` for steer/kill else null; `fresh` = `cards.length`.
- `cardOf(p, state): Card` — `kind = p.kind` (prefixed `ignored · ` when `p.ignored > 0`); `stats = \`${hits}× · ~${pct(Σchars)}% context · ${duration(Σms)} · turns ${first}…${last}\`` (omit a pct segment that rounds to 0); `why = p.why`; `fix = p.alternative`; `killText = killPrompt(p)`; `evidence` = up to 3 quotes from the cited handles, most recent first: a row → `r${seq} · turn ${turn} · ${tool} ${key without class prefix, ≤ 40} · ${duration(ms)} · ${chars}ch · "${head}"`; a turn handle → `turn ${n} · no tool calls · ${answerChars}ch · "${answerHead}"`.
- `reduce(state, action): State` — one case per action:
  - `turn.start` → `turn += 1`.
  - `row` → `seq += 1`, append with that seq (drop oldest past `ROW_CAP`); for every pattern whose `signature` equals `(row.tool,row.key)` push `row.id` to `hits`; **settle instructions** (main-loop rows only, and only rows with `row.turn > openedAtTurn`, since a row in the decision's own turn was already in flight before Claude could read the instruction): for each pattern with `openedAtTurn !== null` and `decision ∈ {steer, kill}`: a row with `row.key === p.signature?.key` → ignored (`ignored += 1`, `openedAtTurn = null`, re-queue the card, every time, so the user can respond again); else a row with `row.cls === cls(p)` and a different key → the alternative: `saved += max(0, baseline − rowCost)`, `openedAtTurn = null`.
  - `turn.complete` → push `{ ...stat, turn, calls: rows recorded this turn }`; for each pattern with `openedAtTurn !== null && turn − openedAtTurn ≥ SETTLE_TURNS` → `saved += baseline`, `openedAtTurn = null`; behavioural patterns with `decision ∈ {steer, kill}` accrue `saved.chars += (estTokensPerTurn ?? 0) × 4`.
  - `usage` → merge (`window`/`compactAt` sticky; `tokens`/`percent` replaced; push `{ turn, percent }` when `percent` is defined, replacing a sample of the same turn; keep the last 30). `overhead` → set. `compact` → `compactions.push(turn)`.
  - `expand` → `expanded = patternId === expanded ? null : patternId`.
  - `steer.begin` → `steering = steering === patternId ? null : patternId`, `steerDraft = null` (toggles the field; opening it starts from the pattern's `alternative`). `steer.draft` → `steerDraft = text`.
  - `decide` → set `decision`, `decidedAtTurn = turn`, `lastDecision = choice`; remove from `cards`; `steering = null`, `steerDraft = null`; `expanded = null` when it was this pattern; `keep` → nothing else; `steer` (text required, else no-op) → `instruction = text`, `notes.push(instructionOf(text))`, `standing.push(instructionOf(text))` (deduped), `openedAtTurn = turn`; `kill` → same with `killPrompt(p)`.
  - `judge.start` → `running = true`. `judge.done` → `running = false`, `runs += 1`; `patterns` replaced wholesale; `lastAtTokens = totalTokens(state)`, `lastAtTurn = turn`, `spent += spent`, `error`, `focus`; `backoff = spent > JUDGE_BUDGET_SHARE × totalTokens ? min(backoff × 2, JUDGE_MAX_BACKOFF) : backoff`; queue a card for every id in `fresh` (new findings, `decision === null`, not already queued); for every id in `recurred` (a steered/killed pattern re-reported with evidence after `decidedAtTurn`) → `ignored += 1`, `openedAtTurn = null`, re-queue the card once.
  - `notes.drained` → `notes = []`. `standing.add` → push (deduped). `artifact.done` → `proposal = null`, and when `written` push `${patternId}:${kind}` to `state.written`. `pane` → `paneOpen = open`, and `autoOpened = true` when `auto`. `columns` → set.
  - `reset` → `initialState(cwd, usage.window)` keeping `overhead`, `columns`, `paneOpen` and `patterns` as `{ ...stored, hits: [], decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0 }` (`lastDecision` persists).
- `totalTokens(state) = Σ turns (input + output + cacheCreate)` (new tokens; cache reads excluded on both sides of the judge budget).
- `tokensToCompaction(state): number | null` — `(usage.compactAt ?? round(window × 0.9)) − usage.tokens`; null when `tokens` is unknown. Exact, from the usage API; no time extrapolation (minutes would depend on how fast the user works, so they are not shown).
- `turnsToCompaction(state): number | null` — `tokensToCompaction / median(new tokens per turn over the last 5 turns)` where new tokens per turn = `input + output + cacheCreate` of each `TurnStat`; null with fewer than 3 turns or a zero median. Shown as `≈ 6 turns`.
- `parseRegistry(value: unknown): StoredPattern[]` (validate every field; drop junk), `toStored(p)`, `fromStored(s)`, `mergeStored(a, b)` (by id, `b` wins; capped at `MAX_PATTERNS`, dropping entries with `lastDecision === null` and the lowest confidence first, so the per-project store cannot grow without bound).
- `debugDump(state): string` — ≤ 40 lines: rows by cls, patterns (`id hits decision ignored`), cards, notes/standing counts, judge stats incl. `focus`, usage, saved.
- Tests: rows grow hits of a matching known pattern; steer requires text and queues note + standing; kill queues `killPrompt`; recurrence → ignored and the card returns once (both via row and via `judge.done recurred`); a narrower same-class row credits `baseline − cost` once; two quiet turns credit baseline; behavioural accrual; cards FIFO without duplicates; `judge.done` never drops a decided pattern; `reset` keeps stored fields incl. `lastDecision`; `parseRegistry` drops junk; medians.

### 5.3 `hooks/core/judge.ts` (WP3)
- `hooks/core/blocks.ts` (owned by this package) renders the judge's input: `ledgerLine(row): string` — `r${seq} | tool | key | cls | agent | turn | ms | chars | flags | paths` exactly as Appendix A documents (`flags` space-joined or `-`; `lines` rendered inside flags as `+a/-d`; at most 3 paths; `spawn` rendered inside flags as `agent=${type}/${resolved ?? requested ?? '?'}/${status ?? '?'}/${tokens ?? '?'}tok/${edits ?? '?'}edits`); `summaryLine(tool, key, count, chars): string` — `~ | tool | key | ×count | Σchars`; `aggregate(rows): KeyStat[]` — one entry per `(tool, key)` over the whole session, `{ tool, key, cls, count, ms, chars, firstTurn, lastTurn, agents, editsBetween: number | null }` (`editsBetween` = median count of distinct `paths` edited by rows between consecutive occurrences; null when count < 2), sorted by `chars` desc (export `KeyStat` from blocks.ts); `statsLines(rows): string[]` — the top 20 `KeyStat`s by chars plus every one with `count ≥ 3` as `tool | key | cls | ×count | Σms | Σchars | turns first-last | edits-between | agents`, then per class `cls | ×count | Σms | Σchars`, then per agent `agent | ×count | Σchars`, then the 5 costliest single rows `r<seq> | tool | key | chars`; and `knownPatternsBlock(state)`, `decisionsBlock(state)`, `turnsBlock(state)`, `ledgerBlock(state)` as described under `buildPrompt`.
- `JUDGE_PROMPT` — the text of Appendix A, verbatim, as a template with `{{KNOWN_PATTERNS}}`, `{{DECISIONS}}`, `{{STATS}}`, `{{TURNS}}`, `{{LEDGER}}`.
- `shouldRun(state): boolean` — `!running && totalTokens − lastAtTokens ≥ JUDGE_MIN_NEW_TOKENS × backoff && turn − lastAtTurn ≥ JUDGE_MIN_TURNS && rows.length ≥ JUDGE_MIN_ROWS`.
- `costOf(u: ModelForkUsage) = input_tokens + output_tokens + cache_creation_input_tokens`.
- `buildPrompt(state): string` — deterministic substitution of the four blocks:
  - KNOWN PATTERNS: one line per pattern `id | kind | <decision or -> @ <decidedAtTurn or ->` plus `| previous: <lastDecision>` when set and no session decision; `(none)` when empty.
  - DECISIONS: one line per pattern with a session decision `id | <key or -> | <choice> @ <turn>`; then previous-session keeps `id | <key or -> | kept in a previous session`; `(none)` when empty.
  - STATS: `statsLines(state.rows)` (section 5.1) — whole-session aggregates so the judge reads "×847 · 41m · 2.1M chars · edits-between 3" instead of counting rows.
  - TURNS: one line per `TurnStat` `turn | in | out | cacheCreate | calls | ms | answerChars` (aborted turns suffixed `aborted`); then the facts line `window=<n> overhead: memory=<n> mcp=<n> agents=<n> compactions at turns: <list or none>`.
  - LEDGER: newest `JUDGE_LEDGER_ROWS` rows as `ledgerLine`s in ascending order, preceded by `summaryLine`s for older rows grouped by `(tool, key)`.
- `parseReply(text, state): { findings: Finding[]; focus: string | null }` — slice first `{` to last `}`; `JSON.parse` in try/catch; validate field by field; never throws (returns `{ findings: [], focus: null }`). Per finding: `id` matches `/^[a-z-]+:[a-z0-9-]{1,40}$/` and its category prefix equals `category` (one of the nine); `kind` ≤ `KIND_MAX` and starts with `Claude keeps `; `alternative` ≤ `ALTERNATIVE_MAX`; `evidence` handles are `r<seq>` aliases of rows present in `state.rows` (mapped to `tool_use_id`) or `turn:<n>` with `n` in `state.turns` (only when `signature === null`); ≥ 2 handles unless `why` contains the word "intent"; `signature` is null or a `(tool, key)` pair matching one row; `confidence` in [0.5, 1]; `estTokensPerTurn` coerced to null when a signature exists, else clamped to the median `answerChars / 4` of the cited turns; `proposal` null or `{ kind ∈ ArtifactKind, title non-empty, body non-empty }`, and for `settings-allow` the body must match `/^[A-Za-z][A-Za-z0-9_]*\(.+\)$/`; a finding whose `(tool,key)` belongs to a pattern with a session `keep` is dropped. Keep the first `MAX_FINDINGS`, at most `MAX_BEHAVIORAL_FINDINGS` with `signature: null`.
- `merge(state, findings): { patterns: Pattern[]; fresh: string[]; recurred: string[] }` — returns the **complete** registry: existing patterns carried through with session fields intact; an existing id updated in `why/alternative/proposal/confidence/estTokensPerTurn`, its `hits` extended with the cited handles; it is `recurred` when it has a steer/kill decision and any cited row's turn > `decidedAtTurn`; a new id becomes a `Pattern` with `hits` = the cited handles only (no back-fill) and is `fresh`; capped at `MAX_PATTERNS` (drop lowest-confidence undecided patterns first).
- Tests: cadence gates incl. backoff; `buildPrompt` contains the contract block, the five block headers, STATS lines with counts, ledger aliases, summary lines, the keep line in DECISIONS; parser on valid / prose-wrapped / broken JSON, an unknown alias, a completed (untruncated) key, a `(tool,key)` mismatch, an over-large `estTokensPerTurn`, a prose `settings-allow` body, a kept key under a new id; merge reuse vs new, `recurred`, cap, decisions preserved.

### 5.4 `hooks/core/rules.ts` (WP5)
- `propose(state): Artifact[]` — the pane reads as "make what you decided permanent": a steered pattern with `proposal === null` → the user's `instruction` as a `claude-md` line; a killed pattern with `proposal === null` → its `alternative` (the scoped fix; never the session-scoped kill prompt) as a `claude-md` line; a steered or killed pattern with a judge `proposal` → that proposal. Kept and undecided patterns propose nothing (Keep silences the pattern entirely). Artifacts already written this session (`state.written` holds `${patternId}:${kind}`) are omitted. Sorted by `savingPct` desc; `savingPct = pctOf(baseline.chars × 3, window)`.
- `render(kind, p, cwd): Pick<Artifact, 'path' | 'content' | 'mode'>`: `claude-md` → `${cwd}/CLAUDE.md`, mode `append`, `\n## ContextSaver\n- ${body}\n` (the shell appends only the bullet when the heading exists); `skill` → `${cwd}/.claude/skills/${slug(title)}/SKILL.md`, mode `write`, frontmatter `name`, `description`, body; `agent-brief` → `${cwd}/.claude/agents/${slug(title)}.md`, mode `write`, frontmatter `name`, `description`, `model` (from the body's first `model:` line, else omitted), `tools`; `settings-allow` → `${cwd}/.claude/settings.json`, mode `merge-settings`, `content` = the rule string.
- `mergeSettings(existing: string | null, rule: string): string` — parse (or `{}`), `permissions.allow` += rule if absent, 2-space JSON. Idempotent.
- Tests: each kind → path/content/mode; settings merge idempotent and preserves unrelated keys; propose gating and ordering.

### 5.5 `hooks/ui.tsx` (WP4)
- Keys (explicit and unique; Button `key` defaults to the label and collides, 641-646): `toggle`, `check`, `card:${id}:keep|steer|kill|info`, `card:${id}:text` (the Steer `Input`), `write:${id}`, `try:${id}`, `skip:${id}`.
- **THE MOCKS ARE MOCKS. The product is native UI.** Every ASCII drawing in this document is a layout sketch made of characters because a document cannot hold a live pane. The built pane uses the surface's real elements: `Button`s the user clicks, tabs to and presses (the surface draws and inverts them; no brackets or glyphs typed to look like a button), a real `Input` with the surface's own cursor, selection and focus ring (no `█` typed as a cursor), `Box` layout that reflows to the pane's width and placement, theme colours resolved by the surface, hover and focus handled by the surface. Only data glyphs (`●`, the gauge, the sparkline, `›`, `↪`, `✓`, `✕`, `─`) are literal text. If something in a mock looks like a control, WP4 builds the control.
- **Design brief — "hyper focus", macOS restraint, translated to a monospace grid.** WP4 designs to this brief and the result is reviewed live (section 8, step 1). What makes macOS feel calm is not decoration but four disciplines, each of which has a terminal equivalent:
  1. *Tone before colour.* macOS uses label / secondaryLabel / accentColor. Here: default foreground for content, `dimColor` for everything secondary (labels, meta, hints, rules), and one accent (the theme's accent key, confirmed at first render) reserved for what the user can act on or must notice: the `●` of a live waster, the gauge's filled cells, the verbs. Nothing else is coloured. Bold is used once per block, on the waster title. Italic never; inverse only where the surface applies it (focus, pointer).
  2. *A grid, not boxes.* No borders inside the pane (the surface already frames it). Two columns: a 10-cell dim label gutter and the content column, so every value in the pane starts at the same x, like System Settings. Blocks are separated by one blank row; sections by a dim hairline `─`. Actions sit at the right edge (`justifyContent="space-between"`), verbs at the left of their row separated by four spaces: `Keep    Steer    Kill`.
  3. *Hierarchy by weight and order, disclosure by intent.* The eye must land on the first waster's title. The header is two rows; the wasters are newest first, the newest in full; decided items and rules are single lines. Details live behind `i` and open in place, one at a time; the Steer field opens in place and nothing else moves. Section headings carry no counts.
  4. *Quiet motion and honest states.* State is expressed by tone, not spinners: `Check now` dims to `checking…`; a killed pattern that came back reads `ignored 1×`. Empty states are one dim sentence (`Nothing repeating yet.`). Toasts appear only after a click and never stack. Hover uses the surface's own inversion; no custom hover styling in v1.
  Copy: sentence case, verbs as buttons, no exclamation marks, no emoji; numbers short and rounded (`3×`, `~9%`, `3m 12s`, `9.9k`, `t8`), units abbreviated. Glyph set is closed: `●` `↪` `✓` `✕` `→` `›` `─` `▁▂▃▄▅▆▇█` `░` `…`. Titles wrap to at most 2 rows; every other row truncates with `…` (`wrap="truncate-end"`). Design at three widths (dock 56, dock 80, inline full width) and keep every row within `site.bodyColumns`.
  Design QA (Fable, before WP4 is accepted): at each width count tones (≤ 3), bolds per block (1), colours outside the accent (0), rows over width (0), orphan glyphs (0); check the gutter aligns, the newest waster is the first thing the eye lands on, and the empty pane is calm. Iterate until it passes.
- `ui.tsx` renders view models only (`BandModel`, `PaneModel`, section 4), computed by `patterns.ts`; it never reads `State`. Wherever this section says `state.x`, read `model.x`.
- `Band({ ui, model, site, actions })` — exactly one row, a `Text` with `wrap="truncate-end"` in a `Box width={site.bodyColumns}`: `ContextSaver  ${percent}% · ${tokensToCompaction}k to compaction · ${fresh} new · saved ~${savedPct}%` (zero or null segments omitted) + plain Button `Open` (`Close` when `paneOpen`, key `toggle`) right-aligned (`justifyContent="space-between"`). The row is `BAND_RESERVE` cells narrower than `site.bodyColumns`: the engine draws its own collapse control `[-]` over the last cells of the band, and a Button under it is clipped. No cards, no hotkeys in the band.
- `Pane({ ui, model, site, placement, actions })` — the product surface. Sections, in order, each a `Box flexDirection="column"` with `paddingX={1}`:
  1. **Header** (2 rows, dim labels in the gutter): `CONTEXT   ${gauge(percent, 16)}  ${percent}%   ${sparkline(usageSamples.map(s => s.percent), 10)}   ${tokensToCompaction}k to compaction ≈ ${turnsToCompaction} turns` (segments omitted when null) and `JUDGE     ${runs} runs · ${kilo(judgeTokens)} tokens   SAVED  ~${pct}% · ${duration}` with a plain Button `Check now` (key `check`; label `checking…` dim while `judge.running`) right-aligned. Then a dim `─` rule. Every header row is assembled and measured against `site.bodyColumns` before it is drawn, the Button's cells reserved first, and segments are dropped whole while it does not fit — sparkline, then `≈ N turns`, then half the gauge, then the compaction figure — because a cut number lies (a `914k to compaction` cut to `914` reads as a different session). The judge's share of the session is a developer metric that misleads early on, so the row shows tokens; the share stays in `/saver debug`. With `percent` null (before the first turn is measured) the CONTEXT row reads dim `awaiting the first turn` after its label rather than an empty gauge.
  2. **Wasters** — no section heading; one block per undecided pattern, newest first, separated by a blank row. Title row: accent `●` + bold `${kind}` (wraps, ≤ 2 rows) + plain Button `i` (key `card:${id}:info`, dim) right-aligned via `justifyContent="space-between"`; the title wraps inside the width left once the `i` and the gap before it are reserved, so the `i` always sits at the right end of the first title row. Stats row (dim): `${stats}`. Action row: plain Buttons `Keep`, `Steer`, `Kill` (keys `card:${id}:keep|steer|kill`) then dim `→ ${fix}` wrapped to the remaining width (≤ 2 rows). Expanded (`state.expanded === id`, one at a time) the stats row is replaced by four labelled rows with dim lowercase labels in the 10-cell column: `why` → `${why}` (≤ 2 rows); `fix` → `${fix}` (≤ 2 rows); `kill →` → `"${killText}"` (≤ 2 rows, truncated); `evidence` → one row per quote `r50 · t8 · bun test · 60s · 9.9k · ${head}` (≤ 3). Steering (`state.steering === id`): the verbs row stays (Keep and Kill remain one click away) and two rows appear beneath it: the field row (`›` in the gutter + `Input`, key `card:${id}:text`, `value = state.steerDraft ?? fix`, `submitLabel = 'send'`, `autoFocus`, `onInput = (t) => actions.steerDraft(t)`, `onSubmit = (t) => actions.steerSubmit(id, t)`), then dim `Enter sends · Steer again closes · multi-line: /saver steer in the prompt`. `Input` is the surface's one-line field (3735-3787), so a steer is one sentence; a longer instruction goes through `/saver steer <text>` in the composer, which is multi-line. The draft lives in state because the pane redraws on every ledger row Claude produces while the user types; rendering it back as `value` means a redraw never wipes the text (whether the surface keeps the cursor position across that redraw is probed in section 8). `Input` has no cancel callback and Esc only returns the keyboard to the prompt, so closing is the `Steer` button again. Empty state, dim: `Nothing repeating yet.` with `Check now` beneath.
  3. **Footer** — a dim `─` rule, then two label rows: `DECIDED   ${glyph} ${kind, truncated} · saved ~${pct}% | ignored ${n}×` (one row per decided pattern, newest first, `✓` kept / `↪` steered / `✕` killed; the row is omitted when there are none) and `RULES     ${title} · ${kindLabel}` + plain Buttons `Write`, `Try`, `Skip` right-aligned (one row per artifact; `Try` only for `claude-md`, `skill`, `agent-brief`; omitted when none).
  - `placement === 'inline'` → the same design with the header's first row only, the newest waster in full, further wasters as one dim row each (`● ${kind, truncated} · ${hits}×`), and the footer collapsed to `DECIDED ${n} · RULES ${n} · /saver for the full pane`; fits `PANE_INLINE_ROWS`. `placement === 'dock'` → everything; the engine scrolls a taller tree (6588-6635).
  - Every one-line row is a `Text` with `wrap="truncate-end"`; widths from `site.bodyColumns`.
- Only `Box`, `Text`, `Button`, `Input` with allow-listed props (518-571, 641-706, 3745-3787, 7814-7836); one unknown prop invalidates the whole tree and the pane draws empty. Colour keys are strings the d.ts does not enumerate: WP4 confirms the accent key at first render and records it in README. Never a local named `h`. `ui.tsx` never touches `$`.
- Tests (`tests/ui.test.tsx`): render the band (`$.ui.render({ surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} } })`) and the pane (`{ component: 'Pane', requestId: 'saver', props: { title: 'ContextSaver', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } }`) through an inline test plugin with fixture states: empty state text; two wasters with buttons; `$.ui.press` on `card:<id>:kill`, `card:<id>:info` (expanded block shows `kill →` and three evidence quotes), `card:<id>:steer` (the tree now holds an `Input` with the fix as `value`; after a `steer.draft` the `Input` renders the draft), `check`, `write:<id>` and `toggle` call the actions; inline placement shows the compact layout; band omits zero segments.

---

## 6. The shell — `hooks/register.ts` and `hooks/host.ts` (WP6)

`Host` (each member one literal `$.noun.verb`, bound in `session.start` like `mods/diff/hooks/register.ts` lines 594-621):
(`invalidate`, `toast` and `log` return `void`, not promises; the rest return promises.) `now() → $.clock.now()` · `invalidate() → $.ui.invalidate('ui.render')` · `toast(text) → $.ui.toast(text)` · `log(text) → $.ui.log(text)` · `openPane(args) → $.ui.open(args)` · `closePane(args) → $.ui.close(args)` · `registerCommand(spec) → $.command.register(spec)` · `usage(args?) → $.session.usage(args)` · `storeGet(key) → $.store.get(key)` · `storeSet(key, v) → $.store.set(key, v)` · `fork(prompt) → $.model.fork({ prompt })` · `readFile(p) → $.fs.read(p)` · `writeFile(p, t) → $.fs.write(p, t)` · `exists(p) → $.fs.exists(p)` · `debugFlag() → $.env.get('CONTEXTSAVER_DEBUG')`.

Closure state: `let state: State`, `let host: Host | null`. `dispatch(a)` = `state = reduce(state, a); host?.invalidate()`; when `state.saved` grew, toast `+${duration} · +~${pct}% context saved`. Every hook body: `try { … } catch { return next(e) }`.

| Event | Matcher | Hook |
|---|---|---|
| `session.start` | — | Bind `host`. `cwd = e.cwd`. `u = await host.usage({ breakdown: 'summary' })` → `state = initialState(cwd, u.context.window)`; `dispatch(usage { window, compactAt: u.context.breakdown?.autoCompactThreshold, tokens, percent })`; `dispatch(overhead { memory: Σ breakdown.memoryFiles[].tokens, mcp: Σ mcpTools[].tokens, agents: Σ agents[].tokens })` (6946-7017; zeros when absent). `stored = parseRegistry(await host.storeGet(\`patterns:${cwd}\`))` → patterns = `stored.map(fromStored)`. `await host.registerCommand(COMMAND)` (catch → `host.log`). Debug flag read once. `return next(e)`. |
| `turn.start` | — | `dispatch(turn.start)`; `return next(e)`. |
| `tool.call` | — | Own call (`next.origin.plugin === PLUGIN_NAME`) → `return next(e)`. `t0 = await host.now()`; `r = await next(e)`; `ms = (await host.now()) − t0`. `dispatch(row rowOf(e, r, ms, state.turn))`; debug → `host.log(\`ContextSaver row r${seq} ${tool} ${key} ${ms}ms ${chars}ch\`)`. If `state.notes.length` and `r.deny === undefined`: `const pending = state.notes; dispatch(notes.drained); return { ...r, context: [...(r.context ?? []), ...pending] }`. Else `return r`. |
| `turn.complete` | — | `e.agentId` → `return next(e)`. `dispatch(turn.complete { input/output/cacheRead/cacheCreate from e.usage (0 when absent), ms: e.durationMs, answerChars: e.answer.length, answerHead: e.answer.slice(0, 100), aborted: e.isAborted })`; `u = await host.usage()` → `dispatch(usage { tokens: u.context.tokens, percent: u.context.percent, now })`; `if (shouldRun(state)) void runJudge()`. `return next(e)`. |
| `session.compact` | — | Observe only: `r = await next(e)`; `dispatch(compact)`; `return r`. (Rewriting messages is v2.) |
| `prompt.submit` | — | If `e.origin.kind === 'plugin'` or the text starts with `/saver` → `next(e)`. `extra = [...state.notes, ...state.standing]`; if empty → `next(e)`. `dispatch(notes.drained)`; `return next({ ...e, context: [...(e.context ?? []), ...extra] })`. |
| `ui.render` | `{ component: 'AbovePrompt' }` | `e.props.hasSurvey` → `next(e)`. If `e.props.bodyColumns !== state.columns` → `dispatch(columns)` (no invalidate loop: `dispatch` inside a render hook must not call `invalidate`; the shell uses a plain `state = reduce(...)` here). `const { Box, Text, Button } = $.ui.resolve(e)`; `below = await next(e)`; return `<Box flexDirection="column">{below}{Band({ ui, model: bandModel(state), site: { bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows }, actions })}</Box>`. |
| `ui.render` | `{ component: 'Pane', requestId: PANE_ID }` | `const { Box, Text, Button, Input } = $.ui.resolve(e)`; return `Pane({ ui, model: paneModel(state, propose(state)), site: { bodyColumns: e.props.bodyColumns, maxRows: e.props.scroll.bodyRows }, placement: e.props.placement, actions })`. |
| `command.run` | `{ command: 'saver' }` | `[sub, ...rest] = e.args.trim().split(/\s+/)`: `''` or `rules` → `togglePane()`, `{ text: paneOpen ? 'ContextSaver pane hidden' : 'ContextSaver pane shown' }`; `check` → if `state.judge.running` → `{ text: 'ContextSaver: already checking' }`; else `void runJudge()`, `{ text: 'ContextSaver: checking this session for waste…' }`; `steer` → `text = rest.join(' ')`; `id = state.steering ?? cards[0]`; if `!id || !text` → `{ text: 'Usage: /saver steer <instruction> (applies to the waster whose Steer field is open, else the newest)' }`; else `steerSubmit(id, text)`, `{ text: \`ContextSaver: Claude will be told — ${text}\` }`; `debug` → `{ text: debugDump(state) }`; `reset` → `dispatch(reset)`, `{ text: 'ContextSaver: session state reset' }`; else `{ text: 'Usage: /saver [check | steer <text> | debug | reset]' }`. |
| `command.run` | `{ command: ['clear', 'resume'] }` | `r = await next(e)`; `dispatch(reset)`; `return r`. |
| `ui.close` | `{ id: PANE_ID }` | `r = await next(e)`; `dispatch(pane false)`; `return r`. |

Actions:
- `keep(id)`: `dispatch(decide keep)`; toast `ContextSaver: kept "${kind}"`; persist.
- `steer(id)`: `dispatch(steer.begin)` (shows or hides the field under that waster's verbs).
- `steerDraft(text)`: `dispatch(steer.draft)` (no toast; the redraw carries the text back into the field).
- `steerSubmit(id, text)`: `text = text.trim()`; empty → toast `ContextSaver: write the instruction first`; else `dispatch(decide { id, 'steer', text })`, toast `ContextSaver: Claude will be told — ${first line}${more ? ' …' : ''}`, persist. `/saver steer <text>` calls it with `id = state.steering ?? cards[0]` and `text = e.args` after the word `steer`, newlines preserved (probe in section 8 confirms `e.args` keeps them).
- `kill(id)`: `dispatch(decide kill)`; toast `ContextSaver: told Claude to stop — ${fix}`; persist.
- `info(id)`: `dispatch(expand id)`.
- `togglePane()`: if `paneOpen` → `await host.closePane({ id: PANE_ID })` (the `ui.close` hook records it); else `await host.openPane({ id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS })` then `dispatch(pane true)`. Opened on the person's request it is placed at any width (1943-1945); not focused, so the keyboard stays in the prompt.
- `check()`: as `/saver check`.
- Auto-open (shell, after a `judge.done` dispatch that queued fresh cards): if `!state.paneOpen && !state.autoOpened && (state.columns ?? 0) >= AUTO_OPEN_MIN_COLUMNS` → `await host.openPane({ id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS })`, `dispatch(pane { open: true, auto: true })`. Below that width the band's `n new wasters [Open]` is the only signal (same rule as `/diff` opening on the first edit).
- `write(a)`: `append` → `existing = (await exists) ? await readFile : ''`; write `existing + (existing.includes('## ContextSaver') ? bulletOnly : content)`; `write` → `writeFile`; `merge-settings` → `writeFile(path, mergeSettings(existing, rule))`. Then `dispatch(artifact.done)`, toast `Wrote ${path}`. Errors → toast the message.
- `tryOnce(a)`: `dispatch(standing.add a.content-summary)`; `dispatch(artifact.done)`; toast `Trying "${title}" for this session`.
- `skip(a)`: `dispatch(artifact.done)`.

`runJudge()`: `dispatch(judge.start)`; `try { r = await host.fork(buildPrompt(state)) } catch (err) { r = null; reason = message }`; `r === null` → `dispatch(judge.done { patterns: state.patterns, fresh: [], recurred: [], focus: null, spent: 0, error: reason ?? 'cold snapshot' })`; else `{ findings, focus } = parseReply(r.text, state)`; `{ patterns, fresh, recurred } = merge(state, findings)`; `dispatch(judge.done { patterns, fresh, recurred, focus, spent: costOf(r.usage), error: null })`; persist.

`persist()`: `stored = parseRegistry(await host.storeGet(key))`; `await host.storeSet(key, mergeStored(stored, state.patterns.map(toStored)))`; fire-and-forget with `.catch(() => undefined)`.

Notes: a hot reload (`--plugin-dir` save, `/reload-plugins`) re-runs `register()`; session state is lost, the registry reloads from the store. The only awaited work inside hooks is `next(e)`, two `clock.now()`, and the fast `session.start` calls.

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
1. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .` → after the first turn the band shows `ContextSaver  … Open`; `/saver` docks the pane beside the transcript with the two-row header and the calm empty state; `/saver` again hides it. Design QA (§5.5) at 56 and 80 dock columns and inline: three tones, one bold per block, gutter aligned, nothing over width.
2. Ask Claude to make three small edits and run `bun x tsc --noEmit -p .` after each → `/saver check` → within ~30 s the pane auto-opens with a waster `● Claude keeps running the full typecheck after every step · 3× · …`; `/saver debug` shows the cited row ids exist (PRD open question 2). Click `Steer` → a one-line field opens under the verbs, pre-filled with the judge's fix; edit in the middle of the text while Claude is still producing tool calls (probe: the cursor stays put across redraws), Enter → toast `ContextSaver: Claude will be told — …`; the waster moves to DECIDED as `↪ steered`. Also send a multi-line `/saver steer …` from the composer (Shift+Enter between lines) and confirm the newlines survive in `/saver debug` (probe: `e.args` newline handling). Ask Claude to "make one more edit and check" → it runs a narrower check or declines (open question 1); SAVED grows after the narrower call or after two quiet turns.
3. Ask Claude to run `find . -type f | head -300` three times → `/saver check` → new waster; click `[Kill]` → toast, `✕ killed` in DECIDED; ask Claude to run it again → it declines, or the waster returns marked `ignored 1×` (D4).
4. Any further waster → `[Keep]` → `✓ kept`, never shown again this session.
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

Code-side waste detectors (D0); `fires_after` (a finding already requires two occurrences, so cards fire on report); blocking any tool at `tool.check` (Steer and Kill are prompts); `prompt.section` steering; `$.model.classify`; `$.turn.abort`; generated guard mods and `permissions.deny` rules; editing an existing agent's `model:` field; `turn.step`; `engine.create` nouns; Client modules; `claude plugin eval` suites; hover "basis" tooltip; `session.compact` rewriting (v2); next-session measurement (v2); registry export (v3).

---

## Appendix A — The judge prompt (verbatim; `JUDGE_PROMPT` in `core/judge.ts`)

Merged from the synthesized draft and both critics' revisions; every column it names exists in `Row`/`TurnStat`/`KeyStat` (sections 4, 5.1) and is rendered by `buildPrompt` (section 5.3). Static part ≈ 1,950 words.

```text
You are auditing THIS session for wasted context and wasted time. The transcript above is your own: read it for intent — what the user asked for, what you were told, what you already decided. The blocks below are the only evidence of what actually ran; nothing outside them exists for this audit.

Answer one narrow question: which behaviours in this session have already repeated across separate turns, or have you said you will keep doing — and what should be done instead?

You are writing an interruption. Every finding can put a card in front of the user mid-work and can become a standing instruction that constrains you for the rest of the session. A wrong finding costs more than a missed one: it interrupts correct work, teaches a bad rule, and makes the user distrust the next card. Prefer silence to a guess. `"findings": []` is a correct and common answer.

## Rules
1. Report behaviours, not incidents. A finding needs two unexcused occurrences of the same behaviour in two different turns, or one occurrence plus your own stated intent to keep doing it ("I'll re-run the suite after each fix"). A single expensive call is never a finding.
2. `evidence`: row ids copied from the LEDGER `id` column (`r12`), or `turn:<n>` where `<n>` is a `turn` number printed in TURNS — turn handles only for findings whose `signature` is null. Copy ids exactly; never renumber, abbreviate or reformat one. A finding with an id that is not in these blocks is discarded whole. STATS lines and `~` summary lines carry no id: use them for counts and history in `why` (they are the whole session, counted for you), never cite them as evidence, and never assume the oldest full row is the first occurrence.
3. `signature`: copy `key` character-for-character from one LEDGER row and `tool` from that same row. Keys are cut at 200 characters — copy the cut, never complete a command from memory. A pair that does not match a row discards the finding. Choose a key that only the wasteful version of the call carries; when no single recurring call carries the behaviour, use `"signature": null`.
4. Reuse ids. If KNOWN PATTERNS already names the behaviour, return that exact `id` with fresh evidence. The same command, file or lens under a different slug or category is the same waste: scan KNOWN PATTERNS and DECISIONS before minting an id.
5. Respect DECISIONS. A `keep` silences that behaviour under any id, category or wording for this session, and a kept occurrence may not be cited as evidence inside another finding. A behaviour kept in a previous session may be reported only with three or more occurrences and confidence 0.8 or higher. A `steer` or `kill` may be reported again only if it recurred after that turn: cite rows whose `turn` is greater and say so in `why`.
6. `kind`: one sentence of at most 120 characters, starting exactly `Claude keeps `, naming the concrete thing — the command, the file, the agent.
7. `alternative`: one imperative sentence of at most 200 characters addressed to Claude. It is sent to Claude verbatim, may be re-sent with every prompt for the rest of the session, and may be written into CLAUDE.md, so it must be safe to obey in situations you did not see: scope it ("run only the tests covering the files you changed, then the full suite once per phase"), never ban a capability outright ("never run the test suite"). If you cannot phrase the fix without forbidding something legitimate, drop the finding.
8. `why`: one or two sentences of evidence — how many times, what changed between occurrences, what the transcript shows — and the legitimate explanation you considered and what rules it out. Never a count or a cost these blocks do not contain.
9. At most six findings, at most two with `signature: null`, ordered by the sum of `chars` over the rows cited, largest first. Six is a ceiling, not a target; never split one behaviour into two findings.

## Counting — what makes two occurrences a repeat
- Different turns. Several calls inside one turn are one decision and count once: a parallel batch of Reads, or a fan-out of subagents launched together, is one choice however wide.
- Both unexcused. An occurrence the "Never report" list excuses does not count and may not be cited. Subtract the excused ones first; if fewer than two remain, there is no finding. A baseline suite run at the start plus the check before a commit is zero findings.
- Same side of a compaction. TURNS lists the turns where a compaction happened; content dropped by it must be re-acquired. Count only occurrences after the last compaction.
- Same behaviour, not the same shape. For a signature finding that means the same `key`; two Read keys differing only in `:offset-limit` are different slices, not a repeat. For a null-signature finding you must name one behaviour and show it in each cited turn; do not staple unrelated expensive turns together.
- Short sessions. With fewer than about 15 ledger rows or fewer than 5 turns, report only behaviours with three or more surviving occurrences, or one plus explicit stated intent.

## Categories — the nine names are the whole enum; the cues are examples and `kind` is free text
- execution — the whole suite/build/typecheck after each edit; re-running a check with nothing edited since it last passed; the same failing command retried with no diagnostic step between; `sleep` polling or a watch/dev server run as a blocking call (`bg` absent, large `ms`). Not: a run after any intervening edit, install, migration or config change; the session's baseline run; broad verification after shared code changed; the last check before a commit; one retry of a transient failure. The error text is not in these blocks, so you cannot claim two failures were the same failure.
- reading — the same path read again with nothing having changed it; whole-file reads where a range would do (`trunc`); unfiltered log/diff/verbose dumps (large `chars`, `persist=`); a Bash read of a file that is then Read again; wide greps with no path scope and no edit after them. Not: a read after your own edit or after any command that could have rewritten the file; a read after a compaction; paging (a second read at a new offset, especially after `trunc`); the first look at an unfamiliar file or log; a row flagged `dedup` (core charged nothing).
- production — whole-file rewrites for small changes (`+a/-d` near the file's size); edits that cancel out; tests or docs nobody asked for; the same Edit failing on one path over and over. Not: a new file; a rewrite the user asked for; call-site updates the change requires.
- behavior — read/edit/read oscillation with nothing finished; approach flip-flops; repeating what the user already corrected. Not: read-edit-verify cycles that are the working method, or a step that depends on the previous result.
- communication — turns with `calls 0` and large `answerChars` that restate the plan or recap finished work; stopping to ask what the transcript, the repo or your instructions already answer. Not: the turn that answers a question the user asked; a plan or explanation you were asked for; the session's last turn; plan mode, where making no tool call is required. `out` includes thinking, so point at the restated content, not the token shape.
- multi-agent — parallel agents each re-reading the same large file the parent already had; agents with a thin brief (small `promptChars`, large `tokens`); results never read; agents spawned again after a limit error; mechanical agents on the premium model (`agent=` flag shows the resolved model and `edits`). Not: agents with disjoint file sets each reading one shared spec; two agents touching one path unless the ledger shows a conflict (an errored edit right after another agent's edit, or a re-edit in the main loop after they returned).
- environment — installs repeated with no manifest edit; Bash used where Read/Grep/Edit is cheaper; fixed per-turn overhead (memory files, agent descriptions, MCP schemas in the facts line) larger than the work. Not: the user's own denials (`denied`); a single approval prompt.
- process — many tiny commits or amends on one change; work declared done with no check run; re-deriving after a compaction what was settled before it. Not: docs- or config-only changes with no check to run, or a check the environment cannot run.
- other — a repetition none of the above names. Name it plainly.

## Never report
- A first occurrence, or anything with fewer than two unexcused occurrences after the Counting rules.
- Orientation: turns 1-3, the first look at any file, directory or log, an unfamiliar area, or a scope the user left open ("audit every call site", "review the repo").
- Parallelism: calls batched in one turn, and agents on disjoint scopes at once, are one decision each.
- Occurrences a compaction separates, and any re-read a compaction made necessary. Compaction, prompt-cache reads and the host's own truncation are the harness working as designed.
- A denied call (`denied`): the user or a policy said no, never your waste. The only reportable version is re-running an unchanged command already declined twice, and then the fix is a `settings-allow` proposal, not a rebuke.
- A file change you cannot see: the `paths` column records only Edit/Write and Bash calls the host diffed, and nothing for a staged edit. Treat an intervening formatter, codegen, migration, install, `git checkout|stash|pull|apply`, `sed -i`, MCP edit or another agent's edit as having changed the file.
- Volume alone. A large read is waste only when a cheaper call would have answered the same question for the same purpose; if the output was the deliverable (the diff under review, the log you were asked to explain, a file about to be rewritten) it is not a finding.
- Turns spent thinking on a genuinely hard decision.
- A cue whose evidence is not in these columns (an error message, a file's true size, worktree isolation): if you cannot see it, you cannot evidence it.
- Anything the user asked for this session, however wasteful it looks. Read the transcript before you accuse.

## Confidence
`confidence` runs 0.5 to 1.0. 0.9+: the same key three or more times across separate turns, nothing changed between, no request for it in the transcript. 0.7-0.9: the repetition is plain across turns and the transcript offers no legitimate reason. 0.5-0.7: the repetition is real but a legitimate reason is plausible — report here only if you looked for that reason and `why` names what rules it out; if it could plausibly have been the right call, drop it. Below 0.5: say nothing.

`est_tokens_per_turn`: null whenever `signature` is an object. For a null signature it is an integer grounded in the `answerChars` of the cited turns divided by four, conservative end, or 0 when you cannot ground it; the user sees it multiplied into a savings figure every turn after a decision.

`proposal`: null unless the fix should outlive the session. Otherwise `{"kind","title","body"}` where body is, per kind: `claude-md` one imperative rule line; `skill` the workflow as the body of a SKILL.md; `agent-brief` the brief, whose first line may be `model: haiku` or `model: sonnet`; `settings-allow` nothing but a permission rule such as `Bash(bun test:*)`.

## Contract — the shape of your reply, stated once (documentation, not a template to echo)
```json
{"focus": "<one line: what this session is doing>",
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
`findings` may be `[]`. `signature` is that object or `null`. No other keys, and never null where a string is specified. Reply with one JSON object: first character `{`, last character `}`, no prose before or after, no code fence.

## Examples — evidence, then what it justifies
Rows `r41`, `r45`, `r50` carry `test:bun test` in turns 7, 8, 9 while only `/src/auth.ts` was edited between them, `r41` being the session's baseline run: `{"focus":"fixing the auth token refresh in /src/auth.ts","findings":[{"id":"execution:full-suite-after-each-edit","category":"execution","kind":"Claude keeps running the whole bun test suite after every single-file edit","evidence":["r45","r50"],"signature":{"tool":"Bash","key":"test:bun test"},"why":"r41 was the baseline and is excused; the suite then ran in full at turns 8 and 9 after single-file edits to /src/auth.ts alone, about a minute and 9.7k characters each. Nothing shared changed, and the user asked for a fix, not full verification.","alternative":"Run only the test files covering the files you changed, then the whole suite once when the phase is done.","confidence":0.92,"est_tokens_per_turn":null,"proposal":{"kind":"claude-md","title":"Targeted tests","body":"Run only the tests covering the files you changed; run the full suite at the end of a phase."}}]}`
Rows `r12` Read `/src/api.ts:-`, `r15` Edit `/src/api.ts`, `r16` Read `/src/api.ts:-` with `dedup`, all in turn 4: `{"focus":"a one-file change in /src/api.ts","findings":[]}` — the second read follows your own edit, the third was deduped, and one turn is one decision.
Rows `r08` `test:bun test` (turn 2, baseline), `r23` `test:bun test test/db.test.ts` (turn 6, after an edit), `r40` `test:bun test` (turn 11) followed by `r41` `git:git commit …`: `{"focus":"a db pool fix, verified narrowly then once before the commit","findings":[]}` — both full runs are excused, so nothing survives the Counting rules.
Rows `r61` and `r72` both `read:docker compose logs api --tail 2000` in turns 11 and 13, each ~40k `chars` with `persist=`: the same shape as the first example with `"id":"reading:unfiltered-log-dump"`, `"kind":"Claude keeps reading 2000 lines of api logs instead of grepping for the error"`, `"alternative":"Pipe log commands through grep -nE 'ERROR|Traceback' and tail -50 instead of reading the whole tail."`, `"confidence":0.85`, `"proposal":null`.
TURNS shows turns 14 and 15 with `calls 0` and `answerChars` 5400 and 6100 after a single edit at turn 13, neither answering a question: `"id":"communication:restates-plan-each-turn"`, `"evidence":["turn:14","turn:15"]`, `"signature":null`, `"est_tokens_per_turn":1200`, `"alternative":"State the result in one or two lines and take the next action; do not restate the plan or recap completed steps."`.
KNOWN PATTERNS lists `execution:full-suite-after-each-edit | … | steer @ 9` and rows `r70` (turn 12) and `r76` (turn 14) carry `test:bun test` again: return that same id with `"evidence":["r70","r76"]` and a `why` that names turns 12 and 14 as after the steer at turn 9.

## KNOWN PATTERNS — `id | kind | decision @ turn | previous`. Reuse these ids; never mint a second id or signature for waste listed here.
{{KNOWN_PATTERNS}}

## DECISIONS — `id | key | keep|steer|kill @ turn`, then previous-session keeps. A `keep` key is off limits under any id this session.
{{DECISIONS}}

## STATS — the whole session, counted for you. Per call: `tool | key | cls | ×count | Σms | Σchars | turns first-last | edits-between | agents` (edits-between: median number of files edited between consecutive runs; 0 means it re-ran with nothing changed). Then per class, per agent, and the five costliest single rows. No ids here; cite LEDGER rows.
{{STATS}}

## TURNS — `turn | in | out | cacheCreate | calls | ms | answerChars`, then the facts line (context window, fixed per-turn overhead, turns where a compaction happened)
{{TURNS}}

## LEDGER — `id | tool | key | cls | agent | turn | ms | chars | flags | paths`, oldest first. `ms` is wall time and includes any wait on a permission prompt, so a long `ms` alone is not machine cost. flags: `err` `denied` `dedup` `trunc` `bg` `timeout` `persist=<bytes>` `+adds/-dels` `agent=<type>/<model>/<status>/<tokens>tok/<edits>edits`, or `-`. Rows older than the window are folded into `~ | tool | key | ×count | Σchars` lines: no id, never citable, key usable as a signature only if it also appears in a full row.
{{LEDGER}}

Return the JSON object only.
```

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
ContextSaver  29% · 133k to compaction                                                            Open
> █
```

**2. Watching (silent).** Every tool call becomes a ledger row (with a short quote of its result); every turn end records tokens, calls, duration, answer length. Nothing is shown, nothing is sent to Claude.

**3. The judge runs** after ~30k new tokens and 3 turns, or on `/saver check` / `Check now`: one `$.model.fork` over the session's own transcript plus STATS, TURNS and LEDGER (Appendix A). New findings become wasters. The first time, in a wide fullscreen terminal, the pane docks itself beside the transcript (like `/diff` on the first edit); otherwise the band says `2 new`. The ASCII below is a layout sketch, not the design: WP4 designs to the brief in section 5.5 (tones, grid, disclosure) and the result is reviewed live.

```
 CONTEXT   ██████████░░░░░░  64%   ▁▁▂▂▃▄▅▆▇   41k to compaction ≈ 6 turns
 JUDGE     2 runs · 7.4k tokens   SAVED  ~3% · 3 min                Check now
 ─────────────────────────────────────────────────────────────────────────

 ● Claude keeps running the whole bun test suite after every            i
   single-file edit
   3× · ~9% context · 3m 12s · turns 5…8
   Keep    Steer    Kill    → run only the tests covering the files you
                              changed; full suite once per phase

 ● Claude keeps reading 2000 lines of api logs instead of grepping      i
   for the error
   2× · ~20% context · turns 11…13
   Keep    Steer    Kill    → grep -nE 'ERROR|Traceback' | tail -50

 ─────────────────────────────────────────────────────────────────────────
 DECIDED   ↪ re-reading src/auth.ts · saved ~1%
 RULES     Re-read only after edits · CLAUDE.md           Write  Try  Skip
```
Three tones only: default text for content, dim for everything secondary, the theme accent for `●`, the gauge fill and the verbs. Buttons are clicked, or reached with ctrl+x tab and pressed with Enter. Nothing blocks Claude, who keeps working.

**4. `i` opens the details in place**, one waster at a time; labels dim and lowercase in the gutter, values aligned:

```
 ● Claude keeps running the whole bun test suite after every            i
   single-file edit
   why       ran in full 3× while only src/auth.ts changed between runs;
             the user asked for a fix, not full verification
   fix       run only the tests covering the files you changed; run the
             full suite once when the phase is done
   kill →    "Stop this behaviour for the rest of the session: … From now
             on: run only the tests covering the files you changed…"
   evidence  r50 · t8 · bun test · 60s · 9.9k · ✓ 212 passed
             r45 · t7 · bun test · 59s · 9.6k · ✓ 212 passed
             r41 · t5 · bun test · 61s · 9.8k · ✓ 212 passed
   Keep    Steer    Kill
```

**5a. Keep.** The waster moves to DECIDED as `✓ kept`; silent for the session; recorded for the judge's calibration next session. Nothing is sent to Claude.

**5b. Steer.** A one-line field opens under the verbs, pre-filled with the fix. One Enter sends the suggestion as the user's own instruction; rewriting it first is the normal case. Keep and Kill stay one click away; `Steer` again closes the field. `/saver steer <text>` from the composer does the same and takes a multi-line body for longer instructions. The typed text is kept in state so the pane's constant redraws never wipe it.
```
 ● Claude keeps running the whole bun test suite after every            i
   single-file edit
   3× · ~9% context · 3m 12s · turns 5…8
   Keep    Steer    Kill
   ›  run the full test cycle only at the end of each phase; until then█
      Enter sends · Steer again closes · multi-line: /saver steer in the prompt
```
Toast `ContextSaver: Claude will be told — …`; the waster moves to DECIDED as `↪ steered`. Claude receives, attached to its very next tool result (mid-turn, invisible to the user) and then with every later prompt:
```
Instruction from the user (via ContextSaver): run the full test cycle only at the end of each phase; until then run tests/auth.test.ts only
```

**5c. Kill.** No typing. Toast `ContextSaver: told Claude to stop — run only the tests covering…`; `✕ killed` in DECIDED. Claude receives the `kill →` text shown under `i`, wrapped in the same `Instruction from the user (via ContextSaver): …` prefix as a steer, so both channels read as the user's word.

**6. Savings.** When Claude next runs a narrower same-class command (`bun test tests/auth.test.ts`, 4 s, 900 chars) the difference to the median full run is credited: toast `+2m 58s · +~3% context saved`, SAVED and the band update. Two quiet turns credit the full baseline. If the behaviour recurs anyway, saved stays 0 and the waster returns to WASTERS marked `ignored 1×` so the user can Keep or say something else.

**7. Rules for next session.** `[Write]` appends the bullet under a `## ContextSaver` heading in the project's CLAUDE.md (or writes a skill, an agent brief, or a `permissions.allow` rule when the judge proposed one). `[Try once]` keeps the rule for this session only. `[Skip]` drops the proposal. Nothing is written without a click.

**8. Commands.** `/saver` toggles the pane; `/saver check` runs the judge now; `/saver steer <text>` finishes a Steer; `/saver debug` prints ledger, patterns, judge cost, savings; `/saver reset` and `/clear` drop session state (registry and last decisions persist per project).

**9. Narrow terminals.** Below 110 columns, or on the main screen, `/saver` seats a compact pane inline above the prompt: the CONTEXT row, the newest waster in full, the others as one dim row each, and a `DECIDED n · RULES n · /saver for the full pane` line.

**10. What never happens.** No tool is blocked or slowed; no text reaches Claude and no file is written without a click; the band yields to Claude Code's own surveys; a failing hook falls back to normal behaviour; headless runs record rows and show nothing.
