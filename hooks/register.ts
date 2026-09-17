import type { ModelForkResult, On, PaneOpenArgs, RenderElement } from 'claude-code'

import { demoPatterns, demoRows } from './core/demo'
import { buildPrompt, costOf, merge, parseReply, shouldRun } from './core/judge'
import { rowOf } from './core/ledger'
import { bandModel, debugDump, fromStored, mergeStored, paneModel, parseRegistry, reduce, toStored } from './core/patterns'
import { appendedTo, bulletOnly, mergeSettings, propose } from './core/rules'
import { collapseWs, duration, instructionOf, pctOf } from './core/text'
import {
  AUTO_OPEN_MIN_COLUMNS, CLAUDE_MD_HEADING, COMMAND, PANE_ID, PANE_INLINE_ROWS, PANE_TITLE, PLUGIN_NAME, initialState,
} from './core/types'
import type { Action, Actions, Artifact, Choice, State } from './core/types'
import type { Host } from './host'
import { Band, Pane } from './ui'

const STEER_USAGE = 'Usage: /saver steer <instruction> (applies to the waster whose Steer field is open, else the newest)'
const SAVER_USAGE = 'Usage: /saver [check | steer <text> | debug | reset]'
const ANSWER_HEAD = 100   // characters of the turn's answer kept as an evidence quote

/**
 * Registers ContextSaver: the ledger of every tool call, the judge that names wasteful
 * behaviours, the band and the pane that let the user keep, steer or kill them.
 *
 * @param on the engine's registrar
 */
export function register(on: On): void {
  let state: State = initialState('', 0)
  let host: Host | null = null
  let isDebug = false

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

  async function runJudge(): Promise<void> {
    const engine = host
    if (engine === null || state.judge.running) return
    dispatch({ type: 'judge.start' })
    let reply: ModelForkResult | null = null
    let failed: string | null = null
    try {
      reply = await engine.fork(buildPrompt(state))
    } catch (err) {
      failed = messageOf(err)
    }
    if (reply === null) {
      dispatch({ type: 'judge.done', patterns: state.patterns, fresh: [], recurred: [], focus: null, spent: 0, error: failed ?? 'cold snapshot' })
      return
    }
    try {
      const { findings, focus } = parseReply(reply.text, state)
      const merged = merge(state, findings)
      dispatch({ type: 'judge.done', patterns: merged.patterns, fresh: merged.fresh, recurred: merged.recurred, focus, spent: costOf(reply.usage), error: null })
      persist()
      await autoOpen(merged.fresh)
    } catch (err) {
      // Whatever went wrong, the run is over: `running` may never stay true.
      dispatch({ type: 'judge.done', patterns: state.patterns, fresh: [], recurred: [], focus: null, spent: 0, error: messageOf(err) })
    }
  }

  const checkNow = (): string => {
    if (state.judge.running) return 'ContextSaver: already checking'
    void runJudge().catch(() => undefined)
    return 'ContextSaver: checking this session for waste…'
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
    if (choice === 'keep') host?.toast(`ContextSaver: kept "${p.kind}"`)
    if (choice === 'kill') host?.toast(`ContextSaver: told Claude to stop — ${p.alternative}`)
    if (choice === 'steer') host?.toast(`ContextSaver: Claude will be told — ${firstLine(text ?? '')}`)
    persist()
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
  // left the ring on the Steer button: the ring is moved by hand, and a refusal is no error of the user's.
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
    check: () => {
      checkNow()
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
      const ms = (await engine.now()) - started
      dispatch({ type: 'row', row: rowOf(e, result, ms, state.turn) })
      const row = state.rows[state.rows.length - 1]
      if (isDebug && row !== undefined) engine.log(`ContextSaver row r${row.seq} ${row.tool} ${row.key} ${row.ms}ms ${row.chars}ch`)
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
        },
      })
      const seen = await engine.usage()
      const now = await engine.now()
      dispatch({ type: 'usage', usage: { window: seen.context.window, tokens: seen.context.tokens, percent: seen.context.percent }, now })
      if (shouldRun(state)) void runJudge().catch(() => undefined)
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
      const { Box, Text, Button, Input } = $.ui.resolve(e)
      const band = Band({
        ui: { Box, Text, Button, Input },
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
      const { Box, Text, Button, Input } = $.ui.resolve(e)
      return Pane({
        ui: { Box, Text, Button, Input },
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
      if (sub === 'steer') {
        const text = args.slice(sub.length).trim()   // newlines inside the instruction survive
        const patternId = state.steering ?? state.cards[0]
        if (patternId === undefined || text === '') return { text: STEER_USAGE }
        steerSubmit(patternId, text)
        return { text: `ContextSaver: Claude will be told — ${text}` }
      }
      if (sub === 'demo' && isDebug) {
        // Debug-only: the pane's own look, without waiting for a real finding.
        for (const row of demoRows(state.turn)) dispatch({ type: 'row', row })
        const patterns = demoPatterns(state.turn)
        const fresh = patterns.filter(p => p.decision === null).map(p => p.id)
        dispatch({ type: 'judge.done', patterns, fresh, recurred: [], focus: null, spent: 0, error: null })
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
