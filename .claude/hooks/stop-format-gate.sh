#!/usr/bin/env bash
# Stop gate: fast, scoped check that changed Python files are
# ruff-format clean before the agent ends its turn (the recurring
# red-CI class: CI runs `ruff format --check`, local lint did not).
# Only inspects files changed vs HEAD, so conversational turns cost ~0.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$ROOT" || exit 0

# Guard against blocking loops.
INPUT=$(cat)
if printf '%s' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

CHANGED_PY=$( (git diff --name-only HEAD -- '*.py'; git diff --cached --name-only -- '*.py') 2>/dev/null | sort -u | head -50)
[ -z "$CHANGED_PY" ] && exit 0

FAILED=$(cd backend && printf '%s\n' "$CHANGED_PY" | sed 's|^|../|' | xargs -r uv run ruff format --check --force-exclude 2>/dev/null | grep '^Would reformat' || true)
[ -z "$FAILED" ] && exit 0

jq -n --arg files "$FAILED" \
  '{decision:"block", reason:("Changed Python files are not ruff-format clean (CI will fail):\n" + $files + "\nRun: cd backend && uv run ruff format <files>")}'
exit 0
