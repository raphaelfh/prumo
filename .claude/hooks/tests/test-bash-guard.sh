#!/usr/bin/env bash
# Deterministic tests for .claude/hooks/bash-guard.sh: the /ship-spec ceiling
# guard and the incident-history rules. No network. Wired into
# scripts/fitness/run_all.sh so the guard cannot regress silently.
#
#   bash .claude/hooks/tests/test-bash-guard.sh
#
# Writes a throwaway run state under <main checkout>/.superpowers/ship-spec/
# __guard_test__/ (gitignored) and removes it on exit. If origin/dev does not
# resolve (shallow CI checkout), it is created pointing at HEAD.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
GUARD="$HERE/../bash-guard.sh"
COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
ROOT=$(dirname "$COMMON")
STATE_DIR="$ROOT/.superpowers/ship-spec/__guard_test__"
STATE="$STATE_DIR/state"

git -C "$ROOT" rev-parse -q --verify origin/dev >/dev/null 2>&1 \
  || git -C "$ROOT" update-ref refs/remotes/origin/dev HEAD

# Precondition: no other live run state, or the multi-run rule fires.
for f in "$ROOT"/.superpowers/ship-spec/*/state; do
  [ -f "$f" ] || continue
  [ "$f" = "$STATE" ] && continue
  case "$(sed -n 's/^phase=//p' "$f" | tail -1 | tr -d '[:space:]')" in
    done|halted) ;;
    *) echo "PRECONDITION FAILED: another live run state exists: $f" >&2; exit 2 ;;
  esac
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
expect "reset-db asks"                     ask   'make reset-db'
expect "railway domain asks"               ask   'railway domain'
expect "push dev:main denied"              deny  'git push origin dev:main'
expect "push main denied"                  deny  'git push -u origin main'
expect "push HEAD:main denied"             deny  'git push origin HEAD:main'
expect "push quoted main denied"           deny  'git push origin "main"'
expect "push main; denied"                 deny  'git push origin main;'
expect "push main&&echo denied"            deny  'git push origin main&&echo'
expect "bash -c push main denied"          deny  'bash -c "git push origin main"'
expect "force push to main is deny"        deny  'git push --force origin main'
expect "git -C path push main denied"      deny  'git -C /tmp/x push origin dev:main'
expect "force push elsewhere asks"         ask   'git push -f origin claude/x'
expect "force-with-lease asks"             ask   'git push --force-with-lease origin claude/x'
expect "rebase merge denied"               deny  'gh pr merge 12 --rebase'
expect "push feature branch allowed"       allow 'git push origin claude/feature-main-fix'
expect "squash merge to dev allowed"       allow 'gh pr merge 123 --auto --squash'
expect "pr create to dev allowed"          allow 'gh pr create --base dev --title x'

echo "# command chains: only the matching segment is judged"
expect "fetch main && push feature ok"     allow 'git fetch origin main && git push origin claude/x'
expect "rebase main && push feature ok"    allow 'git rebase main && git push origin claude/x'
expect "push feature && checkout main ok"  allow 'git push origin claude/x && git checkout main'
expect "commit -m main && push ok"         allow 'git commit -m "fix main flow" && git push origin claude/x'
expect "PR body mentioning --base main ok" allow 'gh pr create --base dev --title t --body "--base main mentioned"'

echo "# ceiling: no active run → the human touch"
clear_state
expect "no run: promotion asks"            ask   "$PROMOTE"
expect "no run: promotion; asks"           ask   'gh pr create --base main;'
expect "no run: railway up asks"           ask   'railway up'

echo "# ceiling: dev"
set_state ceiling=dev phase=5
expect "dev: promotion denied"             deny  "$PROMOTE"
expect "dev: sh -c promotion denied"       deny  "sh -c 'gh pr create --head dev --base main'"
expect "dev: quoted base denied"           deny  'gh pr create --base "main" --head dev'
expect "dev: -Bmain denied"                deny  'gh pr create -Bmain --head dev'
expect "dev: merge --merge denied"         deny  'gh pr merge 456 --auto --merge'
expect "dev: merge -m denied"              deny  'gh pr merge 456 -m'
expect "dev: sh -c merge --merge denied"   deny  'sh -c "gh pr merge 12 --auto --merge"'
expect "dev: env-prefixed gh denied"       deny  'GH_TOKEN=x gh pr create --base main --head dev'
expect "dev: absolute gh path denied"      deny  '/opt/homebrew/bin/gh pr merge 3 --merge'
expect "dev: railway up denied"            deny  'railway up'
expect "dev: squash to dev still ok"       allow 'gh pr merge 123 --auto --squash'

echo "# ceiling: prod — evidence-gated"
set_state ceiling=prod phase=6
expect "prod, no preflight: denied"        deny  "$PROMOTE"
set_state ceiling=prod phase=6 "preflight=RED@$DEV_SHA"
expect "prod, RED preflight: denied"       deny  "$PROMOTE"
set_state ceiling=prod phase=6 preflight=GREEN@0000000000000000000000000000000000000000
expect "prod, stale preflight: denied"     deny  "$PROMOTE"
set_state ceiling=prod phase=6 "preflight=GREEN@$DEV_SHA"
got=$(decision "$PROMOTE")
if [ "$got" = allow ] || [ "$got" = ask ]; then
  pass=$((pass + 1)); echo "ok   prod, fresh GREEN → $got (ask only when an upgrade() in the promoted range is destructive)"
else
  fail=$((fail + 1)); echo "FAIL prod, fresh GREEN → got '$got'"
fi
expect "prod: railway redeploy allowed (rollback path)" allow 'railway redeploy'

echo "# terminal and malformed states do not count"
set_state ceiling=prod phase=done "preflight=GREEN@$DEV_SHA"
expect "done run: promotion asks"          ask   "$PROMOTE"
set_state ceiling=prod "phase=done " "preflight=GREEN@$DEV_SHA"
expect "done with trailing space: asks"    ask   "$PROMOTE"
set_state ceiling=dev phase=halted
expect "halted run: promotion asks"        ask   "$PROMOTE"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
