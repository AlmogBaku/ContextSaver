/** The journal of run `w3` so far: `impl:C3` started and reported, `check:C3` started and still going. */
export const journalLines = [
  '{"type":"started","agentId":"agent-1","label":"impl:C3","phase":"build"}',
  '{"type":"result","agentId":"agent-1","result":"Implemented C3: the proxy now retries once."}',
  '{"type":"started","agentId":"agent-2","label":"check:C3","phase":"verify"}',
].join('\n')
