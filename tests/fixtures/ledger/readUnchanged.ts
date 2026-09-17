import type { Call } from './call'

/** A Read the engine deduped: the file was already in context unchanged. */
export const readUnchanged: Call = {
  e: { tool: 'Read', tool_use_id: 'call_7', file_path: '/w/hooks/core/types.ts' },
  result: {
    result: { type: 'file_unchanged', file: { filePath: '/w/hooks/core/types.ts' } },
    text: '<file already read and unchanged>',
    ref: 8,
  },
}
