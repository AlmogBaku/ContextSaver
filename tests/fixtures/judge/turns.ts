import type { TurnStat } from '../../../hooks/core/types'

/** Seven main-loop turns totalling 40,000 new tokens; turns 5 and 6 made no tool call. */
export const turns: TurnStat[] = [
  { turn: 1, input: 5000, output: 500, cacheRead: 20_000, cacheCreate: 2000, calls: 1, ms: 9000, answerChars: 250, answerHead: 'Reading the auth module', aborted: false, context: null },
  { turn: 2, input: 3000, output: 400, cacheRead: 30_000, cacheCreate: 1000, calls: 1, ms: 64_000, answerChars: 300, answerHead: 'The suite passes', aborted: false, context: null },
  { turn: 3, input: 3000, output: 600, cacheRead: 30_000, cacheCreate: 1000, calls: 1, ms: 4000, answerChars: 320, answerHead: 'Edited the refresh path', aborted: false, context: null },
  { turn: 4, input: 3000, output: 500, cacheRead: 31_000, cacheCreate: 1500, calls: 2, ms: 62_000, answerChars: 340, answerHead: 'Green again', aborted: false, context: null },
  { turn: 5, input: 4000, output: 1400, cacheRead: 32_000, cacheCreate: 600, calls: 1, ms: 8000, answerChars: 5400, answerHead: 'Here is the plan again', aborted: false, context: null },
  { turn: 6, input: 4000, output: 1500, cacheRead: 33_000, cacheCreate: 1500, calls: 1, ms: 63_000, answerChars: 6100, answerHead: 'Recapping what is done', aborted: false, context: null },
  { turn: 7, input: 3000, output: 1000, cacheRead: 34_000, cacheCreate: 1500, calls: 2, ms: 31_000, answerChars: 800, answerHead: 'Spawned the explorer', aborted: true, context: null },
]
