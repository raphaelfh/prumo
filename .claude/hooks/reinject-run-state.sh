#!/usr/bin/env bash
# SessionStart (compact|resume) and PostCompact: re-inject the active
# /ship-spec run state and the ledger tail into the fresh context, so a
# compacted or resumed session trusts the ledger, not its recollection.
# Silent when no run is live — costs nothing on ordinary sessions.
# Design: docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md

set -u

INPUT=$(cat)
EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "SessionStart"')

# State lives under the MAIN checkout root (common git dir), so the main
# checkout and every worktree see the same run. The SDD ledger lives in the
# run worktree's own .superpowers/sdd/<plan>/ while SDD keeps it.
COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [ -n "$COMMON" ]; then ROOT=$(dirname "$COMMON"); else ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"; fi
trimmed() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d '[:space:]'; }

ctx=""
for f in "$ROOT"/.superpowers/ship-spec/*/state; do
  [ -f "$f" ] || continue
  phase=$(trimmed phase "$f")
  case "$phase" in done|halted) continue ;; esac
  [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ] && continue
  dir=$(dirname "$f")
  slug=$(basename "$dir")
  wt=$(trimmed worktree "$f")
  [ -d "$wt" ] || wt="$ROOT"
  ctx="${ctx}ACTIVE /ship-spec RUN — ${dir}
$(cat "$f")
"
  ledger=""
  for cand in "$wt/.superpowers/sdd/$slug/progress.md" "$ROOT/.superpowers/sdd/$slug/progress.md"; do
    [ -f "$cand" ] && { ledger="$cand"; break; }
  done
  # SDD keys its workspace off the PLAN basename; the state is keyed off the
  # basename fixed in Phase 0. When they diverge (a `*-design.md` spec whose
  # plan drops the suffix) the exact path misses, and a compacted session
  # would resume a run with no memory — this hook's state for 4.5 h on
  # 2026-09-07. Fall back to the newest ledger in the run worktree.
  if [ -z "$ledger" ]; then
    ledger=$(ls -t "$wt"/.superpowers/sdd/*/progress.md 2>/dev/null | head -1)
  fi
  if [ -n "$ledger" ] && [ -f "$ledger" ]; then
    ctx="${ctx}--- ledger tail ($ledger, last 40 lines) ---
$(tail -40 "$ledger")
"
  fi
done

[ -z "$ctx" ] && exit 0

ctx="${ctx}
Trust this state, the ledger and \`git log\` over your own recollection of the run. Re-read the plan before dispatching the next task; do not re-dispatch tasks the ledger marks complete."

jq -n --arg e "$EVENT" --arg c "$ctx" '{hookSpecificOutput:{hookEventName:$e, additionalContext:$c}}'
exit 0
