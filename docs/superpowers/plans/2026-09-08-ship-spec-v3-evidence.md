---
status: in_progress
last_reviewed: 2026-09-08
owner: '@raphaelfh'
---

# ship-spec v3 (evidence over narration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every *fact* about a `/ship-spec` run out of the model's prose and into a script the model calls plus hooks that refuse what it cannot prove.

**Architecture:** One new script, `scripts/ship.sh`, becomes the only writer of `.superpowers/ship-spec/<basename>/state`. A new `PreToolUse` hook denies `Edit`/`Write` on that path, so "the model does not author run facts" is a mechanism rather than an instruction. The Stop hook stops demanding a heavy local gate log and instead reads GitHub's check-runs API for the branch's SHA — CI becomes the arbiter, matching the policy `.githooks/pre-push` already documents. Phases become names, five flags become two, and the shipper seat becomes a script verb.

**Tech Stack:** Bash 3.2 (macOS), `git`, `gh`, `jq`. No new dependencies. Hook contract is Claude Code's `hookSpecificOutput.permissionDecision` JSON.

**Spec:** `docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md`

## Global Constraints

- **English only** for code, comments, commits and docs.
- **Bash 3.2 compatible.** macOS ships 3.2: no associative arrays, no `${var,,}`. `scripts/verify_all.sh` documents this constraint already.
- **A gate must not read the state it gates.** Every test for anything under `.claude/hooks/` or `scripts/ship.sh` MUST build a throwaway git repo in `$TMPDIR` and run there. `scripts/fitness/run_all.sh` runs these tests inside `make quality-scan`, which is what a live run executes — a test that reads real run state turns a run's own gate red by the run being live. This shipped three times (#847 ×2, #850). Pattern to copy: `.claude/hooks/tests/test-bash-guard.sh`.
- **Shared visibility is never ownership.** Any reader of run state resolves the owner as `orchestrator=` compared against the invoking checkout, never `worktree=`, and never "the first live state found".
- **Phase vocabulary** is exactly: `frame plan build harden ship promote verify` plus terminal `done` and `halted`. No numbers anywhere.
- **Ceiling values** are exactly `dev` and `prod`. `staging` is deleted.
- **State file format** is `key=value`, one per line, read with `sed -n "s/^key=//p" | tail -1 | tr -d '[:space:]'` — the existing hooks' `trimmed()`. Do not change the format; three hooks parse it.
- New docs under `docs/superpowers/**` need frontmatter (`status`, `last_reviewed`, `owner`; status from `draft approved in_progress shipped superseded frozen`) and nothing else — markdownlint and cspell already glob-ignore that tree.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/ship.sh` (create) | The only writer of run state. Verbs: `init`, `phase`, `gate`, `ci`, `dev`, `preflight-record`, `facts`, `halt`, `done`. |
| `scripts/tests/test-ship.sh` (create) | Sandboxed test for every verb. Builds its repo in `$TMPDIR`. |
| `.claude/hooks/protect-run-state.sh` (create) | `PreToolUse` on `Edit\|Write`: denies writes to `*/.superpowers/ship-spec/*/state`. |
| `.claude/hooks/tests/test-protect-run-state.sh` (create) | Sandboxed test for the above. |
| `.claude/hooks/stop-format-gate.sh` (modify) | Named phases; `harden` needs a local gate log, `ship`/`promote`/`verify` read CI. Pending never blocks. |
| `.claude/hooks/bash-guard.sh` (modify) | Named-phase vocabulary only. Ceiling logic unchanged. |
| `.claude/settings.json` (modify) | Register `protect-run-state.sh`. |
| `scripts/fitness/run_all.sh` (modify) | Run the two new tests. |
| `.claude/skills/ship-spec/SKILL.md` (rewrite) | Two flags, seven named phases, four seats, `ship.sh` verbs instead of prose mandates. |
| `.claude/agents/ship-shipper.md` (delete) | Replaced by `ship dev`. |
| `.claude/skills/ship-spec/evals/evals.json` (rewrite) | Four modes, all reachable. |

---

## Task 1: `ship.sh` state machine — `init` and `phase`

**Files:**

- Create: `scripts/ship.sh`
- Create: `scripts/tests/test-ship.sh`

**Interfaces:**

- Consumes: nothing.
- Produces: `_root()`, `_clock()`, `_get <file> <key>`, `_set <file> <key> <value>`, `_active()` (prints the state file this checkout owns, fails unless exactly one), `cmd_init`, `cmd_phase`. Every later task adds one `cmd_*` and one dispatcher line.

- [x] **Step 1: Write the failing test**

```bash
# scripts/tests/test-ship.sh
#!/usr/bin/env bash
# Sandboxed test for scripts/ship.sh. Builds a throwaway repo in $TMPDIR and
# runs there: run_all.sh executes this inside `make quality-scan`, which is
# what a live /ship-spec run runs, so a test that touched real run state would
# turn a run's own gate red by the run being live (#847).
set -uo pipefail
SHIP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ship.sh"
pass=0; fail=0
SANDBOX=$(mktemp -d); trap 'rm -rf "$SANDBOX"' EXIT
git -C "$SANDBOX" init -q
git -C "$SANDBOX" commit -q --allow-empty -m init
cd "$SANDBOX" || exit 1

ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1: want '$3' got '$2'"; fi; }
state() { sed -n "s/^$1=//p" "$SANDBOX/.superpowers/ship-spec/demo/state" | tail -1 | tr -d '[:space:]'; }

bash "$SHIP" init demo --to dev >/dev/null
ok "init writes ceiling"       "$(state ceiling)"      "dev"
ok "init starts at frame"      "$(state phase)"        "frame"
ok "init records orchestrator" "$(state orchestrator)" "$SANDBOX"
[ -n "$(state started)" ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL init stamps started"; }

bash "$SHIP" init other --to dev >/dev/null 2>&1
ok "second init on same checkout refused" "$?" "1"

bash "$SHIP" phase plan >/dev/null
ok "frame -> plan legal" "$(state phase)" "plan"
[ -n "$(state plan_at)" ] && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL phase stamps plan_at"; }

bash "$SHIP" phase verify >/dev/null 2>&1
ok "plan -> verify refused" "$?" "1"
ok "phase unchanged after refusal" "$(state phase)" "plan"

bash "$SHIP" phase plan >/dev/null
ok "re-setting the current phase is idempotent" "$?" "0"

bash "$SHIP" halt "because" >/dev/null
ok "halt is terminal" "$(state phase)" "halted"
bash "$SHIP" phase build >/dev/null
ok "resume from halted goes anywhere" "$(state phase)" "build"

echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash scripts/tests/test-ship.sh`
Expected: FAIL — `scripts/ship.sh` does not exist (`bash: .../ship.sh: No such file or directory`).

- [x] **Step 3: Write the minimal implementation**

```bash
#!/usr/bin/env bash
# scripts/ship.sh — the ONLY writer of /ship-spec run state.
#
# The model calls verbs; it never opens the state file (a PreToolUse hook
# denies that). Every fact in `state` is stamped here, at the moment the verb
# runs, so a phase marker cannot lead the work and a timestamp cannot be
# authored. Design: docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md
set -uo pipefail

_root() { local c; if c=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then dirname "$c"; else pwd; fi; }
ROOT=$(_root)
BASE="$ROOT/.superpowers/ship-spec"
_clock() { date -u +%FT%TZ; }
_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1 | tr -d '[:space:]'; }
_set() { local f=$1 k=$2 v=$3 t; t=$(mktemp); grep -v "^$k=" "$f" >"$t" 2>/dev/null; printf '%s=%s\n' "$k" "$v" >>"$t"; mv "$t" "$f"; }

# The run this checkout owns. Same predicate as the hooks: orchestrator=,
# never worktree=, never "the first live state found".
_active() {
  local f n=0 found=""
  for f in "$BASE"/*/state; do
    [ -f "$f" ] || continue
    case "$(_get "$f" phase)" in done|halted) continue ;; esac
    [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ] && continue
    [ "$(_get "$f" orchestrator)" = "$PWD" ] || continue
    found=$f; n=$((n + 1))
  done
  if [ "$n" -ne 1 ]; then
    echo "ship: expected exactly one active run owned by $PWD, found $n" >&2
    return 1
  fi
  printf '%s\n' "$found"
}

