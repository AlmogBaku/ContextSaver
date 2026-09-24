import { describe, expect, test } from 'claude-code/testing'

import { buildPrompt, parseReply } from '../hooks/core/judge'
import { cardOf } from '../hooks/core/patterns'
import { instructionOf, killPrompt, widthOf } from '../hooks/core/text'
import { DEFAULT_LANGUAGE, EN, FR, LANGUAGES, LANGUAGE_TAGS, sayOf, setSay } from '../hooks/say'
import type { PartialTexts, Texts } from '../hooks/say'
import { agentAliases } from '../hooks/core/evidence'
import { judgeState } from './fixtures/judge/judgeState'
import { rawFinding } from './fixtures/judge/rawFinding'
import { replyText } from './fixtures/judge/replyText'
import { suitePattern } from './fixtures/patterns/suitePattern'

/** The bundle's groups, by name: what a language may translate. */
const GROUPS = ['pane', 'band', 'command', 'categories', 'judge', 'config'] as const

/** Every leaf of a bundle, as `group.key`. */
const keysOf = (texts: PartialTexts): readonly string[] =>
  GROUPS.flatMap(group => Object.keys(texts[group] ?? {}).map(key => `${group}.${key}`))

/** What one leaf holds, whatever its group. */
const leafOf = (texts: Texts, key: string): unknown => {
  const [group = '', leaf = ''] = key.split('.')
  return (texts[group as keyof Texts] as Record<string, unknown>)[leaf]
}

/**
 * Runs the body with the language settled, and hands it back whatever happens: the holder is a
 * module's, so a test that left it French would be a test that failed the next file.
 */
const spoken = (tag: string, body: () => void): void => {
  setSay(tag)
  try {
    body()
  } finally {
    setSay(DEFAULT_LANGUAGE)
  }
}

describe('English', () => {
  test('it is complete, which is what makes it the fallback', ($, _on) => {
    for (const group of GROUPS) expect(Object.keys(EN[group]).length).toBeGreaterThan(0)
  })

  test('no line but the language directive is left empty', ($, _on) => {
    for (const key of keysOf(EN)) {
      const value = leafOf(EN, key)
      if (typeof value !== 'string' || key === 'judge.directive') continue
      expect(value.length, `${key} says nothing`).toBeGreaterThan(0)
    }
  })

  test('every tag the manifest may offer answers, and English is one of them', ($, _on) => {
    expect(LANGUAGE_TAGS).toContain(DEFAULT_LANGUAGE)
    expect(LANGUAGES[DEFAULT_LANGUAGE], 'English is the bundle itself, so its entry translates nothing').toEqual({})
  })
})

describe('a translation', () => {
  test('none carries a key English does not, so a typo cannot hide', ($, _on) => {
    const mine = new Set(keysOf(EN))
    for (const [tag, texts] of Object.entries(LANGUAGES)) {
      for (const key of keysOf(texts)) expect(mine.has(key), `${tag}: ${key} is in no English group`).toBe(true)
    }
  })

  test('each one answers every key, in its own words or in English', ($, _on) => {
    for (const tag of LANGUAGE_TAGS) {
      const texts = sayOf(tag)
      for (const key of keysOf(EN)) expect(leafOf(texts, key), `${tag}: ${key} answers nothing`).toBeDefined()
    }
  })

  test('a label that has to fit a fixed column keeps its cells, wide characters counted', ($, _on) => {
    // The two gutters are the only columns a label cannot degrade out of: the pane draws them at a
    // constant width and truncates whatever overruns, so a translation is held to them here.
    const GUTTER = 10
    for (const tag of LANGUAGE_TAGS) {
      const { why, fixLabel, time, context } = sayOf(tag).pane
      for (const [name, label] of [['why', why], ['fix', fixLabel], ['time', time], ['context', context]] as const) {
        expect(widthOf(label), `${tag}: ${name} is "${label}", ${widthOf(label)} cells of ${GUTTER}`).toBeLessThanOrEqual(GUTTER)
      }
    }
  })

  test('what it leaves out falls back to English, line by line', ($, _on) => {
    const half = sayOf('half-finished')
    expect(half, 'a tag no file answers to is English whole, never a blank pane').toBe(EN)
    // Registered and merged: every key answers something, its own words or English's.
    const fr = sayOf('fr')
    for (const key of keysOf(EN)) expect(leafOf(fr, key), `${key} answers nothing`).toBeDefined()
  })

  test('a registered language keeps its own words', ($, _on) => {
    const fr = sayOf('fr')
    expect(fr.pane.ignore).toBe('Ignorer')
    expect(fr.pane.ignore).not.toBe(EN.pane.ignore)
    expect(fr.categories['multi-agent']).toBe('multi-agents')
    expect(fr.command.nothingNew).toBe('ContextSaver : rien de nouveau')
  })

  test('the tag is read loosely, since it is written by hand', ($, _on) => {
    expect(sayOf(' FR ').pane.ignore).toBe('Ignorer')
    expect(sayOf('zh-cn').pane.ignore, 'a region subtag keeps its BCP 47 spelling and is matched without case')
      .toBe(sayOf('zh-CN').pane.ignore)
    expect(sayOf(undefined), 'no option at all is English').toBe(EN)
    expect(sayOf(42), 'and so is anything that is not a tag').toBe(EN)
  })
})

