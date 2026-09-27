/** A workflow script whose `meta` literal declares three phases, one of them with a detail and a quoted key. */
export const workflowScript = `export const meta = {
  name: 'lanes',
  description: 'Implement, review and fix three lanes, then one branch review',
  phases: [
    { title: 'Implement' },
    { "title": "Review", detail: 'one reviewer per lane, [not] a phase' },
    { title: \`Fix\` },
  ],
}

const lanes = args.lanes.map(l => ({ title: 'not a phase' }))
await phase('Implement', () => parallel(lanes.map(l => agent(l.prompt, { model: 'opus' }))))
`

/** Scripts `phasesOf` must answer [] for: no meta, a meta with no phases, a phases list cut off mid-literal, a computed phases list. */
export const malformedScripts: readonly string[] = [
  'await agent("no meta at all")',
  "export const meta = { name: 'x', description: 'no phases' }",
  "export const meta = { name: 'x', phases: [{ title: 'Implement' }, { title: 'Rev",
  'export const meta = { name: "x", phases: PHASES.map(p => ({ title: p })) }',
  '',
]
