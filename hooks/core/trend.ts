// The header's trend, drawn as bars. The scale is absolute — a sample is a share of the whole context
// window, not of the samples the row happens to hold — so a flat session reads flat and a filling one
// climbs, and two draws of the same session never disagree about how high a bar is.
const BARS = '▁▂▃▄▅▆▇█'   // eight rungs, the tallest last
const FULL = 100

/** The bar one 0..100 sample is drawn as; the lowest rung is still a bar, so no sample reads as absent. */
const barOf = (sample: number): string =>
  BARS[Math.min(BARS.length, Math.max(1, Math.ceil((sample / FULL) * BARS.length))) - 1] ?? ''

/** Draws the newest `cells` samples of a 0..100 series as one row of bars, oldest first. */
export const sparkline = (samples: readonly number[], cells: number): string =>
  samples.slice(Math.max(0, samples.length - cells)).map(barOf).join('')
