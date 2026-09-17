# ContextSaver

ContextSaver is a Claude Code function-hooks plugin that watches a session for wasted context and time, shows a one-click card when a waste behaviour repeats, and lets the user steer or stop it with a single click — turning decisions into CLAUDE.md rules, skills, and agent briefs on demand.

**Status: scaffold**

## Running

```sh
# Validate the plugin manifest and hooks
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate . --strict

# Type-check without emitting
bun x tsc --noEmit -p .

# Run the test suite
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
```

All three commands are combined in `scripts/check.sh`:

```sh
./scripts/check.sh
```

## Development

The full build spec is at:
`/home/anakin/.claude/plans/lets-plan-this-mods-playground-prd-md-zany-lighthouse.md`

The product spec (PRD) is at:
`/home/anakin/projects/mods-playground/PRD.md`
