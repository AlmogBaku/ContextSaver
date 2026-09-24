// Dev replay (`bun run scripts/replay.ts <session-id | main.jsonl>… [--at <ISO>]… [--window <n>] [--lang <tag>] [--summary | --prompt | --judge]`):
// feeds a recorded session through `reduce` and prints what the judge would have seen, and with `--judge` what it says.
// `--lang` settles the bundle before anything is built, so `--prompt` shows the language paragraph the fork
// would really be handed and `--judge` reads its answer back through that language's own `kindPrefix`:
// replaying one recorded session under `en` and under `fr` is how a translation's findings are checked.
// Not plugin code: outside tsconfig, never imported by hooks. Streams every file line by line (a main transcript reaches 16 MB).
//
// Spec §11.5. Facts of the transcript shape this reads, found in the acceptance corpus:
// - an API error is an assistant line with `isApiErrorMessage: true` (its text starts `API Error:`); `api_error` never appears;
// - a message with several content blocks is written as several lines sharing `message.id`, each carrying the same
//   `message.usage`, so tokens are summed once per id;
// - the `[Request interrupted…]` user line lands a few ms BEFORE the turn's `turn_duration` line (also read after it);
// - a forked session (`fc2f4359…` continues `3ee71a8b…`) copies the parent's lines with the same `uuid`, so main lines
//   are deduplicated by uuid across every input and all inputs are fed as one stream, oldest first;
// - a `<task-notification>` or an interrupt starts a turn of Claude's own, so its `turn_duration` lands with no prompt
//   before it: TURNS then shows two lines with one turn number, as the plugin itself would (no prompt.submit fired).
// Output: `--prompt` writes the prompt itself to stdout (for piping); the other modes a JSON array, one object per
// checkpoint; the readable blocks and the judge's answer go to stderr.
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import { agentsBlock, sinksBlock, statsLines, turnsBlock } from '../hooks/core/blocks.ts'
import { agentAliases } from '../hooks/core/evidence.ts'
import { buildPrompt, merge, parseReply } from '../hooks/core/judge.ts'
import { rowOf } from '../hooks/core/ledger.ts'
import { reduce } from '../hooks/core/patterns.ts'
import { agentOf, parseJournal, runOf } from '../hooks/core/spawns.ts'
import { initialState } from '../hooks/core/types.ts'
import type { Action, Finding, JournalEntry, State, Tokens, TurnEnd } from '../hooks/core/types.ts'
// `setSay` only: this file's own `say` writes to stderr and is a different thing entirely.
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, setSay } from '../hooks/say/index.ts'

const PROJECTS = join(homedir(), '.claude', 'projects')
const DEFAULT_WINDOW = 1_000_000
const ANSWER_HEAD = 100
const NOT_PROMPTS = ['<task-notification>', '<local-command', '<command-name>', '[Request interrupted'] as const

type Rec = Record<string, unknown>

// What the files yield, sorted by time before any of it reaches the reducer.
type Ev =
  | { t: number; kind: 'turn.start' }
  | { t: number; kind: 'row'; useAt: number; tool: string; id: string; input: Rec; text: string; isError: boolean; result: unknown; agentId: string | null }
  | { t: number; kind: 'turn.end'; ms: number; tokens: Tokens; answer: string; error: boolean; aborted: boolean }
  | { t: number; kind: 'loop.start'; agentId: string; description: string; model: string | null }
  | { t: number; kind: 'loop.end'; agentId: string; model: string | null; ms: number; tokens: Tokens; ended: TurnEnd }

type Journal = { runId: string; entries: JournalEntry[]; agents: Set<string> }

type Mode = 'summary' | 'prompt' | 'judge'

const ORDER: Record<Ev['kind'], number> = { 'turn.start': 0, 'loop.start': 1, row: 2, 'loop.end': 3, 'turn.end': 4 }

const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

const rec = (v: unknown): Rec => (isRecord(v) ? v : {})

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const timeOf = (v: Rec): number => {
  const t = Date.parse(str(v['timestamp']) ?? '')
  return Number.isFinite(t) ? t : NaN
}

const add = (a: Tokens, b: Tokens): Tokens =>
  ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreate: a.cacheCreate + b.cacheCreate })

const tokensOf = (usage: unknown): Tokens => {
  const u = rec(usage)
  return { input: num(u['input_tokens']), output: num(u['output_tokens']), cacheRead: num(u['cache_read_input_tokens']), cacheCreate: num(u['cache_creation_input_tokens']) }
}

// A content field is a string or blocks; the text is the string, or the text blocks joined.
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map(rec).filter(b => b['type'] === 'text').map(b => str(b['text']) ?? '').join('\n') : ''

