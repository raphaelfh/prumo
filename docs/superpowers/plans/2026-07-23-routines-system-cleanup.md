---
status: draft
last_reviewed: 2026-07-23
owner: '@raphaelfh'
---

# Routines System Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the claude.ai routines portfolio from ten routines to three that
deliver into the pull-request flow, and liquidate the 43-issue backlog the old
portfolio produced.

**Architecture:** All ten routines live in the claude.ai routines service, not in
this repository — they are reached through the `RemoteTrigger` tool, never
through `curl`. Eight are disabled in place (the API has no delete; the
maintainer deletes them in the web UI afterwards). Two are rewritten by replacing
their prompt and session context. One is created. The repository itself is
touched only by the backlog liquidation.

**Tech Stack:** `RemoteTrigger` tool (claude.ai triggers API), `gh` CLI, git.

## Global Constraints

- **Output contract.** A routine delivers one reviewable artifact inside the
  pull-request flow, or nothing at all. No routine may open a GitHub issue,
  write to a queue, or record a finding for later.
- **No routine merges.** Code-producing routines open a PR that is
  `ready-for-review`. The human performs the merge.
- **Forbidden write paths for every routine:** `backend/alembic/versions/`,
  `supabase/migrations/`, `.env*`, `.github/workflows/`, `package.json`,
  `package-lock.json`, `pyproject.toml`, `uv.lock`.
- **The pre-push gate is the sandbox gate**, defined verbatim in Task 3. It never
  includes `make test-backend`, `backend/tests/integration/`, Playwright, or
  anything needing a live Supabase, Redis or Docker.
- **English only** for prompts, commits, PR bodies and docs.
- **PRs target `dev`** and are squash-merged. Conventional commits.
- **Environment id** for every routine: `env_012ibsp8thFCLZohEdPXqcU9`
  (prumo-cloud).
- **Repository source** for every routine:
  `https://github.com/raphaelfh/prumo`.
- **Never use `curl` against the triggers API.** `RemoteTrigger` handles auth
  in-process.

## Routine id reference

Copy these exactly; a wrong id silently edits the wrong routine.

| routine | trigger id | fate |
|---|---|---|
| `pr-review` | `trig_015Ed9VgNygmJ1AcNQFhszTm` | reshape (Task 2) |
| `cleanup` | `trig_01YBm1YjAd18JdZDe8thsPCd` | reshape (Task 3) |
| `bug-watch` | `trig_01GtuwTpuQMFTcxVE6WEotvy` | disable (Task 1) |
| `bug-watch-write` | `trig_01T8PF56S19cJ5iKusnQwuZF` | disable (Task 1) |
| `dep-vuln-sweep` | `trig_01QL2qyan1t6pBqJRdwneg8X` | disable (Task 1) |
| `flaky-test-tracker` | `trig_01UA3zyf53r7BEfQgppxtzrp` | disable (Task 1) |
| `system-health-check` | `trig_01FhDpFrJJtvz43qh9EY9NQB` | disable (Task 1) |
| `linear-enrich` | `trig_01ACDzcTqifSTmpTyHk8SQn1` | disable (Task 1) |
| `migration-drift-detector` | `trig_01HHfcKmJTnjn2AiqrUrSqzF` | disable (Task 1) |
| `routine-watchdog` | `trig_015kZDzu7hghSzrPEQcznPbb` | disable (Task 1) |

---

### Task 1: Disable the eight retired routines

Stops issue production immediately. Done first so that no retired routine fires
while the surviving two are being rewritten.

**Files:** none — this task only calls `RemoteTrigger`.

**Interfaces:**

- Consumes: nothing.
- Produces: eight routines with `enabled: false`. Tasks 2–4 assume no other
  routine will fire during their verification runs.

- [ ] **Step 1: Record the pre-change state**

Call `RemoteTrigger` with `{action: "list"}`. Save the response. Confirm the
count is 10 and that exactly these eight report `enabled: true`: `bug-watch`,
`bug-watch-write`, `dep-vuln-sweep`, `flaky-test-tracker`, `system-health-check`,
`linear-enrich`, `migration-drift-detector`, `routine-watchdog`.

