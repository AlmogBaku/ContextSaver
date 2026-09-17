/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import { collapseWs, duration, gauge, sparkline } from './core/text'
import { PANE_INLINE_ROWS, PANE_TITLE } from './core/types'
import type {
  Actions,
  Artifact,
  ArtifactKind,
  BandModel,
  BandProps,
  Card,
  Choice,
  DecidedRow,
  Header,
  PaneModel,
  PaneProps,
  Ui,
} from './core/types'

// Layout numbers of this drawing only. §9.12 puts constants in types.ts; types.ts is the shared
// contract and carries no layout cells, so these stay private to the drawing (README "Theme"
// records the divergence; hoisting them is WP6's call at integration).
const ACCENT = 'suggestion'   // the theme's accent key (the engine's own suggestion blue and gauge fill)
const GUTTER = 10             // cells of the dim label column
const GLYPH_CELLS = 2         // the waster's '●' and the space after it
const GAUGE_CELLS = 16
const HALF_GAUGE_CELLS = 8    // the gauge once the row has to give something up
const SPARK_CELLS = 10
const VERB_GAP = 4
const VERBS_CELLS = 21        // 'Keep' + 'Steer' + 'Kill' and the two gaps between them
const RULES_CELLS = 18        // 'Write' + 'Try' + 'Skip' and the gaps around them
const CHECK_CELLS = 10        // 'Check now'
const INFO_CELLS = 1          // 'i'
const CONTROL_GAP = 2         // cells between a row's text and the Button at its right edge
const BAND_RESERVE = 4        // cells the engine's own collapse control '[-]' takes at the band's right edge
const TITLE_ROWS = 2
const VALUE_ROWS = 2
const EVIDENCE_ROWS = 3
const MIN_FIX_CELLS = 18
const MIN_CELLS = 24
const INLINE_HEAD_ROWS = 8    // rows the inline pane spends before its compact waster list
const GLYPHS = { live: '●', kept: '✓', steered: '↪', killed: '✕', fix: '→', field: '›', rule: '─' } as const
const DECIDED_GLYPH: Record<Choice, string> = { keep: GLYPHS.kept, steer: GLYPHS.steered, kill: GLYPHS.killed }
const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  'claude-md': 'CLAUDE.md',
  skill: 'skill',
  'agent-brief': 'agent brief',
  'settings-allow': 'permission rule',
}
const TRYABLE: readonly ArtifactKind[] = ['claude-md', 'skill', 'agent-brief']
const HITS = /^\d+×$/               // a stats segment that is a hit count, e.g. '3×'
const STEER_HINT = 'Enter sends · Steer again closes · multi-line: /saver steer in the prompt'
const EMPTY_TEXT = 'Nothing repeating yet.'
const AWAITING_TEXT = 'awaiting the first turn'
const FULL_PANE_HINT = '/saver for the full pane'

/** Truncates text to `cells` characters, ending it with '…' when it is cut. */
const fit = (text: string, cells: number): string =>
  text.length <= cells ? text : `${text.slice(0, Math.max(0, cells - 1))}…`

/** Wraps text into at most `rows` lines of `cells` characters, the last cut with '…'. */
const linesOf = (text: string, cells: number, rows: number): string[] => {
  const width = Math.max(8, cells)
  const lines = collapseWs(text)
    .split(' ')
    .reduce<string[]>((acc, word) => {
      const last = acc[acc.length - 1] ?? ''
      const joined = last === '' ? word : `${last} ${word}`
      return joined.length <= width ? [...acc.slice(0, -1), joined] : [...acc, word]
    }, [''])
  return lines.length <= rows ? lines : [...lines.slice(0, rows - 1), fit(lines.slice(rows - 1).join(' '), width)]
}

/** Formats a token count short: '9.9k', '41k', '800'. */
const kilo = (tokens: number): string =>
  tokens >= 10_000 ? `${Math.round(tokens / 1000)}k` : tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : `${tokens}`

/** Joins the segments that carry something with ' · '. */
const joined = (segments: (string | null)[]): string => segments.filter(s => s !== null && s !== '').join(' · ')

/** A block of at most `rows` truncated lines. */
const textBlock = (ui: Ui, text: string, cells: number, rows: number, isDim?: true): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {linesOf(text, cells, rows).map(line => (
        <Text dimColor={isDim} wrap="truncate-end">{line}</Text>
      ))}
    </Box>
  )
}

