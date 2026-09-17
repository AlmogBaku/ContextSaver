import type { Call } from './call'

/** A synchronous subagent that finished: model, status, tokens and edit count all known. */
export const agentCompleted: Call = {
  e: {
    tool: 'Agent',
    tool_use_id: 'call_12',
    description: 'run the suite',
    prompt: 'Run the suite',
    subagent_type: 'test-runner',
    model: 'sonnet',
  },
  result: {
    result: {
      agentId: 'a_1',
      agentType: 'test-runner',
      content: [{ type: 'text', text: 'suite green' }],
      resolvedModel: 'claude-sonnet-4-5',
      modelsUsed: ['claude-sonnet-4-5'],
      totalToolUseCount: 9,
      totalDurationMs: 41000,
      totalTokens: 51234,
      toolStats: { readCount: 3, searchCount: 1, bashCount: 4, editFileCount: 2, linesAdded: 10, linesRemoved: 1, otherToolCount: 0 },
      status: 'completed',
      prompt: 'Run the suite',
    },
    text: 'suite green',
    ref: 13,
  },
}
