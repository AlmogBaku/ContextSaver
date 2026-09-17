import type { ArtifactKind, Proposal } from '../../../hooks/core/types'

/** One judge proposal per artifact kind; the agent brief carries a model: line in its body. */
export const ruleProposals: Record<ArtifactKind, Proposal> = {
  'claude-md': { kind: 'claude-md', title: 'Targeted tests', body: 'Run only the tests covering the files you changed; run the full suite at the end of a phase.' },
  skill: { kind: 'skill', title: 'Targeted test run: fast', body: '# Targeted tests\n\nMap the changed files to their test files, run those, then stop.' },
  'agent-brief': { kind: 'agent-brief', title: 'Log triage brief', body: 'model: haiku\n\nGrep the api logs for errors and report the first failing request only.' },
  'settings-allow': { kind: 'settings-allow', title: 'Allow bun test', body: 'Bash(bun test:*)' },
}
