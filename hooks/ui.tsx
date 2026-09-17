/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import { collapseWs, duration, fit, gauge, kilo, tokensOf } from './core/text'
import { NO_CALLS, PANE_INLINE_ROWS, PANE_TITLE } from './core/types'
import type {
  Actions,
  Artifact,
  ArtifactKind,
  BandModel,
  BandProps,
  Card,
  Choice,
  DecidedRow,
  Evidence,
  Header,
  PaneModel,
  PaneProps,
  Ui,
} from './core/types'

// Layout numbers of this drawing only. §9.12 puts constants in types.ts; types.ts is the shared
// contract and carries no layout cells, so these stay private to the drawing (README "Theme"
// records the divergence; hoisting them is WP6's call at integration).
const ACCENT = 'suggestion'   // the theme's accent key (the engine's own suggestion blue and gauge fill)
const GUTTER = 10             // cells of the dim label column inside an opened card
const NUMBER_CELLS = 3        // the card's dim number and the space after it (two digits and their space fit)
const GLYPH_CELLS = 2         // the waster's '●' and the space after it
const CALL_GAP = 3            // cells between the columns of an evidence row
const CALL_MIN_WHAT = 8       // cells the command or path keeps before the cost is dropped whole
const CALL_SEP = ' · '        // between a cited call's wall time and its size
const CALL_UNIT = ' ch'       // the unit the widest rung of the cost ladder spells out
const QUOTE_MAX = 60          // characters of a result quoted under the call that produced it
const FIX_CELLS = 2           // the fix row's '→' and the space after it
const FIELD_CELLS = 2         // the Steer row's '›' and the space after it
const CARD_PAD = 2            // paddingX inside a card's border
const CARD_CHROME = 6         // what a card's border and padding cost a row: 2 + 2 × 2
const HEAD_INDENT = 1 + CARD_PAD   // cells the un-framed sections add to paddingX to start at the cards' content column
const GAUGE_MAX = 16          // §5.5's gauge(percent, 16); it never grows past this, however wide the pane is
const GAUGE_MIN = 8
const GAUGE_RESERVE = 6       // cells the gauge row leaves for the two spaces and the percent
const VERB_GAP = 3
const RULES_CELLS = 18        // 'Write' + 'Try' + 'Skip' and the gaps around them
const RULES_MIN_TITLE = 8     // a rule's title keeps this many cells before its kind label is dropped whole
const CHECK_CELLS = 10        // 'Check now'
const INFO_CELLS = 1          // 'i'
const CONTROL_GAP = 2         // cells between a row's text and the Button at its right edge
const BAND_RESERVE = 4        // cells the engine's own collapse control '[-]' takes at the band's right edge
const TITLE_ROWS = 2
const VALUE_ROWS = 2          // rows the fix keeps under the verbs
const DETAIL_ROWS_MAX = 4     // rows `why` and `fix` each keep inside the opened details
const MIN_CELLS = 24
const MIN_ROWS = 8            // however little the surface grants the inline pane, it is budgeted for this
const HEAD_ROWS = 3           // the inline header's own rows: the label, the gauge and the blank under them
const FOOT_ROWS = 2           // the inline footer's own rows: the blank and the counts line
const CARD_BORDER_ROWS = 2    // the card's own '╭───╮' and '╰───╯'
const VERBS_ROWS = 1
const STEER_ROWS = 2          // the field and its hint
const COMPACT_ROWS = 1        // rows a value or a cited call gets inside the inline card
const DETAIL_ROWS = 3         // 'why', 'fix' and the summary row before the cited calls
const STAT_ROWS = 2           // the stats line and the fix line of a folded card
const GLYPHS = { live: '●', kept: '✓', steered: '↪', killed: '✕', fix: '→', field: '›', quote: '↳' } as const
const DECIDED_GLYPH: Record<Choice, string> = { keep: GLYPHS.kept, steer: GLYPHS.steered, kill: GLYPHS.killed }
const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  'claude-md': 'CLAUDE.md',
  skill: 'skill',
  'agent-brief': 'agent brief',
  'settings-allow': 'permission rule',
}
const TRYABLE: readonly ArtifactKind[] = ['claude-md', 'skill', 'agent-brief']
const HITS = /^\d+×$/               // a stats segment that is a hit count, e.g. '3×'
const CONTEXT_LABEL = 'Context'
const SAVED_LABEL = 'Saved '
const JUDGE_LABEL = 'Judge '
const DECIDED_LABEL = 'Decided'
const RULES_LABEL = 'Rules for next session'
const STEER_HINT = 'Enter sends · Steer again closes · longer: /saver steer <n> <text>'
const EMPTY_TEXT = 'Watching quietly. Nothing repeating yet.'
const AWAITING_TEXT = 'awaiting the first turn'
const FULL_PANE_HINT = '/saver for the full pane'
const VERBS_HINT = '/saver keep|steer|kill <n>'   // the keyboard route to the verbs, for a pane the Tab ring never reaches

