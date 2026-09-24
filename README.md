<div align="center">

<h1><img src="assets/logo.png" alt="" height="40" align="top"> ContextSaver</h1>

**Catches what's bogging down your Claude Code session and lets you fix it in one click.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-5769F7)](https://claude.com/claude-code) [![tests](https://img.shields.io/badge/tests-279%20passing-3fb950)](scripts/check.sh) [![dependencies](https://img.shields.io/badge/dependencies-0-3fb950)](#development) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

Sessions bog down when Claude repeats a pattern it didn't need to. Running the full test suite after
every one-line edit. Reading the same file for the fourth time. Dumping a 2,000-line log into context
to find one traceback. Each of these had a shorter path to the same result — that gap is the waste.
ContextSaver spots those patterns as they compound and surfaces them while you can still act.

<p align="center">
  <img src="docs/screenshot.png" width="880"
       alt="The ContextSaver pane beside the transcript, showing two cards with their cost and the Fix, Fix… and Ignore buttons">
</p>

## Features

- **It names the pattern, not the big output.** "Claude keeps running the whole suite after every
  one-file edit — 3×, ~9% of context, 3m 12s." The calls behind the claim are one keypress away.
- **Nothing to configure.** No thresholds, no rules to tune. The plugin gathers the evidence and the
  model asks: was there a shorter path to the same result? That catches things nobody wrote a rule for.
- **It works mid-turn.** Long agentic turns are checked while they run, and your fix reaches Claude on
  its next tool result, then rides every prompt after it, so it survives compaction.
- **It shows where your session went.** One line each for time and context, and a plain sentence on what
  those minutes and tokens actually bought.
- **It stays quiet.** A single occurrence is never a finding. A wrong card costs more than a missed one.
- **Fixes outlive the session.** Turn a decision into a CLAUDE.md rule, a skill, an agent brief or a
  permission rule, written only when you click `Write`.
- **It reads in your language.** English, French, Spanish, German, Simplified Chinese and Japanese, picked
  from `/config` — the pane, the band, the replies, and the cards the audit writes, findings included.
- **It never touches your work.** No tool denied, no output trimmed, no error hidden. If a hook throws,
  your session carries on as if the plugin weren't there.

## Install

