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

case ${1:-} in
  init)  shift; cmd_init "$@" ;;
  phase) shift; cmd_phase "$@" ;;
  halt)  shift; cmd_halt "$@" ;;
  done)  shift; cmd_done "$@" ;;
  *) echo "usage: ship.sh {init|phase|gate|ci|dev|preflight-record|facts|halt|done}" >&2; exit 2 ;;
esac
