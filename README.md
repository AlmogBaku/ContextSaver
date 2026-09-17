# ContextSaver

ContextSaver is a Claude Code function-hooks plugin that watches a session for wasted context and time, shows a one-click card when a waste behaviour repeats, and lets the user steer or stop it with a single click — turning decisions into CLAUDE.md rules, skills, and agent briefs on demand.

**Status: v1 — verified live**

## Running

```sh
./scripts/check.sh   # validate --strict, typecheck, tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .   # run Claude Code with the plugin loaded from this folder
```

`scripts/check.sh` validates the manifest and hooks, type-checks with `tsc` (fetched on demand by `bunx`, pinned), and runs the test suite with `claude plugin test`. Like every Claude Code mod, the plugin has no dependencies and no build step. Function hooks are early access: every command sets `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## How it works

**Ledger.** Every tool call becomes one row — tool, a normalized key, its class, the agent, the turn,
how long it took, how much it put in the context, flags, the files it edited — and every turn records
its tokens, calls, duration and answer length. Nothing is shown and nothing is sent to Claude.

**Judge.** On a cadence (about 30k new tokens and 3 turns) or on demand, one detached `$.model.fork`
reads the session's own transcript plus the ledger as text and answers one narrow question: which
behaviours have already repeated, and what should be done instead. No code rule ever decides that
something is waste; the model does, and it prefers silence.

**Pane.** Each finding becomes a waster in the ContextSaver pane — docked beside the transcript in a
wide fullscreen terminal, inline above the prompt otherwise — with its cost, the evidence behind `i`,
and three verbs.

**Keep / Steer / Kill.** *Keep* silences the behaviour for the session. *Steer* sends the instruction
the user writes. *Kill* sends the fix the judge proposed. Both are prompts to Claude, delivered once
immediately and re-sent with every later prompt for the rest of the session; nothing is ever blocked,
and nothing is sent without a click.

**Rules.** When a decision is worth outliving the session, the pane offers it as a CLAUDE.md rule, a
skill, an agent brief or a permission rule: `Write` writes it, `Try` uses it for this session only,
`Skip` drops it.

## Commands

| Command | What it does |
|---|---|
| `/saver` | Shows or hides the pane. |
| `/saver check` | Runs the judge now, without waiting for the cadence. |
| `/saver steer <text>` | Sends an instruction for the open (or newest) waster — the multi-line way to steer, from the composer. |
| `/saver debug` | Prints the whole session state: rows, patterns, decisions, the judge's runs and cost, usage, savings. |
| `/saver reset` | Clears this session's ledger and decisions; the pattern registry survives. |

## Known behaviour

- **Hot reload starts a new session.** Under `--plugin-dir`, editing a file reloads the plugin and the
  session state (ledger, turns, cards, decisions) starts empty; the pattern registry survives in the
  store, so previous decisions still calibrate the judge.
- **`ms` is wall time.** A row's duration includes any time a permission prompt waited for the user, so
  a long `ms` alone is not machine cost. The judge's prompt says so.
- **No pane on mobile surfaces.** The pane and the band are terminal and desktop surfaces; on a mobile
  surface the plugin keeps its ledger and stays quiet.
- **The judge stays silent in short sessions.** Fewer than about 15 tool calls or 5 turns and it reports
  only behaviours with three or more occurrences. A wrong card costs more than a missed one.
- **The accent is the theme key `suggestion`.** The engine has no `accent` key (see Theme below).
- **Pressing `Steer` asks the surface for the keyboard.** `autoFocus` only lands where a site takes the
  keyboard fresh, and the click that pressed `Steer` left the ring on that Button, so the pane calls
  `$.ui.focus({ requestId, key })` for the field it just opened. The ring is the person's to give: a
  surface that will not move it changes nothing, and the field is still there to be clicked. Nothing
  beneath a test answers `ui.focus`, so the tests cover the pane's half — the field opens and closes.
- **The judge runs on the session's model.** `$.model.fork` has no model field, so a session on Opus
  pays Opus for the audit; `/saver debug` reports what it has spent and the judge throttles itself.

## Development

The build spec — architecture, the module contracts, the judge prompt, the design brief, the UX
walkthrough — is `docs/SPEC.md`; the product spec it implements is `docs/PRD.md`.

All logic is pure functions over one `State` in `hooks/core/`; `hooks/register.ts` is the only file that
touches events and `$`, and every hook returns `next(e)` on any path it does not own. `hooks/ui.tsx` is
pure over the two view models (`BandModel`, `PaneModel`) and never reads `State`.

With `CONTEXTSAVER_DEBUG` set, `/saver demo` fills the pane with three sample wasters from
`hooks/core/demo.ts` — two awaiting a decision, one already steered so the decisions and the rules draw
too — and opens it, so the design can be looked at without waiting for a real finding. Nothing is sent
to Claude and nothing is written; without the flag the command is not there.

## Theme

The pane's one accent is the theme key `suggestion` (rgb(87,105,247), ansi blue) — the engine has no
`accent` key; `suggestion` carries the same value as `permission` and the engine's own
`rate_limit_fill`. It is used on the newest waster's card border, a live waster's `●`, the gauge's
filled cells and the band's `n new`; `ButtonProps` (641-706) carries `dimColor` and `hover` and **no
`color`**, and one unknown prop blanks the whole pane, so the verbs, `Check now` and `Write` take their
tone from the surface — default at rest, inverted under the focus or the pointer. The accent marks the
block the eye must land on rather than the words inside it, and the spec says so (§5.5 item 1). The d.ts enumerates no colour names at all (`TextProps.color` is
"a theme key or a raw color", and the only keys it ever names are `promptBorder`, `inactive` and
`permission`), so there is no documented `warning` or `error` key: the gauge's fill is the accent at
every level rather than changing colour as the context fills.

Every other waster's card is drawn with `borderDimColor`, which is the whole hierarchy of the list: the
eye lands on the accent frame first. The header, the empty state and the footer carry no rules or
frames — a blank row separates blocks, and the surface already frames the pane.

The header, the decided rows and the rules are indented to the cards' content column (`paddingX = 1 +
1 + CARD_PAD`), so every value in the pane — a header label, a card title, a decision, a rule — starts
at one x. The gauge is the spec's 16 cells and gives cells back only when the row cannot hold them. The
glyph set is closed and nothing does double duty: `→` prefixes a card's fix row and labels `kill →`,
`↪` means steered in DECIDED, `›` is the Steer field.

Inline, the drawing is budgeted against the seat the surface granted (`min(site.maxRows,
PANE_INLINE_ROWS)`), never against a constant: the header's rows, then the card's border, title, verbs
and open field, and what is left is the card's content — one row per value and one evidence quote with
`i` open, else the stats and the fix — with the remainder folding the wasters behind it. The verbs and
the field are drawn above the content, so a seat smaller than the drawing costs detail, never a verb.

The pane's layout numbers (the 10-cell gutter, the gauge and sparkline cells, the cells reserved for a
Button at a row's right edge, the rows each block spends, the glyph set, the copy strings) live at the
top of `hooks/ui.tsx` rather
than in `hooks/core/types.ts`: they are private to this drawing and `types.ts` is the shared contract,
which carries no cells. Constants that more than one module reads — the sample and debug caps, the
CLAUDE.md heading, the agent brief's default tools — do live in `types.ts`.

Every row is assembled and measured before it is drawn: a Button at a row's right edge gets its cells
reserved first, and a header row that does not fit drops whole segments rather than cutting a number.
The band is drawn `BAND_RESERVE` cells short of `site.bodyColumns` because the engine draws its own
collapse control `[-]` over the last cells of that row.
