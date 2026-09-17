import { describe, expect, test } from 'claude-code/testing'

import {
  aggregate, decisionsBlock, knownPatternsBlock, ledgerBlock, ledgerLine, statsLines, summaryLine, turnsBlock,
} from '../hooks/core/blocks'
import { initialState } from '../hooks/core/types'
import type { Row } from '../hooks/core/types'
import { judgePattern } from './fixtures/judge/judgePattern'
import { judgeState } from './fixtures/judge/judgeState'
import { rows } from './fixtures/judge/rows'

const filler = (seq: number): Row => ({
  seq, id: `toolu_f${seq}`, tool: 'Bash', key: seq % 2 === 0 ? 'test:bun test' : 'read:cat notes.md',
  cls: seq % 2 === 0 ? 'test' : 'read', agent: 'main', turn: seq, ms: 10, chars: 100,
  head: '', flags: [], lines: null, paths: [], spawn: null,
})

const at = (seq: number): Row => rows.filter(r => r.seq === seq)[0] ?? filler(seq)

describe('blocks', () => {
  test('ledgerLine renders every column, with a dash for empty flags and paths', ($, _on) => {
    expect(ledgerLine(at(1))).toBe('r1 | Bash | test:bun test | test | main | 2 | 61000 | 9700 | - | -')
    expect(ledgerLine(at(5))).toBe(
      'r5 | Bash | read:docker compose logs api --tail 2000 | read | main | 5 | 3000 | 41000 | persist=120000 | -')
  })

  test('ledgerLine folds edit sizes and spawn metadata into the flags cell', ($, _on) => {
    expect(ledgerLine(at(2))).toBe('r2 | Edit | /src/auth.ts | other | main | 3 | 120 | 300 | +4/-2 | /src/auth.ts')
    expect(ledgerLine(at(7))).toBe(
      'r7 | Agent | agent:explorer | other | main | 7 | 30000 | 2000 | agent=explorer/opus/completed/42000tok/0edits/180pch | -')
  })

  test('summaryLine folds a (tool, key) group without an id', ($, _on) => {
    expect(summaryLine('Bash', 'test:bun test', 5, 48_000)).toBe('~ | Bash | test:bun test | ×5 | Σ48000ch')
  })

  test('aggregate counts, sums and takes the median of the files edited between runs', ($, _on) => {
    const stats = aggregate(rows)
    expect(stats[0]?.key).toBe('read:docker compose logs api --tail 2000')
    expect(stats[1]).toEqual({
      tool: 'Bash', key: 'test:bun test', cls: 'test', count: 3, ms: 180_000, chars: 29_400,
      firstTurn: 2, lastTurn: 6, agents: ['main'], editsBetween: 0.5,
    })
    expect(aggregate(rows).filter(s => s.key === '/src/token.ts')[0]?.editsBetween).toBe(null)
  })

  test('statsLines has per-call, per-class, per-agent and costliest sections', ($, _on) => {
    const lines = statsLines(rows)
    expect(lines[0]).toBe('per call:')
    expect(lines[2]).toBe(
      'Bash | test:bun test | test | ×3 | Σ180000ms | Σ29400ch | turns 2-6 | edits-between 0.5 | main')
    expect(lines[lines.indexOf('per class:') + 1]).toBe('read | ×2 | Σ3040ms | Σ46200ch')
    expect(lines[lines.indexOf('per agent:') + 1]).toBe('main | ×7 | Σ77900ch')
    expect(lines[lines.indexOf('costliest rows:') + 1]).toBe(
      'r5 | Bash | read:docker compose logs api --tail 2000 | 41000ch')
    expect(statsLines([])).toEqual(['(none)'])
  })

  test('knownPatternsBlock lines decisions and previous-session calibration', ($, _on) => {
    const decided = judgeState({ patterns: [judgePattern({ decision: 'steer', decidedAtTurn: 5, lastDecision: 'steer' })] })
    expect(knownPatternsBlock(decided)).toBe(
      'execution:full-suite-after-each-edit | Claude keeps running the whole bun test suite after every single-file edit | steer @ 5')
    const previous = judgeState({ patterns: [judgePattern({ lastDecision: 'keep' })] })
    expect(knownPatternsBlock(previous)).toContain('| - @ - | previous: keep')
  })

  test('decisionsBlock lists this session then the previous-session keeps', ($, _on) => {
    const state = judgeState({
      patterns: [
        judgePattern({ decision: 'steer', decidedAtTurn: 5 }),
        judgePattern({ id: 'reading:log-dump', signature: null, lastDecision: 'keep' }),
      ],
    })
    expect(decisionsBlock(state).split('\n')).toEqual([
      'execution:full-suite-after-each-edit | test:bun test | steer @ 5',
      'reading:log-dump | - | kept in a previous session',
    ])
  })

  test('turnsBlock lines every turn, marks aborted ones and ends with the facts line', ($, _on) => {
    const lines = turnsBlock(judgeState({ compactions: [4] })).split('\n')
    expect(lines[0]).toBe('1 | 5000 | 500 | 2000 | 1 | 9000 | 250')
    expect(lines[6]).toBe('7 | 3000 | 1000 | 1500 | 2 | 31000 | 800 | aborted')
    expect(lines[7]).toBe('window=200000 overhead: memory=1200 mcp=3400 agents=800 compactions at turns: 4')
  })

  test('ledgerBlock folds rows older than the window into summary lines', ($, _on) => {
    const many = Array.from({ length: 160 }, (_, i) => filler(i + 1))
    const lines = ledgerBlock(judgeState({ rows: many })).split('\n')
    expect(lines.length).toBe(152)
    expect(lines.slice(0, 2)).toEqual([
      '~ | Bash | read:cat notes.md | ×5 | Σ500ch',
      '~ | Bash | test:bun test | ×5 | Σ500ch',
    ])
    expect(lines[2]).toBe('r11 | Bash | read:cat notes.md | read | main | 11 | 10 | 100 | - | -')
    expect(ledgerBlock(judgeState())).toBe(rows.map(ledgerLine).join('\n'))
  })

  test('the blocks say (none) for an empty session', ($, _on) => {
    const empty = initialState('/work', 200_000)
    expect(knownPatternsBlock(empty)).toBe('(none)')
    expect(decisionsBlock(empty)).toBe('(none)')
    expect(ledgerBlock(empty)).toBe('(none)')
    expect(turnsBlock(empty).split('\n')[0]).toBe('(none)')
  })
})
