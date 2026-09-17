<div align="center">

<h1><img src="assets/logo.png" alt="" width="38" align="center"> &nbsp;ContextSaver</h1>

**Stop Claude Code from wasting tokens doing useless shit, in realtime.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-5769F7)](https://claude.com/claude-code) [![tests](https://img.shields.io/badge/tests-216%20passing-3fb950)](scripts/check.sh) [![dependencies](https://img.shields.io/badge/dependencies-0-3fb950)](#development) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

A Claude Code plugin that catches Claude repeating wasteful behaviour in your session and lets you stop
it with one click. Things like running the full test suite after every one-line edit, reading the same
file for the fourth time, or dumping a 2,000-line log into the context to find one traceback.

<p align="center">
  <img src="docs/screenshot.png" width="880"
       alt="The ContextSaver pane beside the transcript, showing two cards with their cost and the Fix, Fix… and Ignore buttons">
</p>

## Features

- **It names the behaviour, not the big output.** "Claude keeps running the whole suite after every
  one-file edit — 3×, ~9% of context, 3m 12s." The calls behind the claim are one keypress away.
- **Nothing to configure.** No thresholds, no rules to tune. The plugin gathers the evidence and the
  model decides what was waste, so it catches things nobody wrote a rule for.
- **It works mid-turn.** Long agentic turns are checked while they run, and your fix reaches Claude on
  its next tool result, then rides every prompt after it, so it survives compaction.
- **It shows where your session went.** One line each for time and context, and a plain sentence on what
  those minutes and tokens actually bought.
- **It stays quiet.** A single occurrence is never a finding. A wrong card costs you more than a missed one.
- **Fixes outlive the session.** Turn a decision into a CLAUDE.md rule, a skill, an agent brief or a
  permission rule, written only when you click `Write`.
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
works too — the plugin reads what already happened out of the transcript and checks it at the next
opportunity.

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

## How it works

Every tool call becomes a row in a session ledger: what ran, how long it took, how much it added to your
context, which files it touched. About every 30k tokens and three turns — or every 40 calls and five
minutes inside a long turn — a background fork of your session's model reads the transcript and that
ledger, then answers three questions: what has already repeated and wasted something, where the time and
context went, and what is going in circles. Whatever it finds becomes a card, with the costs computed
from the ledger rather than guessed by the model.

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

## Development

```sh
git clone https://github.com/AlmogBaku/ContextSaver && cd ContextSaver
./scripts/check.sh                                          # validate --strict, typecheck, tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .    # run Claude Code with this folder loaded
```

All logic is pure functions over a single `State` in `hooks/core/`. `hooks/register.ts` is the only file
that touches events, and every hook falls back to `next(e)` on any path it does not own. `hooks/ui.tsx`
renders two view models and never reads `State`. With `CONTEXTSAVER_DEBUG=1`, `/saver demo` fills the
pane with sample cards, so the drawing can be worked on without waiting for a real finding.

Under `--plugin-dir`, editing a file hot-reloads the plugin and resets session state. Learned patterns
persist in the plugin store.

## License

MIT © Almog Baku. See [LICENSE](LICENSE).
