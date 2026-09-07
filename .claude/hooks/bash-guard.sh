#!/usr/bin/env bash
# PreToolUse guard for Bash commands. Catches destructive operations with
# incident history, including when wrapped in `bash -c` / `sh -c`, and
# enforces the /ship-spec autonomy ceiling deterministically — the command's
# prose cannot (design: docs/superpowers/specs/2026-09-05-ship-spec-v2-orchestrator-design.md).
#
# Matching model: the command is normalized (wrappers unwrapped, prose-flag
# values dropped, quotes removed) and split into simple commands on ; & | ( ),
# so a rule only sees the segment whose command position it matched — a PR
# body that says "--base main" or a `git fetch origin main && git push origin
# feature` chain never trips a rule. Tests: .claude/hooks/tests/test-bash-guard.sh
# Output contract: JSON with hookSpecificOutput.permissionDecision.

set -u

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

# Run state lives under the MAIN checkout root, resolved through the common
# git dir so the main checkout and every worktree read the same files.
COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [ -n "$COMMON" ]; then ROOT=$(dirname "$COMMON"); else ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"; fi
STATE_DIR="$ROOT/.superpowers/ship-spec"

# The checkout this session is invoking from. `cwd` in the hook input follows a
# session into a worktree; CLAUDE_PROJECT_DIR stays at the launch directory, so
# it is the fallback rather than the first choice.
SESSION_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -n "$SESSION_CWD" ] && [ -d "$SESSION_CWD" ]; then
  INVOKER="$SESSION_CWD"
else
  INVOKER="${CLAUDE_PROJECT_DIR:-$(pwd)}"
fi

# 1. unwrap `bash -c` / `sh -c`; 2. drop the VALUES of prose flags
# (--body/--title/--message/-b/-t, and -m when quoted); 3. remove quote
# characters so `--base "main"` reads as a flag; 4. split into simple commands.
NORM=$(printf '%s' "$CMD" \
  | sed -E 's/(ba|z|da)?sh[[:space:]]+-l?c[[:space:]]+//g' \
  | sed -E 's/(--body|--title|--message|-b|-t)[= ]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)//g' \
  | sed -E 's/(-m)[= ]+("[^"]*"|'\''[^'\'']*'\'')//g' \
  | tr -d '"\047')
SEGS=$(printf '%s\n' "$NORM" | tr ';&|()' '\n')

# Command position: optional wrappers (eval/exec/command/nohup/env/time),
# optional VAR=val assignments, optional path to the binary.
PRE='^[[:space:]]*((eval|exec|command|nohup|env|time)[[:space:]]+)*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:]]*/)?'
GIT='git([[:space:]]+-[cC][[:space:]]*[^[:space:]]+)*'

SEG=""
seg_matches() { # $1: command regex → SEG = first simple command matching it
  SEG=$(printf '%s\n' "$SEGS" | grep -E -m1 "${PRE}$1" || true)
  [ -n "$SEG" ]
}
seg_has() { printf '%s\n' "$SEG" | grep -Eq -- "$1"; }

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

if seg_matches "${GIT}[[:space:]]+push" && seg_has '[[:space:]]fabianofilho([[:space:]]|$)'; then
  deny "fabianofilho is the read-only upstream remote. Push to origin instead."
fi

if seg_matches 'railway[[:space:]]+up' && seg_has -- '--path-as-root'; then
  deny "railway up --path-as-root is retired. Verified re-trigger: empty-commit PR to main (plain 'railway up' from the root also failed 2026-08-18) — see docs/reference/deployment.md § Manual deploy fallback."
fi

if seg_matches 'make[[:space:]]+(reset-db|db-fresh)' || seg_matches 'supabase[[:space:]]+db[[:space:]]+reset'; then
  ask "DESTRUCTIVE: wipes the local database. Prefer 'make db-fresh' (migrate + seed). After a bare reset, E2E needs 'make db-seed'."
fi

if seg_matches 'supabase[[:space:]]+db[[:space:]]+push'; then
  ask "Applies Supabase auth/storage migrations to the REMOTE project (unless --local). Confirm target."
fi

# Direct pushes to main are never the promotion path (main is protected and
# cannot fast-forward from dev): promote with a merge-commit PR. Checked
# before the force-push rule so `--force origin main` is a deny, not an ask.
if seg_matches "${GIT}[[:space:]]+push" && seg_has '(^|[[:space:]:/])main([[:space:]]|$)'; then
  deny "Direct pushes to main are never the promotion path. Promote with 'gh pr create --base main --head dev' + 'gh pr merge --auto --merge' (deploy-release skill)."
fi

if seg_matches "${GIT}[[:space:]]+push" && seg_has '(^|[[:space:]])(--force(-with-lease)?|-f)([[:space:]]|$)'; then
  ask "Force push rewrites remote history. Confirm."
fi

# `railway domain` with no argument CREATES a subdomain on the linked service
# (non-interactive mode does not prompt). Recurred twice, once with the memory
# on file — an instruction that failed twice becomes a hook.
if seg_matches 'railway[[:space:]]+domain'; then
  ask "railway domain CREATES a domain on the linked service (the no-arg form recurred twice). To READ URLs use 'railway status' or the dashboard. Confirm."
fi

# Rebase merges are never used here: squash into dev, merge-commit into main.
if seg_matches 'gh[[:space:]]+pr[[:space:]]+merge' && seg_has '(^|[[:space:]])(--rebase|-r)([[:space:]]|$)'; then
  deny "Rebase merges are not used in this repo: --squash into dev, --merge (merge commit) only for the dev → main promotion."
