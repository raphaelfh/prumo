#!/usr/bin/env bash
# PostToolUse (Edit|Write): append one wall-clock line after every edit of a
# /ship-spec SDD ledger. The orchestrator writes its own timestamps into the
# ledger and was observed stamping entries up to 43 minutes AHEAD of the wall
# clock (2026-09-07), leaving the record non-chronological. This is
# detectability, not prevention: the true time sits beside every claim, and
# the model sees it on its next read. Silent on every other file.

set -u

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0

case "$FILE" in
  */.superpowers/sdd/*/progress.md)
    printf '\n_clock: %s_\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$FILE"
    ;;
esac

exit 0