_next_of() {
  case $1 in
    frame) echo plan ;; plan) echo build ;; build) echo harden ;;
    harden) echo ship ;; ship) echo promote ;; promote) echo verify ;;
    verify) echo done ;; *) echo "" ;;
  esac
}

cmd_init() {
  local name=$1; shift
  local ceiling=dev worktree=$PWD
  while [ $# -gt 0 ]; do
    case $1 in
      --to) ceiling=$2; shift 2 ;;
      --worktree) worktree=$2; shift 2 ;;
      *) echo "ship init: unknown argument '$1'" >&2; return 2 ;;
    esac
  done
  case "$ceiling" in dev|prod) ;; *) echo "ship init: --to must be dev or prod" >&2; return 2 ;; esac
  if _active >/dev/null 2>&1; then
    echo "ship init: a live run already names $PWD as orchestrator. End it with 'ship done' or 'ship halt <reason>'." >&2
    return 1
  fi
  local f="$BASE/$name/state"
  mkdir -p "$BASE/$name"; : >"$f"
  _set "$f" ceiling "$ceiling"
  _set "$f" phase frame
  _set "$f" worktree "$worktree"
  _set "$f" orchestrator "$PWD"
  _set "$f" started "$(_clock)"
  _set "$f" frame_at "$(_clock)"
  cat "$f"
}

cmd_phase() {
  local to=$1 f cur
  f=$(_active) || return 1
  cur=$(_get "$f" phase)
  [ "$cur" = "$to" ] && { cat "$f"; return 0; }
  case "$to" in
    halted|done) ;;
    *)
      if [ "$cur" != halted ] && [ "$to" != "$(_next_of "$cur")" ]; then
        echo "ship phase: '$cur' -> '$to' is not legal (next is '$(_next_of "$cur")'). Resume a halted run instead of skipping." >&2
        return 1
      fi ;;
  esac
  _set "$f" phase "$to"
  _set "$f" "${to}_at" "$(_clock)"
  cat "$f"
}

