import type { ToolCallResult } from 'claude-code'

/**
 * A Bash call core answered with so many characters of output.
 *
 * @param chars how much in-context text the call cost
 */
export const bashAnswer = (chars: number): ToolCallResult => ({
  result: { stdout: 'x', stderr: '', interrupted: false },
  text: 'x'.repeat(chars),
})
