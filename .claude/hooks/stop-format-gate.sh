#!/usr/bin/env bash
# Stop gate — two scoped checks, so conversational turns cost ~0:
#
# 1. Changed Python files are ruff-format clean before the agent ends its
#    turn (the recurring red-CI class: CI runs `ruff format --check`, local
#    lint did not). Only inspects files changed vs HEAD.
# 2. While a /ship-spec run is in phases 4-7, the turn may not end without
#    a quality-scan.log for the current HEAD in the run workspace — the
#    gate must have been run, not described. Claude Code caps consecutive
#    blocks at 8, so this is self-bounding. `phase=halted` lifts it, which
#    is how a HALT report ends the turn.
#    Design: docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$ROOT" || exit 0

# Guard against blocking loops.
INPUT=$(cat)
if printf '%s' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

block() {
  jq -n --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

# --- 1. ruff format on changed Python files -------------------------------
CHANGED_PY=$( (git diff --name-only HEAD -- '*.py'; git diff --cached --name-only -- '*.py') 2>/dev/null | sort -u | head -50)
if [ -n "$CHANGED_PY" ]; then
  FAILED=$(cd backend && printf '%s\n' "$CHANGED_PY" | sed 's|^|../|' | xargs -r uv run ruff format --check --force-exclude 2>/dev/null | grep '^Would reformat' || true)
  if [ -n "$FAILED" ]; then
    block "Changed Python files are not ruff-format clean (CI will fail):
$FAILED
Run: cd backend && uv run ruff format <files>"
  fi
fi

# --- 2. /ship-spec gate evidence (phases 4-7 only) ------------------------
for f in "$ROOT"/.superpowers/sdd/*/state; do
  [ -f "$f" ] || continue
  phase=$(sed -n 's/^phase=//p' "$f" | tail -1)
  case "$phase" in
    4|5|6|7) ;;
    *) continue ;;
  esac
  dir=$(dirname "$f")
  log="$dir/quality-scan.log"
  head_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
  log_sha=""
  [ -f "$log" ] && log_sha=$(sed -n '1s/^sha=//p' "$log")
  if [ -z "$log_sha" ] || [ "$log_sha" != "$head_sha" ]; then
    block "ship-spec phase $phase: no quality-scan.log for HEAD ${head_sha:-?} in $dir (found: ${log_sha:-none}). Dispatch ship-gate-runner and read its result before ending the turn. To stop with a HALT report instead, set phase=halted in $f."
  fi
done

exit 0