const blocksOf = (message: unknown): Rec[] => {
  const content = rec(message)['content']
  return Array.isArray(content) ? content.map(rec) : []
}

// A prompt is what the person typed: string content or text blocks alone, not meta, not a command or a notification.
const isPrompt = (v: Rec): boolean => {
  if (v['isMeta'] === true) return false
  const content = rec(v['message'])['content']
  const plain = typeof content === 'string' || (Array.isArray(content) && content.length > 0 && content.every(b => rec(b)['type'] === 'text'))
  if (!plain) return false
  const head = textOf(content).trimStart()
  return head !== '' && !NOT_PROMPTS.some(prefix => head.startsWith(prefix))
}

const isInterrupt = (v: Rec): boolean => textOf(rec(v['message'])['content']).trimStart().startsWith('[Request interrupted')

const eachLine = async (path: string, fn: (v: Rec) => void): Promise<void> => {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (isRecord(value)) fn(value)
  }
}

// Pairs `tool_use` blocks with the `tool_result` that answers them; one pairing per file, since ids never cross files.
class Pairing {
  private readonly uses = new Map<string, { t: number; tool: string; input: Rec }>()

  constructor(private readonly agentId: string | null, private readonly out: Ev[]) {}

  use(t: number, block: Rec): void {
    const id = str(block['id'])
    if (id !== null) this.uses.set(id, { t, tool: str(block['name']) ?? '', input: rec(block['input']) })
  }

  result(t: number, block: Rec, line: Rec): void {
    const id = str(block['tool_use_id'])
    const use = id === null ? undefined : this.uses.get(id)
    if (id === null || use === undefined) return
    this.uses.delete(id)
    this.out.push({
      t, kind: 'row', useAt: use.t, tool: use.tool, id, input: use.input,
      text: textOf(block['content']), isError: block['is_error'] === true, result: line['toolUseResult'], agentId: this.agentId,
    })
  }
}

// One main transcript: prompts, rows, and a turn.end per `turn_duration` with the turn's tokens, answer and how it ended.
const scanMain = async (path: string, seen: Set<string>, out: Ev[]): Promise<{ cwd: string | null }> => {
  const pairing = new Pairing(null, out)
  const usageIds = new Set<string>()
  let cwd: string | null = null
  let tokens = NO_TOKENS
  let answer = ''
  let error = false
  let interrupted = false
  let lastEnd: Extract<Ev, { kind: 'turn.end' }> | null = null
  await eachLine(path, v => {
    const uuid = str(v['uuid'])
    if (uuid !== null) {
      if (seen.has(uuid)) return
      seen.add(uuid)
    }
    cwd ??= str(v['cwd'])
    const t = timeOf(v)
    if (Number.isNaN(t)) return
    const type = v['type']
    if (type === 'user') {
      const results = blocksOf(v['message']).filter(b => b['type'] === 'tool_result')
      if (results.length > 0) {
        for (const block of results) pairing.result(t, block, v)
      } else if (isInterrupt(v)) {
        interrupted = true
        if (lastEnd !== null) lastEnd.aborted = true
      } else if (isPrompt(v)) {
        out.push({ t, kind: 'turn.start' })
        tokens = NO_TOKENS
        answer = ''
        error = false
        interrupted = false
        lastEnd = null
      }
      return
    }
    if (type === 'assistant') {
      const message = rec(v['message'])
      const id = str(message['id'])
      if (id === null || !usageIds.has(id)) {
        if (id !== null) usageIds.add(id)
        tokens = add(tokens, tokensOf(message['usage']))
      }
      error = v['isApiErrorMessage'] === true
      for (const block of blocksOf(message)) {
        if (block['type'] === 'tool_use') pairing.use(t, block)
        if (block['type'] === 'text' && (str(block['text']) ?? '') !== '') answer = str(block['text']) ?? ''
      }
      return
    }
    if (type === 'system' && v['subtype'] === 'turn_duration') {
      lastEnd = { t, kind: 'turn.end', ms: num(v['durationMs']), tokens, answer, error, aborted: interrupted }
      out.push(lastEnd)
      tokens = NO_TOKENS
      interrupted = false
    }
  })
  return { cwd }
}

type Meta = { model: string | null; description: string; phase: string | null }

const metaOf = (path: string): Meta => {
  const metaPath = path.replace(/\.jsonl$/, '.meta.json')
  const v = existsSync(metaPath) ? rec(JSON.parse(readFileSync(metaPath, 'utf8'))) : {}
  return { model: str(v['model']), description: str(v['description']) ?? '', phase: str(v['workflowPhase']) }
}

