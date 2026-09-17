import type { SessionMessage } from 'claude-code'

import { assistant } from '../adopt/assistant'
import { bashUse } from '../adopt/bashUse'
import { prompt } from '../adopt/prompt'

/** Three turns of the same `bun test`, run before the plugin ever loaded. */
export const joinedTranscript: SessionMessage[] = [1, 2, 3].flatMap(n => [
  prompt(`step ${n}`),
  assistant([bashUse({ tool_use_id: `u-${n}` })]),
])
