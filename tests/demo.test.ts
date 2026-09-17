import { describe, expect, mock, test } from 'claude-code/testing'

import { demoPatterns, demoRows, demoTurns, demoUsage } from '../hooks/core/demo'
import { agentAliases } from '../hooks/core/evidence'
import { normalize } from '../hooks/core/ledger'
import { cardOf, parseRegistry, reduce, toStored, tokensToCompaction, turnsToCompaction } from '../hooks/core/patterns'
import { initialState } from '../hooks/core/types'
import type { State } from '../hooks/core/types'
import { paneRender } from './fixtures/register/paneRender'
import { saverRun } from './fixtures/register/saverRun'
import { SESSION } from './fixtures/register/session'
import { startsSaver } from './fixtures/register/startsSaver'

const TURN = 8
const WINDOW = 200_000

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

// The demo's rows in a session of their own, with its patterns beside them.
const sampled = (): State => {
  const ledger = demoRows(TURN).reduce((state, row) => reduce(state, { type: 'row', row }), initialState('/work', WINDOW))
  return { ...ledger, turn: TURN, patterns: demoPatterns(TURN) }
}

describe('demo', () => {
  test('every demo pattern is a pattern the registry would accept', () => {
    const patterns = demoPatterns(TURN)

    expect(patterns).toHaveLength(3)
    expect(parseRegistry(patterns.map(toStored)), 'each one validates as a stored pattern').toHaveLength(3)
    expect(patterns.filter(p => p.decision === null), 'two await a decision').toHaveLength(2)
    expect(patterns.filter(p => p.decision === 'steer' && p.instruction !== null), 'one is steered, so decisions and rules draw').toHaveLength(1)
    const spawn = patterns.find(p => p.category === 'multi-agent')
    expect(spawn?.decision, 'the spawn waster stays a card, so its evidence and its rule are on screen').toBeNull()
    expect(spawn?.proposal, 'and it carries a rule of the judge\'s own, not a derived one').not.toBeNull()
  })

  test('every signature and every cited row is one of the sample rows', () => {
    const rows = demoRows(TURN)
    const ids = rows.map(row => row.id)
    const keys = rows.map(row => `${row.tool}|${row.key}`)

    expect(new Set(ids).size, 'the row ids are unique').toEqual(rows.length)
    for (const p of demoPatterns(TURN)) {
      expect(p.signature, `${p.id} carries a signature`).not.toBeNull()
      expect(keys, `${p.id} names a sample row`).toContain(`${p.signature?.tool}|${p.signature?.key}`)
      for (const hit of p.hits) expect(ids, `${p.id} cites ${hit}`).toContain(hit)
    }
    // The keys are what the normalizer would compute from those very calls.
    expect(normalize('Bash', { command: 'bun test' }).key).toEqual('test:bun test')
    expect(normalize('Bash', { command: 'cat logs/api.log' }).key).toEqual('read:cat logs/api.log')
    expect(normalize('Agent', { subagent_type: 'explore' }).key).toEqual('agent:explore')
  })

  test('the sample rows carry the cost and the quotes the cards show', () => {
    const state = sampled()
    const [suite, logs] = demoPatterns(TURN)
    if (suite === undefined || logs === undefined) throw new Error('the demo lost a pattern')

    const card = cardOf(suite, state, 1, agentAliases(state.rows))
    expect(card.stats).toEqual('3× · ~9% of context · 3m 12s · turns 5–8')
    expect(card.total).toEqual({ unit: 'calls', calls: 3, ms: 192_000, chars: 72_000 })
    expect(card.evidence).toHaveLength(3)
    expect(card.evidence[0]).toMatchObject({ turn: 8, what: 'bun test', agent: null })
    expect(card.evidence[0]?.head, 'the quote under the call is the head of what came back').toContain('212 pass')
    const logCard = cardOf(logs, state, 2, agentAliases(state.rows))
    expect(logCard.stats).toEqual('2× · ~20% of context · 15s · turns 5–7')
    expect(logCard.evidence[0]?.agent, 'one sample read ran in the explore loop, so the alias column draws live').toEqual('a1')
    expect(logCard.evidence[1]?.agent, 'the other was the main loop\'s own').toBeNull()
  })

  test('the sample carries the usage and the turns the header draws from', async () => {
    const turns = demoTurns()
    const state = demoTurns().reduce((seeded, stat) => reduce(seeded, { type: 'turn.complete', stat }),
      reduce(initialState('/work', WINDOW), { type: 'usage', usage: demoUsage(), now: 0 }))

    expect(turns.length, 'three turns of shape, which the shell dates with its own context samples').toBeGreaterThanOrEqual(3)
    expect(state.usage.percent, 'the gauge has a percentage to fill').toEqual(32)
    expect(tokensToCompaction(state)).toEqual(580_000)
    expect(turnsToCompaction(state), 'a turn with no context after it is no pace: the pane test draws that half')
      .toBeNull()
  })

  test('/saver demo fills the pane behind the debug flag and says nothing without it', async ($, on) => {
    const world = startsSaver(on)
    mock.env(on, { CONTEXTSAVER_DEBUG: '1' })

    await $.session.start(SESSION)

    expect((await $.command.run(saverRun('demo'))).text).toBe('ContextSaver: demo wasters loaded')
    expect(world.opened.map(pane => pane.id), 'the demo opens the pane it is there to show').toEqual(['saver'])

    const drawn = textOf(await $.ui.render(paneRender()))
    expect(drawn, 'the newest waster leads').toContain('Claude keeps reading 2000 lines of api logs')
    expect(drawn, 'and the spawn waster is a card of its own').toContain('Claude keeps spawning a fresh explore agent')
    // The header is part of the drawing the demo exists to show, so it never draws its empty state.
    expect(drawn, 'the gauge is filled').toContain('32%')
    // The four context samples the demo dispatches are what paces this: 70k of growth a turn.
    expect(drawn).toContain('580k tokens to compaction · about 8 turns')
    expect(drawn, 'no waiting header above cards that state a percentage of context').not.toContain('awaiting the first turn')
    expect(drawn, 'the steered one is decided, not a card').toContain('Decided')
    expect(drawn, 'with the sentence that was sent under it').toContain('run only the tests for the file you just edited')
    expect(drawn).toContain('Rules for next session')
    expect(drawn, 'the rule is labelled by what it tells Claude to do').toContain('Run only the tests for the file')
    expect(drawn, 'and the verbs are named for the keyboard').toContain('/saver keep|steer|kill <n>')

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain('rows 7')
    expect(debug.text).toContain('cards 2')
    expect(debug.text, 'the usage sample is the session\'s while the demo is up').toContain('32% · 320000 / 1000000 tokens')
  })

  test('/saver demo is not a command a normal session has', async ($, on) => {
    startsSaver(on)

    await $.session.start(SESSION)

    expect((await $.command.run(saverRun('demo'))).text)
      .toBe('Usage: /saver [check | steer [n] <text> | keep <n> | kill <n> | debug | reset]')
  })
})
