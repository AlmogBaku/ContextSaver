import type { ToolCallResult } from 'claude-code'

import { collapseWs, stableJson } from './text'
import { KEY_MAX } from './types'
import type { CommandClass, Row } from './types'

/** The flat tool event a row is built from: the tool, this call's id, the loop, and the tool's arguments beside them. */
export type ToolEvent = { tool: string; tool_use_id: string; agentId?: string } & Record<string, unknown>

const RESERVED = ['tool', 'tool_use_id', 'agentId', 'consent'] as const

// A leading `cd <dir> &&` or `VAR=value` is noise in front of the command that matters.
const NOISE = /^(?:cd\s+[^\s&|;]+\s*&&\s*|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)/

// Script runners: what follows them is the command that matters (longest first).
const RUNNERS = ['npm run', 'bun run', 'bun x', 'pnpm run', 'yarn run', 'npx', 'bunx', 'pnpm', 'yarn'] as const

// Script names seen after a runner (`bun run lint`), which no binary in the table covers.
const SCRIPTS: Readonly<Record<string, CommandClass>> = { test: 'test', lint: 'lint', format: 'format', typecheck: 'typecheck', build: 'build' }

// Command heads, matched on a token boundary; two-token heads never shadow one another.
const COMMANDS: readonly (readonly [string, CommandClass])[] = [
  ['npm test', 'test'], ['bun test', 'test'], ['go test', 'test'], ['cargo test', 'test'],
  ['jest', 'test'], ['vitest', 'test'], ['pytest', 'test'], ['mocha', 'test'],
  ['biome lint', 'lint'], ['eslint', 'lint'], ['ruff', 'lint'], ['flake8', 'lint'], ['golangci-lint', 'lint'],
  ['biome format', 'format'], ['prettier', 'format'], ['black', 'format'], ['gofmt', 'format'], ['rustfmt', 'format'],
  ['tsc', 'typecheck'], ['mypy', 'typecheck'], ['pyright', 'typecheck'],
  ['make build', 'build'], ['cargo build', 'build'], ['go build', 'build'], ['docker build', 'build'], ['vite', 'build'], ['webpack', 'build'],
  ['npm install', 'install'], ['npm i', 'install'], ['bun install', 'install'], ['bun add', 'install'],
  ['pnpm install', 'install'], ['pnpm add', 'install'], ['yarn install', 'install'], ['yarn add', 'install'],
  ['pip install', 'install'], ['uv pip', 'install'], ['cargo fetch', 'install'], ['apt-get install', 'install'], ['brew install', 'install'],
  ['git', 'git'], ['gh', 'git'],
  ['cat', 'read'], ['head', 'read'], ['tail', 'read'], ['less', 'read'], ['ls', 'read'], ['tree', 'read'], ['sed', 'read'],
  ['grep', 'search'], ['rg', 'search'], ['ag', 'search'], ['find', 'search'], ['fd', 'search'], ['ast-grep', 'search'],
]

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const stripNoise = (command: string): string => {
  let rest = command
  while (NOISE.test(rest)) rest = rest.replace(NOISE, '')
  return rest
}

const headToken = (command: string): string => command.split(' ')[0] ?? ''

const tableClass = (command: string): CommandClass | null =>
  COMMANDS.find(([head]) => command === head || command.startsWith(`${head} `))?.[1] ?? null

/** Classifies a shell command by what it does, seeing through cd, env and script-runner prefixes. */
export const classOf = (command: string): CommandClass => {
  const bare = stripNoise(collapseWs(command))
  const direct = tableClass(bare)
  if (direct !== null) return direct
  const runner = RUNNERS.find(r => bare === r || bare.startsWith(`${r} `))
  if (runner === undefined) return 'other'
  const script = bare.slice(runner.length).trim()
  return tableClass(script) ?? SCRIPTS[headToken(script)] ?? 'other'
}

/** Computes the ledger key and command class of a call from its arguments alone. */
export const normalize = (tool: string, input: unknown): { key: string; cls: CommandClass } => {
  const args = asRecord(input)
  if (tool === 'Bash') {
    const command = collapseWs(asString(args.command) ?? '')
    const cls = classOf(command)
    return { key: `${cls}:${command.slice(0, KEY_MAX)}`, cls }
  }
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const path = asString(args.file_path) ?? asString(args.notebook_path) ?? ''
    const range = tool === 'Read' ? `:${asNumber(args.offset) ?? ''}-${asNumber(args.limit) ?? ''}` : ''
    return { key: `${path}${range}`, cls: tool === 'Read' ? 'read' : 'other' }
  }
  if (tool === 'Grep' || tool === 'Glob') {
    return { key: `${tool}:${asString(args.pattern) ?? ''}:${asString(args.path) ?? ''}`, cls: 'search' }
  }
  if (tool === 'Agent') return { key: `agent:${asString(args.subagent_type) ?? 'general'}`, cls: 'other' }
  return { key: `${tool}:${stableJson(input, RESERVED).slice(0, KEY_MAX)}`, cls: 'other' }
}

