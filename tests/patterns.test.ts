import { describe, expect, test } from 'claude-code/testing'

import {
  bandModel, cardOf, debugDump, fromStored, mergeStored, paneModel, parseRegistry, reduce,
  tokensToCompaction, toStored, totalTokens, turnsToCompaction,
} from '../hooks/core/patterns'
import { instructionOf, killPrompt } from '../hooks/core/text'
import { JUDGE_MAX_BACKOFF, MAX_PATTERNS, ROW_CAP, SETTLE_TURNS } from '../hooks/core/types'
import type { Action, Pattern, Row } from '../hooks/core/types'
import { chattyPattern } from './fixtures/patterns/chattyPattern'
import { claudeMdArtifact } from './fixtures/patterns/claudeMdArtifact'
import { junkRegistry } from './fixtures/patterns/junkRegistry'
import { seedState } from './fixtures/patterns/seedState'
import { suitePattern } from './fixtures/patterns/suitePattern'
import { testRow } from './fixtures/patterns/testRow'
import { turnEnd } from './fixtures/patterns/turnEnd'

const withSeq = (over: Partial<Omit<Row, 'seq'>>, seq: number): Row => ({ ...testRow(over), seq })

const steered = (over: Partial<Pattern> = {}): Pattern => ({
  ...suitePattern, hits: ['r-1', 'r-2'], decision: 'steer', decidedAtTurn: 5, lastDecision: 'steer',
  instruction: 'run only the covering tests', openedAtTurn: 5, ...over,
})

