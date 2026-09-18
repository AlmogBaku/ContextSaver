import type { Folded } from '../../../hooks/core/types'

/** One (tool, key) pair the ledger cap dropped: ten main-loop suite runs, nothing citable left; overrides win. */
export const foldedPair = (over: Partial<Folded> = {}): Folded => ({
  tool: 'Bash', key: 'test:bun test', cls: 'test', agent: 'main', count: 10, ms: 600_000, chars: 90_000,
  firstTurn: 1, lastTurn: 3, flags: { ask: 0, recommended: 0, err: 0 },
  ...over,
})
