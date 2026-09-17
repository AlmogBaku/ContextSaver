import { describe, expect, mock, test } from 'claude-code/testing'

describe('register', () => {
  test('session.start binds the host and /saver debug echoes state', async ($, on) => {
    // Answer next(e) for session.start
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    // Answer op calls the plugin makes during session.start
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({
      value: { context: { window: 200000 }, rateLimits: [] },
    }))

    // Answer store and clock ops
    mock.store(on)
    mock.clock(on)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const result = await $.command.run({
      command: 'saver',
      args: 'debug',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(result.text).toContain('ContextSaver')
  })
})
