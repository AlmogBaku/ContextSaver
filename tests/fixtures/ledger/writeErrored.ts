import type { Call } from './call'

/** A Write core refused: no file was touched, so the row carries no lines and no path. */
export const writeErrored: Call = {
  e: {
    tool: 'Write',
    tool_use_id: 'call_12',
    file_path: '/w/hooks/core/ledger.ts',
    content: 'export const a = 1\n',
  },
  result: { isError: true, result: 'EACCES: permission denied', text: 'error: permission denied', ref: 13 },
}
