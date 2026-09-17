import type { ToolUseSummary } from 'claude-code'

/**
 * An answered `bun test` call as the transcript stored it, with whatever the test overrides.
 *
 * @param over the fields this call differs in
 */
export const bashUse = (over: Partial<ToolUseSummary> = {}): ToolUseSummary => ({
  tool_use_id: 'u-1',
  tool: 'Bash',
  input: { command: 'bun test' },
  result: { stdout: 'ok', stderr: '', interrupted: false },
  text: '212 pass',
  ...over,
})