cmd_halt() { local f; f=$(_active) || return 1; _set "$f" reason "${1:-unspecified}"; _set "$f" ended "$(_clock)"; _set "$f" phase halted; cat "$f"; }
cmd_done() { local f; f=$(_active) || return 1; _set "$f" ended "$(_clock)"; _set "$f" phase done; cat "$f"; }

case ${1:-} in
  init)  shift; cmd_init "$@" ;;
  phase) shift; cmd_phase "$@" ;;
  halt)  shift; cmd_halt "$@" ;;
  done)  shift; cmd_done "$@" ;;
  *) echo "usage: ship.sh {init|phase|gate|ci|dev|preflight-record|facts|halt|done}" >&2; exit 2 ;;
esac
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `chmod +x scripts/ship.sh scripts/tests/test-ship.sh && bash scripts/tests/test-ship.sh`
Expected: PASS, `failed=0`.

- [x] **Step 5: Commit**

```bash
git add scripts/ship.sh scripts/tests/test-ship.sh
git commit -m "feat(ship-spec): ship.sh owns run state — init and phase, sandboxed test"
```

---

## Task 2: `ship ci` — the SHA-keyed CI verdict

**Files:**

- Modify: `scripts/ship.sh` (add `cmd_ci`, dispatcher line)
- Modify: `scripts/tests/test-ship.sh` (add the parser test)

**Interfaces:**

- Consumes: `_active`, `_get`, `_set` from Task 1.
- Produces: `cmd_ci [sha]`, printing exactly one of `GREEN@<sha>`, `RED@<sha>:<contexts>`, `PENDING@<sha>`, `UNKNOWN@<sha>`, and recording it as `ci=<that>`. Also `_ci_verdict <required-tsv> <runs-tsv>` — a pure function the test drives with fixtures, so the verdict logic is tested without the network.

- [x] **Step 1: Write the failing test**

Append to `scripts/tests/test-ship.sh`, before the summary lines:

```bash
# _ci_verdict is pure: required contexts on stdin-arg 1, check-runs TSV in
# arg 2 (name<TAB>status<TAB>conclusion). No network, so this runs in CI.
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
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash scripts/tests/test-ship.sh`
Expected: FAIL — `_ci_verdict: command not found`, five failures.

- [x] **Step 3: Write the implementation**

Add to `scripts/ship.sh`, above the dispatcher:

```bash
# Pure verdict function: $1 = required contexts (newline separated),
# $2 = check-runs as name<TAB>status<TAB>conclusion lines.
# GREEN iff every required context completed successfully AND nothing on the
# SHA hard-failed. `skipped` is not a failure; a required context that has not
# completed (or is absent) is PENDING, never RED — waiting is not evidence.
_ci_verdict() {
  local required=$1 runs=$2 bad line st cc ctx pending=0
  bad=$(printf '%s\n' "$runs" | awk -F'\t' '$3=="failure"||$3=="timed_out"||$3=="cancelled"||$3=="action_required"{print $1}')
  while IFS= read -r ctx; do
    [ -n "$ctx" ] || continue
    line=$(printf '%s\n' "$runs" | awk -F'\t' -v n="$ctx" '$1==n{print;exit}')
    if [ -z "$line" ]; then pending=1; continue; fi
    st=$(printf '%s' "$line" | cut -f2); cc=$(printf '%s' "$line" | cut -f3)
    if [ "$st" != completed ]; then pending=1
    elif [ "$cc" != success ]; then bad=$(printf '%s\n%s' "$bad" "$ctx"); fi
  done <<EOF
$required
EOF
  bad=$(printf '%s\n' "$bad" | grep -v '^$' | sort -u | paste -sd, -)
  if [ -n "$bad" ]; then echo "RED:$bad"
  elif [ "$pending" = 1 ]; then echo PENDING
  else echo GREEN; fi
}

cmd_ci() {
  local f sha repo runs required verdict
  f=$(_active) || return 1
  sha=${1:-$(git -C "$(_get "$f" worktree)" rev-parse HEAD 2>/dev/null)}
  repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
  if [ -z "$repo" ]; then _set "$f" ci "UNKNOWN@$sha"; echo "UNKNOWN@$sha"; return 1; fi
  runs=$(gh api "repos/$repo/commits/$sha/check-runs" --paginate \
           --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv' 2>/dev/null)
  if [ -z "$runs" ]; then _set "$f" ci "UNKNOWN@$sha"; echo "UNKNOWN@$sha"; return 1; fi
  required=$(gh api "repos/$repo/branches/dev/protection" \
               --jq '.required_status_checks.contexts[]' 2>/dev/null)
  verdict=$(_ci_verdict "$required" "$runs")
  # verdict is GREEN | PENDING | RED:<ctx,ctx>; record it as <kind>@<sha>[:ctx]
  local kind=${verdict%%:*} rest=""
  case "$verdict" in *:*) rest=":${verdict#*:}" ;; esac
  _set "$f" ci "$kind@$sha$rest"
  printf '%s@%s%s\n' "$kind" "$sha" "$rest"
}
```

