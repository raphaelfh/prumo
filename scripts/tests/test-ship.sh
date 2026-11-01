#!/usr/bin/env bash
# Sandboxed test for scripts/ship.sh. Builds a throwaway repo in $TMPDIR and
# runs there: scripts/fitness/run_all.sh executes this inside `make
# quality-scan`, which is what a live /ship-spec run runs, so a test that
# touched real run state would turn a run's own gate red by the run being
# live (#847 — see docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md §4).
set -uo pipefail
SHIP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ship.sh"
pass=0; fail=0
# shellcheck source=scripts/tests/lib/scratch-repo.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/scratch-repo.sh"
scratch_mkdir ship-test
scratch_init "$SANDBOX"
sgit "$SANDBOX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
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
ok "a DIFFERENT basename on the same checkout is refused" "$?" "1"

# Re-init of the SAME basename updates: this is how a worktree created after
# init gets attached, and how a resumed session repairs a path.
bash "$SHIP" init demo --to dev --worktree /tmp >/dev/null 2>&1
ok "same basename re-init succeeds" "$?" "0"
ok "re-init attaches the worktree"  "$(state worktree)" "/tmp"
ok "re-init does not reset the phase" "$(state phase)" "frame"
bash "$SHIP" init demo --to dev --worktree "$SANDBOX" >/dev/null   # restore for later tests
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
ok "gate log first line is the HEAD sha" "$(sed -n '1s/^sha=//p' "$LOG")" "$(sgit "$SANDBOX" rev-parse HEAD)"
ok "gate log ends with its marker"       "$(tail -1 "$LOG")"                "GATE_EXIT=0"

SHIP_GATE_CMD="false" bash "$SHIP" gate >/dev/null 2>&1
ok "red gate exits non-zero"   "$?"                "1"
ok "red gate records its exit" "$(tail -1 "$LOG")" "GATE_EXIT=1"

SHIP_GATE_CMD="echo hello; true" bash "$SHIP" gate >/dev/null 2>&1
ok "gate captures command output" "$(grep -c '^hello$' "$LOG")" "1"

echo "# dev (the refusals — the gh calls need a network and are not exercised here)"
sgit "$SANDBOX" checkout -q -b feature/x
echo dirty > "$SANDBOX/dirty.txt"
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "dirty tree refused" "$?" "1"
rm -f "$SANDBOX/dirty.txt"

sgit "$SANDBOX" checkout -q -B dev
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "refuses to ship from dev itself" "$?" "1"
sgit "$SANDBOX" checkout -q -B main
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "refuses to ship from main"       "$?" "1"
sgit "$SANDBOX" checkout -q feature/x

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

echo "# promote needs its evidence at the phase boundary, not just at the gh call"
sgit "$SANDBOX" update-ref refs/remotes/origin/dev HEAD
DEV_SHA=$(sgit "$SANDBOX" rev-parse origin/dev)
bash "$SHIP" phase ship >/dev/null
bash "$SHIP" phase promote >/dev/null 2>&1
ok "promote refused: preflight is for another sha" "$?" "1"
ok "phase unchanged after refusal"                 "$(state phase)" "ship"

grep -v '^ci=' "$ST" > "$ST.tmp" && mv "$ST.tmp" "$ST"
printf 'ci=GREEN@%s\n' "$DEV_SHA" >> "$ST"
bash "$SHIP" preflight-record GREEN "$DEV_SHA" >/dev/null
bash "$SHIP" phase promote >/dev/null 2>&1
ok "promote allowed with a GREEN preflight on origin/dev" "$?" "0"
ok "phase advanced" "$(state phase)" "promote"

echo "# cmd_ci error handling (stub gh — an API error must not read as PENDING)"
# gh writes HTTP-error JSON to STDOUT, so a 404/422/500 arrives as non-empty
# output. Keying on emptiness reported PENDING for a dead API, and a run would
# wait forever for a green that cannot arrive. Key on the exit status.
STUB="$SANDBOX/stub"; mkdir -p "$STUB"
mk_gh() { printf '#!/usr/bin/env bash\n%s\n' "$1" > "$STUB/gh"; chmod +x "$STUB/gh"; }

# These run against the existing `demo` run: `init` correctly refuses a second
# live run for this checkout, so there is only ever one to write to.

# 1. HTTP error: non-zero exit WITH json on stdout (the case that shipped wrong)
mk_gh 'case "$1" in repo) echo raphaelfh/prumo ;; *) echo "{\"message\":\"No commit found for SHA\",\"status\":\"422\"}"; exit 1 ;; esac'
out=$(PATH="$STUB:$PATH" bash "$SHIP" ci deadbeef 2>/dev/null)
ok "HTTP error -> UNKNOWN (not PENDING)" "$out" "UNKNOWN@deadbeef"
ok "and UNKNOWN is what gets recorded"   "$(state ci)" "UNKNOWN@deadbeef"

