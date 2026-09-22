---
name: debugging
description: "Use the moment a prumo bug, failing or flaky test, or unexpected behavior is reported, before forming any hypothesis. Layers prumo's reproduction commands, evidence map and incident classes over `superpowers:systematic-debugging`."
---

# Debugging (prumo)

`superpowers:systematic-debugging` owns the method: the four phases, the iron law, the red flags, and its `root-cause-tracing.md` and `defense-in-depth.md`. Load it first. This file is prumo's delta: how to reproduce here, where state drifts, what to capture per incident class, and which layer closes each class.

## 1. A red loop before any theory

Phase 1 is done only when one command you have already run, its output shown, is **red-capable** (it asserts the user's exact symptom), **deterministic**, **fast** and **agent-runnable**. Build it in order of cost:

- a failing test at the seam that reaches the bug: `cd backend && uv run pytest tests/... -k <name> -x --tb=long`, or `npx vitest run <path> -t "<name>"`;
- `curl` against the local API with a real JWT;
- a Playwright script asserting on DOM, console or network (`npx playwright test <spec> --trace on`, then `npx playwright show-trace`);
- a throwaway harness calling the service directly, or `git bisect run` between a good and a bad SHA.

Tighten it: narrow the scope, pin time and seeds, assert the symptom rather than "didn't crash". For a flake, raise the reproduction rate: `cd backend && uv run --with pytest-repeat pytest <test> --count=50 -p no:randomly`, or Playwright `--repeat-each=20 --workers=1`. Then minimize: cut inputs, fixtures and steps one at a time until everything left is load-bearing; the minimal repro becomes the regression test. When no loop is possible, stop and say what you tried and what access you need.

A browser-pane repro runs Chromium, whose scroll anchoring absorbs height changes above the viewport that Safari shows. Before calling a jump or scroll-position bug "not reproducible", re-probe with `* { overflow-anchor: none }` injected, and ask which browser the user runs.

## 2. Evidence at every boundary

A prumo bug usually crosses two or more layers. Instrument all of them before choosing one:

```text
request (Pydantic) → endpoint (guard) → service → SQLAlchemy session (flush, commit)
  → Postgres (+ RLS for browser reads) → ApiResponse envelope
  → apiClient (schema.d.ts types) → TanStack cache → React render
```

- Bind ids once with structlog (`logger.bind(run_id=..., project_id=...)`). The request middleware already binds `trace_id` (from `x-trace-id`), and Celery tasks receive it as a `trace_id` argument: search the logs by it across the API → worker boundary.
- Tag every temporary probe with one unique prefix (`[DEBUG-a4f2]`) in Python and TypeScript, so cleanup is one `grep -rn` that must come back empty.
- The TanStack Query devtools show every key and cached entry: open them before adding logs.
- Diff recent history: `git log --oneline -20`, `git diff HEAD~5 -- backend/app/services backend/alembic`. Bugs in `extraction_*` or `hitl_*` usually sit next to a recent migration, a rename, or a key change.

| Class | What to capture |
|---|---|
| BOLA / authorization | Which guard from `.claude/rules/backend.md` § Ownership guards binds each client-supplied id? The API bypasses RLS, so a missing guard is the bug. RLS matters only for browser reads: `select policyname, cmd, qual, with_check from pg_policies where tablename = '<table>'`. |
| Run-state race (TOCTOU) | Is the check-then-write under `load_run_for_update` or `take_advisory_xact_lock`, in one transaction? Stages are `pending → extract → consensus → finalized`, plus `cancelled`. |
| Async | Every call to an `async def` is awaited: a bare coroutine is truthy and tests pass (mypy's `unused-coroutine` catches it). `asyncio.gather` without `return_exceptions=True` raises the first error while its siblings keep running and writing. |
| Session | Did the endpoint commit (`get_db` never does)? Is an ORM object crossing sessions or a Celery boundary, detached or stale? |
| Celery | `task_acks_late` is global: is the task idempotent on retry? Does the worker consume the task's queue (`--queues`)? |
| Error swallowing | A `.catch` or `except` returning success-shaped data; `Promise.all` losing one failure; an ignored Supabase `{ error }`. |
| Stale cache | The full query key: from a factory, carrying every id the query reads by; the right family invalidated. |
| Drift | Pydantic ↔ SQLAlchemy nullability and defaults; enum values in `POSTGRESQL_ENUM_VALUES`; `schema.d.ts` regenerated. |
| Test pollution | Fails only after another test: rerun with pytest-randomly's printed seed (`--randomly-seed=<n>`); look for a `db_session_real` test that did not clean up. A run hanging at setup with empty output is an orphaned advisory lock on the shared DB: `pg_stat_activity` shows one backend waiting on `pg_advisory_xact_lock` and one `idle in transaction`; recover with `pkill -f "uv run pytest"` and `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle in transaction'`. One full suite at a time against the local DB. |
| Local-only failure | Red on the long-lived local DB, green on CI's fresh one, can be the bug itself: ask which rows local has that CI lacks (E2E leftovers, clones, old data); prod looks like local. A backfill fixes past rows only; fix the code path that creates them too. |

### Is the red yours?

- Prove a failure predates your change by **names**, not counts: run the suite on your tree and on a stashed baseline, then `grep '^FAILED' | sed 's/ - .*//' | sort` each and `comm -13 base.txt mine.txt`. Run `alembic downgrade` **before** `git stash`, or alembic cannot locate the revision.
- When you sabotage a guard to prove a test, WIP-commit first or revert the sabotage by hand: `git checkout -- <file>` discards the uncommitted fix too.
- Bisect a Postgres crash in a separate container: a segfault restarts the whole shared cluster.
- A CI job retried to green: `gh run view --job <id> --log` serves the **latest** attempt, even for an attempt-1 id. Read the failed one with `gh run view <run> --attempt 1` and `gh api repos/raphaelfh/prumo/actions/jobs/<job-id>/logs`.
- A red pip-audit or npm-audit (`security-audit.yml`) queries live advisory DBs and runs only on manifest or lockfile changes, so on a dependency PR it usually means dev is red too. Confirm on a clean dev (`npm audit --omit=dev --audit-level=high`; for Python, query `api.osv.dev/v1/query`, since pip-audit crashes locally). Fix by raising the direct dependency's floor or `uv lock --upgrade-package <transitive>`; `npm audit fix --force` downgrades, so leave it alone.

## 3. Ranked, falsifiable hypotheses

Before testing any, list 3–5 hypotheses, ranked, each with its prediction ("if X is the cause, changing Y makes the symptom disappear"); a hypothesis with no prediction is a vibe. Show the list to the user when they are present. Compare against a working sibling (another endpoint or service of the same shape) and the canonical doc (`docs/reference/extraction-hitl-architecture.md`, the relevant section in full). Test in rank order, one variable at a time.

## 4. Fix at a correct seam, then close the class

- The regression test fails on `dev` and passes after the fix, at a seam that reproduces the bug as it happens at the call site. When the only reachable seam is too shallow, say so in the PR: a missing seam is a finding for `/improve-codebase-architecture`.
- Then ask which layer should have caught it, and add the cheapest check there, in that layer's own vocabulary:

| Layer | Closes | With |
|---|---|---|
| Pydantic request schema | malformed input | `extra="forbid"`, `Literal`, validators |
| Endpoint guard (authoritative for the API) | BOLA | the named guard, once, scope in the WHERE clause |
| Service | semantically wrong calls, races | `run_lifecycle_service`, row and advisory locks |
| Postgres | concurrent writers, scripts that skip the service | CHECK, FK `ondelete`, deferred triggers |
| RLS | browser (PostgREST) reads and writes | the `public.is_project_*` helpers, default-deny |
| Contract | backend ↔ frontend drift | the generated `schema.d.ts` and the CI `api-contract` job |

- Three failed fixes, or a fix that must "also update" the schema, the migration and the cache key, means the boundary is wrong: stop and discuss before fix #4.
- Before claiming it is fixed: `code-review`'s verification gate, the original loop rerun green, the debug-tag grep empty, and the hypothesis that held stated in the PR body.