If any is already `enabled: false`, note it and skip that one in Step 2 — do not
treat it as an error.

- [ ] **Step 2: Disable each of the eight**

Eight separate `RemoteTrigger` calls. Body is identical every time; only
`trigger_id` changes.

```json
{"action": "update", "trigger_id": "trig_01GtuwTpuQMFTcxVE6WEotvy", "body": {"enabled": false}}
```

Repeat with `trig_01T8PF56S19cJ5iKusnQwuZF`, `trig_01QL2qyan1t6pBqJRdwneg8X`,
`trig_01UA3zyf53r7BEfQgppxtzrp`, `trig_01FhDpFrJJtvz43qh9EY9NQB`,
`trig_01ACDzcTqifSTmpTyHk8SQn1`, `trig_01HHfcKmJTnjn2AiqrUrSqzF`,
`trig_015kZDzu7hghSzrPEQcznPbb`.

- [ ] **Step 3: Verify all eight are off and the two survivors are untouched**

Call `RemoteTrigger` with `{action: "list"}`.

Expected: `enabled: false` on all eight; `enabled: true` on `pr-review`
(`trig_015Ed9VgNygmJ1AcNQFhszTm`) and `cleanup`
(`trig_01YBm1YjAd18JdZDe8thsPCd`).

Do not proceed to Task 2 until this exact state is confirmed.

- [ ] **Step 4: Hand the deletion step to the maintainer**

The API cannot delete routines. Tell the maintainer, in one line, that the eight
are disabled and can now be deleted at `https://claude.ai/code/routines`.
Deletion is theirs to perform; do not attempt a workaround.

---

### Task 2: Reshape `pr-review` — drop the dead Context7 connection

`pr-review` is the only routine with a track record. The single change is
removing an MCP connection that cannot resolve, because the account currently has
no connected connectors. The prompt is not touched.

**Files:** none — `RemoteTrigger` only.

**Interfaces:**

- Consumes: nothing.
- Produces: `pr-review` with an empty `mcp_connections`. No other task depends on
  this.

- [ ] **Step 1: Read the current configuration**

```json
{"action": "get", "trigger_id": "trig_015Ed9VgNygmJ1AcNQFhszTm"}
```

Confirm `mcp_connections` contains exactly one entry, named `Context7`. Confirm
`job_config.ccr.events[0].data.message.content` still begins with
`pr-review: first-pass reviewer for raphaelfh/prumo pull requests`.

- [ ] **Step 2: Clear the MCP connections**

```json
{"action": "update", "trigger_id": "trig_015Ed9VgNygmJ1AcNQFhszTm", "body": {"clear_mcp_connections": true}}
```

- [ ] **Step 3: Verify the prompt survived the update**

```json
{"action": "get", "trigger_id": "trig_015Ed9VgNygmJ1AcNQFhszTm"}
```

Expected: `mcp_connections` empty or absent; `enabled: true`;
`job_config.ccr.session_context.allowed_tools` still
`["Bash", "Read", "Glob", "Grep", "Skill"]`; the prompt string unchanged.

A partial update must not have dropped the prompt. If the prompt is missing or
truncated, restore it from the Step 1 response immediately before continuing.

- [ ] **Step 4: Confirm on the next real PR**

No synthetic run — `pr-review` is event-driven and the next PR opened by this
plan (Task 5's triage commit is docs-only and will do) exercises it naturally.
After that PR exists, confirm a `## Claude review` comment appears on it:

```bash
gh pr view <N> --json comments --jq '[.comments[]|select(.body|startswith("## Claude review"))]|length'
```

Expected: `1`.

---

### Task 3: Reshape `cleanup` — sandbox gate, ready PR, proactive only

This is the task that fixes the two-month zero-delivery history. The gate change
is the substantive fix; the other three changes remove skip paths and a human
gate.

**Files:** none — `RemoteTrigger` only.

**Interfaces:**

- Consumes: Task 1's disabled state (so the anti-conflict gate is not racing
  other routines).
