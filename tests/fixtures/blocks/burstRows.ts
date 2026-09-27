import type { Row } from '../../../hooks/core/types'

const row = (seq: number, agent: string, key: string): Row => ({
  seq, id: `toolu_b${seq}`, tool: 'Bash', key, cls: key.startsWith('test:') ? 'test' : 'read', agent, turn: 1 + Math.floor(seq / 10),
  ms: 10, chars: 100, head: '', flags: [], lines: null, paths: [], spawn: null,
})

/** A 300-row ledger: ten main-loop suite runs, ten reads by `agent-2`, then a burst of 280 reads by `agent-1`. */
export const burstRows = (): Row[] =>
  Array.from({ length: 300 }, (_, i) => {
    const seq = i + 1
    if (seq <= 10) return row(seq, 'main', 'test:bun test')
    if (seq <= 20) return row(seq, 'agent-2', 'read:cat notes.md')
    return row(seq, 'agent-1', `read:cat part-${seq}.md`)
  })
