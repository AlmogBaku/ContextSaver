import type { Call } from './call'

/** A refused call: no result, no text. */
export const bashDenied: Call = {
  e: { tool: 'Bash', tool_use_id: 'call_3', command: 'rm -rf /' },
  result: { deny: 'The user does not allow this command' },
}
