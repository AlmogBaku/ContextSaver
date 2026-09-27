import type { Ask, Loop, Row, Run, State } from '../../../hooks/core/types'
import { ROW_CAP } from '../../../hooks/core/types'
import { lanesState } from './lanesState'
import { sampleLoop } from '../spawns/sampleLoop'
import { sampleRun } from '../spawns/sampleRun'

const RUNS = 50
const LOOPS_PER_RUN = 8

const runs: Run[] = Array.from({ length: RUNS }, (_, i) =>
  sampleRun({ id: `w${i + 1}`, name: `stage-${i + 1}`, turn: i + 1, seq: i + 1, phases: ['Implement', 'Review', 'Fix', 'Verify'] }))

const loops: Loop[] = runs.flatMap((run, r) => Array.from({ length: LOOPS_PER_RUN }, (_, i) =>
  sampleLoop({ id: `agent-${r}-${i}`, run: run.id, label: `${['impl', 'review', 'fix', 'verify'][i % 4]}:C${r}-${i}`, phase: ['Implement', 'Review', 'Fix', 'Verify'][i % 4] ?? null })))

const asks: Ask[] = Array.from({ length: 3000 }, (_, i) => ({ turn: i + 1, at: 1_000_000 + i * 60_000, head: `ask ${i} `.padEnd(200, 'x'), pace: i % 50 === 0 }))

const rows: Row[] = Array.from({ length: ROW_CAP }, (_, i) => ({
  seq: i + 1, id: `toolu_h${i}`, tool: 'Read', key: `/src/deep/module-${i % 700}/file-${i}.ts:-`, cls: 'read', agent: `agent-${i % RUNS}-${i % LOOPS_PER_RUN}`,
  turn: 1 + (i % 3000), ms: 40, chars: 3000, head: 'x', flags: [], lines: null, paths: i % 3 === 0 ? [`/src/deep/module-${i % 700}/written-${i}.ts`] : [], spawn: null,
}))

/** A session far past every cap: 3000 typed asks, 50 runs of 8 loops, a full ledger touching hundreds of paths. */
export const hugeState = (): State => lanesState({ seq: ROW_CAP, rows, runs, loops, asks })
