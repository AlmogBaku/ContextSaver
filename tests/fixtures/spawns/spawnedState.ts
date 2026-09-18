import type { Row, State } from '../../../hooks/core/types'
import { judgeState } from '../judge/judgeState'
import { rows } from '../judge/rows'
import { sampleLoop } from './sampleLoop'
import { sampleRun } from './sampleRun'

const check = (seq: number): Row => ({
  seq, id: `toolu_${seq}`, tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'agent-2', turn: 8,
  ms: 20_000, chars: 400, head: 'PASS', flags: [], lines: null, paths: [], spawn: null,
})

const review: Row = {
  seq: 13, id: 'toolu_13', tool: 'Read', key: '/src/proxy.ts:-', cls: 'read', agent: 'agent-3', turn: 9,
  ms: 40, chars: 6_000, head: 'export const proxy', flags: [], lines: null, paths: [], spawn: null,
}

/** The judge session plus one workflow run `proxy-rewrite` (w3) with an impl, a check and a review loop, and a loose explore agent that died; overrides win. */
export const spawnedState = (over: Partial<State> = {}): State => judgeState({
  turn: 9,
  seq: 13,
  rows: [...rows, check(9), check(10), check(11), check(12), review],
  runs: [sampleRun({ turn: 7, seq: 7, refreshedAt: 1_050_000 })],
  loops: [
    sampleLoop({ id: 'agent-1', label: 'impl:C3', turns: 2, ms: 300_000, tokens: { input: 30_000, output: 8_000, cacheRead: 200_000, cacheCreate: 10_000 }, firstTurn: 7, firstSeq: 8, outcome: { kind: 'report', chars: 1_200 }, calls: 1, edits: 1 }),
    sampleLoop({ id: 'agent-2', label: 'check:C3', model: 'claude-sonnet-4-5', ms: 102_000, tokens: { input: 40_000, output: 3_000, cacheRead: 0, cacheCreate: 5_000 }, firstTurn: 8, firstSeq: 9, outcome: { kind: 'report', chars: 1_600 }, calls: 4, checks: 4 }),
    sampleLoop({ id: 'agent-3', label: 'review:C3-r1', ms: 60_000, tokens: { input: 20_000, output: 4_000, cacheRead: 0, cacheCreate: 0 }, ended: null, firstTurn: 9, firstSeq: 13, outcome: { kind: 'findings', critical: 0, high: 1, medium: 0, low: 4 }, calls: 1, reads: 1 }),
    sampleLoop({ id: 'agent-4', run: null, label: 'explore src', phase: null, model: 'sonnet', ms: 30_000, tokens: { input: 10_000, output: 2_000, cacheRead: 0, cacheCreate: 0 }, ended: 'error', firstTurn: 9, firstSeq: 13 }),
  ],
  ...over,
})
