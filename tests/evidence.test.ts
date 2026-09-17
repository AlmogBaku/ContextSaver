import { describe, expect, test } from 'claude-code/testing'

import { baseline, costOf, rowsOf } from '../hooks/core/evidence'
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

  test('costOf sums and baseline takes medians', async () => {
    const state = { ...initialState('/w', 200000), rows: [row(1, 100, 10), row(2, 200, 20), row(3, 900, 90)] }
    const p = pattern(['t1', 't2', 't3'])
    expect(costOf(state, p)).toEqual({ ms: 1200, chars: 120 })
    expect(baseline(state, p)).toEqual({ ms: 200, chars: 20 })
    expect(baseline(state, pattern([]))).toEqual({ ms: 0, chars: 0 })
  })
})
