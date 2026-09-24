import type { ModelForkResult, On, PaneOpenArgs, PluginOptions, RenderElement } from 'claude-code'

import { adoptRows } from './core/adopt'
import { demoForkUsage, demoPatterns, demoRows, demoTurns, demoUsage } from './core/demo'
import { buildPrompt, judgeAliases, merge, parseReply, shouldRun, spentOf, usageOf } from './core/judge'
import { rowOf } from './core/ledger'
import type { ToolEvent } from './core/ledger'
import { bandModel, debugDump, fromStored, mergeStored, paneModel, parseRegistry, reduce, toStored, usageLine } from './core/patterns'
import { appendedTo, bulletOnly, mergeSettings, propose } from './core/rules'
import { activeRuns, agentOf, journalPath, parseJournal, runOf } from './core/spawns'
import { collapseWs, duration, fit, instructionOf, pctOf } from './core/text'
import {
  AUTO_OPEN_MIN_COLUMNS, CLAUDE_MD_HEADING, COMMAND, DEBUG_MAX_DROPPED, JUDGE_MIN_ROWS, MAX_PATTERNS, PANE_ID,
  PANE_INLINE_ROWS, PANE_TITLE, PLUGIN_NAME, RUN_REFRESH_MS, STEER_RING_TRIES, STEER_RING_WAIT_MS, initialState,
} from './core/types'
import type { Action, Actions, Artifact, Choice, Run, State, Tokens, Ui } from './core/types'
import type { Host } from './host'
import { LANGUAGE_TAGS, say, setSay } from './say'
import { Band, Pane } from './ui'

const CONFIG_LANG_KEY = `${PLUGIN_NAME}.language`   // the `/config` row that picks the language
const ANSWER_HEAD = 100   // characters of the turn's answer kept as an evidence quote
const CARD_KIND = 60      // characters of a card's behaviour quoted back in a command's reply
const DEMO_CONTEXT = [120_000, 190_000, 250_000, 320_000]   // `/saver demo`: the window filling up to the sample's own 32%, so the trend draws

// What set one judge run going, as the debug log names it: the mid-turn cadence, the turn's end, the
// person, or a check armed at load over a transcript this plugin joined late.
type JudgeReason = 'tool.call' | 'turn.complete' | '/saver check' | 'load'

// The lanes the run answers out loud: the check the person typed, and the one the load armed for them.
const REQUESTED: readonly JudgeReason[] = ['/saver check', 'load']

/**
 * Registers ContextSaver: the ledger of every tool call, the judge that names wasteful
 * behaviours, the band and the pane that let the user fix or ignore them.
 *
 * @param on the engine's registrar
 * @param options what `/config` holds for this plugin; only `language` is read, and it is read
 *   here and nowhere else — writing that row reloads the module, so `register` runs again with the
 *   new value and there is nothing to keep in step.
 */
