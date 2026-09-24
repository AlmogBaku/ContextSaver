import type { ModelForkUsage } from 'claude-code'

import { say } from '../say'
import { agentsBlock, decisionsBlock, knownPatternsBlock, ledgerBlock, sinksBlock, statsLines, turnsBlock } from './blocks'
import { agentAliases } from './evidence'
import { totalTokens } from './patterns'
import { collapseWs, median } from './text'
import {
  ALTERNATIVE_MAX, JUDGE_LEDGER_ROWS, JUDGE_MIN_GAP_MS, JUDGE_MIN_NEW_ROWS, JUDGE_MIN_NEW_TOKENS,
  JUDGE_MIN_ROWS, JUDGE_MIN_TURNS, KIND_MAX, MAX_BEHAVIORAL_FINDINGS, MAX_FINDINGS, MAX_PATTERNS,
} from './types'
import type { ArtifactKind, Category, Finding, JudgeUsage, Loop, Pattern, Proposal, Row, Signature, State } from './types'

/** The judge prompt (build spec Appendix A, verbatim) with the eight evidence placeholders. */
export const JUDGE_PROMPT = `You are auditing THIS session for wasted context and wasted time. The transcript above is your own: read it for intent — what the user asked for, what you were told, what you already decided. The blocks below are the only evidence of what actually ran; nothing outside them exists for this audit.

Answer four narrow questions. What repeated: which behaviours have already happened more than once, separated by other work, or have you said you will keep doing — and what should be done instead? Where the time and the context went: which of the largest sinks below are repetition or work nobody asked for rather than the work this session needed. What is going in circles: the same failing command retried with no diagnostic step between, read/edit/read on one path with nothing finished, an edit failing on one path over and over. What was out of proportion: which spawned work — an agent, a workflow stage, a review or verification round — cost far more than what it produced, or did what a shell step would have done (AGENTS below).

You are writing an interruption. Every finding can put a card in front of the user mid-work and can become a standing instruction that constrains you for the rest of the session. A wrong finding costs more than a missed one: it interrupts correct work, teaches a bad rule, and makes the user distrust the next card. Prefer silence to a guess. \`"findings": []\` is a correct and common answer.

## Rules
1. Report behaviours, not incidents. A finding needs two unexcused occurrences of the same behaviour separated by other work (see Counting), or one occurrence plus your own stated intent to keep doing it ("I'll re-run the suite after each fix"). A single expensive call is never a finding.
2. \`evidence\`: row ids copied from the LEDGER \`id\` column (\`r12\`), or \`turn:<n>\` where \`<n>\` is a \`turn\` number printed in TURNS, or \`agent:<alias>\` where \`<alias>\` is an \`alias\` printed in AGENTS — turn and agent handles only for findings whose \`signature\` is null. Copy ids exactly; never renumber, abbreviate or reformat one. A finding with an id that is not in these blocks is discarded whole. STATS lines and \`~\` summary lines carry no id: use them for counts and history in \`why\` (they are the whole session, counted for you), never cite them as evidence, and never assume the oldest full row is the first occurrence.
3. \`signature\`: copy \`key\` character-for-character from one LEDGER row and \`tool\` from that same row. Keys are cut at 200 characters — copy the cut, never complete a command from memory. A pair that does not match a row discards the finding. Choose a key that only the wasteful version of the call carries; when no single recurring call carries the behaviour, use \`"signature": null\`.
4. Reuse ids. If KNOWN PATTERNS already names the behaviour, return that exact \`id\` with fresh evidence. The same command, file or lens under a different slug or category is the same waste: scan KNOWN PATTERNS and DECISIONS before minting an id.
5. Respect DECISIONS. A \`keep\` silences that behaviour under any id, category or wording for this session, and a kept occurrence may not be cited as evidence inside another finding. A behaviour kept in a previous session may be reported only with three or more occurrences and confidence 0.8 or higher. A \`steer\` or \`kill\` may be reported again only if it recurred after that turn: cite rows whose \`turn\` is greater and say so in \`why\`.
6. \`kind\`: one sentence of at most 120 characters, starting exactly \`Claude keeps \`, naming the concrete thing — the command, the file, the agent.
7. \`alternative\`: one imperative sentence of at most 200 characters addressed to Claude. It is sent to Claude verbatim, may be re-sent with every prompt for the rest of the session, and may be written into CLAUDE.md, so it must be safe to obey in situations you did not see: scope it ("run only the tests covering the files you changed, then the full suite once per phase"), never ban a capability outright ("never run the test suite"). If you cannot phrase the fix without forbidding something legitimate, drop the finding.
8. \`why\`: one or two sentences of evidence — how many times, what changed between occurrences, what the transcript shows — and the legitimate explanation you considered and what rules it out. Never a count or a cost these blocks do not contain.
9. At most six findings, at most three with \`signature: null\`, ordered by the sum of \`chars\` over the rows cited, largest first. Six is a ceiling, not a target; never split one behaviour into two findings.

## Counting — what makes two occurrences a repeat
- Separated by other work. Two occurrences of the same behaviour count as two decisions when at least one other row sits between them — an edit, a read, another command — whether in the same turn or a later one; a run after an edit is a second decision, not a second call in one batch — whether it is excused is the category's own question. Calls issued together with nothing between them are one batch and count once: a parallel set of Reads, or a fan-out of subagents launched at once, is one choice however wide. Breadth is one decision; weight is not: every stage of a workflow (each \`label\` in AGENTS) is a decision of its own, and the same role recurring stage after stage — a check loop per chunk, a review round after every fix — is a repeat.
- Both unexcused. An occurrence the "Never report" list excuses does not count and may not be cited. Subtract the excused ones first; if fewer than two remain, there is no finding. A baseline suite run at the start plus the check before a commit is zero findings.
- Same side of a compaction. TURNS lists the turns where a compaction happened; content dropped by it must be re-acquired. Count only occurrences after the last compaction.
- Same behaviour, not the same shape. For a signature finding that means the same \`key\`; two Read keys differing only in \`:offset-limit\` are different slices, not a repeat. For a null-signature finding you must name one behaviour and show it in each cited turn; do not staple unrelated expensive turns together.
- Agents are loops of their own. The \`agent\` column names the loop; a repeat inside one agent's rows counts exactly like a repeat in the main loop, and the main loop re-doing after an agent returns what that agent's rows show it already did (the same Read key, the same check) is a repeat across loops.
- Short ledgers. With fewer than about 12 rows or fewer than 4 turns, report only behaviours with three or more surviving occurrences, or one plus explicit stated intent.
- The legitimacy ladder. A sink needed once is nothing, however large. A sink repeated because its inputs changed between the runs — an edit, an install, a migration — is nothing. A sink repeated with nothing changed between, or work the transcript shows nobody asked for, is a finding, and the excuse you considered is written into \`why\`.

## Categories — the nine names are the whole enum; the cues are examples and \`kind\` is free text
- execution — the whole suite/build/typecheck after each edit; re-running a check with nothing edited since it last passed; the same failing command retried with no diagnostic step between; \`sleep\` polling or a watch/dev server run as a blocking call (\`bg\` absent, large \`ms\`). Not: a run after any intervening edit, install, migration or config change; the session's baseline run; broad verification after shared code changed; the last check before a commit; one retry of a transient failure. The error text is not in these blocks, so you cannot claim two failures were the same failure.
- reading — the same path read again with nothing having changed it; whole-file reads where a range would do (\`trunc\`); unfiltered log/diff/verbose dumps (large \`chars\`, \`persist=\`); a Bash read of a file that is then Read again; wide greps with no path scope and no edit after them. Not: a read after your own edit or after any command that could have rewritten the file; a read after a compaction; paging (a second read at a new offset, especially after \`trunc\`); the first look at an unfamiliar file or log; a row flagged \`dedup\` (core charged nothing).
- production — whole-file rewrites for small changes (\`+a/-d\` near the file's size); edits that cancel out; tests or docs nobody asked for; the same Edit failing on one path over and over. Not: a new file; a rewrite the user asked for; call-site updates the change requires.
- behavior — read/edit/read oscillation with nothing finished; approach flip-flops; repeating what the user already corrected. Not: read-edit-verify cycles that are the working method, or a step that depends on the previous result.
- communication — turns with \`calls 0\` and large \`answerChars\` that restate the plan or recap finished work; stopping to ask what the transcript, the repo or your instructions already answer; an \`ask\` row that held the turn for minutes while no agent ran (no rows between it and the next prompt) and whose options carried a recommended default (\`recommended\`) — proceed on the default and ask beside the work. Not: the turn that answers a question the user asked; a plan or explanation you were asked for; the session's last turn; plan mode, where making no tool call is required; a question whose answer the transcript shows changed the plan. \`out\` includes thinking, so point at the restated content, not the token shape.
- multi-agent — parallel agents each re-reading the same large file the parent already had; agents with a thin brief (small \`promptChars\`, large \`tokens\`); results never read; agents spawned again after a limit error; mechanical agents on the premium model (\`agent=\` flag shows the resolved model and \`edits\`); the main loop re-reading files or re-running checks an agent's rows already covered, after it returned; a brief that pastes in whole files (large \`promptChars\`) to an agent whose rows then Read the same paths anyway; a workflow whose later agents re-read what earlier agents read (the same Read keys under successive \`agent\` values, spread over turns); a loop whose rows are only checks that passed, with \`edits 0\` and a report as its outcome (AGENTS \`checks\` > 0) — a shell step given a model; review or verify loops with \`edits 0\` whose outcome carries no medium, high or critical finding, recurring stage after stage; two or more verifier loops per finding; a run whose tokens per edit are several times the others'; a fix loop followed by a review whose outcome carries a new high in the same stage, twice (regression chasing: stop the loop and re-plan). Not: agents with disjoint file sets each reading one shared spec; two agents touching one path unless the ledger shows a conflict (an errored edit right after another agent's edit, or a re-edit in the main loop after they returned); a re-read whose brief the transcript shows is a review or verification pass; every agent reading the one spec its brief names; the parent reading an agent's result; one review per stage that found a medium or higher; a loop that edited; a fan-out's breadth on its own.
- environment — installs repeated with no manifest edit; Bash used where Read/Grep/Edit is cheaper; fixed per-turn overhead (memory files, agent descriptions, MCP schemas in the facts line) larger than the work. Not: the user's own denials (\`denied\`); a single approval prompt.
- process — many tiny commits or amends on one change; work declared done with no check run; re-deriving after a compaction what was settled before it. Not: docs- or config-only changes with no check to run, or a check the environment cannot run.
- other — a repetition none of the above names. Name it plainly.

## Never report
- A first occurrence, or anything with fewer than two unexcused occurrences after the Counting rules.
- A single long call that was needed once, however long it ran: the largest row in TIME or CONTEXT is a fact to explain, never a finding on its own.
- Orientation: the first look at any file, directory or log, an unfamiliar area, or a scope the user left open ("audit every call site", "review the repo").
- Parallelism: calls issued together with nothing between them are one decision, and agents on disjoint scopes launched at once are one decision — one, not none: their weight is judged under multi-agent.
- Occurrences a compaction separates, and any re-read a compaction made necessary. Compaction, prompt-cache reads and the host's own truncation are the harness working as designed.
- A denied call (\`denied\`): the user or a policy said no, never your waste. The only reportable version is re-running an unchanged command already declined twice, and then the fix is a \`settings-allow\` proposal, not a rebuke.
- A file change you cannot see: the \`paths\` column records only Edit/Write and Bash calls the host diffed, and nothing for a staged edit. Treat an intervening formatter, codegen, migration, install, \`git checkout|stash|pull|apply\`, \`sed -i\`, MCP edit or another agent's edit as having changed the file.
- Volume alone. A large read is waste only when a cheaper call would have answered the same question for the same purpose; if the output was the deliverable (the diff under review, the log you were asked to explain, a file about to be rewritten) it is not a finding.
- Turns spent thinking on a genuinely hard decision.
- A cue whose evidence is not in these columns (an error message, a file's true size, worktree isolation): if you cannot see it, you cannot evidence it.
- The duration of a \`recovered\` row, or which agent ran it: neither was recorded, and its \`err\` may be a refusal the transcript stored as error text, so treat a \`recovered\` \`err\` row as \`denied\` and never as waste.
- Anything the user asked for this session, however wasteful it looks. Read the transcript before you accuse.

## Confidence
\`confidence\` runs 0.5 to 1.0. 0.9+: the same key three or more times with other work between each, nothing changed between, no request for it in the transcript. 0.7-0.9: the repetition is plain and the transcript offers no legitimate reason. 0.5-0.7: the repetition is real but a legitimate reason is plausible — report here only if you looked for that reason and \`why\` names what rules it out; if it could plausibly have been the right call, drop it. Below 0.5: say nothing.

\`est_tokens_per_turn\`: null whenever \`signature\` is an object. For a null signature it is an integer grounded in the \`answerChars\` of the cited turns divided by four, conservative end, or 0 when you cannot ground it; the user sees it multiplied into a savings figure every turn after a decision. For agent handles it is the tokens one avoided loop would have cost, grounded in AGENTS \`tok\`, conservative end.

\`proposal\`: null unless the fix should outlive the session. Otherwise \`{"kind","title","body"}\` where body is, per kind: \`claude-md\` one imperative rule line; \`skill\` the workflow as the body of a SKILL.md; \`agent-brief\` the brief, whose first line may be \`model: haiku\` or \`model: sonnet\`; \`settings-allow\` nothing but a permission rule such as \`Bash(bun test:*)\`.

## Contract — the shape of your reply, stated once (documentation, not a template to echo)
\`\`\`json
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
\`\`\`
\`time\` and \`context\` explain where each went, for the user to read and in the words of the work: "45 min per chunk: the full proxy suite runs after every fix round and each chunk gets two review rounds". Neither is an accusation and neither is a finding by itself, so write both even when \`findings\` is \`[]\` — the examples below leave them out where they are not the point, your reply never does.

\`findings\` may be \`[]\`. \`signature\` is that object or \`null\`. No other keys, and never null where a string is specified. Reply with one JSON object: first character \`{\`, last character \`}\`, no prose before or after, no code fence.

## Examples — evidence, then what it justifies
Rows \`r41\`, \`r45\`, \`r50\` carry \`test:bun test\` in turns 7, 8, 9 while only \`/src/auth.ts\` was edited between them, \`r41\` being the session's baseline run: \`{"focus":"fixing the auth token refresh in /src/auth.ts","findings":[{"id":"execution:full-suite-after-each-edit","category":"execution","kind":"Claude keeps running the whole bun test suite after every single-file edit","evidence":["r45","r50"],"signature":{"tool":"Bash","key":"test:bun test"},"why":"r41 was the baseline and is excused; the suite then ran in full at turns 8 and 9 after single-file edits to /src/auth.ts alone, about a minute and 9.7k characters each. Nothing shared changed, and the user asked for a fix, not full verification.","alternative":"Run only the test files covering the files you changed, then the whole suite once when the phase is done.","confidence":0.92,"est_tokens_per_turn":null,"proposal":{"kind":"claude-md","title":"Targeted tests","body":"Run only the tests covering the files you changed; run the full suite at the end of a phase."}}]}\`
Rows \`r12\` Read \`/src/api.ts:-\`, \`r15\` Edit \`/src/api.ts\`, \`r16\` Read \`/src/api.ts:-\` with \`dedup\`, all in turn 4: \`{"focus":"a one-file change in /src/api.ts","findings":[]}\` — the second read follows your own edit and the third was deduped, so no unexcused occurrence remains.
Rows \`r08\` \`test:bun test\` (turn 2, baseline), \`r23\` \`test:bun test test/db.test.ts\` (turn 6, after an edit), \`r40\` \`test:bun test\` (turn 11) followed by \`r41\` \`git:git commit …\`: \`{"focus":"a db pool fix, verified narrowly then once before the commit","findings":[]}\` — both full runs are excused, so nothing survives the Counting rules.
Rows \`r61\` and \`r72\` both \`read:docker compose logs api --tail 2000\` in turns 11 and 13, each ~40k \`chars\` with \`persist=\`: the same shape as the first example with \`"id":"reading:unfiltered-log-dump"\`, \`"kind":"Claude keeps reading 2000 lines of api logs instead of grepping for the error"\`, \`"alternative":"Pipe log commands through grep -nE 'ERROR|Traceback' and tail -50 instead of reading the whole tail."\`, \`"confidence":0.85\`, \`"proposal":null\`.
TURNS shows turns 14 and 15 with \`calls 0\` and \`answerChars\` 5400 and 6100 after a single edit at turn 13, neither answering a question: \`"id":"communication:restates-plan-each-turn"\`, \`"evidence":["turn:14","turn:15"]\`, \`"signature":null\`, \`"est_tokens_per_turn":1200\`, \`"alternative":"State the result in one or two lines and take the next action; do not restate the plan or recap completed steps."\`.
Rows \`r80\`-\`r83\` under \`agent\` \`a1\` Read four files, then \`r84\` Agent \`agent:general-purpose\` flagged \`agent=general-purpose/opus/completed/41000tok/0edits/300pch\` closes that loop (a spawn row lands after the rows it caused), then \`r90\`-\`r93\` in the main loop Read the same four keys in the next turn: \`"id":"multi-agent:re-reads-what-the-agent-read"\`, \`"kind":"Claude keeps re-reading the files a subagent already read for it"\`, \`"evidence":["r80","r83","r90","r93"]\` (a row from each loop is the repeat; the four main-loop reads together are one batch), \`"signature":null\` (no single key carries it), \`"alternative":"Use the subagent's report; re-read a file it covered only to edit it."\`, \`"confidence":0.8\`, \`"est_tokens_per_turn"\` grounded in the cited turns' \`answerChars\` or 0.
KNOWN PATTERNS lists \`execution:full-suite-after-each-edit | … | steer @ 9\` and rows \`r70\` (turn 12) and \`r76\` (turn 14) carry \`test:bun test\` again: return that same id with \`"evidence":["r70","r76"]\` and a \`why\` that names turns 12 and 14 as after the steer at turn 9.
Agent rows \`r30\`, \`r58\` and \`r91\` run about 40 minutes each, a review agent follows each, every loop reads a different module and no key repeats: \`{"focus":"rewriting three modules, one agent each","time":"2h 40m in three module rewrites of about 40 minutes each, plus one review pass per module; nothing ran twice.","context":"1.1M chars, three quarters of it the agents' own reads of the modules they rewrote.","findings":[]}\` — a long session is not a wasteful one.
Four suite runs with an install or a migration between every pair, and \`agents | ×3 | Σ2100000ms | apart\` above them in TIME: \`{"focus":"a schema migration and the call sites it broke","time":"68m, most of it four suite runs, each after a migration or an install changed what the suite covers.","context":"620k chars, over half the migration diff and the failures it produced.","findings":[]}\` — every repeat had changed inputs, so the ladder stops at nothing.
AGENTS lists \`a3 | w3 | check:C3 | sonnet | 1 | 1.7m | 48k | edits 0 | checks 4 | reads 0 | report 1600ch | answer\` and \`a7 | w3 | check:C4 | …\` alike, and no row of theirs carries \`err\`: \`{"id":"multi-agent:check-loops-for-shell-steps","kind":"Claude keeps spawning an agent per chunk whose only job is to run four passing check commands","evidence":["agent:a3","agent:a7"],"signature":null,"alternative":"Run a stage's checks as a shell step of the workflow script or inside the reviewer; spawn an agent only for work that needs judgment.","confidence":0.85,"est_tokens_per_turn":48000}\`
Three \`review:*\` loops of one run, each \`edits 0\` with outcome \`3 low\`, a fix loop after each: \`{"id":"multi-agent:review-rounds-that-find-only-lows","kind":"Claude keeps running a full review round after every fix although the last two found only low findings","evidence":["agent:a9","agent:a12"],"signature":null,"alternative":"Route only medium-or-higher review findings to a fix round; end the stage when a review returns lows alone.","confidence":0.8}\`

## KNOWN PATTERNS — \`id | kind | decision @ turn | previous\`. Reuse these ids; never mint a second id or signature for waste listed here.
{{KNOWN_PATTERNS}}

## DECISIONS — \`id | key | keep|steer|kill @ turn\`, then previous-session keeps. A \`keep\` key is off limits under any id this session.
{{DECISIONS}}

## STATS — the whole session, counted for you. Per call: \`tool | key | cls | ×count | Σms | Σchars | turns first-last | edits-between | agents\` (edits-between: median number of files edited between consecutive runs; 0 means it re-ran with nothing changed), then \`waits:\` — every AskUserQuestion this session, its total wait and how many carried a recommended default; not citable, but the time it held the session is a fact to explain. Then per class and per agent. No ids here; cite LEDGER rows.
{{STATS}}

## TIME — where the wall-clock went. \`total\`, then \`label | ×count | Σms | share%\` for the largest sinks, then the five longest rows as \`r<seq> | tool | key | Σms\`. An Agent row holds its own loop's rows, so it is listed apart and never added in; \`ms\` includes any wait on a permission prompt.
{{TIME}}

## CONTEXT — where the context went. The same shape measured in \`chars\`: the total, the largest sinks with their share, then the five largest rows. An Agent row is listed apart and never added in.
{{CONTEXT}}

## AGENTS — the loops this session spawned. First one line per run: \`name | id | loops | Σmin | Σtok | edits | turn\`. Then one line per loop, oldest first: \`alias | run | label | model | turns | min | tok | edits | checks | reads | outcome | ended\` — \`alias\` is the LEDGER's \`agent\` name for that loop, \`label\` the stage the workflow gave it (\`impl:C3\`, \`check:C3\`, \`review:C6-r1\`), \`outcome\` what it returned (\`1 high 4 low\`, \`report 5900ch\`), \`ended\` \`answer\`, \`error\`, \`aborted\`, \`refusal\` or \`running\`. \`tok\` counts new tokens (input, cache creation, output) in thousands. Loops older than the window fold into \`~ run | ×loops | Σmin | Σtok\` lines. Cite a loop as \`agent:<alias>\`; a line here is a loop's whole cost, so its weight against its \`edits\` and \`outcome\` is the proportion question's evidence.
{{AGENTS}}

## TURNS — \`turn | in | out | cacheCreate | calls | ms | answerChars\`, then \`| aborted\`, \`| error\` or \`| refusal\` when the turn ended that way and \`| idle <m>m\` when the next prompt came a minute or more later, then the facts line (context window, fixed per-turn overhead, turns where a compaction happened)
{{TURNS}}

## LEDGER — \`id | tool | key | cls | agent | turn | ms | chars | flags | paths\`, oldest first (a spawn row lands after the rows it caused: an agent's own calls finish before its Agent row does). Agents are named \`a1\`, \`a2\`… in order of first appearance; \`main\` is the main loop. \`ms\` is wall time and includes any wait on a permission prompt, so a long \`ms\` alone is not machine cost. A row flagged \`recovered\` was rebuilt from the transcript before this plugin joined the session: its \`ms\` is 0 and its agent reads \`main\`, so never reason about its duration or which loop ran it. flags: \`err\` \`denied\` \`dedup\` \`trunc\` \`bg\` \`timeout\` \`persist=<bytes>\` \`ask\` (an AskUserQuestion: its \`ms\` is the wait for the person) \`recommended\` (its options named a default) \`+adds/-dels\` \`agent=<type>/<model>/<status>/<tokens>tok/<edits>edits/<promptChars>pch\`, or \`-\`. Rows older than the window are folded into \`~ | tool | key | ×count | Σchars\` lines: no id, never citable, key usable as a signature only if it also appears in a full row.
{{LEDGER}}

{{LANGUAGE}}

Return the JSON object only.
`

