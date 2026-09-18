import type { Loop } from '../../../hooks/core/types'

/** A finished loop of run `w3`, stage `impl:C3`, one turn of 5 minutes and 48k tokens; overrides win. */
export const sampleLoop = (over: Partial<Loop> = {}): Loop => ({
  id: 'agent-1', run: 'w3', label: 'impl:C3', phase: 'build', model: 'claude-opus-4-1', turns: 1, ms: 300_000,
  tokens: { input: 30_000, output: 8_000, cacheRead: 200_000, cacheCreate: 10_000 }, ended: 'answer',
  firstTurn: 4, firstSeq: 3, outcome: null, calls: 0, edits: 0, checks: 0, reads: 0,
  ...over,
})
