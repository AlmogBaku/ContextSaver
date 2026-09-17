import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { AUTO_OPEN_MIN_COLUMNS, JUDGE_MIN_GAP_MS, JUDGE_MIN_NEW_ROWS } from '../hooks/core/types'
import { assistant } from './fixtures/adopt/assistant'
import { bashUse } from './fixtures/adopt/bashUse'
import { prompt } from './fixtures/adopt/prompt'
import { rawFinding } from './fixtures/judge/rawFinding'
import { replyText } from './fixtures/judge/replyText'
import { bandRender } from './fixtures/register/bandRender'
import { bashAnswer } from './fixtures/register/bashAnswer'
import { CLEAR_RUN } from './fixtures/register/clearRun'
import { compactedMessage } from './fixtures/register/compactedMessage'
import { forkAnswer } from './fixtures/register/forkAnswer'
import { joinedTranscript } from './fixtures/register/joinedTranscript'
import { paneRender } from './fixtures/register/paneRender'
import { promptSubmit } from './fixtures/register/promptSubmit'
import { saverRun } from './fixtures/register/saverRun'
import { SESSION } from './fixtures/register/session'
import { startsSaver } from './fixtures/register/startsSaver'
import { storedSuite } from './fixtures/register/storedSuite'
import { usageAnswer } from './fixtures/register/usageAnswer'

const SUITE_ID = 'execution:full-suite-after-each-edit'
const CALL_MS = 8_000
const OUT_CHARS = 9_000
const TURN_USAGE = { input_tokens: 20_000, output_tokens: 1_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 1_000, model: 'claude-opus-4-6' }
const SUITE_REPLY = replyText([rawFinding({ evidence: ['r1', 'r4'] })])
const LOG_ID = 'reading:unfiltered-log-dump'
const LOG_FINDING = rawFinding({ id: LOG_ID, category: 'reading', kind: 'Claude keeps dumping the whole api log', evidence: ['r2', 'r3'] })
const TWO_REPLY = replyText([rawFinding({ evidence: ['r1', 'r2'] }), LOG_FINDING])
const RESTATES_FINDING = rawFinding({
  id: 'communication:restates-the-plan',
  category: 'communication',
  kind: 'Claude keeps restating the plan before every step',
  evidence: ['turn:1', 'turn:2'],
  signature: null,
  why: 'the stated intent was to implement, and turns 1 and 2 restate the plan before touching anything',
  est_tokens_per_turn: 800,
})

// The transcript of a session joined late with a long history: a whole row gate's worth of finished calls.
const LONG_TRANSCRIPT = Array.from({ length: JUDGE_MIN_NEW_ROWS }, (_, at) => [
  prompt(`step ${at + 1}`),
  assistant([bashUse({ tool_use_id: `u-${at + 1}` })]),
]).flat()

// Everything a plugin tree draws, flattened to the strings a person would read.
const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value !== 'object' || value === null) return ''
  const node = value as { props?: Record<string, unknown>; children?: unknown }
  const label = node.props?.label
  const held = node.props?.value
  const own = typeof label === 'string' ? label : typeof held === 'string' ? held : ''
  return `${own} ${textOf(node.children)}`
}

// Runs whole main-loop turns: each its own turn.start, so many tool calls, then a turn.complete with usage.
const runTurns = async ($: Engine, turns: number, callsPerTurn: number): Promise<void> => {
  for (let turn = 1; turn <= turns; turn += 1) {
    await $.turn.start({ text: 'keep going', turnId: `t${turn}` })
    for (let call = 1; call <= callsPerTurn; call += 1) await $.tool.call({ tool: 'Bash', command: 'bun test' })
    await $.turn.complete({ answer: 'done', durationMs: 60_000, isAborted: false, turnId: `t${turn}`, reason: 'answer', usage: TURN_USAGE })
  }
}