// One agent file: a loop.start at its first line carrying what its `.meta.json` says of it, its rows, then a
// loop.end at its last line with the tokens summed and `error` when its last message was one. Without the
// start the judge reads `-` for the label and the model of every loop the workflow journals never named.
const scanAgent = async (path: string, out: Ev[]): Promise<void> => {
  const agentId = basename(path, '.jsonl').replace(/^agent-/, '')
  const meta = metaOf(path)
  const pairing = new Pairing(agentId, out)
  const usageIds = new Set<string>()
  let tokens = NO_TOKENS
  let first = NaN
  let last = NaN
  let error = false
  await eachLine(path, v => {
    const t = timeOf(v)
    if (Number.isNaN(t)) return
    if (Number.isNaN(first)) first = t
    last = t
    const type = v['type']
    if (type === 'user') {
      for (const block of blocksOf(v['message']).filter(b => b['type'] === 'tool_result')) pairing.result(t, block, v)
      return
    }
    if (type === 'assistant') {
      const message = rec(v['message'])
      const id = str(message['id'])
      if (id === null || !usageIds.has(id)) {
        if (id !== null) usageIds.add(id)
        tokens = add(tokens, tokensOf(message['usage']))
      }
      error = v['isApiErrorMessage'] === true
      for (const block of blocksOf(message)) if (block['type'] === 'tool_use') pairing.use(t, block)
    }
  })
  if (Number.isNaN(last)) return
  out.push({ t: first, kind: 'loop.start', agentId, description: meta.description, model: meta.model })
  out.push({ t: last, kind: 'loop.end', agentId, model: meta.model, ms: last - first, tokens, ended: error ? 'error' : 'answer' })
}

const journalOf = (path: string): Journal => {
  const entries = parseJournal(readFileSync(path, 'utf8'))
  return { runId: basename(dirname(path)), entries, agents: new Set(entries.map(e => e.agentId)) }
}

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()

// A session id or a main transcript's path: the mains and session dirs found under every project dir, so a session
// whose files are split across two of them (the corpus's `3ee71a8b…`) is read whole.
const locate = (arg: string): { id: string; mains: string[]; dirs: string[] } => {
  const isPath = arg.endsWith('.jsonl')
  const id = isPath ? basename(arg, '.jsonl') : arg
  const projectDirs = existsSync(PROJECTS) ? readdirSync(PROJECTS).map(d => join(PROJECTS, d)) : []
  const mains = [...(isPath ? [arg] : []), ...projectDirs.map(d => join(d, `${id}.jsonl`))].filter((p, i, all) => existsSync(p) && all.indexOf(p) === i)
  const dirs = [...(isPath ? [join(dirname(arg), id)] : []), ...projectDirs.map(d => join(d, id))].filter((p, i, all) => isDir(p) && all.indexOf(p) === i)
  return { id, mains, dirs }
}

type Feed = { events: Ev[]; journals: Journal[]; cwd: string; files: number }

const collect = async (args: string[]): Promise<Feed> => {
  const events: Ev[] = []
  const journals: Journal[] = []
  const seen = new Set<string>()
  const scanned = new Set<string>()
  let cwd: string | null = null
  for (const arg of args) {
    const { id, mains, dirs } = locate(arg)
    if (mains.length === 0 && dirs.length === 0) throw new Error(`nothing found for ${id}`)
    for (const main of mains) {
      if (scanned.has(main)) continue
      scanned.add(main)
      const found = await scanMain(main, seen, events)
      cwd ??= found.cwd
    }
    for (const path of dirs.flatMap(walk)) {
      if (scanned.has(path)) continue
      scanned.add(path)
      if (/\/agent-[^/]+\.jsonl$/.test(path)) await scanAgent(path, events)
      else if (basename(path) === 'journal.jsonl') journals.push(journalOf(path))
    }
  }
  events.sort((a, b) => a.t - b.t || ORDER[a.kind] - ORDER[b.kind])
  return { events, journals, cwd: cwd ?? '', files: scanned.size }
}

// The journal a loop belongs to, and what of it the state can already know: stages of loops seen, outcomes of loops ended.
const journalActions = (state: State, journals: Journal[], agentId: string, now: number): Action[] =>
  journals.filter(j => j.agents.has(agentId)).map(j => ({
    type: 'run.journal',
    runId: j.runId,
    now,
    entries: j.entries.filter(e => {
      const loop = state.loops.find(l => l.id === e.agentId)
      return loop !== undefined && (e.kind === 'started' || loop.ended !== null)
    }),
  }))

// The loops whose first row has landed, so the journal is read once at that moment and not at every row.
const started = new Set<string>()