const printable = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0
  return code >= 0x20 && code !== 0x7f
}

const headOf = (text: string | undefined): string =>
  [...(text ?? '')].map(ch => (ch === '\t' || ch === '\n' ? ' ' : ch)).filter(printable).join('').slice(0, 80)

const flagsOf = (e: ToolEvent, result: ToolCallResult, res: Record<string, unknown>): string[] => {
  const persisted = e.tool === 'Bash' ? asNumber(res.persistedOutputSize) : null
  return [
    result.isError === true ? 'err' : '',
    result.deny !== undefined ? 'denied' : '',
    e.tool === 'Read' && res.type === 'file_unchanged' ? 'dedup' : '',
    e.tool === 'Read' && asRecord(res.file).truncatedByTokenCap === true ? 'trunc' : '',
    e.tool === 'Bash' && (e.run_in_background === true || asString(res.backgroundTaskId) !== null) ? 'bg' : '',
    e.tool === 'Bash' && asNumber(res.timedOutAfterMs) !== null ? 'timeout' : '',
    persisted !== null ? `persist=${persisted}` : '',
  ].filter(flag => flag !== '')
}

const answered = (result: ToolCallResult): boolean => result.deny === undefined && result.isError !== true

const patchLines = (patch: unknown): { add: number; del: number } => {
  const hunks = Array.isArray(patch) ? patch : []
  const lines = hunks.flatMap(hunk => {
    const own = asRecord(hunk).lines
    return Array.isArray(own) ? own.filter((line): line is string => typeof line === 'string') : []
  })
  return { add: lines.filter(line => line.startsWith('+')).length, del: lines.filter(line => line.startsWith('-')).length }
}

const lineCount = (content: string): number => (content === '' ? 0 : content.replace(/\n$/, '').split('\n').length)

const linesOf = (e: ToolEvent, res: Record<string, unknown>): { add: number; del: number } | null => {
  if (e.tool === 'Edit') {
    const diff = asRecord(res.gitDiff)
    const add = asNumber(diff.additions)
    const del = asNumber(diff.deletions)
    return add !== null && del !== null ? { add, del } : patchLines(res.structuredPatch)
  }
  if (e.tool === 'Write') return { add: lineCount(asString(res.content) ?? asString(e.content) ?? ''), del: 0 }
  return null
}

const pathsOf = (e: ToolEvent, res: Record<string, unknown>): string[] => {
  if (e.tool === 'Edit' || e.tool === 'Write') {
    const path = asString(res.filePath) ?? asString(e.file_path)
    return path !== null && res.staged !== true ? [path] : []
  }
  if (e.tool === 'Bash') {
    const changed = asRecord(res.bashEditDiff).changedFiles
    return Array.isArray(changed) ? changed.filter((file): file is string => typeof file === 'string') : []
  }
  return []
}

const spawnOf = (e: ToolEvent, res: Record<string, unknown>): Row['spawn'] =>
  e.tool !== 'Agent'
    ? null
    : {
        type: asString(e.subagent_type) ?? 'general',
        requested: asString(e.model),
        resolved: asString(res.resolvedModel),
        status: asString(res.status),
        tokens: asNumber(res.totalTokens),
        edits: asNumber(asRecord(res.toolStats).editFileCount),
        promptChars: (asString(e.prompt) ?? '').length,
      }

/** Builds the ledger row of a finished tool call, reading every result field defensively. */
export const rowOf = (e: ToolEvent, result: ToolCallResult, ms: number, turn: number): Omit<Row, 'seq'> => {
  const res = asRecord(result.result)
  const { key, cls } = normalize(e.tool, e)
  return {
    id: e.tool_use_id,
    tool: e.tool,
    key,
    cls,
    agent: asString(e.agentId) ?? 'main',
    turn,
    ms,
    chars: result.text?.length ?? 0,
    head: headOf(result.text),
    flags: flagsOf(e, result, res),
    lines: answered(result) ? linesOf(e, res) : null,
    paths: answered(result) ? pathsOf(e, res) : [],
    spawn: spawnOf(e, res),
  }
}