/** One row of the grid: a dim label in the 10-cell gutter, the value in the content column. */
const gutterRow = (ui: Ui, label: string, value: RenderElement | string): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row">
      <Box width={GUTTER}><Text dimColor wrap="truncate-end">{label}</Text></Box>
      <Box flexDirection="column" flexGrow={1}>
        {typeof value === 'string' ? <Text wrap="truncate-end">{value}</Text> : value}
      </Box>
    </Box>
  )
}

/** A dim hairline across the body. */
const rule = (ui: Ui, cells: number): RenderElement => {
  const { Text } = ui
  return <Text dimColor wrap="truncate-end">{GLYPHS.rule.repeat(Math.max(1, cells))}</Text>
}

/** A blank row between blocks. */
const blank = (ui: Ui): RenderElement => {
  const { Box } = ui
  return <Box height={1} />
}

/** The context gauge: accent cells for what is used, dim for what is left. */
const gaugeText = (ui: Ui, percent: number, cells: number): RenderElement => {
  const { Text } = ui
  const drawn = gauge(percent, cells)
  const filled = drawn.replace(/░+$/, '')
  return (
    <Text>
      <Text color={ACCENT}>{filled}</Text>
      <Text dimColor>{drawn.slice(filled.length)}</Text>
    </Text>
  )
}

/** What the CONTEXT row draws at one rung of its ladder: the gauge's cells and the three texts after it. */
type ContextCells = { bar: number; pct: string; spark: string; tail: string }

const contextCells = (row: ContextCells): number => row.bar + row.pct.length + row.spark.length + row.tail.length

/** The CONTEXT row measured whole: the sparkline goes first, then the run, then half the gauge, then the compaction figure. */
const contextFit = (header: Header, percent: number, room: number): ContextCells => {
  const pct = `  ${Math.round(percent)}%`
  const near = header.tokensToCompaction === null || header.tokensToCompaction <= 0
    ? ''
    : `${kilo(header.tokensToCompaction)} to compaction`
  const run = near !== '' && header.turnsToCompaction !== null ? `${near} ≈ ${header.turnsToCompaction} turns` : near
  const spark = header.spark.length > 0 ? `   ${sparkline(header.spark, SPARK_CELLS)}` : ''
  const gap = (text: string): string => (text === '' ? '' : `   ${text}`)
  const bare: ContextCells = { bar: HALF_GAUGE_CELLS, pct, spark: '', tail: '' }
  const ladder: ContextCells[] = [
    { bar: GAUGE_CELLS, pct, spark, tail: gap(run) },
    { bar: GAUGE_CELLS, pct, spark: '', tail: gap(run) },
    { bar: GAUGE_CELLS, pct, spark: '', tail: gap(near) },
    { bar: HALF_GAUGE_CELLS, pct, spark: '', tail: gap(near) },
    bare,
  ]
  return ladder.find(row => contextCells(row) <= room) ?? { ...bare, bar: 0 }
}

/** The header's CONTEXT row: the gauge, the percentage, the sparkline and the run to compaction. */
const contextRow = (ui: Ui, header: Header, cells: number): RenderElement => {
  const { Text } = ui
  const room = Math.max(8, cells - GUTTER)
  if (header.percent === null) {
    return gutterRow(ui, 'CONTEXT', <Text dimColor wrap="truncate-end">{fit(AWAITING_TEXT, room)}</Text>)
  }
  const shown = contextFit(header, header.percent, room)
  return gutterRow(ui, 'CONTEXT', (
    <Text wrap="truncate-end">
      {shown.bar === 0 ? '' : gaugeText(ui, header.percent, shown.bar)}
      {shown.pct}
      <Text dimColor>{shown.spark}</Text>
      <Text dimColor>{shown.tail}</Text>
    </Text>
  ))
}

/** The header's SAVED block: segments are dropped while they do not fit, never cut mid-number. */
const savedBlock = (header: Header, room: number): string => {
  const pct = header.savedPct > 0 ? `~${header.savedPct}%` : null
  const ms = header.savedMs > 0 ? duration(header.savedMs) : null
  const blocks = [joined([pct, ms]), joined([pct ?? ms])].map(text => (text === '' ? '' : `   SAVED  ${text}`))
  return blocks.find(text => text.length <= room) ?? ''
}

/** The JUDGE row's own figures: the runs and what the judge has spent, dropped whole rather than cut. */
const judgeText = (header: Header, room: number): string => {
  const runs = `${header.judgeRuns} run${header.judgeRuns === 1 ? '' : 's'}`
  const tokens = header.judgeTokens > 0 ? `${kilo(header.judgeTokens)} tokens` : null
  return [joined([runs, tokens]), runs].find(text => text.length <= room) ?? ''
}

