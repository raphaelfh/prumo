#!/usr/bin/env bash
# PreToolUse (Bash | Read | Glob): remind the agent — once per session — to
# orient with graphify before grepping or reading product source.
#
# Replaces two inline settings.json hooks that fired "MANDATORY" on every
# grep/ls/read, including harness files, docs and scripts that are not in
# the graph (~20 firings per session, each spending context for nothing).
# Scope: backend/app and frontend code files only; shown once per session.

set -u

[ -f graphify-out/graph.json ] || exit 0

INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // "nosession"')
MARK="${TMPDIR:-/tmp}/graphify-hint-${SID}"
[ -f "$MARK" ] && exit 0

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')
case "$TOOL" in
  Bash)
    TARGET=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')
    printf '%s' "$TARGET" | grep -Eq '(^|[[:space:]|;&(])(grep|rg|ripgrep|find|fd|ack|ag)[[:space:]]' || exit 0
    ;;
  Read|Glob)
    TARGET=$(printf '%s' "$INPUT" | jq -r '[.tool_input.file_path, .tool_input.pattern, .tool_input.path] | map(select(. != null)) | join(" ")')
    # A directory grep has no extension; a read/glob does — check it here only.
    printf '%s' "$TARGET" | grep -Eq '\.(py|ts|tsx|js|jsx)([[:space:]"'"'"']|$)' || exit 0
    ;;
  *) exit 0 ;;
esac

printf '%s' "$TARGET" | grep -Eq '(^|[[:space:]/])(backend/app|frontend)/' || exit 0

touch "$MARK" 2>/dev/null || true
jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:"graphify-out/graph.json exists. Before exploring product source, orient once with `graphify query \"<question>\"` (scoped subgraph), `graphify explain \"<concept>\"` or `graphify path \"<A>\" \"<B>\"`; grep/read raw files after that, or to modify/debug specific lines. Pass this rule to subagents that explore code. (Shown once per session.)"}}'
exit 0
