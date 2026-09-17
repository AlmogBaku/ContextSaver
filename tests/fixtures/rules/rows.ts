import type { Row } from '../../../hooks/core/types'

/** Two cheap test rows (t1, t2) and two expensive log rows (t3, t4) for baseline maths. */
export const ruleRows: Row[] = [
  { seq: 1, id: 't1', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 5, ms: 60_000, chars: 8_000, head: '212 passed', flags: [], lines: null, paths: [], spawn: null },
  { seq: 2, id: 't2', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 7, ms: 60_000, chars: 8_000, head: '212 passed', flags: [], lines: null, paths: [], spawn: null },
  { seq: 3, id: 't3', tool: 'Bash', key: 'read:docker compose logs api', cls: 'read', agent: 'main', turn: 11, ms: 3_000, chars: 40_000, head: 'INFO boot', flags: [], lines: null, paths: [], spawn: null },
  { seq: 4, id: 't4', tool: 'Bash', key: 'read:docker compose logs api', cls: 'read', agent: 'main', turn: 13, ms: 3_000, chars: 40_000, head: 'INFO boot', flags: [], lines: null, paths: [], spawn: null },
]
