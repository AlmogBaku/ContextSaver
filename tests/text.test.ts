import { describe, expect, test } from 'claude-code/testing'
import {
  collapseWs,
  duration,
  fit,
  gauge,
  instructionOf,
  killPrompt,
  kilo,
  median,
  pctLeft,
  pctOf,
  slug,
  stableJson,
  tokensOf,
} from '../hooks/core/text'
import type { StoredPattern } from '../hooks/core/types'

describe('text', () => {
  test('median returns 0 for empty array', ($, _on) => {
    expect(median([])).toBe(0)
  })

  test('median returns the middle value for odd-length array', ($, _on) => {
    expect(median([1, 3, 5])).toBe(3)
  })

  test('median returns average of two middle values for even-length array', ($, _on) => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  test('pctOf computes chars/4/window*100 to 1 decimal', ($, _on) => {
    // 400 chars / 4 / 100000 * 100 = 0.1
    expect(pctOf(400, 100000)).toBe(0.1)
    // 4000 chars / 4 / 100000 * 100 = 1.0
    expect(pctOf(4000, 100000)).toBe(1)
    // 200000 chars / 4 / 100000 * 100 = 50.0
    expect(pctOf(200000, 100000)).toBe(50)
  })

  test('pctLeft returns 100 minus percent', ($, _on) => {
    expect(pctLeft({ window: 100000, percent: 30 })).toBe(70)
  })

  test('pctLeft returns null when percent is undefined', ($, _on) => {
    expect(pctLeft({ window: 100000 })).toBeNull()
  })

  test('duration formats seconds', ($, _on) => {
    expect(duration(12000)).toBe('12s')
  })

  test('duration formats whole minutes', ($, _on) => {
    expect(duration(660000)).toBe('11m')
  })

  test('duration formats minutes and seconds', ($, _on) => {
    expect(duration(230000)).toBe('3m 50s')
  })

  test('kilo rounds a count short', ($, _on) => {
    expect(kilo(800)).toBe('800')
    expect(kilo(9_900)).toBe('9.9k')
    expect(kilo(24_000)).toBe('24k')
  })

  test('slug produces kebab-case at most 40 chars', ($, _on) => {
    expect(slug('Hello World!')).toBe('hello-world')
    expect(slug('a'.repeat(50))).toHaveLength(40)
  })

  test('collapseWs collapses whitespace and trims', ($, _on) => {
    expect(collapseWs('  foo   bar\nbaz  ')).toBe('foo bar baz')
  })

  test('stableJson sorts keys and omits top-level keys', ($, _on) => {
    const result = stableJson({ z: 1, a: 2, tool_use_id: 'x' }, ['tool_use_id'])
    expect(result).toBe('{"a":2,"z":1}')
  })

  test('instructionOf wraps text in the standard prefix', ($, _on) => {
    expect(instructionOf('do less')).toBe('Instruction from the user (via ContextSaver): do less')
  })

  test('killPrompt builds stop instruction from pattern', ($, _on) => {
    const p: StoredPattern = {
      id: 'execution:full-suite',
      category: 'execution',
      kind: 'Claude keeps running bun test',
      signature: null,
      why: 'repeated',
      alternative: 'run only covering tests',
      confidence: 0.9,
      proposal: null,
      estTokensPerTurn: null,
      lastDecision: null,
    }
    expect(killPrompt(p)).toBe(
      'Stop this behaviour for the rest of the session: Claude keeps running bun test. From now on: run only covering tests'
    )
  })

  test('tokensOf counts four characters to the token', ($, _on) => {
    expect(tokensOf(4_800)).toBe(1_200)
    expect(tokensOf(0)).toBe(0)
  })

  test('fit truncates with an ellipsis and never leaves a space before it', ($, _on) => {
    expect(fit('bun test', 8)).toBe('bun test')
    expect(fit('bun test tests/auth.test.ts', 12)).toBe('bun test te…')
    expect(fit('bun test the whole suite', 10)).toBe('bun test…')
  })

  test('gauge fills cells proportionally', ($, _on) => {
    expect(gauge(50, 8)).toBe('████░░░░')
    expect(gauge(0, 4)).toBe('░░░░')
    expect(gauge(100, 4)).toBe('████')
  })
})
