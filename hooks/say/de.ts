/**
 * ContextSaver auf Deutsch.
 *
 * Eine Sprachdatei bringt die Schlüssel mit, die sie übersetzt hat, und keine
 * weiteren: sie ist `PartialTexts`, was sie auslässt fällt Zeile für Zeile aufs
 * Englische zurück, und ein vertippter Schlüssel ist ein Compilerfehler statt
 * einer Lücke auf dem Schirm.
 *
 * Was getippt wird, wird nicht übersetzt: weder der Name des Befehls noch seine
 * Unterbefehle (`check`, `fix`, `ignore`, `debug`, `reset`), noch die Bezeichner,
 * die Modell und Speicher einander zurückgeben — Kategorien in einer `id`,
 * Belegverweise, Signaturen. Es ändert sich nur, was gelesen wird.
 *
 * Eine Runde ist ein Zug des Gesprächs: eine Eingabe und was Claude darauf tut.
 */

import type { PartialTexts } from './en'

/** „2 Runden“, „1 Runde“: die Zahl und das Wort, das sie nimmt. */
const zahl = (n: number, eins: string, viele: string): string => `${n} ${n === 1 ? eins : viele}`

/**
 * Deutsch.
 */
export const DE: PartialTexts = {
  pane: {
    awaiting: 'warte auf die erste Runde',
    contextUsed: share => `${share} des Kontexts`,
    toCompaction: tokens => `${tokens} Tokens bis zur Verdichtung`,
    toCompactionShort: tokens => `${tokens} bis zur Verdichtung`,
    turnsLeft: turns => `etwa ${zahl(turns, 'Runde', 'Runden')}`,

    judge: 'Prüfung ',
    judgeRuns: runs => zahl(runs, 'Lauf', 'Läufe'),
    judgeTokens: amount => `${amount} Tokens`,

    saved: 'Gespart ',
    checkNow: 'Prüfen',
    checking: 'Prüfe…',
    checkingLong: 'prüfe diese Sitzung… meist 10–20 s',

    time: 'Zeit',
    context: 'Kontext',
    timeLead: 'in Werkzeugen',
    contextLead: 'aus Werkzeugen',
    nothingYet: 'noch fällt nichts auf',

    empty: 'Beobachtet still. Noch wiederholt sich nichts.',

    fix: 'Beheben',
    fixNote: 'Beheben…',
    ignore: 'Ignorieren',
    info: 'i',

    hits: times => `${times}×`,
    costShare: percent => `~${percent}% des Kontexts`,
    turnAt: turn => `Runde ${turn}`,
    turnRange: (first, last) => `Runden ${first}–${last}`,
    // Das Englische sagt „ignored“ zu beidem: zur Karte, die man selbst wegklickt, und zur Anweisung,
    // der Claude nicht gefolgt ist. Das Deutsche trennt die zwei, wie das Französische.
    ignored: kind => `nicht befolgt · ${kind}`,

    why: 'Grund',
    fixLabel: 'Lösung',
    callCount: calls => zahl(calls, 'Aufruf', 'Aufrufe'),
    turnCount: turns => zahl(turns, 'Runde', 'Runden'),
    agentCount: agents => zahl(agents, 'Agent', 'Agenten'),
    perTurn: tokens => `~${tokens} Tokens pro Runde`,
    charsOfContext: chars => `${chars} Zeichen Kontext`,

    turnCell: turn => `Runde ${turn}`,
    charsUnit: ' Z',
    answerSize: chars => `${chars} Antwort`,
    loop: 'Agent',
    loopCost: (ktokens, edits) => `${ktokens}k Tokens · ${zahl(edits, 'Änderung', 'Änderungen')}`,

    steerHint: 'Enter sendet · Beheben… schließt · oder /saver fix <n> <Text>',
    send: 'senden',

    decided: 'Entschieden',
    decidedWord: { keep: 'ignoriert', steer: 'mit Notiz behoben', kill: 'behoben' },
    savedCredit: percent => `~${percent}% gespart`,
    perRepeat: percent => `~${percent}% je Wiederholung`,
    ignoredTimes: times => `nicht befolgt ${times}×`,

    rules: 'Regeln für die nächste Sitzung',
    artifact: {
      'claude-md': 'CLAUDE.md',
      skill: 'Skill',
      'agent-brief': 'Agenten-Briefing',
      'settings-allow': 'Berechtigungsregel',
    },
    write: 'Schreiben',
    tryOnce: 'Testen',
    skip: 'Verwerfen',

    decidedCount: decided => `Entschieden ${decided}`,
    rulesCount: rules => `Regeln ${rules}`,
    fullPane: '/saver für das ganze Panel',

    verbsHint: '/saver fix|ignore <n>',
    keysFocus: 'ctrl+x tab gibt diesem Panel die Tastatur',
    keysMove: 'Tab wechselt',
    keysPress: 'Enter drückt',
    keysBack: 'Esc gibt die Tastatur zurück',
  },

  band: {
    died: how => `Letzte Runde endete mit ${how}`,
    diedError: 'einem API-Fehler',
    diedRefusal: 'einer Ablehnung',
    diedContinue: 'schreib irgendetwas, um fortzufahren',

    checking: 'prüfe diese Sitzung…',

    foundWorthLook: cards => `${zahl(cards, 'Punkt', 'Punkte')} zum Ansehen`,
    foundSavingBoth: (cards, share, time) => `${zahl(cards, 'Weg', 'Wege')}, ${share} und ${time} zu sparen`,
    foundSaving: (cards, saving) => `${zahl(cards, 'Weg', 'Wege')}, ${saving} zu sparen`,
    foundShort: cards => `${zahl(cards, 'Fund', 'Funde')}`,
    costShare: percent => `${percent >= 1 ? `~${Math.round(percent)}%` : 'weniger als 1%'} deines Kontexts`,

    saved: 'gespart ',
    ofContext: ' Kontext',
    thisSession: ' diese Sitzung',

    running: 'läuft',
    agentCount: agents => zahl(agents, 'Agent', 'Agenten'),
    callCount: calls => zahl(calls, 'Aufruf', 'Aufrufe'),

    watching: 'beobachtet',
    watched: calls => `${zahl(calls, 'Aufruf', 'Aufrufe')} beobachtet`,
    quiet: 'noch nichts verschwendet',

    open: 'Öffnen',
    close: 'Schließen',
  },

  command: {
    description: 'ContextSaver: Panel ein- oder ausblenden · check | fix [n] [Text] | ignore <n> | debug | reset',
    argumentHint: '[check | fix [n] [Text] | ignore <n> | debug | reset]',

    usage: 'Verwendung: /saver [check | fix [n] [Text] | ignore <n> | debug | reset]',
    fixUsage: 'Verwendung: /saver fix [n] [Anweisung] (eine führende Zahl meint die Karte, die das Panel nummeriert; ohne Zahl: die Karte mit offenem Beheben…-Feld, sonst Karte 1)',
    paneShown: 'ContextSaver-Panel eingeblendet',
    paneHidden: 'ContextSaver-Panel ausgeblendet',
    nothingToDecide: 'ContextSaver: nichts zu entscheiden',
    reset: 'ContextSaver: Sitzungszustand zurückgesetzt',
    demoLoaded: 'ContextSaver: Demo-Karten geladen',

    checking: 'ContextSaver: prüfe diese Sitzung auf Verschwendung…',
    alreadyChecking: 'ContextSaver: prüft bereits',
    nothingNew: 'ContextSaver: nichts Neues',
    found: cards => `ContextSaver: ${cards === 1 ? '1 neuer Fund' : `${cards} neue Funde`}`,
    checkFailed: failure => `ContextSaver: Prüfung fehlgeschlagen — ${failure}`,
    notCheckedYet: failure => `ContextSaver: konnte noch nicht prüfen — ${failure}`,

    card: (seat, kind, outcome) => `ContextSaver: Karte ${seat} — „${kind}“ · ${outcome}`,
    noCard: (seat, cards) => `ContextSaver: keine Karte ${seat} (1–${cards})`,
    outcomeIgnored: 'ignoriert',
    outcomeFixed: 'behoben',
    outcomeNoted: text => `mit deiner Notiz behoben: ${text}`,

    toastIgnored: kind => `ContextSaver: „${kind}“ ignoriert`,
    toastFixed: alternative => `ContextSaver: behoben — ${alternative}`,
    toastNoted: instruction => `ContextSaver: mit deiner Notiz behoben — ${instruction}`,
    writeFirst: 'ContextSaver: schreib zuerst die Anweisung',

    savedToast: figures => `${figures} Kontext gespart`,

    wrote: path => `${path} geschrieben`,
    trying: title => `„${title}“ für diese Sitzung im Test`,

    composerHasKeys: seat => `ContextSaver: die Eingabezeile hat deine Tastatur — schreib /saver fix ${seat} <deine Notiz>`,
  },

  categories: {
    execution: 'Ausführung',
    reading: 'Lesen',
    production: 'Produktion',
    behavior: 'Verhalten',
    communication: 'Kommunikation',
    'multi-agent': 'Multi-Agent',
    environment: 'Umgebung',
    process: 'Prozess',
    other: 'Sonstiges',
  },

  judge: {
    // Absichtlich auf Englisch: ein Absatz am Ende eines englischen Prompts, gelesen vom Modell und von
    // sonst niemandem. Eine Anweisung in der Sprache des Prompts, der sie umgibt, wird am ehesten befolgt;
    // was sie verlangt, ist dagegen sehr wohl Deutsch.
    directive: `## Language — write the reply's prose in German
The rules and the blocks above are in English because that is this prompt's language; your reply's prose is not. Write \`kind\`, \`why\`, \`alternative\`, \`time\`, \`context\` and any \`proposal\` \`title\` and \`body\` in German, in the plain words of the work, and keep the brevity the caps ask for — they count characters, not words. \`kind\` starts exactly with \`Claude wiederholt \` in place of \`Claude keeps \`, and what follows it names the repeated behaviour as a noun phrase (\`Claude wiederholt den kompletten Testlauf nach jeder Änderung an einer einzelnen Datei\`), since German cannot carry on with a gerund the way English does: the examples above show the English opening because they were written for it.
Everything a machine matches is never translated and stays exactly as specified above: the JSON keys, the \`id\` and its kebab slug, the nine \`category\` names, the evidence handles (\`r12\`, \`turn:7\`, \`agent:a3\`), the \`signature\` \`tool\` and \`key\` copied character-for-character from a LEDGER row, and the \`proposal\` \`kind\`. A translated one discards the finding whole.`,
    kindPrefix: 'Claude wiederholt ',
    instruction: text => `Anweisung des Nutzers (über ContextSaver): ${text}`,
    kill: (kind, alternative) => `Stoppe dieses Verhalten für den Rest der Sitzung: ${kind}. Ab jetzt: ${alternative}`,
  },

  config: {
    languageLabel: 'Sprache',
    languageAvailable: tags => `Verfügbar: ${tags.join(', ')}.`,
  },
}
