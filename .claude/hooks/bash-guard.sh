#!/usr/bin/env bash
# PreToolUse guard for Bash commands. Catches destructive operations with
# incident history, including when wrapped in `bash -c` / `sh -c`.
# Patterns match only at command position (line start or after ; & | $( )
# so prose inside commit messages / PR bodies does not false-positive.
# Output contract: JSON with hookSpecificOutput.permissionDecision.

set -u

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

# Normalize shell wrappers so `bash -c "make reset-db"` is still matched.
NORM=$(printf '%s' "$CMD" | sed -E 's/(ba|z|da)?sh[[:space:]]+-l?c[[:space:]]+//g')

matches_cmd() {
  printf '%s\n' "$NORM" | grep -Eq "(^|[;&|]|\\\$\()[[:space:]]*[\"']?$1"
}

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
ask() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
  exit 0
}

if matches_cmd 'git +push +([^;&|]*[[:space:]])?fabianofilho'; then
  deny "fabianofilho is the read-only upstream remote. Push to origin instead."
fi

if matches_cmd 'railway +up[^;&|]*--path-as-root'; then
  deny "railway up --path-as-root is broken (railway.toml gotcha). Run plain 'railway up' from the repo root."
fi

if matches_cmd 'make +(reset-db|db-fresh)' || matches_cmd 'supabase +db +reset'; then
  ask "DESTRUCTIVE: wipes the local database. Prefer 'make db-fresh' (migrate + seed). After a bare reset, E2E needs 'make db-seed'."
fi

if matches_cmd 'supabase +db +push'; then
  ask "Applies Supabase auth/storage migrations to the REMOTE project (unless --local). Confirm target."
fi

if matches_cmd 'git +push +[^;&|]*(--force|-f([[:space:]]|$))'; then
  ask "Force push rewrites remote history. Confirm."
fi

exit 0
