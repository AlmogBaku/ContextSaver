import type { ModelForkResult, On, PaneOpenArgs, RenderElement } from 'claude-code'

import { adoptRows } from './core/adopt'
import { demoForkUsage, demoPatterns, demoRows, demoTurns, demoUsage } from './core/demo'
import { buildPrompt, merge, parseReply, shouldRun, spentOf, usageOf } from './core/judge'
import { rowOf } from './core/ledger'
import { bandModel, debugDump, fromStored, mergeStored, paneModel, parseRegistry, reduce, toStored, usageLine } from './core/patterns'
import { appendedTo, bulletOnly, mergeSettings, propose } from './core/rules'
import { collapseWs, duration, fit, instructionOf, pctOf } from './core/text'
import {
  AUTO_OPEN_MIN_COLUMNS, CLAUDE_MD_HEADING, COMMAND, DEBUG_MAX_DROPPED, MAX_PATTERNS, PANE_ID, PANE_INLINE_ROWS,
  PANE_TITLE, PLUGIN_NAME, initialState,
} from './core/types'
import type { Action, Actions, Artifact, Choice, State, Ui } from './core/types'
import type { Host } from './host'
import { Band, Pane } from './ui'

const FIX_USAGE = 'Usage: /saver fix [n] [instruction] (a leading number is the card the pane draws; without one: the card whose Fix… field is open, else card 1)'
const SAVER_USAGE = 'Usage: /saver [check | fix [n] [text] | ignore <n> | debug | reset]'
const NOTHING_TEXT = 'ContextSaver: nothing to decide on'
const CHECKING_TEXT = 'ContextSaver: checking this session for waste…'
const ALREADY_TEXT = 'ContextSaver: already checking'
const ANSWER_HEAD = 100   // characters of the turn's answer kept as an evidence quote
const CARD_KIND = 60      // characters of a card's behaviour quoted back in a command's reply
const DEMO_CONTEXT = [120_000, 190_000, 250_000, 320_000]   // `/saver demo`: the window filling up to the sample's own 32%, so the trend draws

// What set one judge run going, as the debug log names it: the mid-turn cadence, the turn's end, or the person.
type JudgeReason = 'tool.call' | 'turn.complete' | '/saver check'

/**
 * Registers ContextSaver: the ledger of every tool call, the judge that names wasteful
 * behaviours, the band and the pane that let the user fix or ignore them.
 *
 * @param on the engine's registrar
 */
