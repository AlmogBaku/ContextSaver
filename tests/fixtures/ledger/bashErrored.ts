import type { Call } from './call'

/** A failed `npm test` behind a `cd`: core stored the error text, not the tool's record. */
export const bashErrored: Call = {
  e: { tool: 'Bash', tool_use_id: 'call_2', command: 'cd packages/api && npm test' },
  result: { isError: true, result: 'exit code 1', text: 'error: 1 test failed', ref: 4 },
}
