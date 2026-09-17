import type { ToolUseSummary } from 'claude-code'

/** A finished subagent run as the transcript stored it. */
export const agentUse: ToolUseSummary = {
  tool_use_id: 'u-agent',
  tool: 'Agent',
  input: { subagent_type: 'code-reviewer', model: 'sonnet', prompt: 'review the diff' },
  result: { resolvedModel: 'claude-sonnet-4-6', status: 'completed', totalTokens: 12_000, toolStats: { editFileCount: 2 } },
  text: 'the review',
}