export function register(on: On, options: PluginOptions = {}): void {
  // Before anything else: the command's own words are read when it is registered, and every line the
  // pane draws is read when it is drawn, both of which happen under a hook below.
  setSay(options['language'])

  let state: State = initialState('', 0)
  let host: Host | null = null
  let isDebug = false
  // `judge.start` lands one clock read after the decision to run, and a storm of tool calls decides
  // inside that window: this flag is what stops a second fork of the same session.
  let forking = false
  // A check asked for while a run is in flight is answered by that run: cadence runs are frequent now,
  // and the person who pressed Check now would otherwise be told `already checking` and never told more.
  let asked = false
  // The load lane's one failure toast. Its arming survives every failure, so a toast per retry would be a
  // storm — but total silence reads exactly like a check that never fired, so the first failure speaks.
  let armedSpoke = false

  const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  // `focus` is a request, not a grant (d.ts 4915-4922): the surface hands the pane the keyboard only while
  // the prompt holds them over an empty composer, and refuses it otherwise — the pane opens either way.
  const paneArgs = (focus?: true): PaneOpenArgs =>
    focus === undefined
      ? { id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS }
      : { id: PANE_ID, title: PANE_TITLE, rows: PANE_INLINE_ROWS, focus }

  const savedToast = (before: State['saved']): void => {
    const ms = state.saved.ms - before.ms
    const pct = pctOf(state.saved.chars - before.chars, state.usage.window)
    const grew = [...(ms > 0 ? [`+${duration(ms)}`] : []), ...(pct > 0 ? [`+~${pct}%`] : [])]
    if (grew.length === 0) return
    host?.toast(say().command.savedToast(grew.join(' · ')))
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

  // A `/clear`, a `/saver reset` or a resume starts the session over: the closure flags that belong to
  // the session go with its state, so a new one may speak for its armed check again.
  const resetSession = (): void => {
    dispatch({ type: 'reset' })
    armedSpoke = false
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

  // An open the person asked for asks for their keyboard too, so the pane they just called up is the pane
  // they can type in; an unasked one interrupts whatever they were doing and never asks.
  const openPane = async (auto?: true): Promise<void> => {
    const engine = host
    if (engine === null) return
    await engine.openPane(auto === undefined ? paneArgs(true) : paneArgs())
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

  // The four counts a turn was billed, zero where no response came back to bill.
  const tokensOf = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | undefined): Tokens =>
    ({ input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0, cacheCreate: u?.cache_creation_input_tokens ?? 0 })

  // An `Agent` result names its loop, but the description it was given is the call's own argument, so the
  // value is handed over with it; every other tool's result is read as it came.
  const spawnValue = (e: ToolEvent, value: unknown): unknown =>
    e.tool === 'Agent' && typeof e.description === 'string' && typeof value === 'object' && value !== null
      ? { ...value, description: e.description }
      : value

  // One run's journal, read and folded in; a read that fails still stamps the run, so it is not retried at once.
  const readJournal = async (engine: Host, run: Run, now: number): Promise<void> => {
    const path = journalPath(run)
    if (path === null) return
    const entries = await engine.readFile(path).then(parseJournal).catch(() => [])
    dispatch({ type: 'run.journal', runId: run.id, entries, now })
  }

  // The journals of the runs still going, at most every RUN_REFRESH_MS each — every run's when forced: a
  // launch reads its own at once, and the judge reads them all before it asks. Never awaited from a hook.
  const refreshRuns = async (force: boolean): Promise<void> => {
    const engine = host
    if (engine === null || state.runs.length === 0) return
    const now = await engine.now()
    const due = force ? state.runs : activeRuns(state, now).filter(run => now - run.refreshedAt >= RUN_REFRESH_MS)
    await Promise.all(due.map(run => readJournal(engine, run, now)))
  }

  // What the run put in front of the user: a recurrence is news too, and it is the D4 moment this exists for.
  const checkedText = (queued: number): string =>
    queued === 0 ? say().command.nothingNew : say().command.found(queued)

  // A run that reported nothing: a cold snapshot, a refusal, or a failure of ours.
  const judgedNothing = (error: string): Action => ({
    type: 'judge.done', patterns: state.patterns, fresh: [], recurred: [], focus: null, time: null, context: null, spent: 0, error,
    returned: 0, kept: 0, dropped: [], usage: null,
  })

  // A run the person asked for answers them, whatever it found: silence is what a check must never be.
  // An armed check nobody asked for says it once, in its own words, since it will be retried: the first
  // failure names itself and the retries stay quiet.
  const failedToast = (reason: JudgeReason, failure: string): void => {
    if (reason === 'load' && !asked) {
      if (armedSpoke) return
      armedSpoke = true
      host?.toast(say().command.notCheckedYet(failure))
      return
    }
    if (REQUESTED.includes(reason) || asked) host?.toast(say().command.checkFailed(failure))
  }

  const judgeOnce = async (engine: Host, reason: JudgeReason): Promise<void> => {
    const requested = REQUESTED.includes(reason)
    const seq = state.seq
    const now = await engine.now()
    dispatch({ type: 'judge.start', now, seq })
    // AGENTS is read off the journals, so they are brought up to date once, here, before the prompt is built.
    await refreshRuns(true).catch(() => undefined)
    // One alias table for the run: the loops keep spawning while the fork thinks, and a new agent's first
    // row would renumber the `agent:aN` handles the reply cites against the AGENTS the prompt printed.
    const aliases = judgeAliases(state)
    let reply: ModelForkResult | null = null
    let failed: string | null = null
    try {
      reply = await engine.fork(buildPrompt(state, aliases))
    } catch (err) {
      failed = messageOf(err)
    }
    if (reply === null) {
      dispatch(judgedNothing(failed ?? 'cold snapshot'))
      failedToast(reason, failed ?? 'cold snapshot')
      return
    }
    try {
      const { findings, focus, time, context, dropped, returned } = parseReply(reply.text, state, aliases)
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
      failedToast(reason, messageOf(err))
    }
  }

  /**
   * Judges the session once, if no run is already in flight.
   *
   * @param reason what set this run going: the mid-turn cadence, the turn's end, the person, or the
   *   check a load armed. The two REQUESTED lanes are answered with a toast and open the pane wherever
   *   it can be drawn; a cadence run stays quiet and keeps the once-a-session, wide-terminal rule for
   *   opening itself — unless someone asks while it is in flight, in which case that run answers them.
   */
  async function runJudge(reason: JudgeReason): Promise<void> {
    const engine = host
    if (engine === null || forking || state.judge.running) return
    forking = true
    try {
      await judgeOnce(engine, reason)
    } finally {
      forking = false
      asked = false
    }
  }

  // A check armed at load consults no gate — `shouldRun` counts new work, and a session joined late has
  // all of its work behind it. The load fires this itself; every opportunity after it is a retry of a run
  // that came back with nothing. Answers whether it took this opportunity.
  const armedCheck = (): boolean => {
    if (!state.pendingCheck || state.judge.running) return false
    void runJudge('load').catch(() => undefined)
    return true
  }

  // The opportunities a run can start at: the armed check first, else the cadence's own count of new work.
  const judgeAt = (now: number, cadence: JudgeReason): void => {
    if (!armedCheck() && shouldRun(state, now)) void runJudge(cadence).catch(() => undefined)
  }

  const checkNow = (): string => {
    if (forking || state.judge.running) {
      // The run already going answers this ask: nothing is forked, and nobody is left without a reply.
      asked = true
      return say().command.alreadyChecking
    }
    void runJudge('/saver check').catch(() => undefined)
    return say().command.checking
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
    if (choice === 'keep') host?.toast(say().command.toastIgnored(p.kind))
    if (choice === 'kill') host?.toast(say().command.toastFixed(p.alternative))
    if (choice === 'steer') host?.toast(say().command.toastNoted(firstLine(text ?? '')))
    persist()
  }

  // The number the pane draws beside a card is its seat in `cards`; 0 means the card is no longer listed.
  const seatOf = (patternId: string): number => state.cards.indexOf(patternId) + 1

  const cardReply = (patternId: string, seat: number, tail: string): string => {
    const kind = state.patterns.find(q => q.id === patternId)?.kind ?? patternId
    return say().command.card(seat, fit(kind, CARD_KIND), tail)
  }

  const numberOf = (token: string): number | null => (/^\d+$/.test(token) ? Number(token) : null)

  // A number no card wears is a numbering mistake, whichever verb typed it: it is refused, never obeyed.
  const noCardText = (n: number): string => say().command.noCard(n, state.cards.length)

  // `/saver ignore 2` and `/saver fix 2` decide the card the pane numbers 2, and say which one they took.
  const decideByNumber = (choice: Choice, token: string): string => {
    if (state.cards.length === 0) return say().command.nothingToDecide
    const n = numberOf(token)
    if (n === null) return say().command.usage
    const patternId = state.cards[n - 1]
    if (patternId === undefined) return noCardText(n)
    const reply = cardReply(patternId, n, choice === 'keep' ? say().command.outcomeIgnored : say().command.outcomeFixed)
    decide(patternId, choice)
    return reply
  }

  const steerSubmit = (patternId: string, text: string): void => {
    const wanted = text.trim()
    if (wanted === '') {
      host?.toast(say().command.writeFirst)
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
      engine.toast(say().command.wrote(a.path))
    } catch (err) {
      engine.toast(messageOf(err))
    }
  }

  const tryArtifact = (a: Artifact): void => {
    dispatch({ type: 'standing.add', text: instructionOf(collapseWs(bodyOf(a.content)) || a.title) })
    dispatch({ type: 'artifact.done', patternId: a.patternId, kind: a.kind, written: true })
    host?.toast(say().command.trying(a.title))
  }

  // The key the pane draws a card's Fix… field under.
  const steerFieldKey = (patternId: string): string => `card:${patternId}:text`

  // The ring lands only on an element the drawn tree already holds ('no element of its own is drawn under that
  // key', d.ts 8846-8853), and a tree lands after the render hook that built it returns. The press that opens
  // the field asks for a redraw and nothing more, so the ask waits for the frame the field is drawn in, and
  // asks again while the engine answers that nothing is drawn under the key — a few frames, then it stops.
  const steerRing = async (patternId: string): Promise<void> => {
    const engine = host
    if (engine === null) return
    // `focus` is a request, not a grant (d.ts 4915-4922): the surface refuses it while the person holds an
    // element of ours, which the press that opened the field is — but where the composer holds the keys over
    // an empty line it is granted, and then `autoFocus` lands the ring on the field by itself.
    void engine.openPane(paneArgs(true)).catch(() => undefined)
    let denied = 'the ask was never answered'
    for (let tries = STEER_RING_TRIES; tries > 0; tries -= 1) {
      await engine.sleep(STEER_RING_WAIT_MS).catch(() => undefined)
      // The field was closed again, or another card's opened: this ring is nobody's now.
      if (state.steering !== patternId) return
      const deny = await engine
        .focusElement({ requestId: PANE_ID, key: steerFieldKey(patternId) })
        .then(result => result.deny ?? null)
        .catch(err => messageOf(err))
      if (deny === null) return
      denied = deny
    }
    // The ring stayed put, so the keystrokes are the composer's: the way in is the line the person is owed.
    engine.toast(say().command.composerHasKeys(seatOf(patternId)))
    if (isDebug) engine.log(`${PLUGIN_NAME}: the ring never reached ${steerFieldKey(patternId)} — ${denied}`)
  }

  const actions: Actions = {
    keep: patternId => decide(patternId, 'keep'),
    steer: patternId => {
      dispatch({ type: 'steer.begin', patternId })
      // A second press closed the field; only the press that opened one goes looking for the keyboard.
      if (state.steering === patternId) void steerRing(patternId)
    },
    // The pane's body is this hook's tree, so the redraw is what paints the keystroke; the text it draws
    // back is this one, which is also what `/saver fix` sends when the keyboard never reaches the field.
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
        sleep: ms => $.clock.sleep(ms),
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
        // The name and its subcommands are typed, so they never move; only what `/help` reads does.
        await engine.registerCommand({ ...COMMAND, description: say().command.description, argumentHint: say().command.argumentHint })
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
      // Too few rows to judge: a fresh session, nothing armed and nothing forked — which the log says too,
      // since a debug line that claims a check on three rows is worse than no line at all.
      const enough = state.rows.length >= JUDGE_MIN_ROWS
      if (isDebug) {
        const tail = enough ? 'checking them now' : `under the ${JUDGE_MIN_ROWS}-row floor, nothing to check`
        engine.log(`ContextSaver adopted ${adopted.length} rows from the transcript · ${tail}`)
      }
      if (!enough) return next(e)
      dispatch({ type: 'check.arm' })
      if (isDebug) engine.log(`ContextSaver fired a check over ${state.rows.length} adopted rows · armed, so a cold answer retries`)
      // Fired here, not left for the person's next keystroke: a session with this much history behind it has
      // run turns, and `$.model.fork` reads its last turn's cache-safe snapshot (d.ts 2019-2034) — which is
      // exactly what a `/reload-plugins`, an edit under `--plugin-dir` or a resume hands us (d.ts 3106-3111).
      // Detached, never awaited: this hook is awaited by the engine and has a budget, and the run speaks in a
      // toast, not in a return value. A snapshot that really is cold answers null, and the arming stays up
      // (§5.2) for the first warm opportunity below — the next prompt, the next tool call, or the turn's end.
      armedCheck()
      return next(e)
    } catch {
      return next(e)
    }
  })

  on('turn.start', async ($, e, next) => {
    try {
      // The clock dates the wait since the last answer, so TURNS can say the person was away.
      const now = host === null ? 0 : await host.now()
      dispatch({ type: 'turn.start', now })
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
      // A `Workflow` result is a run launched, an `Agent` result a loop named; a launch reads its journal at
      // once, and any run still going is re-read on the plugin's own cadence — detached, the call is answered.
      const run = runOf(result.result)
      if (run !== null) dispatch({ type: 'run.start', run, now: ended })
      const agent = agentOf(spawnValue(e, result.result))
      if (agent !== null) dispatch({ type: 'agent.start', ...agent })
      void refreshRuns(run !== null).catch(() => undefined)
      // One agentic turn can run for hours, so the cadence is judged here too, not only between turns.
      judgeAt(ended, 'tool.call')
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
      if (engine === null) return next(e)
      const u = e.usage
      // A subagent's turn is its loop's: what it cost and how it ended go onto the loop, and nothing else
      // moves — the window is the main loop's to sample, and so is the cadence.
      if (e.agentId !== undefined) {
        dispatch({ type: 'loop.turn', agentId: e.agentId, model: u?.model ?? null, ms: e.durationMs, tokens: tokensOf(u), ended: e.reason, turn: state.turn })
        return next(e)
      }
      // The window is sampled before the turn is recorded: how full it is after this turn is the turn's
      // own figure, and its growth over the last turns is the pace compaction actually runs at. The
      // sample is optional, though: a refused `session.usage` costs this turn its context reading, never
      // the turn itself — without the stat the trend, the pace and every token gate go with it.
      const seen = await engine.usage().catch(() => null)
      const now = await engine.now()
      dispatch({
        type: 'turn.complete',
        stat: {
          ...tokensOf(u),
          ms: e.durationMs,
          answerChars: e.answer.length,
          answerHead: e.answer.slice(0, ANSWER_HEAD),
          aborted: e.isAborted,
          ended: e.reason,
          at: now,
          idleMs: 0,
          context: seen?.context.tokens ?? null,
        },
      })
      if (seen !== null) dispatch({ type: 'usage', usage: { window: seen.context.window, tokens: seen.context.tokens, percent: seen.context.percent }, now })
      judgeAt(now, 'turn.complete')
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
      if (extra.length > 0) dispatch({ type: 'notes.drained' })
      const carried = extra.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...extra] }
      // A prompt is no new work, so there is no cadence lane here: only a check still armed fires — the load
      // fired its own, so this is the retry of one that came back cold — and it never changes what the
      // prompt carries.
      armedCheck()
      return next(carried)
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const engine = host
    try {
      if (engine === null || e.props.hasSurvey || e.surface === 'mobile') return next(e)
      if (e.props.bodyColumns !== state.columns) observe({ type: 'columns', columns: e.props.bodyColumns })
    } catch {
      return next(e)
    }
    // Drawn once: a band we cannot build answers with what is beneath it, never with a second dispatch.
    const below: RenderElement = await next(e)
    // The clock, read once per draw: the newest reading the state holds is a turn's end or a run's launch, so
    // a loopless run would read as fresh for the rest of a quiet session. A host that will not say the time
    // leaves the band that newest reading of its own rather than undrawn.
    const now = await engine.now().catch(() => null)
    try {
      const { Box, Text, Button, Input, Raster } = $.ui.resolve(e) as unknown as Ui
      const band = Band({
        ui: { Box, Text, Button, Input, Raster },
        model: now === null ? bandModel(state) : bandModel(state, now),
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
        return { text: state.paneOpen ? say().command.paneShown : say().command.paneHidden }
      }
      if (sub === 'check') return { text: checkNow() }
      if (sub === 'fix') {
        const rest = args.slice(sub.length).trim()   // newlines inside the instruction survive
        const [first = ''] = rest.split(/\s+/)
        // A leading number is always the card: folding a mistyped one back into the instruction would
        // fix the wrong card with a garbled sentence, and `standing` keeps it for the whole session.
        const n = numberOf(first)
        if (state.cards.length === 0) return { text: say().command.nothingToDecide }
        if (n !== null && (n < 1 || n > state.cards.length)) return { text: noCardText(n) }
        const text = (n === null ? rest : rest.slice(first.length)).trim()
        // Nothing after the number sends the fix the card already offers; a note sends the note instead.
        if (text === '') return { text: n === null ? say().command.fixUsage : decideByNumber('kill', first) }
        const patternId = n === null ? (state.steering ?? state.cards[0]) : state.cards[n - 1]
        const seat = patternId === undefined ? 0 : seatOf(patternId)
        if (patternId === undefined || seat === 0) return { text: say().command.fixUsage }
        steerSubmit(patternId, text)
        return { text: cardReply(patternId, seat, say().command.outcomeNoted(text)) }
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
        return { text: say().command.demoLoaded }
      }
      if (sub === 'debug') return { text: debugDump(state, armedSpoke) }
      if (sub === 'reset') {
        resetSession()
        return { text: say().command.reset }
      }
      return { text: say().command.usage }
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: ['clear', 'resume'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      resetSession()
    } catch {
      // the command ran either way: it is not ours to run a second time
    }
    return result
  })

  // The languages there are, rather than the ones the manifest happened to list when it was written: a
  // row's options cannot be rewritten here (`ConfigDescribeResult` omits them), but its label and its help
  // can, so a language added to `LANGUAGES` shows up in the menu's help at once — and the row reads in the
  // language already chosen, which is the one place a person checks after changing it.
  on('config.describe', { key: CONFIG_LANG_KEY }, async (_$, e, next) =>
    next({
      ...e,
      label: say().config.languageLabel,
      description: `${e.description ?? ''} ${say().config.languageAvailable(LANGUAGE_TAGS)}`.trim(),
    }),
  )

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
