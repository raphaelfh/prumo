#!/usr/bin/env bash
# Stop gate — two scoped checks, so conversational turns cost ~0:
#
# 1. Changed Python files are ruff-format clean before the agent ends its
#    turn (the recurring red-CI class: CI runs `ruff format --check`, local
#    lint did not). Only inspects files changed vs HEAD in the current checkout.
# 2. While a /ship-spec run is in phases 4-7, the turn may not end without
#    a quality-scan.log for the run worktree's current HEAD — the gate must
#    have been run, not described. Claude Code caps consecutive blocks at 8,
#    so this is self-bounding. `phase=halted` lifts it (how a HALT report
#    ends the turn); a state untouched for 24h is a crashed run and is ignored.
#    Design: docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md

set -u

# Guard against blocking loops.
INPUT=$(cat)
if printf '%s' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

block() {
  jq -n --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

# --- 1. ruff format on changed Python files (current checkout) --------------
CWD_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$CWD_ROOT" || exit 0
CHANGED_PY=$( (git diff --name-only HEAD -- '*.py'; git diff --cached --name-only -- '*.py') 2>/dev/null | sort -u | head -50)
if [ -n "$CHANGED_PY" ]; then
  FAILED=$(cd backend && printf '%s\n' "$CHANGED_PY" | sed 's|^|../|' | xargs -r uv run ruff format --check --force-exclude 2>/dev/null | grep '^Would reformat' || true)
  if [ -n "$FAILED" ]; then
    block "Changed Python files are not ruff-format clean (CI will fail):
$FAILED
Run: cd backend && uv run ruff format <files>"
  fi
fi

# --- 2. /ship-spec gate evidence (phases 4-7 only) ---------------------------
# State lives under the MAIN checkout root (common git dir), so the main
# checkout and every worktree see the same run.
COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [ -n "$COMMON" ]; then ROOT=$(dirname "$COMMON"); else ROOT="$CWD_ROOT"; fi
trimmed() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d '[:space:]'; }

for f in "$ROOT"/.superpowers/ship-spec/*/state; do
  [ -f "$f" ] || continue
  phase=$(trimmed phase "$f")
  case "$phase" in
    4|5|6|7) ;;
    *) continue ;;
  esac
  [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ] && continue
  dir=$(dirname "$f")
  wt=$(trimmed worktree "$f")
  [ -d "$wt" ] || wt="$ROOT"
  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")
  log="$dir/quality-scan.log"
  log_sha=""
  [ -f "$log" ] && log_sha=$(sed -n '1s/^sha=//p' "$log" | tr -d '[:space:]')
  if [ -z "$log_sha" ] || [ "$log_sha" != "$head_sha" ]; then
    block "ship-spec phase $phase: no quality-scan.log for HEAD ${head_sha:-?} of $wt in $dir (found: ${log_sha:-none}). Dispatch ship-gate-runner and read its result before ending the turn. To stop with a HALT report instead, set phase=halted in $f."
  fi
done

exit 0
