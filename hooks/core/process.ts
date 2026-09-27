import { agentAliases } from './evidence'
import { merge } from './judge'
import { isCheck, isEdit } from './spawns'
import { cell, isRecord, loopOf, loopTokens, parseObject, proposalOf, slug, str, unique } from './text'
import {
  ALTERNATIVE_MAX, DIGEST_MAX_CHARS, KIND_MAX, MAIN_AGENT, MAX_PROCESS_FINDINGS, PROCESS_CLOCK_MS, PROCESS_MIN_CONFIDENCE,
} from './types'
import type { Finding, Loop, Outcome, Pattern, ProcessTrigger, Row, Run, State, TurnStat } from './types'

/** A process finding with the cost it claims, clamped to what its cited handles measured. */
export type ProcessFinding = Finding & { cost: { tokens: number; ms: number } }

/** The process judge prompt (build spec Appendix E, verbatim) with its one placeholder. */
export const PROCESS_PROMPT = `This message is not a step of the task. The work is paused while you answer one review question: you cannot call tools, and do not continue, retry or resume anything the transcript was doing. Your whole reply is the JSON object described below.

You are reviewing HOW this session is being run, not what it produced. The transcript above is your own: read it for what the user asked for and what was decided. The digest below is the measured shape of the work so far; nothing outside it is evidence for this review.

Answer one question: given what the user asked, how would a lean expert run this work? Then say where this session's process diverges from that, what each divergence has cost so far, and what the one change to the remaining work is. Look at the shape, not at single calls: review and fix rounds stacked on a review that already covers them; the heaviest model on mechanical stages; an agent spawned for a job one command would do; the full check suite after every merge where once per batch would do; the same plan or file re-read over and over; the pace the user complained about.

Prefer silence to a guess. A wrong "lean" suggestion is worse than none: report a divergence only when the digest measures its cost and the lean alternative plainly reaches the same result for less. Anything the user asked for is not a divergence, and a long session is not a wasteful one. At most three findings; fewer and bigger is better, and \`"findings": []\` is a correct and common answer. INTERVENTIONS lists every process finding already raised. The same divergence under another id is the same finding: return its id. One the person ignored is never reported again.

## Evidence
\`evidence\`: handles the digest prints, copied exactly — \`run:<id>\` (a SHAPE run row), \`agent:<alias>\` (a loop SHAPE lists, as \`agent:a3\`), \`turn:<n>\` (a turn ASKS or CADENCE names). A finding citing any other handle is discarded whole. Cite every run, loop or turn the cost comes from.

## Cost
\`cost_tokens\` and \`cost_ms\`: what the divergence has cost so far, measured from the cited handles — a run's or a loop's tokens and minutes, a turn's. A claim above what the cited handles total is cut down to it. Never a projection: what it would cost if unchanged belongs in \`why\`.

## Confidence
\`confidence\` runs 0.75 to 1.0. 0.9+: the digest shows the divergence repeated and costed, and nothing in the transcript asked for it. 0.75-0.9: plain and costed, and no legitimate reason is visible. Below 0.75: say nothing; it is discarded.

## Contract — the shape of your reply, stated once (documentation, not a template to echo)
\`\`\`json
{"findings": [{"id": "process:<kebab-slug, at most 40 chars>",
  "kind": "<one sentence, at most 120 chars: what this session does>",
  "lean": "<one sentence, at most 200 chars: how a lean expert runs it>",
  "alternative": "<one imperative sentence, at most 200 chars, addressed to Claude: the one change to the remaining work>",
  "why": "<one or two sentences: the measured cost, and the reason for it you considered and ruled out>",
  "evidence": ["run:<id>", "agent:<alias>", "turn:<n>"],
  "cost_tokens": 0,
  "cost_ms": 0,
  "confidence": 0.85,
  "proposal": null}]}
\`\`\`
\`proposal\`: null unless the change should outlive the session. Otherwise \`{"kind","title","body"}\` where body is, per kind: \`claude-md\` one imperative rule line; \`skill\` the workflow as the body of a SKILL.md; \`agent-brief\` the brief, whose first line may be \`model: haiku\` or \`model: sonnet\`.

Reply with one JSON object: first character \`{\`, last character \`}\`, no prose before or after, no code fence.

## PROCESS DIGEST
{{DIGEST}}

Return the JSON object only.
`

