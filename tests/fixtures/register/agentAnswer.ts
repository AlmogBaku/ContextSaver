import type { ToolCallResult } from 'claude-code'

/** What an `Agent` call answers when its loop `agent-9` went to the background on Sonnet. */
export const agentAnswer: ToolCallResult = {
  result: {
    status: 'async_launched',
    agentId: 'agent-9',
    description: 'explore src',
    resolvedModel: 'claude-sonnet-4-5',
    prompt: 'look around',
    outputFile: '/tmp/agent-9.txt',
  },
  text: 'Agent agent-9 launched in the background',
}
