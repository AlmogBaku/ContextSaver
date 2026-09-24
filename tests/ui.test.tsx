import { describe, expect, mock, test } from 'claude-code/testing'

import type { RenderPropsOf } from 'claude-code'

import { Band, Pane } from '../hooks/ui'
import { logoCells } from '../hooks/core/logo'
import { gauge } from '../hooks/core/text'
import { sparkline } from '../hooks/core/trend'
import type { Actions, BandModel, PaneModel, Site, Ui } from '../hooks/core/types'
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, setSay } from '../hooks/say'
import { awaitingPane } from './fixtures/ui/awaiting-pane'
import { bandChecking } from './fixtures/ui/band-checking'
import { bandFound } from './fixtures/ui/band-found'
import { bandSaved } from './fixtures/ui/band-saved'
import { bandWatching } from './fixtures/ui/band-watching'
import { chattyPane } from './fixtures/ui/chatty-pane'
import { checkingPane } from './fixtures/ui/checking-pane'
import { decidedPane } from './fixtures/ui/decided-pane'
import { draftPane } from './fixtures/ui/draft-pane'
import { emptyPane } from './fixtures/ui/empty-pane'
import { expandedPane } from './fixtures/ui/expanded-pane'
import { fillingPane } from './fixtures/ui/filling-pane'
import { fullPane } from './fixtures/ui/full-pane'
import { manyWasters } from './fixtures/ui/many-wasters'
import { millionPane } from './fixtures/ui/million-pane'
import { overrunPane } from './fixtures/ui/overrun-pane'
import { quietPane } from './fixtures/ui/quiet-pane'
import { steeringPane } from './fixtures/ui/steering-pane'
import { twoWasters } from './fixtures/ui/two-wasters'

const DRAWER = 'test'                 // the plugin the kit stamps on a tree the test's own `on` drew
const BAND_SITE: Site = { bodyColumns: 100, maxRows: 8 }
const PANE_SITE: Site = { bodyColumns: 60, maxRows: 30 }
const WIDE_SITE: Site = { bodyColumns: 100, maxRows: 30 }
const FIRST = 'execution:full-suite'
const TONES = { accent: 'suggestion', good: 'success', warm: 'warning', hot: 'error' } as const
const BAND_RESERVE = 4                // cells ui.tsx leaves the engine's own collapse control '[-]'
const WIDE_GAUGE = 30                 // the gauge's cells wherever the header can spare them
const DOCK_GAUGE = 29                 // and what is left of it beside the mark at 60 body columns
const PINCHED_GAUGE = 18              // and once the body is 26 columns and the trend has gone
const TREND = sparkline(twoWasters.header.trend, 10)
const FIX = 'run only the tests covering the files you changed; run the full suite once when the phase is done'
const GLYPH_FIELD = '›'               // the glyph leading the Fix… field's own row

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
  // What a person reads in a field: its text, or the placeholder the surface draws dim while it is empty.
  const held = node.props?.value === '' ? node.props?.placeholder : node.props?.value
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

const placeholderOf = (tree: unknown, key: string): unknown =>
  nodesOf(tree).find(node => node.type === 'Input' && node.props?.key === key)?.props?.placeholder

const holds = (tree: unknown, part: string): boolean => nodesOf(tree).some(node => textOf(node).includes(part))

// A cited call is one Text of dim and plain segments, so it is read whole rather than segment by segment.
const citedCalls = (tree: unknown): string[] => nodesOf(tree).map(textOf).filter(text => /^turn \d+ {2,}\S/.test(text))

// Every framed block, outermost first: the cards and the empty state's own quiet frame.
const framesOf = (tree: unknown): Node[] =>
  nodesOf(tree).filter(node => node.type === 'Box' && node.props?.borderStyle === 'round')

const cellsOf = (value: unknown): number => {
  if (typeof value === 'string') return value.length
  if (typeof value !== 'object' || value === null) return 0
  const node = value as Node
  if (node.type === 'Button') return textOf(node).length
  if (node.type === 'Raster') return Number(node.props?.columns ?? 0)
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
  if (node.type === 'Raster') return cellsOf(node)          // a fixed grid of cells claims every one of them
  return typeof node.props?.width === 'number' ? cellsOf(node) : controlCells(node)
}

