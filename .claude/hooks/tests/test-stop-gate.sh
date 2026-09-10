#!/usr/bin/env bash
# Deterministic tests for .claude/hooks/stop-format-gate.sh — the /ship-spec
# evidence gate. Wired into scripts/fitness/run_all.sh.
#
#   bash .claude/hooks/tests/test-stop-gate.sh
#
# Runs entirely inside a throwaway git repository (plus a linked worktree of
# it) in $TMPDIR, so it never reads the real repo's run state and stays green
# while a real run is live — the property the guard test lost and deadlocked
# the pipeline with.
#
# The case this file exists for: a run's state lives under the common git dir
# precisely so every worktree can see it. Seeing it is not owning it. Before
# `orchestrator=`, one run in phase 4-7 blocked EVERY session in the repo from
# ending a turn, for up to the 24h staleness window. Found by a peer session
# on 2026-09-07, mid-promotion, through no fault of its own.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
GATE="$HERE/../stop-format-gate.sh"

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/stop-gate-test.XXXXXX")
SANDBOX=$(cd "$SANDBOX" && pwd -P)   # macOS /var -> /private/var
trap 'rm -rf "$SANDBOX"' EXIT

MAIN="$SANDBOX/main"
OTHER="$SANDBOX/other"
mkdir -p "$MAIN"
git -C "$MAIN" init -q
git -C "$MAIN" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
git -C "$MAIN" worktree add -q "$OTHER" -b other 2>/dev/null
cd "$MAIN" || exit 2

HEAD_SHA=$(git -C "$MAIN" rev-parse HEAD)
DIR="$MAIN/.superpowers/ship-spec/__stop_test__"
STATE="$DIR/state"
LOG="$DIR/gate.log"
mkdir -p "$DIR"

pass=0
fail=0

run() { # $1 = cwd to report; stdin unused
  jq -cn --arg c "$1" '{hook_event_name:"Stop", cwd:$c}' | bash "$GATE" 2>&1
}

expect_block() { # label, cwd
  local out
  out=$(run "$2")
  if printf '%s' "$out" | grep -q '"block"'; then
    pass=$((pass + 1)); echo "ok   $1 → block"
  else
    fail=$((fail + 1)); echo "FAIL $1 → expected block, got: ${out:-<silence>}"
  fi
}
expect_pass() { # label, cwd
  local out
  out=$(run "$2")
  if [ -z "$out" ]; then
    pass=$((pass + 1)); echo "ok   $1 → pass"
  else
    fail=$((fail + 1)); echo "FAIL $1 → expected silence, got: $out"
  fi
}

echo "# no run"
rm -f "$STATE"
expect_pass "no state file" "$MAIN"

echo "# harden: the fast local gate must have run, on this HEAD, and finished"
printf 'ceiling=dev\nphase=harden\nworktree=%s\norchestrator=%s\n' "$MAIN" "$MAIN" >"$STATE"
rm -f "$LOG"
expect_block "harden, no gate log" "$MAIN"

printf 'sha=%s\n' "deadbeef" >"$LOG"
expect_block "gate log for the wrong sha" "$MAIN"

# A seat cut off by its turn cap leaves a correct first line and no terminal
# marker; that satisfied the sha-only check twice on 2026-09-07.
printf 'sha=%s\n> pre-push: ok\n' "$HEAD_SHA" >"$LOG"
expect_block "truncated log: no GATE_EXIT line" "$MAIN"

printf 'sha=%s\n> pre-push\nGATE_EXIT=1\n' "$HEAD_SHA" >"$LOG"
expect_block "red gate: GATE_EXIT=1" "$MAIN"

printf 'sha=%s\n> pre-push\nGATE_EXIT=0\n' "$HEAD_SHA" >"$LOG"
expect_pass "complete, clean gate log matching HEAD" "$MAIN"

# The gate's own output is data, not markers: only the structured first and
# last lines are read, so a test that prints the word FAILED is not a red gate.
printf 'sha=%s\nERROR:  permission denied for table x\nFAILED to connect (retrying)\nGATE_EXIT=0\n' "$HEAD_SHA" >"$LOG"
expect_pass "ERROR/FAILED words in gate output are not markers" "$MAIN"

