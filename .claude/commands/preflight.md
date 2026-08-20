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

## Headless credentials (why this works in non-interactive sessions)

The remote gates use **credential-based auth that persists across sessions**,
NOT interactive OAuth MCP servers (which cannot complete their login flow in a
headless / CI / cron run — the historical reason preflight kept RED-halting):

- **Supabase advisors** → the Management API with a Personal Access Token in
  env `SUPABASE_ACCESS_TOKEN` (`sbp_...`, created at
  <https://supabase.com/dashboard/account/tokens>; store it in a gitignored
  `.env` or your shell profile — never commit it). The Supabase MCP is only a
  fallback for interactive sessions. When neither is available the advisor gate
  degrades on DB-surface impact (WARN if the promotion touches no
  migrations/models, UNKNOWN if it does) instead of hard-blocking every deploy.
- **Railway** (worker/Redis) → the `railway` CLI (`railway login`, repo linked
  to prumo/production). MCP is fallback only.
- **Vercel** → the `vercel` CLI (`vercel login`).

So a fully headless preflight needs, once: `SUPABASE_ACCESS_TOKEN` set, and the
`railway` + `vercel` CLIs logged in. Missing only the Supabase PAT still yields a
usable gate for non-DB promotions (see the remote-supabase degradation).

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
1. Resolve advisors headlessly-first (same credential order as the
   remote-supabase gate). Project ref REF = `project_id` in
   <PROJECT_ROOT>/supabase/config.toml (fallback gdfslcfeobjdxihqtcsk).
   - If env SUPABASE_ACCESS_TOKEN is set: curl the Management API
       curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
         "https://api.supabase.com/v1/projects/$REF/advisors/security"
       curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
         "https://api.supabase.com/v1/projects/$REF/advisors/performance"
     (each returns {"lints":[...]}); require HTTP 200 + "lints".
   - Else ToolSearch "select:mcp__supabase__get_advisors" (max_results 3) and
     call get_advisors type="security" and type="performance" (the performance
     payload may exceed the token cap and be auto-saved to a file — read and
     json.load it; the path is in the error message; MCP shape is
     {"result":{"lints":[...]}}).
   - If neither credential is available, STOP and return
     "advisor baseline NOT written: no SUPABASE_ACCESS_TOKEN and no Supabase MCP".
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

Determine the gate status:
- Any command exits non-zero → FAIL.
- All exit 0 → PASS.

Return ONLY the following YAML block (no prose before or after):

gate: local-code
status: PASS | WARN | FAIL | UNKNOWN
summary: <one short line, e.g. "ruff 0 errors, eslint 0, vite build OK">
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

This gate MUST work headlessly (non-interactive / CI / cron), so it resolves a
Supabase credential in priority order and never hard-blocks merely because an
interactive OAuth MCP is unavailable. Resolve the project ref first: read
`project_id` from <PROJECT_ROOT>/supabase/config.toml (fallback:
gdfslcfeobjdxihqtcsk); call it REF.

CREDENTIAL RESOLUTION (stop at the first that works):

  PATH 1 — headless, PREFERRED. env `SUPABASE_ACCESS_TOKEN` (a Supabase
  Personal Access Token, `sbp_...`). If set, fetch advisors from the Management API:
    curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      "https://api.supabase.com/v1/projects/$REF/advisors/security"
    curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      "https://api.supabase.com/v1/projects/$REF/advisors/performance"
  Each returns {"lints":[...]}. Require HTTP 200 + a "lints" key before trusting
  (a 401/403 means the PAT is invalid — treat as "no credential", fall through).

  PATH 2 — interactive fallback. The Supabase MCP. ToolSearch
  "select:mcp__supabase__get_advisors,mcp__supabase__list_migrations,mcp__supabase__get_logs"
  (max_results 5). Usable only in a session that authenticated the MCP.

  PATH 3 — no credential. Do NOT crash to a blanket UNKNOWN. The advisor check
  is a DB-regression guard, so degrade on the pending promotion's DB-surface impact:
    git -C <PROJECT_ROOT> fetch origin --quiet
    DB_TOUCHED = `git -C <PROJECT_ROOT> diff --name-only origin/main...origin/dev -- \
                    backend/alembic/versions/ supabase/migrations/ backend/app/models/`
                 returns ≥1 path.
    - DB_TOUCHED = false → status WARN, and STOP (do not run A/B/C). Summary:
      "advisors unverified (no SUPABASE_ACCESS_TOKEN, no MCP); dev→main touches
      no DB surface, so advisors cannot have regressed — set SUPABASE_ACCESS_TOKEN
      for full verification." This is non-blocking (GREEN-with-notes).
    - DB_TOUCHED = true → status UNKNOWN, and STOP. Summary: "advisors unverified
      AND dev→main changes DB surface (migrations/models) — set
      SUPABASE_ACCESS_TOKEN (a Supabase PAT) or authenticate the Supabase MCP
      before promoting." This blocks (RED).