// Where every drawn row ends on the real surface: its own cells, plus the padding, the borders and the
// siblings before it that each ancestor already spent. A row past `bodyColumns` pokes through the frame
// the pane draws — which is what a wrapped card title did at 160 columns. A row seated at its parent's
// right edge is measured from the left, so this under-reports rather than inventing an overflow;
// `overrun` is what holds those rows to their width.
const rowEnds = (value: unknown, indent: number): number[] => {
  if (typeof value === 'string') return value === '' ? [] : [indent + value.length]
  if (Array.isArray(value)) return value.flatMap(kid => rowEnds(kid, indent))
  if (typeof value !== 'object' || value === null) return []
  const node = value as Node
  const props = node.props ?? {}
  const number = (name: string): number => (typeof props[name] === 'number' ? Number(props[name]) : 0)
  const edge = number('paddingX') + (typeof props.borderStyle === 'string' ? 1 : 0)
  const left = indent + edge + number('paddingLeft')
  const right = edge + number('paddingRight')
  if (node.type !== 'Box') return [left + cellsOf(node) + right]
  const kids = kidsOf(node)
  if (props.flexDirection === 'column') return kids.flatMap(kid => rowEnds(kid, left)).map(end => end + right)
  return kids.reduce<{ at: number; ends: number[] }>(
    (acc, kid) => ({
      at: acc.at + cellsOf(kid) + number('gap'),
      ends: [...acc.ends, ...rowEnds(kid, acc.at).map(end => end + right)],
    }),
    { at: left, ends: [] },
  ).ends
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
  if (node.type === 'Raster') return Number(node.props?.rows ?? 0)
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
  test('the band teases what is waiting and toggles the pane', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Band({ ui: $.ui.resolve(e), model: bandFound, site: BAND_SITE, actions }))

    const tree = await $.ui.render(BAND_HOST)

    expect(holds(tree, 'ContextSaver ●  Found 2 ways to save ~12% of your context and 51m')).toEqual(true)
    expect(keysOf(tree), 'no hotkey: a bare digit typed into an empty composer would fire it').toEqual(['toggle'])
    expect(drawnRows(tree)).toContain('Open')
    expect(cellsOf(tree)).toEqual(BAND_SITE.bodyColumns - BAND_RESERVE)   // the engine's '[-]' draws past them
    expect(overrun(tree)).toEqual([])

    await $.ui.press({ plugin: DRAWER, key: 'toggle' })
    await clock.settle()
    expect(calls).toEqual([{ name: 'togglePane', arg: undefined }])
  })

  test('the band gives back the time first, then the sentence, and never a cut figure', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      return Band({ ui: resolved, model: bandFound, site: BAND_SITE, actions })
    })

    await $.ui.render(BAND_HOST)

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the band drew no elements')
    const at = (columns: number, model = bandFound): unknown =>
      Band({ ui, model, site: { bodyColumns: columns, maxRows: 8 }, actions })

    expect(holds(at(70), 'Found 2 ways to save ~12% of your context'), 'the figure it can hold, stays').toEqual(true)
    expect(holds(at(70), '51m'), 'the time is the first thing the row gives back').toEqual(false)
    expect(holds(at(40), 'Found 2 wasters'), 'then the sentence itself shortens').toEqual(true)
    expect(holds(at(160, { ...bandFound, fresh: 1, costPct: 0, costMs: 0 }), 'Found 1 thing worth a look'),
      'a behavioural card costs nothing the ledger measured, so the line promises nothing').toEqual(true)
  })

  test('the band says a judge run is in flight, with the pane closed', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Band({ ui: $.ui.resolve(e), model: bandChecking, site: BAND_SITE, actions }))

    const tree = await $.ui.render(BAND_HOST)

    expect(holds(tree, 'ContextSaver ◐  checking this session…')).toEqual(true)
    expect(drawnRows(tree)).toContain('Open')
    expect(cellsOf(tree)).toEqual(BAND_SITE.bodyColumns - BAND_RESERVE)
    expect(overrun(tree)).toEqual([])
  })

  test('the band shows off what the session got back, and counts the calls when there is nothing to say', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      return Band({ ui: resolved, model: bandSaved, site: BAND_SITE, actions })
    })

    const saved = await $.ui.render(BAND_HOST)

    expect(holds(saved, 'ContextSaver ✓  saved 24% of context · 45m this session')).toEqual(true)
    expect(drawnRows(saved), 'the pane is open, so the button closes it').toContain('Close')

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the band drew no elements')
    const watching = Band({ ui, model: bandWatching, site: BAND_SITE, actions })
    const cold = Band({ ui, model: { ...bandWatching, calls: 0 }, site: BAND_SITE, actions })

    expect(holds(watching, 'ContextSaver ◌  312 calls watched · nothing wasteful yet')).toEqual(true)
    expect(holds(cold, 'ContextSaver ◌  watching'), 'before the first row there is nothing to count').toEqual(true)
    expect(holds(cold, 'calls watched')).toEqual(false)
  })

  test('the band says the last turn died, and how, until the next one starts', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      return Band({ ui: resolved, model: { ...bandWatching, state: 'died', died: 'error' }, site: BAND_SITE, actions })
    })

    const dead = await $.ui.render(BAND_HOST)

    expect(holds(dead, 'ContextSaver ✕  Last turn ended in an API error · type anything to continue')).toEqual(true)
    expect(cellsOf(dead)).toEqual(BAND_SITE.bodyColumns - BAND_RESERVE)
    expect(overrun(dead)).toEqual([])

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the band drew no elements')
    const at = (columns: number, died: 'error' | 'refusal'): unknown =>
      Band({ ui, model: { ...bandWatching, state: 'died', died }, site: { bodyColumns: columns, maxRows: 8 }, actions })

    expect(holds(at(100, 'refusal'), 'ContextSaver ✕  Last turn ended in a refusal · type anything to continue')).toEqual(true)
    expect(holds(at(60, 'error'), 'Last turn ended in an API error'), 'the fact stays where the advice does not fit').toEqual(true)
    expect(holds(at(60, 'error'), 'type anything'), 'and the sentence is never cut mid-word').toEqual(false)
  })

  test('the band names the workflow that is running while nothing is found, and shortens it whole', async ($, on) => {
    const { actions } = recorder()
    let resolved: Ui | null = null
    const running: NonNullable<BandModel['running']> = { name: 'proxy-rewrite', loops: 3, calls: 41, label: 'review:C3-r1' }
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      return Band({ ui: resolved, model: { ...bandWatching, running }, site: BAND_SITE, actions })
    })

    const tree = await $.ui.render(BAND_HOST)

    expect(holds(tree, 'ContextSaver ◌  proxy-rewrite · review:C3-r1 · 3 agents · 41 calls'), 'the mark stays the quiet one').toEqual(true)
    expect(overrun(tree)).toEqual([])

    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the band drew no elements')
    const at = (columns: number, over: Partial<typeof running> = {}): unknown =>
      Band({ ui, model: { ...bandWatching, running: { ...running, ...over } }, site: { bodyColumns: columns, maxRows: 8 }, actions })

    expect(holds(at(100, { label: null, loops: 1, calls: 1 }), 'proxy-rewrite · running · 1 agent · 1 call'), 'a run whose stage is unknown is running').toEqual(true)
    expect(holds(at(70), 'proxy-rewrite · review:C3-r1 · 3 agents'), 'the calls are the first thing the row gives back').toEqual(true)
    expect(holds(at(70), '41 calls')).toEqual(false)
    expect(holds(at(55), 'proxy-rewrite · 3 agents'), 'then the stage').toEqual(true)
    expect(holds(at(55), 'review')).toEqual(false)
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

    expect(holds(tree, 'Claude keeps running the whole'), 'the title wraps inside the width the seat leaves it').toEqual(true)
    expect(holds(tree, 'bun test suite after every')).toEqual(true)
    expect(holds(tree, 'api logs')).toEqual(true)
    expect(holds(tree, '3× · ~9% of context')).toEqual(true)
    expect(holds(tree, '2× · ~20% of context')).toEqual(true)
    expect(drawnRows(tree), 'each card wears the number the composer names it by').toContain('1')
    expect(drawnRows(tree)).toContain('2')
    expect(drawnRows(tree), 'the category is a dim tag on the title row').toContain('execution')
    expect(drawnRows(tree)).toContain('reading')
    expect(drawnRows(tree), 'the fix is drawn behind its own glyph').toContain('→')
    expect(drawnRows(tree).some(row => row.startsWith(FIX.slice(0, 28))), 'the fix has a row of its own').toEqual(true)
    expect(drawnRows(tree), 'the fix leads the verbs, each behind its own glyph').toContain('✓ Fix')
    expect(drawnRows(tree)).toContain('✎ Fix…')
    expect(drawnRows(tree)).toContain('– Ignore')
    expect(['Keep', 'Steer', 'Kill', 'Stop'].some(word => holds(tree, word)), 'the old verbs are gone').toEqual(false)
    expect(keysOf(tree)).toEqual([
      'check',
      `card:${FIRST}:info`, `card:${FIRST}:kill`, `card:${FIRST}:steer`, `card:${FIRST}:keep`,
      'card:reading:api-logs:info', 'card:reading:api-logs:kill', 'card:reading:api-logs:steer', 'card:reading:api-logs:keep',
    ])

    await $.ui.press({ plugin: DRAWER, key: `card:${FIRST}:kill` })
    await $.ui.press({ plugin: DRAWER, key: 'card:reading:api-logs:keep' })
    await clock.settle()
    expect(calls).toEqual([{ name: 'kill', arg: FIRST }, { name: 'keep', arg: 'reading:api-logs' }])
  })

  test('the category tag is dropped below sixty columns, and a wrapped title stays inside the card', async ($, on) => {
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
    const at = (bodyColumns: number): unknown =>
      Pane({ ui, model: twoWasters, site: { bodyColumns, maxRows: 30 }, placement: 'dock', actions })

    expect(drawnRows(at(60)), 'sixty columns hold the tag').toContain('execution')
    expect(drawnRows(at(56)), 'under that it goes, and the title takes its cells').not.toContain('execution')
    // The title wraps at every width the design is reviewed at, and never past the frame around it.
    for (const columns of [56, 60, 80]) {
      const rows = drawnRows(at(columns)).filter(row => row.startsWith('Claude keeps running'))
      expect(rows.length, `the title wraps at ${columns}`).toBeGreaterThan(0)
      expect(Math.max(0, ...rowEnds(at(columns), 0)), `no row past the body at ${columns}`).toBeLessThanOrEqual(columns)
    }
  })

  test('the newest waster is framed in the accent and the ones behind it are dim', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: twoWasters, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const frames = framesOf(tree)

    expect(frames, 'one frame per waster').toHaveLength(2)
    expect(frames[0]?.props?.borderColor).toEqual(TONES.accent)
    expect(frames[0]?.props?.borderDimColor).toEqual(undefined)
    expect(frames[1]?.props?.borderDimColor).toEqual(true)
    expect(frames[1]?.props?.borderColor).toEqual(undefined)
    expect(frames.every(frame => frame.props?.paddingX === 2), 'both cards are padded').toEqual(true)
  })

  test('the mark is drawn as a Raster beside the header, and dropped where the row is short', async ($, on) => {
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
    const rasterAt = (bodyColumns: number): Node | undefined =>
      nodesOf(Pane({ ui, model: twoWasters, site: { bodyColumns, maxRows: 30 }, placement: 'dock', actions }))
        .find(node => node.type === 'Raster')

    const logo = logoCells()
    const drawn = rasterAt(80)

    expect(drawn?.props?.key).toEqual('logo')
    expect(drawn?.props?.columns).toEqual(logo.columns)
    expect(drawn?.props?.rows).toEqual(logo.rows)
    expect(drawn?.props?.cells).toEqual(logo.cells)
    expect(Object.keys(drawn?.props ?? {}).sort(), 'a Raster takes these four props and no other')
      .toEqual(['cells', 'columns', 'key', 'rows'])
    expect(rasterAt(40), 'a header too narrow for both gives the mark back whole').toEqual(undefined)
  })

  test('the judge button says a run is in flight, dims, and answers no press', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: checkingPane, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const button = nodesOf(tree).find(node => node.props?.key === 'check')

    expect(button?.props?.label).toEqual('Checking…')
    expect(button?.props?.dimColor).toEqual(true)
    expect(holds(tree, 'checking this session… usually 10–20 s')).toEqual(true)

    await $.ui.press({ plugin: DRAWER, key: 'check' })
    await clock.settle()
    expect(calls, 'a run already in flight is not started twice').toEqual([])
  })

  test('the gauge fill takes its tone from how full the window is', async ($, on) => {
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
    const toneAt = (model: PaneModel): unknown =>
      nodesOf(Pane({ ui, model, site: WIDE_SITE, placement: 'dock', actions }))
        .find(node => node.type === 'Text' && typeof node.props?.color === 'string' && textOf(node).startsWith('█'))
        ?.props?.color

    expect(toneAt(twoWasters), 'room left: the accent').toEqual(TONES.accent)
    expect(toneAt(fillingPane), 'filling up: warm').toEqual(TONES.warm)
    expect(toneAt(fullPane), 'about to compact: hot').toEqual(TONES.hot)
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
    expect(drawnRows(wide), 'the name is the first row, beside the mark').toContain('ContextSaver')
    expect(drawnRows(wide)).toContain('↻ Check now')
    expect(holds(wide, `ContextSaver${' '.repeat(4)}Judge 2 runs · 7.4k tokens`), 'what the judge cost rides the name row').toEqual(true)
    expect(holds(wide, '64% of context · 41k tokens to compaction · about 6 turns')).toEqual(true)
    expect(holds(wide, gauge(64, WIDE_GAUGE))).toEqual(true)
    expect(holds(wide, `${gauge(64, WIDE_GAUGE)}  ${TREND}`), 'the trend sits two cells past the gauge').toEqual(true)
    expect(holds(wide, 'Saved ~3% · 3m 12s'), 'the row the judge left shows what the session got back').toEqual(true)
    expect(holds(wide, '1.2%')).toEqual(false)                            // the share is a developer metric
    expect(drawnRows(wide), 'where the wall time went, from the ledger').toContain('Time')
    expect(holds(wide, '3h 12m in tools · the full proxy suite runs after every fix'), 'one figure, one sentence').toEqual(true)
    expect(drawnRows(wide)).toContain('Context')
    expect(holds(wide, '410k from tools · most of it is test output nobody read past')).toEqual(true)
    expect(holds(wide, 'tests 48m (6)'), 'the named sinks are the model\'s and /saver debug\'s, not the row\'s').toEqual(false)
    expect(holds(wide, '↳ the full proxy suite'), 'and the judge no longer gets a row under the figure').toEqual(false)

    const dock = at(60)
    expect(holds(dock, gauge(64, DOCK_GAUGE)), 'the gauge gives cells back to the mark and the trend').toEqual(true)
    expect(holds(dock, '64% of context · 41k tokens to compaction')).toEqual(true)
    expect(holds(dock, 'about 6 turns'), 'the run in turns is dropped whole').toEqual(false)
    expect(holds(dock, 'Judge 2 runs'), 'the runs outlive the tokens the name row cannot hold').toEqual(true)
    expect(holds(dock, '7.4k')).toEqual(false)
    expect(holds(dock, '3h 12m in tools · the full proxy suite ru…'), 'the sentence is cut, never the figure').toEqual(true)
    expect(holds(dock, 'Check now')).toEqual(true)
    expect(cellsOf(dock), 'every header row fits the body at 60 columns').toBeLessThanOrEqual(60)
    expect(overrun(dock)).toEqual([])

    const tight = at(40)
    expect(holds(tight, '64% · 41k to compaction'), 'a word goes before a figure does').toEqual(true)
    expect(holds(tight, 'Judge'), 'the judge is the first segment to go').toEqual(false)
    expect(holds(tight, 'Saved ~3% · 3m')).toEqual(true)
    expect(holds(tight, '3h 12m in tools')).toEqual(true)
    expect(holds(tight, 'in tools · '), 'a row with no room for a sentence keeps the figure alone').toEqual(false)

    const quiet = at(80, quietPane)
    expect(holds(quiet, '3h 12m in tools · nothing stands out yet'), 'before the judge speaks the row says so').toEqual(true)
    expect(holds(quiet, 'Judge'), 'and a judge that has never run is no figure').toEqual(false)

    const narrowest = at(26)
    expect(holds(narrowest, gauge(64, PINCHED_GAUGE)), 'the trend goes and the gauge takes the row').toEqual(true)
    expect(holds(narrowest, TREND)).toEqual(false)
    expect(holds(narrowest, '64% of context')).toEqual(true)

    const past = at(80, overrunPane)
    expect(holds(past, 'to compaction')).toEqual(false)   // the run went negative once the threshold passed
    expect(holds(past, '~0%')).toEqual(false)
    expect(holds(past, 'Saved 3m')).toEqual(true)

    const million = at(100, millionPane)
    expect(holds(million, '5% of context · 914k tokens to compaction · about 33 turns')).toEqual(true)
    expect(holds(million, 'Saved'), 'a session that saved nothing leaves the row blank').toEqual(false)
    expect(holds(million, TREND), 'one sample is a dot, not a shape').toEqual(false)
    const cramped = at(40, millionPane)
    expect(holds(cramped, '914k to compaction')).toEqual(true)
    expect(holds(cramped, 'about 33 turns')).toEqual(false)
    const pinched = at(26, millionPane)
    expect(holds(pinched, '914'), 'the figure is dropped whole, never cut mid-number').toEqual(false)
  })

  test('before the first turn the header says so instead of drawing an empty gauge', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: awaitingPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)

    expect(drawnRows(tree)).toContain('ContextSaver')
    expect(holds(tree, 'awaiting the first turn')).toEqual(true)
    expect(holds(tree, '░')).toEqual(false)
    expect(holds(tree, 'Judge 1 run')).toEqual(true)
    expect(drawnRows(tree), 'no ledger row yet, so nothing to say about the time').not.toContain('Time')
  })

  test('i opens why, fix, the summary and the calls behind the claim', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    let resolved: Ui | null = null
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) => {
      resolved = $.ui.resolve(e)
      return Pane({ ui: resolved, model: expandedPane, site: WIDE_SITE, placement: 'dock', actions })
    })

    const tree = await $.ui.render(PANE_HOST)
    const texts = drawnRows(tree)

    expect(texts).toContain('why')
    expect(texts).toContain('fix')
    expect(texts, 'what Fix sends is the fix already on screen, so it has no row of its own').not.toContain('kill →')
    expect(texts, 'one dim row says what the cited calls add up to').toContain('3 calls · 3m 12s · 72k chars of context')
    expect(holds(tree, 'turn 8   bun test'), 'a cited call names its turn and what ran, nothing else').toEqual(true)
    const cited = citedCalls(tree)
    expect(cited, 'one row per cited call').toHaveLength(3)
    expect(cited[0], 'the widest rung spells the unit of a size').toContain('1m 2s · 24k ch')
    expect(cited[1], 'a call another loop made names that loop').toContain('   a1   ')
    expect(cited[2], 'a main-loop call is not labelled with a loop').not.toContain('a1')
    expect(new Set(cited.map(row => row.indexOf(' · 24k ch'))), 'the sizes are one column, however long the durations are')
      .toEqual(new Set([cited[0]?.indexOf(' · 24k ch')]))
    expect(holds(tree, '↳ "212 pass · 0 fail"'), 'the head of what came back is quoted under the call').toEqual(true)
    expect(texts.filter(text => text.startsWith('↳ "')).length, 'a call that returned nothing is quoted no quote').toEqual(2)
    expect(holds(tree, '3× · ~9% of context'), 'the stats row is what the details replace').toEqual(false)

    // Narrow, the ladder drops the unit and then the loop's name; the turn, the command and the cost stay.
    const ui: Ui | null = resolved
    if (ui === null) throw new Error('the pane drew no elements')
    const narrow = citedCalls(Pane({ ui, model: expandedPane, site: { bodyColumns: 40, maxRows: 30 }, placement: 'dock', actions }))
    expect(narrow[0]).toContain('1m 2s · 24k')
    expect(narrow[0], 'the unit is the first thing the row gives back').not.toContain('24k ch')
    expect(narrow[1], 'then the loop it ran in').not.toContain('a1')

    await $.ui.press({ plugin: DRAWER, key: `card:${FIRST}:info` })
    await clock.settle()
    expect(calls).toEqual([{ name: 'info', arg: FIRST }])
  })

  test('the details of a behavioural finding count turns and its estimate per turn', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: chattyPane, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)

    expect(drawnRows(tree)).toContain('2 turns · ~1.2k tokens per turn')
    expect(holds(tree, 'turn 15   no tool calls   6.1k answer')).toEqual(true)
    expect(holds(tree, '↳ "To recap the plan')).toEqual(true)
  })

  test('the details of a finding that cites loops count agents and their time', async ($, on) => {
    const { actions } = recorder()
    const [first, ...rest] = chattyPane.wasters
    if (first === undefined) throw new Error('the chatty pane holds no waster')
    const model: PaneModel = { ...chattyPane, wasters: [{ ...first, total: { unit: 'agents', calls: 2, ms: 420_000, chars: 4_800 } }, ...rest] }
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)

    expect(drawnRows(tree)).toContain('2 agents · 7m · ~1.2k tokens per turn')
  })

  // Bug (c): the field opened pre-filled with the fix, a line longer than the seat, so a one-line field drew
  // the fix, truncated the rest, and hid every character the person typed after it. It opens empty now, the
  // fix dim behind it (d.ts 3752-3755). The field holds the text the last render gave it (d.ts 3756-3760) and
  // the pane's body is this tree, so every render carries the draft back rather than wiping it.
  test('Fix… opens an empty field with the fix drawn dim behind it, and the draft is drawn back', async ($, on) => {
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
    expect(inputValueOf(open, `card:${FIRST}:text`), 'nothing is pre-filled, so the first keystroke is what the field shows').toEqual('')
    expect(placeholderOf(open, `card:${FIRST}:text`), 'the fix is the dim suggestion behind the empty field').toEqual(FIX)
    expect(holds(open, 'Enter sends')).toEqual(true)
    expect(holds(open, 'Fix… again closes')).toEqual(true)
    expect(holds(open, 'or /saver fix <n> <text>')).toEqual(true)
    expect(keysOf(open)).toContain(`card:${FIRST}:keep`)

    const drafted = await $.ui.render(DRAFT_HOST)

    expect(keysOf(drafted), 'the field is still the same element').toContain(`card:${FIRST}:text`)
    expect(inputValueOf(drafted, `card:${FIRST}:text`), 'what the person typed is what the redraw draws')
      .toEqual(draftPane.steerDraft)
    expect(placeholderOf(drafted, `card:${FIRST}:text`), 'the suggestion stays behind the words the person is writing').toEqual(FIX)

    await $.ui.press({ plugin: DRAWER, key: `card:${FIRST}:steer`, requestId: DRAFT_HOST.requestId })
    await clock.settle()
    expect(calls).toEqual([{ name: 'steer', arg: FIRST }])
  })

  // Bug (b): the field drew below the details on the docked pane, so the person who pressed Fix… saw the
  // card scroll and typed into the composer instead. It now rises with the verbs at every width.
  test('the field and its hint sit under the verbs, above any detail, at every width', async ($, on) => {
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
    // The busiest a card ever is: the details open behind i under a field the person just opened.
    const busy: PaneModel = { ...steeringPane, expanded: steeringPane.steering }
    for (const columns of [56, 85, 160]) {
      for (const placement of ['dock', 'inline'] as const) {
        const rows = drawnRows(Pane({ ui, model: busy, site: { bodyColumns: columns, maxRows: 30 }, placement, actions }))
        const seat = `${placement} ${columns}`
        const verbs = rows.indexOf('– Ignore')
        const field = rows.indexOf(FIX)
        const hint = rows.findIndex(row => row.startsWith('Enter sends'))
        expect(verbs, `${seat}: the verbs are drawn`).toBeGreaterThan(0)
        // Two rows on: the '›' of the field's own row is drawn before the field it leads.
        expect(rows[verbs + 1], `${seat}: the field's own row follows the verbs`).toEqual(GLYPH_FIELD)
        expect(field - verbs, `${seat}: the field follows the verbs`).toEqual(2)
        expect(hint - field, `${seat}: the hint follows the field`).toEqual(1)
        expect(rows.indexOf('why'), `${seat}: a detail row is below both`).toBeGreaterThan(hint)
        expect(rows[rows.length - 1], `${seat}: the keys are the pane's last row`).toContain('ctrl+x tab focuses this pane')
      }
    }
    const wide = drawnRows(Pane({ ui, model: busy, site: { bodyColumns: 160, maxRows: 30 }, placement: 'dock', actions }))
    expect(wide[wide.length - 1], 'where the row fits, the verbs by number ride along')
      .toEqual('ctrl+x tab focuses this pane · Tab moves · Enter presses · Esc hands the keys back · /saver fix|ignore <n>')
  })

  test('the Fix… field hands every keystroke and the sent text to the actions', async ($, on) => {
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

    field?.onEvent?.({ kind: 'change', value: 'only the auth' })
    // Enter carries the field's own text: what the surface holds, not the keystroke the plugin kept.
    field?.onEvent?.({ kind: 'submit', value: 'only the auth tests' })

    expect(calls).toEqual([
      { name: 'steerDraft', arg: 'only the auth' },
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

    expect(drawnRows(tree)).toContain('ContextSaver')
    expect(holds(tree, '41k tokens to compaction')).toEqual(true)
    expect(holds(tree, 'Judge 2 runs'), 'the mark pays for four rows, so the figures ride along').toEqual(true)
    expect(drawnRows(tree), 'where the budget went is the docked pane\'s, not the seat\'s').not.toContain('Time')
    expect(keysOf(tree)).toEqual(['check', `card:${FIRST}:info`, `card:${FIRST}:kill`, `card:${FIRST}:steer`, `card:${FIRST}:keep`])
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
    const models = [emptyPane, twoWasters, expandedPane, chattyPane, steeringPane, decidedPane, overrunPane, awaitingPane, quietPane, millionPane, fillingPane, fullPane, manyWasters]
    for (const model of models) {
      for (const columns of [40, 56, 60, 70, 80, 100, 120, 160]) {
        const site = { bodyColumns: columns, maxRows: 30 }
        const dock = Pane({ ui, model, site, placement: 'dock', actions })
        const inline = Pane({ ui, model, site, placement: 'inline', actions })
        expect(cellsOf(dock), `dock ${columns}`).toBeLessThanOrEqual(columns)
        expect(cellsOf(inline), `inline ${columns}`).toBeLessThanOrEqual(columns)
        expect(overrun(dock), `dock ${columns} controls`).toEqual([])
        expect(overrun(inline), `inline ${columns} controls`).toEqual([])
      }
    }
    for (const model of [bandFound, bandSaved, bandChecking, bandWatching]) {
      for (const columns of [40, 56, 60, 70, 80, 100, 120, 160]) {
        const band = Band({ ui, model, site: { bodyColumns: columns, maxRows: 8 }, actions })
        expect(cellsOf(band), `band ${columns}`).toBeLessThanOrEqual(columns - BAND_RESERVE)
        expect(overrun(band), `band ${columns} controls`).toEqual([])
      }
    }
    // A wrapped title used to poke through its card's border: every row is measured from the left edge
    // of the pane, through the padding and the borders around it, at the three widths the design is
    // reviewed at.
    for (const model of models) {
      for (const columns of [60, 80, 160]) {
        const site = { bodyColumns: columns, maxRows: 30 }
        const dock = rowEnds(Pane({ ui, model, site, placement: 'dock', actions }), 0)
        const inline = rowEnds(Pane({ ui, model, site, placement: 'inline', actions }), 0)
        expect(Math.max(0, ...dock), `dock rows at ${columns}`).toBeLessThanOrEqual(columns)
        expect(Math.max(0, ...inline), `inline rows at ${columns}`).toBeLessThanOrEqual(columns)
      }
    }
    // A seat of ten and up wears two digits: the cell they sit in keeps the space before the accent dot.
    const deep = Pane({ ui, model: manyWasters, site: { bodyColumns: 80, maxRows: 30 }, placement: 'dock', actions })
    const twelfth = nodesOf(deep).find(node => node.type === 'Box' && textOf(node) === '12')
    expect(cellsOf(twelfth), 'a two-digit number is not flush against the dot').toBeGreaterThan('12'.length)
  })

  test('no row runs past the body in any language the plugin ships', async ($, on) => {
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
    // Every label the cells are reserved against is a word a translation may spend more of — and in a
    // wide script every character spends two. The reserves are measured rather than counted off the
    // English labels, and every bundle the plugin ships is held to the same widths here.
    const models = [emptyPane, twoWasters, expandedPane, chattyPane, steeringPane, decidedPane, overrunPane, awaitingPane, quietPane, millionPane, fillingPane, fullPane, manyWasters]
    try {
      for (const tag of LANGUAGE_TAGS) {
        setSay(tag)
        for (const model of models) {
          for (const columns of [40, 56, 60, 70, 80, 100, 120, 160]) {
            const site = { bodyColumns: columns, maxRows: 30 }
            const dock = Pane({ ui, model, site, placement: 'dock', actions })
            const inline = Pane({ ui, model, site, placement: 'inline', actions })
            expect(cellsOf(dock), `${tag} dock ${columns}`).toBeLessThanOrEqual(columns)
            expect(cellsOf(inline), `${tag} inline ${columns}`).toBeLessThanOrEqual(columns)
            expect(overrun(dock), `${tag} dock ${columns} controls`).toEqual([])
            expect(overrun(inline), `${tag} inline ${columns} controls`).toEqual([])
            expect(Math.max(0, ...rowEnds(dock, 0)), `${tag} dock rows at ${columns}`).toBeLessThanOrEqual(columns)
            expect(Math.max(0, ...rowEnds(inline, 0)), `${tag} inline rows at ${columns}`).toBeLessThanOrEqual(columns)
          }
        }
        for (const model of [bandFound, bandSaved, bandChecking, bandWatching]) {
          for (const columns of [40, 56, 60, 70, 80, 100, 120, 160]) {
            const band = Band({ ui, model, site: { bodyColumns: columns, maxRows: 8 }, actions })
            expect(cellsOf(band), `${tag} band ${columns}`).toBeLessThanOrEqual(columns - BAND_RESERVE)
            expect(overrun(band), `${tag} band ${columns} controls`).toEqual([])
          }
        }
      }
      setSay('fr')
      const latin = textOf(Pane({ ui, model: twoWasters, site: WIDE_SITE, placement: 'dock', actions }))
      expect(latin, 'the verbs are the person’s own words').toContain('Corriger')
      expect(latin, 'and so is the tag on a card').toContain('exécution')
      setSay('ja')
      const wide = textOf(Pane({ ui, model: twoWasters, site: WIDE_SITE, placement: 'dock', actions }))
      expect(wide, 'a wide script draws its own words too').toContain('修正')
      expect(wide).not.toContain('Ignore')
    } finally {
      setSay(DEFAULT_LANGUAGE)
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
    // The worst case the seat ever holds: the details open behind i and the Fix… field open under them.
    const busiest: PaneModel = { ...expandedPane, steering: expandedPane.expanded }
    // And the tightest: a footer under a card whose field is open, where the keyboard row is what gives way.
    const footed: PaneModel = { ...decidedPane, steering: decidedPane.wasters[0]?.patternId ?? null }
    const models: PaneModel[] = [emptyPane, twoWasters, expandedPane, chattyPane, steeringPane, busiest, decidedPane, footed, manyWasters]
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
      expect(drawnRows(cramped), 'Fix survives a cramped seat').toContain('✓ Fix')
      expect(drawnRows(cramped), 'Fix… survives a cramped seat').toContain('✎ Fix…')
      expect(drawnRows(cramped), 'Ignore survives a cramped seat').toContain('– Ignore')
    }
    const opened = drawnRows(Pane({ ui, model: expandedPane, site: { bodyColumns: 100, maxRows: 14 }, placement: 'inline', actions }))
    expect(opened.indexOf('✓ Fix'), 'the verbs are drawn above the details, so a clipped seat costs detail')
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
    expect(holds(tree, '✎ fixed with a note · re-reading src/auth.ts'), 'a decided row says the word, not only the glyph').toEqual(true)
    expect(texts).toContain('saved ~1%')
    expect(holds(tree, '✓ fixed · re-summarising the plan every turn'), 'a sent fix reads as fixed').toEqual(true)
    expect(holds(tree, '✕')).toEqual(false)
    expect(texts).toContain('ignored 1×')
    expect(holds(tree, 'Re-read only after edits · CLAUDE.md')).toEqual(true)
    expect(texts, 'the rules wear their own glyphs too').toContain('✎ Write')
    expect(texts).toContain('▸ Try')
    expect(texts).toContain('– Skip')
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
      model: bandFound,
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
    expect(holds(band, 'Found 2 ways to save')).toEqual(true)
    expect(cellsOf(band)).toBeLessThanOrEqual(BAND_PROPS.bodyColumns)
    expect(holds(pane, 'ContextSaver')).toEqual(true)
    expect(holds(pane, 'Claude keeps running the whole')).toEqual(true)
    expect(drawnRows(pane)).toContain('✓ Fix')
    expect(cellsOf(pane)).toBeLessThanOrEqual(PANE_PROPS.bodyColumns)
  })
})
