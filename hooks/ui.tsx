/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import { logoCells } from './core/logo'
import { collapseWs, duration, fit, gauge, kilo, padCells, tokensOf, widthOf } from './core/text'
import { sparkline } from './core/trend'
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
import { say } from './say'

// Layout numbers of this drawing only. §9.12 puts constants in types.ts; types.ts is the shared
// contract and carries no layout cells, so these stay private to the drawing (README "Theme"
// records the divergence; hoisting them is WP6's call at integration).
//
// The theme keys under `TONES`: `suggestion` is confirmed live, the other three are probed by the
// design QA. One table, so a key the engine refuses is flipped to the accent in one place.
const TONES = { accent: 'suggestion', good: 'success', warm: 'warning', hot: 'error' } as const
const GAUGE_WARM = 70         // the fill turns warm at this share of the window, and hot past GAUGE_HOT
const GAUGE_HOT = 90
const GUTTER = 10             // cells of the dim label column inside an opened card
const NUMBER_CELLS = 3        // the card's dim number and the space after it (two digits and their space fit)
const GLYPH_CELLS = 2         // the waster's '●' and the space after it
const CALL_GAP = 3            // cells between the columns of an evidence row
const CALL_MIN_WHAT = 8       // cells the command or path keeps before the cost is dropped whole
const CALL_SEP = ' · '        // between a cited call's wall time and its size
const QUOTE_MAX = 60          // characters of a result quoted under the call that produced it
const FIX_CELLS = 2           // the fix row's '→' and the space after it
const FIELD_CELLS = 2         // the Fix… row's '›' and the space after it
const CARD_PAD = 2            // paddingX inside a card's border
const CARD_CHROME = 6         // what a card's border and padding cost a row: 2 + 2 × 2
const HEAD_INDENT = 1 + CARD_PAD   // cells the un-framed sections add to paddingX to start at the cards' content column
const GAUGE_MAX = 30          // the gauge never grows past this, however wide the header is
const GAUGE_MIN = 8
const TREND_CELLS = 10        // cells the sparkline of `header.trend` draws
const TREND_MIN = 2           // samples before a trend is a shape rather than a dot
const TREND_GAP = 2           // spaces between the gauge and the trend
const LOGO_GAP = 3            // cells between the mark and the header's own column
const LOGO_MIN_CELLS = 40     // header cells below which the mark is dropped whole, like any other segment
const VERB_GAP = 3
const RULES_MIN_TITLE = 8     // a rule's title keeps this many cells before its kind label is dropped whole
const INFO_CELLS = 1          // 'i'
const CONTROL_GAP = 2         // cells between a row's text and the Button at its right edge
const STATUS_GAP = 4          // cells between the pane's name and what the judge has cost beside it
const TAG_MIN_CELLS = 52      // the card's cells at 60 body columns: under that the category tag is dropped
const TITLE_MIN = 8           // cells a card's title keeps whatever else the row reserves
const BAND_RESERVE = 4        // cells the engine's own collapse control '[-]' takes at the band's right edge
const BAND_LEAD = PANE_TITLE.length + 4   // the name, the space before the mark, the mark itself and the two cells after it
const TITLE_ROWS = 2
const VALUE_ROWS = 2          // rows the fix keeps under the verbs
const HINT_MIN = 12           // cells the judge's sentence keeps at the end of a Time or Context row before it is dropped whole
const DETAIL_ROWS_MAX = 4     // rows `why` and `fix` each keep inside the opened details
const MIN_CELLS = 24
const MIN_ROWS = 8            // however little the surface grants the inline pane, it is budgeted for this
const HEAD_ROWS = 5           // rows the inline header spends: the mark's own four cell rows and the blank under them
const LOGO = logoCells()      // packed once: the pane redraws on every ledger row and every keystroke
const FOOT_ROWS = 2           // the inline footer's own rows: the blank and the counts line
const KEYS_ROWS = 1           // the keyboard row the inline seat pays for (docked it takes a blank too)
const EMPTY_ROWS = 3          // the quiet pane's own rows: its frame and the one sentence inside it
const CARD_BORDER_ROWS = 2    // the card's own '╭───╮' and '╰───╯'
const VERBS_ROWS = 1
const STEER_ROWS = 2          // the field and its hint
const COMPACT_ROWS = 1        // rows a value or a cited call gets inside the inline card
const DETAIL_ROWS = 3         // 'why', 'fix' and the summary row before the cited calls
const STAT_ROWS = 2           // the stats line and the fix line of a folded card
const GLYPHS = {
  live: '●', fixed: '✓', noted: '✎', ignored: '–', fix: '→', field: '›', quote: '↳',
  check: '↻', write: '✎', tryOnce: '▸', skip: '–', checking: '◐', watching: '◌', died: '✕',
} as const
const DECIDED_GLYPH: Record<Choice, string> = { keep: GLYPHS.ignored, steer: GLYPHS.noted, kill: GLYPHS.fixed }
// The band's mark, one per state: a dead turn, a run in flight, cards waiting, a saving to show off, or a quiet watch.
const BAND_MARK: Record<BandModel['state'], { text: string; color?: string; isDim?: true }> = {
  died: { text: GLYPHS.died, color: TONES.hot },
  checking: { text: GLYPHS.checking, isDim: true },
  found: { text: GLYPHS.live, color: TONES.accent },
  saved: { text: GLYPHS.fixed, color: TONES.good },
  watching: { text: GLYPHS.watching, isDim: true },
}
const TRYABLE: readonly ArtifactKind[] = ['claude-md', 'skill', 'agent-brief']
const HITS = /^\d+×$/               // a stats segment that is a hit count, e.g. '3×'
const SEP = ' · '                   // between two figures, or between a figure and the sentence about it
const BAND_GAP = '  '                         // cells between the mark and the teaser line
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

