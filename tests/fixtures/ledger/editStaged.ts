import type { Call } from './call'

/** An Edit held for review: the file is unchanged, so the call edited no path. */
export const editStaged: Call = {
  e: { tool: 'Edit', tool_use_id: 'call_10', file_path: '/w/.claude/settings.json', old_string: '{}', new_string: '{ "a": 1 }' },
  result: {
    result: {
      filePath: '/w/.claude/settings.json',
      oldString: '{}',
      newString: '{ "a": 1 }',
      originalFile: '{}\n',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['-{}', '+{', '+  "a": 1', '+}'] }],
      userModified: false,
      replaceAll: false,
      staged: true,
    },
    text: 'The edit was staged for the machine owner to review; the file is unchanged.',
    ref: 11,
  },
}
