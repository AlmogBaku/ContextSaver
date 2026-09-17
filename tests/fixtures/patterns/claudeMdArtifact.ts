import type { Artifact } from '../../../hooks/core/types'

/** A rules-for-next-session artifact, as `propose()` hands it to the pane. */
export const claudeMdArtifact: Artifact = {
  patternId: 'execution:full-suite-after-each-edit',
  kind: 'claude-md',
  title: 'Targeted tests',
  path: '/work/CLAUDE.md',
  content: '\n## ContextSaver\n- Run only the tests covering the files you changed.\n',
  savingPct: 3.4,
  mode: 'append',
}