/** Names this session's loops the way one process run sees them: built once before the prompt, read again when the reply comes back. */
export const processAliases = (state: State): ReadonlyMap<string, string> => agentAliases(state.rows, state.loops)

// ---- the digest ----------------------------------------------------------------------------------------

type Section = { name: 'asks' | 'shape' | 'cadence' | 'artifacts' | 'interventions'; header: string; lines: string[]; oldestFirst: boolean; pinned: number }   // pinned: leading lines a cut never drops

// The sections cut first when the digest runs past its cap: the old asks, then the small sections; Shape is the last resort.
const CUT_ORDER: readonly Section['name'][] = ['asks', 'artifacts', 'interventions', 'cadence', 'shape']
const CUT_MARK_MAX = 24        // room for the `~ ×N lines cut` line a cut section ends with
const LIST_MAX = 10            // paths, re-reads and gaps each section names before it stops
const REREAD_MIN = 3           // reads of one path before it is named a re-read
const GAP_MIN_MS = 60_000      // a wait shorter than a minute before the next prompt is the person reading
const READ_RANGE = /:\d*-\d*$/
const MERGE = /\bmerge\b/
const COMMIT = /\bcommit\b/
const MEMORY_FILE = /(\/memory\/[^/]+\.md|\/(CLAUDE|MEMORY)\.md)$/

const minutes = (ms: number): string => `${(ms / 60_000).toFixed(1)}m`

const ktok = (tokens: number): string => `${Math.round(tokens / 1000)}k`

// The family word of a model id (`claude-opus-4-1` → `opus`), or the id itself when it names no family.
const modelShort = (model: string | null): string => model === null ? '?' : (/(opus|sonnet|haiku|fable)/.exec(model)?.[1] ?? model)

// The role a loop plays: its label's first word (`review:C3-r1` → `review`), else its phase, else `agent`.
const roleOf = (l: Loop): string =>
  /^[A-Za-z][\w-]*/.exec(l.label ?? '')?.[0]?.toLowerCase() ?? l.phase?.toLowerCase() ?? 'agent'

// `name ×n` counts, largest first then by name.
const tally = (names: readonly string[]): string => {
  const counts = names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>())
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([n, c]) => `${n} ×${c}`).join(' · ')
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

