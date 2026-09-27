import type { AgentSpawnInput } from 'claude-code'

/**
 * What the Agent tool hands `agent.spawn` for a background general-purpose subagent started from the main loop.
 *
 * @param prompt the task the subagent is given
 */
export const spawnInput = (prompt: string): AgentSpawnInput => ({
  tool_use_id: 'toolu_spawn_1',
  prompt,
  description: 'explore src',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-4-6',
  background: true,
  fork: false,
})
