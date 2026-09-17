import type { SessionMessage } from 'claude-code'

/** The one message a compaction leaves behind: its summary. */
export const compactedMessage: SessionMessage = { role: 'assistant', text: 'Summary of the session so far.', toolUses: [] }
