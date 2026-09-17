/** An existing settings.json with unrelated keys, an unrelated permissions key and one allow rule. */
export const existingSettings = JSON.stringify({
  model: 'opus',
  permissions: { deny: ['Bash(rm -rf:*)'], allow: ['Bash(git status:*)'] },
  env: { CONTEXTSAVER_DEBUG: '1' },
})
