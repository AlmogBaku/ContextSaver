import type { Pattern, Row } from './types'

// A sample session, three turns wide: what the demo's rows and patterns are dated against. A session
// younger than the sample is dated from turn 8, so the cards read 'turns 5…8' rather than 'turn 1'.
const DEMO_TURN = 8
const at = (turn: number, back: number): number => Math.max(1, Math.max(turn, DEMO_TURN) - back)

const SUITE_KEY = 'test:bun test'
const LOG_KEY = 'read:cat logs/api.log'
const AGENT_KEY = 'agent:explore'

const sample = (
  id: string,
  tool: string,
  key: string,
  cls: Row['cls'],
  turn: number,
  ms: number,
  chars: number,
  head: string,
  spawn: Row['spawn'] = null,
): Omit<Row, 'seq'> => ({ id, tool, key, cls, agent: 'main', turn, ms, chars, head, flags: [], lines: null, paths: [], spawn })

/** The ledger rows the demo's wasters cite, so their cost and their evidence quotes are real rows. */
export const demoRows = (turn: number): Omit<Row, 'seq'>[] => [
  sample('demo-suite-1', 'Bash', SUITE_KEY, 'test', at(turn, 3), 62_000, 24_000, '212 pass · 0 fail · ran 1284 expect() calls in 61.98s'),
  sample('demo-log-1', 'Bash', LOG_KEY, 'read', at(turn, 3), 4_000, 80_000, 'GET /health 200 12ms · GET /v1/users 200 41ms · POST /v1/tokens 500 88ms'),
  sample('demo-agent-1', 'Agent', AGENT_KEY, 'other', at(turn, 2), 90_000, 36_000, 'Explored src/auth: 6 files read, the refresh flow lives in src/auth/refresh.ts', {
    type: 'explore', requested: null, resolved: 'claude-sonnet-4-6', status: 'completed', tokens: 9_000, edits: 0, promptChars: 420,
  }),
  sample('demo-suite-2', 'Bash', SUITE_KEY, 'test', at(turn, 2), 59_000, 24_000, '212 pass · 0 fail · ran 1284 expect() calls in 58.71s'),
  sample('demo-log-2', 'Bash', LOG_KEY, 'read', at(turn, 1), 4_000, 80_000, 'GET /health 200 11ms · GET /v1/users 200 39ms · POST /v1/tokens 500 91ms'),
  sample('demo-agent-2', 'Agent', AGENT_KEY, 'other', at(turn, 1), 90_000, 36_000, 'Explored src/auth: 6 files read, the refresh flow lives in src/auth/refresh.ts', {
    type: 'explore', requested: null, resolved: 'claude-sonnet-4-6', status: 'completed', tokens: 9_000, edits: 0, promptChars: 430,
  }),
  sample('demo-suite-3', 'Bash', SUITE_KEY, 'test', at(turn, 0), 71_000, 24_000, '212 pass · 0 fail · ran 1284 expect() calls in 70.44s'),
]

/** Three sample wasters for `/saver demo`: two awaiting a decision, one already steered with a rule behind it. */
export const demoPatterns = (turn: number): Pattern[] => [
  {
    id: 'execution:full-suite',
    category: 'execution',
    kind: 'Claude keeps running the whole bun test suite after every single-file edit',
    signature: { tool: 'Bash', key: SUITE_KEY },
    why: 'the suite ran in full three times while only src/auth.ts changed between runs; the user asked for a fix, not full verification',
    alternative: 'run only the tests covering the files you changed; run the full suite once when the phase is done',
    confidence: 0.9,
    proposal: null,
    estTokensPerTurn: null,
    lastDecision: null,
    hits: ['demo-suite-1', 'demo-suite-2', 'demo-suite-3'],
    decision: null,
    decidedAtTurn: null,
    instruction: null,
    openedAtTurn: null,
    ignored: 0,
  },
  {
    id: 'reading:api-logs',
    category: 'reading',
    kind: 'Claude keeps reading 2000 lines of api logs instead of grepping for the error',
    signature: { tool: 'Bash', key: LOG_KEY },
    why: 'the whole log was read twice when one grep would have shown the traceback',
    alternative: "grep -nE 'ERROR|Traceback' and read only the 50 lines around the match",
    confidence: 0.8,
    proposal: null,
    estTokensPerTurn: null,
    lastDecision: null,
    hits: ['demo-log-1', 'demo-log-2'],
    decision: null,
    decidedAtTurn: null,
    instruction: null,
    openedAtTurn: null,
    ignored: 0,
  },
  {
    id: 'multi-agent:re-explores',
    category: 'multi-agent',
    kind: 'Claude keeps spawning a fresh explore agent that re-reads what the last one already reported',
    signature: { tool: 'Agent', key: AGENT_KEY },
    why: 'two explore agents read the same six files in src/auth, and the second brief carried none of the first report',
    alternative: "pass the previous explore agent's findings into the next brief instead of asking a new agent to read the same files",
    confidence: 0.8,
    proposal: {
      kind: 'claude-md',
      title: "Reuse an explore agent's findings",
      body: "Give a new explore agent the previous agent's findings; never ask it to re-read files another agent has already reported on.",
    },
    estTokensPerTurn: null,
    lastDecision: null,
    hits: ['demo-agent-1', 'demo-agent-2'],
    decision: 'steer',
    decidedAtTurn: at(turn, 1),
    instruction: "pass the last explore agent's findings into the next brief instead of re-reading the same files",
    openedAtTurn: at(turn, 1),
    ignored: 0,
  },
]
