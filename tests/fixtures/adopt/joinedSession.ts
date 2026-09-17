import type { SessionMessage } from 'claude-code'

import { assistant } from './assistant'
import { bashUse } from './bashUse'
import { prompt } from './prompt'
import { toolResults } from './toolResults'

/** Two prompts and four finished calls: the transcript a plugin loaded mid-session reads. */
export const joinedSession: readonly SessionMessage[] = [
  prompt('fix the auth refresh'),
  assistant([
    bashUse({ tool_use_id: 'u-1' }),
    bashUse({ tool_use_id: 'u-2', input: { command: 'rg needle src' }, text: 'src/auth.ts:12' }),
  ]),
  toolResults(['u-1', 'u-2']),
  assistant([bashUse({ tool_use_id: 'u-3', result: undefined, text: 'command not found', isError: true })], 'that failed'),
  prompt('now run the tests'),
  assistant([bashUse({ tool_use_id: 'u-4' })]),
]
