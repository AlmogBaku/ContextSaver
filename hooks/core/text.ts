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

/** Truncates text to `cells` characters, ending it with '…' when it is cut and never a space before it. */
export const fit = (text: string, cells: number): string =>
  text.length <= cells ? text : `${text.slice(0, Math.max(0, cells - 1)).trimEnd()}…`

/** Returns a kebab-case slug of at most forty characters. */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
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

/** Wraps a user instruction in the standard ContextSaver prefix. */
export const instructionOf = (text: string): string =>
  `Instruction from the user (via ContextSaver): ${text}`

/** Produces the kill prompt for a stored pattern. */
export const killPrompt = (p: StoredPattern): string =>
  `Stop this behaviour for the rest of the session: ${p.kind}. From now on: ${p.alternative}`
