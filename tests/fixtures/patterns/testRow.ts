import type { Row } from '../../../hooks/core/types'

/** A main-loop `bun test` ledger row, with whatever the test overrides. */
export const testRow = (over: Partial<Omit<Row, 'seq'>> = {}): Omit<Row, 'seq'> => ({
  id: 'r-1', tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', turn: 1,
  ms: 60_000, chars: 9_000, head: '✓ 212 passed', flags: [], lines: null, paths: [], spawn: null,
  ...over,
})
