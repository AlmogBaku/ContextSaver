import { describe, expect, mock, test } from 'claude-code/testing'

import type { RenderPropsOf } from 'claude-code'

import { Band, Pane } from '../hooks/ui'
import { gauge } from '../hooks/core/text'
import type { Actions, PaneModel, Site, Ui } from '../hooks/core/types'
import { awaitingPane } from './fixtures/ui/awaiting-pane'
import { bandFull } from './fixtures/ui/band-full'
import { bandQuiet } from './fixtures/ui/band-quiet'
import { checkingPane } from './fixtures/ui/checking-pane'
import { decidedPane } from './fixtures/ui/decided-pane'
import { draftPane } from './fixtures/ui/draft-pane'
import { emptyPane } from './fixtures/ui/empty-pane'
import { expandedPane } from './fixtures/ui/expanded-pane'
import { millionPane } from './fixtures/ui/million-pane'
import { overrunPane } from './fixtures/ui/overrun-pane'
import { steeringPane } from './fixtures/ui/steering-pane'
import { twoWasters } from './fixtures/ui/two-wasters'

const DRAWER = 'test'                 // the plugin the kit stamps on a tree the test's own `on` drew
const BAND_SITE: Site = { bodyColumns: 100, maxRows: 8 }
const PANE_SITE: Site = { bodyColumns: 60, maxRows: 30 }
const WIDE_SITE: Site = { bodyColumns: 100, maxRows: 30 }
const FIRST = 'execution:full-suite'
const ACCENT = 'suggestion'           // the theme key ui.tsx draws its one accent in
const BAND_RESERVE = 4                // cells ui.tsx leaves the engine's own collapse control '[-]'
const DOCK_GAUGE = 16                 // the gauge's cells at every width the header holds them
const PINCHED_GAUGE = 12              // and what is left of it once the body is 26 columns
const FIX = 'run only the tests covering the files you changed; run the full suite once when the phase is done'

// The trees are hosted on `CommandOutput`, the one render component the plugin never hooks: the
// test's own `on` sits beneath every plugin, so the plugin's own `AbovePrompt` and `Pane` hooks
// (WP6) would otherwise draw over every tree here and swallow every press. The props the two
// surfaces really hand a hook stay exercised by the envelope test, typed against the engine's own
// table so a change of shape fails the type-check rather than a rendered assertion.
const HOST_PROPS = { command: 'saver', args: '', text: '', isErrored: false } as const
const PANE_HOST = { surface: 'terminal', component: 'CommandOutput', requestId: 'wp4-pane', props: HOST_PROPS } as const
const DRAFT_HOST = { ...PANE_HOST, requestId: 'wp4-draft' }
const NARROW_HOST = { ...PANE_HOST, requestId: 'wp4-narrow' }
const BAND_HOST = { ...PANE_HOST, requestId: 'wp4-band' }
const BAND_PROPS: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 }, view: {} }
const PANE_PROPS: RenderPropsOf['Pane'] = { title: 'ContextSaver', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }

type Node = {
  type?: string
  props?: Record<string, unknown>
  children?: unknown
  onEvent?: (e: { kind: 'change' | 'submit'; value: string }) => void   // the Input's own handlers, before the engine hosts them
}
type Call = { name: string; arg: unknown }

const kidsOf = (node: Node): unknown[] =>
  node.children === undefined ? [] : Array.isArray(node.children) ? node.children : [node.children]

const nodesOf = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(nodesOf)
  if (typeof value !== 'object' || value === null) return []
  const node = value as Node
  return [node, ...kidsOf(node).flatMap(nodesOf)]
}

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (typeof value !== 'object' || value === null) return ''
  const node = value as Node
  const label = node.props?.label
  const held = node.props?.value
  const own = typeof label === 'string' ? label : typeof held === 'string' ? held : ''
  return `${own}${kidsOf(node).map(textOf).join('')}`
}

const drawnRows = (tree: unknown): string[] =>
  nodesOf(tree)
    .flatMap(node => {
      if (node.type === 'Button' || node.type === 'Input') return [textOf(node)]
      if (node.type !== 'Text') return []
      const kids = kidsOf(node)
      return kids.every(kid => typeof kid === 'string') ? [kids.join('')] : []
    })
    .filter(text => text !== '')

const keysOf = (tree: unknown): string[] =>
  nodesOf(tree)
    .filter(node => node.type === 'Button' || node.type === 'Input')
    .map(node => String(node.props?.key))