// What a group of loops returned: severities summed across their reviews, reports counted.
const outcomesCell = (outcomes: readonly (Outcome | null)[]): string => {
  const found = outcomes.filter((o): o is Extract<Outcome, { kind: 'findings' }> => o?.kind === 'findings')
  const severities = SEVERITIES.map(s => [s, found.reduce((n, o) => n + o[s], 0)] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`)
  const reports = outcomes.filter(o => o?.kind === 'report').length
  const parts = [...(severities.length > 0 ? [severities.join(' ')] : found.length > 0 ? ['0 findings'] : []), ...(reports > 0 ? [`report ×${reports}`] : [])]
  return parts.length > 0 ? parts.join(' · ') : '-'
}

const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

// The run a row belongs to: an agent's row by its loop's run; a main-loop row to the newest run launched before it.
const runOfRow = (state: State, row: Row): string | null => {
  if (row.agent !== MAIN_AGENT) return state.loops.find(l => l.id === row.agent)?.run ?? null
  return [...state.runs].reverse().find(r => r.seq <= row.seq)?.id ?? null
}

const isMerge = (r: Row): boolean => r.cls === 'git' && MERGE.test(r.key)

// Merges, and the merges a check run followed before the next merge.
const mergeChecks = (rows: readonly Row[]): { merges: number; checked: number } =>
  [...rows].sort((a, b) => a.seq - b.seq).reduce((acc, r) => {
    if (isMerge(r)) return { merges: acc.merges + 1, checked: acc.checked, open: true }
    if (acc.open && isCheck(r)) return { ...acc, checked: acc.checked + 1, open: false }
    return acc
  }, { merges: 0, checked: 0, open: false })

const handleOf = (aliases: ReadonlyMap<string, string>, l: Loop): string => `agent:${aliases.get(l.id) ?? l.id}`

// One declared (or seen) phase of a run: its loops, their models, time, tokens, edits and what they returned.
const phaseLine = (aliases: ReadonlyMap<string, string>, phase: string, loops: readonly Loop[]): string =>
  [
    `  ${phase}`, `×${loops.length}`, tally(loops.map(l => modelShort(l.model))) || '-', minutes(sumOf(loops.map(l => l.ms))),
    `${ktok(sumOf(loops.map(loopTokens)))} tok`, `edits ${sumOf(loops.map(l => l.edits))}`, outcomesCell(loops.map(l => l.outcome)),
    loops.map(l => handleOf(aliases, l)).join(' ') || '-',
  ].join(' | ')

const runLines = (state: State, aliases: ReadonlyMap<string, string>, run: Run): string[] => {
  const loops = state.loops.filter(l => l.run === run.id)
  const { merges, checked } = mergeChecks(state.rows.filter(r => runOfRow(state, r) === run.id))
  const phases = unique([...run.phases, ...loops.map(l => l.phase ?? '-')])
  return [
    [
      `run:${run.id}`, run.name, `phases ${run.phases.length > 0 ? run.phases.join(' → ') : '(none declared)'}`, `loops ${loops.length}`,
      `Σ${minutes(sumOf(loops.map(l => l.ms)))}`, `Σ${ktok(sumOf(loops.map(loopTokens)))} tok`, `edits ${sumOf(loops.map(l => l.edits))}`,
      `merges ${merges} · checks after ${checked}`, `turn ${run.turn}`,
    ].join(' | '),
    ...phases.map(p => phaseLine(aliases, p, loops.filter(l => (l.phase ?? '-') === p))),
  ]
}

const directLine = (aliases: ReadonlyMap<string, string>, l: Loop): string =>
  [`  ${handleOf(aliases, l)}`, l.label ?? '-', modelShort(l.model), minutes(l.ms), `${ktok(loopTokens(l))} tok`, `calls ${l.calls}`, `edits ${l.edits}`, l.ended ?? 'running'].join(' | ')

const shapeLines = (state: State, aliases: ReadonlyMap<string, string>): string[] => {
  const direct = state.loops.filter(l => l.run === null || !state.runs.some(r => r.id === l.run))
  return [
    ...state.runs.flatMap(run => runLines(state, aliases, run)),
    ...(direct.length > 0 ? [`direct agents: ×${direct.length}`, ...direct.map(l => directLine(aliases, l))] : []),
    `roles × model: ${tally(state.loops.map(l => `${roleOf(l)} ${modelShort(l.model)}`)) || '(no agents)'}`,
  ]
}

const firstAt = (state: State): number | null => state.asks[0]?.at ?? state.runs[0]?.at ?? null

const askLines = (state: State): string[] => {
  const first = state.asks[0]?.at ?? 0
  return state.asks.map(a => `turn:${a.turn} | +${Math.round((a.at - first) / 60_000)}m | ${a.head}${a.pace ? ' | pace' : ''}`)
}

const gapLine = (turns: readonly TurnStat[]): string => {
  const gaps = [...turns].filter(t => t.idleMs >= GAP_MIN_MS).sort((a, b) => b.idleMs - a.idleMs).slice(0, LIST_MAX)
  return `gaps: ${gaps.length > 0 ? gaps.map(t => `turn:${t.turn} idle ${Math.round(t.idleMs / 60_000)}m`).join(', ') : 'none'}`
}

const cadenceLines = (state: State): string[] => {
  const pace = state.asks.filter(a => a.pace)
  const { merges, checked } = mergeChecks(state.rows)
  const last = state.turns[state.turns.length - 1]?.at ?? 0
  const since = firstAt(state)
  return [
    [
      `turns ${state.turns.length}`,
      ...(since !== null && last > since ? [`span ${minutes(last - since)}`] : []),
      `compactions ${state.compactions.length}${state.compactions.length > 0 ? ` (turn ${state.compactions.join(', ')})` : ''}`,
      `pace complaints ${pace.length}${pace.length > 0 ? ` (${pace.map(a => `turn:${a.turn}`).join(', ')})` : ''}`,
    ].join(' · '),
    `checks ${state.rows.filter(isCheck).length} · merges ${merges} · checks after a merge ${checked} · commits ${state.rows.filter(r => r.cls === 'git' && COMMIT.test(r.key)).length}`,
    gapLine(state.turns),
  ]
}

// The path a file row names: a Read key without its slice, else the paths it changed.
const pathsOf = (r: Row): string[] => (r.tool === 'Read' ? [r.key.replace(READ_RANGE, '')] : r.paths)

const topCounts = (entries: readonly string[]): [string, number][] =>
  [...entries.reduce((m, p) => m.set(p, (m.get(p) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, LIST_MAX)

const artifactLines = (state: State): string[] => {
  const edits = state.rows.filter(isEdit)
  const written = edits.flatMap(r => r.paths)
  const reads = state.rows.filter(r => r.tool === 'Read')
  const reread = topCounts(reads.map(r => r.key.replace(READ_RANGE, ''))).filter(([, n]) => n >= REREAD_MIN)
  const loopsOn = (path: string): number => unique(reads.filter(r => r.key.replace(READ_RANGE, '') === path).map(r => r.agent)).length
  // Memory files by name and path only: what they say is never read.
  const memory = unique(state.rows.flatMap(pathsOf).filter(p => MEMORY_FILE.test(p))).map(p =>
    `memory: ${p.slice(p.lastIndexOf('/') + 1)} ${p} ${written.includes(p) ? 'written' : 'read'}`)
  return [
    `edits ${edits.length} on ${unique(written).length} paths · agents' own edits ${sumOf(state.loops.map(l => l.edits))}`,
    ...(written.length > 0 ? [`written: ${topCounts(written).map(([p, n]) => `${p} ×${n}`).join(' · ')}`] : []),
    ...(reread.length > 0 ? [`re-read: ${reread.map(([p, n]) => `${p} ×${n} by ${loopsOn(p)} loops`).join(' · ')}`] : []),
    ...memory,
  ]
}

