import type { Call } from './call'

/** A dev server the model asked for in the background. */
export const bashBackground: Call = {
  e: { tool: 'Bash', tool_use_id: 'call_5', command: 'bun run dev', run_in_background: true },
  result: {
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg_1' },
    text: 'Command running in background with ID bg_1',
    ref: 6,
  },
}
