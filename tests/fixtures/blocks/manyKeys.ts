import type { Row } from '../../../hooks/core/types'

/** `older` main-loop rows, each its own key and costing `10 × seq` chars, then 150 suite runs of 100 chars each. */
export const manyKeys = (older: number): Row[] =>
  Array.from({ length: older + 150 }, (_, i) => {
    const seq = i + 1
    const old = seq <= older
    return {
      seq, id: `toolu_k${seq}`, tool: 'Bash', key: old ? `read:cat file-${seq}.md` : 'test:bun test', cls: old ? 'read' : 'test',
      agent: 'main', turn: seq, ms: 10, chars: old ? 10 * seq : 100, head: '', flags: [], lines: null, paths: [], spawn: null,
    }
  })
