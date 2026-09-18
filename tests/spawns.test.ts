import { describe, expect, test } from 'claude-code/testing'

import { activeRuns, agentOf, countRow, journalPath, loopStats, parseJournal, runOf } from '../hooks/core/spawns'
import { RUN_FRESH_MS, initialState } from '../hooks/core/types'
import type { Row } from '../hooks/core/types'
import { agentCompleted } from './fixtures/ledger/agentCompleted'
import { journalText } from './fixtures/spawns/journalText'
import { sampleLoop } from './fixtures/spawns/sampleLoop'
import { sampleRun } from './fixtures/spawns/sampleRun'
import { workflowLaunched } from './fixtures/spawns/workflowLaunched'

const row = (over: Partial<Row>): Row => ({
  seq: 1, id: 't1', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'agent-1', turn: 4,
  ms: 100, chars: 100, head: '', flags: [], lines: null, paths: [], spawn: null, ...over,
})

describe('spawns', () => {
  test('parseJournal reads one entry per line and skips what it cannot read', async () => {
    expect(parseJournal(journalText)).toEqual([
      { kind: 'started', agentId: 'agent-1', label: 'impl:C3', phase: 'build' },
      { kind: 'started', agentId: 'agent-2', label: 'review:C3-r1', phase: null },
      { kind: 'result', agentId: 'agent-2', outcome: { kind: 'findings', critical: 0, high: 1, medium: 0, low: 2 } },
      { kind: 'result', agentId: 'agent-1', outcome: { kind: 'report', chars: 'Implemented C3: the proxy now retries once.'.length } },
      { kind: 'result', agentId: 'agent-3', outcome: { kind: 'report', chars: JSON.stringify({ summary: 'ok', files: 3 }).length } },
    ])
    expect(parseJournal(''), 'an empty journal is no entries').toEqual([])
    expect(parseJournal('{"type":"result","agentId":"a"}'), 'a result with nothing in it is an empty report')
      .toEqual([{ kind: 'result', agentId: 'a', outcome: { kind: 'report', chars: 0 } }])
  })

  test('runOf reads a launched local workflow and nothing else', async () => {
    expect(runOf(workflowLaunched)).toEqual({ id: 'w3', name: 'proxy-rewrite', dir: '/tmp/runs/w3' })
    expect(runOf({ ...workflowLaunched, transcriptDir: undefined }), 'no transcript dir is a null dir').toEqual({ id: 'w3', name: 'proxy-rewrite', dir: null })
    expect(runOf({ ...workflowLaunched, taskType: 'remote_agent' }), 'a remote run writes no journal here').toBe(null)
    expect(runOf({ ...workflowLaunched, runId: undefined }), 'no id, no run to follow').toBe(null)
    expect(runOf(agentCompleted.result.result)).toBe(null)
    expect(runOf('async_launched')).toBe(null)
    expect(runOf(null)).toBe(null)
  })

  test('agentOf reads an Agent result, with the description the call carried when it is passed along', async () => {
    expect(agentOf(agentCompleted.result.result)).toEqual({ agentId: 'a_1', description: '', model: 'claude-sonnet-4-5' })
    expect(agentOf({ ...(agentCompleted.result.result as Record<string, unknown>), description: 'run the suite' }))
      .toEqual({ agentId: 'a_1', description: 'run the suite', model: 'claude-sonnet-4-5' })
    expect(agentOf({ agentId: 'a_2' }), 'a model nobody reported is null').toEqual({ agentId: 'a_2', description: '', model: null })
    expect(agentOf({ agentId: 7 })).toBe(null)
    expect(agentOf(workflowLaunched)).toBe(null)
    expect(agentOf(undefined)).toBe(null)
  })

  test('loopStats counts the calls, edits, checks and reads of one loop\'s own rows', async () => {
    const rows = [
      row({ seq: 1, tool: 'Read', key: '/src/a.ts:-', cls: 'read' }),
      row({ seq: 2, tool: 'Grep', key: 'Grep:x:/src', cls: 'search' }),
      row({ seq: 3, tool: 'Bash', key: 'read:cat a.log', cls: 'read' }),
      row({ seq: 4, tool: 'Edit', key: '/src/a.ts', cls: 'other', paths: ['/src/a.ts'] }),
      row({ seq: 5, tool: 'Write', key: '/src/b.ts', cls: 'other', paths: [] }),
      row({ seq: 6, tool: 'Bash', key: 'other:./gen.sh', cls: 'other', paths: ['/src/c.ts'] }),
      row({ seq: 7, tool: 'Bash', key: 'test:bun test', cls: 'test' }),
      row({ seq: 8, tool: 'Bash', key: 'lint:eslint .', cls: 'lint' }),
      row({ seq: 9, tool: 'Bash', key: 'typecheck:tsc', cls: 'typecheck' }),
      row({ seq: 10, tool: 'Bash', key: 'build:bun run build', cls: 'build' }),
      row({ seq: 11, tool: 'Bash', key: 'git:git status', cls: 'git' }),
      row({ seq: 12, tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main' }),
      row({ seq: 13, tool: 'Edit', key: '/src/z.ts', cls: 'other', paths: ['/src/z.ts'], agent: 'agent-2' }),
    ]
    expect(loopStats(rows, sampleLoop())).toEqual({ calls: 11, edits: 3, checks: 4, reads: 3 })
    expect(loopStats(rows, sampleLoop({ id: 'agent-9' })), 'a loop with no rows yet').toEqual({ calls: 0, edits: 0, checks: 0, reads: 0 })
  })

  test('countRow counts one row onto its loop under the same rules, so the count outlives the row', async () => {
    const own = [
      row({ seq: 1, tool: 'Read', key: '/src/a.ts:-', cls: 'read' }),
      row({ seq: 2, tool: 'Bash', key: 'other:./gen.sh', cls: 'other', paths: ['/src/c.ts'] }),
      row({ seq: 3, tool: 'Bash', key: 'lint:eslint .', cls: 'lint' }),
      row({ seq: 4, tool: 'Bash', key: 'git:git status', cls: 'git' }),
    ]
    const counted = own.reduce(countRow, sampleLoop({ calls: 2, edits: 1, checks: 0, reads: 0 }))
    expect(counted, 'a read, an edit by its paths, a check and a call that is none of those').toMatchObject({ calls: 6, edits: 2, checks: 1, reads: 1 })
    expect(own.reduce(countRow, sampleLoop()), 'the fields agree with loopStats over the same rows').toMatchObject(loopStats(own, sampleLoop()))
    expect(countRow(sampleLoop(), own[0]!).id, 'nothing else about the loop changes').toBe('agent-1')
  })

  test('activeRuns names the runs with a loop still going, or too young to have one', async () => {
    const state = {
      ...initialState('/w', 200_000),
      runs: [sampleRun(), sampleRun({ id: 'w4', at: 5_000_000 }), sampleRun({ id: 'w5', at: 2_000_000 })],
      loops: [sampleLoop({ id: 'agent-1', run: 'w3', ended: 'answer' }), sampleLoop({ id: 'agent-2', run: 'w3', ended: null })],
    }
    const now = 5_000_000 + RUN_FRESH_MS - 1
    expect(activeRuns(state, now).map(r => r.id), 'w3 has an unended loop; w4 is fresh; w5 has neither').toEqual(['w3', 'w4'])
    expect(activeRuns(state, now + 1).map(r => r.id), 'a run with no loop goes quiet after RUN_FRESH_MS').toEqual(['w3'])
    const done = { ...state, loops: state.loops.map(l => ({ ...l, ended: 'error' as const })) }
    expect(activeRuns(done, now + 1), 'every loop ended and every run is old').toEqual([])
    expect(activeRuns(initialState('/w', 200_000), 0)).toEqual([])
  })

  test('journalPath is the journal inside the run\'s transcript dir, and nothing without one', async () => {
    expect(journalPath(sampleRun())).toBe('/tmp/runs/w3/journal.jsonl')
    expect(journalPath(sampleRun({ dir: null }))).toBe(null)
  })
})
