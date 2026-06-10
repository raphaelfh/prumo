#!/usr/bin/env bash
# PostToolUse formatter: ruff for *.py, eslint --fix for *.ts/*.tsx.
# Closes the documented local-vs-CI divergence (make lint-backend skips
# `ruff format --check`, CI runs it).

set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -z "$FILE" ] || [ ! -f "$FILE" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

case "$FILE" in
  *.py)
    (cd "$ROOT/backend" && uv run ruff check --fix --force-exclude "$FILE" >/dev/null 2>&1;
     uv run --project "$ROOT/backend" ruff format --force-exclude "$FILE" >/dev/null 2>&1) || true
    ;;
  *.ts|*.tsx)
    (cd "$ROOT" && npx eslint --fix --no-warn-ignored "$FILE" >/dev/null 2>&1) || true
    ;;
esac

exit 0
