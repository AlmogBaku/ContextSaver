import type { Call } from './call'

/** An answered `bun test`: 25 characters of output carrying a newline, a tab and a bell. */
export const bashAnswered: Call = {
  e: { tool: 'Bash', tool_use_id: 'call_1', command: 'bun test' },
  result: {
    result: { stdout: '12 pass 0 fail', stderr: '', interrupted: false },
    text: '12 pass\n\t0 fail' + String.fromCharCode(7) + ' all good',
    ref: 3,
  },
}
