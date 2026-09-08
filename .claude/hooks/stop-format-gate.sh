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

# The checkout this session is actually sitting in. `cwd` in the hook input
# follows the session into a worktree; CLAUDE_PROJECT_DIR stays at the launch
# directory, so it is the fallback, not the first choice.
SESSION_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)

# --- 1. ruff format on changed Python files (current checkout) --------------
CWD_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -n "$SESSION_CWD" ] && [ -d "$SESSION_CWD" ] && CWD_ROOT="$SESSION_CWD"
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

  # Gate ONLY the session driving the run. The state deliberately lives under
  # the common git dir so every worktree can see it, and an earlier version
  # confused seeing it with owning it: one run in phase 4-7 stopped every
  # session in the repository from ending a turn, for up to the 24h staleness
  # window. A peer session hit this on 2026-09-07 while promoting unrelated
  # PRs. `orchestrator=` is the checkout /ship-spec was invoked from; when a
  # state predates it, fall back to the run's own worktree or the main
  # checkout, so an uninvolved worktree is never gated.
  owner=$(trimmed orchestrator "$f")
  if [ -n "$owner" ]; then
    [ "$CWD_ROOT" = "$owner" ] || continue
  else
    case "$CWD_ROOT" in "$wt"|"$ROOT") ;; *) continue ;; esac
  fi
  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")
  log="$dir/quality-scan.log"
  log_sha=""
  [ -f "$log" ] && log_sha=$(sed -n '1s/^sha=//p' "$log" | tr -d '[:space:]')
  if [ -z "$log_sha" ] || [ "$log_sha" != "$head_sha" ]; then
    block "ship-spec phase $phase: no quality-scan.log for HEAD ${head_sha:-?} of $wt in $dir (found: ${log_sha:-none}). Run \`make quality-scan\` into $log with sha=<HEAD> as its first line and read its Summary before ending the turn. To stop with a HALT report instead, set phase=halted in $f."
  # The log must be COMPLETE and CLEAN, not merely addressed to HEAD. A gate
  # runner cut off by its turn cap leaves a correct first line and no
  # Summary; `make quality-scan` reports a lane it could not run as SKIP
  # among the OKs and still exits 0. Both passed the sha-only check twice on
  # 2026-09-07. Only verify_all.sh's own structured lines count as markers —
  # pytest's negative tests print Postgres ERRORs by design.
  elif ! grep -q '^QUALITY_SCAN_EXIT=0$' "$log"; then
    block "ship-spec phase $phase: $log has no QUALITY_SCAN_EXIT=0 line — the gate did not finish, or went red. Re-run \`make quality-scan\` on HEAD $head_sha and read its Summary. To stop with a HALT report instead, set phase=halted in $f."
  elif bad=$(grep -E '^(  [a-z:_-]+: SKIP \(|=== .* exit=[1-9])' "$log") && [ -z "$(trimmed skip-ack "$f")" ]; then
    block "ship-spec phase $phase: $log has a SKIPPED or red stage:
$(printf '%s\n' "$bad" | head -5)
A skipped lane is not a green lane. Make it runnable and re-run the gate on HEAD $head_sha, or — only for a lane this machine cannot run at all — write skip-ack=<lane>:<reason> in $f and name it in the verdict."
  fi
done

exit 0