When a credential IS available (PATH 1 or 2), run three checks:

  A. Advisors vs the checked-in baseline. (Management API: the two curls above.
     MCP: get_advisors type="security" then "performance" — the performance
     payload may exceed the token cap and be auto-saved to a file; read and
     json.load it, its path is in the error message.) For every advisor compute:

       fingerprint = "<category>:<cache_key>"

     where <category> is the advisor's first `categories` entry lowercased
     ("security"/"performance") and <cache_key> is its `cache_key` verbatim
     (keep any spaces/commas). Read the baseline set from
     <PROJECT_ROOT>/.claude/skills/preflight/supabase-advisors.baseline
     (every non-blank line NOT starting with "#" is one known fingerprint).
     Partition the live advisors:
       - KNOWN = in the baseline → pre-existing backlog. Never FAILs, but ≥1
         KNOWN makes check A contribute WARN ("N known advisors (baselined)").
         Check A is PASS only when zero advisors of any kind are returned.
       - NEW = absent from the baseline → a real regression. NEW with level
         "ERROR"/"WARN"/"WARNING" → FAIL; NEW with "INFO" → WARN.
     No advisors at all → PASS. Baseline file missing/unreadable → WARN
     "advisor baseline missing, run /preflight --update-advisors-baseline".

  B. Migration drift (auth/storage only). MCP: list_migrations count vs
     `ls <PROJECT_ROOT>/supabase/migrations/*.sql | wc -l`. Management API:
     `GET /v1/projects/$REF/database/migrations` count vs the same local count.
     Mismatch → FAIL ("auth/storage migration drift"); match → PASS. If the
     migrations source is unavailable on the chosen path, note "migrations not
     checked on this path" (does not block). NOTE: Alembic state is checked
     indirectly via the Railway gate (its Dockerfile runs `alembic upgrade head`).

  C. Recent errors (last 5 min, level=error / status>=500). MCP get_logs, or
     the Management API logs endpoint. Any errors → WARN; none → PASS. If logs
     are unavailable on the chosen path, note "logs not checked" (does not block).

Aggregate: worst status across the checks that ran (FAIL > UNKNOWN > WARN > PASS).

Return ONLY the following YAML block:

gate: remote-supabase
status: PASS | WARN | FAIL | UNKNOWN
summary: <e.g. "0 new advisors (199 baselined) via PAT, migrations 12=12, 0 errors" OR "advisors unverified; dev→main touches no DB surface (WARN)">
evidence: |
  Credential: <PAT | MCP | none (DB_TOUCHED=<true|false>)>
  Advisors: <N new — list each fingerprint + level — and M baselined, or "not run">
  Migrations: <local=N, remote=N, or "not checked">
  Logs: <count and worst line, or "clean", or "not checked">
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

  D. Railway — worker + Redis health (via the authenticated Railway CLI —
     headless, no MCP; the repo is linked to the prumo/production environment).
     The worker has no public endpoint, so read its logs:
       1. `railway status 2>&1 | head`  — confirm Project "prumo" +
          Environment "production" (if it errors "Unauthorized" / "not linked",
          the CLI is unusable — fall back to the MCP below).
       2. `railway logs --service worker 2>&1 | head -80`  — in the most recent
          boot block look for:
            - "celery@... ready."               → worker accepting jobs
            - "Connected to redis://" (or no redis error) → Redis reachable
            - "Starting Container"               → a boot occurred
          celery-ready present AND no redis error → PASS. Boot present but the
          celery-ready marker missing → WARN. "[ERROR]" / "ConnectionError" /
          "Connection refused" in the recent block → FAIL.
     If the Railway CLI is unavailable/unauthenticated, fall back to
     `mcp__railway__get_logs` (service_id 7acd0799-9685-4445-971a-707bc1b9c41f,
     limit=40) with the same marker logic; if neither works, report the worker
     sub-check TOOL-MISSING (WARN-tier — do NOT fabricate a PASS/FAIL). Check C
     (curl /health) is independent of this and MUST still run regardless.

Aggregate: worst status across A, B, C, D wins (a TOOL-MISSING sub-check is
WARN-tier, never RED on its own).

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
