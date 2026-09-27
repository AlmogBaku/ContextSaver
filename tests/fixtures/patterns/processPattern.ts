import type { Pattern } from '../../../hooks/core/types'

/** An undecided process pattern citing run `w3`: per-lane reviews stacked on a whole-branch review; overrides win. */
export const processPattern = (over: Partial<Pattern> = {}): Pattern => ({
  id: 'process:review-per-lane',
  category: 'process',
  kind: 'Each lane runs Implement → Review → Fix before a whole-branch review',
  signature: null,
  why: 'Two lane reviews found what the branch review would have caught.',
  alternative: 'Drop the per-lane review and fix rounds and keep the one branch review.',
  confidence: 0.85,
  proposal: null,
  estTokensPerTurn: null,
  lastDecision: null,
  lean: 'Implement every lane, review the branch once, fix once',
  hits: ['run:w3'],
  decision: null,
  decidedAtTurn: null,
  instruction: null,
  openedAtTurn: null,
  ignored: 0,
  sent: 0,
  ...over,
})