// The 'Check now' button: measured off the words in hand rather than counted once, since a translation is
// free to spend more cells on them — and the header reserves whichever of its two labels is the wider.
const checkLabel = (): string => `${GLYPHS.check} ${say().pane.checkNow}`
const checkCells = (): number => Math.max(widthOf(checkLabel()), widthOf(say().pane.checking))

// The row's phrasings, longest first: the verbs by number are given back first, then the keys the Tab ring
// makes obvious once the pane holds them. The chord itself is the one clause a narrow pane keeps.
const keysLines = (): readonly (readonly string[])[] => {
  const { keysFocus, keysMove, keysPress, keysBack } = say().pane
  return [
    [keysFocus, keysMove, keysPress, keysBack],
    [keysFocus, keysMove, keysBack],
    [keysFocus, keysBack],
    [keysFocus],
  ]
}

// The cells one card's cited calls are laid out against: three columns, the cost's own rung of the ladder.
type CallColumns = { turn: number; what: number; alias: number; time: number; unit: boolean; cost: boolean }

// One row of controls as it is drawn: the label on each, and the gap between them.
type Controls = { labels: readonly string[]; gap: number }

/** The cells a row of controls draws: its labels and the gaps between them. */
const controlCells = (row: Controls): number =>
  row.labels.reduce((n, label) => n + widthOf(label), 0) + row.gap * Math.max(0, row.labels.length - 1)

/**
 * A row of controls in the cells it has: the glyphs are given back first, then the gaps between them.
 *
 * The word on a control is the one thing never cut — it is what the person presses, and a verb they have
 * to guess at is a verb they do not press. A translation is free to spend more cells on one than English
 * does, so the row is measured rather than counted once against the words this file happened to be
 * written with.
 */
const controlsFitting = (words: readonly string[], glyphs: readonly string[], gap: number, cells: number): Controls => {
  const marked = words.map((word, at) => `${glyphs[at] ?? ''} ${word}`)
  const bare = { labels: words, gap: 1 }
  const ladder: Controls[] = [{ labels: marked, gap }, { labels: marked, gap: 1 }, { labels: words, gap }, bare]
  return ladder.find(row => controlCells(row) <= cells) ?? bare
}

// One run of the band's teaser: the words and the tone they carry. A segment with neither is plain text.
type BandSegment = { text: string; color?: string; isDim?: true }

/**
 * Breaks a word wider than its row into pieces that fit.
 *
 * Chinese and Japanese are written without spaces, so a whole sentence reaches the wrap as one word: cut
 * here it wraps where those scripts wrap, at a character, instead of arriving as one truncated line. Each
 * full piece then overflows the line it is offered and takes one of its own, so no space is inserted
 * inside a sentence that never had one.
 */
const pieces = (word: string, width: number): string[] => {
  const out: string[] = []
  let piece = ''
  let used = 0
  for (const ch of word) {
    const cells = widthOf(ch)
    if (used + cells > width) {
      out.push(piece)
      piece = ''
      used = 0
    }
    piece += ch
    used += cells
  }
  return piece === '' ? out : [...out, piece]
}

/** Wraps text into at most `rows` lines of `cells` display cells, the last cut with '…'. */
const linesOf = (text: string, cells: number, rows: number): string[] => {
  const width = Math.max(8, cells)
  const lines = collapseWs(text)
    .split(' ')
    .flatMap(word => (widthOf(word) <= width ? [word] : pieces(word, width)))
    .reduce<string[]>((acc, word) => {
      const last = acc[acc.length - 1] ?? ''
      const joined = last === '' ? word : `${last} ${word}`
      return widthOf(joined) <= width ? [...acc.slice(0, -1), joined] : [...acc, word]
    }, [''])
  // Every line is cut to the width, not only the last: a word longer than the row would otherwise
  // reach past whatever frames it, and a card's border is what it pokes through.
  return (lines.length <= rows ? lines : [...lines.slice(0, rows - 1), lines.slice(rows - 1).join(' ')])
    .map(line => fit(line, width))
}

/** Joins the segments that carry something with ' · '. */
const joined = (segments: (string | null)[]): string => segments.filter(s => s !== null && s !== '').join(SEP)

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

/** The cells a gutter row's content column is given. */
const gutterValue = (cells: number): number => Math.max(TITLE_MIN, cells - GUTTER)