describe('what the language reaches', () => {
  test('the pane draws a card in it, down to the stats and the tag', ($, _on) => {
    const state = judgeState({ patterns: [suitePattern] })
    spoken('fr', () => {
      const card = cardOf({ ...suitePattern, hits: ['toolu_03'], ignored: 2 }, state, 1, agentAliases(state.rows))
      expect(card.kind.startsWith('non suivie · '), 'French keeps the instruction Claude dropped apart from the card you drop').toBe(true)
      expect(card.stats).toContain('du contexte')
      expect(card.stats).toContain('tour')
    })
    const card = cardOf({ ...suitePattern, hits: ['toolu_03'], ignored: 2 }, state, 1, agentAliases(state.rows))
    expect(card.kind.startsWith('ignored · '), 'and in English once the language is back').toBe(true)
  })

  test('the two texts sent to Claude are written in it', ($, _on) => {
    spoken('fr', () => {
      expect(instructionOf('fais court')).toBe('Instruction de l’utilisateur (via ContextSaver) : fais court')
      expect(killPrompt(suitePattern)).toContain('Arrête ce comportement pour le reste de la session')
    })
    expect(instructionOf('keep it short')).toBe('Instruction from the user (via ContextSaver): keep it short')
  })
})

describe('the judge', () => {
  test('English leaves the prompt exactly as this file spells it: no placeholder, no blank line for one', ($, _on) => {
    const prompt = buildPrompt(judgeState())
    expect(prompt).not.toContain('{{LANGUAGE}}')
    expect(prompt.endsWith('\n\nReturn the JSON object only.\n'), 'the last line follows the LEDGER as it always did').toBe(true)
  })

  test('another language appends its directive, which names the opening words the parser wants', ($, _on) => {
    spoken('fr', () => {
      const prompt = buildPrompt(judgeState())
      expect(prompt).not.toContain('{{LANGUAGE}}')
      expect(prompt, 'the directive lands last, where the model reads it after the evidence')
        .toContain("## Language — write the reply's prose in French")
      expect(prompt, 'and it quotes the very prefix `findingOf` will test for')
        .toContain(sayOf('fr').judge.kindPrefix)
      expect(prompt.indexOf('## Language'), 'after the LEDGER, before the last line')
        .toBeGreaterThan(prompt.indexOf('## LEDGER'))
    })
  })

  test('a finding is kept when its kind opens in the session\'s language, and dropped when it does not', ($, _on) => {
    const french = rawFinding({ kind: 'Claude continue de relancer toute la suite après chaque édition d’un seul fichier' })
    spoken('fr', () => {
      const kept = parseReply(replyText([french]), judgeState())
      expect(kept.findings.length, 'the French opening is the one asked for').toBe(1)
      const dropped = parseReply(replyText([rawFinding()]), judgeState())
      expect(dropped.findings.length, 'an English one is a reply that ignored the directive').toBe(0)
      expect(dropped.dropped[0]).toContain('Claude continue de ')
    })
    expect(parseReply(replyText([rawFinding()]), judgeState()).findings.length, 'and back in English the reverse holds').toBe(1)
    expect(parseReply(replyText([french]), judgeState()).findings.length).toBe(0)
  })
})