const actionsOf = (state: State, ev: Ev, journals: Journal[]): Action[] => {
  switch (ev.kind) {
    case 'turn.start':
      return [{ type: 'turn.start', now: ev.t }]
    case 'row': {
      const event = { ...ev.input, tool: ev.tool, tool_use_id: ev.id, ...(ev.agentId === null ? {} : { agentId: ev.agentId }) }
      const row = rowOf(event, { result: ev.result, text: ev.text, ...(ev.isError ? { isError: true } : {}) }, Math.max(0, ev.t - ev.useAt), state.turn)
      const run = runOf(ev.result)
      const agent = agentOf(ev.result)
      const fresh = ev.agentId !== null && !started.has(ev.agentId)
      if (ev.agentId !== null) started.add(ev.agentId)
      return [
        { type: 'row', row },
        ...(run === null ? [] : [{ type: 'run.start', run, now: ev.t } as const]),
        ...(agent === null ? [] : [{ type: 'agent.start', ...agent } as const]),
        // The journal is read as the shell would: when a loop's first row lands, with the loop now in the state.
        ...(fresh && ev.agentId !== null ? journalActions(reduce(state, { type: 'row', row }), journals, ev.agentId, ev.t) : []),
      ]
    }
    case 'turn.end': {
      const ended: TurnEnd = ev.error ? 'error' : ev.aborted ? 'aborted' : 'answer'
      return [{
        type: 'turn.complete',
        stat: { ...ev.tokens, ms: ev.ms, answerChars: ev.answer.length, answerHead: ev.answer.slice(0, ANSWER_HEAD), aborted: ended === 'aborted', ended, at: ev.t, idleMs: 0, context: null },
      }]
    }
    case 'loop.start':
      return [{ type: 'agent.start', agentId: ev.agentId, description: ev.description, model: ev.model }]
    case 'loop.end': {
      const turn: Action = { type: 'loop.turn', agentId: ev.agentId, model: ev.model, ms: ev.ms, tokens: ev.tokens, ended: ev.ended, turn: state.turn }
      // …and again after the loop's last line, when its outcome is knowable.
      return [turn, ...journalActions(reduce(state, turn), journals, ev.agentId, ev.t)]
    }
  }
}

const feed = (state: State, events: Ev[], journals: Journal[]): State =>
  events.reduce((s, ev) => actionsOf(s, ev, journals).reduce(reduce, s), state)

// The same blocks `buildPrompt` fills, folds and all: a summary that left the folds out would read a capped
// ledger as a session that only ever made two thousand calls.
const blocksOfState = (state: State): Record<string, string> => ({
  STATS: statsLines(state.rows, state.folded, agentAliases(state.rows, state.loops)).join('\n'),
  TIME: sinksBlock(state.rows, 'ms', state.loops, state.folded),
  AGENTS: agentsBlock(state),
  TURNS: turnsBlock(state),
})

const digest = (state: State): Record<string, number> =>
  ({ turn: state.turn, rows: state.rows.length, loops: state.loops.length, runs: state.runs.length, patterns: state.patterns.length })

const say = (text: string): void => { process.stderr.write(`${text}\n`) }

