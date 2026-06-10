#!/usr/bin/env bash
# PreToolUse guard for Bash commands. Catches destructive operations with
# incident history, including when wrapped in `bash -c` / `sh -c`.
# Output contract: JSON with hookSpecificOutput.permissionDecision.

set -u

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

# Normalize shell wrappers so `bash -c "make reset-db"` is still matched.
NORM=$(printf '%s' "$CMD" | sed -E 's/(ba|z|da)?sh[[:space:]]+-l?c[[:space:]]+//g')

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
ask() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
  exit 0
}

case "$NORM" in
  *"git push"*fabianofilho*|*"git push fabianofilho"*)
    deny "fabianofilho is the read-only upstream remote. Push to origin instead." ;;
esac

if printf '%s' "$NORM" | grep -qE 'railway[[:space:]]+up' && \
   printf '%s' "$NORM" | grep -q -- '--path-as-root'; then
  deny "railway up --path-as-root is broken (railway.toml gotcha). Run plain 'railway up' from the repo root."
fi

case "$NORM" in
  *"make reset-db"*|*"supabase db reset"*)
    ask "DESTRUCTIVE: wipes the local database. Prefer 'make db-fresh' (migrate + seed). After a bare reset, E2E needs 'make db-seed'." ;;
  *"make db-fresh"*)
    ask "Wipes and re-seeds the local database. Confirm this is intended." ;;
  *"supabase db push"*)
    ask "Applies Supabase auth/storage migrations to the REMOTE project. Confirm target." ;;
  *"git push --force"*|*"git push -f "*|*"git push -f")
    ask "Force push rewrites remote history. Confirm." ;;
esac

exit 0
