import { MAIN_AGENT } from './types'
import type { Pattern, Row, TurnStat, Usage } from './types'

// A sample session, three turns wide: what the demo's rows and patterns are dated against. A session
// younger than the sample is dated from turn 8, so the cards read 'turns 5–8' rather than 'turn 1'.
const DEMO_TURN = 8
const at = (turn: number, back: number): number => Math.max(1, Math.max(turn, DEMO_TURN) - back)

const SUITE_KEY = 'test:bun test'
const LOG_KEY = 'read:cat logs/api.log'
const AGENT_KEY = 'agent:explore'
const EXPLORE_AGENT = 'sub-explore-1'   // one sample read ran inside the explore loop, so the alias column draws

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
): Omit<Row, 'seq'> => ({ id, tool, key, cls, agent: MAIN_AGENT, turn, ms, chars, head, flags: [], lines: null, paths: [], spawn })

// The same call, made inside the explore agent rather than the main loop: the pane names that loop `a1`.
const inExplore = (row: Omit<Row, 'seq'>): Omit<Row, 'seq'> => ({ ...row, agent: EXPLORE_AGENT })

const turnSample = (input: number, output: number, ms: number, answer: string): Omit<TurnStat, 'turn' | 'calls'> => ({
  input, output, cacheRead: 180_000, cacheCreate: 7_000, ms, answerChars: answer.length, answerHead: answer, aborted: false, context: null,
})

/** The usage the demo's header draws from: a third of a million-token window spent, with a compaction threshold. */
export const demoUsage = (): Usage => ({ window: 1_000_000, compactAt: 900_000, tokens: 320_000, percent: 32 })

/** Three sample turns, so the header's run to compaction has a pace to state it in turns. */
export const demoTurns = (): Omit<TurnStat, 'turn' | 'calls'>[] => [
  turnSample(42_000, 3_000, 96_000, 'Ran the suite: 212 pass. Reading the api log for the 500 next.'),
  turnSample(41_000, 4_000, 132_000, 'The refresh flow lives in src/auth/refresh.ts; the token TTL is the bug.'),
  turnSample(43_000, 2_000, 88_000, 'Suite is green again after the token fix.'),
]

/** The ledger rows the demo's wasters cite, so their cost and their evidence quotes are real rows. */
export const demoRows = (turn: number): Omit<Row, 'seq'>[] => [
  sample('demo-suite-1', 'Bash', SUITE_KEY, 'test', at(turn, 3), 62_000, 24_000, '212 pass · 0 fail · ran 1284 expect() calls in 61.98s'),
  sample('demo-log-1', 'Bash', LOG_KEY, 'read', at(turn, 3), 4_000, 80_000, 'GET /health 200 12ms · GET /v1/users 200 41ms · POST /v1/tokens 500 88ms'),
  sample('demo-agent-1', 'Agent', AGENT_KEY, 'other', at(turn, 2), 90_000, 36_000, 'Explored src/auth: 6 files read, the refresh flow lives in src/auth/refresh.ts', {
    type: 'explore', requested: null, resolved: 'claude-sonnet-4-6', status: 'completed', tokens: 9_000, edits: 0, promptChars: 420,
  }),
  sample('demo-suite-2', 'Bash', SUITE_KEY, 'test', at(turn, 2), 59_000, 24_000, '212 pass · 0 fail · ran 1284 expect() calls in 58.71s'),
  inExplore(sample('demo-log-2', 'Bash', LOG_KEY, 'read', at(turn, 1), 11_000, 80_000, 'GET /health 200 11ms · GET /v1/users 200 39ms · POST /v1/tokens 500 91ms')),
  sample('demo-agent-2', 'Agent', AGENT_KEY, 'other', at(turn, 1), 90_000, 36_000, 'Explored src/auth: 6 files read, the refresh flow lives in src/auth/refresh.ts', {
    type: 'explore', requested: null, resolved: 'claude-sonnet-4-6', status: 'completed', tokens: 9_000, edits: 0, promptChars: 430,
  }),
  sample('demo-suite-3', 'Bash', SUITE_KEY, 'test', at(turn, 0), 71_000, 24_000, '212 pass · 0 fail · ran 1284 expect() calls in 70.44s'),
]

/**
 * Three sample wasters for `/saver demo`: two awaiting a decision — the spawn one carrying the judge's
 * own rule — and one already steered, whose rule the pane derives from the instruction that was sent.
 */
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
    decision: 'steer',
    decidedAtTurn: at(turn, 1),
    instruction: 'run only the tests for the file you just edited; the full suite once at the end of the phase',
    openedAtTurn: at(turn, 1),
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
    decision: null,
    decidedAtTurn: null,
    instruction: null,
    openedAtTurn: null,
    ignored: 0,
  },
]