/** One row of an opened card: a dim label in the 10-cell gutter, the value in the content column. */
const gutterRow = (ui: Ui, label: string, value: RenderElement, cells: number): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row">
      <Box width={GUTTER}><Text dimColor wrap="truncate-end">{label}</Text></Box>
      <Box flexDirection="column" width={gutterValue(cells)}>{value}</Box>
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

/** A wall time long enough to need its hours: '48m', '3h 12m', '2h 05m'. */
const span = (ms: number): string => {
  const minutes = Math.round(ms / MINUTE_MS)
  if (ms < HOUR_MS) return duration(ms)
  return `${Math.floor(minutes / 60)}h ${`${minutes % 60}`.padStart(2, '0')}m`
}

/** The tone the gauge's fill takes: the accent while there is room, warm as it fills, hot past GAUGE_HOT. */
const gaugeTone = (percent: number): string =>
  percent > GAUGE_HOT ? TONES.hot : percent >= GAUGE_WARM ? TONES.warm : TONES.accent

/** How wide the gauge is drawn: its own cells, less whatever the trend beside it takes. */
const gaugeCells = (cells: number, trend: string): number =>
  Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, cells - (trend === '' ? 0 : trend.length + TREND_GAP)))

/** The trend beside the gauge: nothing until two samples make a shape, nothing where both do not fit. */
const trendOf = (header: Header, cells: number): string => {
  if (header.trend.length < TREND_MIN) return ''
  const drawn = sparkline(header.trend, TREND_CELLS)
  return GAUGE_MIN + TREND_GAP + drawn.length <= cells ? drawn : ''
}

/** The gauge row: the fill in the tone it has earned, what is left dim, then the session's trend. */
const gaugeRow = (ui: Ui, header: Header, percent: number, cells: number): RenderElement => {
  const { Text } = ui
  const trend = trendOf(header, cells)
  const drawn = gauge(percent, gaugeCells(cells, trend))
  const filled = drawn.replace(/░+$/, '')
  return (
    <Text wrap="truncate-end">
      <Text color={gaugeTone(percent)}>{filled}</Text>
      <Text dimColor>{drawn.slice(filled.length)}</Text>
      {trend === '' ? null : <Text dimColor>{`${' '.repeat(TREND_GAP)}${trend}`}</Text>}
    </Text>
  )
}

/**
 * Where the session stands: the share used, then the run to compaction in tokens and in turns.
 * A tight row gives back a word before it gives back a figure, and never cuts one.
 */
const contextText = (header: Header, room: number): string => {
  const percent = header.percent === null ? null : `${Math.round(header.percent)}%`
  const used = percent === null ? null : say().pane.contextUsed(percent)
  const tokens = header.tokensToCompaction === null || header.tokensToCompaction <= 0
    ? null
    : kilo(header.tokensToCompaction)
  const near = tokens === null ? null : say().pane.toCompaction(tokens)
  const nearer = tokens === null ? null : say().pane.toCompactionShort(tokens)
  const turns = near !== null && header.turnsToCompaction !== null && header.turnsToCompaction > 0
    ? say().pane.turnsLeft(header.turnsToCompaction)
    : null
  const ladder = [
    joined([used, near, turns]),
    joined([used, near]),
    joined([used, nearer]),
    joined([percent, nearer]),
    joined([used]),
    joined([percent]),
  ]
  return ladder.find(text => widthOf(text) <= room) ?? ''
}

/** What the judge has cost, for the end of the name row: the runs, and the tokens while they fit. */
const judgeText = (header: Header, room: number): string => {
  const label = say().pane.judge
  const runs = say().pane.judgeRuns(header.judgeRuns)
  const spent = header.judgeTokens > 0 ? kilo(header.judgeTokens) : null
  // A judge that has not run yet is not a figure: 'Check now' already says the run is there to be had.
  const ladder = header.judgeRuns === 0
    ? []
    : [
      `${label}${joined([runs, spent === null ? null : say().pane.judgeTokens(spent)])}`,
      `${label}${joined([runs, spent])}`,
      `${label}${runs}`,
    ]
  return ladder.find(text => widthOf(text) <= room) ?? ''
}

/** What the saved row draws: what the session got back, and that a run is in flight. */
const savedTexts = (header: Header, room: number): { saved: string; tail: string } => {
  const pct = header.savedPct > 0 ? `~${header.savedPct}%` : null
  const ms = header.savedMs > 0 ? duration(header.savedMs) : null
  const tail = header.judgeRunning ? say().pane.checkingLong : ''
  const cells = (row: { saved: string; tail: string }): number =>
    (row.saved === '' ? 0 : widthOf(say().pane.saved) + widthOf(row.saved))
    + (row.tail === '' ? 0 : (row.saved === '' ? 0 : SEP.length) + widthOf(row.tail))
  const ladder = [
    { saved: joined([pct, ms]), tail },
    { saved: joined([pct, ms]), tail: '' },
    { saved: joined([pct ?? ms]), tail: '' },
    { saved: '', tail: '' },
  ]
  return ladder.find(row => cells(row) <= room) ?? { saved: '', tail: '' }
}

/** The 'Check now' button; while a run is in flight it says so, dims, and answers no press. */
const checkButton = (ui: Ui, header: Header, actions: Actions): RenderElement => {
  const { Button } = ui
  return header.judgeRunning
    ? <Button key="check" plain dimColor onPress={() => undefined}>{say().pane.checking}</Button>
    : <Button key="check" plain onPress={() => actions.check()}>{checkLabel()}</Button>
}

