---
description: Pre-deploy readiness gate — runs verification-before-completion locally then probes Vercel, Supabase and Railway. Read-only.
argument-hint: "[--local-only] [--remote-only]"
allowed-tools:
  - Task
  - Read
  - Bash(curl:*)
  - Bash(vercel:*)
  - Bash(railway:*)
  - Bash(git rev-parse:*)
  - mcp__supabase__get_advisors
  - mcp__supabase__get_logs
  - mcp__supabase__list_migrations
  - mcp__railway__list_deployments
  - mcp__railway__get_logs
model: sonnet
---

# /preflight — Pre-Deploy Readiness Gate

User-supplied arguments: `$ARGUMENTS`

You are running the **preflight deploy-readiness gate** for prumo.
This is a **read-only** discipline: never write, never edit, never
deploy, never commit. You only verify and report. The single exception
is the `--update-advisors-baseline` maintenance mode (Phase 1), which
dispatches one subagent to rewrite the advisor baseline file and does
nothing else — the gate orchestrator itself never writes.

The output decides whether the working tree is safe to ship. Treat the
`verification-before-completion` skill's iron law as your operating
principle:

> NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.

A sub-agent that returns `PASS` but cannot show evidence is downgraded
to `UNKNOWN`. There is no "should pass" — only fresh outputs you can
cite.

---

## Phase 1 — Parse arguments & resolve the checkout

First resolve the checkout under test. Run:

    git rev-parse --show-toplevel

and call the result `PROJECT_ROOT`. This is the repo root of whatever
checkout invoked `/preflight` — the **main checkout or any git worktree
under `.claude/worktrees/`**. Preflight validates the code you are about
to ship, so every local command below runs from `PROJECT_ROOT`, not a
hard-coded path. If `git rev-parse` fails (not a repo), fall back to the
current working directory.

Now inspect `$ARGUMENTS`.

**Maintenance mode.** If `--update-advisors-baseline` appears, do NOT run
any gates. Instead dispatch exactly one `Task` sub-agent
(`subagent_type: general-purpose`) with this prompt (substitute the
resolved `PROJECT_ROOT`), print the one-line summary it returns, and
STOP:

```text
Regenerate the Supabase advisor baseline for prumo. Steps:
1. ToolSearch "select:mcp__supabase__get_advisors" (max_results 3) to load the tool.
2. Call get_advisors type="security" (fits inline) and type="performance".
   The performance call may exceed the token cap and be auto-saved to a
   file — if so, the error message gives the path; read and json.load
   that file. Both payloads have shape {"result":{"lints":[...]}}.
3. For EVERY advisor in both sets, build fingerprint
   f"{categories[0].lower()}:{cache_key}" using the advisor's first
   category and its cache_key verbatim (keep spaces/commas).
4. Read <PROJECT_ROOT>/.claude/skills/preflight/supabase-advisors.baseline
   and keep its leading comment block (every line starting with "#").
5. Write that comment block, followed by the deduped ascending-sorted
   fingerprints (one per line, trailing newline), back to the same path.
6. Return ONE line: "advisor baseline written: N fingerprints (S security,
   P performance) -> <path>".
```

**Gate mode** (no `--update-advisors-baseline`). Compute two booleans:

- `RUN_LOCAL = true` unless `--remote-only` appears.
- `RUN_REMOTE = true` unless `--local-only` appears.

If both `--local-only` and `--remote-only` appear, abort with:
`ERROR: --local-only and --remote-only are mutually exclusive`.

If neither flag appears, both are true (the default).

## Phase 2 — Announce

In one line, state which gates will run. Example:

> Running 4 gates in parallel: local-code, local-tests, remote-supabase, remote-deploys.

## Phase 3 — Dispatch sub-agents IN PARALLEL

Issue the `Task` tool calls **in a single message** — this is what
makes them parallel. For each active gate use:

- `subagent_type: general-purpose`
- `description`: short label (e.g. `"local-code preflight gate"`)
- `prompt`: the corresponding template below, with every `<PROJECT_ROOT>`
  placeholder replaced by the path you resolved in Phase 1
- `run_in_background`: false

Project root for all commands: the `PROJECT_ROOT` resolved in Phase 1
(the checkout that invoked `/preflight`).

---

### Sub-agent prompt — `local-code`  (only if `RUN_LOCAL`)

```text
You are the `local-code` preflight gate for prumo. READ-ONLY: do NOT
edit, write, commit, or modify any file. You may only run commands and
read their output.

From <PROJECT_ROOT>, run each command and capture
the exit code plus the last 20 lines of combined stdout+stderr:

  1. make lint-backend
  2. make lint-frontend
  3. npm run build
  4. make db-lint-migrations
     (if this fails with "squawk: command not found" or similar
     "not installed", treat that single command as WARN, not FAIL)

Determine the gate status:
- Any command exits non-zero (except #4 when squawk is missing) → FAIL.
- Only #4 fails because squawk is missing → WARN.
- All exit 0 → PASS.

Return ONLY the following YAML block (no prose before or after):

gate: local-code
status: PASS | WARN | FAIL | UNKNOWN
summary: <one short line, e.g. "ruff 0 errors, eslint 0, vite build OK, squawk missing">
evidence: |
  <last 20 lines of the most relevant command output (the failing one if any, else the build)>
```

