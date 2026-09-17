import { describe, expect, mock, test } from 'claude-code/testing'

import type { RenderPropsOf } from 'claude-code'

import { Band, Pane } from '../hooks/ui'
import { gauge, sparkline } from '../hooks/core/text'
import type { Actions, Site, Ui } from '../hooks/core/types'
import { bandFull } from './fixtures/ui/band-full'
import { bandQuiet } from './fixtures/ui/band-quiet'
import { checkingPane } from './fixtures/ui/checking-pane'
import { decidedPane } from './fixtures/ui/decided-pane'
import { draftPane } from './fixtures/ui/draft-pane'
import { emptyPane } from './fixtures/ui/empty-pane'
import { expandedPane } from './fixtures/ui/expanded-pane'
import { overrunPane } from './fixtures/ui/overrun-pane'
import { steeringPane } from './fixtures/ui/steering-pane'
import { twoWasters } from './fixtures/ui/two-wasters'

const DRAWER = 'test'                 // the plugin the kit stamps on a tree the test's own `on` drew
const BAND_SITE: Site = { bodyColumns: 100, maxRows: 8 }
const PANE_SITE: Site = { bodyColumns: 60, maxRows: 30 }
const WIDE_SITE: Site = { bodyColumns: 100, maxRows: 30 }
const FIRST = 'execution:full-suite'
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
  const own = typeof props.width === 'number' ? Number(props.width) : inner
  return own + 2 * number('paddingX') + number('paddingLeft') + number('paddingRight')
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

  test('the empty pane is one dim sentence and the judge button', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: emptyPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)

    expect(drawnRows(tree)).toContain('Nothing repeating yet.')
    expect(keysOf(tree)).toEqual(['check'])
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

  test('the judge button dims to checking… while the judge runs', async ($, on) => {
    const { actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: checkingPane, site: PANE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const button = nodesOf(tree).find(node => node.props?.key === 'check')

    expect(button?.props?.label).toEqual('checking…')
    expect(button?.props?.dimColor).toEqual(true)
  })

  test('the header degrades the context and the saved rows instead of cutting them', async ($, on) => {
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
    expect(holds(wide, gauge(64, 16))).toEqual(true)
    expect(holds(wide, '64%')).toEqual(true)
    expect(holds(wide, '41k to compaction ≈ 6 turns')).toEqual(true)
    expect(holds(wide, sparkline(twoWasters.header.spark, 10))).toEqual(true)
    expect(holds(wide, '2 runs · 1.2%')).toEqual(true)
    expect(holds(wide, 'SAVED  ~3% · 3m')).toEqual(true)

    const dock = at(56)
    expect(holds(dock, gauge(64, 16))).toEqual(true)
    expect(holds(dock, '41k to compaction')).toEqual(true)
    expect(holds(dock, '≈ 6 turns')).toEqual(false)
    expect(holds(dock, sparkline(twoWasters.header.spark, 10))).toEqual(false)

    const tight = at(40)
    expect(holds(tight, gauge(64, 8))).toEqual(true)
    expect(holds(tight, 'SAVED')).toEqual(false)      // dropped whole rather than cut mid-number
    expect(holds(tight, '41k to compaction…')).toEqual(false)

    const past = at(80, overrunPane)
    expect(holds(past, 'to compaction')).toEqual(false)   // the run went negative once the threshold passed
    expect(holds(past, '~0%')).toEqual(false)
    expect(holds(past, 'SAVED  3m')).toEqual(true)
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
        site: PANE_SITE,
        placement: 'dock',
        actions,
      }))

    const open = await $.ui.render(PANE_HOST)

    expect(keysOf(open)).toContain(`card:${FIRST}:text`)
    expect(inputValueOf(open, `card:${FIRST}:text`)).toEqual(FIX)
    expect(holds(open, 'Enter sends')).toEqual(true)
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

    expect(holds(tree, 'CONTEXT')).toEqual(true)
    expect(holds(tree, 'JUDGE')).toEqual(false)
    expect(holds(tree, 'Check now')).toEqual(false)
    expect(keysOf(tree)).toEqual([`card:${FIRST}:info`, `card:${FIRST}:keep`, `card:${FIRST}:steer`, `card:${FIRST}:kill`])
    expect(holds(tree, '● Claude keeps reading 2000 lines of api logs')).toEqual(true)
    expect(holds(tree, 'api logs instead of grepping for the error · 2×')).toEqual(true)
    expect(holds(tree, 'DECIDED 2 · RULES 1 · /saver for the full pane')).toEqual(true)

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
    for (const model of [emptyPane, twoWasters, expandedPane, steeringPane, decidedPane, overrunPane]) {
      for (const columns of [56, 80, 120]) {
        const site = { bodyColumns: columns, maxRows: 30 }
        expect(cellsOf(Pane({ ui, model, site, placement: 'dock', actions })), `dock ${columns}`)
          .toBeLessThanOrEqual(columns)
        expect(cellsOf(Pane({ ui, model, site, placement: 'inline', actions })), `inline ${columns}`)
          .toBeLessThanOrEqual(columns)
        expect(cellsOf(Band({ ui, model: bandFull, site, actions })), `band ${columns}`)
          .toBeLessThanOrEqual(columns)
      }
    }
  })

  test('the footer lists the decisions and the rules, and Write hands back the artifact', async ($, on) => {
    const clock = mock.clock(on)
    const { calls, actions } = recorder()
    on('ui.render', { component: 'CommandOutput', surface: 'terminal' }, ($, e) =>
      Pane({ ui: $.ui.resolve(e), model: decidedPane, site: WIDE_SITE, placement: 'dock', actions }))

    const tree = await $.ui.render(PANE_HOST)
    const texts = drawnRows(tree)

    expect(texts).toContain('DECIDED')
    expect(texts).toContain('RULES')
    expect(holds(tree, '↪ re-reading src/auth.ts · saved ~1%')).toEqual(true)
    expect(holds(tree, '✕ re-summarising the plan every turn · ignored 1×')).toEqual(true)
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
    expect(holds(pane, 'CONTEXT')).toEqual(true)
    expect(holds(pane, 'bun test suite')).toEqual(true)
    expect(drawnRows(pane)).toContain('Keep')
    expect(cellsOf(pane)).toBeLessThanOrEqual(PANE_PROPS.bodyColumns)
  })
})
