import type {
  CommandSpec,
  ModelForkResult,
  PaneCloseArgs,
  PaneOpenArgs,
  SessionMessage,
  SessionUsage,
  SessionUsageArgs,
  UiFocusArgs,
  UiFocusResult,
} from 'claude-code'

/** Host table: one lambda per `$.noun.verb` call, bound in session.start. */
export type Host = {
  /** $.clock.now() — current time in milliseconds. */
  now(): Promise<number>
  /** $.ui.invalidate('ui.render') — request a redraw (fire-and-forget). */
  invalidate(): void
  /** $.ui.toast(text) — show a transient notification (fire-and-forget). */
  toast(text: string): void
  /** $.ui.log(text) — emit a log line (fire-and-forget). */
  log(text: string): void
  /** $.ui.open(args) — open the named pane. */
  openPane(args: PaneOpenArgs): Promise<void>
  /** $.ui.close(args) — close the named pane. */
  closePane(args: PaneCloseArgs): Promise<void>
  /** $.ui.focus(args) — move a site's focus ring onto one of this plugin's elements. */
  focusElement(args: UiFocusArgs): Promise<UiFocusResult>
  /** $.command.register(spec) — register a slash command. */
  registerCommand(spec: CommandSpec): Promise<{ command: string }>
  /** $.session.usage(args?) — read context window usage. */
  usage(args?: SessionUsageArgs): Promise<SessionUsage>
  /** $.session.messages() — read the transcript so far, newest 4096 messages. */
  messages(): Promise<SessionMessage[]>
  /** $.store.get(key) — read a value from the plugin store. */
  storeGet(key: string): Promise<unknown>
  /** $.store.set(key, v) — write a value to the plugin store. */
  storeSet(key: string, v: unknown): Promise<void>
  /** $.model.fork({ prompt }) — run a detached model completion over the session transcript. */
  fork(prompt: string): Promise<ModelForkResult | null>
  /** $.fs.read(p) — read a file as a string. */
  readFile(p: string): Promise<string>
  /** $.fs.write(p, t) — write a string to a file. */
  writeFile(p: string, t: string): Promise<void>
  /** $.fs.exists(p) — check if a path exists. */
  exists(p: string): Promise<boolean>
  /** $.env.get('CONTEXTSAVER_DEBUG') — read the debug flag. */
  debugFlag(): Promise<string | undefined>
}
