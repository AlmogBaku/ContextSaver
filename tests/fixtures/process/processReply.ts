/** One process finding as the process judge would return it; overrides win. */
export const rawProcessFinding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'process:review-per-lane',
  kind: 'Each lane runs Implement → Review → Fix before a whole-branch review',
  lean: 'Implement every lane, review the branch once, fix once',
  alternative: 'Change the remaining work: drop the per-lane review and fix rounds and keep the one branch review.',
  why: 'Three lane reviews on Opus found one high each, which the branch review would have caught.',
  evidence: ['run:w1'],
  cost_tokens: 100_000,
  cost_ms: 600_000,
  confidence: 0.85,
  proposal: null,
  ...over,
})

/** A process reply carrying the findings given. */
export const processReply = (findings: readonly unknown[]): string => JSON.stringify({ findings })