// The cells one card's cited calls are laid out against: three columns, the cost's own rung of the ladder.
type CallColumns = { turn: number; what: number; alias: number; time: number; unit: boolean; cost: boolean }

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

/** One row of an opened card: a dim label in the 10-cell gutter, the value in the content column. */
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

/** One row indented behind a two-cell glyph, its continuation lines under the text. */
const glyphRow = (ui: Ui, glyph: string, value: RenderElement): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row">
      <Box width={FIX_CELLS}><Text dimColor>{glyph}</Text></Box>
      {value}
    </Box>
  )
}

/** A blank row between blocks. */
const blank = (ui: Ui): RenderElement => {
  const { Box } = ui
  return <Box height={1} />
}

/** How wide the header's gauge is drawn: the spec's 16 cells, never past what the row leaves it. */
const gaugeCells = (cells: number): number =>
  Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, cells - GAUGE_RESERVE))

/** The gauge row: accent cells for the context used, dim for what is left, then the percentage in bold. */
const gaugeRow = (ui: Ui, percent: number, cells: number): RenderElement => {
  const { Text } = ui
  const drawn = gauge(percent, gaugeCells(cells))
  const filled = drawn.replace(/░+$/, '')
  return (
    <Text wrap="truncate-end">
      <Text color={ACCENT}>{filled}</Text>
      <Text dimColor>{drawn.slice(filled.length)}</Text>
      {'  '}
      <Text bold>{`${Math.round(percent)}%`}</Text>
    </Text>
  )
}

/** The run to compaction, in tokens and in turns; segments are dropped whole rather than cut. */
const compactionText = (header: Header, room: number): string => {
  const near = header.tokensToCompaction === null || header.tokensToCompaction <= 0
    ? null
    : `${kilo(header.tokensToCompaction)} tokens to compaction`
  const turns = near !== null && header.turnsToCompaction !== null && header.turnsToCompaction > 0
    ? `about ${header.turnsToCompaction} turn${header.turnsToCompaction === 1 ? '' : 's'}`
    : null
  return [joined([near, turns]), joined([near])].find(text => text.length <= room) ?? ''
}

