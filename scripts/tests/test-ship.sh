#!/usr/bin/env bash
# Sandboxed test for scripts/ship.sh. Builds a throwaway repo in $TMPDIR and
# runs there: scripts/fitness/run_all.sh executes this inside `make
# quality-scan`, which is what a live /ship-spec run runs, so a test that
# touched real run state would turn a run's own gate red by the run being
# live (#847 — see docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md §4).
set -uo pipefail
SHIP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ship.sh"
pass=0; fail=0
SANDBOX=$(mktemp -d); trap 'rm -rf "$SANDBOX"' EXIT
git -C "$SANDBOX" init -q
git -C "$SANDBOX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
cd "$SANDBOX" || exit 1

ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1: want '$3' got '$2'"; fi; }
yes_() { if [ -n "$2" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
state() { sed -n "s/^$1=//p" "$SANDBOX/.superpowers/ship-spec/demo/state" | tail -1 | tr -d '[:space:]'; }

echo "# init"
bash "$SHIP" init demo --to dev >/dev/null
ok "init writes ceiling"       "$(state ceiling)"      "dev"
ok "init starts at frame"      "$(state phase)"        "frame"
ok "init records orchestrator" "$(state orchestrator)" "$SANDBOX"
yes_ "init stamps started"     "$(state started)"

bash "$SHIP" init other --to dev >/dev/null 2>&1
ok "second init on same checkout refused" "$?" "1"
bash "$SHIP" init bad --to staging >/dev/null 2>&1
ok "unknown ceiling refused"              "$?" "2"

echo "# phase transitions"
bash "$SHIP" phase plan >/dev/null
ok "frame -> plan legal" "$(state phase)" "plan"
yes_ "phase stamps plan_at" "$(state plan_at)"

bash "$SHIP" phase verify >/dev/null 2>&1
ok "plan -> verify refused"        "$?" "1"
ok "phase unchanged after refusal" "$(state phase)" "plan"

bash "$SHIP" phase plan >/dev/null 2>&1
ok "re-setting the current phase is idempotent" "$?" "0"

echo "# terminal states"
bash "$SHIP" halt "because" >/dev/null
ok "halt is terminal"        "$(state phase)"  "halted"
ok "halt records the reason" "$(state reason)" "because"
yes_ "halt stamps ended"     "$(state ended)"
bash "$SHIP" phase build >/dev/null
ok "resume from halted goes anywhere" "$(state phase)" "build"

echo "# ci verdict (pure — no network, so this runs in CI)"
# shellcheck disable=SC1090
. "$SHIP" --source-only

RUNS_GREEN=$'Backend Lint\tcompleted\tsuccess\nSupabase Preview\tcompleted\tskipped'
ok "all required success -> GREEN" "$(_ci_verdict 'Backend Lint' "$RUNS_GREEN")" "GREEN"

RUNS_PENDING=$'Backend Lint\tin_progress\t'
ok "required still running -> PENDING" "$(_ci_verdict 'Backend Lint' "$RUNS_PENDING")" "PENDING"

RUNS_MISSING=$'Frontend Lint\tcompleted\tsuccess'
ok "required context absent -> PENDING" "$(_ci_verdict 'Backend Lint' "$RUNS_MISSING")" "PENDING"

RUNS_RED=$'Backend Lint\tcompleted\tfailure'
ok "required failed -> RED" "$(_ci_verdict 'Backend Lint' "$RUNS_RED")" "RED:Backend Lint"

# markdownlint is NOT a required context, yet it produced the only red of the
# first prod run. A non-required failure is still RED.
RUNS_NONREQ=$'Backend Lint\tcompleted\tsuccess\nmarkdownlint\tcompleted\tfailure'
ok "non-required failure -> RED" "$(_ci_verdict 'Backend Lint' "$RUNS_NONREQ")" "RED:markdownlint"

# A pending required context must never mask a failure that already happened.
RUNS_MIXED=$'Backend Lint\tin_progress\t\nmarkdownlint\tcompleted\tfailure'
ok "failure wins over pending" "$(_ci_verdict 'Backend Lint' "$RUNS_MIXED")" "RED:markdownlint"

RUNS_CANCELLED=$'Backend Lint\tcompleted\tcancelled'
ok "cancelled counts as red" "$(_ci_verdict 'Backend Lint' "$RUNS_CANCELLED")" "RED:Backend Lint"

echo "# gate"
# The gate log must be addressed to HEAD and must carry its own TERMINAL
# marker. A seat cut off mid-run leaves a correct sha= line and no marker;
# that passed the Stop hook twice on 2026-09-07.
bash "$SHIP" phase harden >/dev/null
LOG="$SANDBOX/.superpowers/ship-spec/demo/gate.log"
SHIP_GATE_CMD="true" bash "$SHIP" gate >/dev/null 2>&1
ok "gate log first line is the HEAD sha" "$(sed -n '1s/^sha=//p' "$LOG")" "$(git -C "$SANDBOX" rev-parse HEAD)"
ok "gate log ends with its marker"       "$(tail -1 "$LOG")"                "GATE_EXIT=0"

SHIP_GATE_CMD="false" bash "$SHIP" gate >/dev/null 2>&1
ok "red gate exits non-zero"   "$?"                "1"
ok "red gate records its exit" "$(tail -1 "$LOG")" "GATE_EXIT=1"

SHIP_GATE_CMD="echo hello; true" bash "$SHIP" gate >/dev/null 2>&1
ok "gate captures command output" "$(grep -c '^hello$' "$LOG")" "1"

echo "# dev (the refusals — the gh calls need a network and are not exercised here)"
git -C "$SANDBOX" checkout -q -b feature/x
echo dirty > "$SANDBOX/dirty.txt"
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "dirty tree refused" "$?" "1"
rm -f "$SANDBOX/dirty.txt"

git -C "$SANDBOX" checkout -q -B dev
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "refuses to ship from dev itself" "$?" "1"
git -C "$SANDBOX" checkout -q -B main
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "refuses to ship from main"       "$?" "1"
git -C "$SANDBOX" checkout -q feature/x

bash "$SHIP" dev >/dev/null 2>&1
ok "a title is required" "$?" "2"

echo "# preflight-record: a ruling the model may make, bounded by a fact it may not"
ST="$SANDBOX/.superpowers/ship-spec/demo/state"
bash "$SHIP" preflight-record GREEN deadbeef >/dev/null 2>&1
ok "GREEN without a green CI is refused" "$?" "1"

bash "$SHIP" preflight-record RED deadbeef >/dev/null 2>&1
ok "RED needs no CI evidence" "$?" "0"

grep -v '^ci=' "$ST" > "$ST.tmp" && mv "$ST.tmp" "$ST"
printf 'ci=GREEN@deadbeef\n' >> "$ST"
bash "$SHIP" preflight-record GREEN cafebabe >/dev/null 2>&1
ok "GREEN for a DIFFERENT sha is refused" "$?" "1"
bash "$SHIP" preflight-record GREEN deadbeef >/dev/null 2>&1
ok "GREEN matching the green CI is accepted" "$?" "0"
ok "preflight recorded" "$(state preflight)" "GREEN@deadbeef"

echo "# facts: every line measured, none authored"
yes_ "facts stamps now= from the clock"  "$(bash "$SHIP" facts | sed -n 's/^now=//p')"
yes_ "facts reads the state mtime"       "$(bash "$SHIP" facts | sed -n 's/^state_mtime=//p')"
ok   "facts reports a measured commit count" "$(bash "$SHIP" facts | sed -n 's/^commits=//p')" "0"
yes_ "facts echoes the recorded ceiling" "$(bash "$SHIP" facts | sed -n 's/^ceiling=//p')"

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