// Turns and tokens: the ordinary session, where the judge runs between turns.
const turnGate = (state: State): boolean =>
  totalTokens(state) - state.judge.lastAtTokens >= JUDGE_MIN_NEW_TOKENS * state.judge.backoff &&
  state.turn - state.judge.lastAtTurn >= JUDGE_MIN_TURNS

// Rows and wall time: one agentic turn can run for hours, and `turn.complete` is no cadence inside it.
const rowGate = (state: State, now: number): boolean =>
  state.seq - state.judge.lastAtSeq >= JUDGE_MIN_NEW_ROWS * state.judge.backoff &&
  now - state.judge.lastAtMs >= JUDGE_MIN_GAP_MS

/**
 * True when the cadence gates allow another judge run.
 *
 * @param state the session so far
 * @param now the clock, for the gap the mid-turn gate keeps between runs
 */
export const shouldRun = (state: State, now: number): boolean =>
  !state.judge.running &&
  state.rows.length >= JUDGE_MIN_ROWS &&
  (turnGate(state) || rowGate(state, now))

/** The four counts the fork reported, under our own names: what `/saver debug` and the debug log print. */
export const usageOf = (u: ModelForkUsage): JudgeUsage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheCreate: u.cache_creation_input_tokens,
})

/** What a run's counts cost us: input, output and cache creation (cache reads are free). */
export const spentOf = (u: JudgeUsage): number => u.input + u.output + u.cacheCreate