/** What the status row draws: the savings, the judge's figures, or as much of them as the row holds. */
const statusTexts = (header: Header, room: number): { saved: string; judge: string } => {
  const pct = header.savedPct > 0 ? `~${header.savedPct}%` : null
  const ms = header.savedMs > 0 ? duration(header.savedMs) : null
  const runs = `${header.judgeRuns} run${header.judgeRuns === 1 ? '' : 's'}`
  // A judge that has not run yet is not a figure: 'Check now' already says the run is there to be had.
  const judge = header.judgeRuns === 0 ? '' : joined([runs, header.judgeTokens > 0 ? kilo(header.judgeTokens) : null])
  const cells = (row: { saved: string; judge: string }): number =>
    (row.saved === '' ? 0 : SAVED_LABEL.length + row.saved.length)
    + (row.judge === '' ? 0 : JUDGE_LABEL.length + row.judge.length)
    + (row.saved !== '' && row.judge !== '' ? CONTROL_GAP : 0)
  const ladder = [
    { saved: joined([pct, ms]), judge },
    { saved: joined([pct, ms]), judge: '' },
    { saved: joined([pct ?? ms]), judge: '' },
    { saved: '', judge: '' },
  ]
  return ladder.find(row => cells(row) <= room) ?? { saved: '', judge: '' }
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

/** The header's second block: what the session saved, what the judge cost, and 'Check now' at the right edge. */
const statusRow = (ui: Ui, header: Header, actions: Actions, cells: number): RenderElement => {
  const { Box, Text } = ui
  const room = Math.max(8, cells - CHECK_CELLS - CONTROL_GAP)
  const { saved, judge } = statusTexts(header, room)
  // Whatever the row has kept starts at the left edge; the button holds the right one on its own.
  return (
    <Box flexDirection="row" width={cells} justifyContent="space-between">
      {saved === '' && judge === '' ? <Box flexGrow={1} /> : null}
      {saved === ''
        ? null
        : (
          <Box width={SAVED_LABEL.length + saved.length}>
            <Text wrap="truncate-end"><Text dimColor>{SAVED_LABEL}</Text>{saved}</Text>
          </Box>
        )}
      {judge === ''
        ? null
        : (
          <Box width={JUDGE_LABEL.length + judge.length}>
            <Text dimColor wrap="truncate-end">{`${JUDGE_LABEL}${judge}`}</Text>
          </Box>
        )}
      {checkButton(ui, header, actions)}
    </Box>
  )
}

/** Rows the inline header draws: its three own rows, and the compaction line when it carries one. */
const headRows = (header: Header, cells: number): number =>
  HEAD_ROWS + (header.percent !== null && compactionText(header, cells) !== '' ? 1 : 0)

/** The header: the label, the gauge and the run to compaction, then the savings and the judge. */
const headerSection = (
  ui: Ui,
  header: Header,
  actions: Actions,
  cells: number,
  isCompact: boolean,
): RenderElement => {
  const { Box, Text } = ui
  const compaction = header.percent === null ? '' : compactionText(header, cells)
  // Indented to the cards' content column, so the labels and the card titles start at one x.
  return (
    <Box flexDirection="column" paddingX={1 + HEAD_INDENT}>
      <Text dimColor wrap="truncate-end">{CONTEXT_LABEL}</Text>
      {header.percent === null
        ? <Text dimColor wrap="truncate-end">{fit(AWAITING_TEXT, cells)}</Text>
        : gaugeRow(ui, header.percent, cells)}
      {compaction === '' ? null : <Text dimColor wrap="truncate-end">{compaction}</Text>}
      {isCompact ? null : [blank(ui), statusRow(ui, header, actions, cells)]}
      {blank(ui)}
    </Box>
  )
}

/** The cells a title row has once the 'i' Button and the gap before it are reserved. */
const titleValue = (cells: number): number =>
  Math.max(NUMBER_CELLS + GLYPH_CELLS + 8, cells - INFO_CELLS - CONTROL_GAP)

/** A waster's title row: its number, the accent dot, the behaviour in bold, and 'i' at the right edge. */
const titleRow = (ui: Ui, card: Card, actions: Actions, cells: number): RenderElement => {
  const { Box, Text, Button } = ui
  const value = titleValue(cells)
  const title = value - NUMBER_CELLS - GLYPH_CELLS
  return (
    <Box flexDirection="row" width={cells} justifyContent="space-between">
      <Box flexDirection="row" width={value}>
        <Box width={NUMBER_CELLS}><Text dimColor wrap="truncate-end">{`${card.n}`}</Text></Box>
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

/** The action row: Keep, Steer and Kill, three cells apart. */
const verbsRow = (ui: Ui, card: Card, actions: Actions): RenderElement => {
  const { Box, Button } = ui
  const id = card.patternId
  return (
    <Box flexDirection="row" gap={VERB_GAP}>
      <Button key={`card:${id}:keep`} plain onPress={() => actions.keep(id)}>Keep</Button>
      <Button key={`card:${id}:steer`} plain onPress={() => actions.steer(id)}>Steer</Button>
      <Button key={`card:${id}:kill`} plain onPress={() => actions.kill(id)}>Kill</Button>
    </Box>
  )
}

/** The widest of the texts, in cells. */
const widest = (texts: readonly string[]): number => texts.reduce((n, text) => Math.max(n, text.length), 0)

/** The wall time of a cited call as its row draws it; '' when nothing measured it (a turn, a rebuilt row). */
const callTime = (e: Evidence): string => (e.what === NO_CALLS || e.ms <= 0 ? '' : duration(e.ms))

/**
 * What one cited call cost: its wall time right-aligned in the card's shared time column, then its size —
 * the unit spelled out while the row holds it. A row nothing timed keeps the column, so the sizes read as one.
 */
const callMeta = (e: Evidence, time: number, hasUnit: boolean): string => {
  const size = e.what === NO_CALLS ? `${kilo(e.chars)} answer` : `${kilo(e.chars)}${hasUnit ? CALL_UNIT : ''}`
  if (time === 0) return size
  const spent = callTime(e)
  return spent === '' ? `${' '.repeat(time + CALL_SEP.length)}${size}` : `${spent.padStart(time)}${CALL_SEP}${size}`
}

/**
 * The columns every cited call of one card shares, so its sizes line up under each other: the unit,
 * then the alias, then the cost dropped whole while the widest row cannot hold them.
 */
const callColumns = (evidence: readonly Evidence[], cells: number): CallColumns => {
  const turn = widest(evidence.map(e => `turn ${e.turn}`))
  const alias = widest(evidence.map(e => e.agent ?? ''))
  const time = widest(evidence.map(callTime))
  const bare = { turn, alias: 0, time: 0, unit: false, cost: false }
  const ladder = [
    { turn, alias, time, unit: true, cost: true },
    { turn, alias, time, unit: false, cost: true },
    { turn, alias: 0, time, unit: false, cost: true },
    bare,
  ]
  const fixed = (c: Omit<CallColumns, 'what'>): number =>
    c.turn + CALL_GAP
    + (c.alias === 0 ? 0 : c.alias + CALL_GAP)
    + (c.cost ? widest(evidence.map(e => callMeta(e, c.time, c.unit))) + CALL_GAP : 0)
  const chosen = ladder.find(c => fixed(c) + CALL_MIN_WHAT <= cells) ?? bare
  return { ...chosen, what: Math.max(1, Math.min(widest(evidence.map(e => e.what)), cells - fixed(chosen))) }
}

/** The cells one evidence row draws, laid out against the card's shared columns. */
const callCells = (e: Evidence, cols: CallColumns): { turn: string; what: string; alias: string; meta: string } => ({
  turn: `turn ${e.turn}`.padEnd(cols.turn),
  what: fit(e.what, cols.what).padEnd(cols.what),
  alias: cols.alias === 0 ? '' : (e.agent ?? '').padEnd(cols.alias),
  meta: cols.cost ? callMeta(e, cols.time, cols.unit) : '',
})

/** One cited call: the turn, what ran, the loop it ran in, what it cost — then the head of what came back. */
const callBlock = (ui: Ui, e: Evidence, cols: CallColumns, cells: number, isCompact: boolean): RenderElement[] => {
  const { Text } = ui
  const { turn, what, alias, meta } = callCells(e, cols)
  const gap = ' '.repeat(CALL_GAP)
  return [
    <Text wrap="truncate-end">
      <Text dimColor>{`${turn}${gap}`}</Text>
      {what}
      {alias === '' ? null : <Text dimColor>{`${gap}${alias}`}</Text>}
      {meta === '' ? null : <Text dimColor>{`${gap}${meta}`}</Text>}
    </Text>,
    // The quote is the receipt: it is dropped when the seat is tight, or when nothing came back to quote.
    ...(isCompact || e.head === ''
      ? []
      : [<Text dimColor wrap="truncate-end">{fit(`${GLYPHS.quote} "${fit(e.head, QUOTE_MAX)}"`, cells)}</Text>]),
  ]
}

/** The one dim summary row of the details: what the cited evidence adds up to, in the unit the model counted. */
const totalText = (card: Card): string => {
  const { unit, calls, ms, chars } = card.total
  const plural = calls === 1 ? '' : 's'
  // A behavioural card counts turns and states what the judge estimates each one costs; the unit is
  // the model's to say, never inferred from the evidence the details happened to keep.
  return unit === 'turns'
    ? joined([`${calls} turn${plural}`, chars > 0 ? `~${kilo(tokensOf(chars))} tokens per turn` : null])
    : joined([`${calls} call${plural}`, ms > 0 ? duration(ms) : null, `${kilo(chars)} chars of context`])
}

/** The details behind 'i': why, the fix, the summary, and the calls behind the claim. */
const detailRows = (ui: Ui, card: Card, cells: number, isCompact: boolean): RenderElement[] => {
  const { Text } = ui
  const value = Math.max(8, cells - GUTTER)
  // Inline every value is one row and one call, so each row of the card's budget holds one of them.
  const rows = isCompact ? COMPACT_ROWS : DETAIL_ROWS_MAX
  const calls = isCompact ? COMPACT_ROWS : card.evidence.length
  // The columns are measured over the calls this drawing shows, so they hold whatever it draws.
  const shown = card.evidence.slice(0, calls)
  const cols = callColumns(shown, cells)
  return [
    gutterRow(ui, 'why', textBlock(ui, card.why, value, rows)),
    gutterRow(ui, 'fix', textBlock(ui, card.fix, value, rows)),
    ...(card.total.calls === 0 ? [] : [<Text dimColor wrap="truncate-end">{fit(totalText(card), cells)}</Text>]),
    ...shown.flatMap(e => callBlock(ui, e, cols, cells, isCompact)),
  ]
}

/** The Steer field and its hint, opened in place under the verbs. */
const steerRows = (ui: Ui, card: Card, draft: string | null, actions: Actions, cells: number): RenderElement[] => {
  const { Box, Input, Text } = ui
  const id = card.patternId
  const value = Math.max(8, cells - FIELD_CELLS)
  return [
    glyphRow(ui, GLYPHS.field, (
      <Box flexGrow={1}>
        <Input
          key={`card:${id}:text`}
          value={draft ?? card.fix}
          submitLabel="send"
          autoFocus
          onInput={(text: string) => actions.steerDraft(text)}
          onSubmit={(text: string) => actions.steerSubmit(id, text)}
        />
      </Box>
    )),
    glyphRow(ui, '', <Text dimColor wrap="truncate-end">{fit(STEER_HINT, value)}</Text>),
  ]
}

/** Content rows an inline card would draw were the seat wide enough: its details, or its stats and fix. */
const cardContentRows = (card: Card, model: PaneModel): number =>
  model.expanded === card.patternId
    ? DETAIL_ROWS + Math.min(card.evidence.length, COMPACT_ROWS)
    : STAT_ROWS

/** Rows an inline card spends on everything but its content: the border, the title, the verbs, the field. */
const cardFixedRows = (card: Card, model: PaneModel, cells: number): number =>
  CARD_BORDER_ROWS
  + linesOf(card.kind, titleValue(cells - CARD_CHROME) - NUMBER_CELLS - GLYPH_CELLS, TITLE_ROWS).length
  + VERBS_ROWS
  + (model.steering === card.patternId ? STEER_ROWS : 0)

/**
 * What a card holds: its title, the stats and the fix or the details behind `i`, the verbs, the field.
 * `budget` is the content rows an inline seat leaves — null when the engine scrolls the card instead.
 */
const cardRows = (
  ui: Ui,
  card: Card,
  model: PaneModel,
  actions: Actions,
  cells: number,
  budget: number | null,
): RenderElement[] => {
  const { Text } = ui
  const isCompact = budget !== null
  const isExpanded = model.expanded === card.patternId
  const isSteering = model.steering === card.patternId
  const spacer = isCompact ? [] : [blank(ui)]
  const content = isExpanded
    ? detailRows(ui, card, cells, isCompact)
    : [
      <Text dimColor wrap="truncate-end">{fit(card.stats, cells)}</Text>,
      glyphRow(ui, GLYPHS.fix, textBlock(ui, card.fix, cells - FIX_CELLS, isCompact ? COMPACT_ROWS : VALUE_ROWS, true)),
    ]
  const verbs = [
    verbsRow(ui, card, actions),
    ...(isSteering ? steerRows(ui, card, model.steerDraft, actions, cells) : []),
  ]
  // Inline the verbs and the field come first, so what the seat cannot hold is detail rather than a verb.
  return isCompact
    ? [titleRow(ui, card, actions, cells), ...verbs, ...content.slice(0, Math.max(0, budget))]
    : [titleRow(ui, card, actions, cells), ...spacer, ...content, ...spacer, ...verbs]
}

/** One waster as a card: the newest bordered in the accent, the ones behind it dim. */
const cardBlock = (
  ui: Ui,
  card: Card,
  model: PaneModel,
  actions: Actions,
  cells: number,
  isNewest: boolean,
  budget: number | null,
): RenderElement => {
  const { Box } = ui
  const rows = cardRows(ui, card, model, actions, cells - CARD_CHROME, budget)
  return isNewest
    ? <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={CARD_PAD}>{rows}</Box>
    : <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={CARD_PAD}>{rows}</Box>
}

/** One further waster on the inline pane: a dim line with its number, its dot and its count. */
const compactRow = (ui: Ui, card: Card, cells: number): RenderElement => {
  const { Text } = ui
  const first = card.stats.split(' · ')[0] ?? ''
  const hits = HITS.test(first) ? first : null   // only a hit count; another stats order degrades to nothing
  const room = hits === null ? cells : Math.max(8, cells - hits.length - 3)
  return (
    <Text dimColor wrap="truncate-end">{joined([fit(`${card.n} ${GLYPHS.live} ${card.kind}`, room), hits])}</Text>
  )
}

/** The quiet pane: one dim sentence in a dim frame ('Check now' stays in the header). */
const emptySection = (ui: Ui, cells: number): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderDimColor paddingX={CARD_PAD}>
        <Text dimColor wrap="truncate-end">{fit(EMPTY_TEXT, cells - CARD_CHROME)}</Text>
      </Box>
    </Box>
  )
}

/**
 * The wasters, newest first: cards on the docked pane, the newest compact on the inline one.
 * `rows` is the seat the inline pane has left — null when the engine scrolls the whole list instead.
 */
const wastersSection = (
  ui: Ui,
  model: PaneModel,
  actions: Actions,
  cells: number,
  rows: number | null,
): RenderElement => {
  const { Box } = ui
  const [newest, ...rest] = model.wasters
  if (newest === undefined) return emptySection(ui, cells)
  // The card is budgeted against the seat first; whatever it does not need folds the wasters behind it.
  const fixed = rows === null ? 0 : cardFixedRows(newest, model, cells)
  const budget = rows === null ? null : Math.max(0, rows - fixed)
  const drawn = fixed + Math.min(budget ?? 0, cardContentRows(newest, model))
  const room = rows === null ? 0 : Math.max(0, rows - drawn)
  return (
    <Box flexDirection="column" paddingX={1}>
      {cardBlock(ui, newest, model, actions, cells, true, budget)}
      {rows === null
        ? rest.map(card => [blank(ui), cardBlock(ui, card, model, actions, cells, false, null)])
        : rest.slice(0, room).map(card => compactRow(ui, card, cells))}
    </Box>
  )
}

/** What a decision is worth: a rate while it is only projected, a credit once the saving settled (D4). */
const creditText = (row: DecidedRow): string => {
  if (row.savedPct === null || row.savedPct <= 0) return ''
  return row.settled ? `saved ~${row.savedPct}%` : `~${row.savedPct}% per repeat`
}

/** One decided pattern: its glyph and behaviour, what it is worth, and the sentence the user sent. */
const decidedRow = (ui: Ui, row: DecidedRow, cells: number): RenderElement => {
  const { Box, Text } = ui
  const right = row.ignored > 0 ? `ignored ${row.ignored}×` : creditText(row)
  const value = Math.max(8, cells - right.length - CONTROL_GAP)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" width={cells} justifyContent="space-between">
        <Box width={value}>
          <Text wrap="truncate-end">{fit(`${DECIDED_GLYPH[row.choice]} ${row.kind}`, value)}</Text>
        </Box>
        {right === '' ? null : <Box width={right.length}><Text dimColor>{right}</Text></Box>}
      </Box>
      {row.instruction === null
        ? null
        : glyphRow(ui, GLYPHS.field, (
          <Text dimColor wrap="truncate-end">{fit(collapseWs(row.instruction), Math.max(8, cells - FIELD_CELLS))}</Text>
        ))}
    </Box>
  )
}