// Every process finding already raised, open ones too, in its own words: without them the next run mints the
// same divergence under a fresh id, and a second card undoes the person's Ignore.
const interventionLines = (state: State): string[] => {
  const listed = state.patterns.filter(p => p.decision !== null || p.category === 'process')
  return [
    ...listed.map(p => [
      p.id,
      p.decision === null ? 'open' : `${p.decision} @ ${p.decidedAtTurn ?? '-'}`,
      `sent ×${p.sent}${p.ignored > 0 ? ` | ignored ×${p.ignored}` : ''}`,
      ...(p.category === 'process' ? [p.kind] : []),
    ].join(' | ')),
    `cards waiting ${state.cards.length} · standing instructions ${state.standing.length} · one-time notes pending ${state.notes.length} · subagents reached ${state.delivery.agents.length}`,
  ]
}

const render = (sections: readonly Section[]): string =>
  sections.map(s => [s.header, ...(s.lines.length > 0 ? s.lines : ['(none)'])].join('\n')).join('\n\n')

// A section with enough lines dropped to give back `over` characters: the oldest first (after the pinned) where order is time, else the last.
const cut = (s: Section, over: number): Section => {
  const pinned = s.lines.slice(0, s.pinned)
  const order = s.oldestFirst ? s.lines.slice(s.pinned) : s.lines.slice(s.pinned).reverse()
  let removed = 0
  let n = 0
  while (n < order.length && removed < over + CUT_MARK_MAX) { removed += (order[n]?.length ?? 0) + 1; n += 1 }
  const rest = order.slice(n)
  const mark = `~ ×${n} lines cut`
  return { ...s, lines: s.oldestFirst ? [...pinned, mark, ...rest] : [...pinned, ...rest.reverse(), mark] }
}

