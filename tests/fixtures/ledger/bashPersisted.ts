import type { Call } from './call'

/** A grep whose full output was persisted to disk; only the preview reached the context. */
export const bashPersisted: Call = {
  e: { tool: 'Bash', tool_use_id: 'call_4', command: 'grep -rn TODO .' },
  result: {
    result: {
      stdout: 'a'.repeat(200),
      stderr: '',
      interrupted: false,
      persistedOutputPath: '/w/.claude/tool-results/call_4.txt',
      persistedOutputSize: 262144,
    },
    text: 'a'.repeat(120),
    ref: 5,
  },
}