/** The header's first row: the product's name, what the judge has cost, and its button at the right edge. */
const nameRow = (ui: Ui, header: Header, actions: Actions, cells: number): RenderElement => {
  const { Box, Text } = ui
  // The surface already draws the pane's own title, so a row too tight for both keeps the button.
  const check = checkCells()
  const name = cells >= PANE_TITLE.length + check + CONTROL_GAP ? PANE_TITLE : ''
  const judge = name === '' ? '' : judgeText(header, cells - name.length - STATUS_GAP - check - CONTROL_GAP)
  const lead = name.length + (judge === '' ? 0 : STATUS_GAP + widthOf(judge))
  return (
    <Box flexDirection="row" width={cells} justifyContent="space-between">
      {name === ''
        ? <Box flexGrow={1} />
        : (
          <Box width={lead}>
            <Text wrap="truncate-end">
              <Text bold>{name}</Text>
              {judge === '' ? null : <Text dimColor>{`${' '.repeat(STATUS_GAP)}${judge}`}</Text>}
            </Text>
          </Box>
        )}
      {checkButton(ui, header, actions)}
    </Box>
  )
}

/**
 * The header's last rows beside the mark: what the session got back, and that a run is in flight —
 * appended to the figures, or, where the row could not hold it and there are rows to spare, its own.
 */
const savedRows = (ui: Ui, header: Header, cells: number, isCompact: boolean): RenderElement[] => {
  const { Text } = ui
  const { saved, tail } = savedTexts(header, cells)
  return [
    <Text wrap="truncate-end">
      {saved === '' ? null : <Text dimColor>{say().pane.saved}</Text>}
      {saved === '' ? null : <Text color={TONES.good}>{saved}</Text>}
      {tail === '' ? null : <Text dimColor>{`${saved === '' ? '' : SEP}${tail}`}</Text>}
    </Text>,
    ...(header.judgeRunning && tail === '' && !isCompact
      ? [<Text dimColor wrap="truncate-end">{fit(say().pane.checkingLong, cells)}</Text>]
      : []),
  ]
}

/**
 * One budget as one row: its label in the gutter, one figure, and the judge's sentence about it, dim.
 * The named sinks behind the figure are the model's and `/saver debug`'s; a row is one fact here.
 */
const sinkRow = (ui: Ui, label: string, total: string, sentence: string, cells: number): RenderElement => {
  const { Text } = ui
  const value = gutterValue(cells)
  const figure = fit(total, value)
  const room = value - widthOf(figure) - SEP.length
  // A sentence left a handful of cells says nothing, so it is dropped whole rather than cut to nothing.
  const tail = room >= HINT_MIN ? `${SEP}${fit(collapseWs(sentence), room)}` : ''
  return gutterRow(ui, label, (
    <Text wrap="truncate-end">
      {figure}
      {tail === '' ? null : <Text dimColor>{tail}</Text>}
    </Text>
  ), cells)
}

/** The header: the mark, the session's four rows beside it, then one row each for the time and the context. */
const headerSection = (
  ui: Ui,
  header: Header,
  actions: Actions,
  cells: number,
  isCompact: boolean,
): RenderElement => {
  const { Box, Raster, Text } = ui
  const hasLogo = cells >= LOGO_MIN_CELLS
  const room = hasLogo ? cells - LOGO.columns - LOGO_GAP : cells
  const context = contextText(header, room)
  // One figure and one sentence per budget the ledger has measured; inline the seat has no rows for them.
  const budgets = isCompact
    ? []
    : [
      ...(header.time === null ? [] : [{ label: say().pane.time, figure: `${span(header.time.total)} ${say().pane.timeLead}`, sentence: header.judgeTime }]),
      ...(header.context === null ? [] : [{ label: say().pane.context, figure: `${kilo(header.context.total)} ${say().pane.contextLead}`, sentence: header.judgeContext }]),
    ]
  // Indented to the cards' content column, so the labels and the card titles start at one x.
  return (
    <Box flexDirection="column" paddingX={1 + HEAD_INDENT}>
      <Box flexDirection="row" gap={LOGO_GAP}>
        {hasLogo ? <Raster key="logo" columns={LOGO.columns} rows={LOGO.rows} cells={LOGO.cells} /> : null}
        <Box flexDirection="column" width={room}>
          {nameRow(ui, header, actions, room)}
          {header.percent === null
            ? <Text dimColor wrap="truncate-end">{fit(say().pane.awaiting, room)}</Text>
            : <Text wrap="truncate-end">{context}</Text>}
          {header.percent === null ? null : gaugeRow(ui, header, header.percent, room)}
          {savedRows(ui, header, room, isCompact)}
        </Box>
      </Box>
      {budgets.length === 0 ? null : blank(ui)}
      {budgets.map(budget => sinkRow(ui, budget.label, budget.figure, budget.sentence ?? say().pane.nothingYet, cells))}
      {blank(ui)}
    </Box>
  )
}