/** What one judge fork cost us, straight from the usage the API reported. */
export const costOf = (u: ModelForkUsage): number => spentOf(usageOf(u))

/** Names this session's loops the way one judge run sees them: built once before the prompt, read again when the reply comes back. */
export const judgeAliases = (state: State): ReadonlyMap<string, string> => agentAliases(state.rows, state.loops)

/** Fills the judge prompt with this session's evidence blocks; `aliases` is the naming AGENTS and LEDGER print, so the caller can hand the same one to `parseReply`. */
export const buildPrompt = (state: State, aliases: ReadonlyMap<string, string> = judgeAliases(state)): string => {
  // The language paragraph and the blank line under it go together: English asks for nothing here, and the
  // prompt it is handed is the one this file spells out, to the character.
  const directive = say().judge.directive
  return ([
    ['{{KNOWN_PATTERNS}}', knownPatternsBlock(state)],
    ['{{DECISIONS}}', decisionsBlock(state)],
    ['{{STATS}}', statsLines(state.rows, state.folded, aliases).join('\n')],
    ['{{TIME}}', sinksBlock(state.rows, 'ms', state.loops, state.folded)],
    ['{{CONTEXT}}', sinksBlock(state.rows, 'chars', [], state.folded)],
    ['{{AGENTS}}', agentsBlock(state, aliases)],
    ['{{TURNS}}', turnsBlock(state)],
    ['{{LEDGER}}', ledgerBlock(state, aliases)],
    ['{{LANGUAGE}}\n\n', directive === '' ? '' : `${directive}\n\n`],
  ] as const).reduce((text, [placeholder, value]) => text.split(placeholder).join(value), JUDGE_PROMPT)
}

