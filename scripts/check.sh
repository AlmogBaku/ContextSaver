#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
claude plugin validate . --strict
claude plugin validate ./.claude-plugin/plugin.json --strict
bunx --package typescript@5.9.3 tsc --noEmit -p .
claude plugin test .