/**
 * The PROCESS digest: what the person typed, the shape of the spawned work, the cadence, the artifacts and the
 * interventions, at most DIGEST_MAX_CHARS; over the cap the oldest asks (never the first) go first, then the small sections, and Shape last.
 *
 * @param state the session so far
 * @param aliases the loop naming the prompt is built with, so a cited `agent:<alias>` reads back to its loop
 */
export const digestOf = (state: State, aliases: ReadonlyMap<string, string> = processAliases(state)): string => {
  const sections: Section[] = [
    { name: 'asks', header: '## ASKS — what the person typed, oldest first: `turn:<n> | +<min>m since the first | what they typed`, then `| pace` when it complains about pace', lines: askLines(state), oldestFirst: true, pinned: 1 },
    { name: 'shape', header: '## SHAPE — one row per workflow run: `run:<id> | name | declared phases | loops | Σmin | Σtok | edits | merges · checks after | launch turn`, then per phase `phase | ×loops | models | min | tok | edits | outcomes | agent handles`; then agents outside any run, and every role by model', lines: shapeLines(state, aliases), oldestFirst: true, pinned: 0 },
    { name: 'cadence', header: '## CADENCE — turns, span, compactions, pace complaints; check runs, merges, merges a check followed, commits; the longest waits for the person', lines: cadenceLines(state), oldestFirst: false, pinned: 0 },
    { name: 'artifacts', header: '## ARTIFACTS — edits, the paths written most, paths re-read, memory files by name and path', lines: artifactLines(state), oldestFirst: false, pinned: 0 },
    { name: 'interventions', header: '## INTERVENTIONS — process findings already raised and cards decided `id | open or decision @ turn | sent ×N`, a process finding\'s words after it; then what is waiting and what was sent', lines: interventionLines(state), oldestFirst: false, pinned: 0 },
  ]
  const fitted = CUT_ORDER.reduce((all, name) => {
    const over = render(all).length - DIGEST_MAX_CHARS
    return over <= 0 ? all : all.map(s => (s.name === name ? cut(s, over) : s))
  }, sections)
  return render(fitted).slice(0, DIGEST_MAX_CHARS)
}

// ---- triggers ------------------------------------------------------------------------------------------

