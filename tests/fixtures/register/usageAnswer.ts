import type { SessionUsage } from 'claude-code'

/**
 * What `$.session.usage` answers: a 200k window 12% full, auto-compaction at 180k, and a
 * summary breakdown whose memory files, MCP schemas and agent briefs are the session's overhead.
 *
 * @param over the context figures to replace
 */
export const usageAnswer = (over: { tokens?: number; percent?: number } = {}): SessionUsage => ({
  context: {
    window: 200_000,
    tokens: over.tokens ?? 24_000,
    percent: over.percent ?? 12,
    breakdown: {
      categories: [],
      totalTokens: over.tokens ?? 24_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model-default',
      percentage: over.percent ?? 12,
      gridRows: [],
      model: 'claude-opus-4-6',
      memoryFiles: [{ path: '/work/CLAUDE.md', type: 'project', tokens: 1_200 }],
      mcpTools: [{ name: 'search', serverName: 'docs', tokens: 3_000, isLoaded: true }, { name: 'fetch', serverName: 'docs', tokens: 400, isLoaded: true }],
      agents: [{ agentType: 'explorer', source: 'project', tokens: 800 }],
      autoCompactThreshold: 180_000,
      isAutoCompactEnabled: true,
      apiUsage: null,
    },
  },
  rateLimits: [],
})
