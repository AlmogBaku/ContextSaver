import { describe, expect, test } from 'claude-code/testing'

import {
  aggregate, decisionsBlock, knownPatternsBlock, ledgerBlock, ledgerLine, sinksBlock, statsLines, summaryLine,
  turnsBlock,
} from '../hooks/core/blocks'
import { agentAliases } from '../hooks/core/evidence'
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

const aliases = agentAliases(rows)

const lineOf = (seq: number): string => ledgerLine(at(seq), aliases)

describe('blocks', () => {
  test('ledgerLine renders every column, with a dash for empty flags and paths', ($, _on) => {
    expect(lineOf(1)).toBe('r1 | Bash | test:bun test | test | main | 2 | 61000 | 9700 | - | -')
    expect(lineOf(5)).toBe(
      'r5 | Bash | read:docker compose logs api --tail 2000 | read | main | 5 | 3000 | 41000 | persist=120000 | -')
  })

  test('ledgerLine folds edit sizes and spawn metadata into the flags cell', ($, _on) => {
    expect(lineOf(2)).toBe('r2 | Edit | /src/auth.ts | other | main | 3 | 120 | 300 | +4/-2 | /src/auth.ts')
    expect(lineOf(7)).toBe(
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

  test('statsLines has per-call, per-class and per-agent sections, and no row ids', ($, _on) => {
    const lines = statsLines(rows)
    expect(lines[0]).toBe('per call:')
    expect(lines[2]).toBe(
      'Bash | test:bun test | test | ×3 | Σ180000ms | Σ29400ch | turns 2-6 | edits-between 0.5 | main')
    expect(lines[lines.indexOf('per class:') + 1]).toBe('read | ×2 | Σ3040ms | Σ46200ch')
    expect(lines[lines.indexOf('per agent:') + 1]).toBe('main | ×7 | Σ77900ch')
    expect(lines[lines.indexOf('per agent:') + 2], 'a subagent is named by its alias, never by its raw id').toBe('a1 | ×1 | Σ260ch')
    // The block's own header says "No ids here": CONTEXT names the largest rows, and once was enough.
    expect(lines.some(line => /^r\d/.test(line)), 'nothing here can be cited, so nothing here is named').toEqual(false)
    expect(statsLines([])).toEqual(['(none)'])
  })

  test('every agent cell reads an alias, in both the ledger and the per-call stats', ($, _on) => {
    expect(lineOf(8), 'the ledger row of a subagent call names the loop a1')
      .toBe('r8 | Edit | /src/token.ts | other | a1 | 7 | 200 | 260 | +10/-1 | /src/token.ts')
    const perCall = statsLines(rows).filter(line => line.includes('/src/token.ts'))
    expect(perCall[0]?.endsWith(' | a1'), 'the per-call line names the same alias').toEqual(true)
    expect(statsLines(rows).some(line => line.includes('agent-1')), 'the raw id never reaches the judge').toEqual(false)
    expect(ledgerBlock(judgeState()).includes('agent-1')).toEqual(false)
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
    expect(ledgerBlock(judgeState())).toBe(rows.map(row => ledgerLine(row, aliases)).join('\n'))
  })

  test('sinksBlock states the total, the largest sinks with their share, then the largest rows', ($, _on) => {
    expect(sinksBlock(rows, 'ms').split('\n')).toEqual([
      // The spawn row is named `apart`, never with a share: its own loop's rows are the total, not it.
      'total Σ183360ms',
      'tests | ×3 | Σ180000ms | 98%',
      'agents | ×1 | Σ30000ms | apart',
      'reads | ×2 | Σ3040ms | 2%',
      'largest rows:',
      'r1 | Bash | test:bun test | Σ61000ms',
      'r6 | Bash | test:bun test | Σ60000ms',
      'r3 | Bash | test:bun test | Σ59000ms',
      'r7 | Agent | agent:explorer | Σ30000ms',
      'r5 | Bash | read:docker compose logs api --tail 2000 | Σ3000ms',
    ])
    expect(sinksBlock(rows, 'chars').split('\n').slice(0, 4)).toEqual([
      'total Σ76160ch',
      'reads | ×2 | Σ46200ch | 61%',
      'tests | ×3 | Σ29400ch | 39%',
      'agents | ×1 | Σ2000ch | apart',
    ])
    expect(sinksBlock([], 'chars')).toBe('(none)')
  })

  // `parseReply` accepts evidence from the ledger window only, so the rows named here live inside it:
  // the biggest sinks of a long session are usually its oldest rows, and citing one was discarded whole.
  test('sinksBlock names only rows the ledger window still shows', ($, _on) => {
    const many = Array.from({ length: 160 }, (_, i) => filler(i + 1))
    const huge = { ...filler(1), seq: 1, chars: 900_000 }
    const lines = sinksBlock([huge, ...many.slice(1)], 'chars').split('\n')
    expect(lines[0], 'the total is still the whole session').toBe('total Σ915900ch')
    expect(lines.slice(lines.indexOf('largest rows:') + 1).some(line => line.startsWith('r1 |')),
      'the largest row of the session is outside the window, so it is not offered as an id').toEqual(false)
    expect(lines[lines.indexOf('largest rows:') + 1]).toBe('r11 | Bash | read:cat notes.md | Σ100ch')
  })

  test('the blocks say (none) for an empty session', ($, _on) => {
    const empty = initialState('/work', 200_000)
    expect(knownPatternsBlock(empty)).toBe('(none)')
    expect(decisionsBlock(empty)).toBe('(none)')
    expect(ledgerBlock(empty)).toBe('(none)')
    expect(turnsBlock(empty).split('\n')[0]).toBe('(none)')
  })
})