---

### Sub-agent prompt — `local-tests`  (only if `RUN_LOCAL`)

```text
You are the `local-tests` preflight gate for prumo. READ-ONLY: do NOT
edit, write, commit, or modify any file.

STEP 0 — preflight check the local stack:
  curl -fsS --max-time 3 http://localhost:8000/health

If that does not return HTTP 200, STOP and return SKIPPED with summary
"local stack down — start with `make start`" and no evidence. The e2e
leg needs both backend and frontend up; when the stack is down this gate
has nothing to prove, so it is skipped (non-blocking), NOT a failure.
Do not treat a down stack as UNKNOWN — that is reserved for gates that
crash or return untrustworthy output.

Then from <PROJECT_ROOT> run each command and
capture exit code + last 20 lines of stdout+stderr:

  1. make test-backend
  2. npm run test:run
  3. npm run test:e2e:local

Any non-zero exit → FAIL. All zero → PASS.

Return ONLY the following YAML block (no prose before or after):

gate: local-tests
status: PASS | WARN | FAIL | SKIPPED | UNKNOWN
summary: <e.g. "pytest 412/412, vitest 184/184, playwright 47/47">
evidence: |
  <last 20 lines from the worst command — failure if any, else the slowest passing one>
```

---

### Sub-agent prompt — `remote-supabase`  (only if `RUN_REMOTE`)