/** The header's JUDGE row: the judge's runs and tokens, the savings, and 'Check now' at the right edge. */
const judgeRow = (ui: Ui, header: Header, actions: Actions, cells: number, hasCheck: boolean): RenderElement => {
  const { Box, Text } = ui
  const value = Math.max(8, cells - GUTTER - (hasCheck ? CHECK_CELLS + CONTROL_GAP : 0))
  const judge = judgeText(header, value)
  const saved = savedBlock(header, Math.max(0, value - judge.length))
  return (
    <Box flexDirection="row" justifyContent="space-between" width={cells}>
      <Box flexDirection="row" width={GUTTER + value}>
        <Box width={GUTTER}><Text dimColor wrap="truncate-end">JUDGE</Text></Box>
        <Box flexGrow={1}><Text wrap="truncate-end">{judge}<Text dimColor>{saved}</Text></Text></Box>
      </Box>
      {hasCheck ? checkButton(ui, header, actions) : null}
    </Box>
  )
}

/** The 'Check now' button, dim and reading 'checking…' while the judge runs. */
const checkButton = (ui: Ui, header: Header, actions: Actions): RenderElement => {
  const { Button } = ui
  return (
    <Button key="check" plain dimColor={header.judgeRunning} onPress={() => actions.check()}>
      {header.judgeRunning ? 'checking…' : 'Check now'}
    </Button>
  )
}

/** The header: the CONTEXT row, the JUDGE row unless compact, then a hairline. */
const headerSection = (
  ui: Ui,
  header: Header,
  actions: Actions,
  cells: number,
  isCompact: boolean,
  hasCheck: boolean,
): RenderElement => {
  const { Box } = ui
  return (
    <Box flexDirection="column" paddingX={1}>
      {contextRow(ui, header, cells)}
      {isCompact ? null : judgeRow(ui, header, actions, cells, hasCheck)}
      {rule(ui, cells)}
    </Box>
  )
}

/** A waster's title row: the accent dot, the behaviour in bold, and 'i' at the right edge. */
const titleRow = (ui: Ui, card: Card, actions: Actions, cells: number): RenderElement => {
  const { Box, Text, Button } = ui
  const value = Math.max(GLYPH_CELLS + 8, cells - INFO_CELLS - CONTROL_GAP)
  const title = value - GLYPH_CELLS
  return (
    <Box flexDirection="row" justifyContent="space-between" width={cells}>
      <Box flexDirection="row" width={value}>
        <Box width={GLYPH_CELLS}><Text color={ACCENT}>{GLYPHS.live}</Text></Box>
        <Box flexDirection="column">
          {linesOf(card.kind, title, TITLE_ROWS).map(line => (
            <Text bold wrap="truncate-end">{line}</Text>
          ))}
        </Box>
      </Box>
      <Button key={`card:${card.patternId}:info`} plain dimColor onPress={() => actions.info(card.patternId)}>i</Button>
    </Box>
  )
}

/** The verbs row: Keep, Steer and Kill, then the fix while the details are closed. */
const verbsRow = (ui: Ui, card: Card, actions: Actions, cells: number, hasFix: boolean): RenderElement => {
  const { Box, Button } = ui
  const id = card.patternId
  const fix = cells - VERBS_CELLS - VERB_GAP
  return (
    <Box flexDirection="row" gap={VERB_GAP}>
      <Button key={`card:${id}:keep`} plain onPress={() => actions.keep(id)}>Keep</Button>
      <Button key={`card:${id}:steer`} plain onPress={() => actions.steer(id)}>Steer</Button>
      <Button key={`card:${id}:kill`} plain onPress={() => actions.kill(id)}>Kill</Button>
      {hasFix && fix >= MIN_FIX_CELLS ? textBlock(ui, `${GLYPHS.fix} ${card.fix}`, fix, VALUE_ROWS, true) : null}
    </Box>
  )
}