fi

# ---------------------------------------------------------------------------
# /ship-spec autonomy ceiling — read from the active run state, never from
# the model's memory of what was asked.
#
# State file: <main checkout>/.superpowers/ship-spec/<plan-basename>/state
#   ceiling=dev|staging|prod  phase=<n>|halted|done  preflight=GREEN@<sha>|RED@<sha>
#   worktree=<absolute path of the run's working tree>
# `halted`/`done` are terminal; a state untouched for 24h is a crashed run.
#
# A promotion is `gh pr create --base main` or `gh pr merge --merge` (the
# merge-commit method is used only for dev → main; feature PRs squash to dev).
# A deploy is `railway up` / `railway redeploy`. Deploys are ceiling-checked
# only, so the rollback fast path stays one command.
# ---------------------------------------------------------------------------

is_promotion=0
is_deploy=0
if seg_matches 'gh[[:space:]]+pr[[:space:]]+create' && seg_has '(--base[= ]+|-B[= ]*)main([[:space:]]|$)'; then is_promotion=1; fi
if seg_matches 'gh[[:space:]]+pr[[:space:]]+merge' && seg_has '(^|[[:space:]])(--merge|-m)([[:space:]]|$)'; then is_promotion=1; fi
if seg_matches 'railway[[:space:]]+(up|redeploy)'; then is_deploy=1; fi

trimmed() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d '[:space:]'; }

if [ "$is_promotion" = 1 ] || [ "$is_deploy" = 1 ]; then
  # A run's ceiling binds the session that DRIVES it, not the whole repo.
  # State lives under the common git dir so every worktree can read it, and
  # reading it is not owning it — the same lesson the Stop gate learned in
  # #847, which survived here in a third place: a dev-ceiling run was denying
  # hand promotions from unrelated worktrees, so the message said "this run
  # cannot touch main" while the behaviour was "nobody may touch main".
  #
  # Keying on orchestrator= costs the prod path nothing, because promotion is
  # the orchestrator's own Phase 6 and no seat ever promotes. A --to prod run
  # therefore keeps its full autonomous cycle; the evidence gate below, not
  # ownership, is what stands between it and main.
  ACTIVE=""
  ACTIVE_COUNT=0
  FOREIGN=""
  FOREIGN_COUNT=0
  for f in "$STATE_DIR"/*/state; do
    [ -f "$f" ] || continue
    phase=$(trimmed phase "$f")
    case "$phase" in done|halted) continue ;; esac
    [ -n "$(find "$f" -mmin +1440 2>/dev/null)" ] && continue
    owner=$(trimmed orchestrator "$f")
    if [ -z "$owner" ]; then
      # States written before orchestrator= existed: fall back to the run's
      # own worktree or the main checkout, so an uninvolved worktree is never
      # bound by a run it has nothing to do with.
      wt=$(trimmed worktree "$f")
      case "$INVOKER" in "$wt"|"$ROOT") owner="$INVOKER" ;; esac
    fi
    if [ "$owner" = "$INVOKER" ]; then
      ACTIVE="$f"
      ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
    else
      FOREIGN="$f"
      FOREIGN_COUNT=$((FOREIGN_COUNT + 1))
    fi
  done

  if [ "$ACTIVE_COUNT" -eq 0 ] && [ "$FOREIGN_COUNT" -gt 0 ]; then
    ask "A /ship-spec run is live in another session ($FOREIGN) and does not bind this checkout ($INVOKER). If you ARE that run's orchestrator, promote from its checkout so its ceiling applies. Otherwise this is a hand promotion while someone else's run is open — confirm; the deploy-release skill is the runbook."
  fi
  if [ "$ACTIVE_COUNT" -eq 0 ]; then
    ask "No active /ship-spec run declares a ceiling (no .superpowers/ship-spec/*/state with a live phase). Promoting or deploying to prod by hand — confirm; the deploy-release skill is the runbook."
  fi
  if [ "$ACTIVE_COUNT" -gt 1 ]; then
    deny "More than one active /ship-spec run state names this checkout as orchestrator. Mark finished runs phase=done (or halted) before promoting."
  fi

  ceiling=$(trimmed ceiling "$ACTIVE")
  case "$ceiling" in
    prod) ;;
    *) deny "ship-spec ceiling is '${ceiling:-unset}' (state: $ACTIVE). This run cannot touch main or prod. Re-invoke with --to prod to promote." ;;
  esac

  if [ "$is_promotion" = 1 ]; then
    # Fresh GREEN preflight on the exact commit being promoted (origin/dev).
    pf=$(trimmed preflight "$ACTIVE")
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
    # reversible, a data-destructive migration is not. Only the upgrade()
    # body counts — every downgrade() drops what upgrade() created.
    migs=$(git -C "$ROOT" diff --name-only origin/main...origin/dev -- backend/alembic/versions/ 2>/dev/null | grep -v '/archive/' || true)
    for m in $migs; do
      body=$(git -C "$ROOT" show "origin/dev:$m" 2>/dev/null | awk '/^def upgrade\(/{f=1; next} /^def downgrade\(/{f=0} f')
      if printf '%s' "$body" | grep -Eiq 'drop_table|drop_column|DROP (TABLE|COLUMN)|TRUNCATE|DELETE FROM'; then
        ask "Promoted range contains a data-destructive migration ($m, upgrade body). A deploy is reversible; this is not. Confirm promotion."
      fi
    done
  fi
fi

exit 0
