import { describe, expect, test } from 'claude-code/testing'

import { JUDGE_PROMPT, buildPrompt, costOf, merge, parseReply, shouldRun } from '../hooks/core/judge'
import { MAX_PATTERNS } from '../hooks/core/types'
import type { Row } from '../hooks/core/types'
import { judgeFinding } from './fixtures/judge/judgeFinding'
import { judgePattern } from './fixtures/judge/judgePattern'
import { judgeState } from './fixtures/judge/judgeState'
import { rawFinding } from './fixtures/judge/rawFinding'
import { replyText } from './fixtures/judge/replyText'
import { rows } from './fixtures/judge/rows'

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
    expect(shouldRun(judgeState())).toBe(true)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, running: true } }))).toBe(false)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, lastAtTokens: 20_000 } }))).toBe(false)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, lastAtTurn: 5 } }))).toBe(false)
    expect(shouldRun(judgeState({ rows: rows.slice(0, 7) }))).toBe(false)
  })

  test('shouldRun demands proportionally more new tokens after a backoff', ($, _on) => {
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, backoff: 1 } }))).toBe(true)
    expect(shouldRun(judgeState({ judge: { ...judgeState().judge, backoff: 2 } }))).toBe(false)
  })

  test('JUDGE_PROMPT is the Appendix A text with the five placeholders', ($, _on) => {
    expect(JUDGE_PROMPT.startsWith('You are auditing THIS session for wasted context and wasted time.')).toBe(true)
    expect(JUDGE_PROMPT).toContain('{{KNOWN_PATTERNS}}')
    expect(JUDGE_PROMPT).toContain('{{DECISIONS}}')
    expect(JUDGE_PROMPT).toContain('{{STATS}}')
    expect(JUDGE_PROMPT).toContain('{{TURNS}}')
    expect(JUDGE_PROMPT).toContain('{{LEDGER}}')
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

  test('buildPrompt folds the rows past the ledger window into summary lines', ($, _on) => {
    const prompt = buildPrompt(judgeState({ rows: Array.from({ length: 160 }, (_, i) => filler(i + 1)) }))
    expect(prompt).toContain('~ | Bash | test:bun test | ×10 | Σ1000ch')
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
    expect(parseReply('{"focus": "x", "findings": [', judgeState())).toEqual({ findings: [], focus: null })
    expect(parseReply('no json at all', judgeState())).toEqual({ findings: [], focus: null })
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

  test('parseReply keeps at most six findings and two behavioural ones', ($, _on) => {
    const many = Array.from({ length: 8 }, (_, i) => rawFinding({ id: `execution:suite-${i + 1}` }))
    expect(parseReply(replyText(many), judgeState()).findings.length).toBe(6)
    const three = [
      behavioural('communication:restates-plan'),
      behavioural('communication:recaps-finished-work'),
      behavioural('communication:asks-what-it-knows'),
      rawFinding(),
    ]
    const findings = parseReply(replyText(three), judgeState()).findings
    expect(findings.map(f => f.id)).toEqual([
      'communication:restates-plan', 'communication:recaps-finished-work', 'execution:full-suite-after-each-edit',
    ])
  })

  test('merge reuses a known id, extending its hits and refreshing its text', ($, _on) => {
    const state = judgeState({ patterns: [judgePattern()] })
    const result = merge(state, [judgeFinding({ why: 'three runs, nothing shared changed' })])
    expect(result.patterns.length).toBe(1)
    expect(result.patterns[0]?.hits).toEqual(['toolu_01', 'toolu_03', 'toolu_06'])
    expect(result.patterns[0]?.why).toBe('three runs, nothing shared changed')
    expect(result.patterns[0]?.kind).toBe(judgePattern().kind)
    expect(result.fresh).toEqual([])
    expect(result.recurred).toEqual([])
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
      { kind: `Claude keeps ${'x'.repeat(120)}` },
      { alternative: '' },
      { alternative: 'x'.repeat(201) },
      { confidence: 0.4 },
      { confidence: 1.2 },
    ]
    broken.forEach(over => expect(parseReply(replyText([rawFinding(over)]), judgeState()).findings).toEqual([]))
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
})
