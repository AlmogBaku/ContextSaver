# ContextSaver

ContextSaver is a Claude Code function-hooks plugin that watches a session for wasted context and time, shows a one-click card when a waste behaviour repeats, and lets the user steer or stop it with a single click — turning decisions into CLAUDE.md rules, skills, and agent briefs on demand.

**Status: scaffold**

## Running

```sh
bun install          # dev tooling only (typescript); the plugin itself has no dependencies
bun run check        # validate --strict, typecheck, tests
bun run dev          # start Claude Code with the plugin loaded from this folder
```

`bun run check` is `scripts/check.sh`: it validates the manifest and hooks, type-checks with `tsc`, and runs the test suite with `claude plugin test`. Function hooks are early access: every command sets `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Development

The build spec (architecture, contracts, the judge prompt, the UX walkthrough) will live in `docs/` once v1 lands. Until then it is tracked outside the repo.