/** The details behind 'i': why, the fix, what Kill sends, and up to three evidence quotes. */
const detailRows = (ui: Ui, card: Card, cells: number): RenderElement[] => {
  const value = Math.max(8, cells - GUTTER)
  return [
    gutterRow(ui, 'why', textBlock(ui, card.why, value, VALUE_ROWS)),
    gutterRow(ui, 'fix', textBlock(ui, card.fix, value, VALUE_ROWS)),
    gutterRow(ui, `kill ${GLYPHS.fix}`, textBlock(ui, `"${card.killText}"`, value, VALUE_ROWS)),
    ...card.evidence.slice(0, EVIDENCE_ROWS).map((quote, at) =>
      gutterRow(ui, at === 0 ? 'evidence' : '', fit(quote, value)),
    ),
  ]
}

/** The Steer field and its hint, opened in place under the verbs. */
const steerRows = (ui: Ui, card: Card, draft: string | null, actions: Actions, cells: number): RenderElement[] => {
  const { Input } = ui
  const id = card.patternId
  const value = Math.max(8, cells - GUTTER)
  return [
    gutterRow(ui, GLYPHS.field, (
      <Input
        key={`card:${id}:text`}
        value={draft ?? card.fix}
        submitLabel="send"
        autoFocus
        onInput={(text: string) => actions.steerDraft(text)}
        onSubmit={(text: string) => actions.steerSubmit(id, text)}
      />
    )),
    gutterRow(ui, '', textBlock(ui, STEER_HINT, value, 1, true)),
  ]
}

/** One waster: its title, its stats or its details, its verbs, and the Steer field when open. */
const wasterBlock = (ui: Ui, card: Card, model: PaneModel, actions: Actions, cells: number): RenderElement => {
  const { Box, Text } = ui
  const isExpanded = model.expanded === card.patternId
  const isSteering = model.steering === card.patternId
  const body = cells - GLYPH_CELLS   // the block's rows hang under the title, past the dot
  return (
    <Box flexDirection="column">
      {titleRow(ui, card, actions, cells)}
      <Box flexDirection="column" paddingLeft={GLYPH_CELLS}>
        {isExpanded
          ? detailRows(ui, card, body)
          : <Text dimColor wrap="truncate-end">{fit(card.stats, body)}</Text>}
        {verbsRow(ui, card, actions, body, !isExpanded)}
        {isSteering ? steerRows(ui, card, model.steerDraft, actions, body) : null}
      </Box>
    </Box>
  )
}

/** One further waster on the inline pane: a dim line with its dot and its count. */
const compactRow = (ui: Ui, card: Card, cells: number): RenderElement => {
  const { Text } = ui
  const first = card.stats.split(' · ')[0] ?? ''
  const hits = HITS.test(first) ? first : null   // only a hit count; another stats order degrades to nothing
  const room = hits === null ? cells : Math.max(8, cells - hits.length - 3)
  return (
    <Text dimColor wrap="truncate-end">{joined([fit(`${GLYPHS.live} ${card.kind}`, room), hits])}</Text>
  )
}

/** The quiet pane: one dim sentence and the judge's button beneath it. */
const emptySection = (ui: Ui, header: Header, actions: Actions): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{EMPTY_TEXT}</Text>
      <Box flexDirection="row">{checkButton(ui, header, actions)}</Box>
    </Box>
  )
}

/** The wasters, newest first: in full on the docked pane, the newest in full on the inline one. */
const wastersSection = (
  ui: Ui,
  model: PaneModel,
  actions: Actions,
  cells: number,
  isCompact: boolean,
): RenderElement => {
  const { Box } = ui
  const [newest, ...rest] = model.wasters
  const room = Math.max(0, PANE_INLINE_ROWS - INLINE_HEAD_ROWS)
  return newest === undefined ? emptySection(ui, model.header, actions) : (
    <Box flexDirection="column" paddingX={1}>
      {wasterBlock(ui, newest, model, actions, cells)}
      {isCompact
        ? rest.slice(0, room).map(card => compactRow(ui, card, cells))
        : rest.map(card => [blank(ui), wasterBlock(ui, card, model, actions, cells)])}
    </Box>
  )
}

/** One decided pattern: its glyph, its behaviour, what it saved and whether it was ignored. */
const decidedRow = (ui: Ui, row: DecidedRow, isFirst: boolean, cells: number): RenderElement =>
  gutterRow(ui, isFirst ? 'DECIDED' : '', fit(joined([
    `${DECIDED_GLYPH[row.choice]} ${row.kind}`,
    row.savedPct === null || row.savedPct <= 0 ? null : `saved ~${row.savedPct}%`,
    row.ignored > 0 ? `ignored ${row.ignored}×` : null,
  ]), Math.max(8, cells - GUTTER)))

