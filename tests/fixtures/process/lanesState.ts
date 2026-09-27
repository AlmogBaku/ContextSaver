import type { Loop, Row, State } from '../../../hooks/core/types'
import { judgeState } from '../judge/judgeState'
import { sampleLoop } from '../spawns/sampleLoop'
import { sampleRun } from '../spawns/sampleRun'

const OPUS = 'claude-opus-4-1'
const LANES = [1, 2, 3]

const lane = (role: string, phase: string, k: number, over: Partial<Loop> = {}): Loop =>
  sampleLoop({ id: `agent-${role}-${k}`, run: 'w1', label: `${role}:L${k}`, phase, model: OPUS, ms: 600_000, firstTurn: 2, firstSeq: k, ...over })

const row = (seq: number, over: Partial<Row>): Row => ({
  seq, id: `toolu_p${seq}`, tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 3,
  ms: 60_000, chars: 900, head: 'PASS', flags: [], lines: null, paths: [], spawn: null, ...over,
})

// Per lane: the impl loop edits, the main loop merges the lane, then runs the whole suite.
const laneRows = (k: number): Row[] => {
  const at = (k - 1) * 3 + 1
  return [
    row(at, { tool: 'Edit', key: `/src/lane${k}.ts`, cls: 'other', agent: `agent-impl-${k}`, turn: 2, ms: 200, chars: 300, head: 'Edited', lines: { add: 12, del: 2 }, paths: [`/src/lane${k}.ts`] }),
    row(at + 1, { key: `git:git merge lane-${k}`, cls: 'git', ms: 800, chars: 200, head: 'Merge made' }),
    row(at + 2, {}),
  ]
}

/** One workflow run `lanes` (w1) declaring Implement, Review and Fix: three lanes, each an impl, a review and a fix loop on Opus, and a merge then a full suite run per lane; two typed asks, the second a pace complaint. */
export const lanesState = (over: Partial<State> = {}): State => judgeState({
  turn: 7,
  seq: 10,
  rows: [
    ...LANES.flatMap(laneRows),
    row(10, { tool: 'Write', key: '/home/u/.claude/projects/p/memory/feedback-pace.md', cls: 'other', turn: 6, ms: 50, chars: 80, head: 'secret memory body', paths: ['/home/u/.claude/projects/p/memory/feedback-pace.md'] }),
  ],
  runs: [sampleRun({ id: 'w1', name: 'lanes', dir: null, turn: 2, seq: 1, phases: ['Implement', 'Review', 'Fix'] })],
  loops: LANES.flatMap(k => [
    lane('impl', 'Implement', k, { edits: 1, calls: 3, outcome: { kind: 'report', chars: 800 } }),
    lane('review', 'Review', k, { outcome: { kind: 'findings', critical: 0, high: 1, medium: 0, low: 2 }, reads: 4 }),
    lane('fix', 'Fix', k, { edits: 1, calls: 2 }),
  ]),
  asks: [
    { turn: 1, at: 1_000_000, head: 'Implement the three lanes from the plan', pace: false },
    { turn: 6, at: 4_600_000, head: 'this is taking forever', pace: true },
  ],
  compactions: [4],
  ...over,
})