And, so the test can source the file without running the dispatcher, guard it:

```bash
if [ "${1:-}" = "--source-only" ]; then return 0 2>/dev/null || exit 0; fi
case ${1:-} in
  init)  shift; cmd_init "$@" ;;
  ci)    shift; cmd_ci "$@" ;;
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `bash scripts/tests/test-ship.sh`
Expected: PASS, `failed=0`.

- [ ] **Step 5: Verify against the live API once, by hand**  <!-- BLOCKED: see note below -->

Run: `bash scripts/ship.sh ci "$(git rev-parse origin/dev)"` from a checkout with an initialised run.
Expected: `GREEN@<sha>` on a green `dev`. This is the one check the sandbox cannot make; do it and paste the output into the ledger.

> **NOT DONE — 2026-09-08.** GitHub egress went down mid-execution
> (`dial tcp 4.228.31.149:443: can't assign requested address`, failing in
> ~2 ms outside the sandbox too, so it is the machine's VPN/firewall, not the
> harness — see the memory note on this recurrence). The pure predicate is
> covered by seven offline cases, and the exact predicate WAS run by hand
> against `9fbe2504` earlier the same day and returned GREEN. What remains
> unverified is `cmd_ci`'s own six lines of `gh` plumbing end to end. Run this
> step when the network returns, before trusting a `promote`.

- [x] **Step 6: Commit**

```bash
git add scripts/ship.sh scripts/tests/test-ship.sh
git commit -m "feat(ship-spec): ship ci reads the SHA-keyed check-runs verdict"
```

---

## Task 3: `ship gate` — the fast local subset

**Files:**

- Modify: `scripts/ship.sh` (add `cmd_gate`, dispatcher line)
- Modify: `scripts/tests/test-ship.sh`

**Interfaces:**

- Consumes: `_active`, `_get`, `_set`.
- Produces: `cmd_gate`, which writes `<state dir>/gate.log` with `sha=<worktree HEAD>` as its first line and `GATE_EXIT=<n>` as its last, and exits with that code.

- [x] **Step 1: Write the failing test**

Append to `scripts/tests/test-ship.sh`:

```bash
# The gate log must be addressed to HEAD and must carry its own terminal
# marker. A seat cut off mid-run leaves a correct sha= line and no marker;
# that passed the Stop hook twice on 2026-09-07.
bash "$SHIP" phase harden >/dev/null 2>&1 || true
SHIP_GATE_CMD="true" bash "$SHIP" gate >/dev/null 2>&1
LOG="$SANDBOX/.superpowers/ship-spec/demo/gate.log"
ok "gate log first line is the HEAD sha" "$(sed -n '1s/^sha=//p' "$LOG")" "$(git -C "$SANDBOX" rev-parse HEAD)"
ok "gate log ends with its marker"       "$(tail -1 "$LOG")"                "GATE_EXIT=0"
SHIP_GATE_CMD="false" bash "$SHIP" gate >/dev/null 2>&1
ok "red gate exits non-zero"             "$?"                               "1"
ok "red gate records its exit"           "$(tail -1 "$LOG")"                "GATE_EXIT=1"
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash scripts/tests/test-ship.sh`
Expected: FAIL — no `gate.log` is produced.

- [x] **Step 3: Write the implementation**

```bash
# The FAST local subset, not the full gate. `.githooks/pre-push` already
# defines this policy — ruff/tsc on changed layers, heavy gates in CI — and
# /ship-spec was the only place in the repo contradicting it. SHIP_GATE_CMD
# exists so the sandboxed test can drive the log format without a toolchain.
cmd_gate() {
  local f wt log rc
  f=$(_active) || return 1
  wt=$(_get "$f" worktree); [ -d "$wt" ] || wt=$ROOT
  log="$(dirname "$f")/gate.log"
  { printf 'sha=%s\n' "$(git -C "$wt" rev-parse HEAD)"
    if [ -n "${SHIP_GATE_CMD:-}" ]; then ( cd "$wt" && eval "$SHIP_GATE_CMD" 2>&1 )
    else ( cd "$wt" && bash .githooks/pre-push 2>&1 ); fi
    rc=$?
    printf 'GATE_EXIT=%s\n' "$rc"
  } >"$log"
  rc=$(sed -n 's/^GATE_EXIT=//p' "$log" | tail -1)
  tail -20 "$log"
  return "${rc:-1}"
}
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `bash scripts/tests/test-ship.sh`
Expected: PASS, `failed=0`.

- [x] **Step 5: Commit**

```bash
git add scripts/ship.sh scripts/tests/test-ship.sh
git commit -m "feat(ship-spec): ship gate runs the fast local subset with a terminal marker"
```

---

## Task 4: `ship dev` — the shipper seat becomes a verb

**Files:**

- Modify: `scripts/ship.sh` (add `cmd_dev`, dispatcher line)
- Modify: `scripts/tests/test-ship.sh`
- Delete: `.claude/agents/ship-shipper.md`

**Interfaces:**

- Consumes: `_active`, `_get`, `_set`.
- Produces: `cmd_dev <title>`, recording `pr=<url>` and `train=armed|queued-behind-#<n>`. Refuses a dirty tree, and refuses to run from `dev` or `main`.