// Complaints about pace, as the person types them; lowercased first.
const PACE: readonly RegExp[] = [
  /\b(taking|takes|took|take) (so |way |far )?(forever|ages)\b/,
  /\b(taking|takes|took) (so |way |far )?too long\b/,
  /\b(this|it|that)('s| is| was)? (taking )?(way |far )?too long\b/,
  /\bwhy (is (this|it) )?(so |this )?slow\b/,
  /\b(so|too) slow\b/,
  /\bhurry( up)?\b/,
  /\bspeed (this|it|things) up\b/,
  /\bbeen ages\b/,
  /\bwhat('s| is) taking so long\b/,
  /\bstill (not done|waiting)\b/,
  /\b(take|takes|taking|took) (you |it |this )?so long\b/,
  /\b(should|ought to) (have been|be) (much |way |a lot )?faster\b/,
  /\b(expensive|pricey|costly) and slow\b/,
  /\bslow and (expensive|pricey|costly)\b/,
]

/** True when a typed prompt reads as a complaint about pace: 'this is taking forever', 'why so slow'. */
export const isPace = (text: string): boolean => {
  const lower = text.toLowerCase()
  return PACE.some(re => re.test(lower))
}

/**
 * True when a process run may start: none is running, something happened since the last one, and the clock
 * has waited PROCESS_CLOCK_MS × backoff — the clock always, an event trigger only once over the budget share.
 *
 * @param state the session so far
 * @param now the clock
 * @param trigger what asked for the run
 */
export const shouldProcess = (state: State, now: number, trigger: ProcessTrigger): boolean => {
  const p = state.process
  if (p.running || state.seq <= p.lastAtSeq) return false
  const since = p.lastAtMs > 0 ? p.lastAtMs : (firstAt(state) ?? now)
  const waited = now - since >= PROCESS_CLOCK_MS * p.backoff
  return trigger === 'clock' || p.backoff > 1 ? waited : true
}

/** Fills the process prompt with this session's digest; `aliases` is the naming the digest prints, for `parseProcessReply`. */
export const buildProcessPrompt = (state: State, aliases: ReadonlyMap<string, string> = processAliases(state)): string =>
  PROCESS_PROMPT.split('{{DIGEST}}').join(digestOf(state, aliases))

// ---- the reply -----------------------------------------------------------------------------------------

const RUN_HANDLE = /^run:(.+)$/
const TURN_HANDLE = /^turn:(\d+)$/
const AGENT = /^agent:(.+)$/

/** What the cited handles measured: the tokens and wall time of every loop they name (a run's loops, each once) and of every turn. */
export const measuredCost = (state: State, handles: readonly string[]): { tokens: number; ms: number } => {
  const runs = handles.flatMap(h => RUN_HANDLE.exec(h)?.[1] ?? [])
  const agents = handles.flatMap(h => AGENT.exec(h)?.[1] ?? [])
  const turns = handles.flatMap(h => { const n = TURN_HANDLE.exec(h)?.[1]; return n === undefined ? [] : [Number(n)] })
  const loops = state.loops.filter(l => agents.includes(l.id) || (l.run !== null && runs.includes(l.run)))
  const cited = state.turns.filter(t => turns.includes(t.turn))
  return {
    tokens: sumOf(loops.map(loopTokens)) + sumOf(cited.map(t => t.input + t.cacheCreate + t.output)),
    ms: sumOf(loops.map(l => l.ms)) + sumOf(cited.map(t => t.ms)),
  }
}

// A handle the digest printed, stored the way the registry keeps it (`agent:<agentId>`), or null.
const processHandle = (value: unknown, state: State, aliases: ReadonlyMap<string, string>): string | null => {
  const handle = str(value)
  const turn = TURN_HANDLE.exec(handle)
  // The digest prints completed turns (CADENCE) and every ask's turn (ASKS), the one still running included.
  if (turn !== null) {
    const n = Number(turn[1])
    return state.turns.some(t => t.turn === n) || state.asks.some(a => a.turn === n) ? `turn:${n}` : null
  }
  const run = RUN_HANDLE.exec(handle)
  if (run !== null) return state.runs.some(r => r.id === run[1]) ? handle : null
  const agent = AGENT.exec(handle)
  const loop = agent === null ? undefined : loopOf(state, aliases, agent[1] ?? '')
  return loop !== undefined ? `agent:${loop.id}` : null
}

const evidenceOf = (value: unknown, state: State, aliases: ReadonlyMap<string, string>): string[] | string => {
  if (!Array.isArray(value) || value.length === 0) return 'evidence must be a non-empty array of handles'
  const handles = value.map(h => processHandle(h, state, aliases))
  const badAt = handles.indexOf(null)
  if (badAt >= 0) return `evidence ${cell(value[badAt], 40) || '(not a string)'} is not a run, agent or turn the digest printed`
  return unique(handles.filter((h): h is string => h !== null))
}

const idOf = (value: unknown): string => {
  const given = str(value)
  const s = slug(given.slice(given.indexOf(':') + 1))
  return s.length > 0 ? `process:${s}` : ''
}

const claimed = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

const textDrop = (name: string, text: string, max: number): string | null =>
  text.length === 0 ? `${name} is empty` : text.length > max * 2 ? `${name} is ${text.length} chars, over twice ${max}` : null

// A string is the one short reason the finding was dropped; the object is the finding itself.
const findingOf = (value: unknown, state: State, aliases: ReadonlyMap<string, string>): ProcessFinding | string => {
  if (!isRecord(value)) return 'not an object'
  const id = idOf(value['id'])
  const kind = str(value['kind']).trim()
  const lean = str(value['lean']).trim()
  const alternative = str(value['alternative']).trim()
  const confidence = value['confidence']
  if (id.length === 0) return 'id is missing'
  const bad = textDrop('kind', kind, KIND_MAX) ?? textDrop('lean', lean, ALTERNATIVE_MAX) ?? textDrop('alternative', alternative, ALTERNATIVE_MAX)
  if (bad !== null) return bad
  if (typeof confidence !== 'number' || confidence > 1) return 'confidence is not a number up to 1'
  if (confidence < PROCESS_MIN_CONFIDENCE) return `confidence ${confidence} is below ${PROCESS_MIN_CONFIDENCE}`
  if (state.patterns.some(p => p.id === id && p.decision === 'keep')) return 'kept this session'
  const evidence = evidenceOf(value['evidence'], state, aliases)
  if (typeof evidence === 'string') return evidence
  const measured = measuredCost(state, evidence)
  return {
    id, category: 'process', kind, evidence, signature: null, why: str(value['why']).trim(), alternative, confidence,
    estTokensPerTurn: null, proposal: proposalOf(value['proposal']), lean,
    cost: { tokens: Math.min(claimed(value['cost_tokens']), measured.tokens), ms: Math.min(claimed(value['cost_ms']), measured.ms) },
  }
}

type Sifted = { findings: ProcessFinding[]; dropped: string[] }

/** What the process judge said: at most MAX_PROCESS_FINDINGS valid findings, their cost clamped to the cited handles, and one line per drop; never throws. `aliases` must be the table `buildProcessPrompt` printed. */
export const parseProcessReply = (text: string, state: State, aliases: ReadonlyMap<string, string> = processAliases(state)): { findings: ProcessFinding[]; dropped: string[]; returned: number } => {
  const root = parseObject(text)
  if (root === null) return { findings: [], dropped: ['reply was not JSON'], returned: 0 }
  const raw = root['findings']
  if (!Array.isArray(raw)) return { findings: [], dropped: ['findings was not an array'], returned: 0 }
  const sifted = raw.reduce<Sifted>((kept, value, i) => {
    const label = idOf(isRecord(value) ? value['id'] : '') || `#${i + 1}`
    const dropped = (reason: string): Sifted => ({ findings: kept.findings, dropped: [...kept.dropped, `${label}: ${reason}`] })
    const f = findingOf(value, state, aliases)
    if (typeof f === 'string') return dropped(f)
    if (kept.findings.some(k => k.id === f.id)) return dropped('the reply already reported this id')
    if (kept.findings.length >= MAX_PROCESS_FINDINGS) return dropped(`over MAX_PROCESS_FINDINGS (${MAX_PROCESS_FINDINGS})`)
    return { findings: [...kept.findings, f], dropped: kept.dropped }
  }, { findings: [], dropped: [] })
  return { ...sifted, returned: raw.length }
}

/** Folds process findings into the registry as the habit judge's `merge` does, the newest run's `kind`, `lean` and clamped `cost` kept; names the fresh, the recurred and the ids the cap evicted, for `process.done`. */
export const mergeProcess = (state: State, findings: readonly ProcessFinding[]): { patterns: Pattern[]; fresh: string[]; recurred: string[]; evicted: string[] } => {
  const merged = merge(state, [...findings])
  return {
    ...merged,
    patterns: merged.patterns.map(p => {
      const f = findings.find(x => x.id === p.id)
      return f !== undefined ? { ...p, kind: f.kind, lean: f.lean, cost: f.cost } : p
    }),
  }
}