/** One proposed rule: its title and kind, with Write, Try and Skip at the right edge. */
const artifactRow = (ui: Ui, artifact: Artifact, actions: Actions, cells: number): RenderElement => {
  const { Box, Text, Button } = ui
  const id = artifact.patternId
  const kind = ` · ${ARTIFACT_LABEL[artifact.kind]}`
  const value = Math.max(8, cells - RULES_CELLS - CONTROL_GAP)
  // A cut filename is a wrong filename: the kind label goes whole, and only the title is truncated.
  const label = value < kind.length + RULES_MIN_TITLE ? '' : kind
  return (
    <Box flexDirection="row" width={cells} justifyContent="space-between">
      <Box width={value}>
        <Text wrap="truncate-end">
          {fit(artifact.title, Math.max(1, value - label.length))}
          <Text dimColor>{label}</Text>
        </Text>
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

/** The footer: the decisions and the proposed rules, one row each; one count line when compact. */
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
    <Box flexDirection="column" paddingX={1 + HEAD_INDENT}>
      {isCompact
        ? [
          blank(ui),
          <Text dimColor wrap="truncate-end">
            {fit(joined([`${DECIDED_LABEL} ${model.decided.length}`, `Rules ${model.artifacts.length}`, FULL_PANE_HINT]), cells)}
          </Text>,
        ]
        : [
          ...(model.decided.length === 0
            ? []
            : [
              blank(ui),
              <Text dimColor wrap="truncate-end">{DECIDED_LABEL}</Text>,
              ...model.decided.map(row => decidedRow(ui, row, cells)),
            ]),
          ...(model.artifacts.length === 0
            ? []
            : [
              blank(ui),
              <Text dimColor wrap="truncate-end">{fit(RULES_LABEL, cells)}</Text>,
              ...model.artifacts.map(artifact => artifactRow(ui, artifact, actions, cells)),
            ]),
        ]}
    </Box>
  )
}

