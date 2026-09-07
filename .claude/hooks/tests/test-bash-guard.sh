#!/usr/bin/env bash
# Deterministic tests for .claude/hooks/bash-guard.sh: the /ship-spec ceiling
# guard and the incident-history rules. No network; uses the local
# origin/dev ref for the "fresh preflight" case.
#
#   bash .claude/hooks/tests/test-bash-guard.sh
#
# Writes a throwaway run state under .superpowers/sdd/__guard_test__/ (the
# gitignored SDD workspace) and removes it on exit.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
GUARD="$HERE/../bash-guard.sh"
ROOT=$(git rev-parse --show-toplevel)
export CLAUDE_PROJECT_DIR="$ROOT"
STATE_DIR="$ROOT/.superpowers/sdd/__guard_test__"
STATE="$STATE_DIR/state"

# Precondition: no other active run state, or the multi-run rule fires.
for f in "$ROOT"/.superpowers/sdd/*/state; do
  [ -f "$f" ] || continue
  [ "$f" = "$STATE" ] && continue
  if [ "$(sed -n 's/^phase=//p' "$f" | tail -1)" != "done" ]; then
    echo "PRECONDITION FAILED: another active run state exists: $f" >&2
    exit 2
  fi
done
mkdir -p "$STATE_DIR"
trap 'rm -rf "$STATE_DIR"' EXIT

pass=0
fail=0

decision() { # $1 = command  → prints allow | ask | deny
  local out
  out=$(jq -cn --arg c "$1" '{tool_input:{command:$c}}' | bash "$GUARD")
  if [ -z "$out" ]; then
    echo allow
  else
    printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision'
  fi
}
expect() { # $1 = label, $2 = expected, $3 = command
  local got
  got=$(decision "$3")
  if [ "$got" = "$2" ]; then
    pass=$((pass + 1)); echo "ok   $1 → $got"
  else
    fail=$((fail + 1)); echo "FAIL $1 → got '$got', expected '$2'   [$3]"
  fi
}
set_state() { printf '%s\n' "$@" >"$STATE"; }
clear_state() { rm -f "$STATE"; }

DEV_SHA=$(git -C "$ROOT" rev-parse origin/dev)
PROMOTE='gh pr create --base main --head dev --title "Promote dev to main"'

echo "# incident-history rules"
expect "reset-db asks"                 ask   'make reset-db'
expect "railway domain asks"           ask   'railway domain'
expect "push dev:main denied"          deny  'git push origin dev:main'
expect "push main denied"              deny  'git push -u origin main'
expect "push feature branch allowed"   allow 'git push origin claude/feature-main-fix'
expect "squash merge to dev allowed"   allow 'gh pr merge 123 --auto --squash'
expect "pr create to dev allowed"      allow 'gh pr create --base dev --title x'

echo "# ceiling: no active run → the human touch"
clear_state
expect "no run: promotion asks"        ask   "$PROMOTE"
expect "no run: railway up asks"       ask   'railway up'

echo "# ceiling: dev"
set_state ceiling=dev phase=5
expect "dev: promotion denied"         deny  "$PROMOTE"
expect "dev: merge --merge denied"     deny  'gh pr merge 456 --auto --merge'
expect "dev: railway up denied"        deny  'railway up'
expect "dev: squash to dev still ok"   allow 'gh pr merge 123 --auto --squash'
expect "dev: wrapped in sh -c denied"  deny  "sh -c '$PROMOTE'"

echo "# ceiling: prod — evidence-gated"
set_state ceiling=prod phase=6
expect "prod, no preflight: denied"    deny  "$PROMOTE"
set_state ceiling=prod phase=6 "preflight=RED@$DEV_SHA"
expect "prod, RED preflight: denied"   deny  "$PROMOTE"
set_state ceiling=prod phase=6 preflight=GREEN@0000000000000000000000000000000000000000
expect "prod, stale preflight: denied" deny  "$PROMOTE"
set_state ceiling=prod phase=6 "preflight=GREEN@$DEV_SHA"
got=$(decision "$PROMOTE")
if [ "$got" = allow ] || [ "$got" = ask ]; then
  pass=$((pass + 1)); echo "ok   prod, fresh GREEN → $got (ask only when the promoted range carries destructive DDL)"
else
  fail=$((fail + 1)); echo "FAIL prod, fresh GREEN → got '$got'"
fi
expect "prod: railway redeploy allowed (rollback path)" allow 'railway redeploy'

echo "# a finished run does not count"
set_state ceiling=prod phase=done "preflight=GREEN@$DEV_SHA"
expect "done run: promotion asks"      ask   "$PROMOTE"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
