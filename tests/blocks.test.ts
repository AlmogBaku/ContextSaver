import { describe, expect, test } from 'claude-code/testing'

import {
  agentsBlock, aggregate, decisionsBlock, knownPatternsBlock, ledgerBlock, ledgerLine, sinksBlock, statsLines,
  summaryLine, turnsBlock,
} from '../hooks/core/blocks'
import { agentAliases, pairKey } from '../hooks/core/evidence'
import { AGENTS_ROWS, initialState } from '../hooks/core/types'
import type { Folded, Row } from '../hooks/core/types'
import { judgePattern } from './fixtures/judge/judgePattern'
import { judgeState } from './fixtures/judge/judgeState'
import { rows } from './fixtures/judge/rows'
import { turns } from './fixtures/judge/turns'
import { foldedPair } from './fixtures/patterns/foldedPair'
import { sampleLoop } from './fixtures/spawns/sampleLoop'
import { spawnedState } from './fixtures/spawns/spawnedState'

const filler = (seq: number): Row => ({
  seq, id: `toolu_f${seq}`, tool: 'Bash', key: seq % 2 === 0 ? 'test:bun test' : 'read:cat notes.md',
  cls: seq % 2 === 0 ? 'test' : 'read', agent: 'main', turn: seq, ms: 10, chars: 100,
  head: '', flags: [], lines: null, paths: [], spawn: null,
})

const at = (seq: number): Row => rows.filter(r => r.seq === seq)[0] ?? filler(seq)

