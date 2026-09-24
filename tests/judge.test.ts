import { describe, expect, test } from 'claude-code/testing'

import { JUDGE_PROMPT, buildPrompt, costOf, judgeAliases, merge, parseReply, shouldRun, spentOf, usageOf } from '../hooks/core/judge'
import { debugDump } from '../hooks/core/patterns'
import { ALTERNATIVE_MAX, JUDGE_MIN_GAP_MS, JUDGE_MIN_NEW_ROWS, KIND_MAX, MAX_PATTERNS } from '../hooks/core/types'
import type { Row } from '../hooks/core/types'
import { judgeFinding } from './fixtures/judge/judgeFinding'
import { judgePattern } from './fixtures/judge/judgePattern'
import { judgeState } from './fixtures/judge/judgeState'
import { rawFinding } from './fixtures/judge/rawFinding'
import { replyText } from './fixtures/judge/replyText'
import { rows } from './fixtures/judge/rows'
import { foldedPair } from './fixtures/patterns/foldedPair'
import { sampleLoop } from './fixtures/spawns/sampleLoop'
import { spawnedState } from './fixtures/spawns/spawnedState'

const SUITE_ID = 'execution:full-suite-after-each-edit'

const behavioural = (id: string): Record<string, unknown> => rawFinding({
  id, category: 'communication', kind: 'Claude keeps restating the plan in turns that make no tool call',
  evidence: ['turn:5', 'turn:6'], signature: null, est_tokens_per_turn: 900,
})

const filler = (seq: number): Row => ({
  seq, id: `toolu_f${seq}`, tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: seq,
  ms: 10, chars: 100, head: '', flags: [], lines: null, paths: [], spawn: null,
})

