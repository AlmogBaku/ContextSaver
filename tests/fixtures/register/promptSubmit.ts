import type { PromptSubmitInput } from 'claude-code'

/**
 * A prompt the person typed at the composer, as the engine hands it to the hooks.
 *
 * @param text the prompt as typed
 */
export const promptSubmit = (text: string): PromptSubmitInput => ({ text, wait: false, origin: { kind: 'composer' } })
