import type { Call } from './call'

/** An applied Edit whose gitDiff counts the whole file's change, not just this hunk. */
export const editGitDiff: Call = {
  e: { tool: 'Edit', tool_use_id: 'call_9', file_path: '/w/hooks/register.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
  result: {
    result: {
      filePath: '/w/hooks/register.ts',
      oldString: 'const a = 1',
      newString: 'const a = 2',
      originalFile: 'const a = 1\n',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const a = 1', '+const a = 2'] }],
      userModified: false,
      replaceAll: false,
      gitDiff: { filename: 'hooks/register.ts', status: 'modified', additions: 7, deletions: 2, changes: 9, patch: '@@ -1 +1 @@' },
    },
    text: 'The file /w/hooks/register.ts has been updated.',
    ref: 10,
  },
}
