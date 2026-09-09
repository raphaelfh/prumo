#!/usr/bin/env bash
# Sandboxed: builds no repo and reads no run state, so it is safe to run inside
# `make quality-scan` while a /ship-spec run is live (#847).
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/protect-run-state.sh"
pass=0; fail=0
# A hook that prints NOTHING is an allow — that is the contract, and it is why
# the silent path must stay silent rather than emit a permissive JSON blob.
decide() {
  local out
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$1" | bash "$HOOK")
  [ -z "$out" ] && { echo allow; return; }
  printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"'
}
decide_raw() {
  local out; out=$(printf '%s' "$1" | bash "$HOOK")
  [ -z "$out" ] && { echo allow; return; }
  printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"'
}
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1: want '$3' got '$2'"; fi; }

echo "# the state file is machine-owned"
ok "state file denied"            "$(decide /r/.superpowers/ship-spec/demo/state)"          deny
ok "state in a worktree denied"   "$(decide /w/wt/.superpowers/ship-spec/2026-01-x/state)"  deny

echo "# everything else stays writable"
ok "gate log allowed"      "$(decide /r/.superpowers/ship-spec/demo/gate.log)"   allow
ok "sdd ledger allowed"    "$(decide /r/.superpowers/sdd/demo/progress.md)"      allow
ok "ordinary file allowed" "$(decide /r/backend/app/main.py)"                    allow
ok "a file merely NAMED state allowed" "$(decide /r/backend/app/state.py)"       allow
ok "state dir sibling allowed"         "$(decide /r/.superpowers/ship-spec/demo/notes.md)" allow

echo "# malformed input never blocks a tool call"
ok "no file_path allowed" "$(decide_raw '{"tool_input":{}}')" allow
ok "empty input allowed"  "$(decide_raw '{}')"                 allow
ok "non-JSON allowed"     "$(decide_raw 'not json at all')"    allow

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