```text
You are the `remote-supabase` preflight gate for prumo. READ-ONLY.
Use only the Supabase MCP tools (mcp__supabase__*).

Run three checks:

  A. Advisors vs the checked-in baseline. Call get_advisors with
     type="security" then type="performance" (the performance payload may
     exceed the token cap and be auto-saved to a file — if so, read and
     json.load that file; its path is in the error message). For every
     advisor compute a fingerprint:

       fingerprint = "<category>:<cache_key>"

     where <category> is the advisor's first `categories` entry lowercased
     ("security"/"performance") and <cache_key> is its `cache_key` verbatim
     (keep any spaces/commas).

     Read the baseline set from
     <PROJECT_ROOT>/.claude/skills/preflight/supabase-advisors.baseline
     (every non-blank line NOT starting with "#" is one known fingerprint).
     Partition the live advisors:
       - KNOWN = fingerprint present in the baseline → the pre-existing
         backlog. These never FAIL the gate, but the presence of ≥1 KNOWN
         advisor makes check A contribute WARN (a non-blocking "N known
         advisors (baselined)" note). Check A is PASS only when
         get_advisors returns zero advisors of any kind.
       - NEW = fingerprint absent from the baseline → a real regression.
         A NEW advisor with level "ERROR"/"WARN"/"WARNING" → contributes
         FAIL; a NEW advisor with level "INFO" → contributes WARN.
     No advisors returned at all → PASS. If the baseline file is missing
     or unreadable, do NOT fail — report WARN "advisor baseline missing,
     run /preflight --update-advisors-baseline" (nothing can be ratcheted).

  B. Migration drift. Call list_migrations and compare its returned
     count to the number of *.sql files under
     <PROJECT_ROOT>/supabase/migrations/
     (you may shell out: `ls <PROJECT_ROOT>/supabase/migrations/*.sql | wc -l`).
     Mismatch → FAIL ("auth/storage migration drift"). Match → PASS.
     NOTE: this checks auth/storage migrations only — Alembic state is
     checked indirectly via the Railway gate (Railway's Dockerfile CMD
     runs `alembic upgrade head` before gunicorn boots).

  C. Recent errors. Call get_logs for the last 5 minutes filtering to
     errors only (level=error or status>=500). Any error rows → WARN
     (could be benign noise). None → PASS.

Aggregate: the worst status across A, B, C wins (FAIL > WARN > PASS).
A non-empty baseline backlog therefore lands this gate at WARN (not
FAIL) until a NEW advisor appears.

Return ONLY the following YAML block:

gate: remote-supabase
status: PASS | WARN | FAIL | UNKNOWN
summary: <e.g. "0 new advisors (199 baselined), migrations 12=12, 0 errors in 5min">
evidence: |
  Advisors: <N new — list each new fingerprint + level — and M baselined>
  Migrations: <local=N, remote=N>
  Logs: <count and worst line, or "clean">
```

---

### Sub-agent prompt — `remote-deploys`  (only if `RUN_REMOTE`)

```text
You are the `remote-deploys` preflight gate for prumo. READ-ONLY.

Four checks across Vercel and Railway (web + worker + Redis):

  A. Vercel — latest deployment.
     Run: vercel ls --prod --yes 2>&1 | head -20
     to find the most recent production deployment for the prumo project.
     - state/status != "Ready" → FAIL
     - "Ready" but the deployment is older than 24h → WARN
       (stale; main might have moved without a deploy)
     - "Ready" within 24h → PASS
     If the vercel CLI is unavailable or unauthenticated, report this
     check as TOOL-MISSING (not UNKNOWN) with the exact error.

  B. Vercel — runtime logs.
     Run: vercel inspect <deployment-url-from-A> --logs 2>&1 | tail -40
     Any HTTP 5xx in recent output → WARN. Clean → PASS.
     CLI unavailable → TOOL-MISSING.

  C. Railway — backend health (web service).
     Run: curl -fsS --max-time 10 -o /dev/null -w "%{http_code}" \
            https://web-production-48b398.up.railway.app/health
     - HTTP 200 → PASS
     - Anything else, or curl exit non-zero → FAIL

  D. Railway — worker + Redis health.
     The worker has no public endpoint, so probe via Railway MCP:
       1. Call mcp__railway__list_deployments with service_id
          7acd0799-9685-4445-971a-707bc1b9c41f (worker service in the
          prumo project, environment production). Take the latest
          deployment.
          - status != "SUCCESS" → FAIL ("worker last deploy <status>")
          - status == "SUCCESS" → continue
       2. Call mcp__railway__get_logs for the same worker service with
          limit=40. Look for two markers in the most recent boot block:
            - "Connected to redis://" → Redis reachable
            - "celery@... ready." → worker accepting jobs
          Both present → PASS. Either missing → WARN. Both missing or
          presence of "[ERROR]" / "ConnectionError" → FAIL.
     This single check covers both the worker process and Redis — if
     Redis is down, the worker logs will show "Connection refused" and
     the gate fails fast.

Aggregate: worst status across A, B, C, D wins.

Return ONLY the following YAML block:

gate: remote-deploys
status: PASS | WARN | FAIL | UNKNOWN
summary: <e.g. "Vercel READY 2h ago / no 5xx / Railway /health 200 / worker+Redis ready">
evidence: |
  Vercel: <deployment id, readyState, age>
  Vercel logs: <5xx count or "clean">
  Railway web: <status code from /health>
  Railway worker: <last deploy status, "redis ready" / "redis err">
```

---

## Phase 4 — Verify the evidence (DO NOT SKIP)

For every YAML returned by a sub-agent:

1. Parse it. If `status: PASS` but `evidence:` is empty, missing, or
   obviously synthetic (i.e. no command output, just a paraphrase) →
   **downgrade to UNKNOWN** with summary
   `"no evidence attached, cannot trust"`.
2. If a sub-agent did not return at all (timeout / crash) → record
   that gate as UNKNOWN.
3. A `status: SKIPPED` gate is expected to carry no evidence (its
   precondition was absent) — do NOT downgrade it to UNKNOWN. This
   applies only to PASS.

This implements the `verification-before-completion` red flag
"Trusting agent success reports". Do not skip this phase to save time.

## Phase 5 — Print the final report

Print exactly this format (Markdown table):

```
| GATE             | STATUS  | SUMMARY                                      |
|------------------|---------|----------------------------------------------|
| local-code       | <STAT>  | <one-line summary>                           |
| local-tests      | <STAT>  | <one-line summary>                           |
| remote-supabase  | <STAT>  | <one-line summary>                           |
| remote-deploys   | <STAT>  | <one-line summary>                           |
```

A gate is listed with `STATUS = SKIPPED` when it was excluded by a flag
(`--local-only` / `--remote-only`, summary `"skipped by flag"`) or when a
precondition was absent (e.g. `local-tests` with the local stack down,
summary `"local stack down — start with make start"`). SKIPPED is always
**non-blocking**: it never causes RED. It counts as a WARN-tier note.

Then, on a fresh line, the verdict (treat `WARN` and `SKIPPED` together
as "notes"):

- Every gate `PASS` (no WARN, no SKIPPED, no FAIL, no UNKNOWN) →
  `## RESULT: GREEN — safe to deploy`
- No `FAIL` and no `UNKNOWN`, but at least one `WARN` or `SKIPPED` →
  `## RESULT: GREEN with N note(s) — review before deploy`
  (N = count of WARN + SKIPPED gates; name each in the line)
- Any `FAIL` or `UNKNOWN` →
  `## RESULT: RED — N gate(s) blocked, DO NOT deploy`

Below the verdict, for every gate whose status is `FAIL`, `UNKNOWN`, or
`WARN` and that carries an `evidence:` block, paste the gate name as a
`### <gate-name>` header followed by that gate's full `evidence:` block,
so the user sees the relevant output without re-running. (SKIPPED gates
have no evidence — just show them in the table.)

Do NOT add commentary beyond the table, the verdict, and the
evidence blocks. Do NOT suggest fixes. Do NOT estimate severity. The
output is the gate; the user decides what to do with it.