> [!NOTE]
> Needs Claude Code 2.1.273 or newer. ContextSaver is a
> [Claude Mod](https://github.com/anthropics/claude-code/tree/main/mods), built on function hooks, which
> are early access — so enable the flag first.

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1   # your shell, or ~/.claude/settings.json under "env"
```

Then, in Claude Code:

```
/plugin marketplace add AlmogBaku/ContextSaver
/plugin install contextsaver@contextsaver
```

That is the whole setup: no config, no API key, no dependencies, no build step. Installing mid-session
works too — the plugin reads what already happened out of the transcript and checks it right away, without
waiting for your next prompt.

## Usage

1. **Work as usual.** One line sits above your prompt and stays quiet until something repeats.
2. **A card appears** in the pane beside your transcript: what Claude keeps doing, how often, what it has
   cost you in context and minutes, and what to do instead. Press `i` for the calls behind it.
3. **Choose.** `Fix` sends the suggested fix, `Fix…` lets you reword it first, `Ignore` drops it for the
   session.
4. **Claude changes course** in the turn already running, and the pane credits what you saved — or tells
   you the instruction was ignored.
5. **Keep what worked.** Each decision is offered as a CLAUDE.md rule, a skill, an agent brief or a
   permission rule: `Write` saves it, `Try` uses it for this session only, `Skip` drops it.

> [!TIP]
> The pane docks beside your transcript in a wide terminal and sits above the prompt otherwise. `/saver`
> toggles it at any width, `ctrl+x tab` moves the keyboard into it, `Tab` cycles the buttons, `Enter`
> presses, and `Esc` hands the keys back.

### Commands

| Command | What it does |
|---|---|
| `/saver` | Show or hide the pane. |
| `/saver check` | Check now, instead of waiting for the next automatic check. |
| `/saver fix <n>` | Send card `n`'s suggested fix. |
| `/saver fix [n] <text>` | Send your own instruction instead. Without a number: the open card, else card 1. |
| `/saver ignore <n>` | Drop card `n` for the rest of the session. |
| `/saver debug` | Print the session state: ledger, findings, decisions, what the audit cost, savings. |
| `/saver reset` | Clear this session's ledger and decisions. Learned patterns survive. |

### Language

`/config` → **ContextSaver** → **Language** picks what the plugin reads in:

| Tag | Language | Tag | Language |
|---|---|---|---|
| `en` | English (default) | `de` | Deutsch |
| `fr` | Français | `zh-CN` | 简体中文 |
| `es` | Español | `ja` | 日本語 |

It moves the pane, the line above the prompt, what `/saver` answers, and the cards themselves — the audit
is asked for its findings in that language, so `Claude keeps running the whole suite` comes back as
`Claude continue de relancer toute la suite`, `Claude wiederholt den kompletten Testlauf` or
`Claude は繰り返しテストスイート全体を実行しています`. Cards found before you switched keep the language
they were written in until the behaviour turns up again.

What you type never moves: `/saver` and its subcommands keep their spelling in every language, and so do
the pattern ids, the categories inside them and the evidence handles.

<details>
<summary>Adding a language</summary>

Three lines, and nothing else in the plugin has to know:

1. `hooks/say/<tag>.ts` — `export const XX: PartialTexts = { … }` with the keys you have translated and no
   others. `hooks/say/en.ts` is the shape and the fallback, so a key you leave out is drawn in English and
   a key you misspell is a compile error.
2. One entry in `LANGUAGES`, in `hooks/say/say.ts`.
3. One string in the manifest's `language` options, so `/config` offers it.

To get the findings in your language too, fill `judge.directive` — one paragraph appended to the audit's
prompt — and `judge.kindPrefix`, the words every finding opens with. The prompt asks for that prefix and
the parser checks for it, both off the same key. Leave them out and the chrome is yours while the cards
stay English; the [spec](docs/SPEC.md#12-v05--the-mod-speaks-your-language) has the details.

Then replay a real session through it, which beats waiting for a finding to turn up:

```sh
bun run scripts/replay.ts <session-id> --prompt --lang ja | tail -8   # what the audit is asked
bun run scripts/replay.ts <session-id> --judge  --lang ja             # what it answers
```

The layout is measured in terminal cells rather than in characters, so a script whose characters are two
cells wide — Chinese, Japanese — is laid out and wrapped correctly, and the test suite runs every pane and
band over eight widths in every language the plugin ships.

</details>

## How it works

Every tool call becomes a row in a session ledger: what ran, how long it took, how much it added to your
context, which files it touched. About every 30k tokens and three turns — or every 40 calls and five
minutes inside a long turn — a background fork of your session's model reads the transcript and that
ledger, then asks: what has repeated and bogged things down, where did the time and context actually go,
and was there a shorter path to the same result? Whatever it finds becomes a card, with the costs
computed from the ledger rather than guessed by the model.

`Fix` and `Fix…` send instructions; they never block a tool. The text arrives on Claude's next tool
result and is attached to every later prompt for the rest of the session.

The architecture, the judge's prompt and the design brief are in [`docs/SPEC.md`](docs/SPEC.md); the
product spec is [`docs/PRD.md`](docs/PRD.md).

## Notes and limits

> [!IMPORTANT]
> The audit runs on your session's model, so a session on Opus pays Opus for it. It keeps itself to a few
> percent of the session's tokens, and `/saver debug` shows exactly what it spent.

- **Early access.** Function hooks are new and the API underneath can still change. Every module is
  tested and the main flow is verified live, but expect rough edges.
- **Short sessions stay quiet.** Under ~15 tool calls or 5 turns, only behaviour seen three or more times
  is reported.
- **Durations are wall time.** They include the time a permission prompt spent waiting for you, and the
  model is told as much.
- **Terminal and desktop only.** On mobile surfaces the plugin keeps its ledger and draws nothing.
- **The band speaks for dead turns and running workflows.** After a turn that ended in an API error or a
  refusal it reads `✕ Last turn ended in … · type anything to continue` until your next prompt; while a
  workflow runs and nothing is found it names the run, its stage, its agents and their calls.

## Development

```sh
git clone https://github.com/AlmogBaku/ContextSaver && cd ContextSaver
./scripts/check.sh                                          # validate --strict, typecheck, tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .    # run Claude Code with this folder loaded
```

All logic is pure functions over a single `State` in `hooks/core/`. `hooks/register.ts` is the only file
that touches events, and every hook falls back to `next(e)` on any path it does not own. `hooks/ui.tsx`
renders two view models and never reads `State`. Every line a person reads lives in `hooks/say/`, never
in the module that draws it. With `CONTEXTSAVER_DEBUG=1`, `/saver demo` fills the pane with sample cards,
so the drawing can be worked on without waiting for a real finding.

Under `--plugin-dir`, editing a file hot-reloads the plugin and resets session state. Learned patterns
persist in the plugin store.

## License

MIT © Almog Baku. See [LICENSE](LICENSE).
