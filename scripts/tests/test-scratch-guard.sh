#!/usr/bin/env bash
# Each sandboxed shell test must abort, untouched, when it cannot create its
# scratch repo. Before the guard, an empty $SANDBOX from a failed `mktemp -d`
# made every `git -C "$SANDBOX" ...` resolve to the CALLER's checkout: an
# empty `init` commit by `t <t@t>` landed on the real branch, `main` moved,
# and the hook tests' `trap 'rm -rf "$SANDBOX"'` pointed at the checkout.
#
# Each script runs with its cwd in a throwaway "victim" repo, so even an
# unguarded script can only damage the victim. The victim must survive with
# HEAD, branch, refs, worktrees and status unchanged.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pass=0; fail=0
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1: want '$3' got '$2'"; fi; }

HOLD=$(mktemp -d "${TMPDIR:-/tmp}/scratch-guard.XXXXXX") || exit 1
[ -n "$HOLD" ] && [ -d "$HOLD" ] || { echo "mktemp failed" >&2; exit 1; }
HOLD=$(cd "$HOLD" && pwd -P)
trap 'rm -rf "$HOLD"' EXIT

snapshot() { # $1 = repo → everything a leak would change
  git -C "$1" log -1 --format='%s|%an' 2>&1
  git -C "$1" branch --show-current 2>&1
  git -C "$1" for-each-ref --format='%(refname) %(objectname)' 2>&1
  git -C "$1" worktree list --porcelain 2>&1
  git -C "$1" status --porcelain --untracked-files=all 2>&1
}

for script in \
  scripts/tests/test-ship.sh \
  .claude/hooks/tests/test-bash-guard.sh \
  .claude/hooks/tests/test-stop-gate.sh \
  .claude/hooks/tests/test-reinject.sh; do
  name=$(basename "$script")
  VICTIM="$HOLD/$name/victim"
  mkdir -p "$VICTIM"
  git -C "$VICTIM" init -q -b work
  git -C "$VICTIM" -c user.email=v@v -c user.name=v commit -q --allow-empty -m victim-head
  before=$(snapshot "$VICTIM")
  (cd "$VICTIM" && TMPDIR=/nonexistent bash "$ROOT/$script") >/dev/null 2>&1
  rc=$?
  [ "$rc" -ne 0 ] && rc=nonzero
  ok "$name: exits non-zero without a scratch dir" "$rc" "nonzero"
  ok "$name: caller checkout survives" "$([ -d "$VICTIM/.git" ] && echo yes || echo no)" "yes"
  ok "$name: caller checkout untouched" "$(snapshot "$VICTIM")" "$before"
done

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