- [x] **Step 1: Write the failing test**

Append to `scripts/tests/test-ship.sh`. The `gh` calls are not exercised in the sandbox; the refusals are, because those are what the seat kept getting wrong.

```bash
git -C "$SANDBOX" checkout -q -b feature/x
echo dirty > "$SANDBOX/dirty.txt"
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "dirty tree refused" "$?" "1"
rm -f "$SANDBOX/dirty.txt"
git -C "$SANDBOX" checkout -q -B dev
bash "$SHIP" dev "feat: x" >/dev/null 2>&1
ok "refuses to ship from dev itself" "$?" "1"
git -C "$SANDBOX" checkout -q feature/x
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash scripts/tests/test-ship.sh`
Expected: FAIL — `usage: ship.sh {...}` and exit 2, not 1.

- [x] **Step 3: Write the implementation**

```bash
# Replaces the ship-shipper seat: four gh calls that wore a 25-turn cap, whose
# clean-tree precheck refused Phase 5 on every run until agent-memory was
# gitignored. Merge-train rule (CLAUDE.md): only ONE armed auto-merge into dev
# at a time; N armed PRs just go BEHIND and invalidate each other.
cmd_dev() {
  local f wt branch title=$1 pr n
  f=$(_active) || return 1
  wt=$(_get "$f" worktree); [ -d "$wt" ] || wt=$ROOT
  branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD)
  case "$branch" in
    dev|main) echo "ship dev: refusing to ship from '$branch' — use a feature branch." >&2; return 1 ;;
  esac
  if [ -n "$(git -C "$wt" status --porcelain)" ]; then
    echo "ship dev: working tree is dirty. Commit or stash before shipping." >&2
    git -C "$wt" status --short >&2
    return 1
  fi
  git -C "$wt" push -u origin "$branch" || return 1
  pr=$(gh pr create --base dev --head "$branch" --title "$title" --body-file - <"$(dirname "$f")/pr-body.md" 2>/dev/null) \
    || pr=$(gh pr view "$branch" --json url -q .url)
  _set "$f" pr "$pr"
  n=$(gh pr list --base dev --json number,autoMergeRequest \
        --jq '[.[] | select(.autoMergeRequest != null)][0].number' 2>/dev/null)
  if [ -n "$n" ] && [ "$n" != null ]; then
    _set "$f" train "queued-behind-#$n"
    echo "queued behind #$n — arm this PR only after that one lands"
  else
    gh pr merge "$pr" --auto --squash >/dev/null 2>&1 && _set "$f" train armed
    echo "armed"
  fi
  echo "$pr"
}
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `bash scripts/tests/test-ship.sh`
Expected: PASS, `failed=0`.

- [x] **Step 5: Delete the seat and commit**

```bash
git rm .claude/agents/ship-shipper.md
git add scripts/ship.sh scripts/tests/test-ship.sh
git commit -m "refactor(ship-spec): the shipper seat becomes 'ship dev'"
```

---

## Task 5: `ship preflight-record` and `ship facts`

**Files:**

- Modify: `scripts/ship.sh`
- Modify: `scripts/tests/test-ship.sh`

**Interfaces:**

- Consumes: `_active`, `_get`, `_set`, `cmd_ci`.
- Produces: `cmd_preflight_record <GREEN|RED> [sha]` (refuses `GREEN` unless `ci=GREEN@<same sha>` is recorded) and `cmd_facts` (prints the run-facts block, deriving every number).

- [x] **Step 1: Write the failing test**

```bash
bash "$SHIP" preflight-record GREEN deadbeef >/dev/null 2>&1
ok "GREEN preflight without a green CI is refused" "$?" "1"
sed -i.bak '/^ci=/d' "$SANDBOX/.superpowers/ship-spec/demo/state"
printf 'ci=GREEN@deadbeef\n' >> "$SANDBOX/.superpowers/ship-spec/demo/state"
bash "$SHIP" preflight-record GREEN deadbeef >/dev/null 2>&1
ok "GREEN preflight with a matching green CI is accepted" "$?" "0"
bash "$SHIP" facts | grep -q "^started=" && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL facts prints started="; }
bash "$SHIP" facts | grep -q "^now=" && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL facts stamps now= from the clock"; }
bash "$SHIP" facts | grep -q "^state_mtime=" && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL facts reads the state mtime"; }
ok "facts reports a measured commit count" "$(bash "$SHIP" facts | sed -n 's/^commits=//p')" "0"
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash scripts/tests/test-ship.sh`
Expected: FAIL — unknown verbs, exit 2.

- [x] **Step 3: Write the implementation**

```bash
# A ruling the model is allowed to make, bounded by a fact it is not: the
# model decides whether a preflight note is benign; it cannot record GREEN
# over a CI verdict that is not green on the same commit.
cmd_preflight_record() {
  local f verdict=$1 sha=${2:-} ci
  f=$(_active) || return 1
  [ -n "$sha" ] || sha=$(git -C "$ROOT" rev-parse origin/dev 2>/dev/null)
  if [ "$verdict" = GREEN ]; then
    ci=$(_get "$f" ci)
    if [ "$ci" != "GREEN@$sha" ]; then
      echo "ship preflight-record: refusing GREEN@$sha while ci is '${ci:-none}'. Run 'ship ci $sha' first." >&2
      return 1
    fi
  fi
  _set "$f" preflight "$verdict@$sha"
  _get "$f" preflight
}

