import type { Call } from './call'

/** A subagent's ranged Read of a huge log, cut at the token cap. */
export const readTruncated: Call = {
  e: { tool: 'Read', tool_use_id: 'call_8', agentId: 'agent_2', file_path: '/w/build.log', offset: 1, limit: 500 },
  result: {
    result: {
      type: 'text',
      file: {
        filePath: '/w/build.log',
        content: 'line 1\nline 2',
        numLines: 500,
        startLine: 1,
        totalLines: 90000,
        truncatedByTokenCap: true,
      },
    },
    text: 'line 1\nline 2',
    ref: 9,
  },
}