const ID_SHAPE = /^[a-z-]+:[a-z0-9-]{1,40}$/

// A slug naming the thing as the work spells it (`multi-agent:C6-review-rounds`) is the same waste as its
// lowercase self, and case is not a judgement: the slug is lowered before the shape is tested, and the
// finding is stored under the lowered id, so one behaviour keeps one id across runs and sessions.
const lowerSlug = (id: string): string => {
  const at = id.indexOf(':')
  return at < 0 ? id : `${id.slice(0, at)}:${id.slice(at + 1).toLowerCase()}`
}

const unique = (xs: string[]): string[] => [...new Set(xs)]

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' &&
  ['execution', 'reading', 'production', 'behavior', 'communication', 'multi-agent', 'environment', 'process', 'other'].includes(v)

const isArtifactKind = (v: unknown): v is ArtifactKind =>
  typeof v === 'string' && ['claude-md', 'skill', 'agent-brief', 'settings-allow'].includes(v)

const parseObject = (text: string): Record<string, unknown> | null => {
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

// undefined = the key is absent or malformed, or no visible row carries the pair: the finding is discarded.
const signatureOf = (value: unknown, visible: Row[]): Signature | null | undefined => {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const tool = str(value['tool'])
  const key = str(value['key'])
  return visible.some(r => r.tool === tool && r.key === key) ? { tool, key } : undefined
}

const short = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`)

// The model's own text quoted inside a one-line drop reason: whitespace collapsed first, so a
// heredoc key or a multi-line id can never break the one-reason-per-line contract `debugDump` keeps.
const cell = (value: unknown, max: number): string => short(collapseWs(str(value)), max)

const signatureDrop = (value: unknown): string =>
  isRecord(value)
    ? `signature (${cell(value['tool'], 20)}, ${cell(value['key'], 40)}) matches no row`
    : 'signature must be a (tool, key) pair or null'

const AGENT_HANDLE = /^agent:(.+)$/

// Handles that name no single row: a turn of the main loop, or a whole agent loop.
const isWide = (handle: string): boolean => /^turn:\d+$/.test(handle) || AGENT_HANDLE.test(handle)

const handleDrop = (value: unknown, signature: Signature | null): string => {
  const handle = cell(value, 40)
  if (handle.length === 0) return 'evidence handle is not a string'
  if (isWide(handle) && signature !== null) return `evidence ${handle} needs signature null`
  return AGENT_HANDLE.test(handle) ? `evidence ${handle} not in AGENTS` : `evidence ${handle} not in the ledger`
}

// The loop an `agent:<alias>` handle names, under the alias table AGENTS and LEDGER printed — the one the
// prompt was built with, not today's: a judge run takes minutes, and a new agent's first row landing in
// that time (or an old agent's last row falling off ROW_CAP) renumbers every loop the rows never showed.
const loopOf = (state: State, aliases: ReadonlyMap<string, string>, alias: string): Loop | undefined =>
  state.loops.find(l => aliases.get(l.id) === alias)

const handleOf = (value: unknown, state: State, visible: Row[], aliases: ReadonlyMap<string, string>, signature: Signature | null): string | null => {
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
const evidenceOf = (value: unknown, state: State, visible: Row[], aliases: ReadonlyMap<string, string>, signature: Signature | null): string[] | string => {
  if (!Array.isArray(value) || value.length === 0) return 'evidence must be a non-empty array of row ids'
  const handles = value.map(h => handleOf(h, state, visible, aliases, signature))
  const badAt = handles.indexOf(null)
  if (badAt >= 0) return handleDrop(value[badAt], signature)
  return unique(handles.filter((h): h is string => h !== null))
}

const citedLoops = (state: State, evidence: string[]): Loop[] =>
  evidence.flatMap(handle => {
    const agent = AGENT_HANDLE.exec(handle)
    const loop = agent === null ? undefined : state.loops.find(l => l.id === agent[1])
    return loop !== undefined ? [loop] : []
  })

const citedTurns = (state: State, evidence: string[]): number[] =>
  evidence.flatMap(handle => {
    const turn = /^turn:(\d+)$/.exec(handle)
    if (turn !== null) return [Number(turn[1] ?? '')]
    if (AGENT_HANDLE.test(handle)) return citedLoops(state, [handle]).map(l => l.firstTurn)
    const row = state.rows.find(r => r.id === handle)
    return row !== undefined ? [row.turn] : []
  })

const loopTokens = (l: Loop): number => l.tokens.input + l.tokens.cacheCreate + l.tokens.output

// What one avoided loop would have cost when the finding cites loops alone; else the cited turns' answers.
const groundedCap = (state: State, evidence: string[]): number => {
  const loops = citedLoops(state, evidence)
  if (loops.length > 0 && !evidence.some(h => /^turn:\d+$/.test(h))) return Math.floor(median(loops.map(loopTokens)))
  const turns = citedTurns(state, evidence)
  return Math.floor(median(state.turns.filter(t => turns.includes(t.turn)).map(t => t.answerChars)) / 4)
}

const estOf = (value: unknown, state: State, signature: Signature | null, evidence: string[]): number | null => {
  if (signature !== null) return null
  const claimed = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  return Math.min(claimed, groundedCap(state, evidence))
}

const proposalOf = (value: unknown): Proposal | null => {
  if (!isRecord(value)) return null
  const kind = value['kind']
  const title = collapseWs(str(value['title']))
  const body = str(value['body']).trim()
  if (!isArtifactKind(kind) || title.length === 0 || body.length === 0) return null
  if (kind === 'settings-allow' && !/^[A-Za-z][A-Za-z0-9_]*\(.+\)$/.test(body)) return null
  return { kind, title, body }
}

const sameSignature = (a: Signature | null, b: Signature | null): boolean =>
  a !== null && b !== null && a.tool === b.tool && a.key === b.key

const isKept = (state: State, id: string, signature: Signature | null): boolean =>
  state.patterns.some(p =>
    p.decision === 'keep' && (p.id === id || sameSignature(p.signature, signature)))

// A string is the one short reason the finding was dropped; the object is the finding itself.
const findingOf = (value: unknown, state: State, visible: Row[], aliases: ReadonlyMap<string, string>): Finding | string => {
  if (!isRecord(value)) return 'not an object'
  const given = str(value['id'])
  const id = lowerSlug(given)
  const category = value['category']
  const kind = str(value['kind'])
  const why = str(value['why'])
  const alternative = str(value['alternative'])
  const confidence = value['confidence']
  if (!ID_SHAPE.test(id)) return `id ${cell(given, 40) || '(missing)'} is not <category>:<kebab-slug>`
  if (!isCategory(category)) return 'category is not one of the nine'
  if (id.slice(0, id.indexOf(':')) !== category) return `category ${category} does not match the id`
  // The opening words are the language's, and the same string the prompt asked for: a reply in another
  // language is a finding whose first words would never match, so the two are read off one key.
  const prefix = say().judge.kindPrefix
  if (!kind.startsWith(prefix)) return `kind must start with "${prefix}"`
  // A cap missed by a few characters is a sentence that ran long, not a wrong finding: the pane wraps, so it
  // is kept as returned and the run report notes the length. Twice the cap is a different answer, and dropped.
  if (kind.length > KIND_MAX * 2) return `kind is ${kind.length} chars, over twice ${KIND_MAX}`
  if (alternative.length === 0) return 'alternative is empty'
  if (alternative.length > ALTERNATIVE_MAX * 2) return `alternative is ${alternative.length} chars, over twice ${ALTERNATIVE_MAX}`
  if (typeof confidence !== 'number' || confidence < 0.5 || confidence > 1) return 'confidence is not a number in 0.5..1'
  const signature = signatureOf(value['signature'], visible)
  if (signature === undefined) return signatureDrop(value['signature'])
  if (isKept(state, id, signature)) return 'kept this session'
  const evidence = evidenceOf(value['evidence'], state, visible, aliases, signature)
  if (typeof evidence === 'string') return evidence
  if (evidence.length < 2 && !why.includes('intent')) return 'one handle and no stated intent in why'
  return {
    id, category, kind, evidence, signature, why, alternative, confidence,
    estTokensPerTurn: estOf(value['est_tokens_per_turn'], state, signature, evidence),
    proposal: proposalOf(value['proposal']),
  }
}

// Each finding under the label the drop report names it by: its own id, or its place in the reply.
type Reviewed = { label: string; finding: Finding } | { label: string; reason: string }
type Sifted = { findings: Finding[]; dropped: string[] }

const labelOf = (value: unknown, index: number): string => {
  const id = lowerSlug(str(isRecord(value) ? value['id'] : ''))
  return ID_SHAPE.test(id) ? id : `#${index + 1}`
}

