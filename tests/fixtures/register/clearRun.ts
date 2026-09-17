import type { CommandRunInput } from 'claude-code'

/** `/clear` typed at the composer. */
export const CLEAR_RUN: CommandRunInput = {
  command: 'clear',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
}
