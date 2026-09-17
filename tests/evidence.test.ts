import { describe, expect, test } from 'claude-code/testing'

import { agentAliases, aliasOf, baseline, rowsOf, sumOf } from '../hooks/core/evidence'
import { initialState } from '../hooks/core/types'
import type { Pattern, Row } from '../hooks/core/types'

const row = (seq: number, ms: number, chars: number): Row => ({
  seq, id: `t${seq}`, tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: seq,
  ms, chars, head: '', flags: [], lines: null, paths: [], spawn: null,
})

const pattern = (hits: string[]): Pattern => ({
  id: 'execution:full-suite', category: 'execution', kind: 'Claude keeps running bun test', signature: { tool: 'Bash', key: 'test:bun test' },
  why: '', alternative: 'run only covering tests', confidence: 0.9, proposal: null, estTokensPerTurn: null, lastDecision: null,
  hits, decision: null, decidedAtTurn: null, instruction: null, openedAtTurn: null, ignored: 0,
})

describe('evidence', () => {
  test('rowsOf returns cited rows in ledger order and ignores unknown handles', async () => {
    const state = { ...initialState('/w', 200000), rows: [row(1, 100, 10), row(2, 200, 20), row(3, 300, 30)] }
    expect(rowsOf(state, pattern(['t3', 'turn:2', 't1', 'nope'])).map(r => r.seq)).toEqual([1, 3])
  })

  test('sumOf sums the rows in hand and baseline takes medians', async () => {
    const state = { ...initialState('/w', 200000), rows: [row(1, 100, 10), row(2, 200, 20), row(3, 900, 90)] }
    const p = pattern(['t1', 't2', 't3'])
    expect(sumOf(rowsOf(state, p))).toEqual({ ms: 1200, chars: 120 })
    expect(baseline(state, p)).toEqual({ ms: 200, chars: 20 })
    expect(baseline(state, pattern([]))).toEqual({ ms: 0, chars: 0 })
  })

  test('agentAliases names the loops in order of first appearance and stays stable', async () => {
    const inLoop = (seq: number, agent: string): Row => ({ ...row(seq, 100, 10), agent })
    const rows = [inLoop(1, 'main'), inLoop(2, 'agent-7'), inLoop(3, 'agent-2'), inLoop(4, 'agent-7'), inLoop(5, 'main')]
    const aliases = agentAliases(rows)

    expect([...aliases.entries()]).toEqual([['main', 'main'], ['agent-7', 'a1'], ['agent-2', 'a2']])
    expect([...agentAliases(rows).entries()], 'the same rows name the same loops every call').toEqual([...aliases.entries()])
    expect(agentAliases(rows.slice(0, 2)).get('agent-7'), 'the first agent seen is a1 whatever follows it').toEqual('a1')
    expect(aliasOf(aliases, 'agent-2')).toEqual('a2')
    expect(aliasOf(aliases, 'agent-9'), 'a loop the rows never showed keeps its own id').toEqual('agent-9')
    expect([...agentAliases([]).entries()], 'the main loop is always named').toEqual([['main', 'main']])
  })

  test('a rebuilt row lends its size to the baseline but not its unrecorded duration', async () => {
    const recovered = (seq: number, chars: number): Row => ({ ...row(seq, 0, chars), flags: ['recovered'] })
    const state = { ...initialState('/w', 200000), rows: [recovered(1, 9_000), recovered(2, 9_000), row(3, 60_000, 9_000)] }
    expect(baseline(state, pattern(['t1', 't2', 't3'])), 'the one timed row carries the time median').toEqual({ ms: 60_000, chars: 9_000 })
    expect(sumOf(rowsOf(state, pattern(['t1', 't2', 't3']))), 'the sum still only holds what was measured').toEqual({ ms: 60_000, chars: 27_000 })
    const all = { ...initialState('/w', 200000), rows: [recovered(1, 400), recovered(2, 800)] }
    expect(baseline(all, pattern(['t1', 't2'])), 'no timed row, no time claimed').toEqual({ ms: 0, chars: 600 })
  })
})