describe('patterns', () => {
  test('turn.start counts the turn', async () => {
    const one = reduce(seedState(), { type: 'turn.start' })
    expect(one.turn).toBe(1)
    expect(reduce(one, { type: 'turn.start' }).turn).toBe(2)
  })

  test('row numbers the ledger, caps it and grows a matching pattern', async () => {
    const state = seedState({ turn: 4, patterns: [suitePattern, chattyPattern] })
    const one = reduce(state, { type: 'row', row: testRow({ id: 'r-a', turn: 4 }) })
    expect(one.seq).toBe(1)
    expect(one.rows).toEqual([{ ...testRow({ id: 'r-a', turn: 4 }), seq: 1 }])
    expect(one.patterns[0]?.hits).toEqual(['r-a'])
    expect(one.patterns[1]?.hits).toEqual(['turn:14', 'turn:15'])
    const two = reduce(one, { type: 'row', row: testRow({ id: 'r-b', key: 'read:cat log', cls: 'read', turn: 4 }) })
    expect(two.seq).toBe(2)
    expect(two.patterns[0]?.hits).toEqual(['r-a'])
    const full = seedState({
      seq: ROW_CAP,
      rows: Array.from({ length: ROW_CAP }, (_, i) => withSeq({ id: `old-${i}`, key: 'other:x', cls: 'other' }, i + 1)),
    })
    const capped = reduce(full, { type: 'row', row: testRow({ id: 'r-new' }) })
    expect(capped.rows).toHaveLength(ROW_CAP)
    expect(capped.rows[0]?.id).toBe('old-1')
    expect(capped.rows[ROW_CAP - 1]?.id).toBe('r-new')
  })

  test('adopt numbers the recovered rows, catches the turn up and arms a remembered pattern', async () => {
    const state = seedState({
      turn: 1, seq: 2, patterns: [suitePattern, chattyPattern], saved: { ms: 5, chars: 50 },
      rows: [withSeq({ id: 'r-1', key: 'other:x', cls: 'other' }, 1), withSeq({ id: 'r-2', key: 'other:x', cls: 'other' }, 2)],
    })
    const rows = [
      testRow({ id: 'a-1', turn: 1, flags: ['recovered'] }),
      testRow({ id: 'a-2', key: 'read:cat log', cls: 'read', turn: 2, flags: ['recovered'] }),
      testRow({ id: 'a-3', turn: 3, flags: ['recovered'] }),
    ]
    const joined = reduce(state, { type: 'adopt', rows })

    expect(joined.seq, 'the seq numbering continues where the session left it').toBe(5)
    expect(joined.rows.map(r => r.seq)).toEqual([1, 2, 3, 4, 5])
    expect(joined.rows.map(r => r.id)).toEqual(['r-1', 'r-2', 'a-1', 'a-2', 'a-3'])
    expect(joined.turn, 'the counter catches up to the newest turn adopted').toBe(3)
    expect(joined.patterns[0]?.hits, 'the remembered pattern is armed by the history').toEqual(['a-1', 'a-3'])
    expect(joined.patterns[1]?.hits, 'a behavioural pattern matches no row').toEqual(['turn:14', 'turn:15'])
    expect(joined.turns, 'no token data exists for a rebuilt turn').toEqual([])
    expect(joined.saved, 'history saved nothing').toEqual({ ms: 5, chars: 50 })
    expect(joined.cards).toEqual([])
    expect(state.rows, 'the state handed in is untouched').toHaveLength(2)
    expect(state.patterns[0]?.hits).toEqual([])

    const behind = reduce(seedState({ turn: 7 }), { type: 'adopt', rows })
    expect(behind.turn, 'a turn already ahead of the transcript is never wound back').toBe(7)

    const full = seedState({
      seq: ROW_CAP,
      rows: Array.from({ length: ROW_CAP }, (_, i) => withSeq({ id: `old-${i + 1}`, key: 'other:x', cls: 'other' }, i + 1)),
    })
    const capped = reduce(full, { type: 'adopt', rows })
    expect(capped.rows).toHaveLength(ROW_CAP)
    expect(capped.rows[0]?.id).toBe('old-4')
    expect(capped.rows[ROW_CAP - 1]?.id).toBe('a-3')
    expect(capped.seq).toBe(ROW_CAP + 3)
    expect(reduce(seedState(), { type: 'adopt', rows: [] }), 'nothing to adopt changes nothing').toEqual(seedState())
  })

  test('turn.complete records the calls made in that turn', async () => {
    const state = seedState({
      turn: 3,
      rows: [withSeq({ id: 'r-1', turn: 2 }, 1), withSeq({ id: 'r-2', turn: 3 }, 2), withSeq({ id: 'r-3', turn: 3 }, 3)],
    })
    const done = reduce(state, { type: 'turn.complete', stat: turnEnd() })
    expect(done.turns).toEqual([{ ...turnEnd(), turn: 3, calls: 2 }])
    expect(totalTokens(done)).toBe(10_000)
  })

  test('steer needs text and queues the note, the standing text and the settle window', async () => {
    const state = seedState({
      turn: 6, patterns: [suitePattern], cards: [suitePattern.id],
      expanded: suitePattern.id, steering: suitePattern.id, steerDraft: 'half typed',
    })
    expect(reduce(state, { type: 'decide', patternId: suitePattern.id, choice: 'steer' })).toBe(state)
    expect(reduce(state, { type: 'decide', patternId: suitePattern.id, choice: 'steer', text: '   ' })).toBe(state)
    expect(reduce(state, { type: 'decide', patternId: 'execution:missing', choice: 'keep' })).toBe(state)
    const text = 'run tests/auth.test.ts until the phase is done'
    const next = reduce(state, { type: 'decide', patternId: suitePattern.id, choice: 'steer', text })
    expect(next.patterns[0]).toMatchObject({ decision: 'steer', lastDecision: 'steer', decidedAtTurn: 6, openedAtTurn: 6, instruction: text })
    expect(next.notes).toEqual([instructionOf(text)])
    expect(next.standing).toEqual([instructionOf(text)])
    expect(next.cards).toEqual([])
    expect(next.expanded).toBeNull()
    expect(next.steering).toBeNull()
    expect(next.steerDraft).toBeNull()
    expect(reduce(next, { type: 'notes.drained' }).standing).toEqual([instructionOf(text)])
  })

  test('kill queues the kill prompt and keep sends nothing', async () => {
    const state = seedState({ turn: 6, patterns: [suitePattern], cards: [suitePattern.id] })
    const killed = reduce(state, { type: 'decide', patternId: suitePattern.id, choice: 'kill' })
    expect(killed.patterns[0]?.instruction).toBe(killPrompt(suitePattern))
    expect(killed.notes).toHaveLength(1)
    expect(killed.notes[0]).toBe(instructionOf(killPrompt(suitePattern)))
    expect(killed.standing).toEqual(killed.notes)
    expect(killed.patterns[0]).toMatchObject({ decision: 'kill', lastDecision: 'kill', openedAtTurn: 6 })
    const kept = reduce(state, { type: 'decide', patternId: suitePattern.id, choice: 'keep' })
    expect(kept.notes).toEqual([])
    expect(kept.standing).toEqual([])
    expect(kept.cards).toEqual([])
    expect(kept.patterns[0]).toMatchObject({ decision: 'keep', lastDecision: 'keep', instruction: null })
  })

  test('a row under the steered signature marks it ignored and returns the card', async () => {
    const rows = [withSeq({ id: 'r-1', turn: 5 }, 1), withSeq({ id: 'r-2', turn: 5 }, 2)]
    const state = seedState({ turn: 7, rows, patterns: [steered()] })
    const again = reduce(state, { type: 'row', row: testRow({ id: 'r-3', turn: 7 }) })
    expect(again.patterns[0]).toMatchObject({ ignored: 1, openedAtTurn: null })
    expect(again.patterns[0]?.hits).toEqual(['r-1', 'r-2', 'r-3'])
    expect(again.cards).toEqual([suitePattern.id])
    expect(again.saved).toEqual({ ms: 0, chars: 0 })
    const third = reduce(again, { type: 'row', row: testRow({ id: 'r-4', turn: 7 }) })
    expect(third.patterns[0]?.ignored).toBe(1)
    expect(third.cards).toEqual([suitePattern.id])
    const inAgent = reduce(state, { type: 'row', row: testRow({ id: 'r-5', turn: 7, agent: 'agent-1' }) })
    expect(inAgent.patterns[0]).toMatchObject({ ignored: 0, openedAtTurn: 5 })
    expect(inAgent.cards).toEqual([])
  })

  test('a row from the decision\'s own turn settles nothing: it was already in flight', async () => {
    const rows = [withSeq({ id: 'r-1', turn: 4, ms: 60_000, chars: 9_000 }, 1), withSeq({ id: 'r-2', turn: 5, ms: 60_000, chars: 9_000 }, 2)]
    const state = seedState({ turn: 5, rows, patterns: [steered()] })
    const same = reduce(state, { type: 'row', row: testRow({ id: 'r-3', turn: 5 }) })
    expect(same.patterns[0]).toMatchObject({ ignored: 0, openedAtTurn: 5 })
    expect(same.patterns[0]?.hits).toEqual(['r-1', 'r-2', 'r-3'])
    expect(same.cards).toEqual([])
    const narrowerSameTurn = reduce(state, { type: 'row', row: testRow({ id: 'r-4', turn: 5, key: 'test:bun test tests/auth.test.ts', ms: 4_000, chars: 900 }) })
    expect(narrowerSameTurn.saved).toEqual({ ms: 0, chars: 0 })
    expect(narrowerSameTurn.patterns[0]?.openedAtTurn).toBe(5)
  })

  test('every ignored instruction brings the card back, by row and by judge', async () => {
    const rows = [withSeq({ id: 'r-1', turn: 5 }, 1), withSeq({ id: 'r-2', turn: 5 }, 2)]
    const first = reduce(seedState({ turn: 7, rows, patterns: [steered()] }), { type: 'row', row: testRow({ id: 'r-3', turn: 7 }) })
    expect(first.cards).toEqual([suitePattern.id])
    const stronger = reduce({ ...first, turn: 8 }, { type: 'decide', patternId: suitePattern.id, choice: 'steer', text: 'never run the whole suite mid-phase' })
    expect(stronger.cards).toEqual([])
    const second = reduce({ ...stronger, turn: 9 }, { type: 'row', row: testRow({ id: 'r-4', turn: 9 }) })
    expect(second.patterns[0]).toMatchObject({ ignored: 2, openedAtTurn: null })
    expect(second.cards).toEqual([suitePattern.id])
    expect(second.saved).toEqual({ ms: 0, chars: 0 })
    const judged = reduce({ ...second, turn: 10 }, { type: 'decide', patternId: suitePattern.id, choice: 'kill' })
    expect(judged.cards).toEqual([])
    const again = reduce(judged, { type: 'judge.done', patterns: judged.patterns, fresh: [], recurred: [suitePattern.id], focus: null, spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(again.patterns[0]).toMatchObject({ ignored: 3, openedAtTurn: null })
    expect(again.cards).toEqual([suitePattern.id])
  })

  test('judge.done recurred marks it ignored and returns the card', async () => {
    const state = seedState({ turn: 9, patterns: [steered()] })
    const done = reduce(state, { type: 'judge.done', patterns: [steered()], fresh: [], recurred: [suitePattern.id], focus: 'auth', spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(done.patterns[0]).toMatchObject({ ignored: 1, openedAtTurn: null, decision: 'steer' })
    expect(done.cards).toEqual([suitePattern.id])
    const twice = reduce(done, { type: 'judge.done', patterns: done.patterns, fresh: [], recurred: [suitePattern.id], focus: 'auth', spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(twice.patterns[0]?.ignored).toBe(2)
    expect(twice.cards).toEqual([suitePattern.id])
    expect(twice.judge.runs).toBe(2)
    expect(twice.judge.focus).toBe('auth')
    const kept: Pattern = { ...suitePattern, decision: 'keep', decidedAtTurn: 4, lastDecision: 'keep' }
    const silent = reduce(seedState({ turn: 9, patterns: [kept] }), { type: 'judge.done', patterns: [kept], fresh: [suitePattern.id], recurred: [suitePattern.id], focus: null, spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(silent.patterns[0]?.ignored).toBe(0)
    expect(silent.cards).toEqual([])
  })

  test('a narrower same-class row credits the baseline minus its cost, once', async () => {
    const rows = [withSeq({ id: 'r-1', turn: 5, ms: 60_000, chars: 9_000 }, 1), withSeq({ id: 'r-2', turn: 6, ms: 60_000, chars: 9_000 }, 2)]
    const state = seedState({ turn: 7, rows, patterns: [steered({ decidedAtTurn: 6, openedAtTurn: 6 })] })
    const credited = reduce(state, { type: 'row', row: testRow({ id: 'r-3', turn: 7, key: 'test:bun test tests/auth.test.ts', ms: 4_000, chars: 900 }) })
    expect(credited.saved).toEqual({ ms: 56_000, chars: 8_100 })
    expect(credited.patterns[0]).toMatchObject({ openedAtTurn: null, ignored: 0 })
    expect(credited.patterns[0]?.hits).toEqual(['r-1', 'r-2'])
    const twice = reduce(credited, { type: 'row', row: testRow({ id: 'r-4', turn: 7, key: 'test:bun test tests/db.test.ts', ms: 4_000, chars: 900 }) })
    expect(twice.saved).toEqual({ ms: 56_000, chars: 8_100 })
    const otherClass = reduce(state, { type: 'row', row: testRow({ id: 'r-9', turn: 7, key: 'read:cat log', cls: 'read', ms: 1_000, chars: 100 }) })
    expect(otherClass.saved).toEqual({ ms: 0, chars: 0 })
    expect(otherClass.patterns[0]?.openedAtTurn).toBe(6)
  })

  test('evidence mostly rebuilt from the transcript still credits the time its one timed row measured', async () => {
    const rows = [
      withSeq({ id: 'a-1', turn: 1, ms: 0, chars: 9_000, flags: ['recovered'] }, 1),
      withSeq({ id: 'a-2', turn: 2, ms: 0, chars: 9_000, flags: ['recovered'] }, 2),
      withSeq({ id: 'l-1', turn: 5, ms: 60_000, chars: 9_000 }, 3),
    ]
    const killed = steered({ decision: 'kill', hits: ['a-1', 'a-2', 'l-1'], decidedAtTurn: 6, openedAtTurn: 6, instruction: killPrompt(suitePattern) })
    const state = seedState({ turn: 7, rows, patterns: [killed] })
    const credited = reduce(state, { type: 'row', row: testRow({ id: 'r-4', turn: 7, key: 'test:bun test tests/auth.test.ts', ms: 5_000, chars: 900 }) })
    expect(credited.saved, 'the adopted rows lend their size; the timed row alone sets the clock').toEqual({ ms: 55_000, chars: 8_100 })
    expect(credited.saved.ms, 'a session joined late still credits the seconds it saved').toBeGreaterThan(0)
  })

  test('two quiet turns credit the whole baseline', async () => {
    const rows = [withSeq({ id: 'r-1', turn: 5, ms: 60_000, chars: 9_000 }, 1), withSeq({ id: 'r-2', turn: 5, ms: 60_000, chars: 9_000 }, 2)]
    const early = reduce(seedState({ turn: 5 + SETTLE_TURNS - 1, rows, patterns: [steered()] }), { type: 'turn.complete', stat: turnEnd() })
    expect(early.saved).toEqual({ ms: 0, chars: 0 })
    expect(early.patterns[0]?.openedAtTurn).toBe(5)
    const settled = reduce(seedState({ turn: 5 + SETTLE_TURNS, rows, patterns: [steered()] }), { type: 'turn.complete', stat: turnEnd() })
    expect(settled.saved).toEqual({ ms: 60_000, chars: 9_000 })
    expect(settled.patterns[0]?.openedAtTurn).toBeNull()
  })

  test('a steered behavioural pattern accrues its per-turn estimate', async () => {
    const sent: Pattern = { ...chattyPattern, decision: 'steer', decidedAtTurn: 15, lastDecision: 'steer', instruction: 'say it once' }
    const one = reduce(seedState({ turn: 16, patterns: [sent] }), { type: 'turn.complete', stat: turnEnd() })
    expect(one.saved).toEqual({ ms: 0, chars: 4_800 })
    const two = reduce({ ...one, turn: 17 }, { type: 'turn.complete', stat: turnEnd() })
    expect(two.saved).toEqual({ ms: 0, chars: 9_600 })
    const undecided = reduce(seedState({ turn: 16, patterns: [chattyPattern] }), { type: 'turn.complete', stat: turnEnd() })
    expect(undecided.saved).toEqual({ ms: 0, chars: 0 })
    const ignored = reduce(seedState({ turn: 16, patterns: [{ ...sent, ignored: 3 }] }), { type: 'turn.complete', stat: turnEnd() })
    expect(ignored.saved).toEqual({ ms: 0, chars: 0 })
  })

  test('judge.done queues fresh cards once, never drops a decision, counts runs and backs off', async () => {
    const kept: Pattern = { ...chattyPattern, decision: 'keep', decidedAtTurn: 3, lastDecision: 'keep' }
    const state = seedState({ turn: 9, turns: [1, 2, 3].map(turn => ({ ...turnEnd(), turn, calls: 1 })), patterns: [kept] })
    expect(reduce(state, { type: 'judge.start' }).judge.running).toBe(true)
    const first = reduce(state, { type: 'judge.done', patterns: [suitePattern], fresh: [suitePattern.id, chattyPattern.id], recurred: [], focus: 'auth', spent: 1_000, error: null, returned: 0, kept: 0, dropped: [] })
    expect(first.cards).toEqual([suitePattern.id])
    expect(first.patterns.map(p => p.id)).toEqual([suitePattern.id, chattyPattern.id])
    expect(first.patterns[1]).toMatchObject({ decision: 'keep', decidedAtTurn: 3 })
    expect(first.judge).toEqual({ lastAtTokens: 30_000, lastAtTurn: 9, running: false, runs: 1, spent: 1_000, backoff: 2, error: null, focus: 'auth', last: { returned: 0, kept: 0, dropped: [] } })
    const logDump: Pattern = { ...suitePattern, id: 'reading:unfiltered-log-dump', category: 'reading' }
    const second = reduce(first, { type: 'judge.done', patterns: [...first.patterns, logDump], fresh: [suitePattern.id, logDump.id], recurred: [], focus: null, spent: 0, error: 'cold snapshot', returned: 0, kept: 0, dropped: [] })
    expect(second.cards).toEqual([logDump.id, suitePattern.id])
    expect(second.judge).toMatchObject({ runs: 2, spent: 1_000, backoff: 4, error: 'cold snapshot', focus: null })
    const third = reduce(second, { type: 'judge.done', patterns: second.patterns, fresh: [], recurred: [], focus: null, spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(third.judge.backoff).toBe(JUDGE_MAX_BACKOFF)
    const quiet = reduce(seedState(), { type: 'judge.done', patterns: [], fresh: [], recurred: [], focus: null, spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(quiet.judge).toMatchObject({ runs: 1, backoff: 1, lastAtTokens: 0 })
  })

  test('judge.done stores what the run returned, kept and dropped, and debug prints it', async () => {
    const dropped = [
      'execution:full-suite: evidence r99 not in the ledger',
      '#2: kind must start with "Claude keeps "',
      ...Array.from({ length: 5 }, (_, i) => `execution:suite-${i + 3}: over MAX_FINDINGS (6)`),
    ]
    const state = seedState({ turn: 9, patterns: [suitePattern] })
    const done = reduce(state, { type: 'judge.done', patterns: [suitePattern], fresh: [], recurred: [], focus: null, spent: 0, error: null, returned: 8, kept: 1, dropped })
    expect(done.judge.last).toEqual({ returned: 8, kept: 1, dropped })
    const dump = debugDump(done)
    expect(dump, 'found nothing and found things that were dropped now read differently').toContain('judge last: 8 returned · 1 kept · 7 dropped')
    expect(dump).toContain('  execution:full-suite: evidence r99 not in the ledger')
    expect(dump, 'at most six reasons are printed').not.toContain('execution:suite-7:')
    const crowded = { ...done, patterns: Array.from({ length: 60 }, (_, i) => ({ ...suitePattern, id: `execution:waster-${i}` })) }
    expect(debugDump(crowded).split('\n').length, 'the 40-line contract holds with the reasons in it').toBeLessThanOrEqual(40)
    expect(reduce(done, { type: 'reset' }).judge.last, 'a reset knows of no run').toBe(null)
  })

  test('judge.done drops a card whose pattern the registry no longer carries', async () => {
    const state = seedState({ turn: 9, patterns: [suitePattern], cards: [suitePattern.id] })
    const pruned = reduce(state, { type: 'judge.done', patterns: [], fresh: [], recurred: [], focus: null, spent: 0, error: null, returned: 0, kept: 0, dropped: [] })
    expect(pruned.patterns).toEqual([])
    expect(pruned.cards).toEqual([])
    expect(bandModel(pruned).fresh).toBe(0)
    expect(paneModel(pruned, []).wasters).toEqual([])
  })

  test('usage merges stickily and samples one percent per turn', async () => {
    const first = reduce(seedState({ turn: 1 }), { type: 'usage', usage: { window: 200_000, tokens: 50_000, percent: 25, compactAt: 180_000 }, now: 1 })
    expect(first.usage).toEqual({ window: 200_000, tokens: 50_000, percent: 25, compactAt: 180_000 })
    expect(first.usageSamples).toEqual([{ turn: 1, percent: 25 }])
    const second = reduce({ ...first, turn: 2 }, { type: 'usage', usage: { window: 200_000, tokens: 60_000, percent: 30 }, now: 2 })
    expect(second.usage).toEqual({ window: 200_000, tokens: 60_000, percent: 30, compactAt: 180_000 })
    const resampled = reduce(second, { type: 'usage', usage: { window: 200_000, tokens: 61_000, percent: 33 }, now: 3 })
    expect(resampled.usageSamples).toEqual([{ turn: 1, percent: 25 }, { turn: 2, percent: 33 }])
    const quiet = reduce(resampled, { type: 'usage', usage: { window: 200_000, tokens: 62_000 }, now: 4 })
    expect(quiet.usageSamples).toEqual(resampled.usageSamples)
    expect(quiet.usage).toMatchObject({ tokens: 62_000, percent: 33 })
    const many = Array.from({ length: 40 }, (_, i) => i + 1)
      .reduce((s, turn) => reduce({ ...s, turn }, { type: 'usage', usage: { window: 200_000, percent: turn }, now: turn }), seedState())
    expect(many.usageSamples).toHaveLength(30)
    expect(many.usageSamples[0]).toEqual({ turn: 11, percent: 11 })
  })

  test('overhead, compact, expand, steer.begin, drafts, notes, standing, artifacts, pane and columns', async () => {
    const base = seedState({ turn: 4, patterns: [suitePattern], notes: ['a note'], standing: ['a standing text'] })
    expect(reduce(base, { type: 'overhead', overhead: { memory: 1_200, mcp: 800, agents: 400 } }).overhead).toEqual({ memory: 1_200, mcp: 800, agents: 400 })
    expect(reduce(base, { type: 'compact' }).compactions).toEqual([4])
    const open = reduce(base, { type: 'expand', patternId: suitePattern.id })
    expect(open.expanded).toBe(suitePattern.id)
    expect(reduce(open, { type: 'expand', patternId: suitePattern.id }).expanded).toBeNull()
    expect(reduce(open, { type: 'expand', patternId: null }).expanded).toBeNull()
    const steering = reduce({ ...open, steerDraft: 'stale' }, { type: 'steer.begin', patternId: suitePattern.id })
    expect(steering.steering).toBe(suitePattern.id)
    expect(steering.steerDraft).toBeNull()
    expect(reduce(steering, { type: 'steer.begin', patternId: suitePattern.id }).steering).toBeNull()
    expect(reduce(steering, { type: 'steer.draft', text: 'half typed' }).steerDraft).toBe('half typed')
    expect(reduce(base, { type: 'notes.drained' }).notes).toEqual([])
    expect(reduce(base, { type: 'standing.add', text: 'a standing text' }).standing).toEqual(['a standing text'])
    expect(reduce(base, { type: 'standing.add', text: 'another' }).standing).toEqual(['a standing text', 'another'])
    const wrote = reduce(base, { type: 'artifact.done', patternId: suitePattern.id, kind: 'claude-md', written: true })
    expect(wrote.patterns[0]?.proposal).toBeNull()
    expect(wrote.written).toEqual([`${suitePattern.id}:claude-md`])
    expect(reduce(wrote, { type: 'artifact.done', patternId: suitePattern.id, kind: 'claude-md', written: true }).written).toEqual([`${suitePattern.id}:claude-md`])
    const skipped = reduce(base, { type: 'artifact.done', patternId: suitePattern.id, kind: 'claude-md', written: false })
    expect(skipped.patterns[0]?.proposal).toBeNull()
    expect(skipped.written).toEqual([])
    const auto = reduce(base, { type: 'pane', open: true, auto: true })
    expect([auto.paneOpen, auto.autoOpened]).toEqual([true, true])
    const closed = reduce(auto, { type: 'pane', open: false })
    expect([closed.paneOpen, closed.autoOpened]).toEqual([false, true])
    expect(reduce(base, { type: 'columns', columns: 150 }).columns).toBe(150)
  })

  test('reset clears the session and keeps the stored fields including lastDecision', async () => {
    const state = seedState({
      turn: 9, seq: 1, rows: [withSeq({ id: 'r-1' }, 1)], turns: [{ ...turnEnd(), turn: 1, calls: 1 }],
      usage: { window: 200_000, tokens: 90_000, percent: 45, compactAt: 180_000 },
      usageSamples: [{ turn: 1, percent: 45 }], overhead: { memory: 1, mcp: 2, agents: 3 }, compactions: [4],
      patterns: [{ ...suitePattern, hits: ['r-1'], decision: 'steer', decidedAtTurn: 5, lastDecision: 'steer', instruction: 'x', openedAtTurn: 5, ignored: 2 }],
      cards: [suitePattern.id], notes: ['n'], standing: ['s'], written: [`${suitePattern.id}:claude-md`], paneOpen: true, columns: 150,
      saved: { ms: 10, chars: 20 },
      judge: { lastAtTokens: 1, lastAtTurn: 2, running: true, runs: 3, spent: 4, backoff: 2, error: 'x', focus: 'f', last: null },
    })
    const clean = reduce(state, { type: 'reset' })
    expect(clean).toMatchObject({
      turn: 0, seq: 0, rows: [], turns: [], usageSamples: [], compactions: [], cards: [], notes: [], standing: [], written: [],
      expanded: null, steering: null, steerDraft: null, autoOpened: false,
    })
    expect(clean.usage).toEqual({ window: 200_000 })
    expect(clean.saved).toEqual({ ms: 0, chars: 0 })
    expect(clean.judge).toMatchObject({ runs: 0, spent: 0, backoff: 1, running: false, error: null, focus: null })
    expect(clean.overhead).toEqual({ memory: 1, mcp: 2, agents: 3 })
    expect(clean.columns).toBe(150)
    expect(clean.paneOpen).toBe(true)
    expect(clean.patterns).toEqual([fromStored(toStored({ ...suitePattern, lastDecision: 'steer' }))])
    expect(clean.patterns[0]).toMatchObject({ lastDecision: 'steer', hits: [], decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0 })
  })

  test('parseRegistry keeps valid stored patterns, drops junk and lets the later id win', async () => {
    const parsed = parseRegistry(junkRegistry)
    expect(parsed.map(p => p.id)).toEqual(['execution:full-suite-after-each-edit', 'communication:restates-plan-each-turn'])
    expect(parsed[0]).toMatchObject({ confidence: 0.99, lastDecision: 'kill', signature: { tool: 'Bash', key: 'test:bun test' } })
    expect(parsed[1]).toMatchObject({ estTokensPerTurn: 1_200, lastDecision: 'steer', signature: null })
    expect(parsed[1]?.proposal).toEqual({ kind: 'claude-md', title: 'Say it once', body: 'State the result in one or two lines.' })
    expect(parseRegistry(null)).toEqual([])
    expect(parseRegistry(undefined)).toEqual([])
    expect(parseRegistry({ patterns: [] })).toEqual([])
    expect(parseRegistry('[]')).toEqual([])
    expect(parseRegistry([toStored(suitePattern), toStored(chattyPattern)])).toEqual([toStored(suitePattern), toStored(chattyPattern)])
  })

  test('toStored drops the session fields, fromStored revives them, mergeStored lets b win', async () => {
    const live: Pattern = { ...suitePattern, hits: ['r-1'], decision: 'kill', decidedAtTurn: 5, lastDecision: 'kill', instruction: 'x', openedAtTurn: 5, ignored: 1 }
    const stored = toStored(live)
    expect(Object.keys(stored).sort()).toEqual(['alternative', 'category', 'confidence', 'estTokensPerTurn', 'id', 'kind', 'lastDecision', 'proposal', 'signature', 'why'])
    expect(fromStored(stored)).toEqual({ ...stored, hits: [], decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0 })
    const merged = mergeStored(
      [toStored(suitePattern), toStored(chattyPattern)],
      [{ ...toStored(suitePattern), lastDecision: 'keep' }, { ...toStored(chattyPattern), id: 'reading:unfiltered-log-dump' }],
    )
    expect(merged.map(p => p.id)).toEqual(['execution:full-suite-after-each-edit', 'communication:restates-plan-each-turn', 'reading:unfiltered-log-dump'])
    expect(merged[0]?.lastDecision).toBe('keep')
  })

  test('mergeStored caps the registry, dropping the least confident undecided entries first', async () => {
    const many = Array.from({ length: MAX_PATTERNS + 5 }, (_, at) => ({
      ...toStored(suitePattern),
      id: `execution:pattern-${at}`,
      confidence: at < 5 ? 0.5 : 0.9,
      lastDecision: at === 0 ? ('kill' as const) : null,
    }))
    const capped = mergeStored(many, [])
    expect(capped).toHaveLength(MAX_PATTERNS)
    expect(capped.map(p => p.id)).toContain('execution:pattern-0')       // decided, however thin its confidence
    expect(capped.map(p => p.id)).not.toContain('execution:pattern-1')   // undecided and least confident
    expect(capped.map(p => p.id)).toContain('execution:pattern-9')
    const at = (id: string): number => Number(id.replace('execution:pattern-', ''))
    expect(capped.map(p => at(p.id))).toEqual([...capped.map(p => at(p.id))].sort((a, b) => a - b))
  })

  test('cardOf states the stats, the fix, the kill text and the newest evidence first', async () => {
    const rows = [withSeq({ id: 'r-1', turn: 5, ms: 60_000, chars: 9_000 }, 1), withSeq({ id: 'r-2', turn: 8, ms: 45_000, chars: 9_600 }, 2)]
    const p: Pattern = { ...suitePattern, hits: ['r-1', 'r-2'] }
    const state = seedState({ rows, patterns: [p] })
    expect(cardOf(p, state)).toEqual({
      patternId: suitePattern.id,
      kind: suitePattern.kind,
      stats: '2× · ~2.3% context · 1m 45s · turns 5…8',
      why: suitePattern.why,
      fix: suitePattern.alternative,
      killText: killPrompt(suitePattern),
      evidence: [
        'r2 · turn 8 · Bash bun test · 45s · 9600ch · "✓ 212 passed"',
        'r1 · turn 5 · Bash bun test · 1m · 9000ch · "✓ 212 passed"',
      ],
    })
    expect(cardOf({ ...p, ignored: 1 }, state).kind).toBe(`ignored · ${suitePattern.kind}`)
    const rebuilt: Pattern = { ...suitePattern, hits: ['a-1', 'a-2', 'a-3'] }
    const history = seedState({
      rows: [1, 2, 3].map(i => withSeq({ id: `a-${i}`, turn: i, ms: 0, chars: 9_000, flags: ['recovered'] }, i)),
      patterns: [rebuilt],
    })
    expect(cardOf(rebuilt, history).stats, 'a card built from history claims no time nobody measured').toBe('3× · ~3.4% context · turns 1…3')
    const quick: Pattern = { ...suitePattern, hits: ['q-1', 'q-2', 'q-3'] }
    const fast = seedState({ rows: [1, 2, 3].map(i => withSeq({ id: `q-${i}`, turn: 4 + i, ms: 100, chars: 40 }, i)), patterns: [quick] })
    expect(cardOf(quick, fast).stats).toBe('3× · 0s · turns 5…7')
    const behavioural = seedState({
      patterns: [chattyPattern],
      turns: [
        { ...turnEnd({ answerChars: 5_400, answerHead: 'Here is the plan again' }), turn: 14, calls: 0 },
        { ...turnEnd({ answerChars: 6_100, answerHead: 'To recap the plan' }), turn: 15, calls: 0 },
      ],
    })
    const card = cardOf(chattyPattern, behavioural)
    expect(card.stats, 'evidence with no recorded duration claims none rather than 0s').toBe('2× · turns 14…15')
    expect(card.evidence).toEqual([
      'turn 15 · no tool calls · 6100ch · "To recap the plan"',
      'turn 14 · no tool calls · 5400ch · "Here is the plan again"',
    ])
  })

  test('paneModel and bandModel are the shapes the UI renders', async () => {
    const waster: Pattern = { ...suitePattern, hits: ['r-1'] }
    const steeredLog: Pattern = {
      ...suitePattern, id: 'reading:unfiltered-log-dump', category: 'reading', kind: 'Claude keeps dumping the whole api log',
      signature: { tool: 'Bash', key: 'read:cat api.log' }, hits: ['r-3'], decision: 'steer', decidedAtTurn: 7,
      lastDecision: 'steer', instruction: 'grep it', openedAtTurn: null, ignored: 1,
    }
    const keptChat: Pattern = { ...chattyPattern, decision: 'keep', decidedAtTurn: 3, lastDecision: 'keep' }
    const state = seedState({
      turn: 12,
      rows: [
        withSeq({ id: 'r-1', turn: 5, ms: 60_000, chars: 9_000 }, 1),
        withSeq({ id: 'r-3', turn: 11, key: 'read:cat api.log', cls: 'read', ms: 2_000, chars: 40_000, head: 'INFO booting' }, 3),
      ],
      turns: [1, 2, 3].map(turn => ({ ...turnEnd(), turn, calls: 2 })),
      usage: { window: 200_000, tokens: 128_000, percent: 64, compactAt: 180_000 },
      usageSamples: [{ turn: 1, percent: 60 }, { turn: 2, percent: 64 }],
      patterns: [waster, steeredLog, keptChat],
      cards: [waster.id], expanded: waster.id, steering: waster.id, steerDraft: 'draft',
      judge: { lastAtTokens: 0, lastAtTurn: 3, running: true, runs: 2, spent: 600, backoff: 1, error: null, focus: 'auth', last: null },
      saved: { ms: 192_000, chars: 36_000 },
    })
    const model = paneModel(state, [claudeMdArtifact])
    expect(model.header).toEqual({
      percent: 64, spark: [60, 64], tokensToCompaction: 52_000, turnsToCompaction: 5,
      judgeRuns: 2, judgeTokens: 600, judgeShare: 2, judgeRunning: true, savedPct: 4.5, savedMs: 192_000,
    })
    expect(model.wasters.map(c => c.patternId)).toEqual([waster.id])
    expect(model).toMatchObject({ expanded: waster.id, steering: waster.id, steerDraft: 'draft' })
    expect(model.decided).toEqual([
      { patternId: steeredLog.id, choice: 'steer', kind: steeredLog.kind, savedPct: 5, ignored: 1 },
      { patternId: keptChat.id, choice: 'keep', kind: keptChat.kind, savedPct: null, ignored: 0 },
    ])
    expect(model.artifacts).toEqual([claudeMdArtifact])
    expect(bandModel(state)).toEqual({ percent: 64, tokensToCompaction: 52_000, fresh: 1, savedPct: 4.5, paneOpen: false })
    const empty = paneModel(seedState(), [])
    expect(empty.wasters).toEqual([])
    expect(empty.decided).toEqual([])
    expect(empty.header).toMatchObject({ percent: null, spark: [], tokensToCompaction: null, turnsToCompaction: null, savedPct: 0 })
    expect(bandModel(seedState())).toEqual({ percent: null, tokensToCompaction: null, fresh: 0, savedPct: 0, paneOpen: false })
  })

  test('tokensToCompaction and turnsToCompaction fall back and go null', async () => {
    expect(tokensToCompaction(seedState())).toBeNull()
    expect(turnsToCompaction(seedState())).toBeNull()
    const noThreshold = seedState({ usage: { window: 200_000, tokens: 50_000 } })
    expect(tokensToCompaction(noThreshold)).toBe(130_000)
    expect(turnsToCompaction(noThreshold)).toBeNull()
    expect(turnsToCompaction({ ...noThreshold, turns: [1, 2].map(turn => ({ ...turnEnd(), turn, calls: 1 })) })).toBeNull()
    expect(turnsToCompaction({ ...noThreshold, turns: [1, 2, 3].map(turn => ({ ...turnEnd(), turn, calls: 1 })) })).toBe(13)
    expect(turnsToCompaction({ ...noThreshold, turns: [1, 2, 3].map(turn => ({ ...turnEnd({ input: 0, output: 0, cacheCreate: 0 }), turn, calls: 1 })) })).toBeNull()
    expect(tokensToCompaction(seedState({ usage: { window: 200_000, tokens: 100_000, compactAt: 150_000 } }))).toBe(50_000)
  })

  test('debugDump stays inside 40 lines and shows hits, decisions and instructions', async () => {
    const state = seedState({
      turn: 9, seq: 2,
      rows: [withSeq({ id: 'r-1' }, 1), withSeq({ id: 'r-2', key: 'read:cat log', cls: 'read' }, 2)],
      turns: [1, 2, 3].map(turn => ({ ...turnEnd(), turn, calls: 1 })),
      usage: { window: 200_000, tokens: 90_000, percent: 45, compactAt: 180_000 },
      overhead: { memory: 1_200, mcp: 800, agents: 400 }, compactions: [4],
      patterns: [{ ...suitePattern, hits: ['r-1'], decision: 'steer', decidedAtTurn: 5, lastDecision: 'steer', instruction: 'first line\nsecond line', openedAtTurn: 5, ignored: 1 }],
      cards: [suitePattern.id], notes: ['n'], standing: ['s'], saved: { ms: 192_000, chars: 36_000 },
    })
    const dump = debugDump(state)
    expect(dump.split('\n').length).toBeLessThanOrEqual(40)
    expect(dump).toContain('test×1 read×1')
    expect(dump).toContain('hits 1 [r-1]')
    expect(dump).toContain('steer @ 5')
    expect(dump).toContain('ignored 1')
    expect(dump).toContain('first line\\nsecond line')
    expect(dump).toContain('toCompaction 90000')
    expect(dump).toContain('notes 1 · standing 1')
    expect(dump).toContain('saved 3m 12s · ~4.5% · 36000 chars')
    const crowded = seedState({ patterns: Array.from({ length: 60 }, (_, i) => ({ ...suitePattern, id: `execution:waster-${i}` })) })
    expect(debugDump(crowded).split('\n').length).toBeLessThanOrEqual(40)
    expect(debugDump(crowded)).toContain('… 40 more patterns')
  })

  test('reduce never mutates the state it is given', async () => {
    const state = seedState({
      turn: 6, seq: 1, rows: [withSeq({ id: 'r-1' }, 1)], patterns: [steered()],
      cards: [suitePattern.id], notes: ['n'], standing: ['s'],
    })
    const before = JSON.stringify(state)
    const actions: Action[] = [
      { type: 'turn.start' },
      { type: 'row', row: testRow({ id: 'r-2', turn: 6 }) },
      { type: 'turn.complete', stat: turnEnd() },
      { type: 'usage', usage: { window: 200_000, tokens: 10, percent: 5 }, now: 1 },
      { type: 'decide', patternId: suitePattern.id, choice: 'kill' },
      { type: 'judge.done', patterns: [suitePattern], fresh: [suitePattern.id], recurred: [], focus: null, spent: 5, error: null, returned: 0, kept: 0, dropped: [] },
      { type: 'standing.add', text: 'more' },
      { type: 'reset' },
    ]
    for (const action of actions) {
      expect(reduce(state, action)).not.toBe(state)
      expect(JSON.stringify(state)).toBe(before)
    }
  })
})
