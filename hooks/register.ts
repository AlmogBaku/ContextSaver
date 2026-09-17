import type { On } from 'claude-code'
import type { Host } from './host'
import { COMMAND, PLUGIN_NAME, initialState } from './core/types'

/** WP0 scaffold: bind the host, register /saver, answer /saver debug. */
export function register(on: On): void {
  let host: Host | null = null

  on('session.start', async ($, e, next) => {
    try {
      host = {
        now: () => $.clock.now(),
        invalidate: () => $.ui.invalidate('ui.render'),
        toast: (text) => $.ui.toast(text),
        log: (text) => $.ui.log(text),
        openPane: (args) => $.ui.open(args),
        closePane: (args) => $.ui.close(args),
        registerCommand: (spec) => $.command.register(spec),
        usage: (args?) => $.session.usage(args),
        storeGet: (key) => $.store.get(key),
        storeSet: (key, v) => $.store.set(key, v),
        fork: (prompt) => $.model.fork({ prompt }),
        readFile: (p) => $.fs.read(p),
        writeFile: (p, t) => $.fs.write(p, t),
        exists: (p) => $.fs.exists(p),
        debugFlag: () => $.env.get('CONTEXTSAVER_DEBUG'),
      }

      const u = await host.usage({ breakdown: 'summary' })
      const _state = initialState(e.cwd, u.context.window)

      try {
        await host.registerCommand(COMMAND)
      } catch (err) {
        host.log(`${PLUGIN_NAME}: failed to register command: ${String(err)}`)
      }

      return next(e)
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'saver' }, async ($, e, next) => {
    try {
      const args = e.args.trim()
      const [sub] = args.split(/\s+/)

      if (sub === 'debug') {
        return { text: `ContextSaver: scaffold ok — state initialised, host bound, plugin=${PLUGIN_NAME}` }
      }

      return { text: 'Usage: /saver [check | steer <text> | debug | reset]' }
    } catch {
      return next(e)
    }
  })
}
