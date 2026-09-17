<div align="center">

<h1><img src="assets/logo.png" alt="" width="38" align="center"> &nbsp;ContextSaver</h1>

**Stop Claude Code from wasting tokens doing useless shit, in realtime.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-5769F7)](https://claude.com/claude-code) [![tests](https://img.shields.io/badge/tests-216%20passing-3fb950)](scripts/check.sh) [![dependencies](https://img.shields.io/badge/dependencies-0-3fb950)](#development) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

A Claude Code plugin that catches Claude repeating wasteful behaviour in your session and lets you stop
it with one click. For example:

- Running the full test suite after every one-line edit.
- Reading the same file for the fourth time.
- Dumping a 2,000-line log into the context to find one traceback.
- Retrying the same failing command without reading the error.
- Two subagents editing the same file.

<p align="center">
  <img src="docs/screenshot.png" width="880"
       alt="The ContextSaver pane docked beside the transcript: two wasters, each with its cost and the Fix, Fix… and Ignore buttons">
</p>

## Features

- **Catches behaviours, not byte counts.** "Claude keeps running the whole suite after every one-file
  edit — 3×, ~9% of context, 3m 12s." With the calls behind the claim one keypress away.
- **The model judges, not a heuristic.** Code keeps the ledger; the model decides what was waste.
  Nothing to configure, no thresholds, and it names waste nobody wrote a rule for.
- **Works mid-turn.** Long agentic turns are checked while they run. Your fix reaches Claude on its next
  tool result and rides every prompt after it, so it survives compaction.
- **Tells you where the time went.** One line each for wall-clock and context, with the model's
  one-sentence explanation of what those minutes and tokens were.
- **Quiet by default.** A single occurrence is never a finding. A wrong card costs more than a missed one.
- **Makes fixes permanent.** A decision worth keeping becomes a CLAUDE.md rule, a skill, an agent brief or
  a permission rule, written only when you click `Write`.
- **Never touches your work.** No tool denied, no output trimmed, no error hidden. If a hook throws, the
  session carries on as if the plugin weren't there.

## Install

ContextSaver is a [Claude Mod](https://github.com/anthropics/claude-code/tree/main/mods), built on Claude
Code's function hooks. Function hooks are early access, so enable the flag first, in your shell or in
`~/.claude/settings.json` under `env`:

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

Then, inside Claude Code:

```
/plugin marketplace add AlmogBaku/ContextSaver
/plugin install contextsaver@contextsaver
```

No config, no API key, no dependencies, no build step.

> [!NOTE]
> Requires Claude Code 2.1.273 or newer. Installing mid-session works: the plugin rebuilds its ledger
> from the transcript and runs its first check at the next opportunity.

## Usage

1. **Work as usual.** A one-line band sits above the prompt. It stays quiet until something repeats.
2. **A card appears** in the pane beside your transcript: what Claude keeps doing, how many times, what it
   cost you in context and minutes, and what it should do instead. Press `i` for the evidence.
3. **Pick a button.** `Fix` sends the suggested fix. `Fix…` lets you rewrite it first. `Ignore` silences
   it for the session.
4. **Claude changes course** in the turn that is already running. The pane credits what you saved, and
   tells you if Claude ignored the instruction.
5. **Keep it for next time.** The pane offers the decision as a CLAUDE.md rule, skill, agent brief or
   permission rule. `Write` writes it, `Try` uses it for this session only, `Skip` drops it.

The pane docks beside the transcript in a wide terminal and sits inline above the prompt otherwise.
`/saver` toggles it at any width. `ctrl+x tab` moves the keyboard into the pane, `Tab` moves between
buttons, `Enter` presses, `Esc` returns to the prompt.

### Commands

| Command | What it does |
|---|---|
| `/saver` | Show or hide the pane. |
| `/saver check` | Run the judge now instead of waiting for the cadence. |
| `/saver fix <n>` | Send card `n`'s fix as it stands. |
| `/saver fix [n] <text>` | Send your own instruction for card `n` (default: the open card, else card 1). |
| `/saver ignore <n>` | Silence card `n` for the session. |
| `/saver debug` | Dump session state: ledger, patterns, decisions, judge runs and cost, savings. |
| `/saver reset` | Clear this session's ledger and decisions. The pattern registry survives. |

## How it works

Every tool call becomes a ledger row: what ran, how long, how much it put in the context, which files it
touched. On a cadence (about 30k new tokens and 3 turns, or every 40 calls and 5 minutes inside a long
turn) a detached model fork reads the session's own transcript plus the ledger and answers three
questions: what has already repeated that was a waste, where did the time and context go, and what is
going in circles. Findings become cards. Costs on a card are computed from the rows, never taken from
the model.

`Fix` and `Fix…` are prompts, not blocks: delivered once on Claude's next tool result, then attached to
every later prompt for the rest of the session.

The full architecture, the judge prompt and the design brief are in [`docs/SPEC.md`](docs/SPEC.md); the
product spec is [`docs/PRD.md`](docs/PRD.md).

## Good to know

> [!IMPORTANT]
> The judge runs on your session's model. A session on Opus pays Opus for the audit. It keeps itself to a
> few percent of the session's tokens, and `/saver debug` shows exactly what it spent.

- **Early access.** Function hooks are new and the API under this can still move. Every module is tested,
  and the main flow was verified live.
- **Short sessions stay quiet.** Under ~15 tool calls or 5 turns, only behaviours seen three or more times
  are reported.
- **Durations are wall time.** They include time a permission prompt spent waiting for you. The judge is
  told so.
- **Terminal and desktop only.** On mobile surfaces the plugin keeps its ledger and draws nothing.

## Development

```sh
git clone https://github.com/AlmogBaku/ContextSaver && cd ContextSaver
./scripts/check.sh                                          # validate --strict, typecheck, tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .    # run Claude Code with the plugin from this folder
```

All logic is pure functions over one `State` in `hooks/core/`. `hooks/register.ts` is the only file that
touches events, and every hook falls back to `next(e)` on any path it does not own. `hooks/ui.tsx` renders
two view models and never reads `State`. With `CONTEXTSAVER_DEBUG=1`, `/saver demo` fills the pane with
sample cards so the drawing can be worked on without a real finding.

Under `--plugin-dir`, editing a file hot-reloads the plugin and resets session state; the pattern
registry persists in the plugin store.

## License

MIT © Almog Baku. See [LICENSE](LICENSE).