export function register(on: On): void {
  let state: State = initialState('', 0)
  let host: Host | null = null
  let isDebug = false
  // `judge.start` lands one clock read after the decision to run, and a storm of tool calls decides
  // inside that window: this flag is what stops a second fork of the same session.
  let forking = false
  // A check asked for while a run is in flight is answered by that run: cadence runs are frequent now,
  // and the person who pressed Check now would otherwise be told `already checking` and never told more.
  let asked = false

  const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  const paneArgs = (): PaneOpenArgs => ({ id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS })

  const savedToast = (before: State['saved']): void => {
    const ms = state.saved.ms - before.ms
    const pct = pctOf(state.saved.chars - before.chars, state.usage.window)
    const grew = [...(ms > 0 ? [`+${duration(ms)}`] : []), ...(pct > 0 ? [`+~${pct}%`] : [])]
    if (grew.length === 0) return
    host?.toast(`${grew.join(' · ')} context saved`)
  }

  const openIds = (): string[] => state.patterns.filter(p => p.openedAtTurn !== null).map(p => p.id)

  // Outside a render hook: fold the action in, redraw, and credit an instruction that settled in it.
  const dispatch = (action: Action): void => {
    const before = state.saved
    const open = openIds()
    state = reduce(state, action)
    host?.invalidate()
    // Only a settled instruction is a saving to announce; the per-turn accrual behind it stays quiet.
    if (open.some(id => state.patterns.find(p => p.id === id)?.openedAtTurn === null)) savedToast(before)
  }

  // Inside a render hook: fold the action in with no redraw, since a redraw loops.
  const observe = (action: Action): void => {
    state = reduce(state, action)
  }

  const persist = (): void => {
    const engine = host
    if (engine === null) return
    const key = `patterns:${state.cwd}`
    const mine = state.patterns.map(toStored)
    void engine
      .storeGet(key)
      .then(value => engine.storeSet(key, mergeStored(parseRegistry(value), mine)))
      .catch(() => undefined)
  }

  const openPane = async (auto?: true): Promise<void> => {
    const engine = host
    if (engine === null) return
    await engine.openPane(paneArgs())
    dispatch(auto === undefined ? { type: 'pane', open: true } : { type: 'pane', open: true, auto })
  }

  // Only after fresh cards arrived, once a session, and only where the surface would draw it.
  const autoOpen = async (fresh: readonly string[]): Promise<void> => {
    const queued = fresh.some(id => state.cards.includes(id))
    if (!queued || state.paneOpen || state.autoOpened || (state.columns ?? 0) < AUTO_OPEN_MIN_COLUMNS) return
    try {
      await openPane(true)
    } catch {
      // an unasked open the surface or another plugin refused is no error of the user's
    }
  }

  // A check the person asked for: they are waiting for the answer, so the pane opens at any width, every time.
  const openForCheck = async (queued: readonly string[]): Promise<void> => {
    if (queued.length === 0 || state.paneOpen) return
    try {
      await openPane()
    } catch {
      // the surface or another plugin refused: the band still says what was found
    }
  }

  // What the run put in front of the user: a recurrence is news too, and it is the D4 moment this exists for.
  const checkedText = (queued: number): string =>
    queued === 0 ? 'ContextSaver: nothing new' : `ContextSaver: ${queued} new waster${queued === 1 ? '' : 's'}`

  // A run that reported nothing: a cold snapshot, a refusal, or a failure of ours.
  const judgedNothing = (error: string): Action => ({
    type: 'judge.done', patterns: state.patterns, fresh: [], recurred: [], focus: null, time: null, context: null, spent: 0, error,
    returned: 0, kept: 0, dropped: [], usage: null,
  })

  // A run the person asked for answers them, whatever it found: silence is what a check must never be.
  const failedToast = (requested: boolean, reason: string): void => {
    if (requested || asked) host?.toast(`ContextSaver: check failed — ${reason}`)
  }

  const judgeOnce = async (engine: Host, requested: boolean, reason: JudgeReason): Promise<void> => {
    const seq = state.seq
    const now = await engine.now()
    dispatch({ type: 'judge.start', now, seq })
    let reply: ModelForkResult | null = null
    let failed: string | null = null
    try {
      reply = await engine.fork(buildPrompt(state))
    } catch (err) {
      failed = messageOf(err)
    }
    if (reply === null) {
      dispatch(judgedNothing(failed ?? 'cold snapshot'))
      failedToast(requested, failed ?? 'cold snapshot')
      return
    }
    try {
      const { findings, focus, time, context, dropped, returned } = parseReply(reply.text, state)
      const merged = merge(state, findings)
      // A finding the registry cap evicted never becomes a card, so it is dropped, not kept.
      const reasons = [...dropped, ...merged.evicted.map(id => `${id}: evicted, over MAX_PATTERNS (${MAX_PATTERNS})`)]
      const kept = findings.length - merged.evicted.length
      const usage = usageOf(reply.usage)
      dispatch({
        type: 'judge.done', patterns: merged.patterns, fresh: merged.fresh, recurred: merged.recurred, focus,
        time, context, spent: spentOf(usage), error: null, returned, kept, dropped: reasons, usage,
      })
      try {
        if (isDebug) {
          engine.log(`ContextSaver judge: ${returned} returned · ${kept} kept · ${reasons.length} dropped · from ${reason}`)
          for (const line of reasons.slice(0, DEBUG_MAX_DROPPED)) engine.log(line)
          // A cold cache is what makes a run expensive, and only the four counts say which it was.
          engine.log(usageLine(usage))
        }
      } catch {
        // a log we could not write is not a failed run: the findings are already in the registry
      }
      persist()
      // Every card this run queued: a fresh finding, or a steered behaviour that came back.
      const queued = [...merged.fresh, ...merged.recurred].filter(id => state.cards.includes(id))
      // A check asked for mid-run is answered by the run it arrived in, whichever run that was.
      if (!(requested || asked)) return autoOpen(queued)
      engine.toast(checkedText(queued.length))
      return openForCheck(queued)
    } catch (err) {
      // Whatever went wrong, the run is over: `running` may never stay true.
      dispatch(judgedNothing(messageOf(err)))
      failedToast(requested, messageOf(err))
    }
  }

  /**
   * Judges the session once, if no run is already in flight.
   *
   * @param requested true when the person asked for this run (`Check now`, `/saver check`), which is
   *   answered with a toast and opens the pane wherever it can be drawn; a cadence run stays quiet
   *   and keeps the once-a-session, wide-terminal rule for opening itself — unless someone asks while
   *   it is in flight, in which case that run answers them.
   * @param reason what set this run going, for the debug log: the mid-turn cadence, the turn's end, or the person.
   */
  async function runJudge(requested: boolean, reason: JudgeReason): Promise<void> {
    const engine = host
    if (engine === null || forking || state.judge.running) return
    forking = true
    try {
      await judgeOnce(engine, requested, reason)
    } finally {
      forking = false
      asked = false
    }
  }

  const checkNow = (): string => {
    if (forking || state.judge.running) {
      // The run already going answers this ask: nothing is forked, and nobody is left without a reply.
      asked = true
      return ALREADY_TEXT
    }
    void runJudge(true, '/saver check').catch(() => undefined)
    return CHECKING_TEXT
  }

  const togglePane = async (): Promise<void> => {
    const engine = host
    if (engine === null) return
    try {
      // The `ui.close` hook records the close, as it records the person's own.
      if (state.paneOpen) await engine.closePane({ id: PANE_ID })
      else await openPane()
    } catch {
      // the surface or another plugin refused: the pane stays as it was, and `/saver` says so
    }
  }

  const firstLine = (text: string): string => {
    const [head = ''] = text.split('\n')
    return head === text ? text : `${head} …`
  }

  const decide = (patternId: string, choice: Choice, text?: string): void => {
    const p = state.patterns.find(q => q.id === patternId)
    if (p === undefined) return
    dispatch({ type: 'decide', patternId, choice, text })
    if (state.patterns.find(q => q.id === patternId)?.decision !== choice) return
    if (choice === 'keep') host?.toast(`ContextSaver: ignored "${p.kind}"`)
    if (choice === 'kill') host?.toast(`ContextSaver: fixed — ${p.alternative}`)
    if (choice === 'steer') host?.toast(`ContextSaver: fixed with your note — ${firstLine(text ?? '')}`)
    persist()
  }

  // The number the pane draws beside a card is its seat in `cards`; 0 means the card is no longer listed.
  const seatOf = (patternId: string): number => state.cards.indexOf(patternId) + 1

  const cardReply = (patternId: string, seat: number, tail: string): string => {
    const kind = state.patterns.find(q => q.id === patternId)?.kind ?? patternId
    return `ContextSaver: card ${seat} — "${fit(kind, CARD_KIND)}" · ${tail}`
  }

  const numberOf = (token: string): number | null => (/^\d+$/.test(token) ? Number(token) : null)

  // A number no card wears is a numbering mistake, whichever verb typed it: it is refused, never obeyed.
  const noCardText = (n: number): string => `ContextSaver: no card ${n} (1–${state.cards.length})`

  // `/saver ignore 2` and `/saver fix 2` decide the card the pane numbers 2, and say which one they took.
  const decideByNumber = (choice: Choice, token: string): string => {
    if (state.cards.length === 0) return NOTHING_TEXT
    const n = numberOf(token)
    if (n === null) return SAVER_USAGE
    const patternId = state.cards[n - 1]
    if (patternId === undefined) return noCardText(n)
    const reply = cardReply(patternId, n, choice === 'keep' ? 'ignored' : 'fixed')
    decide(patternId, choice)
    return reply
  }

  const steerSubmit = (patternId: string, text: string): void => {
    const wanted = text.trim()
    if (wanted === '') {
      host?.toast('ContextSaver: write the instruction first')
      return
    }
    decide(patternId, 'steer', wanted)
  }

  // The artifact's own words without the file's furniture: a bullet, or the prose under a frontmatter.
  const bodyOf = (content: string): string =>
    content.includes(CLAUDE_MD_HEADING) ? bulletOnly(content).replace(/^- /, '') : (content.split('---\n').at(-1) ?? content)

  const writeArtifact = async (a: Artifact): Promise<void> => {
    const engine = host
    if (engine === null) return
    try {
      // A whole-file write reads nothing; an append and a settings merge need what is there.
      const existing = a.mode === 'write' || !(await engine.exists(a.path)) ? null : await engine.readFile(a.path)
      if (a.mode === 'append') await engine.writeFile(a.path, appendedTo(existing, a.content))
      if (a.mode === 'write') await engine.writeFile(a.path, a.content)
      if (a.mode === 'merge-settings') await engine.writeFile(a.path, mergeSettings(existing, a.content))
      dispatch({ type: 'artifact.done', patternId: a.patternId, kind: a.kind, written: true })
      engine.toast(`Wrote ${a.path}`)
    } catch (err) {
      engine.toast(messageOf(err))
    }
  }

  const tryArtifact = (a: Artifact): void => {
    dispatch({ type: 'standing.add', text: instructionOf(collapseWs(bodyOf(a.content)) || a.title) })
    dispatch({ type: 'artifact.done', patternId: a.patternId, kind: a.kind, written: true })
    host?.toast(`Trying "${a.title}" for this session`)
  }

  // `autoFocus` only lands where the site takes the keyboard fresh, and the press that opened the field
  // left the ring on the Fix… button: the ring is moved by hand, and a refusal is no error of the user's.
  const focusSteerField = (patternId: string): void => {
    if (state.steering !== patternId) return
    void host?.focusElement({ requestId: PANE_ID, key: `card:${patternId}:text` }).catch(() => undefined)
  }

  const actions: Actions = {
    keep: patternId => decide(patternId, 'keep'),
    steer: patternId => {
      dispatch({ type: 'steer.begin', patternId })
      focusSteerField(patternId)
    },
    steerDraft: text => dispatch({ type: 'steer.draft', text }),
    steerSubmit: (patternId, text) => steerSubmit(patternId, text),
    kill: patternId => decide(patternId, 'kill'),
    info: patternId => dispatch({ type: 'expand', patternId }),
    togglePane: () => {
      void togglePane()
    },
    // The band and the pane have no reply to write in, so the press is answered with a toast.
    check: () => {
      host?.toast(checkNow())
    },
    write: a => {
      void writeArtifact(a)
    },
    tryOnce: a => tryArtifact(a),
    // A skipped rule is handled: `state.written` is the set the pane never offers again.
    skip: a => dispatch({ type: 'artifact.done', patternId: a.patternId, kind: a.kind, written: true }),
  }

  on('session.start', async ($, e, next) => {
    try {
      const engine: Host = {
        now: () => $.clock.now(),
        invalidate: () => $.ui.invalidate('ui.render'),
        toast: text => $.ui.toast(text),
        log: text => $.ui.log(text),
        openPane: args => $.ui.open(args),
        closePane: args => $.ui.close(args),
        focusElement: args => $.ui.focus(args),
        registerCommand: spec => $.command.register(spec),
        usage: args => $.session.usage(args),
        messages: () => $.session.messages(),
        storeGet: key => $.store.get(key),
        storeSet: (key, value) => $.store.set(key, value),
        fork: prompt => $.model.fork({ prompt }),
        readFile: path => $.fs.read(path),
        writeFile: (path, text) => $.fs.write(path, text),
        exists: path => $.fs.exists(path),
        debugFlag: () => $.env.get('CONTEXTSAVER_DEBUG'),
      }
      host = engine
      const u = await engine.usage({ breakdown: 'summary' })
      const now = await engine.now()
      const stored = parseRegistry(await engine.storeGet(`patterns:${e.cwd}`))
      state = { ...initialState(e.cwd, u.context.window), patterns: stored.map(fromStored) }
      dispatch({
        type: 'usage',
        usage: { window: u.context.window, compactAt: u.context.breakdown?.autoCompactThreshold, tokens: u.context.tokens, percent: u.context.percent },
        now,
      })
      const tokensOf = (items: readonly { tokens: number }[] | undefined): number => (items ?? []).reduce((n, i) => n + i.tokens, 0)
      const breakdown = u.context.breakdown
      dispatch({
        type: 'overhead',
        overhead: { memory: tokensOf(breakdown?.memoryFiles), mcp: tokensOf(breakdown?.mcpTools), agents: tokensOf(breakdown?.agents) },
      })
      try {
        await engine.registerCommand(COMMAND)
      } catch (err) {
        engine.log(`${PLUGIN_NAME}: /${COMMAND.name} is taken — ${messageOf(err)}`)
      }
      try {
        const flag = await engine.debugFlag()
        isDebug = flag !== undefined && flag !== '' && flag !== '0'
      } catch {
        isDebug = false
      }
      // Last, so a transcript we cannot read costs the session nothing it already has.
      const adopted = adoptRows(await engine.messages())
      if (adopted.length === 0) return next(e)
      dispatch({ type: 'adopt', rows: adopted })
      if (isDebug) engine.log(`ContextSaver adopted ${adopted.length} rows from the transcript · /saver check judges them now`)
      return next(e)
    } catch {
      return next(e)
    }
  })

  on('turn.start', ($, e, next) => {
    try {
      dispatch({ type: 'turn.start' })
      return next(e)
    } catch {
      return next(e)
    }
  })

  on('tool.call', async ($, e, next) => {
    const engine = host
    let started = 0
    try {
      if (engine === null || next.origin.plugin === PLUGIN_NAME) return next(e)
      started = await engine.now()
    } catch {
      return next(e)
    }
    // `next(e)` is called exactly once: a rejection is the engine's to report — calling it again would run the tool twice.
    const result = await next(e)
    try {
      const ended = await engine.now()
      dispatch({ type: 'row', row: rowOf(e, result, ended - started, state.turn) })
      const row = state.rows[state.rows.length - 1]
      if (isDebug && row !== undefined) engine.log(`ContextSaver row r${row.seq} ${row.tool} ${row.key} ${row.ms}ms ${row.chars}ch`)
      // One agentic turn can run for hours, so the cadence is judged here too, not only between turns.
      if (shouldRun(state, ended)) void runJudge(false, 'tool.call').catch(() => undefined)
      const pending = state.notes
      if (pending.length === 0 || result.deny !== undefined) return result
      dispatch({ type: 'notes.drained' })
      return { ...result, context: [...(result.context ?? []), ...pending] }
    } catch {
      return result
    }
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const engine = host
      if (engine === null || e.agentId !== undefined) return next(e)
      const u = e.usage
      // The window is sampled before the turn is recorded: how full it is after this turn is the turn's
      // own figure, and its growth over the last turns is the pace compaction actually runs at. The
      // sample is optional, though: a refused `session.usage` costs this turn its context reading, never
      // the turn itself — without the stat the trend, the pace and every token gate go with it.
      const seen = await engine.usage().catch(() => null)
      const now = await engine.now()
      dispatch({
        type: 'turn.complete',
        stat: {
          input: u?.input_tokens ?? 0,
          output: u?.output_tokens ?? 0,
          cacheRead: u?.cache_read_input_tokens ?? 0,
          cacheCreate: u?.cache_creation_input_tokens ?? 0,
          ms: e.durationMs,
          answerChars: e.answer.length,
          answerHead: e.answer.slice(0, ANSWER_HEAD),
          aborted: e.isAborted,
          context: seen?.context.tokens ?? null,
        },
      })
      if (seen !== null) dispatch({ type: 'usage', usage: { window: seen.context.window, tokens: seen.context.tokens, percent: seen.context.percent }, now })
      if (shouldRun(state, now)) void runJudge(false, 'turn.complete').catch(() => undefined)
      return next(e)
    } catch {
      return next(e)
    }
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    try {
      dispatch({ type: 'compact' })
    } catch {
      // a compaction we failed to record is still the compaction the engine performed
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      // `origin` is the engine's to stamp; read it defensively so an unstamped submission still carries the texts.
      if (e.origin?.kind === 'plugin' || e.text.trimStart().startsWith(`/${COMMAND.name}`)) return next(e)
      const extra = [...state.notes, ...state.standing.filter(text => !state.notes.includes(text))]
      if (extra.length === 0) return next(e)
      dispatch({ type: 'notes.drained' })
      return next({ ...e, context: [...(e.context ?? []), ...extra] })
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (host === null || e.props.hasSurvey || e.surface === 'mobile') return next(e)
      if (e.props.bodyColumns !== state.columns) observe({ type: 'columns', columns: e.props.bodyColumns })
    } catch {
      return next(e)
    }
    // Drawn once: a band we cannot build answers with what is beneath it, never with a second dispatch.
    const below: RenderElement = await next(e)
    try {
      const { Box, Text, Button, Input, Raster } = $.ui.resolve(e) as unknown as Ui
      const band = Band({
        ui: { Box, Text, Button, Input, Raster },
        model: bandModel(state),
        site: { bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows },
        actions,
      })
      return Box({ flexDirection: 'column', children: [below, band] })
    } catch {
      return below
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    try {
      if (host === null || e.surface === 'mobile') return next(e)
      const { Box, Text, Button, Input, Raster } = $.ui.resolve(e) as unknown as Ui
      return Pane({
        ui: { Box, Text, Button, Input, Raster },
        model: paneModel(state, propose(state)),
        site: { bodyColumns: e.props.bodyColumns, maxRows: e.props.scroll.bodyRows },
        placement: e.props.placement,
        actions,
      })
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: COMMAND.name }, async ($, e, next) => {
    try {
      if (host === null) return next(e)
      const args = e.args.trim()
      const [sub = ''] = args.split(/\s+/)
      if (sub === '' || sub === 'rules') {
        await togglePane()
        return { text: state.paneOpen ? 'ContextSaver pane shown' : 'ContextSaver pane hidden' }
      }
      if (sub === 'check') return { text: checkNow() }
      if (sub === 'fix') {
        const rest = args.slice(sub.length).trim()   // newlines inside the instruction survive
        const [first = ''] = rest.split(/\s+/)
        // A leading number is always the card: folding a mistyped one back into the instruction would
        // fix the wrong card with a garbled sentence, and `standing` keeps it for the whole session.
        const n = numberOf(first)
        if (state.cards.length === 0) return { text: NOTHING_TEXT }
        if (n !== null && (n < 1 || n > state.cards.length)) return { text: noCardText(n) }
        const text = (n === null ? rest : rest.slice(first.length)).trim()
        // Nothing after the number sends the fix the card already offers; a note sends the note instead.
        if (text === '') return { text: n === null ? FIX_USAGE : decideByNumber('kill', first) }
        const patternId = n === null ? (state.steering ?? state.cards[0]) : state.cards[n - 1]
        const seat = patternId === undefined ? 0 : seatOf(patternId)
        if (patternId === undefined || seat === 0) return { text: FIX_USAGE }
        steerSubmit(patternId, text)
        return { text: cardReply(patternId, seat, `fixed with your note: ${text}`) }
      }
      if (sub === 'ignore') return { text: decideByNumber('keep', args.slice(sub.length).trim()) }
      if (sub === 'demo' && isDebug) {
        // Debug-only: the pane's own look, without waiting for a real finding. The header is part of that
        // look, so a usage sample and its turns come first — without them the hero row draws its empty
        // state above cards that state a percentage of context. (`now` is the reducer's to ignore.)
        dispatch({ type: 'usage', usage: demoUsage(), now: 0 })
        // Four turns, each with the context it left behind, so the header's trend and its run to
        // compaction draw from a window filling up rather than from what a turn was billed.
        const samples = demoTurns()
        for (const [at, context] of DEMO_CONTEXT.entries()) {
          const stat = samples[at % samples.length]
          if (stat !== undefined) dispatch({ type: 'turn.complete', stat: { ...stat, context } })
        }
        for (const row of demoRows(state.turn)) dispatch({ type: 'row', row })
        const patterns = demoPatterns(state.turn)
        const fresh = patterns.filter(p => p.decision === null).map(p => p.id)
        const usage = demoForkUsage()
        dispatch({
          type: 'judge.done', patterns, fresh, recurred: [], focus: null, time: null, context: null,
          spent: spentOf(usage), error: null, returned: patterns.length, kept: patterns.length, dropped: [], usage,
        })
        await openPane()
        return { text: 'ContextSaver: demo wasters loaded' }
      }
      if (sub === 'debug') return { text: debugDump(state) }
      if (sub === 'reset') {
        dispatch({ type: 'reset' })
        return { text: 'ContextSaver: session state reset' }
      }
      return { text: SAVER_USAGE }
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: ['clear', 'resume'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      dispatch({ type: 'reset' })
    } catch {
      // the command ran either way: it is not ours to run a second time
    }
    return result
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    try {
      // A close another plugin refused leaves the pane open, so the band still reads `Close`.
      if (result.deny === undefined) dispatch({ type: 'pane', open: false })
    } catch {
      // the pane stays as the surface left it
    }
    return result
  })
}
