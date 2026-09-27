/** A reviewer's prose reply: one important and one minor finding written as text, plus words that are not severities. */
export const proseReview = [
  '## Review of the retry change',
  '',
  '1. (Important) The retry loop never backs off, so a dead upstream is hit in a tight loop.',
  '2. Minor: the helper name reads as a noun.',
  '',
  'Nothing critical otherwise; the low-level socket code is untouched.',
].join('\n')