const capFindings = (reviewed: readonly Reviewed[]): Sifted =>
  reviewed.reduce<Sifted>((kept, item) => {
    const dropped = (reason: string): Sifted => ({ findings: kept.findings, dropped: [...kept.dropped, `${item.label}: ${reason}`] })
    if (!('finding' in item)) return dropped(item.reason)
    if (kept.findings.length >= MAX_FINDINGS) return dropped(`over MAX_FINDINGS (${MAX_FINDINGS})`)
    if (item.finding.signature === null && kept.findings.filter(k => k.signature === null).length >= MAX_BEHAVIORAL_FINDINGS) {
      return dropped(`over MAX_BEHAVIORAL_FINDINGS (${MAX_BEHAVIORAL_FINDINGS})`)
    }
    if (kept.findings.some(k => k.id === item.finding.id)) return dropped('the reply already reported this id')
    return { findings: [...kept.findings, item.finding], dropped: kept.dropped }
  }, { findings: [], dropped: [] })

const EXPLAIN_MAX = 200   // characters of the judge's `time` and `context` sentences kept; the rest is cut off

// One sentence written for the user: an essay is cut to the sentence's length rather than thrown away,
// because its first 200 characters still say where the time went. Anything but text is nothing to draw.
const explanationOf = (value: unknown): string | null => {
  const text = collapseWs(str(value))
  return text.length > 0 ? short(text, EXPLAIN_MAX) : null
}

