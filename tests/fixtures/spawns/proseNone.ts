/** A prose review whose empty severities are labelled too: one important and one minor finding among six labels that say none. */
export const proseMixedNone = [
  '## Review of the cache change',
  '',
  'Critical: none',
  '**Blocker:** n/a',
  '1. (Important) The cache key ignores the tenant, so two tenants share an entry.',
  'High: -',
  '- Medium: 0',
  'Minor: the flag name reads as a verb.',
  'Low: nothing.',
].join('\n')

/** A prose review that labels every severity and finds nothing under any of them. */
export const proseAllNone = [
  '**Critical:** None',
  '- Minor: 0',
  'Blocker: n/a',
  'High: -',
  'Important: nothing',
  'Medium: —',
  'Low: no findings.',
].join('\n')
