import { describe, expect, test } from 'claude-code/testing'

import { adoptRows } from '../hooks/core/adopt'
import { ROW_CAP } from '../hooks/core/types'
import { agentUse } from './fixtures/adopt/agentUse'
import { assistant } from './fixtures/adopt/assistant'
import { bashUse } from './fixtures/adopt/bashUse'
import { editUse } from './fixtures/adopt/editUse'
import { joinedSession } from './fixtures/adopt/joinedSession'
import { prompt } from './fixtures/adopt/prompt'
import { toolResults } from './fixtures/adopt/toolResults'

describe('adopt', () => {
  test('the transcript of a joined session becomes ledger rows, one turn per prompt', async () => {
    const rows = adoptRows(joinedSession)

    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({
      id: 'u-1', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 1,
      ms: 0, chars: 8, head: '212 pass', flags: ['recovered'], lines: null, paths: [], spawn: null,
    })
    expect(rows.map(r => r.id)).toEqual(['u-1', 'u-2', 'u-3', 'u-4'])
    expect(rows.map(r => r.key)).toEqual(['test:bun test', 'search:rg needle src', 'test:bun test', 'test:bun test'])
    expect(rows.map(r => r.cls)).toEqual(['test', 'search', 'test', 'test'])
    expect(rows.map(r => r.chars), 'the size is the text the model read').toEqual([8, 14, 17, 8])
    expect(rows.map(r => r.turn), 'the tool loop is the same turn; only a prompt starts the next').toEqual([1, 1, 1, 2])
    expect(rows[2]?.flags, 'a call the transcript stored as an error keeps its flag').toEqual(['err', 'recovered'])
    expect(rows.every(r => r.flags.includes('recovered')), 'every rebuilt row says so once').toBe(true)
    expect(rows.every(r => r.ms === 0 && r.agent === 'main'), 'the transcript records no duration and no loop').toBe(true)
  })

  test('a call still in flight is not a row', async () => {
    const rows = adoptRows([
      prompt('go'),
      assistant([bashUse({ tool_use_id: 'u-live', result: undefined, text: undefined }), bashUse({ tool_use_id: 'u-done' })]),
    ])

    expect(rows.map(r => r.id), 'the unanswered call has no size and no outcome to record').toEqual(['u-done'])
  })

  test('a user entry with no typed text does not start a turn', async () => {
    const rows = adoptRows([
      prompt('go'),
      assistant([bashUse({ tool_use_id: 'u-1' })]),
      prompt('   '),
      assistant([bashUse({ tool_use_id: 'u-2' })]),
    ])

    expect(rows.map(r => r.turn), 'a text-free user message is the tool loop or an engine note, not a request').toEqual([1, 1])
  })

  test('an Edit brings its path and its line counts back', async () => {
    const rows = adoptRows([prompt('rename the refresh call'), assistant([editUse])])

    expect(rows[0]?.key).toBe('/work/src/auth.ts')
    expect(rows[0]?.lines).toEqual({ add: 3, del: 1 })
    expect(rows[0]?.paths).toEqual(['/work/src/auth.ts'])
    expect(rows[0]?.flags).toEqual(['recovered'])
  })

  test('an Agent brings its spawn fields back', async () => {
    const rows = adoptRows([prompt('review it'), assistant([agentUse])])

    expect(rows[0]?.key).toBe('agent:code-reviewer')
    expect(rows[0]?.spawn).toEqual({
      type: 'code-reviewer', requested: 'sonnet', resolved: 'claude-sonnet-4-6',
      status: 'completed', tokens: 12_000, edits: 2, promptChars: 15,
    })
  })

  test('a transcript longer than the ledger keeps the newest rows', async () => {
    const many = Array.from({ length: ROW_CAP + 5 }, (_, i) => bashUse({ tool_use_id: `u-${i + 1}` }))
    const rows = adoptRows([prompt('go'), assistant(many)])

    expect(rows).toHaveLength(ROW_CAP)
    expect(rows[0]?.id).toBe('u-6')
    expect(rows[ROW_CAP - 1]?.id).toBe(`u-${ROW_CAP + 5}`)
  })

  test('a transcript with nothing to adopt yields no rows', async () => {
    expect(adoptRows([])).toEqual([])
    expect(adoptRows([prompt('hello'), toolResults(['u-1'])]), 'no assistant message, no calls').toEqual([])
  })
})
