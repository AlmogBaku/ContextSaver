<div align="center">

<h1><img src="assets/logo.png" alt="" width="38" align="center"> &nbsp;ContextSaver</h1>

**Stop Claude Code from wasting tokens doing useless shit, in realtime.**

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-5769F7)](https://claude.com/claude-code) [![tests](https://img.shields.io/badge/tests-200%20passing-3fb950)](scripts/check.sh) [![dependencies](https://img.shields.io/badge/dependencies-0-3fb950)](#under-the-hood) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

Half your context is garbage. Claude ran the whole test suite after a one-line edit. Then it ran it
again. It read the same file four times. It cat'd a 2,000-line log to find one traceback. It
re-summarized the plan every turn. Then the window filled up, compaction fired, and it forgot what you
were doing. You paid for all of it.

Your options right now: hit Esc, and type the same correction for the fourth time.

ContextSaver logs every tool call, then asks the model three questions: **what has Claude already done
more than once that was a waste, where did your time and your context actually go, and what is going in
circles?** The answers land in a pane next to your transcript, with three buttons.

<!-- A real 160-column capture of `/saver demo`:
     tmux capture-pane -e -p -t <session> | python3 scripts/screenshot.py docs/screenshot.png --cols 160 -->
<p align="center">
  <img src="docs/screenshot.png" width="880"
       alt="The ContextSaver pane docked beside the transcript: two live wasters, each with its cost and Fix, Fix… and Ignore">
</p>

**Fix** sends the fix. **Fix…** opens it as a line you can rewrite first. **Ignore** shuts it up. Nothing
gets blocked, nothing waits on you, and nothing reaches Claude unless you click it.

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
after the first turn — `ContextSaver ●  Found 2 ways to save ~12% of your context and 51m`, or the calls
it is quietly watching until then — and in a wide terminal the pane opens itself the first time the model
catches something. `/saver` opens it at any width.

> [!NOTE]
> Needs Claude Code 2.1.273 or newer (verified on 2.1.274). Install it mid-session if you want: the
> plugin reads the transcript once and rebuilds its ledger from the calls that already happened.

## Realtime context optimization, inside the session

Your context gets optimized while you are still using it: the behaviour is caught, named and changed in
the turn that is already running.

- **It names the behaviour.** "Claude keeps running the whole suite after every one-file edit — 3 times,
  ~9% of your context, 3m 12s."
- **The model calls it, not a heuristic.** Code gathers the evidence; the model decides what was stupid.
  Nothing to configure, no thresholds to tune, and it catches waste nobody wrote a rule for.
- **It shuts up when there's nothing.** One occurrence is never a finding. A wrong card costs you more
  than a missed one, so the judge is told to stay quiet unless it is sure.
- **It never touches your work.** No tool is ever denied, no output trimmed, no error hidden. If a hook
  throws, the session carries on as if the plugin weren't there.

## What it catches

- The full suite after every one-line edit, and the typecheck that reruns when nothing changed.
- The same file read again, or 2,000 lines read where one grep would have done it.
- Raw command output dumped into the window instead of filtered where it was produced.
- The same failing command retried three times without anyone reading the error.
- A whole file rewritten to change three lines.
- Four subagents reading the same files, two of them editing the same one.
- The plan narrated again instead of the work getting done.
- The work redone from scratch after a compaction.

None of that is hardcoded. It is what the model has named so far, and it names whatever repeats in
*your* session.

## How it works

ContextSaver is a **Claude Mod** — a plugin built on function hooks, Claude Code's newest extension
point. That is the whole trick: it runs *inside* your session instead of reading logs afterwards, so it
sees every tool call as it happens and can talk to Claude mid-turn, while there is still time to change
what it does.

For you, it goes like this.

1. **You work exactly as you do now.** Install it and forget it. No config, no prompts, no
   interruptions. It watches quietly and says nothing.
2. **It waits for a habit, not a spike.** One big command is not a problem. The same pointless command
   for the third time is. Only behaviours that already repeated ever reach you.
3. **It answers "what took so long".** The header says where the wall-clock and the window went — `tests
   ×12 · 22m`, `reads ×30 · 41% of your context` — and the model writes one plain line under each: what
   those minutes were, in the words of your own work. An explanation is not an accusation: a long session
   can be an honest one, and it says so.
4. **It doesn't wait for the turn to end.** A three-hour agentic turn is checked while it runs, every 40
   tool calls and at most every five minutes, so the card arrives while there is still time to change
   course. The run to compaction is paced by how fast the window is actually filling, not by what a turn
   was billed.
5. **A card shows up in the pane, next to your transcript.** What Claude keeps doing, what it has cost
   you so far — how many times, how much of your context, how much of your life — and what it should be
   doing instead. Press `i` for the receipts: the reasoning in full, then every call behind the claim —
   the turn, the command or file, the loop it ran in, its seconds and its size, and the first line of
   what came back. Each card is numbered, so `/saver ignore 2` decides the one you are looking at.
6. **You press one of three buttons.** *Fix* sends the suggestion as it stands. *Fix…* opens it as a line
   you can rewrite first — the field comes pre-filled. *Ignore* if you don't care, and it never mentions
   it again. The pane's last line names the same verbs for the keyboard — `/saver fix|ignore <n>` —
   because the composer keeps the Tab ring.
7. **Claude changes course in the turn that's already running.** Your words reach it on its very next
   tool result, and ride along with every prompt after that, so it doesn't quietly drift back after a
   compaction. Nothing is blocked, nothing is denied, nothing waits on you.
8. **You see what you got back.** When Claude does the cheap thing instead, the pane credits the
   difference against what that behaviour normally costs you in this session: context and minutes. If
   Claude ignores you, it says so, and the card comes back so you can say it harder.
9. **Next session starts smarter.** A decision worth keeping becomes a CLAUDE.md rule, a skill, an agent
   brief or a permission rule — written only when you press `Write`.

**The technical bit,** briefly. Every tool call becomes a row: what ran, how long it took, how much it
dumped into your context, which files it touched. Every ~30k new tokens, and inside a long turn every 40
rows and five minutes, one detached model fork reads the session's own transcript plus that ledger and
the minutes and characters totalled by consumer, then answers three questions — what has already
repeated, where the time and the context went, and what is going in circles. There are no pattern rules
or thresholds in the code to tune; the numbers on a card are computed from the rows, not from the model's
guess. The full architecture, and the judge's prompt, are in [`docs/SPEC.md`](docs/SPEC.md).

## Commands

| Command | What it does |
|---|---|
| `/saver` | Shows or hides the pane. |
| `/saver check` | Runs the judge now instead of waiting for the cadence, and tells you what it found — `2 new wasters`, `nothing new`, or why it failed — and if it found something the pane opens at any width. |
| `/saver fix <n>` | Fixes card `n`: sends the fix the card offers, as it stands. |
| `/saver fix [n] <text>` | Fixes card `n` with your own note instead — a leading number is always read as the card the pane draws, and without one it is the waster whose `Fix…` field is open, else card 1. The multi-line way to write one, from the composer. |
| `/saver ignore <n>` | Ignores card `n`: nothing is sent, and it stays quiet for the session. |
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
./scripts/check.sh                                          # validate --strict, typecheck, 201 tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .    # run with the plugin loaded from this folder
```

All logic is pure functions over one `State` in `hooks/core/`. `hooks/register.ts` is the only file
that touches events and `$`, and every hook returns `next(e)` on any path it does not own.
`hooks/ui.tsx` is pure over two view models (`BandModel`, `PaneModel`) and never reads `State`.

Pressing `Fix…` asks the surface for the keyboard: `autoFocus` only lands where a site takes the
keyboard fresh, and the click that pressed `Fix…` left the ring on that Button, so the shell calls
`$.ui.focus({ requestId, key })` for the field it just opened. The ring is the person's to give — a
surface that will not move it changes nothing, and the field is still there to be clicked.

Every row is assembled and measured before it is drawn: a Button at a row's right edge gets its cells
reserved first, and a header row that does not fit drops whole segments rather than cutting a number.
The band is one teaser, never a dashboard: a mark and one sentence, whichever of the four applies first —
a check in flight, what the waiting cards would save, what the session has already saved, else the calls
it is watching. Below 70 columns that sentence gives back the time before it gives back a word, because a
cut figure lies. It is drawn `BAND_RESERVE` cells short of `site.bodyColumns` because the engine draws
its own collapse control `[-]` over the last cells of that row, and it carries no hotkey: a bare digit
typed into an empty composer would fire it.

With `CONTEXTSAVER_DEBUG` set, `/saver demo` fills the pane with three sample wasters from
`hooks/core/demo.ts` — two awaiting a decision, one already fixed with a note so the decisions and the rules draw
too — against a sample usage and four sample turns carrying the context the window held after each, so the
header's gauge, its trend and its run to compaction draw as well, and opens it, so the design can be looked at without waiting for a real finding. One sample call
ran inside a subagent, which is where the pane's `a1` loop column comes from. Nothing is sent to Claude
and nothing is written; without the flag the command is not there.

Subagent loops are named `a1`, `a2`… in order of first appearance — in the pane's evidence and in the
ledger the judge reads. The rows keep the real agent id, so matching stays stable; nobody has to read
`toolu`-style hashes to see which loop ran a call.

The pane's accent is the theme key `suggestion` (rgb(87,105,247), ansi blue), on the newest card's
border, a live waster's `●` and the band's mark and line while a card waits. Three keys past it carry a fact rather than a
decoration: `success` on what the session got back (the header's `Saved` figure, a `✓` in Decided, a
credit that settled), and `warning` above 70% of the window with `error` above 90% on the gauge's fill —
the one place in the pane where a number is a warning. All four live behind one `TONES` table in
`hooks/ui.tsx`, so a key a theme refuses is flipped to the accent in one edit. Everything else is
default text or dim. `Button` has no `color` prop, so the verbs take their tone from the surface and
carry a glyph instead: `✓ Fix`, `✎ Fix…`, `– Ignore`, `↻ Check now`, `✎ Write`, `▸ Try`, `– Skip`; the
band's own four marks are `◐` checking, `●` found, `✓` saved and `◌` watching.

The mark in the header is a `Raster`, the terminal's cell-grid leaf: an 8×8 two-tone bitmap of
`assets/logo.png`, derived once offline and stored in `hooks/core/logo.ts` as eight lines of `.` `d` `l`,
then packed into 8 columns × 4 rows of half-block cells. Its upper arc is drawn in the terminal's own
default foreground rather than as an rgb value, so the ring reads on a light theme and a dark one alike;
only the lower arc names a colour. The whole drawing contract is Appendix D of the spec.

The build spec — architecture, module contracts, the judge prompt, the design brief, the UX
walkthrough — is [`docs/SPEC.md`](docs/SPEC.md); the product spec it implements is
[`docs/PRD.md`](docs/PRD.md).

## License

MIT © Almog Baku. See [LICENSE](LICENSE).