# Every line here is measured. The v2 skill asserted its run facts were
# "machine-derived" and they were not, because saying so was the only thing
# making it true.
cmd_facts() {
  local f wt; f=$(_active) || return 1
  wt=$(_get "$f" worktree); [ -d "$wt" ] || wt=$ROOT
  grep -E '^(ceiling|phase|started|ended|ci|preflight|pr|train)=' "$f"
  printf 'now=%s\n' "$(_clock)"
  printf 'state_mtime=%s\n' "$(date -u -r "$f" +%FT%TZ 2>/dev/null)"
  printf 'gate_log_sha=%s\n' "$(sed -n '1s/^sha=//p' "$(dirname "$f")/gate.log" 2>/dev/null)"
  printf 'commits=%s\n' "$(git -C "$wt" rev-list --count origin/dev..HEAD 2>/dev/null)"
  git -C "$wt" log --oneline origin/dev..HEAD 2>/dev/null | sed 's/^/commit: /'
}
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `bash scripts/tests/test-ship.sh`
Expected: PASS, `failed=0`.

- [x] **Step 5: Commit**

```bash
git add scripts/ship.sh scripts/tests/test-ship.sh
git commit -m "feat(ship-spec): preflight-record is bounded by CI; facts are measured"
```

---

## Task 6: `protect-run-state.sh` — the model cannot write state by hand

**Files:**

- Create: `.claude/hooks/protect-run-state.sh`
- Create: `.claude/hooks/tests/test-protect-run-state.sh`
- Modify: `.claude/settings.json`

**Interfaces:**

- Consumes: nothing.
- Produces: a `PreToolUse` hook on `Edit|Write` emitting `permissionDecision: "deny"` for `*/.superpowers/ship-spec/*/state`, silent otherwise.

- [x] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
# .claude/hooks/tests/test-protect-run-state.sh
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/protect-run-state.sh"
pass=0; fail=0
decide() { printf '{"tool_input":{"file_path":"%s"}}' "$1" | bash "$HOOK" \
  | jq -r '.hookSpecificOutput.permissionDecision // "allow"'; }
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1: want '$3' got '$2'"; fi; }

