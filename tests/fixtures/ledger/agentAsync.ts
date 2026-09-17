import type { Call } from './call'

/** A subagent launched in the background: nothing is known yet but its status. */
export const agentAsync: Call = {
  e: { tool: 'Agent', tool_use_id: 'call_13', description: 'lint the repo', prompt: 'Lint everything', run_in_background: true },
  result: {
    result: {
      status: 'async_launched',
      isAsync: true,
      agentId: 'a_2',
      description: 'lint the repo',
      prompt: 'Lint everything',
      outputFile: '/w/.claude/agents/a_2.txt',
    },
    text: 'Agent a_2 launched in the background',
    ref: 14,
  },
}
