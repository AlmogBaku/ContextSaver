import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { AUTO_OPEN_MIN_COLUMNS, JUDGE_MIN_ROWS } from '../hooks/core/types'
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
    expect(world.logs, 'the debug flag logs every row it recorded, and a run that found nothing as nothing')
      .toEqual([
        `ContextSaver row r1 Bash test:bun test ${CALL_MS}ms ${OUT_CHARS}ch`,
        'ContextSaver judge: 0 returned · 0 kept · 0 dropped',
      ])
  })

  test('the judge cadence names a waster, the pane kills it and the next tool result carries the note', async ($, on) => {
    const world = startsSaver(on)
    const prompts: string[] = []
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
    expect(prompts[0]).toContain('## STATS')
    expect(prompts[0]).toContain('## LEDGER')

    const drawn = textOf(await $.ui.render(paneRender()))
    expect(drawn, 'the waster the judge named leads the pane').toContain('Claude keeps running the whole bun test suite')
    expect(drawn).toContain('Kill')

    await $.ui.press({ plugin: 'contextsaver', key: `card:${SUITE_ID}:kill` })
    await world.clock.settle()

    expect(world.toasts.join(' ')).toContain('ContextSaver: told Claude to stop —')
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain(`${SUITE_ID} · hits 2`)
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

    expect(world.logs, 'the debug flag says what the judge returned and why a finding never reached the user')
      .toEqual(expect.arrayContaining([
        'ContextSaver judge: 2 returned · 1 kept · 1 dropped',
        `${LOG_ID}: evidence r99 not in the ledger`,
      ]))
    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain('judge last: 2 returned · 1 kept · 1 dropped')
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
    await $.command.run(saverRun('steer state the result in one line'))
    const spoken = world.toasts.length

    await runTurns($, 5, 0)

    expect(world.toasts.slice(spoken).filter(text => text.includes('context saved')), 'the credit is said once, not every turn')
      .toEqual(['+~0.4% context saved'])
    expect((await $.command.run(saverRun('debug'))).text, 'what the instruction keeps saving is still counted').toContain('saved 0s · ~2% · 16000 chars')
  })

  test('/saver steer decides the newest waster and every later prompt carries the standing text', async ($, on) => {
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

    const steered = await $.command.run(saverRun('steer  run only the covering tests'))
    expect(steered.text).toBe('ContextSaver: Claude will be told — run only the covering tests')
    expect(world.toasts.join(' ')).toContain('ContextSaver: Claude will be told — run only the covering tests')

    await $.prompt.submit(promptSubmit('now fix the token refresh'))
    expect(submitted[0]?.join(' '), 'the note and the standing text ride the prompt')
      .toContain('Instruction from the user (via ContextSaver): run only the covering tests')
    expect(submitted[0], 'the standing copy of the note is not sent twice').toHaveLength(1)

    await $.prompt.submit(promptSubmit('and now the tests'))
    expect(submitted[1]?.join(' '), 'the standing text rides every later prompt too')
      .toContain('run only the covering tests')

    await $.prompt.submit(promptSubmit('/saver debug'))
    expect(submitted[2], 'a prompt that is a /saver command carries nothing').toBeUndefined()

    expect((await $.command.run(saverRun('steer'))).text).toContain('Usage: /saver steer <instruction>')
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
    expect((await $.command.run(saverRun('nonsense'))).text).toBe('Usage: /saver [check | steer <text> | debug | reset]')
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
    expect((await $.command.run(saverRun('debug'))).text).toContain('compactions 1')
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

  test('a fresh card opens the pane once, and only where the surface would draw it', async ($, on) => {
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
    await runTurns($, 1, 4)

    await $.ui.render(bandRender(AUTO_OPEN_MIN_COLUMNS - 1))
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    expect(world.opened, 'too narrow for an unasked pane: the band is the only signal').toEqual([])

    await $.ui.render(bandRender(AUTO_OPEN_MIN_COLUMNS))
    await $.command.run(saverRun('check'))
    await world.clock.settle()
    expect(world.opened.map(pane => pane.id), 'the fresh card opened the pane').toEqual(['saver'])

    await $.command.run(saverRun('check'))
    await world.clock.settle()
    expect(world.opened, 'the pane opens itself once a session').toHaveLength(1)
    expect((await $.command.run(saverRun('debug'))).text).toContain('cards 3')
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
    await $.command.run(saverRun('steer run only the covering tests'))   // the newest card first
    await $.command.run(saverRun('steer read the log with a filter'))

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
    expect(debug.text, 'the tried rule is the sentence the steer already sent, so it rides once').toContain('standing 2')
    expect(textOf(await $.ui.render(paneRender())), 'a rule once written or tried is not offered again').not.toContain('Write')
  })
})
