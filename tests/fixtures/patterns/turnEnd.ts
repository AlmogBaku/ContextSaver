import type { TurnStat } from '../../../hooks/core/types'

/** A finished main-loop turn worth 10k new tokens, with whatever the test overrides. */
export const turnEnd = (over: Partial<Omit<TurnStat, 'turn' | 'calls'>> = {}): Omit<TurnStat, 'turn' | 'calls'> => ({
  input: 8_000, output: 2_000, cacheRead: 40_000, cacheCreate: 0,
  ms: 30_000, answerChars: 400, answerHead: 'Done: the token refresh now retries once.', aborted: false,
  context: null,
  ...over,
} as Omit<TurnStat, 'turn' | 'calls'>)