const inputValueOf = (tree: unknown, key: string): unknown =>
  nodesOf(tree).find(node => node.type === 'Input' && node.props?.key === key)?.props?.value

const holds = (tree: unknown, part: string): boolean => nodesOf(tree).some(node => textOf(node).includes(part))

// Every framed block, outermost first: the cards and the empty state's own quiet frame.
const framesOf = (tree: unknown): Node[] =>
  nodesOf(tree).filter(node => node.type === 'Box' && node.props?.borderStyle === 'round')

const cellsOf = (value: unknown): number => {
  if (typeof value === 'string') return value.length
  if (typeof value !== 'object' || value === null) return 0
  const node = value as Node
  if (node.type === 'Button') return textOf(node).length
  if (node.type === 'Input') return 0                       // the field takes what the row has left
  const props = node.props ?? {}
  const number = (name: string): number => (typeof props[name] === 'number' ? Number(props[name]) : 0)
  const kids = kidsOf(node)
  const inline = node.type === 'Text' || props.flexDirection !== 'column'
  const inner = inline
    ? kids.reduce<number>((sum, kid) => sum + cellsOf(kid), 0) + number('gap') * Math.max(0, kids.length - 1)
    : kids.reduce<number>((widest, kid) => Math.max(widest, cellsOf(kid)), 0)
  const chrome = 2 * number('paddingX') + number('paddingLeft') + number('paddingRight')
    + (typeof props.borderStyle === 'string' ? 2 : 0)
  // A Box's own width already holds its padding and its border (Yoga's box model); one without a
  // width takes what its children need plus that chrome.
  return typeof props.width === 'number' ? Number(props.width) : inner + chrome
}

const controlCells = (value: unknown): number =>
  nodesOf(value)
    .filter(node => node.type === 'Button' || node.type === 'Input')
    .reduce<number>((sum, node) => sum + textOf(node).length, 0)

// What a child of a sized row claims: its own width when it has one, else the labels of the controls
// inside it (its text truncates, a Button does not).
const claimOf = (kid: unknown): number => {
  if (typeof kid !== 'object' || kid === null) return 0
  const node = kid as Node
  return typeof node.props?.width === 'number' ? cellsOf(node) : controlCells(node)
}

// Every row that seats a control at its right edge sizes itself: the row's own width against what its
// sized children and its controls claim. An overflow here is a clipped control on the real surface.
const overrun = (value: unknown): number[] =>
  nodesOf(value)
    .filter(node => node.type === 'Box' && typeof node.props?.width === 'number' && node.props?.flexDirection !== 'column')
    .flatMap(node => {
      const width = Number(node.props?.width)
      const gap = typeof node.props?.gap === 'number' ? Number(node.props.gap) : 0
      const kids = kidsOf(node)
      const inner = kids.reduce<number>((sum, kid) => sum + claimOf(kid), 0) + gap * Math.max(0, kids.length - 1)
      return inner > width ? [inner - width] : []
    })

// Rows a tree draws: a column adds its children up, a row is as tall as its tallest child, and every
// Text truncates to one. An overflow here is a drawing the inline seat clips from the bottom.
const rowsOf = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce<number>((sum, kid) => sum + rowsOf(kid), 0)
  if (typeof value !== 'object' || value === null) return 0
  const node = value as Node
  if (node.type === 'Text' || node.type === 'Button' || node.type === 'Input') return 1
  const props = node.props ?? {}
  if (typeof props.height === 'number') return Number(props.height)
  const kids = kidsOf(node)
  const inner = props.flexDirection === 'column'
    ? kids.reduce<number>((sum, kid) => sum + rowsOf(kid), 0)
    : kids.reduce<number>((tallest, kid) => Math.max(tallest, rowsOf(kid)), 0)
  return inner + (typeof props.borderStyle === 'string' ? 2 : 0)
}

const recorder = (): { calls: Call[]; actions: Actions } => {
  const calls: Call[] = []
  const record = (name: string) => (arg?: unknown) => { calls.push({ name, arg }) }
  return {
    calls,
    actions: {
      keep: record('keep'),
      steer: record('steer'),
      steerDraft: record('steerDraft'),
      steerSubmit: (patternId: string, text: string) => { calls.push({ name: 'steerSubmit', arg: `${patternId}|${text}` }) },
      kill: record('kill'),
      info: record('info'),
      togglePane: record('togglePane'),
      check: record('check'),
      write: record('write'),
      tryOnce: record('tryOnce'),
      skip: record('skip'),
    },
  }
}

