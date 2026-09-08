#!/usr/bin/env bash
# Deterministic tests for .claude/hooks/reinject-run-state.sh — what a
# compacted or resumed session gets back about a live /ship-spec run.
# Wired into scripts/fitness/run_all.sh.
#
#   bash .claude/hooks/tests/test-reinject.sh
#
# Sandboxed in a throwaway git repository under $TMPDIR, like the other hook
# tests, so it never reads the real repo's run state.
#
# The case this file exists for: the run state is keyed off the basename fixed
# in Phase 0 and SDD's workspace off the plan's basename. On 2026-09-07 those
# diverged (spec `*-design.md`, plan without the suffix) and for 4.5 hours a
# compaction would have re-injected the state with NO ledger — the exact
# memory loss the hook exists to prevent. Nobody noticed because no
# compaction happened. The hook now falls back to the newest ledger in the
# run worktree, and Phase 0 fixes one basename for both.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
HOOK="$HERE/../reinject-run-state.sh"

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/reinject-test.XXXXXX")
SANDBOX=$(cd "$SANDBOX" && pwd -P)
trap 'rm -rf "$SANDBOX"' EXIT

MAIN="$SANDBOX/main"
mkdir -p "$MAIN"
git -C "$MAIN" init -q
git -C "$MAIN" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
cd "$MAIN" || exit 2

SLUG="2026-01-01-thing-design"
DIR="$MAIN/.superpowers/ship-spec/$SLUG"
STATE="$DIR/state"
mkdir -p "$DIR"

pass=0
fail=0

run() { jq -cn '{hook_event_name:"PostCompact"}' | bash "$HOOK" 2>&1; }

expect_contains() { # label, needle
  local out
  out=$(run)
  if printf '%s' "$out" | grep -qF -- "$2"; then
    pass=$((pass + 1)); echo "ok   $1"
  else
    fail=$((fail + 1)); echo "FAIL $1 → expected '$2' in: ${out:-<silence>}"
  fi
}
expect_lacks() { # label, needle
  local out
  out=$(run)
  if printf '%s' "$out" | grep -qF -- "$2"; then
    fail=$((fail + 1)); echo "FAIL $1 → did not expect '$2' in: $out"
  else
    pass=$((pass + 1)); echo "ok   $1"
  fi
}

echo "# no run"
rm -f "$STATE"
expect_lacks "no state file → silent" "ACTIVE"

echo "# live run, no ledger yet"
printf 'ceiling=dev\nphase=3\nworktree=%s\norchestrator=%s\n' "$MAIN" "$MAIN" >"$STATE"
expect_contains "state is re-injected" "ACTIVE /ship-spec RUN"
expect_lacks    "no ledger → no ledger tail" "ledger tail"

echo "# ledger under the SAME basename as the state"
mkdir -p "$MAIN/.superpowers/sdd/$SLUG"
printf '# SDD ledger\nLEDGER-MARK-SAME\n' >"$MAIN/.superpowers/sdd/$SLUG/progress.md"
expect_contains "exact-path ledger found" "LEDGER-MARK-SAME"

echo "# ledger under a DIFFERENT basename (plan dropped the -design suffix)"
rm -rf "$MAIN/.superpowers/sdd/$SLUG"
mkdir -p "$MAIN/.superpowers/sdd/2026-01-01-thing"
printf '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-thing.md\nLEDGER-MARK-OTHER\n' \
  >"$MAIN/.superpowers/sdd/2026-01-01-thing/progress.md"
expect_contains "diverged basename still re-injects the ledger" "LEDGER-MARK-OTHER"

echo "# terminal states are ignored"
for ph in halted done; do
  printf 'ceiling=dev\nphase=%s\nworktree=%s\norchestrator=%s\n' "$ph" "$MAIN" "$MAIN" >"$STATE"
  expect_lacks "phase=$ph → silent" "ACTIVE"
done

echo ""
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
