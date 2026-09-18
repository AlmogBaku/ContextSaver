import { describe, expect, test } from 'claude-code/testing'

import { classOf, normalize, rowOf } from '../hooks/core/ledger'
import { KEY_MAX } from '../hooks/core/types'
import type { CommandClass } from '../hooks/core/types'
import { agentAsync } from './fixtures/ledger/agentAsync'
import { agentCompleted } from './fixtures/ledger/agentCompleted'
import { bashAnswered } from './fixtures/ledger/bashAnswered'
import { bashBackground } from './fixtures/ledger/bashBackground'
import { bashDenied } from './fixtures/ledger/bashDenied'
import { bashErrored } from './fixtures/ledger/bashErrored'
import { bashPersisted } from './fixtures/ledger/bashPersisted'
import { bashTimedOut } from './fixtures/ledger/bashTimedOut'
import { editGitDiff } from './fixtures/ledger/editGitDiff'
import { editStaged } from './fixtures/ledger/editStaged'
import { notebookEdited } from './fixtures/ledger/notebookEdited'
import { readTruncated } from './fixtures/ledger/readTruncated'
import { readUnchanged } from './fixtures/ledger/readUnchanged'
import { writeCreated } from './fixtures/ledger/writeCreated'
import { writeErrored } from './fixtures/ledger/writeErrored'

