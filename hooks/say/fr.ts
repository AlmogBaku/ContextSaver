/**
 * ContextSaver en français.
 *
 * Un fichier de langue donne les clés qu’il traduit et pas d’autres : il est typé
 * `PartialTexts`, donc ce qu’il laisse de côté retombe sur l’anglais ligne par
 * ligne, et une clé mal orthographiée est une erreur de compilation plutôt qu’un
 * blanc à l’écran.
 *
 * Ce qui se tape ne se traduit pas : ni le nom de la commande, ni ses
 * sous-commandes (`check`, `fix`, `ignore`, `debug`, `reset`), ni les identifiants
 * que le modèle et le magasin se renvoient — catégories dans un `id`, poignées de
 * preuve, signatures. Seul change ce qui se lit.
 */

import type { PartialTexts } from './en'

/** « 2 tours », « 1 tour » : le compte et le mot qu’il prend. */
const compte = (n: number, mot: string, pluriel = `${mot}s`): string => `${n} ${n === 1 ? mot : pluriel}`

/**
 * Français.
 */
export const FR: PartialTexts = {
  pane: {
    awaiting: 'en attente du premier tour',
    contextUsed: share => `${share} du contexte`,
    toCompaction: tokens => `${tokens} tokens avant compactage`,
    toCompactionShort: tokens => `${tokens} avant compactage`,
    turnsLeft: turns => `environ ${compte(turns, 'tour')}`,

    judge: 'Audit ',
    judgeRuns: runs => compte(runs, 'passage'),
    judgeTokens: amount => `${amount} tokens`,

    saved: 'Gagné ',
    checkNow: 'Analyser',
    checking: 'Analyse…',
    checkingLong: 'analyse de la session… 10–20 s en général',

    time: 'Temps',
    context: 'Contexte',
    timeLead: 'dans les outils',
    contextLead: 'via les outils',
    nothingYet: 'rien ne ressort encore',

    empty: 'Sous surveillance. Rien ne se répète pour l’instant.',

    fix: 'Corriger',
    fixNote: 'Corriger…',
    ignore: 'Ignorer',
    info: 'i',

    hits: times => `${times}×`,
    costShare: percent => `~${percent}% du contexte`,
    turnAt: turn => `tour ${turn}`,
    turnRange: (first, last) => `tours ${first}–${last}`,
    // L’anglais dit « ignored » des deux côtés : la carte qu’on écarte et l’instruction que Claude
    // n’a pas suivie. Le français les sépare, parce qu’il doit de toute façon choisir un genre, et
    // qu’une carte revenue parce que l’instruction est restée lettre morte ne se lit pas comme une
    // carte que l’on vient d’écarter soi-même.
    ignored: kind => `non suivie · ${kind}`,

    why: 'motif',
    fixLabel: 'correctif',
    callCount: calls => compte(calls, 'appel'),
    turnCount: turns => compte(turns, 'tour'),
    agentCount: agents => compte(agents, 'agent'),
    perTurn: tokens => `~${tokens} tokens par tour`,
    charsOfContext: chars => `${chars} caractères de contexte`,

    turnCell: turn => `tour ${turn}`,
    charsUnit: ' car',
    answerSize: chars => `${chars} de réponse`,
    loop: 'agent',
    loopCost: (ktokens, edits) => `${ktokens}k tokens · ${compte(edits, 'édition')}`,

    steerHint: 'Entrée envoie · Corriger… referme · ou /saver fix <n> <texte>',
    send: 'envoyer',

    decided: 'Décidé',
    decidedWord: { keep: 'ignoré', steer: 'corrigé avec une note', kill: 'corrigé' },
    savedCredit: percent => `~${percent}% gagnés`,
    perRepeat: percent => `~${percent}% par répétition`,
    ignoredTimes: times => `non suivie ${times}×`,

    rules: 'Règles pour la prochaine session',
    artifact: {
      'claude-md': 'CLAUDE.md',
      skill: 'skill',
      'agent-brief': 'brief d’agent',
      'settings-allow': 'règle de permission',
    },
    write: 'Écrire',
    tryOnce: 'Essayer',
    skip: 'Passer',

    decidedCount: decided => `Décidé ${decided}`,
    rulesCount: rules => `Règles ${rules}`,
    fullPane: '/saver pour le panneau complet',

    verbsHint: '/saver fix|ignore <n>',
    keysFocus: 'ctrl+x tab donne le clavier à ce panneau',
    keysMove: 'Tab circule',
    keysPress: 'Entrée valide',
    keysBack: 'Échap rend le clavier',
  },

  band: {
    died: how => `Dernier tour terminé sur ${how}`,
    diedError: 'une erreur API',
    diedRefusal: 'un refus',
    diedContinue: 'tapez n’importe quoi pour continuer',

    checking: 'analyse de la session…',

    foundWorthLook: cards => `${compte(cards, 'chose')} à regarder`,
    foundSavingBoth: (cards, share, time) => `${compte(cards, 'moyen')} d’économiser ${share} et ${time}`,
    foundSaving: (cards, saving) => `${compte(cards, 'moyen')} d’économiser ${saving}`,
    foundShort: cards => `${compte(cards, 'gaspillage')} repéré${cards === 1 ? '' : 's'}`,
    costShare: percent => `${percent >= 1 ? `~${Math.round(percent)}%` : 'moins de 1%'} de votre contexte`,

    saved: 'gagné ',
    ofContext: ' de contexte',
    thisSession: ' cette session',

    running: 'en cours',
    agentCount: agents => compte(agents, 'agent'),
    callCount: calls => compte(calls, 'appel'),

    watching: 'en veille',
    watched: calls => `${compte(calls, 'appel')} surveillé${calls === 1 ? '' : 's'}`,
    quiet: 'rien de gaspillé pour l’instant',

    open: 'Ouvrir',
    close: 'Fermer',
  },

  command: {
    description: 'ContextSaver : afficher ou masquer le panneau · check | fix [n] [texte] | ignore <n> | debug | reset',
    argumentHint: '[check | fix [n] [texte] | ignore <n> | debug | reset]',

    usage: 'Utilisation : /saver [check | fix [n] [texte] | ignore <n> | debug | reset]',
    fixUsage: 'Utilisation : /saver fix [n] [instruction] (un nombre en tête désigne la carte que le panneau numérote ; sans nombre : la carte dont le champ Corriger… est ouvert, sinon la carte 1)',
    paneShown: 'Panneau ContextSaver affiché',
    paneHidden: 'Panneau ContextSaver masqué',
    nothingToDecide: 'ContextSaver : rien à décider',
    reset: 'ContextSaver : état de la session réinitialisé',
    demoLoaded: 'ContextSaver : gaspillages de démonstration chargés',

    checking: 'ContextSaver : analyse de la session à la recherche de gaspillages…',
    alreadyChecking: 'ContextSaver : analyse déjà en cours',
    nothingNew: 'ContextSaver : rien de nouveau',
    found: cards => `ContextSaver : ${cards} ${cards === 1 ? 'nouveau gaspillage' : 'nouveaux gaspillages'}`,
    checkFailed: failure => `ContextSaver : analyse échouée — ${failure}`,
    notCheckedYet: failure => `ContextSaver : analyse impossible pour l’instant — ${failure}`,

    card: (seat, kind, outcome) => `ContextSaver : carte ${seat} — « ${kind} » · ${outcome}`,
    noCard: (seat, cards) => `ContextSaver : pas de carte ${seat} (1–${cards})`,
    outcomeIgnored: 'ignorée',
    outcomeFixed: 'corrigée',
    outcomeNoted: text => `corrigée avec votre note : ${text}`,

    toastIgnored: kind => `ContextSaver : « ${kind} » ignoré`,
    toastFixed: alternative => `ContextSaver : corrigé — ${alternative}`,
    toastNoted: instruction => `ContextSaver : corrigé avec votre note — ${instruction}`,
    writeFirst: 'ContextSaver : écrivez d’abord l’instruction',

    savedToast: figures => `${figures} de contexte gagné`,

    wrote: path => `${path} écrit`,
    trying: title => `« ${title} » essayé pour cette session`,

    composerHasKeys: seat => `ContextSaver : le compositeur a votre clavier — tapez /saver fix ${seat} <votre note>`,
  },

  categories: {
    execution: 'exécution',
    reading: 'lecture',
    production: 'production',
    behavior: 'comportement',
    communication: 'communication',
    'multi-agent': 'multi-agents',
    environment: 'environnement',
    process: 'processus',
    other: 'autre',
  },

  judge: {
    // Écrit en anglais à dessein : c’est un paragraphe ajouté à la fin d’un prompt
    // anglais, lu par le modèle et par personne d’autre. Une consigne rédigée dans
    // la langue du prompt qui l’entoure est celle qui est suivie le plus sûrement ;
    // ce qu’elle demande, en revanche, est bien du français.
    directive: `## Language — write the reply's prose in French
The rules and the blocks above are in English because that is this prompt's language; your reply's prose is not. Write \`kind\`, \`why\`, \`alternative\`, \`time\`, \`context\` and any \`proposal\` \`title\` and \`body\` in French, in the plain words of the work, and keep the brevity the caps ask for — they count characters, not words. \`kind\` starts exactly with \`Claude continue de \` in place of \`Claude keeps \`: the examples above show the English opening because they were written for it.
Everything a machine matches is never translated and stays exactly as specified above: the JSON keys, the \`id\` and its kebab slug, the nine \`category\` names, the evidence handles (\`r12\`, \`turn:7\`, \`agent:a3\`), the \`signature\` \`tool\` and \`key\` copied character-for-character from a LEDGER row, and the \`proposal\` \`kind\`. A translated one discards the finding whole.`,
    kindPrefix: 'Claude continue de ',
    instruction: text => `Instruction de l’utilisateur (via ContextSaver) : ${text}`,
    kill: (kind, alternative) => `Arrête ce comportement pour le reste de la session : ${kind}. À partir de maintenant : ${alternative}`,
  },

  config: {
    languageLabel: 'Langue',
    languageAvailable: tags => `Disponibles : ${tags.join(', ')}.`,
  },
}