// An essay where a sentence was asked for is a prompt problem, so the run report says the cut happened:
// without it a trimmed sentence reads like a sentence the judge chose to end there.
const explanationDrop = (label: string, value: unknown): string[] => {
  const text = collapseWs(str(value))
  return text.length > EXPLAIN_MAX ? [`${label}: ${text.length} chars, trimmed to ${EXPLAIN_MAX}`] : []
}

// The caps a kept finding overran, reported the same way: nothing was cut, so the note is the whole story.
const capNotes = (f: Finding): string[] => [
  ...(f.kind.length > KIND_MAX ? [`${f.id}: kind: ${f.kind.length} chars, over ${KIND_MAX}`] : []),
  ...(f.alternative.length > ALTERNATIVE_MAX ? [`${f.id}: alternative: ${f.alternative.length} chars, over ${ALTERNATIVE_MAX}`] : []),
]

/** What the judge said: the valid findings, the focus, its time and context sentences, one line per drop and per cap a kept finding missed, and how many it returned; never throws. `aliases` must be the table `buildPrompt` printed. */
export const parseReply = (text: string, state: State, aliases: ReadonlyMap<string, string> = judgeAliases(state)): { findings: Finding[]; focus: string | null; time: string | null; context: string | null; dropped: string[]; returned: number } => {
  const root = parseObject(text)
  if (root === null) return { findings: [], focus: null, time: null, context: null, dropped: ['reply was not JSON'], returned: 0 }
  const raw = root['findings']
  const focusText = collapseWs(str(root['focus']))
  const focus = focusText.length > 0 ? focusText : null
  const said = { time: explanationOf(root['time']), context: explanationOf(root['context']) }
  const overlong = [...explanationDrop('time', root['time']), ...explanationDrop('context', root['context'])]
  if (!Array.isArray(raw)) return { findings: [], focus, ...said, dropped: [...overlong, 'findings was not an array'], returned: 0 }
  const visible = state.rows.slice(Math.max(0, state.rows.length - JUDGE_LEDGER_ROWS))
  const reviewed: Reviewed[] = raw.map((value, i) => {
    const label = labelOf(value, i)
    const result = findingOf(value, state, visible, aliases)
    return typeof result === 'string' ? { label, reason: result } : { label, finding: result }
  })
  const sifted = capFindings(reviewed)
  const noted = sifted.findings.flatMap(capNotes)
  return { ...sifted, dropped: [...overlong, ...noted, ...sifted.dropped], focus, ...said, returned: raw.length }
}