describe('ledger', () => {
  test('classOf reads the table through cd, env and runner prefixes', () => {
    const table: readonly (readonly [string, CommandClass])[] = [
      ['bun test', 'test'], ['cd x && npm test', 'test'], ['FOO=1 bun test', 'test'], ['npx tsc', 'typecheck'],
      ['bunx vitest', 'test'], ['cd packages/api && FOO=1 pytest -q', 'test'], ['go test ./...', 'test'],
      ['cargo test --all', 'test'], ['mocha', 'test'], ['pnpm test', 'test'], ['jest --watch=false', 'test'],
      ['eslint .', 'lint'], ['biome lint ./src', 'lint'], ['golangci-lint run', 'lint'], ['ruff check .', 'lint'],
      ['flake8', 'lint'], ['yarn lint', 'lint'],
      ['prettier --write .', 'format'], ['biome format --write .', 'format'], ['gofmt -l .', 'format'],
      ['black hooks', 'format'], ['rustfmt src/main.rs', 'format'],
      ['tsc --noEmit', 'typecheck'], ['mypy hooks', 'typecheck'], ['pyright', 'typecheck'], ['npm run typecheck', 'typecheck'],
      ['make build', 'build'], ['docker build -t x .', 'build'], ['cargo build --release', 'build'],
      ['go build ./...', 'build'], ['vite build', 'build'], ['webpack --mode production', 'build'], ['bun run build', 'build'],
      ['npm install', 'install'], ['npm i lodash', 'install'], ['bun install', 'install'], ['bun add -d typescript', 'install'],
      ['pnpm install', 'install'], ['pnpm add zod', 'install'], ['yarn install', 'install'], ['yarn add react', 'install'],
      ['pip install ruff', 'install'], ['uv pip install ruff', 'install'], ['cargo fetch', 'install'],
      ['apt-get install -y jq', 'install'], ['brew install fd', 'install'],
      ['git status', 'git'], ['gh pr view 3', 'git'], ['cd repo && git log --oneline', 'git'],
      ['cat README.md', 'read'], ['head -20 log', 'read'], ['tail -f log', 'read'], ['less log', 'read'],
      ['ls -la', 'read'], ['tree hooks', 'read'], ['sed -n 1,20p file', 'read'],
      ['grep -rn TODO .', 'search'], ['rg saver hooks', 'search'], ['ag saver', 'search'], ['find . -name x', 'search'],
      ['fd -e ts', 'search'], ['ast-grep run -p x', 'search'],
      ['./scripts/check.sh', 'other'], ['echo hi', 'other'], ['bun run dev', 'other'], ['', 'other'],
      ['npm i', 'install'], ['npm install-test', 'other'],
    ]
    expect(table.map(([command]) => classOf(command))).toEqual(table.map(([, cls]) => cls))
  })

  test('classOf classifies a compound command by its first segment that names something', () => {
    const table: readonly (readonly [string, CommandClass])[] = [
      ["printf '\\n' >> README.md && ./scripts/check.sh", 'other'],
      ["printf '\\n' >> README.md && bun test", 'test'],
      ['echo hi; git status', 'git'],
      ['./scripts/check.sh || cat log', 'read'],
      ['mkdir -p dist && cd dist && cargo build --release', 'build'],
      ['bun test && git commit -m wip', 'test'],
      ['echo one && echo two', 'other'],
      ['grep -rn TODO . ; echo done', 'search'],
    ]
    expect(table.map(([command]) => classOf(command))).toEqual(table.map(([, cls]) => cls))
  })

  test('classOf sees through timeout, time and a path to the head, and knows python -m', () => {
    const table: readonly (readonly [string, CommandClass])[] = [
      ['timeout 900 bunx vitest run src', 'test'], ['timeout 30s pytest', 'test'], ['timeout 2m npm run lint', 'lint'],
      ['time cargo build', 'build'], ['cd x && timeout 5h time bun test', 'test'],
      ['venv/bin/python -m pytest tests/agent', 'test'], ['python -m pytest tests', 'test'], ['python3 -m pytest', 'test'],
      ['/usr/bin/git status', 'git'], ['./node_modules/.bin/tsc --noEmit', 'typecheck'], ['venv/bin/pytest -q', 'test'],
      ['python -m http.server', 'other'], ['timeout', 'other'], ['timeouts 3 bun test', 'other'], ['time', 'other'],
    ]
    expect(table.map(([command]) => classOf(command))).toEqual(table.map(([, cls]) => cls))
  })

  test('the key of a compound command names the segment that classified it', () => {
    expect(normalize('Bash', { command: "printf '\\n' >> README.md && bun test" })).toEqual({ key: 'test:bun test', cls: 'test' })
    expect(normalize('Bash', { command: 'cd /tmp/x && timeout 600 bunx vitest run a.test.ts' })).toEqual({ key: 'test:bunx vitest run a.test.ts', cls: 'test' })
    expect(normalize('Bash', { command: 'nproc; timeout 900 bunx vitest run src 2>&1 | grep -E "Tests"' })).toEqual({ key: 'test:bunx vitest run src', cls: 'test' })
    expect(normalize('Bash', { command: 'bunx tsc -p tsconfig.proxy.json --noEmit 2>&1 | tail -2; echo "tsc $?"' }))
      .toEqual({ key: 'typecheck:bunx tsc -p tsconfig.proxy.json --noEmit', cls: 'typecheck' })
  })

  test('the key of a Bash command names what ran, not how its output was filtered', () => {
    expect(normalize('Bash', { command: 'bunx vitest run packages/proxy 2>&1 | tail -12' })).toEqual({ key: 'test:bunx vitest run packages/proxy', cls: 'test' })
    expect(normalize('Bash', { command: 'bunx vitest run packages/proxy 2>&1 | grep -E "FAIL" | head -4' }).key).toBe('test:bunx vitest run packages/proxy')
    expect(normalize('Bash', { command: 'timeout 900 bunx vitest run src' })).toEqual({ key: 'test:bunx vitest run src', cls: 'test' })
    expect(normalize('Bash', { command: 'bun test 2>&1' })).toEqual({ key: 'test:bun test', cls: 'test' })
    expect(normalize('Bash', { command: 'bun test > out.log' })).toEqual({ key: 'test:bun test', cls: 'test' })
    expect(normalize('Bash', { command: 'git apply < fix.patch' })).toEqual({ key: 'git:git apply', cls: 'git' })
    expect(normalize('Bash', { command: 'FOO=1 bun test --coverage' })).toEqual({ key: 'test:bun test --coverage', cls: 'test' })
    // The class comes from the head's basename; the key keeps the text as typed.
    expect(normalize('Bash', { command: 'timeout 3000 venv/bin/python -m pytest tests/agent' }))
      .toEqual({ key: 'test:venv/bin/python -m pytest tests/agent', cls: 'test' })
    expect(normalize('Bash', { command: "sed -n '1,40p' a.ts" })).toEqual({ key: "read:sed -n '1,40p' a.ts", cls: 'read' })
    // An `other` command is its whole pipeline: a jq pipeline is its pipes.
    expect(normalize('Bash', { command: "jq -r '.x' f.json | tr -d '\\n'" })).toEqual({ key: "other:jq -r '.x' f.json | tr -d '\\n'", cls: 'other' })
    expect(normalize('Bash', { command: 'cd x && echo hi | wc -l' })).toEqual({ key: 'other:cd x && echo hi | wc -l', cls: 'other' })
    expect(normalize('Bash', { command: `bun test ${'x'.repeat(300)}` }).key.length).toBe(KEY_MAX)
  })

  test('normalize keys each tool family and caps the key', () => {
    expect(normalize('Bash', { command: 'cd x &&  bun   test' })).toEqual({ key: 'test:bun test', cls: 'test' })
    expect(normalize('Bash', {})).toEqual({ key: 'other:', cls: 'other' })
    expect(normalize('Read', { file_path: '/w/a.ts', offset: 2, limit: 40 })).toEqual({ key: '/w/a.ts:2-40', cls: 'read' })
    expect(normalize('Read', { file_path: '/w/a.ts' })).toEqual({ key: '/w/a.ts:-', cls: 'read' })
    expect(normalize('Edit', { file_path: '/w/a.ts' })).toEqual({ key: '/w/a.ts', cls: 'other' })
    expect(normalize('Write', { file_path: '/w/a.ts' })).toEqual({ key: '/w/a.ts', cls: 'other' })
    expect(normalize('NotebookEdit', { notebook_path: '/w/a.ipynb' })).toEqual({ key: '/w/a.ipynb', cls: 'other' })
    expect(normalize('Grep', { pattern: 'saver', path: 'hooks' })).toEqual({ key: 'Grep:saver:hooks', cls: 'search' })
    expect(normalize('Glob', { pattern: '**/*.ts' })).toEqual({ key: 'Glob:**/*.ts:', cls: 'search' })
    expect(normalize('Agent', { subagent_type: 'test-runner' })).toEqual({ key: 'agent:test-runner', cls: 'other' })
    expect(normalize('Agent', {})).toEqual({ key: 'agent:general', cls: 'other' })
    expect(normalize('Bash', { command: 'echo ' + 'x'.repeat(300) }).key.length).toBe(KEY_MAX)
    expect(normalize('Read', { file_path: `/w/${'d/'.repeat(200)}a.ts` }).key.length).toBe(KEY_MAX)
    expect(normalize('Edit', { file_path: `/w/${'d/'.repeat(200)}a.ts` }).key.length).toBe(KEY_MAX)
    expect(normalize('Grep', { pattern: 'x'.repeat(300) }).key.length).toBe(KEY_MAX)
    expect(normalize('Agent', { subagent_type: 'x'.repeat(300) }).key.length).toBe(KEY_MAX)
    expect(normalize('Frobnicate', { spec: 'x'.repeat(300) }).key.length).toBe(KEY_MAX)
  })

  test('normalize keys the flat tool.call envelope and the bare arguments alike', () => {
    const bash = { command: 'bun test --coverage' }
    expect(normalize('Bash', { tool: 'Bash', tool_use_id: 'u1', agentId: 'agent_1', ...bash })).toEqual(normalize('Bash', bash))

    const read = { file_path: '/w/a.ts', offset: 2, limit: 40 }
    expect(normalize('Read', { tool: 'Read', tool_use_id: 'u2', ...read })).toEqual(normalize('Read', read))

    const mcp = { query: { name: 'saver', filters: { open: true, limit: 5 } }, verbose: false }
    const envelope = { tool: 'mcp__server__tool', tool_use_id: 'u3', agentId: 'agent_1', consent: 'The user pressed "1: Yes"', ...mcp }
    expect(normalize('mcp__server__tool', envelope)).toEqual(normalize('mcp__server__tool', mcp))
    expect(normalize('mcp__server__tool', { verbose: false, query: { filters: { limit: 5, open: true }, name: 'saver' } }).key)
      .toBe(normalize('mcp__server__tool', mcp).key)

    const unknown = { spec: 'x', depth: 2 }
    expect(normalize('Frobnicate', { tool: 'Frobnicate', tool_use_id: 'u4', ...unknown })).toEqual(normalize('Frobnicate', unknown))
  })

  test('rowOf records an answered Bash call whole', () => {
    expect(rowOf(bashAnswered.e, bashAnswered.result, 8200, 3)).toEqual({
      id: 'call_1',
      tool: 'Bash',
      key: 'test:bun test',
      cls: 'test',
      agent: 'main',
      turn: 3,
      ms: 8200,
      chars: 25,
      head: '12 pass  0 fail all good',
      flags: [],
      lines: null,
      paths: [],
      spawn: null,
    })
  })

  test('rowOf flags an error and a deny', () => {
    const errored = rowOf(bashErrored.e, bashErrored.result, 9000, 4)
    expect(errored.flags).toEqual(['err'])
    expect(errored.key).toBe('test:npm test')
    expect(errored.chars).toBe(20)

    const denied = rowOf(bashDenied.e, bashDenied.result, 5, 4)
    expect(denied.flags).toEqual(['denied'])
    expect(denied.key).toBe('other:rm -rf /')
    expect(denied.chars).toBe(0)
    expect(denied.head).toBe('')

    const deniedEdit = rowOf({ tool: 'Edit', tool_use_id: 'call_98', file_path: '/w/a.ts' }, { deny: 'The user said no' }, 3, 4)
    expect(deniedEdit.lines).toBe(null)
    expect(deniedEdit.paths).toEqual([])
  })

  test('rowOf flags a deduped and a truncated Read and keeps the subagent id', () => {
    const dedup = rowOf(readUnchanged.e, readUnchanged.result, 40, 5)
    expect(dedup.flags).toEqual(['dedup'])
    expect(dedup.key).toBe('/w/hooks/core/types.ts:-')
    expect(dedup.cls).toBe('read')
    expect(dedup.agent).toBe('main')

    const truncated = rowOf(readTruncated.e, readTruncated.result, 120, 6)
    expect(truncated.flags).toEqual(['trunc'])
    expect(truncated.key).toBe('/w/build.log:1-500')
    expect(truncated.agent).toBe('agent_2')
    expect(truncated.head).toBe('line 1 line 2')
  })

  test('rowOf flags persisted, background and timed-out Bash output', () => {
    const persisted = rowOf(bashPersisted.e, bashPersisted.result, 3000, 7)
    expect(persisted.flags).toEqual(['persist=262144'])
    expect(persisted.cls).toBe('search')
    expect(persisted.chars).toBe(120)
    expect(persisted.head.length).toBe(80)

    expect(rowOf(bashBackground.e, bashBackground.result, 20, 7).flags).toEqual(['bg'])
    // A background flag describes a task that started: a refused or failed call started none.
    expect(rowOf(bashBackground.e, { deny: 'The user said no' }, 20, 7).flags).toEqual(['denied'])
    expect(rowOf(bashBackground.e, { isError: true, result: 'no', text: 'error' }, 20, 7).flags).toEqual(['err'])

    const timedOut = rowOf(bashTimedOut.e, bashTimedOut.result, 120000, 8)
    expect(timedOut.flags).toEqual(['bg', 'timeout'])
    expect(timedOut.key).toBe('test:bun test --coverage')
    expect(timedOut.paths).toEqual(['/w/coverage/lcov.info'])
  })

  test('rowOf flags an AskUserQuestion, and one that recommended an answer', () => {
    const questions = [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes (Recommended)', description: 'now' }, { label: 'No', description: 'wait' }] }]
    const answered = { result: { questions, answers: { 'Ship it?': 'Yes (Recommended)' } }, text: 'User answered: Yes' }
    expect(rowOf({ tool: 'AskUserQuestion', tool_use_id: 'call_20', questions }, answered, 41000, 14).flags).toEqual(['ask', 'recommended'])

    const plain = [{ question: 'Which?', header: 'Pick', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }]
    expect(rowOf({ tool: 'AskUserQuestion', tool_use_id: 'call_21', questions: plain }, { result: {}, text: 'B' }, 5000, 14).flags).toEqual(['ask'])
    expect(rowOf({ tool: 'AskUserQuestion', tool_use_id: 'call_22' }, { result: {}, text: '' }, 10, 14).flags).toEqual(['ask'])
    // A denied or errored ask is still an ask: the wait for the person is what the row records.
    expect(rowOf({ tool: 'AskUserQuestion', tool_use_id: 'call_23', questions }, { deny: 'no' }, 10, 14).flags).toEqual(['denied', 'ask', 'recommended'])
    // Only an ask is flagged: the text is not read for the marker on other tools.
    expect(rowOf({ tool: 'Bash', tool_use_id: 'call_24', command: 'echo (Recommended)' }, { result: {}, text: '(Recommended)' }, 1, 14).flags).toEqual([])
  })

  test('rowOf counts Edit lines from gitDiff, else from the patch, and drops a staged path', () => {
    const applied = rowOf(editGitDiff.e, editGitDiff.result, 60, 9)
    expect(applied.lines).toEqual({ add: 7, del: 2 })
    expect(applied.paths).toEqual(['/w/hooks/register.ts'])
    expect(applied.key).toBe('/w/hooks/register.ts')

    const staged = rowOf(editStaged.e, editStaged.result, 60, 9)
    expect(staged.lines).toEqual({ add: 3, del: 1 })
    expect(staged.paths).toEqual([])
  })

  test('rowOf counts Write content lines and records the path', () => {
    const written = rowOf(writeCreated.e, writeCreated.result, 30, 10)
    expect(written.lines).toEqual({ add: 3, del: 0 })
    expect(written.paths).toEqual(['/w/hooks/core/ledger.ts'])
    expect(written.cls).toBe('other')

    const failed = rowOf(writeErrored.e, writeErrored.result, 12, 10)
    expect(failed.flags).toEqual(['err'])
    expect(failed.lines).toBe(null)
    expect(failed.paths).toEqual([])
  })

  test('rowOf takes a NotebookEdit path from the event and keeps a head whole', () => {
    const notebook = rowOf(notebookEdited.e, notebookEdited.result, 25, 10)
    expect(notebook.key).toBe('/w/notebooks/analysis.ipynb')
    expect(notebook.paths).toEqual(['/w/notebooks/analysis.ipynb'])
    expect(notebook.lines).toBe(null)

    // The head is cut by code point: the 40th astral character would not fit whole, so it is left out.
    const astral = rowOf({ tool: 'Bash', tool_use_id: 'call_14', command: 'echo' }, { result: {}, text: '🙂'.repeat(50) }, 1, 1)
    expect(astral.head).toBe('🙂'.repeat(40))
    expect([...astral.head]).toHaveLength(40)

    const controls = rowOf({ tool: 'Bash', tool_use_id: 'call_15', command: 'echo' }, { result: {}, text: 'a\u0007b\tc\nd' }, 1, 1)
    expect(controls.head).toBe('ab c d')
  })

  test('rowOf records spawn fields for a completed and an async agent', () => {
    expect(rowOf(agentCompleted.e, agentCompleted.result, 41000, 11).spawn).toEqual({
      type: 'test-runner',
      requested: 'sonnet',
      resolved: 'claude-sonnet-4-5',
      status: 'completed',
      tokens: 51234,
      edits: 2,
      promptChars: 13,
    })

    const launched = rowOf(agentAsync.e, agentAsync.result, 120, 12)
    expect(launched.spawn).toEqual({
      type: 'general',
      requested: null,
      resolved: null,
      status: 'async_launched',
      tokens: null,
      edits: null,
      promptChars: 15,
    })
    expect(launched.key).toBe('agent:general')
  })

  test('rowOf survives a result of the wrong shape', () => {
    expect(rowOf({ tool: 'Frobnicate', tool_use_id: 'call_99' }, { result: 'not a record' }, 10, 13)).toEqual({
      id: 'call_99',
      tool: 'Frobnicate',
      key: 'Frobnicate:{}',
      cls: 'other',
      agent: 'main',
      turn: 13,
      ms: 10,
      chars: 0,
      head: '',
      flags: [],
      lines: null,
      paths: [],
      spawn: null,
    })
  })
})
