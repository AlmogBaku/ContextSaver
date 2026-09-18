/** A workflow journal: two stages started, a findings result, a report result, and the lines a reader must skip. */
export const journalText = [
  '{"type":"started","agentId":"agent-1","label":"impl:C3","phase":"build"}',
  '',
  'not json at all',
  '{"type":"started","agentId":"agent-2","label":"review:C3-r1"}',
  '{"type":"result","agentId":"agent-2","result":{"findings":[{"severity":"high"},{"severity":"low"},{"severity":"low"},{"severity":"info"},"junk"]}}',
  '{"type":"result","agentId":"agent-1","result":"Implemented C3: the proxy now retries once."}',
  '{"type":"result","agentId":"agent-3","result":{"summary":"ok","files":3}}',
  '{"type":"heartbeat","agentId":"agent-1"}',
  '{"type":"started","label":"no agent id"}',
  '[1,2,3]',
].join('\n')
