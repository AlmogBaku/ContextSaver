import type { On } from 'claude-code'

/**
 * Answers `$.store` from an object the test can read back, so a persist is visible.
 *
 * @param on the test's `on`
 * @param entries what the store holds at the start
 * @returns the store's own object, written in place by every `store.set`
 */
export function storeStub(on: On, entries: Record<string, unknown> = {}): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...entries }
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => {
    kept[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete kept[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  return kept
}
