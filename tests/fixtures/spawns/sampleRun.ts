import type { Run } from '../../../hooks/core/types'

/** The workflow run `w3`, named `proxy-rewrite`, launched at turn 4 at clock 1_000_000; overrides win. */
export const sampleRun = (over: Partial<Run> = {}): Run => ({
  id: 'w3', name: 'proxy-rewrite', dir: '/tmp/runs/w3', turn: 4, seq: 3, at: 1_000_000, refreshedAt: 0,
  ...over,
})
