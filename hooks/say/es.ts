/**
 * ContextSaver en español.
 *
 * Un archivo de idioma trae las claves que ha traducido y ninguna más: es
 * `PartialTexts`, así que lo que deja fuera cae en inglés línea por línea, y una
 * clave mal escrita es un error de compilación y no un hueco en pantalla.
 *
 * Lo que se teclea no se traduce: ni el nombre del comando, ni sus subcomandos
 * (`check`, `fix`, `ignore`, `debug`, `reset`), ni los identificadores que el
 * modelo y el almacén se devuelven — categorías dentro de un `id`, referencias de
 * evidencia, firmas. Solo cambia lo que se lee.
 */

import type { PartialTexts } from './en'

/** «2 turnos», «1 turno»: la cuenta y la palabra que le toca. */
const cuenta = (n: number, uno: string, varios = `${uno}s`): string => `${n} ${n === 1 ? uno : varios}`

/**
 * Español.
 */
export const ES: PartialTexts = {
  pane: {
    awaiting: 'a la espera del primer turno',
    contextUsed: share => `${share} del contexto`,
    toCompaction: tokens => `${tokens} tokens hasta la compactación`,
    toCompactionShort: tokens => `${tokens} hasta compactar`,
    turnsLeft: turns => (turns === 1 ? 'un turno' : `unos ${turns} turnos`),

    judge: 'Auditoría ',
    judgeRuns: runs => cuenta(runs, 'pasada'),
    judgeTokens: amount => `${amount} tokens`,

    saved: 'Ahorrado ',
    checkNow: 'Analizar',
    checking: 'Analizando…',
    checkingLong: 'analizando esta sesión… suele tardar 10–20 s',

    time: 'Tiempo',
    context: 'Contexto',
    timeLead: 'en herramientas',
    contextLead: 'de herramientas',
    nothingYet: 'nada destaca todavía',

    empty: 'Vigilando en silencio. Nada se repite todavía.',

    fix: 'Corregir',
    fixNote: 'Corregir…',
    ignore: 'Ignorar',
    info: 'i',

    hits: times => `${times}×`,
    costShare: percent => `~${percent}% del contexto`,
    turnAt: turn => `turno ${turn}`,
    turnRange: (first, last) => `turnos ${first}–${last}`,
    // El inglés dice «ignored» de las dos cosas: la tarjeta que descartas tú y la instrucción que
    // Claude no siguió. El español las separa, como el francés, porque igualmente ha de elegir género.
    ignored: kind => `no seguida · ${kind}`,

    why: 'motivo',
    fixLabel: 'arreglo',
    callCount: calls => cuenta(calls, 'llamada'),
    turnCount: turns => cuenta(turns, 'turno'),
    agentCount: agents => cuenta(agents, 'agente'),
    perTurn: tokens => `~${tokens} tokens por turno`,
    charsOfContext: chars => `${chars} caracteres de contexto`,

    turnCell: turn => `turno ${turn}`,
    charsUnit: ' car',
    answerSize: chars => `${chars} de respuesta`,
    loop: 'agente',
    loopCost: (ktokens, edits) => `${ktokens}k tokens · ${cuenta(edits, 'edición', 'ediciones')}`,

    steerHint: 'Intro envía · Corregir… cierra · o /saver fix <n> <texto>',
    send: 'enviar',

    decided: 'Decidido',
    decidedWord: { keep: 'ignorado', steer: 'corregido con una nota', kill: 'corregido' },
    savedCredit: percent => `~${percent}% ahorrado`,
    perRepeat: percent => `~${percent}% por repetición`,
    ignoredTimes: times => `no seguida ${times}×`,

    rules: 'Reglas para la próxima sesión',
    artifact: {
      'claude-md': 'CLAUDE.md',
      skill: 'skill',
      'agent-brief': 'brief de agente',
      'settings-allow': 'regla de permiso',
    },
    write: 'Escribir',
    tryOnce: 'Probar',
    skip: 'Omitir',

    decidedCount: decided => `Decidido ${decided}`,
    rulesCount: rules => `Reglas ${rules}`,
    fullPane: '/saver para el panel completo',

    verbsHint: '/saver fix|ignore <n>',
    keysFocus: 'ctrl+x tab da el teclado a este panel',
    keysMove: 'Tab recorre',
    keysPress: 'Intro pulsa',
    keysBack: 'Esc devuelve el teclado',
  },

  band: {
    died: how => `El último turno terminó en ${how}`,
    diedError: 'un error de la API',
    diedRefusal: 'una negativa',
    diedContinue: 'escribe cualquier cosa para continuar',

    checking: 'analizando esta sesión…',

    foundWorthLook: cards => `${cuenta(cards, 'cosa')} que mirar`,
    foundSavingBoth: (cards, share, time) => `${cuenta(cards, 'forma')} de ahorrar ${share} y ${time}`,
    foundSaving: (cards, saving) => `${cuenta(cards, 'forma')} de ahorrar ${saving}`,
    foundShort: cards => `${cuenta(cards, 'desperdicio')} detectado${cards === 1 ? '' : 's'}`,
    costShare: percent => `${percent >= 1 ? `~${Math.round(percent)}%` : 'menos del 1%'} de tu contexto`,

    saved: 'ahorrado ',
    ofContext: ' de contexto',
    thisSession: ' esta sesión',

    running: 'en curso',
    agentCount: agents => cuenta(agents, 'agente'),
    callCount: calls => cuenta(calls, 'llamada'),

    watching: 'vigilando',
    watched: calls => `${cuenta(calls, 'llamada')} vigilada${calls === 1 ? '' : 's'}`,
    quiet: 'nada desperdiciado todavía',

    open: 'Abrir',
    close: 'Cerrar',
  },

  command: {
    description: 'ContextSaver: mostrar u ocultar el panel · check | fix [n] [texto] | ignore <n> | debug | reset',
    argumentHint: '[check | fix [n] [texto] | ignore <n> | debug | reset]',

    usage: 'Uso: /saver [check | fix [n] [texto] | ignore <n> | debug | reset]',
    fixUsage: 'Uso: /saver fix [n] [instrucción] (un número al principio indica la tarjeta que numera el panel; sin número: la tarjeta con el campo Corregir… abierto, si no la tarjeta 1)',
    paneShown: 'Panel de ContextSaver visible',
    paneHidden: 'Panel de ContextSaver oculto',
    nothingToDecide: 'ContextSaver: nada que decidir',
    reset: 'ContextSaver: estado de la sesión reiniciado',
    demoLoaded: 'ContextSaver: desperdicios de demostración cargados',

    checking: 'ContextSaver: analizando esta sesión en busca de desperdicio…',
    alreadyChecking: 'ContextSaver: ya está analizando',
    nothingNew: 'ContextSaver: nada nuevo',
    found: cards => `ContextSaver: ${cards} ${cards === 1 ? 'desperdicio nuevo' : 'desperdicios nuevos'}`,
    checkFailed: failure => `ContextSaver: análisis fallido — ${failure}`,
    notCheckedYet: failure => `ContextSaver: aún no se ha podido analizar — ${failure}`,

    card: (seat, kind, outcome) => `ContextSaver: tarjeta ${seat} — «${kind}» · ${outcome}`,
    noCard: (seat, cards) => `ContextSaver: no hay tarjeta ${seat} (1–${cards})`,
    outcomeIgnored: 'ignorada',
    outcomeFixed: 'corregida',
    outcomeNoted: text => `corregida con tu nota: ${text}`,

    toastIgnored: kind => `ContextSaver: «${kind}» ignorado`,
    toastFixed: alternative => `ContextSaver: corregido — ${alternative}`,
    toastNoted: instruction => `ContextSaver: corregido con tu nota — ${instruction}`,
    writeFirst: 'ContextSaver: escribe primero la instrucción',

    savedToast: figures => `${figures} de contexto ahorrado`,

    wrote: path => `${path} escrito`,
    trying: title => `«${title}» a prueba en esta sesión`,

    composerHasKeys: seat => `ContextSaver: el compositor tiene tu teclado — escribe /saver fix ${seat} <tu nota>`,
  },

  categories: {
    execution: 'ejecución',
    reading: 'lectura',
    production: 'producción',
    behavior: 'comportamiento',
    communication: 'comunicación',
    'multi-agent': 'multiagente',
    environment: 'entorno',
    process: 'proceso',
    other: 'otro',
  },

  judge: {
    // En inglés a propósito: es un párrafo añadido al final de un prompt en inglés, leído por el modelo
    // y por nadie más. Una consigna escrita en la lengua del prompt que la rodea es la que mejor se sigue;
    // lo que pide, en cambio, sí es español.
    directive: `## Language — write the reply's prose in Spanish
The rules and the blocks above are in English because that is this prompt's language; your reply's prose is not. Write \`kind\`, \`why\`, \`alternative\`, \`time\`, \`context\` and any \`proposal\` \`title\` and \`body\` in Spanish, in the plain words of the work, and keep the brevity the caps ask for — they count characters, not words. \`kind\` starts exactly with \`Claude sigue \` in place of \`Claude keeps \`, and what follows it is a gerund, as in \`Claude sigue ejecutando toda la suite tras cada edición de un solo archivo\`: the examples above show the English opening because they were written for it.
Everything a machine matches is never translated and stays exactly as specified above: the JSON keys, the \`id\` and its kebab slug, the nine \`category\` names, the evidence handles (\`r12\`, \`turn:7\`, \`agent:a3\`), the \`signature\` \`tool\` and \`key\` copied character-for-character from a LEDGER row, and the \`proposal\` \`kind\`. A translated one discards the finding whole.`,
    kindPrefix: 'Claude sigue ',
    instruction: text => `Instrucción del usuario (vía ContextSaver): ${text}`,
    kill: (kind, alternative) => `Detén este comportamiento durante el resto de la sesión: ${kind}. A partir de ahora: ${alternative}`,
  },

  config: {
    languageLabel: 'Idioma',
    languageAvailable: tags => `Disponibles: ${tags.join(', ')}.`,
  },
}
