import type { SessionMessage } from 'claude-code'

/**
 * A request the user typed: a transcript message carrying text and no tool results.
 *
 * @param text what the user asked for
 */
export const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