# 2. Network failure: non-zero exit, nothing on stdout
mk_gh 'exit 1'
out=$(PATH="$STUB:$PATH" bash "$SHIP" ci deadbeef 2>/dev/null)
ok "network failure -> UNKNOWN" "$out" "UNKNOWN@deadbeef"

# 3. A real commit with no check-runs yet: exit 0, empty output. That is
#    genuinely pending, not unknown.
mk_gh 'case "$1" in repo) echo raphaelfh/prumo ;; api) case "$2" in *protection*) echo "Backend Lint" ;; *) : ;; esac ;; esac; exit 0'
out=$(PATH="$STUB:$PATH" bash "$SHIP" ci deadbeef 2>/dev/null)
ok "no checks yet -> PENDING" "$out" "PENDING@deadbeef"

# 4. Happy path through the real plumbing
mk_gh 'case "$1" in repo) echo raphaelfh/prumo ;; api) case "$2" in *protection*) echo "Backend Lint" ;; *) printf "Backend Lint\tcompleted\tsuccess\n" ;; esac ;; esac; exit 0'
out=$(PATH="$STUB:$PATH" bash "$SHIP" ci deadbeef 2>/dev/null)
ok "all required green -> GREEN" "$out" "GREEN@deadbeef"

# 5. Red carries the failing contexts through
mk_gh 'case "$1" in repo) echo raphaelfh/prumo ;; api) case "$2" in *protection*) echo "Backend Lint" ;; *) printf "Backend Lint\tcompleted\tfailure\n" ;; esac ;; esac; exit 0'
out=$(PATH="$STUB:$PATH" bash "$SHIP" ci deadbeef 2>/dev/null)
ok "red names the context" "$out" "RED@deadbeef:Backend Lint"

echo "# dev: one owner per fix (pure — duplicate PRs #1081/#1082, 2026-11-01)"
PRS=$'12\tfix/a\tfix(ci): pin node\t.github/workflows/ci.yml\n13\tfeat/b\tfeat(x): thing\tbackend/app/x.py,backend/app/y.py\n14\tme/branch\tfeat(me): mine\tbackend/app/x.py'
ok "no conflict -> silent" "$(_dev_conflicts me/branch 'feat(z): other' 'frontend/z.tsx' "$PRS")" ""
ok "same title -> conflict" "$(_dev_conflicts me/branch 'fix(ci): pin node' 'docs/a.md' "$PRS")" "#12 same title"
ok "shared file -> conflict" "$(_dev_conflicts me/branch 'feat(z): z' $'backend/app/y.py\nfrontend/q.ts' "$PRS")" "#13 shares backend/app/y.py"
ok "own branch's PR is not a conflict" "$(_dev_conflicts me/branch 'feat(me): mine' 'frontend/q.ts' "$PRS")" ""

echo "# multi-slice: one session, waves, one queue, one promote"
# A second orchestrator checkout of the same repo: ownership keys on $PWD.
ORCH="$SANDBOX/orch"; mkdir -p "$ORCH"; cd "$ORCH" || exit 1
SB="$SANDBOX/.superpowers/ship-spec"
sstate() { sed -n "s/^$2=//p" "$SB/$1/state" | tail -1 | tr -d '[:space:]'; }
mk_gh 'case "$1 $2" in "pr view") echo "${GH_PR_STATE:-OPEN}" ;; *) exit 1 ;; esac'

bash "$SHIP" init wspec --to prod --slices "S1 | S2, S1" >/dev/null 2>&1
ok "a slice named twice is refused" "$?" "2"
bash "$SHIP" init wspec --to prod --slices "S1 || S2" >/dev/null 2>&1
ok "an empty wave is refused" "$?" "2"
bash "$SHIP" init wspec --to prod --slices "S1 | S2," >/dev/null 2>&1
ok "an empty slice (trailing comma) is refused" "$?" "2"
touch "$ORCH/Sx"
bash "$SHIP" init wspec --to prod --slices "S*" >/dev/null 2>&1
ok "a glob is refused, not expanded to a file name" "$?" "2"
rm -f "$ORCH/Sx"
bash "$SHIP" init wspec --to prod --slices "S1 | S2,S3" >/dev/null
ok "init --slices writes a manifest"   "$(sed -n 's/^wave2=//p' "$SB/wspec/manifest")" "S2,S3"
ok "init --slices starts no run"       "$([ -e "$SB/wspec/state" ] && echo yes || echo no)" "no"

