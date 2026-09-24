/**
 * Every line ContextSaver puts in front of a person, in English: the one complete
 * bundle, and the shape every other language is checked against.
 *
 * A language is a file like this one carrying the keys it has translated and no
 * others — `PartialTexts`, not `Texts` — so a half-finished translation ships and
 * falls back to these lines key by key, and a misspelt key is a compile error
 * rather than a blank on screen.
 *
 * A line that takes an argument is a function, never a template assembled at the
 * call site: a sentence's word order and its plural are the translator's business,
 * and a caller that glued two halves together would have decided them for it.
 *
 * What is not here is not translated, on purpose: the glyphs, the product's name,
 * the `/saver` subcommands and every id the model or the store round-trips — a
 * word that is typed or matched may not move with the language.
 */

import type { ArtifactKind, Category, Choice } from '../core/types'

/**
 * The pane: its header, its cards, the details behind `i`, and its footer.
 */
export type PaneTexts = {
  /** The header, before the first turn has been billed. */
  awaiting: string
  /** How much of the window is gone, the share already rendered ('32%'). */
  contextUsed: (share: string) => string
  /** The run left before auto-compaction, and the same said shorter. */
  toCompaction: (tokens: string) => string
  toCompactionShort: (tokens: string) => string
  /** That run stated in turns, at the pace the last turns set. */
  turnsLeft: (turns: number) => string

  /** What the audit has cost, at the end of the name row. */
  judge: string
  judgeRuns: (runs: number) => string
  judgeTokens: (amount: string) => string

  /** What the session got back, and that a run is in flight. */
  saved: string
  checkNow: string
  checking: string
  checkingLong: string

  /** The two budget rows, their figure's tail, and the sentence before the judge has one. */
  time: string
  context: string
  timeLead: string
  contextLead: string
  nothingYet: string

  /** The quiet pane, in its own frame. */
  empty: string

  /** A card's three verbs and the `i` beside its title. */
  fix: string
  fixNote: string
  ignore: string
  info: string

  /** The stats line under a card's title. */
  hits: (times: number) => string
  costShare: (percent: number) => string
  turnAt: (turn: number) => string
  turnRange: (first: number, last: number) => string
  /** A card whose instruction was ignored says so before its behaviour. */
  ignored: (kind: string) => string

  /** The details behind `i`: the two gutter labels, then what the evidence adds up to. */
  why: string
  fixLabel: string
  callCount: (calls: number) => string
  turnCount: (turns: number) => string
  agentCount: (agents: number) => string
  perTurn: (tokens: string) => string
  charsOfContext: (chars: string) => string

  /** One cited call: its turn, the unit of its size, and a turn handle's own answer. */
  turnCell: (turn: number) => string
  charsUnit: string
  answerSize: (chars: string) => string
  /** A cited loop the journal never named, and the line quoted under it. */
  loop: string
  loopCost: (ktokens: number, edits: number) => string

  /** The Fix… field: what Enter does, and the word on its submit control. */
  steerHint: string
  send: string

  /** The footer: the decisions, what each is called and what it is worth. */
  decided: string
  decidedWord: Record<Choice, string>
  savedCredit: (percent: number) => string
  perRepeat: (percent: number) => string
  ignoredTimes: (times: number) => string

  /** The rules the decisions would leave behind, and the three things to do with one. */
  rules: string
  artifact: Record<ArtifactKind, string>
  write: string
  tryOnce: string
  skip: string

  /** The inline pane's one count line, which stands in for the whole footer. */
  decidedCount: (decided: number) => string
  rulesCount: (rules: number) => string
  fullPane: string

  /** The last row: how the pane is worked from the keyboard. */
  verbsHint: string
  keysFocus: string
  keysMove: string
  keysPress: string
  keysBack: string
}

/**
 * The one teaser line above the prompt, one phrasing per state, longest first.
 */
export type BandTexts = {
  /** The last turn died and no prompt has followed it. */
  died: (how: string) => string
  diedError: string
  diedRefusal: string
  diedContinue: string

  /** A run is in flight. */
  checking: string

  /** Cards are waiting: what they are worth, or that they are simply there. */
  foundWorthLook: (cards: number) => string
  foundSavingBoth: (cards: number, share: string, time: string) => string
  foundSaving: (cards: number, saving: string) => string
  foundShort: (cards: number) => string
  /** The share of the window those cards have already eaten; under one percent it says so. */
  costShare: (percent: number) => string

  /** A saving to show off: the figures carry the tone, these words sit around them. */
  saved: string
  ofContext: string
  thisSession: string

  /** A workflow still going, and the stage its journal has not named yet. */
  running: string
  agentCount: (agents: number) => string
  callCount: (calls: number) => string

  /** The quiet watch, before and after the first ledger row. */
  watching: string
  watched: (calls: number) => string
  quiet: string

  /** The button at the band's right edge. */
  open: string
  close: string
}

/**
 * `/saver`: what it says of itself, what it answers, and what it toasts.
 *
 * The command's own name and its subcommands are absent: they are typed, and a
 * word that moved with the language would be a command nobody could write down.
 */
