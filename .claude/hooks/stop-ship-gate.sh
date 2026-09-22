#!/usr/bin/env bash
# Stop gate — /ship-spec evidence, by named phase (silent when no run is
# live, so conversational turns cost ~0):
#      harden                 -> a gate.log for the run worktree's current HEAD,
#                                ending in GATE_EXIT=0. The gate must have been
#                                run, not described.
#      ship | promote | verify -> a RECORDED ci=GREEN must still match HEAD.
#      promote                -> live CI on origin/dev must be GREEN.
#
#    PENDING CI NEVER BLOCKS. The run is supposed to end its turn and come back
#    while CI runs; a gate that blocks while the thing it gates is still
#    running is the deadlock shape this repo shipped three times (#847 x2,
#    #850). This hook blocks a LIE (a recorded green the API contradicts) and
#    blocks PROMOTION without evidence — never waiting.
#
#    Claude Code caps consecutive blocks at 8, so this is self-bounding.
#    `phase=halted` lifts it (how a HALT report ends the turn); a state
#    untouched for 24h is a crashed run and is ignored.
#    Design: docs/superpowers/specs/2026-09-08-ship-spec-v3-evidence-design.md

set -u

# Guard against blocking loops.
INPUT=$(cat)
if printf '%s' "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

block() {
  jq -n --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

# The checkout this session is actually sitting in. `cwd` in the hook input
# follows the session into a worktree; CLAUDE_PROJECT_DIR stays at the launch
# directory, so it is the fallback, not the first choice.
SESSION_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)

CWD_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -n "$SESSION_CWD" ] && [ -d "$SESSION_CWD" ] && CWD_ROOT="$SESSION_CWD"
cd "$CWD_ROOT" || exit 0

# --- /ship-spec gate evidence ------------------------------------------------
# State lives under the MAIN checkout root (common git dir), so the main
# checkout and every worktree see the same run.
COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [ -n "$COMMON" ]; then ROOT=$(dirname "$COMMON"); else ROOT="$CWD_ROOT"; fi
trimmed() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d '[:space:]'; }

for f in "$ROOT"/.superpowers/ship-spec/*/state; do
  [ -f "$f" ] || continue
  phase=$(trimmed phase "$f")
  case "$phase" in
    harden|ship|promote|verify) ;;
    *) continue ;;
  esac
  [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ] && continue
  dir=$(dirname "$f")
  wt=$(trimmed worktree "$f")
  [ -d "$wt" ] || wt="$ROOT"

  # Gate ONLY the session driving the run. The state deliberately lives under
  # the common git dir so every worktree can see it, and an earlier version
  # confused seeing it with owning it: one run in phase 4-7 stopped every
  # session in the repository from ending a turn, for up to the 24h staleness
  # window. A peer session hit this on 2026-09-07 while promoting unrelated
  # PRs. `orchestrator=` is the checkout /ship-spec was invoked from; when a
  # state predates it, fall back to the run's own worktree or the main
  # checkout, so an uninvolved worktree is never gated.
  owner=$(trimmed orchestrator "$f")
  if [ -n "$owner" ]; then
    [ "$CWD_ROOT" = "$owner" ] || continue
  else
    case "$CWD_ROOT" in "$wt"|"$ROOT") ;; *) continue ;; esac
  fi
  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo "")

  # --- harden: the fast local gate must have RUN, on this HEAD, and finished.
  # The terminal GATE_EXIT marker matters as much as the sha: a seat cut off by
  # its turn cap leaves a correct first line and no marker, and that passed the
  # sha-only check twice on 2026-09-07.
  if [ "$phase" = harden ]; then
    log="$dir/gate.log"
    log_sha=""
    [ -f "$log" ] && log_sha=$(sed -n '1s/^sha=//p' "$log" | tr -d '[:space:]')
    if [ -z "$log_sha" ] || [ "$log_sha" != "$head_sha" ]; then
      block "ship-spec phase harden: no gate.log for HEAD ${head_sha:-?} of $wt in $dir (found: ${log_sha:-none}). Run \`bash scripts/ship.sh gate\`. To stop with a HALT report instead: \`bash scripts/ship.sh halt <reason>\`."
    elif ! grep -q '^GATE_EXIT=0$' "$log"; then
      block "ship-spec phase harden: $log has no GATE_EXIT=0 — the gate did not finish, or went red. Re-run \`bash scripts/ship.sh gate\` on HEAD $head_sha."
    fi
    continue
  fi

  # --- ship / promote / verify: CI is the arbiter.
  # A recorded green that no longer addresses HEAD is stale evidence, which is
  # the same class as a hand-edited sha= line.
  recorded=$(trimmed ci "$f")
  case "$recorded" in
    GREEN@*)
      if [ "${recorded#GREEN@}" != "$head_sha" ]; then
        block "ship-spec phase $phase: state records $recorded but HEAD of $wt is ${head_sha:-?}. Re-run \`bash scripts/ship.sh ci\` on the current commit."
      fi
      ;;
  esac

  # Promotion is the one place where absence of evidence blocks. Red or unknown
  # never promotes, so a network failure correctly stops here.
  #
  # ship.sh MUST run from CWD_ROOT: it resolves the run by `orchestrator=`
  # against its own $PWD, and the ownership check above already guarantees
  # CWD_ROOT is that owner. Running it from $wt would find no active run and
  # report unknown, which in promote blocks forever for the wrong reason.
  if [ "$phase" = promote ]; then
    dev_sha=$(git -C "$ROOT" rev-parse origin/dev 2>/dev/null || echo "")
    live=$(cd "$CWD_ROOT" 2>/dev/null && bash "$ROOT/scripts/ship.sh" ci "$dev_sha" 2>/dev/null | tail -1)
    case "$live" in
      GREEN@*) ;;
      *) block "ship-spec phase promote: CI on origin/dev (${dev_sha:-unknown}) is '${live:-unknown}'. Red or unknown evidence never promotes. To stop instead: \`bash scripts/ship.sh halt <reason>\`." ;;
    esac
  fi
done

exit 0