bash "$SHIP" slice wspec S9 --worktree "$SANDBOX" >/dev/null 2>&1
ok "a slice not in the manifest is refused" "$?" "1"
bash "$SHIP" slice wspec S2 --worktree "$SANDBOX" >/dev/null 2>&1
ok "wave 2 refused while wave 1 has not landed" "$?" "1"

bash "$SHIP" slice wspec S1 --worktree "$SANDBOX" >/dev/null
ok "slice run starts at plan"         "$(sstate wspec-S1 phase)"   "plan"
ok "slice run inherits the ceiling"   "$(sstate wspec-S1 ceiling)" "prod"
ok "slice run names its spec"         "$(sstate wspec-S1 spec)"    "wspec"
ok "slice run is owned by this checkout" "$(sstate wspec-S1 orchestrator)" "$ORCH"

bash "$SHIP" init stray --to dev >/dev/null 2>&1
ok "plain init refused while a slice is live" "$?" "1"

bash "$SHIP" done >/dev/null 2>&1
ok "a slice without a PR cannot be done" "$?" "1"
printf 'pr=https://x/pull/1\n' >> "$SB/wspec-S1/state"
GH_PR_STATE=OPEN PATH="$STUB:$PATH" bash "$SHIP" done >/dev/null 2>&1
ok "a slice whose PR is still open cannot be done" "$?" "1"
GH_PR_STATE=MERGED PATH="$STUB:$PATH" bash "$SHIP" done >/dev/null 2>&1
ok "a slice whose PR merged is done" "$(sstate wspec-S1 phase)" "done"

bash "$SHIP" slice wspec S2 --worktree "$SANDBOX" >/dev/null
bash "$SHIP" slice wspec S3 --worktree "$SANDBOX" >/dev/null
ok "a wave's slices run concurrently" "$(sstate wspec-S3 phase)" "plan"

bash "$SHIP" phase build >/dev/null 2>&1
ok "two live slices: a verb without --run is refused" "$?" "1"
bash "$SHIP" --run wspec-S2 phase build >/dev/null
ok "--run addresses one slice" "$(sstate wspec-S2 phase)" "build"
ok "and leaves its sibling alone" "$(sstate wspec-S3 phase)" "plan"
bash "$SHIP" --run demo phase build >/dev/null 2>&1
ok "--run cannot address another checkout's run" "$?" "1"

yes_ "status lists every slice" "$(bash "$SHIP" status wspec | grep -c 'S[123]' | grep -x 3)"

for ph in harden ship; do bash "$SHIP" --run wspec-S2 phase $ph >/dev/null; done
printf 'ci=GREEN@%s\n' "$DEV_SHA" >> "$SB/wspec-S2/state"
bash "$SHIP" --run wspec-S2 preflight-record GREEN "$DEV_SHA" >/dev/null
bash "$SHIP" --run wspec-S2 phase promote >/dev/null 2>&1
ok "promote refused while a sibling slice is live" "$?" "1"
printf 'pr=https://x/pull/3\n' >> "$SB/wspec-S3/state"
GH_PR_STATE=MERGED PATH="$STUB:$PATH" bash "$SHIP" --run wspec-S3 done >/dev/null
bash "$SHIP" phase promote >/dev/null 2>&1
ok "the last live slice promotes once every sibling landed" "$(sstate wspec-S2 phase)" "promote"
cd "$SANDBOX" || exit 1

echo "# dev: the overlap guard runs BEFORE the push (stub gh)"
# Run state and the stub are untracked here; in prumo .superpowers/ is ignored.
printf '.superpowers/\nstub/\norch/\n' >> "$(sgit "$SANDBOX" rev-parse --git-dir)/info/exclude"
mk_gh 'case "$1 $2" in "pr list") printf "12\tfix/a\tfix(ci): pin node\tx.yml\n" ;; *) exit 1 ;; esac'
err=$(PATH="$STUB:$PATH" bash "$SHIP" dev "fix(ci): pin node" 2>&1 >/dev/null)
yes_ "a duplicate title is refused, naming the owner" "$(printf '%s' "$err" | grep 'already owns' )"
err=$(PATH="$STUB:$PATH" bash "$SHIP" dev "fix(ci): pin node" --allow-overlap 12 2>&1 >/dev/null)
ok "an acknowledged overlap passes the guard" "$(printf '%s' "$err" | grep -c 'already owns')" "0"
mk_gh 'exit 1'
err=$(PATH="$STUB:$PATH" bash "$SHIP" dev "feat: y" 2>&1 >/dev/null)
yes_ "an unlistable PR set is refused, not assumed empty" "$(printf '%s' "$err" | grep 'cannot list')"

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
