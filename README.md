# ContextSaver

ContextSaver is a Claude Code function-hooks plugin that watches a session for wasted context and time, shows a one-click card when a waste behaviour repeats, and lets the user steer or stop it with a single click — turning decisions into CLAUDE.md rules, skills, and agent briefs on demand.

**Status: v1 wired; verification pending**

## Running

```sh
./scripts/check.sh   # validate --strict, typecheck, tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .   # run Claude Code with the plugin loaded from this folder
```

`scripts/check.sh` validates the manifest and hooks, type-checks with `tsc` (fetched on demand by `bunx`, pinned), and runs the test suite with `claude plugin test`. Like every Claude Code mod, the plugin has no dependencies and no build step. Function hooks are early access: every command sets `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Development

The build spec (architecture, contracts, the judge prompt, the UX walkthrough) will live in `docs/` once v1 lands. Until then it is tracked outside the repo.

All logic is pure functions over one `State` in `hooks/core/`; `hooks/register.ts` is the only file that
touches events and `$`, and every hook returns `next(e)` on any path it does not own. The interactive
walkthrough (the live pane, the flagship steer and kill, the probes) has not been run yet: that is what
"verification pending" means.

## Theme

The pane's one accent is the theme key `suggestion` (rgb(87,105,247), ansi blue) — the engine has no
`accent` key; `suggestion` carries the same value as `permission` and the engine's own
`rate_limit_fill`. It is used on a live waster's `●`, the gauge's filled cells and the band's
`n new`; `Button` has no `color` prop, so the verbs take their colour from the surface's
focus/pointer inversion.

The pane's layout numbers (the 10-cell gutter, the gauge and sparkline cells, the glyph set, the
three copy strings) live at the top of `hooks/ui.tsx` rather than in `hooks/core/types.ts`: they are
private to this drawing and `types.ts` is the shared contract, which carries no cells. Constants that
more than one module reads — the sample and debug caps, the CLAUDE.md heading, the agent brief's
default tools — do live in `types.ts`.
