import type { Row } from '../../../hooks/core/types'

/** A small session ledger: three full suite runs, a truncated read, a log dump, an agent and two edits. */
export const rows: Row[] = [
  {
    seq: 1, id: 'toolu_01', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 2,
    ms: 61_000, chars: 9700, head: 'PASS src/auth.test.ts', flags: [], lines: null, paths: [], spawn: null,
  },
  {
    seq: 2, id: 'toolu_02', tool: 'Edit', key: '/src/auth.ts', cls: 'other', agent: 'main', turn: 3,
    ms: 120, chars: 300, head: 'Edited /src/auth.ts', flags: [], lines: { add: 4, del: 2 },
    paths: ['/src/auth.ts'], spawn: null,
  },
  {
    seq: 3, id: 'toolu_03', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 4,
    ms: 59_000, chars: 9800, head: 'PASS src/auth.test.ts', flags: [], lines: null, paths: [], spawn: null,
  },
  {
    seq: 4, id: 'toolu_04', tool: 'Read', key: '/src/auth.ts:-', cls: 'read', agent: 'main', turn: 4,
    ms: 40, chars: 5200, head: 'import { sign } from ...', flags: ['trunc'], lines: null, paths: [], spawn: null,
  },
  {
    seq: 5, id: 'toolu_05', tool: 'Bash', key: 'read:docker compose logs api --tail 2000', cls: 'read', agent: 'main', turn: 5,
    ms: 3000, chars: 41_000, head: 'api-1 | INFO started', flags: ['persist=120000'], lines: null, paths: [], spawn: null,
  },
  {
    seq: 6, id: 'toolu_06', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 6,
    ms: 60_000, chars: 9900, head: 'PASS src/auth.test.ts', flags: [], lines: null, paths: [], spawn: null,
  },
  {
    seq: 7, id: 'toolu_07', tool: 'Agent', key: 'agent:explorer', cls: 'other', agent: 'main', turn: 7,
    ms: 30_000, chars: 2000, head: 'Explored the token flow', flags: [], lines: null, paths: [],
    spawn: { type: 'explorer', requested: 'sonnet', resolved: 'opus', status: 'completed', tokens: 42_000, edits: 0, promptChars: 180 },
  },
  {
    seq: 8, id: 'toolu_08', tool: 'Edit', key: '/src/token.ts', cls: 'other', agent: 'agent-1', turn: 7,
    ms: 200, chars: 260, head: 'Edited /src/token.ts', flags: [], lines: { add: 10, del: 1 },
    paths: ['/src/token.ts'], spawn: null,
  },
]