describe('register', () => {
  test('session.start binds the host, registers /saver, loads the registry and samples the usage', async ($, on) => {
    const world = startsSaver(on, { 'patterns:/work': [storedSuite] })

    await $.session.start(SESSION)

    expect(world.commands, '/saver was registered once').toEqual(['saver'])

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain('usage 12% · 24000 / 200000 tokens · compactAt 180000')
    expect(debug.text).toContain('overhead memory 1200 · mcp 3400 · agents 800')
    expect(debug.text).toContain(`${SUITE_ID} · hits 0`)
    expect(debug.text).toContain('previous kill')
  })

  test('session.start adopts the transcript of a session the plugin joined late', async ($, on) => {
    const world = startsSaver(on)
    const prompts: string[] = []
    let atRead: string[] = []
    mock.env(on, { CONTEXTSAVER_DEBUG: '1' })
    on('session.messages', () => {
      atRead = [...world.commands]
      return { value: joinedTranscript }
    })
    on('model.fork', ($, e) => {
      prompts.push(e.prompt)
      return { value: forkAnswer(replyText([])) }
    })

    await $.session.start(SESSION)

    expect(atRead, 'the command was registered before the transcript was read').toEqual(['saver'])
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'the three calls of the three turns already run came back').toContain('turn 3 · seq 3 · rows 3 · turns 0')
    expect(debug.text).toContain('rows test×3')
    expect(world.logs, 'the debug flag says what was adopted, and what judges it')
      .toEqual(['ContextSaver adopted 3 rows from the transcript · /saver check judges them now'])

    await $.command.run(saverRun('check'))
    await world.clock.settle()

    expect(prompts[0], 'a recovered row says so, with no duration and no loop to reason about')
      .toContain('r1 | Bash | test:bun test | test | main | 1 | 0 | 8 | recovered | -')
  })

  test('a reload adopts the same transcript again without doubling the ledger', async ($, on) => {
    startsSaver(on)
    on('session.messages', () => ({ value: joinedTranscript }))

    await $.session.start(SESSION)
    await $.session.start(SESSION)   // a `/reload-plugins` or a `--plugin-dir` save fires `session.start` again (d.ts 3106-3111)

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'the reload re-initialises the state before it adopts, so no row and no seq is counted twice')
      .toContain('turn 3 · seq 3 · rows 3 · turns 0')
  })

  test('a transcript the host refuses leaves the session standing', async ($, on) => {
    const world = startsSaver(on)
    let atRead: string[] = []
    on('session.messages', () => {
      atRead = [...world.commands]
      return { deny: 'no transcript today' }
    })
    on('tool.call', () => bashAnswer(OUT_CHARS))

    await $.session.start(SESSION)

    expect(atRead, 'the refusal came after the command was registered').toEqual(['saver'])
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'nothing was adopted').toContain('turn 0 · seq 0 · rows 0 · turns 0')
    expect(debug.text, 'what the session did report is still there').toContain('usage 12% · 24000 / 200000 tokens')

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect((await $.command.run(saverRun('debug'))).text, 'the ledger records from here on').toContain('rows 1')
  })

  test('tool.call times the call from the clock, sizes it from the text and hands it to the judge', async ($, on) => {
    const world = startsSaver(on)
    const prompts: string[] = []
    mock.env(on, { CONTEXTSAVER_DEBUG: '1' })
    on('tool.call', async () => {
      await world.clock.advance(CALL_MS)
      return bashAnswer(OUT_CHARS)
    })
    on('model.fork', ($, e) => {
      prompts.push(e.prompt)
      return { value: forkAnswer(replyText([])) }
    })

    await $.session.start(SESSION)
    await $.turn.start({ text: 'fix the auth refresh', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'bun test' })

    expect((await $.command.run(saverRun('debug'))).text).toContain('turn 1 · seq 1 · rows 1')
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    expect(prompts, 'the judge was asked once').toHaveLength(1)
    expect(prompts[0], 'the row carries the time the clock measured and the size of the text')
      .toContain(`r1 | Bash | test:bun test | test | main | 1 | ${CALL_MS} | ${OUT_CHARS} | -`)
    expect(world.logs, 'the debug flag logs every row it recorded, a run that found nothing as nothing, and what the fork cost')
      .toEqual([
        `ContextSaver row r1 Bash test:bun test ${CALL_MS}ms ${OUT_CHARS}ch`,
        'ContextSaver judge: 0 returned · 0 kept · 0 dropped · from /saver check',
        'judge usage: in 900 · out 300 · cache read 40000 · cache create 100',
      ])
  })

  test('the judge cadence names a waster, the pane kills it and the next tool result carries the note', async ($, on) => {
    const world = startsSaver(on)
    const prompts: string[] = []
    mock.env(on, { CONTEXTSAVER_DEBUG: '1' })
    on('tool.call', async () => {
      await world.clock.advance(CALL_MS)
      return bashAnswer(OUT_CHARS)
    })
    on('model.fork', ($, e) => {
      prompts.push(e.prompt)
      return { value: forkAnswer(SUITE_REPLY) }
    })

    await $.session.start(SESSION)
    await runTurns($, 3, 3)
    await world.clock.settle()

    expect(prompts, 'three turns and nine rows past the gates: one fork').toHaveLength(1)
    expect(world.logs, 'the log says which lane started the run: this one is the cadence mid-turn, not a press')
      .toEqual(expect.arrayContaining(['ContextSaver judge: 1 returned · 1 kept · 0 dropped · from tool.call']))
    expect(prompts[0]).toContain('## STATS')
    expect(prompts[0]).toContain('## LEDGER')

    const drawn = textOf(await $.ui.render(paneRender()))
    expect(drawn, 'the waster the judge named leads the pane').toContain('Claude keeps running the whole bun test suite')
    expect(drawn, 'the first verb reads Fix; the key behind it is still kill').toContain('✓ Fix')

    await $.ui.press({ plugin: 'contextsaver', key: `card:${SUITE_ID}:kill` })
    await world.clock.settle()

    expect(world.toasts.join(' ')).toContain('ContextSaver: fixed —')
    const debug = await $.command.run(saverRun('debug'))
    // Two rows were cited; the third `bun test` of the turn landed under the signature after the run.
    expect(debug.text).toContain(`${SUITE_ID} · hits 3`)
    expect(debug.text).toContain('kill @ 3')
    expect(debug.text).toContain('cards 0')

    expect(textOf(await $.ui.render(paneRender())), 'the kill is offered as a rule for the next session').toContain('Write')
    await $.ui.press({ plugin: 'contextsaver', key: `skip:${SUITE_ID}` })
    await world.clock.settle()
    expect(textOf(await $.ui.render(paneRender())), 'a skipped rule is never offered again this session').not.toContain('Write')

    const answered = await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect(answered.context?.join(' '), 'the kill rides the next tool result')
      .toContain('Stop this behaviour for the rest of the session')
    expect((await $.command.run(saverRun('debug'))).text, 'the one-shot note is spent').toContain('notes 0 · standing 1')

    await runTurns($, 2, 0)   // two quiet turns and the instruction is credited
    expect(world.toasts.join(' '), 'what the kill saved is said once, in time and in context')
      .toContain('+8s · +~1.1% context saved')
    expect((await $.command.run(saverRun('debug'))).text).toContain('saved 8s · ~1.1%')
  })

  test('a run that returned two findings and kept one says so in the log and in debug', async ($, on) => {
    const world = startsSaver(on)
    const bogus = rawFinding({ id: LOG_ID, category: 'reading', kind: 'Claude keeps dumping the whole api log', evidence: ['r1', 'r99'] })
    mock.env(on, { CONTEXTSAVER_DEBUG: '1' })
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(replyText([rawFinding({ evidence: ['r1', 'r2'] }), bogus])) }))

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    expect(world.logs, 'the debug flag says what the judge returned, why a finding never reached the user, and what the fork cost')
      .toEqual(expect.arrayContaining([
        'ContextSaver judge: 2 returned · 1 kept · 1 dropped · from /saver check',
        `${LOG_ID}: evidence r99 not in the ledger`,
        // The stub's own counts: a cold cache is what makes a run expensive, and this one read 40k of it.
        'judge usage: in 900 · out 300 · cache read 40000 · cache create 100',
      ]))
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain('judge last: 2 returned · 1 kept · 1 dropped')
    expect(debug.text, 'and `/saver debug` prints the same line').toContain('judge usage: in 900 · out 300 · cache read 40000 · cache create 100')
    expect(debug.text).toContain(`  ${LOG_ID}: evidence r99 not in the ledger`)
    expect(debug.text, 'the finding that survived is the only card').toContain('cards 1')
  })

  test('a behavioural instruction is credited once, and its per-turn accrual stays quiet', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(replyText([RESTATES_FINDING])) }))

    await $.session.start(SESSION)
    for (const turn of [1, 2]) {
      await $.turn.start({ text: 'go', turnId: `t${turn}` })
      await $.tool.call({ tool: 'Bash', command: 'bun test' })
      // A long answer is what grounds the judge's per-turn estimate.
      await $.turn.complete({ answer: 'x'.repeat(4_000), durationMs: 1_000, isAborted: false, turnId: `t${turn}`, reason: 'answer', usage: TURN_USAGE })
    }
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    await $.command.run(saverRun('fix state the result in one line'))
    const spoken = world.toasts.length

    await runTurns($, 5, 0)

    expect(world.toasts.slice(spoken).filter(text => text.includes('context saved')), 'the credit is said once, not every turn')
      .toEqual(['+~0.4% context saved'])
    expect((await $.command.run(saverRun('debug'))).text, 'what the instruction keeps saving is still counted').toContain('saved 0s · ~2% · 16000 chars')
  })

  // The ring the press asks for is the surface's to move: nothing beneath a test answers `ui.focus`, so
  // what is asserted here is the pane's own half — the field opens, closes, and a refused ring is no error.
  test('pressing Fix… opens the field it asks the ring for, and pressing it again closes it', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(SUITE_REPLY) }))

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    await $.ui.render(paneRender())

    await $.ui.press({ plugin: 'contextsaver', key: `card:${SUITE_ID}:steer` })
    await world.clock.settle()

    expect(textOf(await $.ui.render(paneRender())), 'the field is open under the verbs').toContain('Enter sends · Fix… again closes')
    expect(world.toasts, 'a ring the surface would not move is nothing to tell the user about beyond what the check found')
      .toEqual(['ContextSaver: 1 new waster'])

    await $.ui.press({ plugin: 'contextsaver', key: `card:${SUITE_ID}:steer` })
    await world.clock.settle()

    expect((await $.command.run(saverRun('debug'))).text, 'Fix… again closed it').toContain('steering -')
  })

  test('/saver fix with a note decides the newest waster and every later prompt carries the standing text', async ($, on) => {
    const world = startsSaver(on)
    const submitted: (readonly string[] | undefined)[] = []
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(SUITE_REPLY) }))
    on('prompt.submit', ($, e) => {
      submitted.push(e.context)
      return { text: e.text }
    })

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    const steered = await $.command.run(saverRun('fix  run only the covering tests'))
    expect(steered.text, 'the reply names the card it decided')
      .toBe(`ContextSaver: card 1 — "Claude keeps running the whole bun test suite after every s…" · fixed with your note: run only the covering tests`)
    expect(world.toasts.join(' ')).toContain('ContextSaver: fixed with your note — run only the covering tests')

    await $.prompt.submit(promptSubmit('now fix the token refresh'))
    expect(submitted[0]?.join(' '), 'the note and the standing text ride the prompt')
      .toContain('Instruction from the user (via ContextSaver): run only the covering tests')
    expect(submitted[0], 'the standing copy of the note is not sent twice').toHaveLength(1)

    await $.prompt.submit(promptSubmit('and now the tests'))
    expect(submitted[1]?.join(' '), 'the standing text rides every later prompt too')
      .toContain('run only the covering tests')

    await $.prompt.submit(promptSubmit('/saver debug'))
    expect(submitted[2], 'a prompt that is a /saver command carries nothing').toBeUndefined()

    expect((await $.command.run(saverRun('fix'))).text, 'the one card was decided, so there is nothing left to fix')
      .toBe('ContextSaver: nothing to decide on')
  })

  test('/saver fix takes the number the pane draws beside the card', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(TWO_REPLY) }))

    await $.session.start(SESSION)

    expect((await $.command.run(saverRun('ignore 1'))).text, 'nothing has been found yet').toBe('ContextSaver: nothing to decide on')
    expect((await $.command.run(saverRun('fix do less'))).text).toBe('ContextSaver: nothing to decide on')

    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    // The judge reported the suite first, so the pane draws it as card 1 and the log as card 2.
    expect((await $.command.run(saverRun('debug'))).text).toContain(`cards 2: ${SUITE_ID}, ${LOG_ID}`)
    expect((await $.command.run(saverRun('ignore 3'))).text, 'a number no card wears says so')
      .toBe('ContextSaver: no card 3 (1–2)')
    expect((await $.command.run(saverRun('ignore nonsense'))).text)
      .toBe('Usage: /saver [check | fix [n] [text] | ignore <n> | debug | reset]')
    expect((await $.command.run(saverRun('fix'))).text, 'a fix with neither a number nor a note is a usage question')
      .toContain('Usage: /saver fix [n] [instruction]')

    const steered = await $.command.run(saverRun('fix 2 read the log with a filter'))
    expect(steered.text, 'a leading number picks the card and never lands in the note')
      .toBe('ContextSaver: card 2 — "Claude keeps dumping the whole api log" · fixed with your note: read the log with a filter')
    expect(world.toasts.join(' ')).toContain('ContextSaver: fixed with your note — read the log with a filter')

    // One card left, so 9 is no card: a mistyped number is refused, never folded into the note.
    const loose = await $.command.run(saverRun('fix 9 lives left in the suite'))
    expect(loose.text, 'a number no card wears is a numbering mistake, not the first word')
      .toBe('ContextSaver: no card 9 (1–1)')

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'the refused fix sent nothing, so the card is still waiting').toContain('cards 1')
    expect(debug.text).toContain('sent "read the log with a filter"')
    expect(debug.text, 'nothing garbled reached Claude').not.toContain('9 lives left in the suite')
  })

  test('/saver ignore and fix decide by number and say which card they took', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(TWO_REPLY) }))

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    const kept = await $.command.run(saverRun('ignore 1'))
    expect(kept.text)
      .toBe('ContextSaver: card 1 — "Claude keeps running the whole bun test suite after every s…" · ignored')
    expect(world.toasts.join(' ')).toContain('ContextSaver: ignored "Claude keeps running the whole bun test suite')

    // The ignored card left the list, so the log is card 1 now: the numbers are the pane's, live.
    const killed = await $.command.run(saverRun('fix 1'))
    expect(killed.text).toBe('ContextSaver: card 1 — "Claude keeps dumping the whole api log" · fixed')
    expect(world.toasts.join(' ')).toContain('ContextSaver: fixed —')

    const answered = await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect(answered.context?.join(' '), 'the fix rides the next tool result, as the pane\'s own Fix does')
      .toContain('Stop this behaviour for the rest of the session')
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain('keep @ 1')
    expect(debug.text).toContain('kill @ 1')
  })

  test('/saver toggles the pane, /clear resets the session and the store keeps the registry', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(SUITE_REPLY) }))
    on('command.run', { command: 'clear' }, () => ({}))

    await $.session.start(SESSION)

    expect((await $.command.run(saverRun())).text).toBe('ContextSaver pane shown')
    expect(world.opened.map(pane => pane.id)).toEqual(['saver'])
    expect((await $.command.run(saverRun())).text).toBe('ContextSaver pane hidden')
    expect(world.closed.map(pane => pane.id)).toEqual(['saver'])

    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    await $.ui.render(paneRender())
    await $.ui.press({ plugin: 'contextsaver', key: `card:${SUITE_ID}:keep` })
    await world.clock.settle()

    expect(world.store['patterns:/work'], 'the decision was persisted for the next session')
      .toEqual([expect.objectContaining({ id: SUITE_ID, lastDecision: 'keep' })])

    await $.command.run(CLEAR_RUN)

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'the session is empty again').toContain('turn 0 · seq 0 · rows 0 · turns 0')
    expect(debug.text, 'the registry survived, its evidence did not').toContain(`${SUITE_ID} · hits 0`)
    expect(debug.text).toContain('previous keep')
    expect((await $.command.run(saverRun('nonsense'))).text)
      .toBe('Usage: /saver [check | fix [n] [text] | ignore <n> | debug | reset]')
    expect((await $.command.run(saverRun('reset'))).text).toBe('ContextSaver: session state reset')
  })

  test('turn.complete records the turn, re-samples the usage and leaves a subagent alone', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('session.compact', ($, e) => ({ messages: e.messages }))

    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    world.usage = { tokens: 60_000, percent: 30 }
    await $.turn.complete({ answer: 'all done', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer', usage: TURN_USAGE })

    const first = await $.command.run(saverRun('debug'))
    expect(first.text, 'the turn was recorded with the call it made').toContain('turn 1 · seq 1 · rows 1 · turns 1')
    expect(first.text, 'the usage was sampled again after the turn').toContain('usage 30% · 60000 / 200000 tokens')
    expect(first.text, 'the new tokens of the turn are the judge budget').toContain('session 22000 new')

    await $.turn.complete({ answer: 'from the subagent', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'agent-1', usage: TURN_USAGE })
    expect((await $.command.run(saverRun('debug'))).text, "a subagent's turn is none of ours").toContain('turns 1')

    await $.session.compact({ trigger: 'auto', messages: [compactedMessage] })
    const after = await $.command.run(saverRun('debug'))
    expect(after.text).toContain('compactions 1')
    expect(after.text, 'the fill a compaction invalidated is forgotten until the next turn reports one')
      .toContain('usage -% · - / 200000 tokens')
  })

  // The turn stat is recorded first or not at all, so a refused sample may not take the turn with it:
  // without `state.turns` there is no token gate, no `turn:<n>` handle and no pace to compaction.
  test('a turn whose usage the host refused is still a turn', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))

    await $.session.start(SESSION)
    world.denyUsage = true
    await runTurns($, 1, 1)

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'the turn is on the record with the call it made').toContain('turn 1 · seq 1 · rows 1 · turns 1')
    expect(debug.text, 'the tokens it was billed are still the judge budget').toContain('session 22000 new')
    expect(debug.text, 'only the context sample of that turn was lost').toContain('turnsLeft -')
  })

  test('the band wraps what is beneath it and every other drawing falls through', async ($, on) => {
    startsSaver(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'beneath' })
    })

    await $.session.start(SESSION)

    const band = textOf(await $.ui.render(bandRender(100)))
    expect(band, 'the band draws above what was already there').toContain('beneath')
    expect(band).toContain('ContextSaver')
    expect(band, 'nothing found and nothing saved yet, so the band says it is watching').toContain('watching')

    const surveyed = textOf(await $.ui.render(bandRender(100, true)))
    expect(surveyed, 'a survey owns the band, so the plugin stands down').toContain('beneath')
    expect(surveyed).not.toContain('ContextSaver')

    const other = textOf(await $.ui.render(paneRender('diff')))
    expect(other, "another plugin's pane is never hijacked").toContain('beneath')
    expect(other).not.toContain('Nothing repeating yet.')

    const own = textOf(await $.ui.render(paneRender()))
    expect(own, 'our own pane is ours to draw').toContain('Nothing repeating yet.')
    expect(own).not.toContain('beneath')
  })

  test('a cadence run opens the pane once, and only where the surface would draw it', async ($, on) => {
    const world = startsSaver(on)
    const replies = [
      replyText([rawFinding({ evidence: ['r1', 'r2'] })]),
      replyText([LOG_FINDING]),
      replyText([rawFinding({ id: 'process:done-without-a-check', category: 'process', kind: 'Claude keeps calling the work done with no check run', evidence: ['r3', 'r4'] })]),
    ]
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(replies.shift() ?? replyText([])) }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return Box({})
    })

    await $.session.start(SESSION)

    await $.ui.render(bandRender(AUTO_OPEN_MIN_COLUMNS - 1))
    await runTurns($, 3, 3)
    await world.clock.settle()
    expect(world.opened, 'too narrow for an unasked pane: the band is the only signal').toEqual([])

    await $.ui.render(bandRender(AUTO_OPEN_MIN_COLUMNS))
    await runTurns($, 3, 3)
    await world.clock.settle()
    expect(world.opened.map(pane => pane.id), 'the fresh card opened the pane').toEqual(['saver'])

    await runTurns($, 3, 3)
    await world.clock.settle()
    expect(world.opened, 'the pane opens itself once a session').toHaveLength(1)
    expect((await $.command.run(saverRun('debug'))).text).toContain('cards 3')
    expect(world.toasts.filter(text => text.startsWith('ContextSaver: ')), 'a cadence run says nothing about itself')
      .toEqual([])
  })

  // The judge never ran through a three-hour agentic turn: `turn.complete` was the only cadence there was.
  test('a storm of tool calls inside one long turn is judged mid-turn, once', async ($, on) => {
    const world = startsSaver(on)
    const prompts: string[] = []
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', ($, e) => {
      prompts.push(e.prompt)
      return { value: forkAnswer(SUITE_REPLY) }
    })

    await $.session.start(SESSION)
    await $.turn.start({ text: 'rewrite the proxy layer', turnId: 't1' })
    await world.clock.advance(JUDGE_MIN_GAP_MS)
    for (let call = 1; call <= JUDGE_MIN_NEW_ROWS + 5; call += 1) await $.tool.call({ tool: 'Bash', command: 'bun test' })
    await world.clock.settle()

    expect(prompts, 'one fork, from the rows and the clock alone').toHaveLength(1)
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'no turn ever completed').toContain(`turn 1 · seq ${JUDGE_MIN_NEW_ROWS + 5} · rows ${JUDGE_MIN_NEW_ROWS + 5} · turns 0`)
    // The clock has not moved since the fork, so `world.clock.now()` is the moment the run began.
    expect(debug.text, 'the run is dated by the row and the clock it started at').toContain(`/ row ${JUDGE_MIN_NEW_ROWS} / ${world.clock.now()}ms`)
    expect(debug.text, 'and the card is in front of the user while the turn is still running').toContain('cards 1')
  })

  // The gate's five minutes are five minutes of this session: `lastAtMs` starts at 0 and the clock reads
  // milliseconds since the epoch, so without the seed a fan-out of forty reads would fork the judge at once.
  test('forty calls in the first minute of a session are no cadence', async ($, on) => {
    const world = startsSaver(on)
    let forks = 0
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => {
      forks += 1
      return { value: forkAnswer(SUITE_REPLY) }
    })

    await $.session.start(SESSION)
    await $.turn.start({ text: 'read the whole package', turnId: 't1' })
    await world.clock.advance(JUDGE_MIN_GAP_MS - 1)
    for (let call = 1; call <= JUDGE_MIN_NEW_ROWS + 5; call += 1) await $.tool.call({ tool: 'Bash', command: 'bun test' })
    await world.clock.settle()

    expect(forks, 'the rows are there, the five minutes are not').toBe(0)
  })

  // A session joined late adopts hundreds of rows: they are history, not new work, so they are no cadence
  // either — and the very first tool call of that session must not fork the judge on a ledger of them.
  test('the rows a joined session adopted are not counted as new work', async ($, on) => {
    const world = startsSaver(on)
    let forks = 0
    on('session.messages', () => ({ value: LONG_TRANSCRIPT }))
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => {
      forks += 1
      return { value: forkAnswer(replyText([])) }
    })

    await $.session.start(SESSION)
    await $.turn.start({ text: 'carry on', turnId: 'later' })
    await world.clock.advance(JUDGE_MIN_GAP_MS)
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    await world.clock.settle()

    expect(forks, 'the adopted rows judge nothing by themselves').toBe(0)
    expect((await $.command.run(saverRun('debug'))).text, 'the cadence counts from where the history ended')
      .toContain(`/ row ${JUDGE_MIN_NEW_ROWS} /`)
  })

  test('a check the user asked for says what it found and opens the pane at any width', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(SUITE_REPLY) }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return Box({})
    })

    await $.session.start(SESSION)
    await $.ui.render(bandRender(80))
    await runTurns($, 1, 4)

    expect((await $.command.run(saverRun('check'))).text).toBe('ContextSaver: checking this session for waste…')
    await world.clock.settle()

    expect(world.toasts, 'a check that found something says how much').toEqual(['ContextSaver: 1 new waster'])
    expect(world.opened.map(pane => pane.id), 'the person is waiting for the answer, so 80 columns is wide enough')
      .toEqual(['saver'])
  })

  // D4: the steered behaviour came back. A check that answers `nothing new` hides the one card that matters.
  test('a check counts a behaviour that came back as news', async ($, on) => {
    const world = startsSaver(on)
    const replies = [SUITE_REPLY, replyText([rawFinding({ evidence: ['r5', 'r8'] })])]
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(replies.shift() ?? SUITE_REPLY) }))

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    await $.command.run(saverRun('fix run only the tests covering what you changed'))

    // The suite runs again in a later turn, and the judge reports the same id citing those rows.
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    expect(world.toasts.at(-1), 'a recurrence is news, and it is the news the user asked to hear about')
      .toBe('ContextSaver: 1 new waster')
    expect((await $.command.run(saverRun('debug'))).text, 'and the card the toast counted is the one in the pane')
      .toContain(`cards 1: ${SUITE_ID}`)
  })

  // Cadence runs are frequent inside a long turn: an ask that lands during one must be answered by it.
  test('a check asked for while a cadence run is in flight is answered by that run', async ($, on) => {
    const world = startsSaver(on)
    let forks = 0
    let release = (): void => undefined
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => {
      forks += 1
      return new Promise(resolve => {
        release = () => resolve({ value: forkAnswer(SUITE_REPLY) })
      })
    })

    await $.session.start(SESSION)
    await $.turn.start({ text: 'rewrite the proxy layer', turnId: 't1' })
    await world.clock.advance(JUDGE_MIN_GAP_MS)
    for (let call = 1; call <= JUDGE_MIN_NEW_ROWS; call += 1) await $.tool.call({ tool: 'Bash', command: 'bun test' })

    expect((await $.command.run(saverRun('check'))).text, 'the run already going is the one that answers')
      .toBe('ContextSaver: already checking')

    release()
    await world.clock.settle()

    expect(forks, 'the ask forked nothing of its own').toBe(1)
    expect(world.toasts, 'and the person who asked is told what it found').toEqual(['ContextSaver: 1 new waster'])
  })

  test('a check that found nothing says so, and a second one while it runs forks nothing', async ($, on) => {
    const world = startsSaver(on)
    let forks = 0
    let release = (): void => undefined
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => {
      forks += 1
      return new Promise(resolve => {
        release = () => resolve({ value: forkAnswer(replyText([])) })
      })
    })

    await $.session.start(SESSION)
    await runTurns($, 1, 4)

    expect((await $.command.run(saverRun('check'))).text).toBe('ContextSaver: checking this session for waste…')
    expect((await $.command.run(saverRun('check'))).text, 'the second ask is answered, not obeyed').toBe('ContextSaver: already checking')
    await $.ui.render(paneRender())
    await $.ui.press({ plugin: 'contextsaver', key: 'check' })
    expect(world.toasts, 'Check now dims while the run is in flight, so the press says nothing').toEqual([])

    release()
    await world.clock.settle()

    expect(forks, 'one fork for the two asks and the press').toBe(1)
    expect(world.toasts.at(-1), 'a run that found nothing says that too').toBe('ContextSaver: nothing new')
    expect(world.opened, 'nothing found, nothing to show').toEqual([])
  })

  test('a check the fork refused says why it failed', async ($, on) => {
    const world = startsSaver(on)
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ deny: 'no forking today' }))

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()

    expect(world.toasts.join(' ')).toContain('ContextSaver: check failed — ')
    expect((await $.command.run(saverRun('debug'))).text, 'and the judge is not left running').toContain('running false')
  })

  test('a stub that throws or denies beneath a hook leaves the session standing', async ($, on) => {
    const world = startsSaver(on)
    const attempts: string[] = []
    on('tool.call', ($, e) => {
      attempts.push(e.tool)
      if (e.tool === 'Bash' && e.command === 'boom') throw new Error('the tool blew up')
      return bashAnswer(OUT_CHARS)
    })
    on('model.fork', () => ({ deny: 'no forking today' }))

    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })

    // The deepest failure is the engine's to report: the hook adds no failure of its own and runs the tool once.
    await expect($.tool.call({ tool: 'Bash', command: 'boom' })).rejects.toThrow()
    expect(attempts, 'the tool beneath ran once: a failed dispatch is never re-run').toEqual(['Bash'])

    await $.tool.call({ tool: 'Bash', command: 'bun test' })
    expect((await $.command.run(saverRun('debug'))).text, 'the ledger kept recording after the failure').toContain('rows 1')

    expect((await $.command.run(saverRun('check'))).text).toBe('ContextSaver: checking this session for waste…')
    await world.clock.settle()

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text, 'the refused fork is remembered, not retried in a loop').toContain('no forking today')
    expect(debug.text, 'the judge is not left running').toContain('running false')
  })

  test('Write appends only the bullet under an existing heading, and Try once sends it for this session', async ($, on) => {
    const world = startsSaver(on)
    const writes: { path: string; text: string }[] = []
    on('tool.call', () => bashAnswer(OUT_CHARS))
    on('model.fork', () => ({ value: forkAnswer(TWO_REPLY) }))
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '# Project\n\n## ContextSaver\n- an older rule\n' }))
    on('fs.write', ($, e) => {
      writes.push({ path: e.path, text: e.text })
      return { value: undefined }
    })

    await $.session.start(SESSION)
    await runTurns($, 1, 4)
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    await $.command.run(saverRun('fix run only the covering tests'))   // the newest card first
    await $.command.run(saverRun('fix read the log with a filter'))

    const drawn = await $.ui.render(paneRender())
    expect(textOf(drawn), 'both decisions are offered as rules for the next session').toContain('Write')

    await $.ui.press({ plugin: 'contextsaver', key: `write:${SUITE_ID}` })
    await world.clock.settle()

    expect(writes, 'one append to the project file').toHaveLength(1)
    expect(writes[0]?.path).toBe('/work/CLAUDE.md')
    expect(writes[0]?.text, 'the heading was already there, so only the bullet was added')
      .toBe('# Project\n\n## ContextSaver\n- an older rule\n- run only the covering tests\n')
    expect(world.toasts.join(' ')).toContain('Wrote /work/CLAUDE.md')

    await $.ui.render(paneRender())
    await $.ui.press({ plugin: 'contextsaver', key: `try:${LOG_ID}` })
    await world.clock.settle()

    expect(world.toasts.join(' '), 'the other rule was taken for this session only').toContain('Trying "')
    expect(writes, 'Try once writes nothing').toHaveLength(1)

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain(`written 2: ${SUITE_ID}:claude-md, ${LOG_ID}:claude-md`)
    expect(debug.text, 'the tried rule is the sentence the note already sent, so it rides once').toContain('standing 2')
    expect(textOf(await $.ui.render(paneRender())), 'a rule once written or tried is not offered again').not.toContain('Write')
  })
})