export type CommandTexts = {
  description: string
  argumentHint: string

  usage: string
  fixUsage: string
  paneShown: string
  paneHidden: string
  nothingToDecide: string
  reset: string
  demoLoaded: string

  checking: string
  alreadyChecking: string
  nothingNew: string
  found: (cards: number) => string
  checkFailed: (failure: string) => string
  notCheckedYet: (failure: string) => string

  /** A card named by the number the pane draws beside it. */
  card: (seat: number, kind: string, outcome: string) => string
  noCard: (seat: number, cards: number) => string
  outcomeIgnored: string
  outcomeFixed: string
  outcomeNoted: (text: string) => string

  /** What a decision toasts, and the nudge when the field was sent empty. */
  toastIgnored: (kind: string) => string
  toastFixed: (alternative: string) => string
  toastNoted: (instruction: string) => string
  writeFirst: string

  /** The saving a settled instruction credited. */
  savedToast: (figures: string) => string

  /** A rule written to disk, or borrowed for this session alone. */
  wrote: (path: string) => string
  trying: (title: string) => string

  /** The keyboard never reached the Fix… field, so the composer route is spelled out. */
  composerHasKeys: (seat: number) => string
}

/**
 * The nine categories, as the dim tag on a card's title row spells them. The enum
 * values themselves never move: they are the id's own first half and the model's.
 */
export type CategoryTexts = Record<Category, string>

/**
 * What reaches the model: the language the fork answers in, and the two wrappers
 * a decision is sent to Claude inside.
 */
export type JudgeTexts = {
  /**
   * The paragraph appended to the judge prompt, just before its last line.
   *
   * Empty for English, whose prompt is the whole instruction already. Another
   * language says here which fields it wants in its own words and which stay as
   * written — ids, categories, evidence handles and signatures are matched, never
   * read, so a translated one discards the finding.
   */
  directive: string
  /**
   * The words every `kind` opens with, verbatim on both sides: the prompt asks for
   * them and the parser refuses a finding without them.
   */
  kindPrefix: string
  /** The wrapper a decision rides to Claude in. */
  instruction: (text: string) => string
  /** What `Fix` sends: stop this, and do that instead. */
  kill: (kind: string, alternative: string) => string
}

/**
 * The `/config` rows this plugin owns, as the settings menu lists them.
 */
export type ConfigTexts = {
  languageLabel: string
  /** The tags there are, appended to the row's help so a language added here shows up at once. */
  languageAvailable: (tags: readonly string[]) => string
}

/**
 * Every line, in six groups.
 */
export type Texts = {
  pane: PaneTexts
  band: BandTexts
  command: CommandTexts
  categories: CategoryTexts
  judge: JudgeTexts
  config: ConfigTexts
}

/**
 * A language as its file gives it: the groups it touched, and inside each one the
 * keys it translated. What it leaves out falls back to English.
 *
 * One level deep, which is as deep as the bundle goes.
 */
export type PartialTexts = {
  [Group in keyof Texts]?: Partial<Texts[Group]>
}

/** '2 runs', '1 run': the count and the word it takes. */
const counted = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * English: the complete bundle, and the fallback for every other language.
 */
