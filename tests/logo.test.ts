import { describe, expect, test } from 'claude-code/testing'

import { LOGO_BITMAP, logoCells } from '../hooks/core/logo'

const GLYPHS = new Set(['.', 'd', 'l'])          // the whole alphabet of the stored bitmap
const CELL_GLYPHS = new Set([' ', '▀', '▄', '█'])  // and of the cells it is drawn as
const WORDS = 3                                   // u32 words one cell packs: the code point, the fg, the bg
const BYTES = 4
const DEFAULT_COLOR = 0x01000000
const LIGHT_COLOR = 0x0ea5e9
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The decoder the surface has, written the short way round, so the test reads the payload rather than
// the encoder that wrote it.
const bytesOf = (base64: string): number[] => {
  const clean = base64.replace(/=+$/, '')
  return Array.from({ length: Math.ceil(clean.length / 4) }, (_, at) => clean.slice(at * 4, at * 4 + 4))
    .flatMap(quad => {
      const sextets = [...quad].map(char => ALPHABET.indexOf(char))
      const packed = sextets.reduce((bits, sextet) => (bits << 6) | sextet, 0) << (6 * (4 - sextets.length))
      return [(packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff].slice(0, sextets.length - 1)
    })
}

const wordAt = (bytes: readonly number[], at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)

describe('logo', () => {
  test('the stored bitmap is eight rows of eight pixels in three glyphs', () => {
    const rows = LOGO_BITMAP.split('\n')

    expect(rows).toHaveLength(8)
    expect(rows.every(row => row.length === 8)).toEqual(true)
    expect([...LOGO_BITMAP.replace(/\n/g, '')].every(pixel => GLYPHS.has(pixel))).toEqual(true)
    expect(LOGO_BITMAP.includes('d'), 'the upper arc').toEqual(true)
    expect(LOGO_BITMAP.includes('l'), 'the lower arc').toEqual(true)
  })

  test('the cells are one padded base64 payload of the size the Raster declares', () => {
    const { columns, rows, cells } = logoCells()

    expect({ columns, rows }).toEqual({ columns: 8, rows: 4 })
    // Standard padded base64: four characters per three bytes, and the payload divides by three here.
    expect(cells.length).toEqual((columns * rows * WORDS * BYTES) / 3 * 4)
    expect(/^[A-Za-z0-9+/]*={0,2}$/.test(cells), 'nothing outside the standard alphabet').toEqual(true)
    expect(bytesOf(cells)).toHaveLength(columns * rows * WORDS * BYTES)
  })

  test('the first cell decodes back to the pixels the bitmap holds', () => {
    const { columns, rows, cells } = logoCells()
    const bytes = bytesOf(cells)

    // The bitmap opens '..' over '.d': an empty pixel over the arc, drawn as a lower half block.
    expect(wordAt(bytes, 0)).toEqual(' '.codePointAt(0))
    expect(wordAt(bytes, 4)).toEqual(DEFAULT_COLOR)
    expect(wordAt(bytes, 8)).toEqual(DEFAULT_COLOR)
    const second = WORDS * BYTES
    expect(wordAt(bytes, second)).toEqual('▄'.codePointAt(0))
    expect(wordAt(bytes, second + 4), 'the dark arc takes the terminal\'s own foreground').toEqual(DEFAULT_COLOR)

    // Every cell is one of the four glyphs the mark is drawn with, and one of the two colours.
    const glyphs = Array.from({ length: columns * rows }, (_, at) =>
      String.fromCodePoint(wordAt(bytes, at * WORDS * BYTES)))
    expect(glyphs.every(glyph => CELL_GLYPHS.has(glyph))).toEqual(true)
    const colors = Array.from({ length: columns * rows * 2 }, (_, at) =>
      wordAt(bytes, Math.floor(at / 2) * WORDS * BYTES + (at % 2 === 0 ? 4 : 8)))
    expect(colors.every(color => color === DEFAULT_COLOR || color === LIGHT_COLOR)).toEqual(true)
    expect(colors.includes(LIGHT_COLOR), 'the lower arc is the one colour the mark states').toEqual(true)
  })
})
