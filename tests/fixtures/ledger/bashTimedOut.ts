import type { Call } from './call'

/** A test run that hit its timeout, was auto-backgrounded, and left a file changed. */
export const bashTimedOut: Call = {
  e: { tool: 'Bash', tool_use_id: 'call_6', command: 'FOO=1 bun test --coverage' },
  result: {
    result: {
      stdout: 'partial output',
      stderr: '',
      interrupted: false,
      backgroundTaskId: 'bg_2',
      timedOutAfterMs: 120000,
      bashEditDiff: { files: [], moreFiles: 0, changedFiles: ['/w/coverage/lcov.info'] },
    },
    text: 'Command timed out after 2m 0s',
    ref: 7,
  },
}