export const EN: Texts = {
  pane: {
    awaiting: 'awaiting the first turn',
    contextUsed: share => `${share} of context`,
    toCompaction: tokens => `${tokens} tokens to compaction`,
    toCompactionShort: tokens => `${tokens} to compaction`,
    turnsLeft: turns => `about ${counted(turns, 'turn')}`,

    judge: 'Judge ',
    judgeRuns: runs => counted(runs, 'run'),
    judgeTokens: amount => `${amount} tokens`,

    saved: 'Saved ',
    checkNow: 'Check now',
    checking: 'Checking…',
    checkingLong: 'checking this session… usually 10–20 s',

    time: 'Time',
    context: 'Context',
    timeLead: 'in tools',
    contextLead: 'from tools',
    nothingYet: 'nothing stands out yet',

    empty: 'Watching quietly. Nothing repeating yet.',

    fix: 'Fix',
    fixNote: 'Fix…',
    ignore: 'Ignore',
    info: 'i',

    hits: times => `${times}×`,
    costShare: percent => `~${percent}% of context`,
    turnAt: turn => `turn ${turn}`,
    turnRange: (first, last) => `turns ${first}–${last}`,
    ignored: kind => `ignored · ${kind}`,

    why: 'why',
    fixLabel: 'fix',
    callCount: calls => counted(calls, 'call'),
    turnCount: turns => counted(turns, 'turn'),
    agentCount: agents => counted(agents, 'agent'),
    perTurn: tokens => `~${tokens} tokens per turn`,
    charsOfContext: chars => `${chars} chars of context`,

    turnCell: turn => `turn ${turn}`,
    charsUnit: ' ch',
    answerSize: chars => `${chars} answer`,
    loop: 'agent',
    loopCost: (ktokens, edits) => `${ktokens}k tokens · ${edits} edits`,

    steerHint: 'Enter sends · Fix… again closes · or /saver fix <n> <text>',
    send: 'send',

    decided: 'Decided',
    decidedWord: { keep: 'ignored', steer: 'fixed with a note', kill: 'fixed' },
    savedCredit: percent => `saved ~${percent}%`,
    perRepeat: percent => `~${percent}% per repeat`,
    ignoredTimes: times => `ignored ${times}×`,

    rules: 'Rules for next session',
    artifact: {
      'claude-md': 'CLAUDE.md',
      skill: 'skill',
      'agent-brief': 'agent brief',
      'settings-allow': 'permission rule',
    },
    write: 'Write',
    tryOnce: 'Try',
    skip: 'Skip',

    decidedCount: decided => `Decided ${decided}`,
    rulesCount: rules => `Rules ${rules}`,
    fullPane: '/saver for the full pane',

    verbsHint: '/saver fix|ignore <n>',
    keysFocus: 'ctrl+x tab focuses this pane',
    keysMove: 'Tab moves',
    keysPress: 'Enter presses',
    keysBack: 'Esc hands the keys back',
  },

  band: {
    died: how => `Last turn ended in ${how}`,
    diedError: 'an API error',
    diedRefusal: 'a refusal',
    diedContinue: 'type anything to continue',

    checking: 'checking this session…',

    foundWorthLook: cards => `Found ${counted(cards, 'thing')} worth a look`,
    foundSavingBoth: (cards, share, time) => `Found ${counted(cards, 'way')} to save ${share} and ${time}`,
    foundSaving: (cards, saving) => `Found ${counted(cards, 'way')} to save ${saving}`,
    foundShort: cards => `Found ${counted(cards, 'waster')}`,
    costShare: percent => `${percent >= 1 ? `~${Math.round(percent)}%` : 'under 1%'} of your context`,

    saved: 'saved ',
    ofContext: ' of context',
    thisSession: ' this session',

    running: 'running',
    agentCount: agents => counted(agents, 'agent'),
    callCount: calls => counted(calls, 'call'),

    watching: 'watching',
    watched: calls => `${calls} calls watched`,
    quiet: 'nothing wasteful yet',

    open: 'Open',
    close: 'Close',
  },

  command: {
    description: 'ContextSaver: toggle the pane · check | fix [n] [text] | ignore <n> | debug | reset',
    argumentHint: '[check | fix [n] [text] | ignore <n> | debug | reset]',

    usage: 'Usage: /saver [check | fix [n] [text] | ignore <n> | debug | reset]',
    fixUsage: 'Usage: /saver fix [n] [instruction] (a leading number is the card the pane draws; without one: the card whose Fix… field is open, else card 1)',
    paneShown: 'ContextSaver pane shown',
    paneHidden: 'ContextSaver pane hidden',
    nothingToDecide: 'ContextSaver: nothing to decide on',
    reset: 'ContextSaver: session state reset',
    demoLoaded: 'ContextSaver: demo wasters loaded',

    checking: 'ContextSaver: checking this session for waste…',
    alreadyChecking: 'ContextSaver: already checking',
    nothingNew: 'ContextSaver: nothing new',
    found: cards => `ContextSaver: ${counted(cards, 'new waster')}`,
    checkFailed: failure => `ContextSaver: check failed — ${failure}`,
    notCheckedYet: failure => `ContextSaver: could not check yet — ${failure}`,

    card: (seat, kind, outcome) => `ContextSaver: card ${seat} — "${kind}" · ${outcome}`,
    noCard: (seat, cards) => `ContextSaver: no card ${seat} (1–${cards})`,
    outcomeIgnored: 'ignored',
    outcomeFixed: 'fixed',
    outcomeNoted: text => `fixed with your note: ${text}`,

    toastIgnored: kind => `ContextSaver: ignored "${kind}"`,
    toastFixed: alternative => `ContextSaver: fixed — ${alternative}`,
    toastNoted: instruction => `ContextSaver: fixed with your note — ${instruction}`,
    writeFirst: 'ContextSaver: write the instruction first',

    savedToast: figures => `${figures} context saved`,

    wrote: path => `Wrote ${path}`,
    trying: title => `Trying "${title}" for this session`,

    composerHasKeys: seat => `ContextSaver: the composer has your keys — type /saver fix ${seat} <your note>`,
  },

  categories: {
    execution: 'execution',
    reading: 'reading',
    production: 'production',
    behavior: 'behavior',
    communication: 'communication',
    'multi-agent': 'multi-agent',
    environment: 'environment',
    process: 'process',
    other: 'other',
  },

  judge: {
    // English is the prompt's own language: it needs no paragraph telling it so.
    directive: '',
    kindPrefix: 'Claude keeps ',
    instruction: text => `Instruction from the user (via ContextSaver): ${text}`,
    kill: (kind, alternative) => `Stop this behaviour for the rest of the session: ${kind}. From now on: ${alternative}`,
  },

  config: {
    languageLabel: 'Language',
    languageAvailable: tags => `Available: ${tags.join(', ')}.`,
  },
}
