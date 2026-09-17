import type { Pattern } from '../../../hooks/core/types'

/** A behavioural pattern: no signature, turn handles as evidence, an estimate per turn. */
export const chattyPattern: Pattern = {
  id: 'communication:restates-plan-each-turn',
  category: 'communication',
  kind: 'Claude keeps restating the plan in turns that make no tool call',
  signature: null,
  why: 'turns 14 and 15 made no call and restated the plan already agreed',
  alternative: 'State the result in one or two lines and take the next action; do not restate the plan or recap finished steps.',
  confidence: 0.8,
  proposal: null,
  estTokensPerTurn: 1_200,
  lastDecision: null,
  hits: ['turn:14', 'turn:15'],
  decision: null,
  decidedAtTurn: null,
  instruction: null,
  openedAtTurn: null,
  ignored: 0,
}