describe('judge', () => {
  test('shouldRun gates on new tokens, turns, rows and the running flag', ($, _on) => {
    expect(shouldRun(judgeState(), 0)).toBe(true)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, running: true } }), 0)).toBe(false)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, lastAtTokens: 20_000 } }), 0)).toBe(false)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, lastAtTurn: 5 } }), 0)).toBe(false)
    expect(shouldRun(judgeState({ rows: rows.slice(0, 7) }), 0)).toBe(false)
  })

  test('shouldRun demands proportionally more new tokens after a backoff', ($, _on) => {
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, backoff: 1 } }), 0)).toBe(true)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, backoff: 2 } }), 0)).toBe(false)
  })

  // One agentic turn can run for hours: `turn.complete` never fires, so the rows and the clock are the cadence.
  test('shouldRun runs mid-turn on new rows plus a gap, and on neither alone', ($, _on) => {
    const midTurn = (seq: number, backoff = 1) =>
      judgeState({ turn: 1, turns: [], seq, judge: { ...judgeState().judge, backoff } })
    expect(shouldRun(midTurn(JUDGE_MIN_NEW_ROWS), JUDGE_MIN_GAP_MS), 'forty new rows and five minutes').toBe(true)
    expect(shouldRun(midTurn(JUDGE_MIN_NEW_ROWS), JUDGE_MIN_GAP_MS - 1), 'the rows are there, the gap is not').toBe(false)
    expect(shouldRun(midTurn(JUDGE_MIN_NEW_ROWS - 1), JUDGE_MIN_GAP_MS * 9), 'a long quiet turn is no new evidence').toBe(false)
    expect(shouldRun(midTurn(JUDGE_MIN_NEW_ROWS * 2 - 1, 2), JUDGE_MIN_GAP_MS), 'a backoff doubles the rows it wants').toBe(false)
    expect(shouldRun(midTurn(JUDGE_MIN_NEW_ROWS * 2, 2), JUDGE_MIN_GAP_MS)).toBe(true)
    expect(shouldRun({ ...midTurn(JUDGE_MIN_NEW_ROWS), rows: rows.slice(0, 7) }, JUDGE_MIN_GAP_MS), 'a short ledger is judged by nobody').toBe(false)
  })

  test('JUDGE_PROMPT is the Appendix A text with the five placeholders', ($, _on) => {
    expect(JUDGE_PROMPT.startsWith('You are auditing THIS session for wasted context and wasted time.')).toBe(true)
    expect(JUDGE_PROMPT).toContain('{{KNOWN_PATTERNS}}')
    expect(JUDGE_PROMPT).toContain('{{DECISIONS}}')
    expect(JUDGE_PROMPT).toContain('{{STATS}}')
    expect(JUDGE_PROMPT).toContain('{{TURNS}}')
    expect(JUDGE_PROMPT).toContain('{{LEDGER}}')
    expect(JUDGE_PROMPT)
      .toContain('`ms` is wall time and includes any wait on a permission prompt, so a long `ms` alone is not machine cost.')
  })

  test('the Counting rules count work between occurrences, not turns, and the examples show an agent loop', ($, _on) => {
    expect(JUDGE_PROMPT, 'a run after an edit is a decision, in the same turn or a later one')
      .toContain('- Separated by other work. Two occurrences of the same behaviour count as two decisions when at least one other row sits between them')
    expect(JUDGE_PROMPT).toContain('Calls issued together with nothing between them are one batch and count once')
    expect(JUDGE_PROMPT, 'a repeat inside one agent, and across the loops, counts')
      .toContain('- Agents are loops of their own.')
    expect(JUDGE_PROMPT, 'a young ledger keeps a caution band above the gate that lets the judge run')
      .toContain('- Short ledgers. With fewer than about 12 rows or fewer than 4 turns,')
    expect(JUDGE_PROMPT).not.toContain('- Different turns.')
    expect(JUDGE_PROMPT, 'the turn-numbered excuse is gone').not.toContain('turns 1-3')
    expect(JUDGE_PROMPT, 'and no rule, band or example counts by turns alone').not.toContain('across separate turns')
    expect(JUDGE_PROMPT).not.toContain('one turn is one decision')
    expect(JUDGE_PROMPT, 'counting and excusing stay in separate layers')
      .toContain('a run after an edit is a second decision, not a second call in one batch')
    expect(JUDGE_PROMPT).toContain('A finding needs two unexcused occurrences of the same behaviour separated by other work (see Counting)')
    expect(JUDGE_PROMPT, 'the multi-agent cues name the work an agent already did')
      .toContain('the main loop re-reading files or re-running checks an agent\'s rows already covered, after it returned')
    expect(JUDGE_PROMPT, 'and the excuses name the honest re-reads the columns can show')
      .toContain('a re-read whose brief the transcript shows is a review or verification pass')
    expect(JUDGE_PROMPT, 'the brief size the cues ask about is a rendered cell')
      .toContain('/<promptChars>pch')
    expect(JUDGE_PROMPT, 'an example with agent rows')
      .toContain('"kind":"Claude keeps re-reading the files a subagent already read for it"')
    expect(JUDGE_PROMPT, 'citing one row per loop, never four handles from one batch')
      .toContain('"evidence":["r80","r83","r90","r93"]')
    expect(JUDGE_PROMPT, 'and the ledger order that example is read off')
      .toContain('a spawn row lands after the rows it caused')
  })

  test('buildPrompt fills every block, keeping the contract and the five headers', ($, _on) => {
    const prompt = buildPrompt(judgeState({ patterns: [judgePattern({ lastDecision: 'keep' })] }))
    expect(prompt).toContain('"kind": "<one sentence, at most 120 chars, starts \'Claude keeps \'>"')
    expect(prompt).toContain('## KNOWN PATTERNS')
    expect(prompt).toContain('## DECISIONS')
    expect(prompt).toContain('## STATS')
    expect(prompt).toContain('## TURNS')
    expect(prompt).toContain('## LEDGER')
    expect(prompt).toContain('execution:full-suite-after-each-edit | test:bun test | kept in a previous session')
    expect(prompt).toContain('Bash | test:bun test | test | ×3 | Σ180000ms')
    expect(prompt).toContain('r1 | Bash | test:bun test | test | main | 2 | 61000 | 9700 | - | -')
    expect(prompt).toContain('window=200000 overhead: memory=1200')
    expect(prompt).not.toContain('{{')
  })

  test('the prompt asks the three questions, states the ladder and reserves the two sentences', ($, _on) => {
    expect(JUDGE_PROMPT, 'the question the user asked their agent is one of ours now')
      .toContain('Answer four narrow questions. What repeated:')
    expect(JUDGE_PROMPT).toContain('Where the time and the context went:')
    expect(JUDGE_PROMPT).toContain('What is going in circles: the same failing command retried with no diagnostic step between')
    expect(JUDGE_PROMPT, 'the ladder from nothing to a finding')
      .toContain('- The legitimacy ladder. A sink needed once is nothing, however large.')
    expect(JUDGE_PROMPT).toContain('is a finding, and the excuse you considered is written into `why`.')
    expect(JUDGE_PROMPT, 'and one long call, needed once, is never one')
      .toContain('- A single long call that was needed once, however long it ran:')
    expect(JUDGE_PROMPT).toContain('{{TIME}}')
    expect(JUDGE_PROMPT).toContain('{{CONTEXT}}')
    expect(JUDGE_PROMPT).toContain('"time": "<one sentence, at most 200 chars: where the wall-clock went>"')
    expect(JUDGE_PROMPT).toContain('"context": "<one sentence, at most 200 chars: where the context went>"')
    expect(JUDGE_PROMPT, 'the explanation is neutral, so it is not a finding by itself')
      .toContain('Neither is an accusation and neither is a finding by itself')
    expect(JUDGE_PROMPT, 'and the examples that leave the two sentences out say so, since a few-shot beats prose')
      .toContain('the examples below leave them out where they are not the point, your reply never does.')
    expect(JUDGE_PROMPT, 'the spawn sink is quoted as the renderer prints it, with no share of a total it is not in')
      .toContain('`agents | ×3 | Σ2100000ms | apart` above them in TIME')
    expect(JUDGE_PROMPT, 'a long legitimate session answers with the sentences and no findings')
      .toContain('"findings":[]}` — a long session is not a wasteful one.')
    expect(JUDGE_PROMPT).toContain('— every repeat had changed inputs, so the ladder stops at nothing.')
  })

  test('buildPrompt states where the wall-clock and the context went', ($, _on) => {
    const prompt = buildPrompt(judgeState())
    expect(prompt).toContain('## TIME — where the wall-clock went.')
    expect(prompt).toContain('## CONTEXT — where the context went.')
    expect(prompt, 'the total leaves the spawn rows out, since they hold their own loops rows, so they get no share of it')
      .toContain('total Σ183360ms\ntests | ×3 | Σ180000ms | 98%\nagents | ×1 | Σ30000ms | apart\nreads | ×2 | Σ3040ms | 2%')
    expect(prompt, 'the longest rows are named so the sinks can be read back to single calls')
      .toContain('largest rows:\nr1 | Bash | test:bun test | Σ61000ms')
    expect(prompt).toContain('total Σ76160ch\nreads | ×2 | Σ46200ch | 61%\ntests | ×3 | Σ29400ch | 39%')
    expect(prompt).toContain('r5 | Bash | read:docker compose logs api --tail 2000 | Σ41000ch')
    expect(prompt).not.toContain('{{')
  })

  test('the LEDGER header names the loops the agent column holds', ($, _on) => {
    const prompt = buildPrompt(judgeState())
    expect(JUDGE_PROMPT).toContain(' Agents are named `a1`, `a2`… in order of first appearance; `main` is the main loop.')
    expect(prompt, 'the row the subagent ran reads the alias the header explains')
      .toContain('r8 | Edit | /src/token.ts | other | a1 | 7 |')
    expect(prompt, 'no raw agent id is ever quoted to the judge').not.toContain('agent-1')
  })

  test('buildPrompt folds the rows past the ledger window into summary lines', ($, _on) => {
    const prompt = buildPrompt(judgeState({ rows: Array.from({ length: 160 }, (_, i) => filler(i + 1)) }))
    expect(prompt).toContain('~ | Bash | test:bun test | ×10 | Σ1000ch')
  })

  test('buildPrompt counts the rows the cap dropped and says what a waits line is', ($, _on) => {
    expect(JUDGE_PROMPT, 'the STATS heading names the line, the two figures on it, and that it cannot be cited')
      .toContain('then `waits:` — every AskUserQuestion this session, its total wait and how many carried a recommended default; not citable, but the time it held the session is a fact to explain.')
    const prompt = buildPrompt(judgeState({ folded: { 'Bash\ttest:bun test': foldedPair({ count: 40, ms: 2_400_000, chars: 400_000 }) } }))
    expect(prompt, 'the pair reads forty-three runs, not the three the ledger still holds')
      .toContain('Bash | test:bun test | test | ×43 | Σ2580000ms | Σ429400ch | turns 1-6')
    expect(prompt, 'and the context total counts what it can no longer show').toContain('total Σ476160ch')
    expect(prompt, 'while the rows it offers as evidence are still the window\'s own').toContain('largest rows:\nr5 | Bash')
    expect(prompt, 'the folded pair is summarised in the ledger too').toContain('~ | Bash | test:bun test | ×40 | Σ400000ch')
  })

  test('parseReply reads a valid reply and maps aliases to tool_use_ids', ($, _on) => {
    const parsed = parseReply(replyText([rawFinding()]), judgeState())
    expect(parsed.focus).toBe('fixing the auth token refresh in /src/auth.ts')
    expect(parsed.findings.length).toBe(1)
    expect(parsed.findings[0]?.evidence).toEqual(['toolu_03', 'toolu_06'])
    expect(parsed.findings[0]?.signature).toEqual({ tool: 'Bash', key: 'test:bun test' })
    expect(parsed.findings[0]?.estTokensPerTurn).toBe(null)
  })

  test('parseReply survives prose around the object and broken JSON', ($, _on) => {
    const wrapped = `Here is what I found.\n\n${replyText([rawFinding()])}\n\nHope that helps.`
    expect(parseReply(wrapped, judgeState()).findings.length).toBe(1)
    expect(parseReply('{"focus": "x", "findings": [', judgeState()))
      .toEqual({ findings: [], focus: null, time: null, context: null, dropped: ['reply was not JSON'], returned: 0 })
    expect(parseReply('no json at all', judgeState()))
      .toEqual({ findings: [], focus: null, time: null, context: null, dropped: ['reply was not JSON'], returned: 0 })
  })

  test('parseReply keeps the time and context sentences and refuses an essay', ($, _on) => {
    const said = JSON.stringify({
      focus: 'a proxy rewrite in four chunks',
      time: '45 min per chunk: the full proxy suite runs after every fix round and each chunk gets two review rounds.',
      context: '  310k chars,\n over half of it three reads of the same generated client. ',
      findings: [],
    })
    const parsed = parseReply(said, judgeState())
    expect(parsed.time).toBe('45 min per chunk: the full proxy suite runs after every fix round and each chunk gets two review rounds.')
    expect(parsed.context, 'one line, whatever the model wrapped it as')
      .toBe('310k chars, over half of it three reads of the same generated client.')
    const bad = JSON.stringify({ focus: 'x', time: 'x'.repeat(201), context: 42, findings: [] })
    expect(parseReply(bad, judgeState()), 'an essay is cut to a sentence; a number is no sentence at all')
      .toMatchObject({ time: `${'x'.repeat(200)}…`, context: null })
    expect(parseReply(bad, judgeState()).dropped, 'and the run report says it was cut, so a prompt problem is not a quiet session')
      .toEqual(['time: 201 chars, trimmed to 200'])
    expect(parseReply(replyText([]), judgeState()), 'a reply that said nothing about them says nothing')
      .toMatchObject({ time: null, context: null })
  })

  test('parseReply reports one reason per dropped finding, so silence is readable', ($, _on) => {
    const reason = (reply: string, state = judgeState()): string[] => parseReply(reply, state).dropped
    expect(reason(replyText([rawFinding({ evidence: ['r3', 'r99'] })])))
      .toEqual([`${SUITE_ID}: evidence r99 not in the ledger`])
    expect(reason(replyText([rawFinding({ signature: { tool: 'Read', key: 'test:bun test' } })])))
      .toEqual([`${SUITE_ID}: signature (Read, test:bun test) matches no row`])
    expect(reason(replyText([rawFinding({ kind: 'Runs the suite again' })])))
      .toEqual([`${SUITE_ID}: kind must start with "Claude keeps "`])
    expect(reason(replyText([rawFinding({ id: 'Execution:X' })])), 'an id we cannot trust is labelled by its place')
      .toEqual(['#1: id Execution:X is not <category>:<kebab-slug>'])
    expect(reason(replyText([rawFinding({ evidence: ['r3', 'turn:5'] })])))
      .toEqual([`${SUITE_ID}: evidence turn:5 needs signature null`])
    const kept = judgeState({ patterns: [judgePattern({ decision: 'keep', decidedAtTurn: 4 })] })
    expect(reason(replyText([rawFinding({ id: 'execution:suite-every-step' })]), kept))
      .toEqual(['execution:suite-every-step: kept this session'])
    const many = Array.from({ length: 8 }, (_, i) => rawFinding({ id: `execution:suite-${i + 1}` }))
    expect(reason(replyText(many)), 'the seventh and the eighth are over the ceiling')
      .toEqual(['execution:suite-7: over MAX_FINDINGS (6)', 'execution:suite-8: over MAX_FINDINGS (6)'])
    expect(reason(JSON.stringify({ focus: 'x', findings: 'none' }))).toEqual(['findings was not an array'])
    expect(parseReply(replyText([rawFinding()]), judgeState()).dropped, 'a clean reply drops nothing').toEqual([])
    expect(parseReply(replyText(many), judgeState()).returned, 'returned is what the reply carried, not what survived').toBe(8)
    expect(parseReply(JSON.stringify({ focus: 'x' }), judgeState()), 'a reply with no findings key returned none of them')
      .toEqual({ findings: [], focus: 'x', time: null, context: null, dropped: ['findings was not an array'], returned: 0 })
  })

  test('a reason quoting a multi-line key stays one line, so /saver debug keeps its forty', ($, _on) => {
    const heredoc = { tool: 'Bash', key: 'other:cat <<EOF\nline one\nline two\nEOF' }
    const six = Array.from({ length: 6 }, (_, i) => rawFinding({ id: `execution:heredoc-${i + 1}`, signature: heredoc }))
    const dropped = parseReply(replyText(six), judgeState()).dropped
    expect(dropped[0]).toBe('execution:heredoc-1: signature (Bash, other:cat <<EOF line one line two EOF) matches no row')
    expect(dropped.some(text => text.includes('\n')), 'no reason carries a newline').toBe(false)
    const crowded = judgeState({
      patterns: Array.from({ length: 60 }, (_, i) => judgePattern({ id: `execution:waster-${i + 1}` })),
      judge: { ...judgeState().judge, last: { returned: 6, kept: 0, dropped, usage: { input: 900, output: 300, cacheRead: 0, cacheCreate: 96_000 } } },
    })
    expect(debugDump(crowded).split('\n').length, 'the 40-line contract holds with six such reasons in it')
      .toBeLessThanOrEqual(40)
  })

  test('parseReply discards a finding citing an alias no row carries', ($, _on) => {
    expect(parseReply(replyText([rawFinding({ evidence: ['r3', 'r99'] })]), judgeState()).findings).toEqual([])
  })

  test('parseReply discards a completed key and a tool the key never ran under', ($, _on) => {
    const completed = rawFinding({ signature: { tool: 'Bash', key: 'test:bun test --coverage' } })
    expect(parseReply(replyText([completed]), judgeState()).findings).toEqual([])
    const mismatch = rawFinding({ signature: { tool: 'Read', key: 'test:bun test' } })
    expect(parseReply(replyText([mismatch]), judgeState()).findings).toEqual([])
  })

  test('parseReply clamps an over-large estimate to the cited turns and nulls it under a signature', ($, _on) => {
    const big = behavioural('communication:restates-plan-each-turn')
    expect(parseReply(replyText([{ ...big, est_tokens_per_turn: 99_999 }]), judgeState()).findings[0]?.estTokensPerTurn)
      .toBe(1437)
    expect(parseReply(replyText([{ ...big, est_tokens_per_turn: 900 }]), judgeState()).findings[0]?.estTokensPerTurn)
      .toBe(900)
    const signed = rawFinding({ est_tokens_per_turn: 900 })
    expect(parseReply(replyText([signed]), judgeState()).findings[0]?.estTokensPerTurn).toBe(null)
  })

  test('parseReply keeps a permission rule as a proposal and drops a prose one', ($, _on) => {
    const rule = { kind: 'settings-allow', title: 'Allow the test suite', body: 'Bash(bun test:*)' }
    expect(parseReply(replyText([rawFinding({ proposal: rule })]), judgeState()).findings[0]?.proposal).toEqual(rule)
    const prose = { kind: 'settings-allow', title: 'Allow the test suite', body: 'let Claude run the test suite' }
    expect(parseReply(replyText([rawFinding({ proposal: prose })]), judgeState()).findings[0]?.proposal).toBe(null)
  })

  test('parseReply drops a kept key reported under a new id', ($, _on) => {
    const kept = judgeState({ patterns: [judgePattern({ decision: 'keep', decidedAtTurn: 4 })] })
    const renamed = rawFinding({ id: 'execution:suite-every-step', category: 'execution' })
    expect(parseReply(replyText([renamed]), kept).findings).toEqual([])
  })

  test('parseReply keeps at most six findings and three behavioural ones', ($, _on) => {
    const many = Array.from({ length: 8 }, (_, i) => rawFinding({ id: `execution:suite-${i + 1}` }))
    expect(parseReply(replyText(many), judgeState()).findings.length).toBe(6)
    const four = [
      behavioural('communication:restates-plan'),
      behavioural('communication:recaps-finished-work'),
      behavioural('communication:asks-what-it-knows'),
      behavioural('communication:explains-the-obvious'),
      rawFinding(),
    ]
    const parsed = parseReply(replyText(four), judgeState())
    expect(parsed.findings.map(f => f.id), 'agent findings are signature-null too, so the ceiling is three').toEqual([
      'communication:restates-plan', 'communication:recaps-finished-work', 'communication:asks-what-it-knows',
      'execution:full-suite-after-each-edit',
    ])
    expect(parsed.dropped).toEqual(['communication:explains-the-obvious: over MAX_BEHAVIORAL_FINDINGS (3)'])
  })

  test('the prompt asks the proportion question, names the AGENTS block and cites loops as agent handles', ($, _on) => {
    expect(JUDGE_PROMPT).toContain('What was out of proportion: which spawned work — an agent, a workflow stage, a review or verification round — cost far more than what it produced')
    expect(JUDGE_PROMPT).toContain('or `agent:<alias>` where `<alias>` is an `alias` printed in AGENTS — turn and agent handles only for findings whose `signature` is null.')
    expect(JUDGE_PROMPT).toContain('at most three with `signature: null`')
    expect(JUDGE_PROMPT, 'breadth is one decision, weight is judged').toContain('Breadth is one decision; weight is not: every stage of a workflow (each `label` in AGENTS) is a decision of its own')
    expect(JUDGE_PROMPT).toContain('a loop whose rows are only checks that passed, with `edits 0` and a report as its outcome (AGENTS `checks` > 0) — a shell step given a model')
    expect(JUDGE_PROMPT).toContain('one review per stage that found a medium or higher; a loop that edited; a fan-out\'s breadth on its own.')
    expect(JUDGE_PROMPT).toContain('an `ask` row that held the turn for minutes while no agent ran')
    expect(JUDGE_PROMPT).toContain('a question whose answer the transcript shows changed the plan.')
    expect(JUDGE_PROMPT).toContain('- Parallelism: calls issued together with nothing between them are one decision, and agents on disjoint scopes launched at once are one decision — one, not none: their weight is judged under multi-agent.')
    expect(JUDGE_PROMPT).toContain('For agent handles it is the tokens one avoided loop would have cost, grounded in AGENTS `tok`, conservative end.')
    expect(JUDGE_PROMPT).toContain('"id":"multi-agent:check-loops-for-shell-steps"')
    expect(JUDGE_PROMPT).toContain('"id":"multi-agent:review-rounds-that-find-only-lows"')
    expect(JUDGE_PROMPT).toContain('## AGENTS — the loops this session spawned.')
    expect(JUDGE_PROMPT).toContain('{{AGENTS}}\n\n## TURNS')
    expect(JUDGE_PROMPT).toContain('then `| aborted`, `| error` or `| refusal` when the turn ended that way and `| idle <m>m` when the next prompt came a minute or more later')
    expect(JUDGE_PROMPT).toContain('`ask` (an AskUserQuestion: its `ms` is the wait for the person) `recommended` (its options named a default)')
    const prompt = buildPrompt(spawnedState())
    expect(prompt).toContain('## AGENTS')
    expect(prompt).toContain('\na2 | proxy-rewrite | check:C3 | sonnet | 1 | 1.7m | 48k | edits 0 | checks 4 | reads 0 | report 1600ch | answer\n')
    expect(prompt, 'the agents sink is the loops\' time').toContain('agents | ×4 | Σ492000ms | apart')
    expect(prompt).not.toContain('{{')
  })

  test('parseReply accepts agent handles under a null signature, stored by loop id, and caps the estimate on their tokens', ($, _on) => {
    const shellStep = (over: Record<string, unknown> = {}): Record<string, unknown> => rawFinding({
      id: 'multi-agent:check-loops-for-shell-steps', category: 'multi-agent',
      kind: 'Claude keeps spawning an agent per chunk whose only job is to run passing checks',
      evidence: ['agent:a2', 'agent:a4'], signature: null, est_tokens_per_turn: 48_000, ...over,
    })
    const parsed = parseReply(replyText([shellStep()]), spawnedState())
    expect(parsed.findings[0]?.evidence, 'the alias is a naming; the hit is the id').toEqual(['agent:agent-2', 'agent:agent-4'])
    expect(parsed.findings[0]?.estTokensPerTurn, 'the median of the cited loops\' new tokens: 48k and 12k').toBe(30_000)
    expect(parseReply(replyText([shellStep({ est_tokens_per_turn: 9_000 })]), spawnedState()).findings[0]?.estTokensPerTurn).toBe(9_000)
    const mixed = parseReply(replyText([shellStep({ evidence: ['agent:a2', 'turn:5'], est_tokens_per_turn: 48_000 })]), spawnedState())
    expect(mixed.findings[0]?.estTokensPerTurn, 'with a turn handle beside it the cap is the turns\', as before').toBe(1_350)
    const reason = (over: Record<string, unknown>): string[] => parseReply(replyText([shellStep(over)]), spawnedState()).dropped
    expect(reason({ evidence: ['agent:a2', 'agent:a9'] })).toEqual(['multi-agent:check-loops-for-shell-steps: evidence agent:a9 not in AGENTS'])
    expect(reason({ evidence: ['agent:a2', 'r3'], signature: { tool: 'Bash', key: 'test:bun test' } }))
      .toEqual(['multi-agent:check-loops-for-shell-steps: evidence agent:a2 needs signature null'])
    expect(reason({ evidence: ['agent:agent-2', 'agent:agent-4'] }), 'the raw id is not a handle the blocks printed')
      .toEqual(['multi-agent:check-loops-for-shell-steps: evidence agent:agent-2 not in AGENTS'])
    expect(parseReply(replyText([shellStep()]), judgeState()).findings, 'no loops, no agent handles').toEqual([])
  })

  test('parseReply reads agent handles under the alias table the prompt printed, not the one the rows grew into', ($, _on) => {
    const before = spawnedState()
    const aliases = judgeAliases(before)
    expect(buildPrompt(before, aliases), 'a4 is the loose explore loop no row ever showed').toContain('\na4 | - | explore src | sonnet |')
    // While the judge thought, a new agent's first row landed: it is named by the rows now, ahead of every loop-only alias.
    const late: Row = {
      seq: 14, id: 'toolu_14', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'agent-5', turn: 9,
      ms: 5_000, chars: 300, head: 'PASS', flags: [], lines: null, paths: [], spawn: null,
    }
    const after = spawnedState({ seq: 14, rows: [...before.rows, late], loops: [...before.loops, sampleLoop({ id: 'agent-5', run: null, label: null, firstTurn: 9, firstSeq: 14 })] })
    expect(judgeAliases(after).get('agent-4'), 'the live table has renumbered the loop').toBe('a5')
    const finding = rawFinding({
      id: 'multi-agent:check-loops-for-shell-steps', category: 'multi-agent',
      kind: 'Claude keeps spawning an agent per chunk whose only job is to run passing checks',
      evidence: ['agent:a2', 'agent:a4'], signature: null, est_tokens_per_turn: 48_000,
    })
    expect(parseReply(replyText([finding]), after, aliases).findings[0]?.evidence, 'the reply names what the prompt showed')
      .toEqual(['agent:agent-2', 'agent:agent-4'])
    expect(parseReply(replyText([finding]), after, aliases).findings[0]?.estTokensPerTurn, 'and the cap is taken over those loops: 48k and 12k').toBe(30_000)
  })

  test('merge dates an agent handle by the turn its loop was spawned in', ($, _on) => {
    const killed = (turn: number) => spawnedState({
      patterns: [judgePattern({
        id: 'multi-agent:check-loops-for-shell-steps', category: 'multi-agent', signature: null,
        decision: 'kill', decidedAtTurn: turn, openedAtTurn: turn, instruction: 'run checks as a shell step',
      })],
    })
    const finding = judgeFinding({
      id: 'multi-agent:check-loops-for-shell-steps', category: 'multi-agent', signature: null,
      evidence: ['agent:agent-2', 'agent:agent-4'],
    })
    expect(merge(killed(7), [finding]).recurred, 'a2 was spawned at turn 8, after the kill at 7').toEqual(['multi-agent:check-loops-for-shell-steps'])
    expect(merge(killed(9), [finding]).recurred).toEqual([])
  })

  test('merge reuses a known id, extending its hits and refreshing its text', ($, _on) => {
    const state = judgeState({ patterns: [judgePattern()] })
    const kind = 'Claude continue de relancer toute la suite après chaque modification'
    const result = merge(state, [judgeFinding({ kind, why: 'three runs, nothing shared changed' })])
    expect(result.patterns.length).toBe(1)
    expect(result.patterns[0]?.hits).toEqual(['toolu_01', 'toolu_03', 'toolu_06'])
    expect(result.patterns[0]?.why).toBe('three runs, nothing shared changed')
    expect(result.patterns[0]?.kind, 'a pattern remembered in English reads in the language chosen now').toBe(kind)
    expect(result.fresh, 'nobody has decided it, so the re-report is a card again').toEqual([SUITE_ID])
    expect(result.recurred).toEqual([])
  })

  // A reload leaves the registry holding what an earlier run found: without this the judge returns two
  // patterns, keeps two and shows none, and `/saver debug` reads `2 returned · 2 kept · cards 0`.
  test('merge queues a known pattern nobody has decided, unless its card is already up', ($, _on) => {
    const known = judgeState({ patterns: [judgePattern()] })
    expect(merge(known, [judgeFinding()]).fresh, 'found earlier, still undecided, cited again').toEqual([SUITE_ID])
    const queued = judgeState({ patterns: [judgePattern()], cards: [SUITE_ID] })
    expect(merge(queued, [judgeFinding()]).fresh, 'the card is in front of the user already').toEqual([])
    const decided = judgeState({ patterns: [judgePattern({ decision: 'keep', decidedAtTurn: 3 })] })
    expect(merge(decided, [judgeFinding()]).fresh, 'a decision is not undone by another sighting').toEqual([])
  })

  test('merge makes a new id fresh with the cited handles only', ($, _on) => {
    const result = merge(judgeState(), [judgeFinding()])
    expect(result.fresh).toEqual(['execution:full-suite-after-each-edit'])
    expect(result.patterns[0]?.hits).toEqual(['toolu_03', 'toolu_06'])
    expect(result.patterns[0]?.decision).toBe(null)
  })

  test('merge reports a recurrence only for rows after the decision', ($, _on) => {
    const steered = (turn: number) => judgeState({ patterns: [judgePattern({ decision: 'steer', decidedAtTurn: turn, instruction: 'do it at the end' })] })
    expect(merge(steered(3), [judgeFinding()]).recurred).toEqual(['execution:full-suite-after-each-edit'])
    expect(merge(steered(9), [judgeFinding()]).recurred).toEqual([])
  })

  test('merge preserves the session fields of a decided pattern', ($, _on) => {
    const state = judgeState({
      patterns: [
        judgePattern({ decision: 'kill', decidedAtTurn: 5, instruction: 'stop that', openedAtTurn: 5, ignored: 1, lastDecision: 'kill' }),
        judgePattern({ id: 'reading:log-dump', signature: null, decision: 'keep', decidedAtTurn: 2 }),
      ],
    })
    const result = merge(state, [judgeFinding()])
    expect(result.patterns.map(p => p.id)).toEqual(['execution:full-suite-after-each-edit', 'reading:log-dump'])
    expect(result.patterns[0]).toMatchObject({ decision: 'kill', decidedAtTurn: 5, instruction: 'stop that', openedAtTurn: 5, ignored: 1 })
    expect(result.patterns[1]?.decision).toBe('keep')
  })

  test('merge caps the registry, dropping the least confident undecided pattern first', ($, _on) => {
    const patterns = Array.from({ length: MAX_PATTERNS }, (_, i) =>
      judgePattern({ id: `execution:known-${i + 1}`, confidence: i === 0 ? 0.5 : 0.9, signature: null }))
    const state = judgeState({ patterns: [...patterns.slice(1), judgePattern({ id: 'execution:known-1', confidence: 0.5, signature: null, decision: 'keep', decidedAtTurn: 2 })] })
    const result = merge(state, [judgeFinding()])
    expect(result.patterns.length).toBe(MAX_PATTERNS)
    expect(result.patterns.map(p => p.id)).toContain('execution:known-1')
    expect(result.patterns.map(p => p.id)).toContain('execution:full-suite-after-each-edit')
    expect(result.fresh).toEqual(['execution:full-suite-after-each-edit'])
    expect(result.evicted, 'the finding itself survived the cap').toEqual([])
  })

  test('merge names the finding the cap evicted, since it will never be a card', ($, _on) => {
    const patterns = Array.from({ length: MAX_PATTERNS }, (_, i) =>
      judgePattern({ id: `execution:known-${i + 1}`, confidence: 0.99, signature: null, decision: 'keep', decidedAtTurn: 2 }))
    const result = merge(judgeState({ patterns }), [judgeFinding()])
    expect(result.patterns.length).toBe(MAX_PATTERNS)
    expect(result.fresh, 'a pattern the registry no longer carries is not fresh').toEqual([])
    expect(result.evicted).toEqual(['execution:full-suite-after-each-edit'])
  })

  test('parseReply needs two handles unless why names the stated intent', ($, _on) => {
    expect(parseReply(replyText([rawFinding({ evidence: ['r3'] })]), judgeState()).findings).toEqual([])
    const intent = rawFinding({ evidence: ['r3'], why: 'one run plus the stated intent to re-run the suite after each fix' })
    expect(parseReply(replyText([intent]), judgeState()).findings.length).toBe(1)
  })

  test('parseReply drops a malformed id, category, kind, alternative or confidence', ($, _on) => {
    const broken: Record<string, unknown>[] = [
      { id: 'Execution:X' },
      { id: 'reading:foo', category: 'execution' },
      { kind: 'Runs the suite again' },
      { kind: `Claude keeps ${'x'.repeat(KIND_MAX * 2)}` },
      { alternative: '' },
      { alternative: 'x'.repeat(ALTERNATIVE_MAX * 2 + 1) },
      { confidence: 0.4 },
      { confidence: 1.2 },
    ]
    broken.forEach(over => expect(parseReply(replyText([rawFinding(over)]), judgeState()).findings).toEqual([]))
  })

  // A model cannot count characters; a cap it misses by ten should cost a note, not the finding.
  test('parseReply keeps a finding that ran over the kind or fix cap and notes the length', ($, _on) => {
    const over = rawFinding({ kind: `Claude keeps ${'x'.repeat(KIND_MAX - 2)}`, alternative: 'x'.repeat(ALTERNATIVE_MAX + 6) })
    const parsed = parseReply(replyText([over]), judgeState())
    expect(parsed.findings[0]?.kind.length, 'kept as it came: the pane wraps, so nothing is cut').toBe(KIND_MAX + 11)
    expect(parsed.findings[0]?.alternative.length).toBe(ALTERNATIVE_MAX + 6)
    expect(parsed.dropped, 'and the run report says both caps were missed, as it says a sentence was trimmed').toEqual([
      `${SUITE_ID}: kind: ${KIND_MAX + 11} chars, over ${KIND_MAX}`,
      `${SUITE_ID}: alternative: ${ALTERNATIVE_MAX + 6} chars, over ${ALTERNATIVE_MAX}`,
    ])
    const twice = parseReply(replyText([rawFinding({ kind: `Claude keeps ${'x'.repeat(KIND_MAX * 2)}` })]), judgeState())
    expect(twice.findings, 'twice the cap is another kind of answer, not a miss').toEqual([])
    expect(twice.dropped).toEqual([`${SUITE_ID}: kind is ${KIND_MAX * 2 + 13} chars, over twice ${KIND_MAX}`])
  })

  test('parseReply lowercases the id slug a model typed in the work\'s own spelling', ($, _on) => {
    const chunk = parseReply(replyText([rawFinding({ id: 'execution:C6-suite-after-every-fix' })]), judgeState())
    expect(chunk.findings[0]?.id, 'one behaviour keeps one id, whatever the case of the chunk it names')
      .toBe('execution:c6-suite-after-every-fix')
    expect(chunk.dropped, 'nothing to report: the id was usable').toEqual([])
    expect(parseReply(replyText([rawFinding({ id: 'Execution:C6' })]), judgeState()).findings,
      'the category is an enum, not a slug: its case is not ours to fold').toEqual([])
  })

  test('parseReply nulls an unusable proposal but keeps the finding', ($, _on) => {
    const parsed = parseReply(replyText([rawFinding({ proposal: { kind: 'bogus', title: 't', body: 'b' } })]), judgeState())
    expect(parsed.findings.length).toBe(1)
    expect(parsed.findings[0]?.proposal).toBe(null)
  })

  test('parseReply keeps the first finding when one reply repeats an id', ($, _on) => {
    const twice = [rawFinding(), rawFinding({ why: 'the same behaviour reported twice in one reply' })]
    const parsed = parseReply(replyText(twice), judgeState())
    expect(parsed.findings.map(f => f.id)).toEqual(['execution:full-suite-after-each-edit'])
    expect(parsed.findings[0]?.why).toBe(rawFinding()['why'])
  })

  test('parseReply reads a missing estimate as zero and a missing signature as malformed', ($, _on) => {
    const noEstimate = behavioural('communication:restates-plan-each-turn')
    delete noEstimate['est_tokens_per_turn']
    expect(parseReply(replyText([noEstimate]), judgeState()).findings[0]?.estTokensPerTurn).toBe(0)
    const noSignature = rawFinding()
    delete noSignature['signature']
    expect(parseReply(replyText([noSignature]), judgeState()).findings).toEqual([])
  })

  test('parseReply discards a signature finding that also cites a turn handle', ($, _on) => {
    expect(parseReply(replyText([rawFinding({ evidence: ['r3', 'r6', 'turn:5'] })]), judgeState()).findings).toEqual([])
  })

  test('parseReply refuses an alias and a key that exist only in the folded prefix', ($, _on) => {
    const older = Array.from({ length: 10 }, (_, i) => ({ ...filler(i + 1), key: 'read:cat old.md', cls: 'read' as const }))
    const state = judgeState({ rows: [...older, ...Array.from({ length: 150 }, (_, i) => filler(i + 11))] })
    expect(parseReply(replyText([rawFinding({ evidence: ['r7', 'r20'] })]), state).findings).toEqual([])
    const foldedKey = rawFinding({ evidence: ['r20', 'r30'], signature: { tool: 'Bash', key: 'read:cat old.md' } })
    expect(parseReply(replyText([foldedKey]), state).findings).toEqual([])
    expect(parseReply(replyText([rawFinding({ evidence: ['r20', 'r30'] })]), state).findings.length).toBe(1)
  })

  test('parseReply drops a finding reusing the id of a pattern kept this session', ($, _on) => {
    const kept = judgeState({
      patterns: [judgePattern({ id: 'reading:log-dump', category: 'reading', signature: null, decision: 'keep', decidedAtTurn: 4 })],
    })
    const again = rawFinding({
      id: 'reading:log-dump', category: 'reading', signature: null, evidence: ['turn:5', 'turn:6'],
      alternative: 'Grep the log for the error instead of dumping every line.',
      proposal: { kind: 'claude-md', title: 'Grep logs', body: 'Grep logs instead of dumping them.' },
    })
    expect(parseReply(replyText([again]), kept).findings).toEqual([])
    const merged = merge(kept, parseReply(replyText([again]), kept).findings)
    expect(merged.patterns[0]?.alternative).toBe(judgePattern().alternative)
    expect(merged.patterns[0]?.proposal).toBe(null)
  })

  test('merge reports a behavioural recurrence cited by turn handles', ($, _on) => {
    const killed = (turn: number) => judgeState({
      patterns: [judgePattern({
        id: 'communication:restates-plan-each-turn', category: 'communication', signature: null,
        decision: 'kill', decidedAtTurn: turn, openedAtTurn: turn, instruction: 'stop restating the plan',
      })],
    })
    const finding = judgeFinding({
      id: 'communication:restates-plan-each-turn', category: 'communication', signature: null,
      evidence: ['turn:13', 'turn:15'],
    })
    expect(merge(killed(10), [finding]).recurred).toEqual(['communication:restates-plan-each-turn'])
    expect(merge(killed(20), [finding]).recurred).toEqual([])
  })

  test('costOf charges input, output and cache creation but not cache reads', ($, _on) => {
    expect(costOf({ input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 200 }))
      .toBe(1500)
  })

  test('usageOf keeps all four counts, so a cold fork can be told from a warm one', ($, _on) => {
    const usage = usageOf({ input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 200 })
    expect(usage, 'the API names on the left, ours on the right').toEqual({ input: 1000, output: 300, cacheRead: 90_000, cacheCreate: 200 })
    expect(spentOf(usage), 'a read cache is free; the one we created is not').toBe(1500)
  })
})
