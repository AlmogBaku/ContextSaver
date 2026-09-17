import type { SessionMessage, ToolUseSummary } from 'claude-code'

/**
 * An assistant message with the calls it made.
 *
 * @param toolUses the tool_use blocks of the message
 * @param text what the assistant said beside them
 */
export const assistant = (toolUses: readonly ToolUseSummary[], text = ''): SessionMessage =>
  ({ role: 'assistant', text, toolUses: [...toolUses] })