describe('ui', () => {
  test('the band draws every segment that carries something and toggles the pane', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Band({ ui: $.ui.resolve(e), model: bandFull, site: BAND_SITE, actions }))

    const tree = await $.ui.render(BAND_HOST)

    expect(holds(tree, 'ContextSaver')).toEqual(true)
    expect(holds(tree, '29%')).toEqual(true)
    expect(holds(tree, '133k to compaction')).toEqual(true)
    expect(holds(tree, '2 new')).toEqual(true)
    expect(holds(tree, 'saved ~3%')).toEqual(true)
    expect(keysOf(tree)).toEqual(['toggle'])
    expect(drawnRows(tree)).toContain('Open')
    expect(cellsOf(tree)).toEqual(BAND_SITE.bodyColumns - BAND_RESERVE)   // the engine's '[-]' draws past them
    expect(overrun(tree)).toEqual([])

    await $.ui.press({ plugin: DRAWER, key: 'toggle' })
    await clock.settle()
    expect(calls).toEqual([{ name: 'togglePane', arg: undefined }])
  })

  test('the band omits the segments that are zero or unknown', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Band({ ui: $.ui.resolve(e), model: bandQuiet, site: BAND_SITE, actions }))

    const tree = await $.ui.render(BAND_HOST)

    expect(drawnRows(tree)).toEqual(['ContextSaver', 'Close'])
    expect(holds(tree, '·')).toEqual(false)
  })

  test('the empty pane is one quiet frame, and Check now stays in the header', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: emptyPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const frames = framesOf(tree)

    expect(drawnRows(tree)).toContain('Watching quietly. Nothing repeating yet.')
    expect(frames, 'one frame, and it is dim').toHaveLength(1)
    expect(frames[0]?.props?.borderDimColor).toEqual(true)
    expect(frames[0]?.props?.borderColor).toEqual(undefined)
    expect(keysOf(tree), 'the judge button is the header\'s, never repeated').toEqual(['check'])
    expect(holds(tree, 'Check now')).toEqual(true)

    await $.ui.press({ plugin: DRAWER, key: 'check' })
    await clock.settle()
    expect(calls).toEqual([{ name: 'check', arg: undefined }])
  })

  test('two wasters draw their stats and their three verbs', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: twoWasters, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)

    expect(holds(tree, 'bun test suite')).toEqual(true)
    expect(holds(tree, 'api logs')).toEqual(true)
    expect(holds(tree, '3× · ~9% context')).toEqual(true)
    expect(holds(tree, '2× · ~20% context')).toEqual(true)
    expect(drawnRows(tree), 'the fix is drawn behind its own glyph').toContain('→')
    expect(drawnRows(tree).some(row => row.startsWith(FIX.slice(0, 28))), 'the fix has a row of its own').toEqual(true)
    expect(keysOf(tree)).toEqual([
      'check',
      `card:${FIRST}:info`, `card:${FIRST}:keep`, `card:${FIRST}:steer`, `card:${FIRST}:kill`,
      'card:reading:api-logs:info', 'card:reading:api-logs:keep', 'card:reading:api-logs:steer', 'card:reading:api-logs:kill',
    ])

    await $.ui.press({ plugin: DRAWER, key: `card:${FIRST}:kill` })
    await $.ui.press({ plugin: DRAWER, key: 'card:reading:api-logs:keep' })
    await clock.settle()
    expect(calls).toEqual([{ name: 'kill', arg: FIRST }, { name: 'keep', arg: 'reading:api-logs' }])
  })

  test('the newest waster is framed in the accent and the ones behind it are dim', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: twoWasters, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const frames = framesOf(tree)

    expect(frames, 'one frame per waster').toHaveLength(2)
    expect(frames[0]?.props?.borderColor).toEqual(ACCENT)
    expect(frames[0]?.props?.borderDimColor).toEqual(undefined)
    expect(frames[1]?.props?.borderDimColor).toEqual(true)
    expect(frames[1]?.props?.borderColor).toEqual(undefined)
    expect(frames.every(frame => frame.props?.paddingX === 2), 'both cards are padded').toEqual(true)
  })

  test('the judge button dims to checking… while the judge runs', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: checkingPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const button = nodesOf(tree).find(node => node.props?.key === 'check')

    expect(button?.props?.label).toEqual('checking…')
    expect(button?.props?.dimColor).toEqual(true)
  })

  test('the header degrades its own rows instead of cutting a number', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      const { Box } = resolved
      return <Box />
    })

    await $.ui.render(PANE_HOST)

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the pane drew no elements')
    const at = (bodyColumns: number, model = twoWasters): unknown =>
      Pane({ ui, model, site: { bodyColumns, maxRows: 30 }, placement: 'dock', actions })

    const wide = at(80)
    expect(drawnRows(wide)).toContain('Context')
    expect(holds(wide, gauge(64, DOCK_GAUGE))).toEqual(true)
    expect(holds(wide, '64%')).toEqual(true)
    expect(holds(wide, '41k tokens to compaction · about 6 turns')).toEqual(true)
    expect(holds(wide, 'Saved ~3% · 3m')).toEqual(true)
    expect(holds(wide, 'Judge 2 runs · 7.4k')).toEqual(true)
    expect(holds(wide, '1.2%')).toEqual(false)                            // the share is a developer metric

    const dock = at(56)
    expect(holds(dock, gauge(64, DOCK_GAUGE)), 'the gauge is the same at every docked width').toEqual(true)
    expect(holds(dock, '41k tokens to compaction · about 6 turns')).toEqual(true)
    expect(holds(dock, 'Judge 2 runs · 7.4k')).toEqual(true)
    expect(holds(dock, 'Check now')).toEqual(true)
    expect(cellsOf(dock), 'every header row fits the body at 56 columns').toBeLessThanOrEqual(56)
    expect(overrun(dock)).toEqual([])

    const tight = at(40)
    expect(holds(tight, gauge(64, DOCK_GAUGE)), 'the gauge is 16 cells at every width that holds it').toEqual(true)
    expect(holds(tight, '41k tokens to compaction')).toEqual(true)
    expect(holds(tight, 'about 6 turns'), 'the run in turns is dropped whole').toEqual(false)
    expect(holds(tight, 'Judge'), 'the judge is the first segment to go').toEqual(false)
    expect(holds(tight, 'Saved ~3% · 3m')).toEqual(true)

    const narrowest = at(26)
    expect(holds(narrowest, gauge(64, PINCHED_GAUGE)), 'the gauge gives cells back before anything else').toEqual(true)

    const past = at(80, overrunPane)
    expect(holds(past, 'to compaction')).toEqual(false)   // the run went negative once the threshold passed
    expect(holds(past, '~0%')).toEqual(false)
    expect(holds(past, 'Saved 3m')).toEqual(true)

    const million = at(70, millionPane)
    expect(holds(million, '914k tokens to compaction · about 33 turns')).toEqual(true)
    const cramped = at(40, millionPane)
    expect(holds(cramped, '914k tokens to compaction')).toEqual(true)
    expect(holds(cramped, 'about 33 turns')).toEqual(false)
    const pinched = at(26, millionPane)
    expect(holds(pinched, '914'), 'the figure is dropped whole, never cut mid-number').toEqual(false)
  })

  test('before the first turn the header says so instead of drawing an empty gauge', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: awaitingPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)

    expect(drawnRows(tree)).toContain('Context')
    expect(holds(tree, 'awaiting the first turn')).toEqual(true)
    expect(holds(tree, '░')).toEqual(false)
    expect(holds(tree, 'Judge 1 run · 7.4k')).toEqual(true)
  })

  test('i opens why, fix, what Kill sends and the evidence in place', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: expandedPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const texts = drawnRows(tree)

    expect(texts).toContain('why')
    expect(texts).toContain('fix')
    expect(texts).toContain('kill →')
    expect(texts).toContain('evidence')
    expect(holds(tree, '"Stop this behaviour for the rest')).toEqual(true)
    expect(texts.filter(text => text.startsWith('r4') || text.startsWith('r5')).length).toEqual(3)
    expect(holds(tree, '3× · ~9% context')).toEqual(false)

    await $.ui.press({ plugin: DRAWER, key: `card:${FIRST}:info` })
    await clock.settle()
    expect(calls).toEqual([{ name: 'info', arg: FIRST }])
  })

  test('Steer opens a field holding the fix, and the draft is drawn back', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({
        ui: $.ui.resolve(e),
        model: e.requestId === DRAFT_HOST.requestId ? draftPane : steeringPane,
        site: WIDE_SITE,
        placement: 'dock',
        actions,
      }))

    const open = await $.ui.render(PANE_HOST)

    expect(keysOf(open)).toContain(`card:${FIRST}:text`)
    expect(inputValueOf(open, `card:${FIRST}:text`)).toEqual(FIX)
    expect(holds(open, 'Enter sends')).toEqual(true)
    expect(holds(open, 'longer: /saver steer in the prompt')).toEqual(true)
    expect(keysOf(open)).toContain(`card:${FIRST}:keep`)

    const drafted = await $.ui.render(DRAFT_HOST)

    expect(inputValueOf(drafted, `card:${FIRST}:text`)).toEqual(draftPane.steerDraft)

    await $.ui.press({ plugin: DRAWER, key: `card:${FIRST}:steer`, requestId: DRAFT_HOST.requestId })
    await clock.settle()
    expect(calls).toEqual([{ name: 'steer', arg: FIRST }])
  })

  test('the Steer field hands every keystroke and the sent text to the actions', async ($, on) => {
    const { calls, actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      return Pane({ ui: resolved, model: draftPane, site: PANE_SITE, placement: 'dock', actions })
    })

    await $.ui.render(PANE_HOST)

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the pane drew no elements')
    const field = nodesOf(Pane({ ui, model: draftPane, site: PANE_SITE, placement: 'dock', actions }))
      .find(node => node.type === 'Input')

    field?.onEvent?.({ kind: 'change', value: 'only the auth tests' })
    field?.onEvent?.({ kind: 'submit', value: 'only the auth tests' })

    expect(calls).toEqual([
      { name: 'steerDraft', arg: 'only the auth tests' },
      { name: 'steerSubmit', arg: `${FIRST}|only the auth tests` },
    ])
  })

  test('the inline pane keeps the newest waster and folds the rest into one line each', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({
        ui: $.ui.resolve(e),
        model: decidedPane,
        site: e.requestId === NARROW_HOST.requestId ? PANE_SITE : WIDE_SITE,
        placement: 'inline',
        actions,
      }))

    const tree = await $.ui.render(PANE_HOST)

    expect(drawnRows(tree)).toContain('Context')
    expect(holds(tree, '41k tokens to compaction')).toEqual(true)
    expect(holds(tree, 'Judge')).toEqual(false)
    expect(holds(tree, 'Check now')).toEqual(false)
    expect(keysOf(tree)).toEqual([`card:${FIRST}:info`, `card:${FIRST}:keep`, `card:${FIRST}:steer`, `card:${FIRST}:kill`])
    expect(framesOf(tree), 'the compact card keeps its frame').toHaveLength(1)
    expect(holds(tree, '● Claude keeps reading 2000 lines of api logs')).toEqual(true)
    expect(holds(tree, 'api logs instead of grepping for the error · 2×')).toEqual(true)
    expect(holds(tree, 'Decided 2 · Rules 1 · /saver for the full pane')).toEqual(true)

    const narrow = await $.ui.render(NARROW_HOST)

    expect(holds(narrow, '· 2×')).toEqual(true)                                 // the count outlives the title
    expect(holds(narrow, 'grepping for the error · 2×')).toEqual(false)
  })

  test('no row runs past the body at the docked and the inline widths', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      const { Box } = resolved
      return <Box />
    })

    await $.ui.render(PANE_HOST)

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the pane drew no elements')
    for (const model of [emptyPane, twoWasters, expandedPane, steeringPane, decidedPane, overrunPane, awaitingPane, millionPane]) {
      for (const columns of [40, 56, 70, 80, 100, 120]) {
        const site = { bodyColumns: columns, maxRows: 30 }
        const dock = Pane({ ui, model, site, placement: 'dock', actions })
        const inline = Pane({ ui, model, site, placement: 'inline', actions })
        const band = Band({ ui, model: bandFull, site, actions })
        expect(cellsOf(dock), `dock ${columns}`).toBeLessThanOrEqual(columns)
        expect(cellsOf(inline), `inline ${columns}`).toBeLessThanOrEqual(columns)
        expect(cellsOf(band), `band ${columns}`).toBeLessThanOrEqual(columns - BAND_RESERVE)
        expect(overrun(dock), `dock ${columns} controls`).toEqual([])
        expect(overrun(inline), `inline ${columns} controls`).toEqual([])
        expect(overrun(band), `band ${columns} controls`).toEqual([])
      }
    }
  })

  test('the inline pane is budgeted against the seat, and a verb is never what gets cut', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      const { Box } = resolved
      return <Box />
    })

    await $.ui.render(PANE_HOST)

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the pane drew no elements')
    // The worst case the seat ever holds: the details open behind i and the Steer field open under them.
    const busiest: PaneModel = { ...expandedPane, steering: expandedPane.expanded }
    const models: PaneModel[] = [emptyPane, twoWasters, expandedPane, steeringPane, busiest, decidedPane]
    for (const model of models) {
      for (const seat of [14, 16, 18]) {
        for (const columns of [56, 100, 160]) {
          const site = { bodyColumns: columns, maxRows: seat }
          const inline = Pane({ ui, model, site, placement: 'inline', actions })
          expect(rowsOf(inline), `inline ${columns}x${seat}`).toBeLessThanOrEqual(seat)
        }
      }
      if (model === emptyPane) continue
      // However little the surface grants, the three verbs are drawn: detail is what the budget drops.
      const cramped = Pane({ ui, model, site: { bodyColumns: 100, maxRows: 10 }, placement: 'inline', actions })
      expect(drawnRows(cramped), 'Keep survives a cramped seat').toContain('Keep')
      expect(drawnRows(cramped), 'Steer survives a cramped seat').toContain('Steer')
      expect(drawnRows(cramped), 'Kill survives a cramped seat').toContain('Kill')
    }
    const opened = drawnRows(Pane({ ui, model: expandedPane, site: { bodyColumns: 100, maxRows: 14 }, placement: 'inline', actions }))
    expect(opened.indexOf('Keep'), 'the verbs are drawn above the details, so a clipped seat costs detail')
      .toBeLessThan(opened.indexOf('why'))
  })

  test('the footer lists the decisions and the rules, and Write hands back the artifact', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: decidedPane, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const texts = drawnRows(tree)

    expect(texts).toContain('Decided')
    expect(texts).toContain('Rules for next session')
    expect(texts).toContain('↪ re-reading src/auth.ts')
    expect(texts).toContain('saved ~1%')
    expect(texts).toContain('✕ re-summarising the plan every turn')
    expect(texts).toContain('ignored 1×')
    expect(holds(tree, 'Re-read only after edits · CLAUDE.md')).toEqual(true)
    expect(keysOf(tree)).toContain('write:reading:re-read')
    expect(keysOf(tree)).toContain('try:reading:re-read')
    expect(keysOf(tree)).toContain('skip:reading:re-read')

    await $.ui.press({ plugin: DRAWER, key: 'write:reading:re-read' })
    await $.ui.press({ plugin: DRAWER, key: 'try:reading:re-read' })
    await $.ui.press({ plugin: DRAWER, key: 'skip:reading:re-read' })
    await clock.settle()
    expect(calls).toEqual([
      { name: 'write', arg: decidedPane.artifacts[0] },
      { name: 'tryOnce', arg: decidedPane.artifacts[0] },
      { name: 'skip', arg: decidedPane.artifacts[0] },
    ])
  })

  test('the band and the pane draw from the props their own surfaces hand a render hook', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      const { Box } = resolved
      return <Box />
    })

    await $.ui.render(PANE_HOST)

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the pane drew no elements')
    const band = Band({
      ui,
      model: bandFull,
      site: { bodyColumns: BAND_PROPS.bodyColumns, maxRows: BAND_PROPS.maxRows },
      actions,
    })
    const pane = Pane({
      ui,
      model: twoWasters,
      site: { bodyColumns: PANE_PROPS.bodyColumns, maxRows: PANE_PROPS.scroll.bodyRows },
      placement: PANE_PROPS.placement,
      actions,
    })

    expect(holds(band, 'ContextSaver')).toEqual(true)
    expect(holds(band, '133k to compaction')).toEqual(true)
    expect(cellsOf(band)).toBeLessThanOrEqual(BAND_PROPS.bodyColumns)
    expect(holds(pane, 'Context')).toEqual(true)
    expect(holds(pane, 'bun test suite')).toEqual(true)
    expect(drawnRows(pane)).toContain('Keep')
    expect(cellsOf(pane)).toBeLessThanOrEqual(PANE_PROPS.bodyColumns)
  })
})