/** One proposed rule: its title and kind, with Write, Try and Skip at the right edge. */
const artifactRow = (ui: Ui, artifact: Artifact, isFirst: boolean, actions: Actions, cells: number): RenderElement => {
  const { Box, Button } = ui
  const id = artifact.patternId
  const value = Math.max(8, cells - GUTTER - RULES_CELLS - CONTROL_GAP)
  return (
    <Box flexDirection="row" justifyContent="space-between" width={cells}>
      <Box width={GUTTER + value}>
        {gutterRow(ui, isFirst ? 'RULES' : '', fit(joined([artifact.title, ARTIFACT_LABEL[artifact.kind]]), value))}
      </Box>
      <Box flexDirection="row" gap={2}>
        <Button key={`write:${id}`} plain onPress={() => actions.write(artifact)}>Write</Button>
        {TRYABLE.includes(artifact.kind)
          ? <Button key={`try:${id}`} plain onPress={() => actions.tryOnce(artifact)}>Try</Button>
          : null}
        <Button key={`skip:${id}`} plain dimColor onPress={() => actions.skip(artifact)}>Skip</Button>
      </Box>
    </Box>
  )
}

/** The footer: the decisions and the proposed rules, one line each; a count line when compact. */
const footerSection = (
  ui: Ui,
  model: PaneModel,
  actions: Actions,
  cells: number,
  isCompact: boolean,
): RenderElement | null => {
  const { Box, Text } = ui
  if (model.decided.length === 0 && model.artifacts.length === 0) return null
  return (
    <Box flexDirection="column" paddingX={1}>
      {rule(ui, cells)}
      {isCompact
        ? (
          <Text dimColor wrap="truncate-end">
            {fit(joined([`DECIDED ${model.decided.length}`, `RULES ${model.artifacts.length}`, FULL_PANE_HINT]), cells)}
          </Text>
        )
        : [
          ...model.decided.map((row, at) => decidedRow(ui, row, at === 0, cells)),
          ...model.artifacts.map((artifact, at) => artifactRow(ui, artifact, at === 0, actions, cells)),
        ]}
    </Box>
  )
}

/** The band's segments, the ones that carry nothing left out. */
const bandSegments = (model: BandModel): { text: string; isFresh?: true }[] => [
  ...(model.percent !== null && model.percent > 0 ? [{ text: `${Math.round(model.percent)}%` }] : []),
  ...(model.tokensToCompaction !== null && model.tokensToCompaction > 0
    ? [{ text: `${kilo(model.tokensToCompaction)} to compaction` }]
    : []),
  ...(model.fresh > 0 ? [{ text: `${model.fresh} new`, isFresh: true as const }] : []),
  ...(model.savedPct > 0 ? [{ text: `saved ~${model.savedPct}%` }] : []),
]

/** The AbovePrompt band: one line of session state and the pane's own button. */
export function Band(props: BandProps): RenderElement {
  const { ui, model, site, actions } = props
  const { Box, Text, Button } = ui
  const label = model.paneOpen ? 'Close' : 'Open'
  const cells = Math.max(MIN_CELLS, site.bodyColumns - BAND_RESERVE)   // the engine draws its own '[-]' past them
  return (
    <Box flexDirection="row" width={cells} justifyContent="space-between">
      <Box width={cells - label.length - CONTROL_GAP}>
        <Text wrap="truncate-end">
          <Text dimColor>{PANE_TITLE}</Text>
          {bandSegments(model).map((segment, at) =>
            segment.isFresh === true
              ? <Text color={ACCENT}>{`${at === 0 ? '  ' : ' · '}${segment.text}`}</Text>
              : `${at === 0 ? '  ' : ' · '}${segment.text}`,
          )}
        </Text>
      </Box>
      <Button key="toggle" plain onPress={() => actions.togglePane()}>{label}</Button>
    </Box>
  )
}

/** The ContextSaver pane: the header, the live wasters with their verbs, then decisions and rules. */
export function Pane(props: PaneProps): RenderElement {
  const { ui, model, site, placement, actions } = props
  const { Box } = ui
  const cells = Math.max(MIN_CELLS, site.bodyColumns - 2)
  const isCompact = placement === 'inline'
  const hasWasters = model.wasters.length > 0
  return (
    <Box flexDirection="column">
      {headerSection(ui, model.header, actions, cells, isCompact, hasWasters)}
      {wastersSection(ui, model, actions, cells, isCompact)}
      {footerSection(ui, model, actions, cells, isCompact)}
    </Box>
  )
}