/** The pane's last row: the verbs by number, since nothing else on screen says they can be typed. */
const hintSection = (ui: Ui, cells: number): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingX={1 + HEAD_INDENT}>
      {blank(ui)}
      <Text dimColor wrap="truncate-end">{fit(VERBS_HINT, cells)}</Text>
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

/** The ContextSaver pane: the header, the live wasters as cards, then decisions and rules. */
export function Pane(props: PaneProps): RenderElement {
  const { ui, model, site, placement, actions } = props
  const { Box } = ui
  const cells = Math.max(MIN_CELLS, site.bodyColumns - 2)
  const indented = Math.max(MIN_CELLS - 2 * HEAD_INDENT, cells - 2 * HEAD_INDENT)
  const isCompact = placement === 'inline'
  // Inline the drawing is budgeted against the seat the surface really granted, never against a constant.
  const seat = Math.max(MIN_ROWS, Math.min(site.maxRows, PANE_INLINE_ROWS))
  const foot = model.decided.length === 0 && model.artifacts.length === 0 ? 0 : FOOT_ROWS
  const rows = isCompact ? Math.max(0, seat - headRows(model.header, indented) - foot) : null
  // The command hint is the docked pane's last row: inline the seat is counted in rows and the
  // footer already names a command, and with no card listed there is no number to type.
  const isHinted = !isCompact && model.wasters.length > 0
  return (
    <Box flexDirection="column">
      {headerSection(ui, model.header, actions, indented, isCompact)}
      {wastersSection(ui, model, actions, cells, rows)}
      {footerSection(ui, model, actions, indented, isCompact)}
      {isHinted ? hintSection(ui, indented) : null}
    </Box>
  )
}
