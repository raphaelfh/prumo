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
  # Temp file beside the state: same filesystem, so the mv is atomic, and no
  # reliance on a writable $TMPDIR (a bare mktemp failed under the Claude Code
  # sandbox and every write then went to "" and was lost).
  t=$(mktemp "$f.XXXXXX") || { echo "ship: cannot write $f" >&2; return 1; }
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
_owned() { # live runs this checkout owns, one state path per line
  local f
  for f in "$BASE"/*/state; do
    [ -f "$f" ] || continue
    case "$(_get "$f" phase)" in done) continue ;; esac
    [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ] && continue
    [ "$(_get "$f" orchestrator)" = "$PWD" ] || continue
    printf '%s\n' "$f"
  done
}

# A multi-slice spec owns one live run per slice of the current wave, so a
# checkout may own several — all of ONE spec (`slice` refuses otherwise). Then
# `--run <basename>` picks one; a verb never guesses between slices.
_active() {
  local all n
  all=$(_owned)
  if [ -n "${SHIP_RUN:-}" ]; then
    if printf '%s\n' "$all" | grep -qxF "$BASE/$SHIP_RUN/state"; then
      printf '%s\n' "$BASE/$SHIP_RUN/state"; return 0
    fi
    echo "ship: --run $SHIP_RUN is not a live run owned by $PWD" >&2
    return 1
  fi
  n=$(printf '%s' "$all" | grep -c .)
  if [ "$n" -ne 1 ]; then
    echo "ship: expected exactly one active run owned by $PWD, found $n" >&2
    [ "$n" -gt 1 ] && printf '%s\n' "$all" | sed "s|^$BASE/||; s|/state\$||; s|^|  pick one: ship.sh --run |" >&2
    return 1
  fi
  printf '%s\n' "$all"
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
  [ -n "$name" ] || { echo "usage: ship.sh init <basename> --to <dev|prod> [--worktree <path> | --slices 'S1 | S2,S3']" >&2; return 2; }
  local ceiling=dev worktree=$PWD slices=""
  while [ $# -gt 0 ]; do
    case $1 in
      --to) ceiling=${2:-}; shift 2 ;;
      --worktree) worktree=${2:-}; shift 2 ;;
      --slices) slices=${2:-}; shift 2 ;;
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
  local live other
  other=$(_owned | grep -vxF "$BASE/$name/state" | head -1)
  if [ -n "$other" ]; then
    echo "ship init: a live run already names $PWD as orchestrator ($other). End it with 'ship done' or 'ship halt <reason>'." >&2
    return 1
  fi
  if [ -n "$slices" ]; then _init_manifest "$name" "$ceiling" "$slices"; return; fi
  live=$(_owned | grep -xF "$BASE/$name/state")
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

# --- multi-slice specs -------------------------------------------------------
# The manifest is the dependency order, as WAVES: `S1 | S2,S3 | S4`. Slices in
# one wave are independent and build concurrently, each in its own worktree
# and run; a wave starts only when every slice before it has LANDED on dev. A
# slice run is an ordinary run named <spec>-<slice>, so the hooks gate each one
# as they gate any run. `manifest` is not a `state`: no hook reads it as a run.
_init_manifest() {
  local name=$1 ceiling=$2 spec=$3 m="$BASE/$1/manifest" wave s n=0 seen=" " lines=""
  local -a waves
  if [ -e "$BASE/$name/state" ]; then
    echo "ship init: $name is already a single-slice run." >&2; return 1
  fi
  IFS='|' read -ra waves <<<"$spec"
  for wave in "${waves[@]}"; do
    wave=$(printf '%s' "$wave" | tr -d '[:space:]')
    n=$((n + 1))
    [ -n "$wave" ] || { echo "ship init: wave $n is empty in '$spec'." >&2; return 2; }
    # Whole-wave check BEFORE the split: no glob character survives into the
    # unquoted loop, and `S2,` (an empty slice) is refused.
    printf '%s' "$wave" | grep -Eqx '[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*' \
      || { echo "ship init: bad wave '$wave' (slice names: letters, digits, . _ -; comma-separated)." >&2; return 2; }
    for s in ${wave//,/ }; do
      case "$seen" in *" $s "*) echo "ship init: slice '$s' is named twice." >&2; return 2 ;; esac
      seen="$seen$s "
    done
    lines="${lines}wave$n=$wave
"
  done
  mkdir -p "$BASE/$name"
  printf 'ceiling=%s\norchestrator=%s\nstarted=%s\n%s' "$ceiling" "$PWD" "$(_clock)" "$lines" >"$m"
  cat "$m"
}

# Slice names of a manifest in order; with $2, only those of earlier waves.
_manifest_slices() {
  local w list
  sed -n 's/^wave\([0-9]*\)=/\1 /p' "$1" | while read -r w list; do
    [ -n "${2:-}" ] && [ "$w" -ge "$2" ] && continue
    printf '%s\n' "$list" | tr ',' '\n'
  done
}
_wave_of() {
  local w list
  sed -n 's/^wave\([0-9]*\)=/\1 /p' "$1" | while read -r w list; do
    case ",$list," in *",$2,"*) echo "$w"; break ;; esac
  done
}

cmd_slice() {
  local spec=${1:-} sl=${2:-} worktree=$PWD m w x f other
  [ -n "$spec" ] && [ -n "$sl" ] || { echo "usage: ship.sh slice <spec> <slice> --worktree <path>" >&2; return 2; }
  shift 2
  while [ $# -gt 0 ]; do
    case $1 in
      --worktree) worktree=${2:-}; shift 2 ;;
      *) echo "ship slice: unknown argument '$1'" >&2; return 2 ;;
    esac
  done
  m="$BASE/$spec/manifest"
  [ -f "$m" ] || { echo "ship slice: no manifest for '$spec' (ship.sh init $spec --to <dev|prod> --slices ...)." >&2; return 1; }
  [ "$(_get "$m" orchestrator)" = "$PWD" ] || { echo "ship slice: $spec is orchestrated from $(_get "$m" orchestrator), not $PWD." >&2; return 1; }
  w=$(_wave_of "$m" "$sl")
  [ -n "$w" ] || { echo "ship slice: '$sl' is not in the $spec manifest ($(_manifest_slices "$m" | paste -sd' ' -))." >&2; return 1; }
  for x in $(_manifest_slices "$m" "$w"); do
    if [ "$(_get "$BASE/$spec-$x/state" phase)" != done ]; then
      echo "ship slice: $sl is in wave $w; $x (an earlier wave) has not landed on dev." >&2
      return 1
    fi
  done
  other=$(_owned | while read -r x; do [ "$(_get "$x" spec)" = "$spec" ] || echo "$x"; done | head -1)
  if [ -n "$other" ]; then
    echo "ship slice: $PWD already orchestrates a run outside $spec ($other)." >&2; return 1
  fi
  f="$BASE/$spec-$sl/state"
  touch "$m"   # keeps the manifest inside the hooks' 24h freshness window
  if [ -f "$f" ] && [ "$(_get "$f" phase)" != done ]; then
    _set "$f" worktree "$worktree"; cat "$f"; return 0
  fi
  mkdir -p "$(dirname "$f")"
  : >"$f"
  _set "$f" ceiling "$(_get "$m" ceiling)"
  _set "$f" phase plan
  _set "$f" worktree "$worktree"
  _set "$f" orchestrator "$PWD"
  _set "$f" spec "$spec"
  _set "$f" started "$(_clock)"
  _set "$f" plan_at "$(_clock)"
  cat "$f"
}

# Read-only: one line per slice, so the orchestrator sees the whole queue
# without opening a state file.
cmd_status() {
  local spec=${1:-} m x f
  m="$BASE/$spec/manifest"
  [ -f "$m" ] || { echo "usage: ship.sh status <spec> (no manifest for '$spec')" >&2; return 2; }
  echo "ceiling=$(_get "$m" ceiling)"
  for x in $(_manifest_slices "$m"); do
    f="$BASE/$spec-$x/state"
    if [ -f "$f" ]; then
      printf '%s wave=%s phase=%s pr=%s ci=%s train=%s\n' "$x" "$(_wave_of "$m" "$x")" \
        "$(_get "$f" phase)" "$(_get "$f" pr)" "$(_get "$f" ci)" "$(_get "$f" train)"
    else
      printf '%s wave=%s phase=not-started\n' "$x" "$(_wave_of "$m" "$x")"
    fi
  done
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
  # A multi-slice spec promotes ONCE, from the last slice to land: every other
  # slice of its manifest must be done (merged into dev) first.
  if [ "$to" = promote ]; then
    local pf want x spec; spec=$(_get "$f" spec)
    [ -n "$spec" ] && for x in $(_manifest_slices "$BASE/$spec/manifest"); do
      [ "$BASE/$spec-$x/state" = "$f" ] && continue
      if [ "$(_get "$BASE/$spec-$x/state" phase)" != done ]; then
        echo "ship phase: $spec promotes once, after every slice lands; $x is not done." >&2
        return 1
      fi
    done
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
  local f pr st; f=$(_active) || return 1
  # A slice is done when its PR has LANDED: the next wave branches from dev
  # and the single promote assumes it. Unknown is not merged.
  if [ -n "$(_get "$f" spec)" ]; then
    pr=$(_get "$f" pr)
    [ -n "$pr" ] || { echo "ship done: this slice has no PR. Ship it with 'ship.sh dev', or 'ship.sh halt <reason>'." >&2; return 1; }
    st=$(gh pr view "$pr" --json state -q .state 2>/dev/null)
    if [ "$st" != MERGED ]; then
      echo "ship done: $pr is '${st:-unknown}', not MERGED. A slice is done when it lands on dev." >&2
      return 1
    fi
  fi
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
# Merge-train rule (AGENTS.md): only ONE armed auto-merge into dev at a time.
# `dev` is strict/up-to-date, so N armed PRs just go BEHIND and invalidate each
# other. Precheck the train; queue rather than arm when it is occupied.
# One owner per change. Pure: $1 = our branch, $2 = our title, $3 = our changed
# files (newline separated), $4 = open dev PRs as number<TAB>head<TAB>title<TAB>
# comma-joined files. Prints one line per PR that already owns this change:
# the same title, or a shared file. On 2026-11-01 two sessions each fixed the
# same red dev and opened #1081 and #1082. Within a wave the check doubles as
# the independence proof: sibling slices that share a file were cut wrong.
_dev_conflicts() {
  local branch=$1 title=$2 mine=$3 prs=$4 num head t files shared
  while IFS=$'\t' read -r num head t files; do
    [ -n "$num" ] && [ "$head" != "$branch" ] || continue
    if [ "$t" = "$title" ]; then echo "#$num same title"; continue; fi
    shared=$(printf '%s\n' "$files" | tr ',' '\n' | grep -xF -f <(printf '%s\n' "$mine" | grep -vx '') | paste -sd' ' -)
    [ -n "$shared" ] && echo "#$num shares $shared"
  done <<EOF
$prs
EOF
}

cmd_dev() {
  local f wt branch title="" body="" pr n mine prs conflicts ack=" "
  while [ $# -gt 0 ]; do
    case $1 in
      --allow-overlap) ack="$ack#${2#\#} "; shift 2 ;;
      *) if [ -z "$title" ]; then title=$1; else body=$1; fi; shift ;;
    esac
  done
  [ -n "$title" ] || { echo "usage: ship.sh dev <pr-title> [body-file] [--allow-overlap <pr#>]..." >&2; return 2; }
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
  mine=$(git -C "$wt" diff --name-only origin/dev...HEAD 2>/dev/null)
  if ! prs=$(gh pr list --base dev --state open --limit 200 --json number,headRefName,title,files \
               --jq '.[] | [(.number|tostring), .headRefName, .title, ([.files[].path] | join(","))] | @tsv' 2>/dev/null); then
    echo "ship dev: cannot list open PRs to dev, so cannot prove nobody owns this change. Retry." >&2
    return 1
  fi
  conflicts=$(_dev_conflicts "$branch" "$title" "$mine" "$prs" | while read -r c; do
    case "$ack" in *" ${c%% *} "*) ;; *) echo "$c" ;; esac
  done)
  if [ -n "$conflicts" ]; then
    echo "ship dev: an open PR already owns this change:" >&2
    printf '  %s\n' "$conflicts" >&2
    echo "Fold the work into that PR, or wait for it to land. If both are truly needed, ledger why and pass --allow-overlap <pr#>." >&2
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

if [ "${1:-}" = "--run" ]; then SHIP_RUN=${2:-}; shift 2 2>/dev/null || shift; fi

case ${1:-} in
  init)  shift; cmd_init "$@" ;;
  slice) shift; cmd_slice "$@" ;;
  status) shift; cmd_status "$@" ;;
  ci)    shift; cmd_ci "$@" ;;
  gate)  shift; cmd_gate "$@" ;;
  dev)   shift; cmd_dev "$@" ;;
  preflight-record) shift; cmd_preflight_record "$@" ;;
  facts) shift; cmd_facts "$@" ;;
  phase) shift; cmd_phase "$@" ;;
  halt)  shift; cmd_halt "$@" ;;
  done)  shift; cmd_done "$@" ;;
  *) echo "usage: ship.sh [--run <basename>] {init|slice|status|phase|gate|ci|dev|preflight-record|facts|halt|done}" >&2; exit 2 ;;
esac