const folds = (...all: Folded[]): Record<string, Folded> => Object.fromEntries(all.map(f => [pairKey(f), f]))

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

  test('aggregate counts the rows the cap dropped into their pair, and a pair it emptied on its own line', ($, _on) => {
    const gone = foldedPair({
      key: 'read:cat old.md', cls: 'read', agent: 'agent-1', count: 4, ms: 400, chars: 12_000, firstTurn: 1, lastTurn: 1,
    })
    const stats = aggregate(rows, folds(foldedPair(), gone))
    expect(stats.filter(s => s.key === 'test:bun test')[0], 'three surviving runs and ten folded ones are one pair').toEqual({
      tool: 'Bash', key: 'test:bun test', cls: 'test', count: 13, ms: 780_000, chars: 119_400,
      firstTurn: 1, lastTurn: 6, agents: ['main'], editsBetween: 0.5,
    })
    expect(stats.filter(s => s.key === 'read:cat old.md')[0], 'a pair with no row left is counted, with nothing to measure the edits between').toEqual({
      tool: 'Bash', key: 'read:cat old.md', cls: 'read', count: 4, ms: 400, chars: 12_000,
      firstTurn: 1, lastTurn: 1, agents: ['agent-1'], editsBetween: null,
    })
    expect(aggregate(rows), 'nothing folded, nothing added').toEqual(aggregate(rows, {}))
  })

  test('statsLines names every wait the session held, folded rows and live ones alike', ($, _on) => {
    const ask = (seq: number, ms: number, flags: string[]): Row => ({
      seq, id: `toolu_a${seq}`, tool: 'AskUserQuestion', key: 'AskUserQuestion:which gateway', cls: 'other',
      agent: 'main', turn: seq, ms, chars: 300, head: '', flags, lines: null, paths: [], spawn: null,
    })
    const dropped = foldedPair({
      tool: 'AskUserQuestion', key: 'AskUserQuestion:which gateway', cls: 'other', count: 2, ms: 120_000, chars: 600,
      flags: { ask: 2, recommended: 1, err: 0 },
    })
    const lines = statsLines([...rows, ask(9, 21_120_000, ['ask', 'recommended']), ask(10, 60_000, ['ask'])], folds(dropped))
    expect(lines[lines.indexOf('waits:') + 1], 'four questions, the whole wait they held, and the two that named a default')
      .toBe('AskUserQuestion | ×4 | Σ21300000ms | recommended ×2')
    expect(lines.indexOf('waits:'), 'under the calls, before the classes').toBeLessThan(lines.indexOf('per class:'))
    expect(statsLines(rows).includes('waits:'), 'a session where nobody was asked anything says nothing').toBe(false)
  })

  test('statsLines names a loop only the folds remember by the alias the other blocks give it', ($, _on) => {
    const gone = foldedPair({ key: 'read:cat gone.md', cls: 'read', agent: 'agent-9' })
    const shared = agentAliases(rows, [sampleLoop({ id: 'agent-9' })])
    const line = statsLines(rows, folds(gone), shared).filter(l => l.includes('read:cat gone.md'))[0]
    expect(line?.endsWith(' | a2'), 'the loop whose every row the cap dropped is still named, never by its raw id').toBe(true)
    expect(statsLines(rows, folds(gone)).filter(l => l.includes('read:cat gone.md'))[0]?.endsWith(' | agent-9'),
      'without the shared naming the rows are all a stats block knows').toBe(true)
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

  test('a turn line says how the turn ended and how long the person was away after it', ($, _on) => {
    const ended = (over: Partial<(typeof turns)[number]>) => ({ ...turns[0], ...over })
    const lines = turnsBlock(judgeState({
      turns: [
        ended({ turn: 1, ended: 'error', idleMs: 0 }),
        ended({ turn: 2, ended: 'refusal', idleMs: 180_000 }),
        ended({ turn: 3, ended: 'answer', idleMs: 59_999 }),
        ended({ turn: 4, ended: 'answer', idleMs: 60_000 }),
      ] as typeof turns,
    })).split('\n')
    expect(lines[0], 'an error is named where aborted was').toBe('1 | 5000 | 500 | 2000 | 1 | 9000 | 250 | error')
    expect(lines[1], 'and the wait before the next prompt follows it').toBe('2 | 5000 | 500 | 2000 | 1 | 9000 | 250 | refusal | idle 3m')
    expect(lines[2], 'under a minute the person was reading, not away').toBe('3 | 5000 | 500 | 2000 | 1 | 9000 | 250')
    expect(lines[3]).toBe('4 | 5000 | 500 | 2000 | 1 | 9000 | 250 | idle 1m')
  })

  test('agentsBlock lines every run, then every loop with its alias, cost, work, outcome and end', ($, _on) => {
    expect(agentsBlock(spawnedState()).split('\n')).toEqual([
      'proxy-rewrite | w3 | loops 3 | Σ7.7m | Σ120k tok | edits 1 | turn 7',
      'loops:',
      'a1 | proxy-rewrite | impl:C3 | opus | 2 | 5.0m | 48k | edits 1 | checks 0 | reads 0 | report 1200ch | answer',
      'a2 | proxy-rewrite | check:C3 | sonnet | 1 | 1.7m | 48k | edits 0 | checks 4 | reads 0 | report 1600ch | answer',
      'a3 | proxy-rewrite | review:C3-r1 | opus | 1 | 1.0m | 24k | edits 0 | checks 0 | reads 1 | 1 high 4 low | running',
      'a4 | - | explore src | sonnet | 1 | 0.5m | 12k | edits 0 | checks 0 | reads 0 | - | error',
    ])
    expect(agentsBlock(spawnedState({ rows: [] })).split('\n').slice(0, 4), 'the counts are the loops\' own: the lines read the same with every row gone')
      .toEqual(agentsBlock(spawnedState()).split('\n').slice(0, 4))
    expect(agentsBlock(judgeState()), 'no loops, nothing to list').toBe('(none)')
    const bare = spawnedState({ loops: [sampleLoop({ id: 'agent-9', run: null, label: null, model: null, outcome: { kind: 'findings', critical: 0, high: 0, medium: 0, low: 0 } })], runs: [] })
    expect(agentsBlock(bare).split('\n')[1], 'a loop known by its id alone, and a review that found nothing')
      .toBe('a4 | - | - | ? | 1 | 5.0m | 48k | edits 0 | checks 0 | reads 0 | 0 findings | answer')
    expect(ledgerBlock(spawnedState()), 'the ledger names the same loops the same way').toContain('r13 | Read | /src/proxy.ts:- | read | a3 | 9 |')
  })

  test('agentsBlock folds the loops past the window per run, oldest first', ($, _on) => {
    const many = Array.from({ length: AGENTS_ROWS + 3 }, (_, i) =>
      sampleLoop({ id: `loop-${i + 1}`, run: i === 1 ? null : 'w3', ms: 60_000, tokens: { input: 1_000, output: 0, cacheRead: 0, cacheCreate: 0 }, firstTurn: i + 1 }))
    const lines = agentsBlock(spawnedState({ loops: many, rows: [] })).split('\n')
    expect(lines.length).toBe(1 + 1 + 2 + AGENTS_ROWS)
    expect(lines.slice(2, 4), 'the three oldest fold: two of the run, one of no run at all').toEqual([
      '~ proxy-rewrite | ×2 | Σ2.0m | Σ2k',
      '~ agents | ×1 | Σ1.0m | Σ1k',
    ])
    expect(lines[4]?.startsWith('a4 | proxy-rewrite |'), 'the first full line is the fourth loop, under the alias its place gives it').toBe(true)
  })

  test('sinksBlock states the agents sink from the loops when it is given them', ($, _on) => {
    const state = spawnedState()
    const lines = sinksBlock(state.rows, 'ms', state.loops).split('\n')
    expect(lines.slice(0, 4)).toEqual([
      'total Σ263400ms',
      'agents | ×4 | Σ492000ms | apart',
      'tests | ×7 | Σ260000ms | 99%',
      'reads | ×3 | Σ3080ms | 1%',
    ])
    expect(sinksBlock(state.rows, 'chars', state.loops).split('\n')[3], 'the context stays the rows\' own').toBe('agents | ×1 | Σ2000ch | apart')
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

  test('ledgerBlock folds the rows past the cap into the summary lines of the rows before the window', ($, _on) => {
    const many = Array.from({ length: 160 }, (_, i) => filler(i + 1))
    const lines = ledgerBlock(judgeState({ rows: many, folded: folds(foldedPair({ count: 10, ms: 100, chars: 1_000 })) })).split('\n')
    expect(lines.slice(0, 2), 'the ten dropped runs are counted into the pair the window already folds').toEqual([
      '~ | Bash | test:bun test | ×15 | Σ1500ch',
      '~ | Bash | read:cat notes.md | ×5 | Σ500ch',
    ])
    expect(lines.length, 'and the window itself is unchanged').toBe(152)
  })

  test('sinksBlock counts the folded rows in the total and the sinks, and still names citable rows', ($, _on) => {
    const lines = sinksBlock(rows, 'chars', [], folds(foldedPair())).split('\n')
    expect(lines[0], 'the total is the rows plus what the cap dropped').toBe('total Σ166160ch')
    expect(lines[1]).toBe('tests | ×13 | Σ119400ch | 72%')
    expect(lines.slice(lines.indexOf('largest rows:') + 1).every(line => /^r\d/.test(line)),
      'a fold has no id, so the largest rows stay rows the judge may cite').toBe(true)
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
