import type { CommandRunInput } from 'claude-code'

/**
 * `/saver <args>` typed at the composer on an 80-column main screen.
 *
 * @param args everything after the command's name
 */
export const saverRun = (args = ''): CommandRunInput => ({
  command: 'saver',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})