echo "# ship: CI is the arbiter, and PENDING never blocks"
printf 'ceiling=dev\nphase=ship\nworktree=%s\norchestrator=%s\n' "$MAIN" "$MAIN" >"$STATE"
expect_pass "ship with no CI recorded yet (pending) does not block" "$MAIN"

printf 'ceiling=dev\nphase=ship\nworktree=%s\norchestrator=%s\nci=PENDING@%s\n' "$MAIN" "$MAIN" "$HEAD_SHA" >"$STATE"
expect_pass "ship with CI explicitly PENDING does not block" "$MAIN"

printf 'ceiling=dev\nphase=ship\nworktree=%s\norchestrator=%s\nci=RED@%s\n' "$MAIN" "$MAIN" "$HEAD_SHA" >"$STATE"
expect_pass "ship with CI RED does not block the TURN (the run must report it)" "$MAIN"

printf 'ceiling=dev\nphase=ship\nworktree=%s\norchestrator=%s\nci=GREEN@%s\n' "$MAIN" "$MAIN" "$HEAD_SHA" >"$STATE"
expect_pass "ship with a green matching HEAD" "$MAIN"

# The lie this hook exists to catch: a green recorded for a commit that is no
# longer HEAD. Same class as hand-editing a gate log's sha= line.
printf 'ceiling=dev\nphase=ship\nworktree=%s\norchestrator=%s\nci=GREEN@deadbeef\n' "$MAIN" "$MAIN" >"$STATE"
expect_block "a recorded green for a STALE sha blocks" "$MAIN"

echo "# promote: absence of evidence blocks (no gh in the sandbox -> unknown)"
printf 'ceiling=prod\nphase=promote\nworktree=%s\norchestrator=%s\n' "$MAIN" "$MAIN" >"$STATE"
expect_block "promote without a live green blocks" "$MAIN"

echo "# verify is gated for staleness only"
printf 'ceiling=prod\nphase=verify\nworktree=%s\norchestrator=%s\nci=GREEN@%s\n' "$MAIN" "$MAIN" "$HEAD_SHA" >"$STATE"
expect_pass "verify with a green matching HEAD" "$MAIN"

echo "# an uninvolved session in the SAME repo is not gated"
printf 'ceiling=dev\nphase=harden\nworktree=%s\norchestrator=%s\n' "$MAIN" "$MAIN" >"$STATE"
rm -f "$LOG"
expect_block "owner session still blocked without a log" "$MAIN"
expect_pass  "peer worktree of the same repo" "$OTHER"

echo "# phases outside the window, and terminal states"
# The numeric phases are v2 vocabulary and must no longer be recognised — a
# stale state from an old run cannot gate a v3 session.
for ph in frame plan build halted done 0 3 4 5 6 7 8; do
  printf 'ceiling=dev\nphase=%s\nworktree=%s\norchestrator=%s\n' "$ph" "$MAIN" "$MAIN" >"$STATE"
  expect_pass "phase=$ph is not gated" "$MAIN"
done

echo "# loop guard"
printf 'ceiling=dev\nphase=harden\nworktree=%s\norchestrator=%s\n' "$MAIN" "$MAIN" >"$STATE"
out=$(jq -cn --arg c "$MAIN" '{hook_event_name:"Stop", cwd:$c, stop_hook_active:true}' | bash "$GATE" 2>&1)
if [ -z "$out" ]; then
  pass=$((pass + 1)); echo "ok   stop_hook_active → pass"
else
  fail=$((fail + 1)); echo "FAIL stop_hook_active → expected silence, got: $out"
fi

echo "# legacy state with no orchestrator= line"
printf 'ceiling=dev\nphase=harden\nworktree=%s\n' "$MAIN" >"$STATE"
expect_block "legacy state gates the main checkout" "$MAIN"
expect_pass  "legacy state does not gate a peer worktree" "$OTHER"

echo ""
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