- Produces: the sandbox gate text, reused verbatim by Task 4.

- [ ] **Step 1: Back up the current prompt**

```json
{"action": "get", "trigger_id": "trig_01YBm1YjAd18JdZDe8thsPCd"}
```

Save `job_config.ccr.events[0].data.message.content` to
`/tmp/cleanup-prompt.backup.txt`. If Step 4's verification run reveals the
rewrite is worse, this is the rollback source.

- [ ] **Step 2: Apply the new configuration**

`job_config` is replaced wholesale — a partial `job_config` would drop the
sources and tools. Generate a fresh lowercase v4 UUID for `events[].data.uuid`.

```json
{
  "action": "update",
  "trigger_id": "trig_01YBm1YjAd18JdZDe8thsPCd",
  "body": {
    "cron_expression": "0 9 * * 2",
    "enabled": true,
    "job_config": {
      "ccr": {
        "environment_id": "env_012ibsp8thFCLZohEdPXqcU9",
        "session_context": {
          "model": "claude-opus-4-8[1m]",
          "autofix_on_pr_create": true,
          "allowed_tools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Skill"],
          "sources": [{"git_repository": {"url": "https://github.com/raphaelfh/prumo"}}]
        },
        "events": [{"data": {
          "uuid": "<fresh lowercase v4 uuid>",
          "session_id": "",
          "type": "user",
          "parent_tool_use_id": null,
          "message": {"role": "user", "content": "<the prompt below, verbatim>"}
        }}]
      }
    }
  }
}
```

The prompt content, verbatim:

```text
cleanup: weekly proactive cleanup of one cold module in raphaelfh/prumo.
Opens ONE ready-for-review PR per run, or nothing. Never merges. Never files
an issue.

## Setup
git fetch origin && git checkout dev && git pull --ff-only

## 1. Pick the module
MODULE = the LEAST-RECENTLY-TOUCHED entry in this rotation list:
  backend/app/services, backend/app/utils, frontend/hooks,
  frontend/services, frontend/components
Rank them by the date of their most recent commit:
  for m in backend/app/services backend/app/utils frontend/hooks frontend/services frontend/components; do
    echo "$(git log -1 --format=%ct -- $m) $m"
  done | sort -n | head -1
This always returns a candidate. There is no "nothing cold" exit.

## 2. Anti-conflict gate (MANDATORY)
OPEN_PRS=$(gh pr list -R raphaelfh/prumo --state open --json files \
  | jq "[.[] | select(.files != null) | select(.files[].path | startswith(\"$MODULE\"))] | length")
If $OPEN_PRS > 0: exit `cleanup_done module=$MODULE action=skip reason=conflict-with-pr count=$OPEN_PRS`.
This is the ONLY skip path.

## 3. Apply cleanup
Invoke skill `code-simplifier:code-simplifier`. Constraints:
- net LOC delta <= 200, files touched <= 15
- FORBIDDEN paths: backend/alembic/versions/, supabase/migrations/, .env*,
  .github/workflows/, package.json, package-lock.json, pyproject.toml, uv.lock
- FORBIDDEN: API contract changes, model field renames, public symbol renames,
  new abstractions, while-I'm-here refactors
- ALLOWED (max 2 categories per run): dead-code removal (grep proof required in
  the PR body), unused imports/vars (lint-driven), `ruff format` / `prettier`,
  consolidating 2 near-identical helpers of <= 30 LOC each
FALLBACK if the skill does not load: apply the ALLOWED categories manually with
ruff/prettier plus grep evidence -- same rules.
If nothing in the ALLOWED categories exists in this module, exit
`cleanup_done module=$MODULE action=skip reason=nothing-to-clean`.

## 4. Sandbox gate -- run BEFORE pushing
This gate is what this environment can actually run. Do NOT run
`make test-backend`, anything under backend/tests/integration/, or Playwright --
they need a live Supabase that does not exist here, and they will fail.

cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest tests/unit
cd ..
# only if TypeScript was touched:
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run test:run

On ANY failure: revert the working tree (`git checkout -- .`) and exit
`cleanup_done module=$MODULE action=aborted reason=gate-failed step=<which command>`.
Name the failing command in the exit line. Do not push a red change.

## 5. Push and open a READY pull request
BRANCH=cleanup/$(basename $MODULE)-$(date +%Y%m%d)
git checkout -b $BRANCH
git add -A
git commit -m "cleanup($(basename $MODULE)): <summary>"
git push -u origin HEAD
gh pr create --base dev \
  --title "cleanup($(basename $MODULE)): <summary>" \
  --body "Proactive weekly cleanup of the least-recently-touched module.

## What
<bullets>

## Evidence
<grep proof for every dead-code removal>

## Sandbox gate
<paste the actual output of ruff, mypy, pytest tests/unit, and the frontend
commands if run>

## Not run here
make test-backend and the integration suite need a live Supabase, which this
sandbox does not have. CI on this PR is the integrated gate."

NOT a draft. The PR must be ready for review.

## Hard rules
- One PR per run, or nothing.
- NEVER open a GitHub issue. NEVER comment on an issue. NEVER post a heartbeat.
- NEVER merge.
- Never bypass the anti-conflict gate.
- Stay under 12 minutes.

## Output
Last line MUST be:
`cleanup_done module=<path> action=<pr-opened|skip|aborted> reason=<...|none> pr=<#N|none>`
```

- [ ] **Step 3: Verify the configuration took**

```json
{"action": "get", "trigger_id": "trig_01YBm1YjAd18JdZDe8thsPCd"}
```

Expected: `cron_expression` is `0 9 * * 2`; `enabled: true`; the prompt contains
the string `uv run pytest tests/unit` and does **not** contain
`make test-backend`; `sources` has the prumo repository;
`autofix_on_pr_create` is `true`.

- [ ] **Step 4: Run it once and read the terminal line**

```json
{"action": "run", "trigger_id": "trig_01YBm1YjAd18JdZDe8thsPCd"}
```

Wait, then observe. Acceptable outcomes, in order of preference:

1. `action=pr-opened` — a `cleanup/*` branch and a non-draft PR against `dev`
   exist. This is the target state; the two-month failure is fixed.
2. `action=skip reason=conflict-with-pr` — legitimate; three dependabot PRs were
   open at the time of writing. Close or merge them and re-run.
3. `action=skip reason=nothing-to-clean` — legitimate.
4. `action=aborted reason=gate-failed step=<cmd>` — the named command is the real
   blocker. Fix that specific command in the prompt and re-run. Do not widen the
   gate blindly.

Check for the branch and PR:

```bash
git ls-remote --heads origin 'refs/heads/cleanup/*'
gh pr list --state open --json number,headRefName,isDraft --jq '.[]|select(.headRefName|startswith("cleanup/"))'
```

Expected on outcome 1: one branch, one PR, `isDraft=false`.

- [ ] **Step 5: Record the outcome in the plan**

Append the observed terminal line and outcome number to this file under a
`## Run log` heading, then commit:

```bash
git add docs/superpowers/plans/2026-07-23-routines-system-cleanup.md
git commit -m "docs(plan): record cleanup verification run outcome"
```

---

### Task 4: Create `bug-fix`

Replaces `bug-watch` and `bug-watch-write` with a single routine that fixes one
bug per week instead of filing five findings per week. Create it only after Task
3's verification run has demonstrated that the sandbox gate is passable — if the
gate blocks `cleanup`, it will block `bug-fix` identically.

**Files:** none — `RemoteTrigger` only.

**Interfaces:**

- Consumes: the sandbox gate text from Task 3, reused verbatim.
- Produces: a new routine id; record it in the Run log.

- [ ] **Step 1: Confirm the precondition**

Task 3 Step 4 must have produced outcome 1, 2 or 3 — never 4. If `cleanup`
aborted on the gate, stop and fix the gate first. Creating a second routine that
shares the same broken gate only doubles the silent failures.

- [ ] **Step 2: Create the routine**

Cron `0 6 * * 6` is Saturday 06:00 UTC — Saturday 03:00 in America/Sao_Paulo.
The day no longer selects the scope; the ISO week does. Generate a fresh
lowercase v4 UUID.

```json
{
  "action": "create",
  "body": {
    "name": "bug-fix",
    "cron_expression": "0 6 * * 6",
    "enabled": true,
    "job_config": {
      "ccr": {
        "environment_id": "env_012ibsp8thFCLZohEdPXqcU9",
        "session_context": {
          "model": "claude-opus-4-8[1m]",
          "autofix_on_pr_create": true,
          "allowed_tools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Skill"],
          "sources": [{"git_repository": {"url": "https://github.com/raphaelfh/prumo"}}]
        },
        "events": [{"data": {
          "uuid": "<fresh lowercase v4 uuid>",
          "session_id": "",
          "type": "user",
          "parent_tool_use_id": null,
          "message": {"role": "user", "content": "<the prompt below, verbatim>"}
        }}]
      }
    }
  }
}
```

The prompt content, verbatim:

```text
bug-fix: weekly bug hunt on the dev branch of raphaelfh/prumo that FIXES one
bug. Opens ONE ready-for-review PR per run, or nothing. Never merges. Never
files an issue.

## SKILLS
- `systematic-debugging` -- before forming a hypothesis
- `root-cause-tracing` -- when a static-analysis finding looks like a symptom
- `verification-before-completion` -- before pushing
Fall back to the explicit steps below if a skill fails to load.

## 0. Setup
git fetch origin && git checkout dev && git pull --ff-only
SCOPE=$(( $(date -u +%V) % 7 ))
echo "SCOPE=$SCOPE"

## 1. Scope -- pick ONE row by $SCOPE
0  backend/app/services/extraction_*.py
1  backend/app/services/{run_lifecycle_service,hitl_session_service,hitl_config_service}.py
2  backend/app/api/v1/endpoints/*.py
3  backend/app/services/{pdf_processor,openai_service,model_extraction_service,section_extraction_service,articles_export_service,api_key_service,template_clone_service,zotero_service,zotero_import_service,article_source_normalization,coordinate_coherence}.py + backend/app/worker/tasks/*
4  backend/app/models/*.py + backend/app/schemas/*.py
5  frontend/hooks/extraction/* + frontend/services/* + frontend/components/extraction/*
6  frontend/hooks/{runs,qa,hitl,zotero,performance,shared}/* + frontend/pages/* + frontend/components/{hitl,quality,runs,navigation,layout}/*

## 2. Lens for that row
0  async/await in SQLAlchemy 2.0 async; transaction boundaries; commit/rollback symmetry; SELECT-then-mutate without a lock
1  race conditions / TOCTOU in run state; missing FOR UPDATE; idempotency in resume and reopen
2  BOLA -- every project-scoped endpoint must call is_project_reviewer BEFORE read or write; PATCH dropping fields; ApiResponse envelope drift
3  external-API call sites -- missing timeouts, no retry/backoff, secret leakage in logs, Celery task idempotency, unbounded memory on PDF parse
4  SQLAlchemy <-> Pydantic drift; missing FK ON DELETE; RLS mismatch with the tenant column
5  error swallowing that returns success; Promise.all partial failure; stale TanStack-Query cache after mutation; Zod schema drift vs the API
6  cache-invalidation keys missing run_id/project_id; infinite re-render hooks; missing AbortController; navigation guards lost

## 3. Dedup -- MANDATORY before doing any work
Check that the bug is not already being handled:
  gh pr list -R raphaelfh/prumo --state all --limit 60 --json number,title,body,headRefName
  git log origin/dev --since='60 days ago' --oneline
Skip anything an open PR already touches or a recent commit already fixed.
Do NOT read the issue list -- issues are no longer part of this system.

## 4. Find candidates, then PROVE one
cd backend
uv run ruff check app --select B,S,SIM,PIE,RUF,ASYNC --no-fix --output-format=concise 2>&1 | head -150
uv run mypy app 2>&1 | head -100
cd ..
# for scopes 5 and 6 also:
npm run lint 2>&1 | head -120
npx tsc --noEmit -p tsconfig.app.json 2>&1 | head -150

For each candidate INSIDE this week's scope: invoke `systematic-debugging`, read
the code, write a 3-line repro, and prove the symptom by reading the callers or
running a targeted test. A candidate you cannot prove is DROPPED, not filed.

## 5. Pick exactly ONE
Choose the single highest-confidence proven bug. Ignore the rest -- they are not
recorded anywhere, and that is intentional.

PROBATION CEILING -- during the first four runs, only these classes qualify:
- a missing cancellation guard on an async effect
- a swallowed error that returns success
- a success path that fires on partial failure
- a cache that is never invalidated after a mutation
Anything outside these classes: exit `bug_fix_done scope=$SCOPE action=skip
reason=above-ceiling`. Do not fix it, do not file it.

If nothing proven qualifies, exit `bug_fix_done scope=$SCOPE action=skip
reason=nothing-proven`.

## 6. Fix it minimally, with one regression test
- Modify the cited file:line and adjacent helpers only if strictly needed.
- Add EXACTLY ONE regression test. Prove it is a real regression test:
  `git stash` the fix, run the test, confirm it FAILS, `git stash pop`, run it
  again, confirm it PASSES. Paste both outputs into the PR body.
- No "while I'm here" broadening.
- FORBIDDEN paths: backend/alembic/versions/, supabase/migrations/, .env*,
  .github/workflows/, package.json, package-lock.json, pyproject.toml, uv.lock

## 7. Sandbox gate -- run BEFORE pushing
This gate is what this environment can actually run. Do NOT run
`make test-backend`, anything under backend/tests/integration/, or Playwright --
they need a live Supabase that does not exist here, and they will fail.

cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest tests/unit
cd ..
# only if TypeScript was touched:
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run test:run

On ANY failure: revert the working tree (`git checkout -- .`) and exit
`bug_fix_done scope=$SCOPE action=aborted reason=gate-failed step=<which command>`.
Name the failing command. Do not push a red change.

## 8. Push and open a READY pull request
BRANCH=bugfix/scope$SCOPE-$(date +%Y%m%d)
git checkout -b $BRANCH
git add -A
git commit -m "fix(<area>): <one-line summary>"
git push -u origin HEAD
gh pr create --base dev \
  --title "fix(<area>): <one-line summary>" \
  --body "## Root cause
<from systematic-debugging>

## Fix
<bullets, minimal>

## Regression test
<file:line and test name>

### Fails without the fix
<paste the stashed run output>

### Passes with the fix
<paste the run output>

## Sandbox gate
<paste the actual output of ruff, mypy, pytest tests/unit, and the frontend
commands if run>

## Not run here
make test-backend and the integration suite need a live Supabase, which this
sandbox does not have. CI on this PR is the integrated gate."

NOT a draft. The PR must be ready for review.

## Hard rules
- ONE bug per run, or nothing.
- NEVER open a GitHub issue. NEVER comment on an issue. NEVER post a heartbeat.
- NEVER merge.
- Stay under 15 minutes.

## Output
Last line MUST be:
`bug_fix_done scope=<0-6> action=<pr-opened|skip|aborted> reason=<...|none> pr=<#N|none>`
```

- [ ] **Step 3: Verify the routine exists and is configured correctly**

```json
{"action": "list"}
```

Expected: eleven routines total — the original ten plus `bug-fix`. `bug-fix` has
`enabled: true`, `cron_expression` `0 6 * * 6`, and its prompt contains
`uv run pytest tests/unit`, `PROBATION CEILING`, and
`SCOPE=$(( $(date -u +%V) % 7 ))`. Record the new trigger id in the Run log.

- [ ] **Step 4: Run it once**

```json
{"action": "run", "trigger_id": "<the new bug-fix id>"}
```

Expected terminal line: any of `action=pr-opened`, `action=skip
reason=nothing-proven`, or `action=skip reason=above-ceiling`. All three are
healthy. `action=aborted reason=gate-failed` means the gate is still wrong — fix
the named command.

Verify it filed nothing:

```bash
gh issue list --state open --label auto-found --json number --jq 'length'
```

Expected: unchanged from before the run.

- [ ] **Step 5: Record the outcome**

Append the terminal line and the new trigger id to the Run log, then commit.

---

### Task 5: Triage the 43-issue backlog

Produces the classification table that a second plan turns into fix PRs. This
task **reads and classifies only** — it closes nothing. Bulk-closing GitHub
issues is irreversible from this side and is gated on the maintainer's explicit
approval in Step 5.

**Files:**

- Create: `docs/superpowers/plans/2026-07-23-auto-found-triage.md`

**Interfaces:**

- Consumes: nothing.
- Produces: a table with one row per open `auto-found` issue and a verdict of
  `OBSOLETE`, `REAL`, or `UNVERIFIABLE`. The follow-up plan reads this table.

- [ ] **Step 1: Pull every open auto-found issue into a working file**

```bash
cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/routines-system-cleanup-78d784
gh issue list --state open --label auto-found --limit 200 \
  --json number,title,body,labels,createdAt \
  > /tmp/auto-found-open.json
jq 'length' /tmp/auto-found-open.json
```

Expected: `43`. If the count differs, use the actual count everywhere below — do
not assume 43.

- [ ] **Step 2: Extract the cited location from each issue**

Every `bug-watch` issue body carries a `## File & Lines` H2. Extract the first
path-like token after it.

```bash
jq -r '.[] | [
  (.number|tostring),
  ((.labels|map(.name))|join(",")),
  ((.body // "") | capture("## File & Lines\\s*\\n+(?<loc>[^\\n]+)") ).loc // "NO-LOCATION"
] | @tsv' /tmp/auto-found-open.json > /tmp/auto-found-locs.tsv
wc -l /tmp/auto-found-locs.tsv
```

Issues with `NO-LOCATION` are the `dep-vuln`, `prod-incident`, `flaky-test` and
`meta:heartbeat` ones — they carry no file citation and are classified by rule in
Step 4, not by code inspection.

- [ ] **Step 3: Classify each file-citing issue against HEAD**

For each row with a location, in order:

1. Strip the line range and backticks to get the bare path.
2. If the file no longer exists → `OBSOLETE`, evidence `file removed`.
3. If it exists, read the cited region and check whether the symptom described in
   `## Summary` is still present.
4. If the symptom is gone → `OBSOLETE`, evidence: the commit that changed it,
   found with `git log -S'<distinctive symbol>' --oneline -- <path> | head -3`.
5. If the symptom is still present → `REAL`.
6. If the citation is too vague to check in under two minutes → `UNVERIFIABLE`.

Do not fix anything in this task. Classification only.

- [ ] **Step 4: Classify the non-file issues by rule**

- `dep-vuln` (12 issues): re-check each CVE against the current lock files. The
  dependency sweep merged on 2026-07-21 (#522–#552) and the standing ignores in
  `.github/dependabot.yml` resolved or consciously accepted many of them.
  Resolved or accepted → `OBSOLETE` with the deciding PR or the `dependabot.yml`
  ignore entry as evidence. Still present and unaccepted → `REAL`.
- `prod-incident` (3 issues, including #390): prod is currently reachable —
  `post-deploy-smoke.yml` is green. Classify `OBSOLETE`, evidence: the incident
  is not reproducible and the routine that maintained them is retired.
- `flaky-test` (#226): run the named test five times. Stable → `OBSOLETE`.
  Intermittent → `REAL`.
- `meta:heartbeat` (#364): the routine it alarms about is being disabled by Task
  1. Classify `OBSOLETE`, evidence: `linear-enrich` retired.

- [ ] **Step 5: Write the triage table and get approval before any close**

Create `docs/superpowers/plans/2026-07-23-auto-found-triage.md` with this exact
frontmatter and structure:

```markdown
---
status: draft
last_reviewed: 2026-07-23
owner: '@raphaelfh'
---

# auto-found backlog triage

One row per open `auto-found` issue at 2026-07-23. Verdicts drive the
liquidation described in the routines-system-cleanup spec.

| issue | age (d) | cited location | verdict | evidence |
|---|---|---|---|---|
| #531 | 5 | frontend/hooks/extraction/useTopLevelSectionsExtraction.ts | OBSOLETE | toasts already use t(); no hardcoded strings at HEAD |

## Totals

- OBSOLETE: N
- REAL: N
- UNVERIFIABLE: N

## Proposed close list

Every OBSOLETE issue number, comma-separated, ready for the maintainer to
approve.
```

Then verify the docs gates and commit:

```bash
npx -y markdownlint-cli@0.45.0 --config .github/markdownlint.json --ignore-path .markdownlintignore "**/*.md"
bash scripts/docs/check-frontmatter.sh
git add docs/superpowers/plans/2026-07-23-auto-found-triage.md
git commit -m "docs(triage): classify the 43 open auto-found issues against HEAD"
```

Expected: markdownlint exits 0, frontmatter check prints
`Frontmatter check passed for all tracked docs.`

**STOP HERE.** Present the totals and the proposed close list to the maintainer
and wait for explicit approval. Closing issues is outward-facing and
irreversible from this side; the approval to "liquidate the backlog" was given
for the approach, not for a specific list of issue numbers.

- [ ] **Step 6: After approval — close the OBSOLETE issues**

Only with the maintainer's explicit yes, and only the approved numbers:

```bash
gh issue close <N> --reason "not planned" --comment "Closed by the routines-system cleanup triage (2026-07-23). Verdict: OBSOLETE. Evidence: <the row's evidence>. The routine that filed this is retired; see docs/superpowers/specs/2026-07-23-routines-system-cleanup-design.md."
```

One call per issue, each with its own evidence line. Never a blind loop over the
whole label.

Verify:

```bash
gh issue list --state open --label auto-found --json number --jq 'length'
```

Expected: the `REAL` + `UNVERIFIABLE` count only.

- [ ] **Step 7: Hand off the REAL issues**

The `REAL` rows become a second plan. Do not start fixing them inside this plan —
the fixes are code changes with their own test cycles, grouped by root-cause
pattern rather than one PR per issue, and they need their own task breakdown.

Write the handoff as the final section of the triage document:

```markdown
## Next