const patternOf = (f: Finding): Pattern => ({
  id: f.id, category: f.category, kind: f.kind, signature: f.signature, why: f.why,
  alternative: f.alternative, confidence: f.confidence, proposal: f.proposal,
  estTokensPerTurn: f.estTokensPerTurn, lastDecision: null,
  hits: [...f.evidence], decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0,
})

// The title is the finding's too: a pattern remembered from a session in another language would
// otherwise keep its old words above a `why` and a fix written in the language chosen now.
const updatedWith = (p: Pattern, f: Finding): Pattern => ({
  ...p, kind: f.kind, why: f.why, alternative: f.alternative, proposal: f.proposal, confidence: f.confidence,
  estTokensPerTurn: f.estTokensPerTurn, hits: unique([...p.hits, ...f.evidence]),
})

const hasRecurred = (state: State, p: Pattern, f: Finding): boolean =>
  (p.decision === 'steer' || p.decision === 'kill') && p.decidedAtTurn !== null &&
  citedTurns(state, f.evidence).some(turn => turn > (p.decidedAtTurn ?? 0))

const rank = (p: Pattern): number => (p.decision === null ? 0 : 1000) + p.confidence

// A cited pattern nobody has decided belongs in front of the user, whether the id is new, remembered by
// the store or found by an earlier run: the only undecided pattern that is not news is one already queued.
const isFresh = (state: State, patterns: Pattern[], id: string): boolean =>
  patterns.find(p => p.id === id)?.decision === null && !state.cards.includes(id)

