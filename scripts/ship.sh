#!/usr/bin/env bash
# scripts/ship.sh — the ONLY writer of /ship-spec run state.
#
# The model calls verbs; it never opens the state file (a PreToolUse hook
# denies that). Every fact in `state` is stamped here, at the moment the verb
# runs, so a phase marker cannot lead the work and a timestamp cannot be
# authored. On 2026-09-07 a live run wrote 8+ ledger timestamps up to 43
# minutes ahead of the wall clock and set phase=3 twenty-seven minutes before
# the first code commit; none of that is reachable from here.
#
# Design: docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md
# Tests:  scripts/tests/test-ship.sh (sandboxed in $TMPDIR — a test that read
#         real run state would turn a live run's own gate red, see #847)
set -uo pipefail

_root() { local c; if c=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then dirname "$c"; else pwd; fi; }
ROOT=$(_root)
BASE="$ROOT/.superpowers/ship-spec"

_clock() { date -u +%FT%TZ; }
_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1 | tr -d '[:space:]'; }
_set() {
  local f=$1 k=$2 v=$3 t
  t=$(mktemp)
  grep -v "^$k=" "$f" >"$t" 2>/dev/null
  printf '%s=%s\n' "$k" "$v" >>"$t"
  mv "$t" "$f"
}

