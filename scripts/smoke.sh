#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CONTEXTSAVER_DEBUG=1 CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p --plugin-dir . --output-format stream-json --verbose \
  --max-turns 6 --allowedTools Bash "Run the shell command 'echo hi' three separate times using Bash, one call at a time, then say done." \
  | grep -c 'ContextSaver row'
