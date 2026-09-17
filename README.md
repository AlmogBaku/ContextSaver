<div align="center">

<h1><img src="logo-render.png" alt="" width="38" align="center"> &nbsp;ContextSaver</h1>

**Stop Claude Code from wasting tokens doing useless shit, in realtime.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-5769F7)](https://claude.com/claude-code) [![tests](https://img.shields.io/badge/tests-147%20passing-3fb950)](scripts/check.sh) [![dependencies](https://img.shields.io/badge/dependencies-0-3fb950)](#under-the-hood) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

Half your context is garbage. Claude ran the whole test suite after a one-line edit. Then it ran it
again. It read the same file four times. It cat'd a 2,000-line log to find one traceback. It
re-summarized the plan every turn. Then the window filled up, compaction fired, and it forgot what you
were doing. You paid for all of it.

Your options right now: hit Esc, and type the same correction for the fourth time.

ContextSaver logs every tool call, then asks the model one question: **what has Claude already done
more than once that was a waste, and what should it do instead?** The answers land in a pane next to
your transcript, with three buttons.

<!-- Placeholder. Replace with a real capture:
     tmux capture-pane -e -p -t <session> | python3 scripts/screenshot.py docs/screenshot.png --cols 160 -->
<p align="center">
  <img src="docs/screenshot.png" width="880"
       alt="The ContextSaver pane docked beside the transcript: two live wasters, each with its cost and Keep, Steer and Kill">
</p>

**Keep** shuts it up. **Steer** sends the line you write. **Kill** sends the fix. Nothing gets blocked,
nothing waits on you, and nothing reaches Claude unless you click it.

## Install

Function hooks are early access, so turn the flag on first — in your shell, or in
`~/.claude/settings.json` as `{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }`.

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

Then, inside Claude Code:

```
/plugin marketplace add AlmogBaku/ContextSaver
/plugin install contextsaver@contextsaver
```

That's it. No config, no API key, no dependencies, no build step. One line shows up above your prompt
after the first turn, and in a wide terminal the pane opens itself the first time the model catches
something. `/saver` opens it at any width.

> [!NOTE]
> Needs Claude Code 2.1.273 or newer (verified on 2.1.274). Install it mid-session if you want: the
> plugin reads the transcript once and rebuilds its ledger from the calls that already happened.

## Why this isn't another token counter

- **It names the behaviour, not the byte count.** Not "that output was big" but "Claude keeps running
  the whole suite after every one-file edit — 3 times, ~9% of your context, 3m 12s."
- **The model calls it, not a heuristic.** Code gathers the evidence; the model decides what was
  stupid. Nothing to configure, no thresholds to tune, and it catches waste nobody wrote a rule for.
- **It shuts up when there's nothing.** One occurrence is never a finding. A wrong card costs you more
  than a missed one, so the judge is told to stay quiet unless it is sure.
- **One click, mid-session.** The instruction hits Claude on its very next tool result and rides every
  prompt after that, so the behaviour changes inside the turn that is already running.
- **The fix outlives the session.** Worth keeping? One click writes it as a CLAUDE.md rule, a skill, an
  agent brief or a permission rule.
- **It never touches your work.** No tool is ever denied, no output trimmed, no error hidden. If a hook
  throws, the session carries on as if the plugin weren't there.

## How it works

**Ledger.** Every tool call becomes one row: tool, a normalized key, its class, the agent, the turn,
how long it took, how much it dumped into the context, flags, the files it edited. Every turn records
its tokens, calls, duration and answer length. Nothing is shown, nothing is sent to Claude. Dropped
into a session that is already running, it reads the transcript once and rebuilds the rows from it.

**Judge.** Every ~30k new tokens and 3 turns, or whenever you ask, one detached `$.model.fork` reads
the session's own transcript plus the ledger and answers that one question. It cites the rows behind
every claim, reports what it spent and throttles itself.

**Pane.** Each finding is a waster: what Claude keeps doing, what it cost, and behind `i` the why, the
fix, the exact text `Kill` would send, and the evidence rows.

**Keep / Steer / Kill.** Steer and Kill are prompts, not blocks. Sent once immediately, then re-sent
with every later prompt for the rest of the session, so your fix survives a compaction.

**Savings.** When Claude does the cheap thing instead, the difference against that behaviour's own
median in your session is credited to `SAVED`. When it ignores you, the saving stays zero and the
waster comes back marked `ignored`, so you can say it harder.

## Commands

| Command | What it does |
|---|---|
| `/saver` | Shows or hides the pane. |
| `/saver check` | Runs the judge now instead of waiting for the cadence. |
| `/saver steer <text>` | Sends an instruction for the open (or newest) waster — the multi-line way to steer, from the composer. |
| `/saver debug` | Dumps the whole session state: rows, patterns, decisions, the judge's runs and cost, usage, savings. |
| `/saver reset` | Clears this session's ledger and decisions; the pattern registry survives. |

## Good to know

> [!IMPORTANT]
> The judge runs on your session's model. `$.model.fork` has no model field, so a session on Opus pays
> Opus to audit it. It keeps itself to a few percent of the session, and `/saver debug` shows exactly
> what it spent.

- **This is v1.** The main flow was verified in a live session and every module has tests, but function
  hooks are early access and the API under this can still move.
- **Short sessions stay quiet.** Under ~15 tool calls or 5 turns, only behaviours with three or more
  occurrences get reported.
- **A row's `ms` is wall time.** It includes the time a permission prompt sat waiting for you, so a big
  number is not automatically machine cost. The judge's prompt says so.
- **Terminal and desktop only.** On a mobile surface it keeps the ledger and draws nothing.
- **Hot reload starts a new session.** Under `--plugin-dir`, editing a file reloads the plugin: turn
  tokens, cards and decisions start empty, the ledger is rebuilt from the transcript, and the pattern
  registry survives in the store, so your past decisions still calibrate the judge.

## Under the hood

```sh
git clone https://github.com/AlmogBaku/ContextSaver && cd ContextSaver
./scripts/check.sh                                          # validate --strict, typecheck, 147 tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .    # run with the plugin loaded from this folder
```

All logic is pure functions over one `State` in `hooks/core/`. `hooks/register.ts` is the only file
that touches events and `$`, and every hook returns `next(e)` on any path it does not own.
`hooks/ui.tsx` is pure over two view models (`BandModel`, `PaneModel`) and never reads `State`. Every
row is measured before it is drawn: a header that does not fit drops whole segments rather than cutting
a number.

The pane's one accent is the theme key `suggestion` (rgb(87,105,247), ansi blue) — the engine has no
`accent` key, and `suggestion` carries the same value as `permission` and the engine's own
`rate_limit_fill`. It marks a live waster's `●`, the gauge's filled cells and the band's `n new`.
Everything else is default text or dim.

The build spec — architecture, module contracts, the judge prompt, the design brief, the UX
walkthrough — is [`docs/SPEC.md`](docs/SPEC.md); the product spec it implements is
[`docs/PRD.md`](docs/PRD.md).
