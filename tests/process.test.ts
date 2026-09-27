import { describe, expect, test } from 'claude-code/testing'

import {
  PROCESS_PROMPT, buildProcessPrompt, digestOf, isPace, measuredCost, mergeProcess, parseProcessReply, processAliases, shouldProcess,
} from '../hooks/core/process'
import { agentAliases } from '../hooks/core/evidence'
import { cardOf, reduce } from '../hooks/core/patterns'
import { DIGEST_MAX_CHARS, MAX_PROCESS_FINDINGS, PROCESS_CLOCK_MS } from '../hooks/core/types'
import type { Pattern, State } from '../hooks/core/types'
import { hugeState } from './fixtures/process/hugeState'
import { lanesState } from './fixtures/process/lanesState'
import { processReply, rawProcessFinding } from './fixtures/process/processReply'
import { processPattern } from './fixtures/patterns/processPattern'

const T = 10_000_000

// The lanes session with the process judge last run at clock T, at an older ledger row.
const ranAt = (over: Partial<State['process']> = {}, state: State = lanesState()): State =>
  ({ ...state, process: { ...state.process, lastAtMs: T, lastAtSeq: 4, lastAtTurn: 3, ...over } })

const aliasOf = (state: State, id: string): string => processAliases(state).get(id) ?? '?'

