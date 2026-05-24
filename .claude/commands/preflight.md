---
description: Pre-deploy readiness gate — runs verification-before-completion locally then probes Vercel, Supabase and Railway. Read-only.
argument-hint: "[--local-only] [--remote-only]"
allowed-tools:
  - Task
  - Read
  - Bash(curl:*)
  - mcp__supabase__get_advisors
  - mcp__supabase__get_logs
  - mcp__supabase__list_migrations
  - mcp__16b9320c-bebb-4437-8372-470b05309b53__list_deployments
  - mcp__16b9320c-bebb-4437-8372-470b05309b53__get_deployment
  - mcp__16b9320c-bebb-4437-8372-470b05309b53__get_runtime_logs
  - mcp__railway__list_deployments
  - mcp__railway__get_logs
model: sonnet
---

# /preflight — Pre-Deploy Readiness Gate

User-supplied arguments: `$ARGUMENTS`

You are running the **preflight deploy-readiness gate** for prumo.
This is a **read-only** discipline: never write, never edit, never
deploy, never commit. You only verify and report.

The output decides whether the working tree is safe to ship. Treat the
`verification-before-completion` skill's iron law as your operating
principle:

> NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.

A sub-agent that returns `PASS` but cannot show evidence is downgraded
to `UNKNOWN`. There is no "should pass" — only fresh outputs you can
cite.

---

## Phase 1 — Parse arguments

Inspect `$ARGUMENTS`. Compute two booleans:

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
- `prompt`: the corresponding template below, verbatim
- `run_in_background`: false

Project root for all commands: `/Users/raphael/PycharmProjects/prumo`.

---

### Sub-agent prompt — `local-code`  (only if `RUN_LOCAL`)

```text
You are the `local-code` preflight gate for prumo. READ-ONLY: do NOT
edit, write, commit, or modify any file. You may only run commands and
read their output.

From /Users/raphael/PycharmProjects/prumo, run each command and capture
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

If that does not return HTTP 200, STOP and return UNKNOWN with summary
"local stack not running — start with `make start` first" — the e2e
suite needs both backend and frontend up.

Then from /Users/raphael/PycharmProjects/prumo run each command and
capture exit code + last 20 lines of stdout+stderr:

  1. make test-backend
  2. npm run test:run
  3. npm run test:e2e:local

Any non-zero exit → FAIL. All zero → PASS.

Return ONLY the following YAML block (no prose before or after):

gate: local-tests
status: PASS | WARN | FAIL | UNKNOWN
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

  A. Advisors. Call get_advisors with type="security" then with
     type="performance". For each advisor, treat severity:
       - "ERROR" or "WARN" / "WARNING" → contributes FAIL
       - "INFO" → contributes WARN
       - none returned → contributes PASS

  B. Migration drift. Call list_migrations and compare its returned
     count to the number of *.sql files under
     /Users/raphael/PycharmProjects/prumo/supabase/migrations/
     (you may shell out: `ls /Users/raphael/PycharmProjects/prumo/supabase/migrations/*.sql | wc -l`).
     Mismatch → FAIL ("auth/storage migration drift"). Match → PASS.
     NOTE: this checks auth/storage migrations only — Alembic state is
     checked indirectly via the Railway gate (Railway's Dockerfile CMD
     runs `alembic upgrade head` before gunicorn boots).

  C. Recent errors. Call get_logs for the last 5 minutes filtering to
     errors only (level=error or status>=500). Any error rows → WARN
     (could be benign noise). None → PASS.

Aggregate: the worst status across A, B, C wins (FAIL > WARN > PASS).

Return ONLY the following YAML block:

gate: remote-supabase
status: PASS | WARN | FAIL | UNKNOWN
summary: <e.g. "0 advisors, migrations 12=12, 0 errors in 5min">
evidence: |
  Advisors: <compact list, severity + title>
  Migrations: <local=N, remote=N>
  Logs: <count and worst line, or "clean">
```

---

### Sub-agent prompt — `remote-deploys`  (only if `RUN_REMOTE`)

```text
You are the `remote-deploys` preflight gate for prumo. READ-ONLY.

Four checks across Vercel and Railway (web + worker + Redis):

  A. Vercel — latest deployment.
     Call mcp__16b9320c-bebb-4437-8372-470b05309b53__list_deployments
     to find the most recent deployment for the prumo project.
     - readyState != "READY" → FAIL
     - readyState == "READY" but the deployment is older than 24h → WARN
       (stale; main might have moved without a deploy)
     - readyState == "READY" within 24h → PASS

  B. Vercel — runtime logs.
     Call mcp__16b9320c-bebb-4437-8372-470b05309b53__get_runtime_logs
     for the last 15 minutes on that deployment. Any HTTP 5xx → WARN.
     Clean → PASS.

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

Skipped gates (because of `--local-only` / `--remote-only`) are listed
with `STATUS = SKIPPED` and `SUMMARY = "skipped by flag"`.

Then, on a fresh line, the verdict:

- All non-skipped gates `PASS` → `## RESULT: GREEN — safe to deploy`
- Mix of `PASS` and `WARN` (no FAIL, no UNKNOWN) →
  `## RESULT: GREEN with N warn(s) — review warnings before deploy`
- Any `FAIL` or `UNKNOWN` →
  `## RESULT: RED — N gate(s) blocked, DO NOT deploy`

Below the verdict, for every non-PASS gate, paste the gate name as a
`### <gate-name>` header followed by that gate's full `evidence:`
block, so the user sees the failing output without re-running.

Do NOT add commentary beyond the table, the verdict, and the
evidence blocks. Do NOT suggest fixes. Do NOT estimate severity. The
output is the gate; the user decides what to do with it.
