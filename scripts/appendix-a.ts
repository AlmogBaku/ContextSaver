// Dev check (`bun run scripts/appendix-a.ts`): Appendix A must be byte-identical in three places —
// JUDGE_PROMPT, docs/SPEC.md and the plan file. Not plugin code: outside tsconfig, never imported by hooks.
import { readFileSync } from 'node:fs'

import { JUDGE_PROMPT } from '../hooks/core/judge.ts'

// The prompt itself contains a nested ```json fence, so take the LAST ``` before the next `## Appendix` heading.
const fenced = (path: string): string => {
  const lines = readFileSync(path, 'utf8').split('\n')
  const head = lines.findIndex(l => l.startsWith('## Appendix A'))
  const tail = lines.findIndex((l, i) => i > head && l.startsWith('## Appendix B'))
  const open = lines.findIndex((l, i) => i > head && l.startsWith('```text'))
  let close = -1
  for (let i = open + 1; i < tail; i += 1) if (lines[i] === '```') close = i
  return `${lines.slice(open + 1, close).join('\n')}\n`
}

const copies: Record<string, string> = {
  JUDGE_PROMPT,
  'docs/SPEC.md': fenced('docs/SPEC.md'),
  'plan file': fenced('/home/anakin/.claude/plans/lets-plan-this-mods-playground-prd-md-zany-lighthouse.md'),
}

for (const [name, text] of Object.entries(copies)) {
  console.log(`${name}: ${Buffer.byteLength(text, 'utf8')} bytes / ${text.length} chars / ${text.trim().split(/\s+/).length} words`)
}
const values = Object.values(copies)
const same = values.every(t => t === values[0])
console.log(same ? 'IDENTICAL' : 'MISMATCH')
if (!same) {
  for (const [name, text] of Object.entries(copies)) {
    if (text === values[0]) continue
    const a = (values[0] ?? '').split('\n')
    const b = text.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) {
        console.log(`${name} first differs at line ${i + 1}:\n  JUDGE_PROMPT: ${JSON.stringify(a[i])}\n  ${name}: ${JSON.stringify(b[i])}`)
        break
      }
    }
  }
  process.exit(1)
}
