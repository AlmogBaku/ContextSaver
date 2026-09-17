import type { Args, On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { storeStub } from './storeStub'
import { usageAnswer } from './usageAnswer'

/** What a ContextSaver session does to its host, kept for the test to read back. */
export type SaverWorld = {
  clock: MockClock
  store: Record<string, unknown>
  opened: Args<'ui.open'>[]
  closed: Args<'ui.close'>[]
  toasts: string[]
  logs: string[]
  commands: string[]
  usage: { tokens: number; percent: number }
  denyUsage: boolean   // from here on `session.usage` is refused, as another plugin or a policy would refuse it
}

/**
 * Answers everything a ContextSaver session asks of its host and keeps what it did:
 * the start, the clock, the store, the pane, the toasts, the log and the commands it registers.
 *
 * @param on the test's `on`
 * @param stored what the plugin's store holds at the start
 * @returns the world: the clock, the store's object, and the calls the plugin made
 */
export function startsSaver(on: On, stored: Record<string, unknown> = {}): SaverWorld {
  const world: SaverWorld = {
    // A real epoch, not 0: the mid-turn gate keeps five minutes between runs against `$.clock.now()`,
    // which is milliseconds since the epoch, and a clock starting at 0 is a session that began then.
    clock: mock.clock(on, { now: 1_700_000_000_000 }),
    store: storeStub(on, stored),
    opened: [],
    closed: [],
    toasts: [],
    logs: [],
    commands: [],
    usage: { tokens: 24_000, percent: 12 },
    denyUsage: false,
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => {
    world.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.usage', () => (world.denyUsage ? { deny: 'no usage today' } : { value: usageAnswer(world.usage) }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    world.opened.push(e)
    return { value: undefined }
  })
  on('ui.close', ($, e) => {
    world.closed.push(e)
    return { value: undefined }
  })
  return world
}