# The run this checkout owns. Same predicate as the hooks: `orchestrator=`,
# never `worktree=`, and never "the first live state found". Shared
# visibility is not ownership — that confusion shipped three times (#847 x2,
# #850), each time making one run's ceiling bind every session in the repo.
# `done` is terminal; `halted` is STOPPED BUT RESUMABLE, so a halted run stays
# discoverable here — otherwise `ship phase <n>` could never restart one, which
# the v2 skill documents as supported. It also means `init` correctly refuses
# while a halted run is open: end it with `done` or resume it, never leave two.
# The hooks use their own predicate and skip halted, because a halted run must
# not gate a turn end — that is how a HALT report gets to end its turn.
_active() {
  local f n=0 found=""
  for f in "$BASE"/*/state; do
    [ -f "$f" ] || continue
    case "$(_get "$f" phase)" in done) continue ;; esac
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
  local name=${1:-}; shift 2>/dev/null || true
  [ -n "$name" ] || { echo "usage: ship.sh init <basename> --to <dev|prod> [--worktree <path>]" >&2; return 2; }
  local ceiling=dev worktree=$PWD
  while [ $# -gt 0 ]; do
    case $1 in
      --to) ceiling=${2:-}; shift 2 ;;
      --worktree) worktree=${2:-}; shift 2 ;;
      *) echo "ship init: unknown argument '$1'" >&2; return 2 ;;
    esac
  done
  case "$ceiling" in
    dev|prod) ;;
    *) echo "ship init: --to must be dev or prod (got '${ceiling}'). The staging rung was deleted in v3." >&2; return 2 ;;
  esac
  # Re-running init for the SAME basename from the same checkout UPDATES the
  # run — that is how you attach a worktree you created after init, and how a
  # resumed session repairs a path. A DIFFERENT basename still refuses: two
  # live runs owned by one checkout is the ambiguity the hooks deny.
  local live; live=$(_active 2>/dev/null)
  if [ -n "$live" ] && [ "$live" != "$BASE/$name/state" ]; then
    echo "ship init: a live run already names $PWD as orchestrator ($live). End it with 'ship done' or 'ship halt <reason>'." >&2
    return 1
  fi
  local f="$BASE/$name/state"
  mkdir -p "$BASE/$name"
  if [ -n "$live" ]; then
    _set "$f" ceiling "$ceiling"
    _set "$f" worktree "$worktree"
    cat "$f"
    return 0
  fi
  : >"$f"
  _set "$f" ceiling "$ceiling"
  _set "$f" phase frame
  _set "$f" worktree "$worktree"
  _set "$f" orchestrator "$PWD"
  _set "$f" started "$(_clock)"
  _set "$f" frame_at "$(_clock)"
  cat "$f"
}

cmd_phase() {
  local to=${1:-} f cur
  [ -n "$to" ] || { echo "usage: ship.sh phase <frame|plan|build|harden|ship|promote|verify>" >&2; return 2; }
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
  # Entering `promote` needs the evidence that promotion itself requires, so
  # the error lands at the phase boundary rather than at the gh command.
  # bash-guard.sh enforces the same rule on `gh pr create --base main`; this is
  # the earlier, cheaper copy of it, not a replacement.
  if [ "$to" = promote ]; then
    local pf want
    pf=$(_get "$f" preflight)
    want="GREEN@$(git -C "$ROOT" rev-parse origin/dev 2>/dev/null)"
    if [ "$pf" != "$want" ]; then
      echo "ship phase: promote needs preflight=$want (found '${pf:-none}'). Run /preflight and record it with 'ship.sh preflight-record GREEN'." >&2
      return 1
    fi
  fi
  _set "$f" phase "$to"
  _set "$f" "${to}_at" "$(_clock)"
  cat "$f"
}

cmd_halt() {
  local f; f=$(_active) || return 1
  _set "$f" reason "${1:-unspecified}"
  _set "$f" ended "$(_clock)"
  _set "$f" phase halted
  cat "$f"
}

cmd_done() {
  local f; f=$(_active) || return 1
  _set "$f" ended "$(_clock)"
  _set "$f" phase done
  cat "$f"
}


# Pure verdict function: $1 = required contexts (newline separated),
# $2 = check-runs as name<TAB>status<TAB>conclusion lines.
#
# GREEN iff every required context completed successfully AND nothing on the
# SHA hard-failed. Three rules, each from an observed defect:
#   * `skipped` is not a failure (Supabase Preview is skipped on every run).
#   * a NON-required failure is still RED — markdownlint is not a required
#     context and produced the only red of the first prod run.
#   * a required context that is absent or not `completed` is PENDING, never
#     RED. Waiting is not evidence, and a gate that calls pending red
#     deadlocks on its own CI.
# A failure that already happened outranks anything still pending.
#
# The while loop reads a heredoc, NOT a pipe: a pipe would run it in a
# subshell and `pending` would not survive.
_ci_verdict() {
  local required=$1 runs=$2 bad line st cc ctx pending=0
  bad=$(printf '%s\n' "$runs" | awk -F'\t' '$3=="failure"||$3=="timed_out"||$3=="cancelled"||$3=="action_required"{print $1}')
  while IFS= read -r ctx; do
    [ -n "$ctx" ] || continue
    line=$(printf '%s\n' "$runs" | awk -F'\t' -v n="$ctx" '$1==n{print;exit}')
    if [ -z "$line" ]; then pending=1; continue; fi
    st=$(printf '%s' "$line" | cut -f2)
    cc=$(printf '%s' "$line" | cut -f3)
    if [ "$st" != completed ]; then pending=1
    elif [ "$cc" != success ] && [ "$cc" != skipped ]; then bad=$(printf '%s\n%s' "$bad" "$ctx"); fi
  done <<EOF
$required
EOF
  bad=$(printf '%s\n' "$bad" | grep -v '^$' | sort -u | paste -sd, -)
  if [ -n "$bad" ]; then echo "RED:$bad"
  elif [ "$pending" = 1 ]; then echo PENDING
  else echo GREEN; fi
}

cmd_ci() {
  local f sha repo runs required verdict kind rest=""
  f=$(_active) || return 1
  sha=${1:-$(git -C "$(_get "$f" worktree)" rev-parse HEAD 2>/dev/null)}
  # Key on gh's EXIT STATUS, never on whether its output is empty. On an HTTP
  # error gh writes the error JSON to STDOUT, so a 404/422/500 arrives as ~200
  # non-empty bytes; the emptiness check accepted it, _ci_verdict parsed it as
  # check data, matched no required context, and reported PENDING. A dead API
  # then looks exactly like "CI is still running" and a run waits forever for a
  # green that cannot arrive. Found 2026-09-08 by running this against a bogus
  # SHA — the one check the offline suite cannot make.
  #
  # gh exiting 0 with NO output is different and legitimate: a real commit that
  # has no check-runs yet. That is PENDING, and _ci_verdict says so.
  if ! repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || [ -z "$repo" ]; then
    _set "$f" ci "UNKNOWN@$sha"; echo "UNKNOWN@$sha"; return 1
  fi
  if ! runs=$(gh api "repos/$repo/commits/$sha/check-runs" --paginate \
                --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv' 2>/dev/null); then
    _set "$f" ci "UNKNOWN@$sha"; echo "UNKNOWN@$sha"; return 1
  fi
  if ! required=$(gh api "repos/$repo/branches/dev/protection" \
                    --jq '.required_status_checks.contexts[]' 2>/dev/null); then
    _set "$f" ci "UNKNOWN@$sha"; echo "UNKNOWN@$sha"; return 1
  fi
  verdict=$(_ci_verdict "$required" "$runs")
  kind=${verdict%%:*}
  case "$verdict" in *:*) rest=":${verdict#*:}" ;; esac
  _set "$f" ci "$kind@$sha$rest"
  printf '%s@%s%s\n' "$kind" "$sha" "$rest"
}

# The FAST local subset, not the full gate. `.githooks/pre-push` already
# defines this policy in its own header — ruff/tsc on the layers that changed,
# heavy gates in CI — and /ship-spec was the only place in the repo
# contradicting it. Moving the arbiter to CI also retires three friction
# classes the first prod run paid for: a leftover fixture on the SHARED local
# Supabase, the markdownlint blind spot, and re-gating a four-minute scan on
# every docs commit.
#
# The log carries a terminal GATE_EXIT marker because a truncated log with a
# correct sha= first line passed the Stop hook twice on 2026-09-07. A consumer
# treats a missing marker as failure.
#
# SHIP_GATE_CMD exists so the sandboxed test can drive the log format without
# a toolchain; it is not a production escape hatch.
cmd_gate() {
  local f wt log rc
  f=$(_active) || return 1
  wt=$(_get "$f" worktree); [ -d "$wt" ] || wt=$ROOT
  log="$(dirname "$f")/gate.log"
  {
    printf 'sha=%s\n' "$(git -C "$wt" rev-parse HEAD)"
    if [ -n "${SHIP_GATE_CMD:-}" ]; then
      ( cd "$wt" && eval "$SHIP_GATE_CMD" 2>&1 )
    else
      ( cd "$wt" && bash .githooks/pre-push 2>&1 )
    fi
    rc=$?
    printf 'GATE_EXIT=%s\n' "$rc"
  } >"$log"
  rc=$(sed -n 's/^GATE_EXIT=//p' "$log" | tail -1)
  tail -20 "$log"
  return "${rc:-1}"
}

# Replaces the ship-shipper seat: four gh calls that wore a 25-turn cap, and
# whose clean-tree precheck refused Phase 5 on every run until
# .claude/agent-memory/ was gitignored.
#
# Merge-train rule (CLAUDE.md): only ONE armed auto-merge into dev at a time.
# `dev` is strict/up-to-date, so N armed PRs just go BEHIND and invalidate each
# other. Precheck the train; queue rather than arm when it is occupied.
cmd_dev() {
  local f wt branch title=${1:-} body=${2:-} pr n
  [ -n "$title" ] || { echo "usage: ship.sh dev <pr-title> [body-file]" >&2; return 2; }
  f=$(_active) || return 1
  wt=$(_get "$f" worktree); [ -d "$wt" ] || wt=$ROOT
  branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD)
  case "$branch" in
    dev|main) echo "ship dev: refusing to ship from '$branch' — PRs come from a feature branch." >&2; return 1 ;;
  esac
  if [ -n "$(git -C "$wt" status --porcelain)" ]; then
    echo "ship dev: working tree is dirty. Commit or stash first." >&2
    git -C "$wt" status --short >&2
    return 1
  fi
  git -C "$wt" push -u origin "$branch" || return 1
  if [ -n "$body" ] && [ -f "$body" ]; then
    pr=$(gh pr create --base dev --head "$branch" --title "$title" --body-file "$body" 2>/dev/null)
  else
    pr=$(gh pr create --base dev --head "$branch" --title "$title" --body "See the plan and the ledger for this run." 2>/dev/null)
  fi
  [ -n "$pr" ] || pr=$(gh pr view "$branch" --json url -q .url 2>/dev/null)
  [ -n "$pr" ] || { echo "ship dev: pushed, but could not create or find the PR." >&2; return 1; }
  _set "$f" pr "$pr"
  n=$(gh pr list --base dev --json number,autoMergeRequest \
        --jq '[.[] | select(.autoMergeRequest != null)][0].number' 2>/dev/null)
  if [ -n "$n" ] && [ "$n" != null ]; then
    _set "$f" train "queued-behind-#$n"
    echo "queued behind #$n — arm this PR only after that one lands"
  else
    if gh pr merge "$pr" --auto --squash >/dev/null 2>&1; then
      _set "$f" train armed
      echo "armed"
    else
      _set "$f" train "open-unarmed"
      echo "open, not armed (arming failed)"
    fi
  fi
  echo "$pr"
}

# A ruling the model IS allowed to make, bounded by a fact it is not: the model
# decides whether a preflight note is benign (a `local-tests` WARN it can
# attribute to the shared local stack, say). It cannot record GREEN over a CI
# verdict that is not green on the same commit. RED needs no evidence — you may
# always report worse than the machine can prove.
cmd_preflight_record() {
  local f verdict=${1:-} sha=${2:-} ci
  case "$verdict" in
    GREEN|RED) ;;
    *) echo "usage: ship.sh preflight-record <GREEN|RED> [sha]" >&2; return 2 ;;
  esac
  f=$(_active) || return 1
  [ -n "$sha" ] || sha=$(git -C "$ROOT" rev-parse origin/dev 2>/dev/null)
  if [ "$verdict" = GREEN ]; then
    ci=$(_get "$f" ci)
    if [ "$ci" != "GREEN@$sha" ]; then
      echo "ship preflight-record: refusing GREEN@$sha while ci is '${ci:-none}'. Run 'ship ci $sha' first; red or unknown evidence never promotes." >&2
      return 1
    fi
  fi
  _set "$f" preflight "$verdict@$sha"
  _get "$f" preflight
}

# Every line here is MEASURED. The v2 skill asserted its run facts were "every
# one machine-derived" and they were not — saying so was the only thing making
# it true, and 8+ of them were up to 43 minutes wrong. Paste this; never retype
# it.
cmd_facts() {
  local f wt; f=$(_active) || return 1
  wt=$(_get "$f" worktree); [ -d "$wt" ] || wt=$ROOT
  grep -E '^(ceiling|phase|started|ended|ci|preflight|pr|train|reason)=' "$f"
  printf 'now=%s\n' "$(_clock)"
  printf 'state_mtime=%s\n' "$(date -u -r "$f" +%FT%TZ 2>/dev/null)"
  printf 'gate_log_sha=%s\n' "$(sed -n '1s/^sha=//p' "$(dirname "$f")/gate.log" 2>/dev/null)"
  printf 'gate_log_exit=%s\n' "$(sed -n 's/^GATE_EXIT=//p' "$(dirname "$f")/gate.log" 2>/dev/null | tail -1)"
  printf 'commits=%s\n' "$(git -C "$wt" rev-list --count origin/dev..HEAD 2>/dev/null || echo 0)"
  git -C "$wt" log --oneline origin/dev..HEAD 2>/dev/null | sed 's/^/commit: /'
}

# Let the test source this file for its pure functions without running a verb.
if [ "${1:-}" = "--source-only" ]; then return 0 2>/dev/null || exit 0; fi

case ${1:-} in
  init)  shift; cmd_init "$@" ;;
  ci)    shift; cmd_ci "$@" ;;
  gate)  shift; cmd_gate "$@" ;;
  dev)   shift; cmd_dev "$@" ;;
  preflight-record) shift; cmd_preflight_record "$@" ;;
  facts) shift; cmd_facts "$@" ;;
  phase) shift; cmd_phase "$@" ;;
  halt)  shift; cmd_halt "$@" ;;
  done)  shift; cmd_done "$@" ;;
  *) echo "usage: ship.sh {init|phase|gate|ci|dev|preflight-record|facts|halt|done}" >&2; exit 2 ;;
esac