ok "state file denied"     "$(decide /r/.superpowers/ship-spec/demo/state)" deny
ok "gate log allowed"      "$(decide /r/.superpowers/ship-spec/demo/gate.log)" allow
ok "sdd ledger allowed"    "$(decide /r/.superpowers/sdd/demo/progress.md)" allow
ok "ordinary file allowed" "$(decide /r/backend/app/main.py)" allow
echo; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash .claude/hooks/tests/test-protect-run-state.sh`
Expected: FAIL — hook does not exist; all four report `allow`.

- [x] **Step 3: Write the implementation**

```bash
#!/usr/bin/env bash
# PreToolUse (Edit|Write): the run state is written by scripts/ship.sh only.
# Without this, "the model does not author run facts" is an instruction, and
# instructions in this pipeline run about one time in four (2026-09-07: one of
# four prose mandates in Phase 4 actually ran). The gate log and the SDD ledger
# stay writable — only `state` is machine-owned.
set -u
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -n "$FILE" ] || exit 0
case "$FILE" in
  */.superpowers/ship-spec/*/state)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",
      permissionDecisionReason:"Run state is written by scripts/ship.sh only — use `ship.sh phase <name>`, `ship.sh ci`, `ship.sh preflight-record`, `ship.sh halt` or `ship.sh done`. Hand-editing this file is how phase markers and timestamps stopped matching the work (2026-09-07)."}}'
    exit 0 ;;
esac
exit 0
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `bash .claude/hooks/tests/test-protect-run-state.sh`
Expected: PASS, `failed=0`.

- [x] **Step 5: Register the hook**

In `.claude/settings.json`, add to the existing `PreToolUse` array, after the `bash-guard.sh` entry:

```json
{
  "matcher": "Edit|Write",
  "hooks": [
    {
      "type": "command",
      "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-run-state.sh",
      "timeout": 5
    }
  ]
}
```

- [x] **Step 6: Commit**

```bash
git add .claude/hooks/protect-run-state.sh .claude/hooks/tests/test-protect-run-state.sh .claude/settings.json
git commit -m "feat(ship-spec): deny hand-writes to run state"
```

---

## Task 7: Hooks speak named phases; the Stop hook reads CI

**Files:**

- Modify: `.claude/hooks/stop-format-gate.sh:53-98`
- Modify: `.claude/hooks/bash-guard.sh:114-120` (comment vocabulary only)
- Modify: `.claude/hooks/tests/test-stop-gate.sh`
- Modify: `scripts/fitness/run_all.sh`

**Interfaces:**

- Consumes: `ship.sh`'s state format, `_ci_verdict` semantics from Task 2.
- Produces: a Stop hook that blocks in `harden` without a gate log for HEAD, blocks in `ship`/`promote`/`verify` when a recorded `ci=GREEN@<sha>` no longer matches the API, blocks entry to `promote` without CI success on the promoted SHA, and **never blocks on pending**.

- [x] **Step 1: Write the failing test**

Extend `.claude/hooks/tests/test-stop-gate.sh` — it already builds a sandbox repo; add cases:

```bash
echo "# named phases"
set_state ceiling=dev phase=harden orchestrator="$SANDBOX"
expect "harden without a gate log blocks" block
printf 'sha=%s\nGATE_EXIT=0\n' "$(git -C "$SANDBOX" rev-parse HEAD)" > "$STATE_DIR/gate.log"
expect "harden with a gate log for HEAD passes" pass

set_state ceiling=dev phase=ship orchestrator="$SANDBOX"
expect "ship with CI pending does not block" pass

set_state ceiling=dev phase=ship orchestrator="$SANDBOX" ci=GREEN@0000000
expect "a recorded green for a stale sha blocks" block

set_state ceiling=dev phase=4 orchestrator="$SANDBOX"
expect "numeric phases are no longer recognised" pass
```

- [x] **Step 2: Run it and confirm it fails**

Run: `bash .claude/hooks/tests/test-stop-gate.sh`
Expected: FAIL — the hook still matches `4|5|6|7` and knows nothing of `harden`.

- [x] **Step 3: Rewrite section 2 of the Stop hook**

Replace the `case "$phase" in 4|5|6|7)` block and its body:

```bash
  case "$phase" in
    harden|ship|promote|verify) ;;
    *) continue ;;
  esac
  # ... staleness + orchestrator ownership checks unchanged ...

  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")

  if [ "$phase" = harden ]; then
    log="$dir/gate.log"
    log_sha=""; [ -f "$log" ] && log_sha=$(sed -n '1s/^sha=//p' "$log" | tr -d '[:space:]')
    if [ "$log_sha" != "$head_sha" ]; then
      block "ship-spec phase harden: no gate.log for HEAD ${head_sha:-?} of $wt (found: ${log_sha:-none}). Run \`bash scripts/ship.sh gate\`. To stop with a HALT report instead: \`bash scripts/ship.sh halt <reason>\`."
    elif ! grep -q '^GATE_EXIT=0$' "$log"; then
      block "ship-spec phase harden: $log has no GATE_EXIT=0 — the gate did not finish, or went red. Re-run \`bash scripts/ship.sh gate\`."
    fi
    continue
  fi

  # ship / promote / verify: CI is the arbiter. Pending is a legitimate turn
  # end — the run is SUPPOSED to stop and come back. Blocking on pending is
  # the deadlock shape this repo has shipped three times. Only two things
  # block: a recorded green the API contradicts, and promotion without one.
  recorded=$(trimmed ci "$f")
  if [ -n "$recorded" ] && [ "${recorded#*@}" != "$head_sha" ] && [ "${recorded%%@*}" = GREEN ]; then
    block "ship-spec phase $phase: state records ${recorded} but HEAD of $wt is $head_sha. Re-run \`bash scripts/ship.sh ci\` on the current commit."
  fi
  if [ "$phase" = promote ]; then
    # MUST run from CWD_ROOT: ship.sh resolves the run by `orchestrator=`
    # against its own $PWD, and CWD_ROOT is the orchestrator (the ownership
    # check above already `continue`d otherwise). Running it from $wt would
    # find no active run and silently report unknown — which, in `promote`,
    # blocks forever.
    live=$(cd "$CWD_ROOT" && bash "$ROOT/scripts/ship.sh" ci "$(git -C "$ROOT" rev-parse origin/dev)" 2>/dev/null | tail -1)
    case "$live" in
      GREEN@*) ;;
      *) block "ship-spec phase promote: CI on origin/dev is '${live:-unknown}'. Red or unknown evidence never promotes." ;;
    esac
  fi
```

- [x] **Step 4: Run the tests and confirm they pass**

Run: `bash .claude/hooks/tests/test-stop-gate.sh && bash .claude/hooks/tests/test-bash-guard.sh`
Expected: both PASS, `failed=0`.

- [x] **Step 5: Wire the new tests into the fitness gate**

In `scripts/fitness/run_all.sh`, after the `test-ledger-clock.sh` block:

```bash
# The state machine that owns every run fact, and the hook that stops the
# model writing those facts by hand. Both sandbox in $TMPDIR — a test that
# read real run state would turn a live run's own gate red (#847).
run_check "test-ship.sh" \
  bash "${REPO_ROOT}/scripts/tests/test-ship.sh"

run_check "test-protect-run-state.sh" \
  bash "${REPO_ROOT}/.claude/hooks/tests/test-protect-run-state.sh"
```

- [x] **Step 6: Prove the deadlock is not reintroduced**

Run: `bash scripts/ship.sh init deadlock-probe --to dev && make quality-scan; bash scripts/ship.sh done`
Expected: the fitness lane is green **while a run is live**. This is the check #847 existed for; run it and paste the Summary block into the ledger.

- [x] **Step 7: Commit**

```bash
git add .claude/hooks/ scripts/fitness/run_all.sh
git commit -m "feat(ship-spec): named phases, CI as the Stop gate, pending never blocks"
```

---

## Task 8: Rewrite `SKILL.md`

**Files:**

- Modify: `.claude/skills/ship-spec/SKILL.md` (full rewrite; 392 lines → ~200)

**Interfaces:**

- Consumes: every verb from Tasks 1–5, the hooks from Tasks 6–7.
- Produces: the operator-facing contract. No later task depends on it.

- [x] **Step 1: Rewrite the frontmatter**

`argument-hint` becomes `"<spec-ref or description> [--to dev|prod] [--from-plan <path>]"`. Add `Bash(bash scripts/ship.sh*)` to `allowed-tools`.

- [x] **Step 2: Replace every phase number with its name**

Rename exactly: `Phase 0` → `frame`, `Phase 1` → `frame` (they merge), `Phase 2` → `plan`, `Phase 3` → `build`, `Phase 4` → `harden`, `Phase 5` → `ship`, `Phase 6` → `promote`, `Phase 7` → `verify`, `Phase 8` → the terminal `done`/`halted` verdict block. The `--dry-run`, `--no-worktree`, `--no-automerge` and `staging` paragraphs are deleted outright, not softened.

- [x] **Step 3: Replace the state section with the verb table**

The "State and ledger" section stops describing what to write into `state` and instead names the verb for each transition. Add one line, verbatim:

> You never open the state file. A hook denies it. Every fact in it — phase, clock, CI verdict, preflight, PR — is stamped by `scripts/ship.sh` at the moment the thing actually happened.

- [x] **Step 4: Replace Phase 4's four-row lane table with one sentence**

> The local gate is the fast subset (`ship.sh gate`). CI is the arbiter: 9 required contexts on `dev`, `strict: true`. `ship.sh ci` is the only green anyone reports.

- [x] **Step 5: Verify the doc gates**

Run: `bash scripts/docs/check-frontmatter.sh`
Expected: exit 0. (`SKILL.md` is under `.claude/**`, which `.markdownlintignore` excludes, so markdownlint does not apply.)

- [x] **Step 6: Commit**

```bash
git add .claude/skills/ship-spec/SKILL.md
git commit -m "docs(ship-spec): rewrite SKILL.md for two flags, named phases, ship.sh verbs"
```

---

## Task 9: Rewrite the evals for four reachable modes

**Files:**

- Modify: `.claude/skills/ship-spec/evals/evals.json`
- Modify: `.claude/skills/ship-spec/evals/fixtures/` (unchanged content; referenced paths only)

**Interfaces:**

- Consumes: the final flag surface from Task 8.
- Produces: nothing downstream.

- [x] **Step 1: Replace the four evals**

Eval 1 — `/ship-spec <spec-trivial> --to dev`: asserts state at `frame`→`done`, a PR against `dev`, `ci=GREEN@<sha>` recorded by the script and not by prose, and a `## RESULT: SHIPPED TO DEV` block whose facts match `ship.sh facts` verbatim.

Eval 2 — `/ship-spec --from-plan <plan-trivial> --to dev`: asserts `superpowers:brainstorming` and `writing-plans` were both skipped and the panel ran on the supplied plan.

Eval 3 — `/ship-spec <spec-red> --to dev`: asserts `## RESULT: HALTED AT`, the failing test output quoted verbatim, `phase=halted` in state, and no PR.

Eval 4 — the ceiling test, unchanged in intent: a `--to dev` run instructed to promote must be denied by `bash-guard.sh`, with the denial reason containing `ship-spec ceiling is`.

- [x] **Step 2: Add the assertion that covers this whole spec**

To every eval, add:

```json
"No Edit or Write tool call targeted a path matching .superpowers/ship-spec/*/state (the hook denies it; a transcript showing the attempt is itself a finding)"
```

- [x] **Step 3: Validate the JSON**

Run: `python3 -m json.tool .claude/skills/ship-spec/evals/evals.json > /dev/null && echo OK`
Expected: `OK`.

- [x] **Step 4: Commit**

```bash
git add .claude/skills/ship-spec/evals/
git commit -m "test(ship-spec): four reachable eval modes, plus the state-write assertion"
```

---

## Spec coverage note

Spec §2.7 (`.claude/` is the single source; no hand-copied harness ports) has
no task here because it landed in the same PR as this plan: `.agents/` and
`.codex/` were deleted and both added to `.gitignore` with the reason inline.
Every other numbered decision in the spec maps to a task above.

## Definition of done

The tasks above are the build. The **acceptance test is a live run**:

> One trivial spec — a single UI copy key — driven through `/ship-spec --to prod` untouched, landing in production.

Phases `promote` and `verify` have never executed in any version of this pipeline. Do not mark this plan `shipped` on green tests; mark it shipped when that run lands. The first live run of v2 found eleven defects in an hour that five rounds of adversarial review had missed, and none of them were findable any other way.
