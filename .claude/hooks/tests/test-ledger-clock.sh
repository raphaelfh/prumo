#!/usr/bin/env bash
# Deterministic tests for .claude/hooks/ledger-clock.sh — the PostToolUse
# hook that appends a wall-clock line after every edit of a /ship-spec SDD
# ledger. Wired into scripts/fitness/run_all.sh.
#
#   bash .claude/hooks/tests/test-ledger-clock.sh
#
# Why it exists: the orchestrator writes its own timestamps into the ledger
# and was observed stamping entries up to 43 minutes AHEAD of the wall clock
# (2026-09-07), leaving the record non-chronological. The hook does not stop
# that; it puts the true time beside every claim so a reader can tell.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
HOOK="$HERE/../ledger-clock.sh"

SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/ledger-clock-test.XXXXXX")
SANDBOX=$(cd "$SANDBOX" && pwd -P)
trap 'rm -rf "$SANDBOX"' EXIT

pass=0
fail=0
CLOCK_RE='^_clock: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z_$'

run() { jq -cn --arg p "$1" '{hook_event_name:"PostToolUse", tool_name:"Edit", tool_input:{file_path:$p}}' | bash "$HOOK" 2>&1; }

LEDGER="$SANDBOX/wt/.superpowers/sdd/2026-01-01-thing/progress.md"
mkdir -p "$(dirname "$LEDGER")"
printf '# SDD ledger\n## 2026-01-01T99:99Z — an estimated heading\n' >"$LEDGER"

echo "# an SDD ledger edit gets a clock line"
out=$(run "$LEDGER")
if [ -z "$out" ] && tail -1 "$LEDGER" | grep -Eq "$CLOCK_RE"; then
  pass=$((pass + 1)); echo "ok   ledger stamped, hook silent"
else
  fail=$((fail + 1)); echo "FAIL ledger not stamped (last line: $(tail -1 "$LEDGER"); out: $out)"
fi
if [ "$(head -2 "$LEDGER" | tail -1)" = "## 2026-01-01T99:99Z — an estimated heading" ]; then
  pass=$((pass + 1)); echo "ok   existing content untouched"
else
  fail=$((fail + 1)); echo "FAIL existing content changed"
fi

echo "# a second edit stamps again (one line per edit, never rewritten)"
run "$LEDGER" >/dev/null
n=$(grep -Ec "$CLOCK_RE" "$LEDGER")
if [ "$n" -eq 2 ]; then pass=$((pass + 1)); echo "ok   two stamps after two edits"; else fail=$((fail + 1)); echo "FAIL expected 2 stamps, got $n"; fi

echo "# files that are not an SDD ledger are left alone"
OTHER="$SANDBOX/wt/docs/notes.md"
mkdir -p "$(dirname "$OTHER")"
printf 'hello\n' >"$OTHER"
run "$OTHER" >/dev/null
if [ "$(cat "$OTHER")" = "hello" ]; then pass=$((pass + 1)); echo "ok   unrelated markdown untouched"; else fail=$((fail + 1)); echo "FAIL unrelated file modified"; fi

echo "# a path that does not exist is a no-op"
out=$(run "$SANDBOX/wt/.superpowers/sdd/nope/progress.md")
if [ -z "$out" ] && [ ! -e "$SANDBOX/wt/.superpowers/sdd/nope/progress.md" ]; then
  pass=$((pass + 1)); echo "ok   missing file → silent, not created"
else
  fail=$((fail + 1)); echo "FAIL missing file handling: $out"
fi

echo ""
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