/** The category tag a title row wears, dropped whole once the card is narrower than TAG_MIN_CELLS. */
const tagOf = (card: Card, cells: number): string => (cells < TAG_MIN_CELLS ? '' : say().categories[card.category])

/** The cells a title row keeps once its tag, the 'i' Button and the gaps around them are reserved. */
const titleValue = (cells: number, tag: string): number =>
  Math.max(
    NUMBER_CELLS + GLYPH_CELLS + TITLE_MIN,
    cells - INFO_CELLS - CONTROL_GAP - (tag === '' ? 0 : widthOf(tag) + CONTROL_GAP),
  )

/** A waster's title row: its number, the accent dot, the behaviour in bold, then its tag and 'i'. */
const titleRow = (ui: Ui, card: Card, actions: Actions, cells: number): RenderElement => {
  const { Box, Text, Button } = ui
  const tag = tagOf(card, cells)
  const value = titleValue(cells, tag)
  const title = value - NUMBER_CELLS - GLYPH_CELLS
  // The widths add up to the row's own, so the 'i' lands at the right edge without a space-between.
  return (
    <Box flexDirection="row" width={cells} gap={CONTROL_GAP}>
      <Box flexDirection="row" width={value}>
        <Box width={NUMBER_CELLS}><Text dimColor wrap="truncate-end">{`${card.n}`}</Text></Box>
        <Box width={GLYPH_CELLS}><Text color={TONES.accent}>{GLYPHS.live}</Text></Box>
        <Box flexDirection="column" width={title}>
          {linesOf(card.kind, title, TITLE_ROWS).map(line => (
            <Text bold wrap="truncate-end">{line}</Text>
          ))}
        </Box>
      </Box>
      {tag === '' ? null : <Box width={widthOf(tag)}><Text dimColor wrap="truncate-end">{tag}</Text></Box>}
      <Button key={`card:${card.patternId}:info`} plain dimColor onPress={() => actions.info(card.patternId)}>{say().pane.info}</Button>
    </Box>
  )
}

/** The action row: Fix, Fix… and Ignore, three cells apart, each behind its own glyph while the row holds them. */
const verbsRow = (ui: Ui, card: Card, actions: Actions, cells: number): RenderElement => {
  const { Box, Button } = ui
  const id = card.patternId
  const { fix, fixNote, ignore } = say().pane
  const row = controlsFitting([fix, fixNote, ignore], [GLYPHS.fixed, GLYPHS.noted, GLYPHS.ignored], VERB_GAP, cells)
  const [kill = fix, steer = fixNote, keep = ignore] = row.labels
  // The labels are the person's words; the keys stay the decisions' own, so a press is still a kill or a keep.
  return (
    <Box flexDirection="row" gap={row.gap}>
      <Button key={`card:${id}:kill`} plain onPress={() => actions.kill(id)}>{kill}</Button>
      <Button key={`card:${id}:steer`} plain onPress={() => actions.steer(id)}>{steer}</Button>
      <Button key={`card:${id}:keep`} plain onPress={() => actions.keep(id)}>{keep}</Button>
    </Box>
  )
}

/** The widest of the texts, in cells. */
const widest = (texts: readonly string[]): number => texts.reduce((n, text) => Math.max(n, widthOf(text)), 0)

/** The wall time of a cited call as its row draws it; '' when nothing measured it (a turn, a rebuilt row). */
const callTime = (e: Evidence): string => (e.what === NO_CALLS || e.ms <= 0 ? '' : duration(e.ms))

/**
 * What one cited call cost: its wall time right-aligned in the card's shared time column, then its size —
 * the unit spelled out while the row holds it. A row nothing timed keeps the column, so the sizes read as one.
 */
const callMeta = (e: Evidence, time: number, hasUnit: boolean): string => {
  const size = e.what === NO_CALLS
    ? say().pane.answerSize(kilo(e.chars))
    : `${kilo(e.chars)}${hasUnit ? say().pane.charsUnit : ''}`
  if (time === 0) return size
  const spent = callTime(e)
  return spent === '' ? `${' '.repeat(time + CALL_SEP.length)}${size}` : `${padCells(spent, time, true)}${CALL_SEP}${size}`
}

/**
 * The columns every cited call of one card shares, so its sizes line up under each other: the unit,
 * then the alias, then the cost dropped whole while the widest row cannot hold them.
 */
const callColumns = (evidence: readonly Evidence[], cells: number): CallColumns => {
  const turn = widest(evidence.map(e => say().pane.turnCell(e.turn)))
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
  turn: padCells(say().pane.turnCell(e.turn), cols.turn),
  what: padCells(fit(e.what, cols.what), cols.what),
  alias: cols.alias === 0 ? '' : padCells(e.agent ?? '', cols.alias),
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
  // A behavioural card counts turns and states what the judge estimates each one costs; the unit is
  // the model's to say, never inferred from the evidence the details happened to keep. A card that
  // cites loops counts agents: their wall time is measured, and the estimate is what each turn of theirs cost.
  const estimate = chars > 0 ? say().pane.perTurn(kilo(tokensOf(chars))) : null
  if (unit === 'turns') return joined([say().pane.turnCount(calls), estimate])
  if (unit === 'agents') return joined([say().pane.agentCount(calls), ms > 0 ? duration(ms) : null, estimate])
  return joined([say().pane.callCount(calls), ms > 0 ? duration(ms) : null, say().pane.charsOfContext(kilo(chars))])
}

