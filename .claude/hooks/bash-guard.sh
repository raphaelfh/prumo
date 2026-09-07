#!/usr/bin/env bash
# PreToolUse guard for Bash commands. Catches destructive operations with
# incident history, including when wrapped in `bash -c` / `sh -c`, and
# enforces the /ship-spec autonomy ceiling deterministically — the command's
# prose cannot (design: docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md).
# Patterns match only at command position (line start or after ; & | $( )
# so prose inside commit messages / PR bodies does not false-positive.
# Output contract: JSON with hookSpecificOutput.permissionDecision.
# Tests: .claude/hooks/tests/test-bash-guard.sh

set -u

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Normalize shell wrappers so `bash -c "make reset-db"` is still matched.
NORM=$(printf '%s' "$CMD" | sed -E 's/(ba|z|da)?sh[[:space:]]+-l?c[[:space:]]+//g')

matches_cmd() {
  printf '%s\n' "$NORM" | grep -Eq "(^|[;&|]|\\\$\()[[:space:]]*[\"']?$1"
}
has_flag() {
  printf '%s\n' "$NORM" | grep -Eq -- "$1"
}

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
ask() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
  exit 0
}

# ---------------------------------------------------------------------------
# Destructive operations with incident history
# ---------------------------------------------------------------------------

if matches_cmd 'git +push +([^;&|]*[[:space:]])?fabianofilho'; then
  deny "fabianofilho is the read-only upstream remote. Push to origin instead."
fi

if matches_cmd 'railway +up[^;&|]*--path-as-root'; then
  deny "railway up --path-as-root is retired. Verified re-trigger: empty-commit PR to main (plain 'railway up' from the root also failed 2026-08-18) — see docs/reference/deployment.md § Manual deploy fallback."
fi

if matches_cmd 'make +(reset-db|db-fresh)' || matches_cmd 'supabase +db +reset'; then
  ask "DESTRUCTIVE: wipes the local database. Prefer 'make db-fresh' (migrate + seed). After a bare reset, E2E needs 'make db-seed'."
fi

if matches_cmd 'supabase +db +push'; then
  ask "Applies Supabase auth/storage migrations to the REMOTE project (unless --local). Confirm target."
fi

if matches_cmd 'git +push +[^;&|]*(--force|-f([[:space:]]|$))'; then
  ask "Force push rewrites remote history. Confirm."
fi

# `railway domain` with no argument CREATES a subdomain on the linked service
# (non-interactive mode does not prompt). Recurred twice, once with the memory
# on file — an instruction that failed twice becomes a hook.
if matches_cmd 'railway +domain'; then
  ask "railway domain CREATES a domain on the linked service (the no-arg form recurred twice). To READ URLs use 'railway status' or the dashboard. Confirm."
fi

# Direct pushes to main are never the promotion path (main is protected and
# cannot fast-forward from dev): promote with a merge-commit PR.
if matches_cmd 'git +push' && has_flag '(^|[[:space:]:/])main([[:space:]]|$)'; then
  deny "Direct pushes to main are never the promotion path. Promote with 'gh pr create --base main --head dev' + 'gh pr merge --auto --merge' (deploy-release skill)."
fi

# ---------------------------------------------------------------------------
# /ship-spec autonomy ceiling — read from the active run state, never from
# the model's memory of what was asked.
#
# State file: .superpowers/sdd/<plan-basename>/state (gitignored SDD workspace)
#   ceiling=dev|staging|prod   phase=<n>|done   preflight=GREEN@<sha>|RED@<sha>
#
# A promotion is `gh pr create --base main` or `gh pr merge --merge` (the
# merge-commit method is used only for dev → main; feature PRs squash to dev).
# A deploy is `railway up` / `railway redeploy`. Deploys are ceiling-checked
# only, so the rollback fast path stays one command.
# ---------------------------------------------------------------------------

is_promotion=0
is_deploy=0
if matches_cmd 'gh +pr +create' && has_flag '(--base|-B)[= ]+main([[:space:]]|$)'; then is_promotion=1; fi
if matches_cmd 'gh +pr +merge' && has_flag '(^|[[:space:]])--merge([[:space:]]|$)'; then is_promotion=1; fi
if matches_cmd 'railway +(up|redeploy)'; then is_deploy=1; fi

if [ "$is_promotion" = 1 ] || [ "$is_deploy" = 1 ]; then
  ACTIVE=""
  ACTIVE_COUNT=0
  for f in "$ROOT"/.superpowers/sdd/*/state; do
    [ -f "$f" ] || continue
    phase=$(sed -n 's/^phase=//p' "$f" | tail -1)
    [ "$phase" = "done" ] && continue
    ACTIVE="$f"
    ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
  done

  if [ "$ACTIVE_COUNT" -eq 0 ]; then
    ask "No active /ship-spec run declares a ceiling (no .superpowers/sdd/*/state with phase != done). Promoting or deploying to prod by hand — confirm; the deploy-release skill is the runbook."
  fi
  if [ "$ACTIVE_COUNT" -gt 1 ]; then
    deny "More than one active /ship-spec run state under .superpowers/sdd/*/state. Mark finished runs phase=done before promoting."
  fi

  ceiling=$(sed -n 's/^ceiling=//p' "$ACTIVE" | tail -1)
  case "$ceiling" in
    prod) ;;
    *) deny "ship-spec ceiling is '${ceiling:-unset}' (state: $ACTIVE). This run cannot touch main or prod. Re-invoke with --to prod to promote." ;;
  esac

  if [ "$is_promotion" = 1 ]; then
    # Fresh GREEN preflight on the exact commit being promoted (origin/dev).
    pf=$(sed -n 's/^preflight=//p' "$ACTIVE" | tail -1)
    head_dev=$(git -C "$ROOT" rev-parse origin/dev 2>/dev/null || echo "")
    case "$pf" in
      GREEN@*)
        if [ -z "$head_dev" ] || [ "${pf#GREEN@}" != "$head_dev" ]; then
          deny "preflight evidence is '$pf' but origin/dev is '${head_dev:-unknown}'. Re-run /preflight on the promoted commit and record preflight=GREEN@<sha> in $ACTIVE."
        fi
        ;;
      *)
        deny "No GREEN preflight recorded in $ACTIVE (found '${pf:-none}'). Run /preflight first; red or unknown evidence never promotes."
        ;;
    esac

    # The one human touch at any rung that shares a database: a deploy is
    # reversible, a data-destructive migration is not.
    migs=$(git -C "$ROOT" diff --name-only origin/main...origin/dev -- backend/alembic/versions/ 2>/dev/null | grep -v '/archive/' || true)
    for m in $migs; do
      [ -f "$ROOT/$m" ] || continue
      if grep -Eiq 'drop_table|drop_column|DROP (TABLE|COLUMN)|TRUNCATE|DELETE FROM' "$ROOT/$m"; then
        ask "Promoted range contains a data-destructive migration ($m). A deploy is reversible; this is not. Confirm promotion."
      fi
    done
  fi
fi

exit 0
