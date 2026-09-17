import type { Call } from './call'

/** A Write that created a three-line file. */
export const writeCreated: Call = {
  e: {
    tool: 'Write',
    tool_use_id: 'call_11',
    file_path: '/w/hooks/core/ledger.ts',
    content: 'export const a = 1\nexport const b = 2\nexport const c = 3\n',
  },
  result: {
    result: {
      type: 'create',
      filePath: '/w/hooks/core/ledger.ts',
      content: 'export const a = 1\nexport const b = 2\nexport const c = 3\n',
      structuredPatch: [],
      originalFile: null,
    },
    text: 'File created successfully at: /w/hooks/core/ledger.ts',
    ref: 12,
  },
}
