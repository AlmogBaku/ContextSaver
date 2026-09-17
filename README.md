# ContextSaver

ContextSaver is a Claude Code function-hooks plugin that watches a session for wasted context and time, shows a one-click card when a waste behaviour repeats, and lets the user steer or stop it with a single click — turning decisions into CLAUDE.md rules, skills, and agent briefs on demand.

**Status: scaffold**

## Running

```sh
./scripts/check.sh   # validate --strict, typecheck, tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .   # run Claude Code with the plugin loaded from this folder
```

`scripts/check.sh` validates the manifest and hooks, type-checks with `tsc` (fetched on demand by `bunx`, pinned), and runs the test suite with `claude plugin test`. Like every Claude Code mod, the plugin has no dependencies and no build step. Function hooks are early access: every command sets `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Development

The build spec (architecture, contracts, the judge prompt, the UX walkthrough) will live in `docs/` once v1 lands. Until then it is tracked outside the repo.
