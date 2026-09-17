import { describe, expect, test } from 'claude-code/testing'

import { agentAliases, aliasOf, baseline, rowsOf, sinks, sumOf } from '../hooks/core/evidence'
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

  test('sinks names the consumers by the job they did, not by the tool that did it', async () => {
    const call = (over: Partial<Row>): Row => ({ ...row(1, 1_000, 100), ...over })
    const ledger = [
      call({ seq: 1, tool: 'Bash', key: 'test:bun test', cls: 'test', ms: 60_000, chars: 9_000 }),
      call({ seq: 2, tool: 'Bash', key: 'git:git status', cls: 'git', ms: 500, chars: 400 }),
      call({ seq: 3, tool: 'Bash', key: 'read:cat api.log', cls: 'read', ms: 2_000, chars: 40_000 }),
      call({ seq: 4, tool: 'Read', key: '/src/auth.ts:-', cls: 'read', ms: 100, chars: 5_000 }),
      call({ seq: 5, tool: 'Grep', key: 'Grep:token:/src', cls: 'search', ms: 200, chars: 800 }),
      call({ seq: 6, tool: 'Edit', key: '/src/auth.ts', cls: 'other', ms: 300, chars: 200 }),
      call({ seq: 7, tool: 'Bash', key: 'other:./deploy.sh', cls: 'other', ms: 4_000, chars: 600 }),
      call({ seq: 8, tool: 'WebFetch', key: 'WebFetch:{}', cls: 'other', ms: 900, chars: 3_000 }),
    ]
    expect(sinks(ledger, 'ms'), 'the three largest, and a total over every row').toEqual({
      total: 68_000,
      sinks: [
        { label: 'tests', amount: 60_000, count: 1 },
        { label: 'commands', amount: 4_000, count: 1 },
        { label: 'reads', amount: 2_100, count: 2 },
      ],
    })
    expect(sinks(ledger, 'chars').sinks.map(s => s.label), 'the same ledger spends its context elsewhere')
      .toEqual(['reads', 'tests', 'WebFetch'])
    expect(sinks(ledger, 'chars').total).toBe(59_000)
    expect(sinks([], 'ms'), 'nothing ran, nothing to name').toEqual({ total: 0, sinks: [] })
  })

  test('a spawn row is named beside its loop and never added into it', async () => {
    const spawn: Row = {
      ...row(3, 88_000, 34_000), tool: 'Agent', key: 'agent:explore', cls: 'other',
      spawn: { type: 'explore', requested: null, resolved: 'sonnet', status: 'completed', tokens: 9_000, edits: 0, promptChars: 400 },
    }
    const inLoop = { ...row(1, 40_000, 20_000), agent: 'sub-1' }
    const where = sinks([inLoop, { ...row(2, 50_000, 16_000), agent: 'sub-1' }, spawn], 'ms')
    expect(where.total, "the agent's own rows are the cost; its spawn row is those rows again").toBe(90_000)
    expect(where.sinks).toEqual([
      { label: 'tests', amount: 90_000, count: 2 },
      { label: 'agents', amount: 88_000, count: 1 },
    ])
    expect(sinks([inLoop, spawn], 'chars').total).toBe(20_000)
  })

  test('sinks count a rebuilt row for its size and never for a duration nobody recorded', async () => {
    const recovered: Row = { ...row(1, 0, 9_000), flags: ['recovered'] }
    const timed = { ...row(2, 60_000, 9_000) }
    expect(sinks([recovered, timed], 'ms')).toEqual({ total: 60_000, sinks: [{ label: 'tests', amount: 60_000, count: 2 }] })
    expect(sinks([recovered, timed], 'chars')).toEqual({ total: 18_000, sinks: [{ label: 'tests', amount: 18_000, count: 2 }] })
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