// The judge, as the plugin runs it but through `claude -p`: the reply's `result` is the text `parseReply` reads.
const judge = (state: State, model: string): { state: State; findings: Finding[]; dropped: string[]; focus: string | null; time: string | null; context: string | null; returned: number; error: string | null } => {
  const prompt = buildPrompt(state)
  const run = spawnSync('claude', ['-p', '--model', model, '--output-format', 'json'], { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const stdout = run.stdout ?? ''
  let text = stdout
  try {
    text = str(rec(JSON.parse(stdout))['result']) ?? stdout
  } catch {
    // not JSON: parseReply reads what it can
  }
  const error = run.status === 0 ? null : `claude -p exited ${run.status ?? 'null'}: ${(run.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}`
  const reply = parseReply(text, state)
  const merged = merge(state, reply.findings)
  const done = reduce(state, {
    type: 'judge.done', patterns: merged.patterns, fresh: merged.fresh, recurred: merged.recurred, focus: reply.focus, time: reply.time, context: reply.context,
    spent: 0, error, returned: reply.returned, kept: reply.findings.length, dropped: [...reply.dropped, ...merged.evicted.map(id => `${id}: evicted by the pattern cap`)], usage: null,
  })
  return { state: done, findings: reply.findings, dropped: reply.dropped, focus: reply.focus, time: reply.time, context: reply.context, returned: reply.returned, error }
}

const findingLine = (f: Finding): string =>
  `- ${f.id} (${f.confidence}) — ${f.kind}\n    evidence: ${f.evidence.join(', ')}\n    fix: ${f.alternative}`

const report = (state: State, at: number, mode: Mode, model: string): { state: State; out: Rec } => {
  const iso = new Date(at).toISOString()
  say(`\n===== checkpoint ${iso} · turn ${state.turn} · rows ${state.rows.length} · loops ${state.loops.length} · runs ${state.runs.length}`)
  if (mode === 'prompt') {
    process.stdout.write(`${buildPrompt(state)}\n`)
    return { state, out: { at: iso, ...digest(state) } }
  }
  const blocks = blocksOfState(state)
  if (mode === 'summary') {
    for (const [name, text] of Object.entries(blocks)) say(`\n## ${name}\n${text}`)
    return { state, out: { at: iso, ...digest(state), blocks } }
  }
  say(`judging with ${model}…`)
  const result = judge(state, model)
  if (result.error !== null) say(`error: ${result.error}`)
  say(`returned ${result.returned}, kept ${result.findings.length}`)
  if (result.focus !== null) say(`focus: ${result.focus}`)
  if (result.time !== null) say(`time: ${result.time}`)
  if (result.context !== null) say(`context: ${result.context}`)
  for (const f of result.findings) say(findingLine(f))
  for (const d of result.dropped) say(`  dropped: ${d}`)
  const kept = result.findings.map(f => ({ id: f.id, kind: f.kind, evidence: f.evidence, confidence: f.confidence, alternative: f.alternative }))
  return { state: result.state, out: { at: iso, ...digest(state), judge: { model, error: result.error, returned: result.returned, focus: result.focus, time: result.time, context: result.context, kept, dropped: result.dropped } } }
}

const parseArgs = (argv: string[]): { inputs: string[]; ats: number[]; window: number; mode: Mode; lang: string } => {
  const inputs: string[] = []
  const ats: number[] = []
  let window = DEFAULT_WINDOW
  let mode: Mode = 'summary'
  let lang = DEFAULT_LANGUAGE
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === '--at') {
      const t = Date.parse(argv[++i] ?? '')
      if (Number.isNaN(t)) throw new Error(`--at wants an ISO time, got ${argv[i]}`)
      ats.push(t)
    } else if (arg === '--window') window = Number(argv[++i]) || DEFAULT_WINDOW
    else if (arg === '--lang') {
      lang = argv[++i] ?? ''
      // The plugin is silent about a tag it does not know, on purpose; a dev tool told to replay in a
      // language that does not exist has misunderstood its operator and says so.
      if (!LANGUAGE_TAGS.includes(lang)) throw new Error(`--lang wants one of ${LANGUAGE_TAGS.join(', ')}, got ${lang}`)
    } else if (arg === '--summary' || arg === '--prompt' || arg === '--judge') mode = arg.slice(2) as Mode
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else inputs.push(arg)
  }
  if (inputs.length === 0) throw new Error('usage: bun run scripts/replay.ts <session-id | main.jsonl>… [--at <ISO>]… [--window <n>] [--lang <tag>] [--summary | --prompt | --judge]')
  return { inputs, ats: ats.sort((a, b) => a - b), window, mode, lang }
}

const main = async (): Promise<void> => {
  const { inputs, ats, window, mode, lang } = parseArgs(process.argv.slice(2))
  // Before anything is built: the prompt, the cards and the parser all read the bundle this settles.
  setSay(lang)
  const model = process.env['REPLAY_MODEL'] ?? 'sonnet'
  const t0 = performance.now()
  const { events, journals, cwd, files } = await collect(inputs)
  say(`read ${files} files: ${events.length} events, ${journals.length} journals in ${Math.round(performance.now() - t0)}ms`)
  if (events.length === 0) throw new Error('no events')
  const last = events[events.length - 1]?.t ?? 0
  const checkpoints = ats.length > 0 ? ats : [last]
  let state = reduce(initialState(cwd, window), { type: 'usage', usage: { window }, now: events[0]?.t ?? 0 })
  const outs: Rec[] = []
  let from = 0
  for (const at of checkpoints) {
    let to = from
    while (to < events.length && (events[to]?.t ?? Infinity) <= at) to += 1
    state = feed(state, events.slice(from, to), journals)
    from = to
    const done = report(state, at, mode, model)
    state = done.state
    outs.push(done.out)
  }
  say(`\nfed ${from} of ${events.length} events in ${Math.round(performance.now() - t0)}ms`)
  if (mode !== 'prompt') process.stdout.write(`${JSON.stringify(outs, null, 2)}\n`)
}

main().catch((e: unknown) => {
  say(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