/** The details behind 'i': why, the fix, the summary, and the calls behind the claim. */
const detailRows = (ui: Ui, card: Card, cells: number, isCompact: boolean): RenderElement[] => {
  const { Text } = ui
  const value = gutterValue(cells)
  // Inline every value is one row and one call, so each row of the card's budget holds one of them.
  const rows = isCompact ? COMPACT_ROWS : DETAIL_ROWS_MAX
  const calls = isCompact ? COMPACT_ROWS : card.evidence.length
  // The columns are measured over the calls this drawing shows, so they hold whatever it draws.
  const shown = card.evidence.slice(0, calls)
  const cols = callColumns(shown, cells)
  return [
    gutterRow(ui, say().pane.why, textBlock(ui, card.why, value, rows), cells),
    gutterRow(ui, say().pane.fixLabel, textBlock(ui, card.fix, value, rows), cells),
    ...(card.total.calls === 0 ? [] : [<Text dimColor wrap="truncate-end">{fit(totalText(card), cells)}</Text>]),
    ...shown.flatMap(e => callBlock(ui, e, cols, cells, isCompact)),
  ]
}

/**
 * The Fix… field and its hint, opened in place under the verbs.
 *
 * The field opens empty, with the card's own fix drawn dim behind it (d.ts 3752-3755): a one-line field draws
 * its head and truncates the rest, so a field pre-filled with a fix as long as this one draws the fix and
 * hides every character the person types after it. `value` is the text the field holds when drawn (d.ts
 * 3756-3760) and the pane's body is this hook's tree, so every render carries the draft back — the keystroke's
 * own redraw is what paints it, and a redraw for any other reason draws it again rather than wiping it.
 */
const steerRows = (ui: Ui, card: Card, draft: string | null, actions: Actions, cells: number): RenderElement[] => {
  const { Box, Input, Text } = ui
  const id = card.patternId
  const value = Math.max(8, cells - FIELD_CELLS)
  return [
    glyphRow(ui, GLYPHS.field, (
      <Box flexGrow={1}>
        <Input
          key={`card:${id}:text`}
          value={draft ?? ''}
          placeholder={card.fix}
          submitLabel={say().pane.send}
          autoFocus
          onInput={(text: string) => actions.steerDraft(text)}
          onSubmit={(text: string) => actions.steerSubmit(id, text)}
        />
      </Box>
    )),
    glyphRow(ui, '', <Text dimColor wrap="truncate-end">{fit(say().pane.steerHint, value)}</Text>),
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
  + linesOf(
    card.kind,
    titleValue(cells - CARD_CHROME, tagOf(card, cells - CARD_CHROME)) - NUMBER_CELLS - GLYPH_CELLS,
    TITLE_ROWS,
  ).length
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
    verbsRow(ui, card, actions, cells),
    ...(isSteering ? steerRows(ui, card, model.steerDraft, actions, cells) : []),
  ]
  // Inline the verbs and the field come first, so what the seat cannot hold is detail rather than a verb.
  if (isCompact) return [titleRow(ui, card, actions, cells), ...verbs, ...content.slice(0, Math.max(0, budget))]
  // Docked the verbs sit under the content — except while the field is open, when they rise with it: a field
  // the eye has to hunt for below the details is the field the person never finds.
  return isSteering
    ? [titleRow(ui, card, actions, cells), ...spacer, ...verbs, ...spacer, ...content]
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
    ? <Box flexDirection="column" borderStyle="round" borderColor={TONES.accent} paddingX={CARD_PAD}>{rows}</Box>
    : <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={CARD_PAD}>{rows}</Box>
}

/** One further waster on the inline pane: a dim line with its number, its dot and its count. */
const compactRow = (ui: Ui, card: Card, cells: number): RenderElement => {
  const { Text } = ui
  const first = card.stats.split(' · ')[0] ?? ''
  const hits = HITS.test(first) ? first : null   // only a hit count; another stats order degrades to nothing
  const room = hits === null ? cells : Math.max(8, cells - widthOf(hits) - 3)
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
        <Text dimColor wrap="truncate-end">{fit(say().pane.empty, cells - CARD_CHROME)}</Text>
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
  return row.settled ? say().pane.savedCredit(row.savedPct) : say().pane.perRepeat(row.savedPct)
}