The REAL rows are grouped by root-cause pattern below. Each group becomes one PR
in a follow-up plan.
```

---

## Probation review — 2026-08-20

The spec fixes a kill criterion in advance, and a criterion nobody revisits is
the exact failure this cleanup exists to remove. It is written here as a dated,
runnable check rather than left to memory.

On or after 2026-08-20, run:

```bash
gh pr list --state all --limit 100 --json number,state,headRefName,createdAt \
  --jq '.[] | select(.createdAt > "2026-07-23") | select(.headRefName|test("^(cleanup|bugfix)/")) | "\(.number) \(.state) \(.headRefName)"'
```

Decide against the numbers, not an impression:

- `bug-fix`: fewer than 2 `MERGED` PRs on `bugfix/*` branches out of four
  scheduled runs → delete the routine.
- `cleanup`: fewer than 2 `MERGED` PRs on `cleanup/*` branches out of four
  scheduled runs → delete the routine.

Also confirm the contract held:

```bash
gh issue list --state all --label auto-found --json number,createdAt \
  --jq '[.[] | select(.createdAt > "2026-07-23")] | length'
```

Expected: `0`. Any non-zero value means a routine is still filing issues, which
violates the output contract.

## Run log

Recorded as tasks complete.

| when | task | observation |
|---|---|---|
