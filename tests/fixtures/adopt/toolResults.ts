import type { SessionMessage } from 'claude-code'

/**
 * The user message the tool loop puts back: tool_result blocks and nothing the user said.
 *
 * @param ids the calls these results answer
 */
export const toolResults = (ids: readonly string[]): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: ids.map(id => ({ tool_use_id: id, text: 'ok', isError: false })),
})
