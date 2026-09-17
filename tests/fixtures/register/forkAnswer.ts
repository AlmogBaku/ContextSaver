import type { ModelForkResult } from 'claude-code'

/**
 * What `$.model.fork` answers: the judge's reply and what the fork cost.
 *
 * @param text the reply, as the judge wrote it
 */
export const forkAnswer = (text: string): ModelForkResult => ({
  text,
  usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 100 },
})
