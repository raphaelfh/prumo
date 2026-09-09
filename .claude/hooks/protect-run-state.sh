#!/usr/bin/env bash
# PreToolUse (Edit|Write): the run state is written by scripts/ship.sh only.
#
# Without this, "the model does not author run facts" is an instruction — and
# instructions in this pipeline run about one time in four (2026-09-07: one of
# four prose mandates in Phase 4 actually ran). With it, the rule is a
# mechanism: `state` is the file both hooks trust, so it is the one file the
# model must not be able to write by hand.
#
# The gate log and the SDD ledger stay writable; only `state` is machine-owned.
# Silent on every other path, so ordinary edits cost nothing.
#
# Design: docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md §4
# Tests:  .claude/hooks/tests/test-protect-run-state.sh
set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0

case "$FILE" in
  */.superpowers/ship-spec/*/state)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Run state is written by scripts/ship.sh only. Use: ship.sh phase <name> | ship.sh ci [sha] | ship.sh preflight-record <GREEN|RED> [sha] | ship.sh halt <reason> | ship.sh done. Hand-editing this file is how phase markers and timestamps stopped matching the work (2026-09-07: 8+ entries up to 43 min ahead of the clock, a phase marker 27 min early)."}}'
    exit 0 ;;
esac

exit 0
