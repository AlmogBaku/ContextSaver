#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
claude plugin validate . --strict
bun x tsc --noEmit -p .
claude plugin test .
