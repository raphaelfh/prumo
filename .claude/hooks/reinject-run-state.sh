#!/usr/bin/env bash
# SessionStart (compact|resume) and PostCompact: re-inject the active
# /ship-spec run state and the ledger tail into the fresh context, so a
# compacted or resumed session trusts the ledger, not its recollection.
# Silent when no run is active — costs nothing on ordinary sessions.
# Design: docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md

set -u

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
INPUT=$(cat)
EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "SessionStart"')

ctx=""
for f in "$ROOT"/.superpowers/sdd/*/state; do
  [ -f "$f" ] || continue
  phase=$(sed -n 's/^phase=//p' "$f" | tail -1)
  [ "$phase" = "done" ] && continue
  dir=$(dirname "$f")
  ctx="${ctx}ACTIVE /ship-spec RUN — ${dir}
$(cat "$f")
"
  if [ -f "$dir/progress.md" ]; then
    ctx="${ctx}--- ledger tail (progress.md, last 40 lines) ---
$(tail -40 "$dir/progress.md")
"
  fi
done

[ -z "$ctx" ] && exit 0

ctx="${ctx}
Trust this state, the ledger and \`git log\` over your own recollection of the run. Re-read the plan before dispatching the next task; do not re-dispatch tasks the ledger marks complete."

jq -n --arg e "$EVENT" --arg c "$ctx" '{hookSpecificOutput:{hookEventName:$e, additionalContext:$c}}'
exit 0