describe('process', () => {
  test('PROCESS_PROMPT is the Appendix E text: starts with the review frame, carries one DIGEST placeholder, and ends with the return instruction', ($, _on) => {
    // Every trigger but the clock forks mid-task, over a snapshot that ends in that task: without this
    // opening the live fork retried the Workflow launch it was forked from and answered in prose.
    expect(PROCESS_PROMPT.startsWith('This message is not a step of the task.')).toBe(true)
    expect(PROCESS_PROMPT).toContain('do not continue, retry or resume anything the transcript was doing')
    expect(PROCESS_PROMPT).toContain('You are reviewing HOW this session is being run, not what it produced.')
    expect(PROCESS_PROMPT).toContain('{{DIGEST}}')
    expect(PROCESS_PROMPT).not.toContain('{{KNOWN_PATTERNS}}')
    expect(PROCESS_PROMPT).not.toContain('{{STATS}}')
    expect(PROCESS_PROMPT).toContain('how would a lean expert run this work?')
    expect(PROCESS_PROMPT).toContain('Prefer silence to a guess.')
    expect(PROCESS_PROMPT).toContain('cost_tokens')
    expect(PROCESS_PROMPT).toContain('cost_ms')
    expect(PROCESS_PROMPT).toContain('"findings": []')
    expect(PROCESS_PROMPT).toContain('Return the JSON object only.')
    expect(PROCESS_PROMPT).toContain('## PROCESS DIGEST')
  })

  test('the digest misses the process: three impl, review and fix lanes on Opus show as one run row, its phases, roles by model and checks after merges', async () => {
    const state = lanesState()
    const digest = digestOf(state)
    expect(digest).toContain('run:w1 | lanes | phases Implement → Review → Fix | loops 9')
    expect(digest).toContain('merges 3 · checks after 3')
    expect(digest).toMatch(/\n {2}Implement \| ×3 \| opus ×3 \| 30\.0m \| 144k tok \| edits 3 \| report ×3 \| agent:a\d+ agent:a\d+ agent:a\d+\n/)
    expect(digest).toContain(`  Review | ×3 | opus ×3 | 30.0m | 144k tok | edits 0 | 3 high 6 low | agent:${aliasOf(state, 'agent-review-1')}`)
    expect(digest).toContain('roles × model: fix opus ×3 · impl opus ×3 · review opus ×3')
    for (const section of ['## ASKS', '## SHAPE', '## CADENCE', '## ARTIFACTS', '## INTERVENTIONS']) expect(digest).toContain(section)
  })

  test('the digest reads asks from typed prompts only, and names memory files without their contents', async () => {
    const digest = digestOf(lanesState())
    expect(digest).toContain('turn:1 | +0m | Implement the three lanes from the plan')
    expect(digest).toContain('turn:6 | +60m | this is taking forever | pace')
    expect(digest, 'a turn answer is not something the person asked').not.toContain('Here is the plan again')
    expect(digest).toContain('memory: feedback-pace.md /home/u/.claude/projects/p/memory/feedback-pace.md written')
    expect(digest, 'a memory file is named, never read').not.toContain('secret memory body')
    expect(digest).toContain('compactions 1 (turn 4) · pace complaints 1 (turn:6)')
  })

  test('the digest runs past its cap: a huge session stays within the cap and keeps its Shape', async () => {
    const digest = digestOf(hugeState())
    expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS)
    expect(digest).toContain('## SHAPE')
    expect(digest, 'the oldest and the newest run rows are both whole').toContain('run:w1 | stage-1 | phases Implement → Review → Fix → Verify | loops 8')
    expect(digest).toContain('run:w50 | stage-50 |')
    expect(digest).toContain('roles × model:')
    expect(digest, 'the asks were cut, and the cut says so').toMatch(/~ ×\d+ lines cut/)
    expect(digest, 'the newest ask survives the cut').toContain('turn:3000 |')
    expect(digest, 'the first ask, usually the task itself, survives the cut').toContain('turn:1 | +0m | ask 0 ')
    expect(digest, 'the old asks go before the small sections do').toContain('turns 7 · compactions 1 (turn 4)')
  })

  test('isPace reads a typed complaint about pace, and not a task that names slowness', async () => {
    for (const text of ['this is taking forever', 'why so slow?', 'Why is it so slow', 'this takes too long', 'come on, hurry up', 'can you speed this up', 'it has been ages'])
      expect(isPace(text), text).toBe(true)
    // Complaints as people really type them: loose grammar, and the heavy model called out for its speed.
    for (const text of ['what take you so long??', 'why does it take so long', 'this ought to have been much faster', 'the big model is pricey and slow, use a smaller one'])
      expect(isPace(text), text).toBe(true)
    for (const text of ['fix the slow query in db.ts', 'write a long summary', 'the forever loop in worker.ts hangs', 'this line is too long for the linter', 'make the build much faster', 'the api is slow and flaky'])
      expect(isPace(text), text).toBe(false)
  })

  test('the trigger misfires: it runs on a plan, a launch, a pace complaint and the clock past thirty minutes with new rows', async () => {
    const fresh = lanesState()
    for (const trigger of ['plan', 'workflow', 'pace'] as const) expect(shouldProcess(fresh, T, trigger), trigger).toBe(true)
    expect(shouldProcess(ranAt(), T + PROCESS_CLOCK_MS, 'clock'), 'thirty minutes and new rows').toBe(true)
    expect(shouldProcess(ranAt(), T + PROCESS_CLOCK_MS - 1, 'clock'), 'not yet thirty minutes').toBe(false)
    expect(shouldProcess(ranAt(), T + 1, 'workflow'), 'an event need not wait for the clock').toBe(true)
    expect(shouldProcess(fresh, 1_000_000 + 600_000, 'clock'), 'the first clock counts from the first ask, not from zero').toBe(false)
  })

  test('the trigger misfires: nothing new, a run in flight, or an over-budget session inside the doubled interval stay silent', async () => {
    const state = lanesState()
    for (const trigger of ['plan', 'workflow', 'pace', 'clock'] as const) {
      expect(shouldProcess(ranAt({ lastAtSeq: state.seq }), T + 10 * PROCESS_CLOCK_MS, trigger), `${trigger}: nothing new`).toBe(false)
      expect(shouldProcess(ranAt({ running: true }), T + 10 * PROCESS_CLOCK_MS, trigger), `${trigger}: running is the lock`).toBe(false)
      expect(shouldProcess(ranAt({ backoff: 2 }), T + PROCESS_CLOCK_MS, trigger), `${trigger}: over budget waits the doubled interval`).toBe(false)
      expect(shouldProcess(ranAt({ backoff: 2 }), T + 2 * PROCESS_CLOCK_MS, trigger), `${trigger}: the doubled interval passed`).toBe(true)
    }
  })

  test('the process prompt asks the lean question and carries the digest', async () => {
    const state = lanesState()
    expect(PROCESS_PROMPT).toContain('how would a lean expert run this')
    expect(PROCESS_PROMPT).toContain('Prefer silence to a guess')
    const prompt = buildProcessPrompt(state)
    expect(prompt).toContain(digestOf(state))
    expect(prompt).not.toContain('{{DIGEST}}')
  })

  test('a finding raised before is shown to the next run with its words, so the same divergence keeps one id and one card', async () => {
    const state: State = { ...lanesState(), patterns: [processPattern()], cards: ['process:review-per-lane'] }
    const digest = digestOf(state)
    expect(digest, 'an open finding is listed, not only a decided one').toContain('process:review-per-lane | open | sent ×0 | Each lane runs Implement → Review → Fix before a whole-branch review')
    expect(PROCESS_PROMPT, 'and the prompt says to reuse it').toContain('The same divergence under another id is the same finding: return its id.')
  })

  test('a finding may cite the turn a complaint was typed in, still running and never completed, as the digest prints it', async () => {
    const lanes = lanesState()
    const running = lanes.turn + 1
    const state: State = { ...lanes, turn: running, asks: [...lanes.asks, { turn: running, at: T, head: 'why is this so slow', pace: true }] }
    expect(state.turns.some(t => t.turn === running), 'the turn has not completed').toBe(false)
    expect(digestOf(state, processAliases(state)), 'the digest prints it').toContain(`turn:${running}`)
    const parsed = parseProcessReply(processReply([rawProcessFinding({ evidence: ['run:w1', `turn:${running}`] })]), state, processAliases(state))
    expect(parsed.dropped).toEqual([])
    expect(parsed.findings.map(f => f.evidence)).toEqual([['run:w1', `turn:${running}`]])
    const unprinted = parseProcessReply(processReply([rawProcessFinding({ evidence: ['run:w1', `turn:${running + 5}`] })]), state, processAliases(state))
    expect(unprinted.findings, 'a turn the digest never printed is still discarded').toEqual([])
  })

  test('a guess becomes a card: unknown handles and low confidence are dropped, a cost above the cited total is clamped, at most three kept', async () => {
    const state = lanesState()
    const aliases = processAliases(state)
    const a = (id: string): string => `agent:${aliasOf(state, id)}`
    const reply = processReply([
      rawProcessFinding({ evidence: ['run:w1', a('agent-impl-1')], cost_tokens: 99_000_000, cost_ms: 99_000_000 }),
      rawProcessFinding({ id: 'process:unknown-agent', evidence: ['run:w1', 'agent:a99'] }),
      rawProcessFinding({ id: 'process:unknown-run', evidence: ['run:w9'] }),
      rawProcessFinding({ id: 'process:row-handle', evidence: ['r3'] }),
      rawProcessFinding({ id: 'process:unsure', confidence: 0.6 }),
      rawProcessFinding({ id: 'process:opus-on-mechanics', evidence: [a('agent-fix-1'), a('agent-fix-2')], cost_tokens: 1_000, cost_ms: 1_000 }),
      rawProcessFinding({ id: 'process:suite-after-merge', evidence: ['turn:5', 'turn:6'], cost_tokens: 50_000 }),
      rawProcessFinding({ id: 'process:fourth' }),
    ])
    const parsed = parseProcessReply(reply, state, aliases)
    expect(parsed.returned).toBe(8)
    expect(parsed.findings.map(f => f.id)).toEqual(['process:review-per-lane', 'process:opus-on-mechanics', 'process:suite-after-merge'])
    expect(parsed.findings.length).toBeLessThanOrEqual(MAX_PROCESS_FINDINGS)
    const [first, second, third] = parsed.findings
    expect(first?.cost, 'clamped to the run\'s nine loops, the cited agent counted once').toEqual({ tokens: 9 * 48_000, ms: 9 * 600_000 })
    expect(second?.cost, 'a claim under the measure stands').toEqual({ tokens: 1_000, ms: 1_000 })
    expect(third?.cost, 'two turns measure their own new tokens and time').toEqual({ tokens: 6_000 + 7_000, ms: 71_000 })
    expect(first).toMatchObject({ category: 'process', signature: null, lean: 'Implement every lane, review the branch once, fix once', evidence: ['run:w1', 'agent:agent-impl-1'] })
    expect(parsed.dropped.join('\n')).toContain('process:unknown-agent: evidence agent:a99')
    expect(parsed.dropped.join('\n')).toContain('process:unknown-run: evidence run:w9')
    expect(parsed.dropped.join('\n')).toContain('process:row-handle: evidence r3')
    expect(parsed.dropped.join('\n')).toContain('process:unsure: confidence')
    expect(parsed.dropped.join('\n')).toContain(`process:fourth: over MAX_PROCESS_FINDINGS (${MAX_PROCESS_FINDINGS})`)
    expect(parseProcessReply('not json', state, aliases)).toEqual({ findings: [], dropped: ['reply was not JSON'], returned: 0 })
    expect(measuredCost(state, ['run:w1'])).toEqual({ tokens: 9 * 48_000, ms: 9 * 600_000 })
  })

  test('mergeProcess adds a process pattern with its lean line, and names a Fixed one that recurred', async () => {
    const state = lanesState()
    const { findings } = parseProcessReply(processReply([rawProcessFinding({ evidence: ['run:w1', 'turn:6'] })]), state, processAliases(state))
    const added = mergeProcess(state, findings)
    expect(added.fresh).toEqual(['process:review-per-lane'])
    expect(added.patterns.find(p => p.id === 'process:review-per-lane')).toMatchObject({ category: 'process', lean: 'Implement every lane, review the branch once, fix once', hits: ['run:w1', 'turn:6'] })
    const fixed: Pattern = { ...(added.patterns[0] as Pattern), decision: 'steer', decidedAtTurn: 5, lean: 'old lean' }
    const again = mergeProcess({ ...state, patterns: [fixed] }, findings)
    expect(again.recurred, 'turn 6 is after the Fix at turn 5').toEqual(['process:review-per-lane'])
    expect(again.fresh).toEqual([])
    expect(again.patterns[0]?.lean, 'the lean line is the newest run\'s').toBe('Implement every lane, review the branch once, fix once')
  })

  test('a card shows the cost the judge claimed when it is under what the cited run measured, not the run\'s whole cost', async () => {
    const state = lanesState()
    const { findings } = parseProcessReply(processReply([rawProcessFinding({ cost_tokens: 100_000, cost_ms: 600_000 })]), state, processAliases(state))
    expect(measuredCost(state, ['run:w1']).tokens, 'the run measured far more than the claim').toBeGreaterThan(100_000)
    const merged = mergeProcess(state, findings)
    const done = reduce(state, { type: 'process.done', ...merged, spent: 0, error: null, returned: 1, kept: 1, dropped: [], usage: null })
    const p = done.patterns.find(x => x.id === 'process:review-per-lane') as Pattern
    expect(cardOf(p, done, 1, agentAliases(done.rows, done.loops)).stats, 'the clamped claim, not the run total').toBe('10m · 100k tokens')
  })
})