/** One decided pattern: what was done about it, the behaviour, what it is worth, and the sentence the user sent. */
const decidedRow = (ui: Ui, row: DecidedRow, cells: number): RenderElement => {
  const { Box, Text } = ui
  const right = row.ignored > 0 ? say().pane.ignoredTimes(row.ignored) : creditText(row)
  const value = Math.max(8, cells - widthOf(right) - CONTROL_GAP)
  // The glyph alone left the reader to remember what it meant, so the row says the word too.
  const lead = `${DECIDED_GLYPH[row.choice]} ${say().pane.decidedWord[row.choice]}`
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" width={cells} justifyContent="space-between">
        <Box width={value}>
          <Text wrap="truncate-end">
            <Text color={row.choice === 'kill' ? TONES.good : undefined}>{lead}</Text>
            {fit(` · ${row.kind}`, Math.max(1, value - widthOf(lead)))}
          </Text>
        </Box>
        {right === ''
          ? null
          : (
            <Box width={widthOf(right)}>
              {/* A credit that landed is the one figure in the footer worth a tone; a rate stays dim. */}
              <Text dimColor={!row.settled || row.ignored > 0} color={row.settled && row.ignored === 0 ? TONES.good : undefined}>{right}</Text>
            </Box>
          )}
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
  const kind = ` · ${say().pane.artifact[artifact.kind]}`
  const isTryable = TRYABLE.includes(artifact.kind)
  const { write, tryOnce, skip } = say().pane
  // Measured against the cells left once the title has kept its floor, so a long word gives back a glyph
  // rather than pushing the controls past the row's right edge.
  const row = isTryable
    ? controlsFitting([write, tryOnce, skip], [GLYPHS.write, GLYPHS.tryOnce, GLYPHS.skip], CONTROL_GAP, cells - RULES_MIN_TITLE - CONTROL_GAP)
    : controlsFitting([write, skip], [GLYPHS.write, GLYPHS.skip], CONTROL_GAP, cells - RULES_MIN_TITLE - CONTROL_GAP)
  const [first = write, second = skip, third = skip] = row.labels
  // Where three controls in their shortest form still leave the title nothing, they take a row of their
  // own. Nothing is dropped and nothing is squeezed to an unreadable stub: the rules sit in the footer of
  // the docked pane, which scrolls, so the row this spends is a row that was free. The inline pane never
  // draws them — it draws one count line — so its seat is untouched.
  const controls = controlCells(row)
  const isStacked = controls + CONTROL_GAP + RULES_MIN_TITLE > cells
  const value = isStacked ? cells : Math.max(RULES_MIN_TITLE, cells - controls - CONTROL_GAP)
  // A cut filename is a wrong filename: the kind label goes whole, and only the title is truncated.
  const label = value < widthOf(kind) + RULES_MIN_TITLE ? '' : kind
  const title = (
    <Box width={value}>
      <Text wrap="truncate-end">
        {fit(artifact.title, Math.max(1, value - widthOf(label)))}
        <Text dimColor>{label}</Text>
      </Text>
    </Box>
  )
  const verbs = (
    <Box flexDirection="row" gap={row.gap}>
      <Button key={`write:${id}`} plain onPress={() => actions.write(artifact)}>{first}</Button>
      {isTryable
        ? <Button key={`try:${id}`} plain onPress={() => actions.tryOnce(artifact)}>{second}</Button>
        : null}
      <Button key={`skip:${id}`} plain dimColor onPress={() => actions.skip(artifact)}>{isTryable ? third : second}</Button>
    </Box>
  )
  return isStacked
    ? <Box flexDirection="column">{title}{verbs}</Box>
    : <Box flexDirection="row" width={cells} justifyContent="space-between">{title}{verbs}</Box>
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
            {fit(joined([say().pane.decidedCount(model.decided.length), say().pane.rulesCount(model.artifacts.length), say().pane.fullPane]), cells)}
          </Text>,
        ]
        : [
          ...(model.decided.length === 0
            ? []
            : [
              blank(ui),
              <Text dimColor wrap="truncate-end">{say().pane.decided}</Text>,
              ...model.decided.map(row => decidedRow(ui, row, cells)),
            ]),
          ...(model.artifacts.length === 0
            ? []
            : [
              blank(ui),
              <Text dimColor wrap="truncate-end">{fit(say().pane.rules, cells)}</Text>,
              ...model.artifacts.map(artifact => artifactRow(ui, artifact, actions, cells)),
            ]),
        ]}
    </Box>
  )
}

/** The keys the pane takes, and the verbs by number while a card wears one: the longest phrasing that fits. */
const keysLine = (cells: number, hasCards: boolean): string => {
  const lines = keysLines().map(parts => joined([...parts]))
  const shortest = lines[lines.length - 1] ?? ''
  // The verbs by number are given back first, then one clause at a time; the chord itself is never dropped.
  const wanted = [...(hasCards ? [joined([lines[0] ?? '', say().pane.verbsHint])] : []), ...lines]
  return wanted.find(line => widthOf(line) <= cells) ?? fit(shortest, cells)
}

/** The pane's last row: how it is worked from the keyboard, since nothing else on screen says. */
const hintSection = (ui: Ui, cells: number, hasCards: boolean, isCompact: boolean): RenderElement => {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingX={1 + HEAD_INDENT}>
      {/* Inline the row is one of the few the seat grants, so it spends none of them on a blank. */}
      {isCompact ? null : blank(ui)}
      <Text dimColor wrap="truncate-end">{keysLine(cells, hasCards)}</Text>
    </Box>
  )
}

/**
 * What the waiting cards are worth, longest phrasing first: the row takes the first that fits, so a narrow
 * band gives back the time, then the sentence itself, and never a cut figure.
 */
