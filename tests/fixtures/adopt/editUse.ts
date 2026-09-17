import type { ToolUseSummary } from 'claude-code'

/** An Edit the transcript stored with the git diff it produced. */
export const editUse: ToolUseSummary = {
  tool_use_id: 'u-edit',
  tool: 'Edit',
  input: { file_path: '/work/src/auth.ts', old_string: 'refresh()', new_string: 'refreshToken()' },
  result: { filePath: '/work/src/auth.ts', gitDiff: { additions: 3, deletions: 1 } },
  text: 'The file /work/src/auth.ts has been updated.',
}
