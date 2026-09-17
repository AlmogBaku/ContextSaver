import { describe, expect, mock, test } from 'claude-code/testing'

import { demoPatterns, demoRows } from '../hooks/core/demo'
import { normalize } from '../hooks/core/ledger'
import { cardOf, parseRegistry, reduce, toStored } from '../hooks/core/patterns'
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
    expect(patterns.filter(p => p.decision === 'steer' && p.proposal !== null), 'one is steered with a rule').toHaveLength(1)
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

    const card = cardOf(suite, state)
    expect(card.stats).toEqual('3× · ~9% context · 3m 12s · turns 5…8')
    expect(card.evidence).toHaveLength(3)
    expect(card.evidence[0]).toContain('t8 · bun test')
    expect(cardOf(logs, state).stats).toEqual('2× · ~20% context · 8s · turns 5…7')
  })

  test('/saver demo fills the pane behind the debug flag and says nothing without it', async ($, on) => {
    const world = startsSaver(on)
    mock.env(on, { CONTEXTSAVER_DEBUG: '1' })

    await $.session.start(SESSION)

    expect((await $.command.run(saverRun('demo'))).text).toBe('ContextSaver: demo wasters loaded')
    expect(world.opened.map(pane => pane.id), 'the demo opens the pane it is there to show').toEqual(['saver'])

    const drawn = textOf(await $.ui.render(paneRender()))
    expect(drawn, 'the newest waster leads').toContain('Claude keeps running the whole bun test suite')
    expect(drawn).toContain('Claude keeps reading 2000 lines of api logs')
    expect(drawn, 'the steered one is decided, not a card').toContain('Decided')
    expect(drawn).toContain('Rules for next session')
    expect(drawn).toContain("Reuse an explore agent's findings")

    const debug = await $.command.run(saverRun('debug'))
    expect(debug.text).toContain('rows 7')
    expect(debug.text).toContain('cards 2')
  })

  test('/saver demo is not a command a normal session has', async ($, on) => {
    startsSaver(on)

    await $.session.start(SESSION)

    expect((await $.command.run(saverRun('demo'))).text).toBe('Usage: /saver [check | steer <text> | debug | reset]')
  })
})