const foundLines = (model: BandModel): string[] => {
  const pct = model.costPct > 0 ? say().band.costShare(model.costPct) : null
  // Seconds are no promise worth making, and a behavioural card carries no wall time at all.
  const time = model.costMs >= MINUTE_MS ? duration(model.costMs) : null
  if (pct === null && time === null) return [say().band.foundWorthLook(model.fresh)]
  return [
    ...(pct !== null && time !== null ? [say().band.foundSavingBoth(model.fresh, pct, time)] : []),
    say().band.foundSaving(model.fresh, pct ?? time ?? ''),
    say().band.foundShort(model.fresh),
  ]
}

/** What the session got back: the figures in the good tone, the words around them dim. */
const savedLine = (model: BandModel): BandSegment[] => [
  { text: say().band.saved, isDim: true },
  ...(model.savedPct > 0
    ? [{ text: `${model.savedPct}%`, color: TONES.good }, { text: say().band.ofContext, isDim: true as const }]
    : []),
  ...(model.savedMs > 0
    ? [
      ...(model.savedPct > 0 ? [{ text: ' · ', isDim: true as const }] : []),
      { text: duration(model.savedMs), color: TONES.good },
      { text: say().band.thisSession, isDim: true as const },
    ]
    : []),
]

/** How the last turn died and what to do about it; the fact alone where the advice does not fit. */
const diedLines = (died: BandModel['died']): string[] => {
  const fact = say().band.died(died === 'refusal' ? say().band.diedRefusal : say().band.diedError)
  return [joined([fact, say().band.diedContinue]), fact]
}

/** The workflow still going, longest phrasing first: the calls are given back first, then the stage, never the name. */
const runningLines = (run: NonNullable<BandModel['running']>): string[] => {
  const agents = say().band.agentCount(run.loops)
  return [
    joined([run.name, run.label ?? say().band.running, agents, say().band.callCount(run.calls)]),
    joined([run.name, run.label ?? say().band.running, agents]),
    joined([run.name, agents]),
  ]
}

/** The teaser for the state the session is in, longest phrasing first. */
const bandLines = (model: BandModel): BandSegment[][] => {
  if (model.state === 'died') return diedLines(model.died).map(text => [{ text }])
  if (model.state === 'checking') return [[{ text: say().band.checking, isDim: true }]]
  if (model.state === 'found') return foundLines(model).map(text => [{ text, color: TONES.accent }])
  if (model.state === 'saved') return [savedLine(model)]
  if (model.running !== null) return runningLines(model.running).map(text => [{ text, isDim: true }])
  // Before the first row there is nothing to count.
  const quiet = model.calls === 0 ? say().band.watching : joined([say().band.watched(model.calls), say().band.quiet])
  return [[{ text: quiet, isDim: true }]]
}

/** The cells a teaser draws. */
const lineCells = (line: readonly BandSegment[]): number => line.reduce((sum, segment) => sum + widthOf(segment.text), 0)

/** The AbovePrompt band: the mark, one line that says where the session stands, and the pane's own button. */
export function Band(props: BandProps): RenderElement {
  const { ui, model, site, actions } = props
  const { Box, Text, Button } = ui
  const label = model.paneOpen ? say().band.close : say().band.open
  const cells = Math.max(MIN_CELLS, site.bodyColumns - BAND_RESERVE)   // the engine draws its own '[-]' past them
  const room = cells - widthOf(label) - CONTROL_GAP
  const mark = BAND_MARK[model.state]
  const lines = bandLines(model)
  // The shortest phrasing is the floor; whatever a very narrow band still cannot hold, `truncate-end` takes.
  const line = lines.find(kept => lineCells(kept) <= room - BAND_LEAD) ?? lines[lines.length - 1] ?? []
  return (
    <Box flexDirection="row" width={cells} justifyContent="space-between">
      <Box width={room}>
        <Text wrap="truncate-end">
          <Text dimColor>{PANE_TITLE}</Text>
          {' '}
          <Text dimColor={mark.isDim} color={mark.color}>{mark.text}</Text>
          {BAND_GAP}
          {line.map(segment => <Text dimColor={segment.isDim} color={segment.color}>{segment.text}</Text>)}
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
  // The keys are taught at both placements, so inline the row it takes is budgeted for like any other — but
  // the newest card's own rows are unclippable (a verb and the field are never cut), so on a seat that tight
  // the lesson is what gives way rather than the drawing running past the seat and being clipped anyway.
  const newest = model.wasters[0]
  const fixed = newest === undefined ? EMPTY_ROWS : cardFixedRows(newest, model, cells)
  const keys = isCompact && seat - HEAD_ROWS - foot - fixed < KEYS_ROWS ? 0 : KEYS_ROWS
  const rows = isCompact ? Math.max(0, seat - HEAD_ROWS - foot - keys) : null
  return (
    <Box flexDirection="column">
      {headerSection(ui, model.header, actions, indented, isCompact)}
      {wastersSection(ui, model, actions, cells, rows)}
      {footerSection(ui, model, actions, indented, isCompact)}
      {keys === 0 ? null : hintSection(ui, indented, model.wasters.length > 0, isCompact)}
    </Box>
  )
}
