import { say } from '../say'
import type { Usage, StoredPattern } from './types'

/** Returns the median of the numbers; 0 when there are none. */
export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? (sorted[mid] ?? 0) : (((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

/** Returns chars/4/window*100 rounded to 1 decimal. */
export const pctOf = (chars: number, window: number): number =>
  Math.round((chars / 4 / window) * 1000) / 10

/** Returns 100 - percent, or null when percent is undefined. */
export const pctLeft = (u: Usage): number | null =>
  u.percent !== undefined ? Math.round((100 - u.percent) * 10) / 10 : null

/** Formats milliseconds as '11m', '3m 50s', or '12s'. */
export const duration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`
}

/** Returns what a length of text costs in tokens, four characters to one. */
export const tokensOf = (chars: number): number => Math.round(chars / 4)

/** Formats a count short and rounded: '9.9k', '41k', '800'. */
export const kilo = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`

// The code point blocks a terminal draws two cells wide (Unicode TR #11, East Asian Wide and Fullwidth):
// the CJK ideographs, kana, Hangul, the fullwidth forms and the emoji that render as a pair. Everything
// else is one cell, which is why a Latin bundle never noticed the difference — `widthOf` is `length` there.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]

const codeCells = (code: number): number => (WIDE.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1)

/**
 * The cells a string draws in, which is its `length` only while it is Latin.
 *
 * Every reserve, ladder and column in the drawing is a number of cells, so a bundle whose words are
 * Chinese or Japanese would otherwise be measured at half its real width and run past whatever frames it.
 */
export const widthOf = (text: string): number => {
  let cells = 0
  for (const ch of text) cells += codeCells(ch.codePointAt(0) ?? 0)
  return cells
}

/** Pads text to `cells` display cells; a wide character counts for the two it draws. */
export const padCells = (text: string, cells: number, atStart = false): string => {
  const pad = ' '.repeat(Math.max(0, cells - widthOf(text)))
  return atStart ? `${pad}${text}` : `${text}${pad}`
}

/** Truncates text to `cells` display cells, ending it with '…' when it is cut and never a space before it. */
export const fit = (text: string, cells: number): string => {
  if (widthOf(text) <= cells) return text
  const room = Math.max(0, cells - 1)   // the '…' takes the last cell
  let kept = ''
  let used = 0
  for (const ch of text) {
    const width = codeCells(ch.codePointAt(0) ?? 0)
    if (used + width > room) break
    kept += ch
    used += width
  }
  return `${kept.trimEnd()}…`
}

/**
 * Returns a kebab-case slug of at most forty characters, used as a filename.
 *
 * Any letter or digit survives, not the ASCII ones alone: a rule the judge titled in Japanese or in
 * French would otherwise slug to nothing at all, and a skill would be written to `…/skills//SKILL.md`.
 * For a Latin title this is exactly `[^a-z0-9]+` once the case is folded, so nothing about it moved.
 */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** Collapses runs of whitespace (including newlines) to a single space and trims. */
export const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Returns JSON with keys sorted, top-level keys in omit removed. */
export const stableJson = (v: unknown, omit: readonly string[]): string => {
  const replacer = (_key: string, val: unknown): unknown => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>
      return Object.keys(obj)
        .filter(k => !omit.includes(k))
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => { acc[k] = obj[k]; return acc }, {})
    }
    return val
  }
  return JSON.stringify(v, replacer)
}

/** Renders a filled/empty gauge of `width` cells for a percentage 0..100. */
export const gauge = (percent: number, width: number): string => {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 100 * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Wraps a user instruction in the standard ContextSaver prefix, in the session's language. */
export const instructionOf = (text: string): string => say().judge.instruction(text)

/** Produces the kill prompt for a stored pattern, in the session's language. */
export const killPrompt = (p: StoredPattern): string => say().judge.kill(p.kind, p.alternative)