const capPatterns = (patterns: Pattern[]): Pattern[] => {
  if (patterns.length <= MAX_PATTERNS) return patterns
  const dropped = [...patterns]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, patterns.length - MAX_PATTERNS)
    .map(p => p.id)
  return patterns.filter(p => !dropped.includes(p.id))
}

/** Folds findings into the complete registry, naming the fresh, the recurred, and the ids the cap evicted. */
export const merge = (state: State, findings: Finding[]): { patterns: Pattern[]; fresh: string[]; recurred: string[]; evicted: string[] } => {
  const added = findings.filter(f => !state.patterns.some(p => p.id === f.id))
  const patterns = capPatterns([
    ...state.patterns.map(p => {
      const f = findings.find(x => x.id === p.id)
      return f !== undefined ? updatedWith(p, f) : p
    }),
    ...added.map(patternOf),
  ])
  const kept = (id: string): boolean => patterns.some(p => p.id === id)
  const recurred = state.patterns.filter(p => {
    const f = findings.find(x => x.id === p.id)
    return f !== undefined && hasRecurred(state, p, f)
  })
  return {
    patterns,
    fresh: findings.map(f => f.id).filter(id => isFresh(state, patterns, id)),
    recurred: recurred.map(p => p.id).filter(kept),
    // A validated finding the cap pushed out has no card: the shell reports it as dropped, not kept.
    evicted: findings.map(f => f.id).filter(id => !kept(id)),
  }
}
