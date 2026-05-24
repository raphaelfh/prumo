# Worker Hardening — Reconciliation

**Status:** COMPLETE · merged 2026-05-24 via PR [#128](https://github.com/raphaelfh/prumo/pull/128) (`worktree-worker-hardening`).

This directory archives the [`plan.md`](plan.md) that drove the 2026-05-24 Celery worker hardening on Railway. The plan was executed in full, with three emergent fixes that were not anticipated in the original spec. This README is the post-execution map between *what was planned* and *what shipped*.

---

## 1. Plan → commits mapping

| Plan PR | Scope | Status | Commits in `main` |
|---|---|---|---|
| **PR 1** — Shared runner + lazy clients (P0) | `app/worker/_runner.py`, refactor 4 task modules, drop `@lru_cache` from `get_supabase_client` | ✅ | `df0f6c7` `fix(worker): per-call event loop + lazy clients via shared runner`<br>`174bfb4` `fix(worker): tighten runner guard + translate worker tasks to English` |
| **PR 2** — Coverage + drift detection | Eager-mode integration tests, drift guard parsing `railway.toml`, lift `app/worker/*` out of coverage omit | ✅ | `35779ca` `test(worker): close coverage gap + add route/queue drift guards`<br>`a23b7de` `test(worker): tighten eager-mode commit guard + document drift regex` |
| **PR 3** — Observability + CI smoke | `NotRegistered` structured event, `.github/workflows/worker-smoke.yml`, `deployment.md` runbook, reconcile `backend-development` skill | ✅ | `daca274` `feat(worker): NotRegistered alert + CI smoke test for runner` |

All three PRs merged through the shared `worktree-worker-hardening` branch (PR #128).

## 2. Emergent fixes not in the plan

Three follow-ups were required during execution because the original spec under-modeled the failure mode. Future plans touching async + global state should anticipate these.

### 2.1 Per-task SQLAlchemy engine with `NullPool` — `075a437`

**The plan stopped one layer too high.** PR 1 dropped `@lru_cache` from `get_supabase_client`, which fixed the Supabase httpx leg of the bug. But the SQLAlchemy `async_engine` in `app/core/deps.py` is **also** a module-level global, and asyncpg's connection pool binds its `Future` waiters to the loop active on first checkout. A task that did a single DB query succeeded (template lookup → NotFound) because the pool never had to wait, but any task with two queries hit `RuntimeError: <Future ...> attached to a different loop` on the second.

Resolved by adding [`backend/app/worker/_session.py`](../../../../backend/app/worker/_session.py) — an async context manager `worker_session()` that builds a fresh engine with `NullPool` per task and disposes it on exit. Cost: one extra TCP connection per task, irrelevant at the worker's rates.

### 2.2 `task_unknown` signal handler — `403b8d6`

**The plan's `LoggedTask.on_failure` branch for `NotRegistered` was dead code.** Celery routes unregistered-task events through the **consumer's** `signals.task_unknown`, not through the task instance's `on_failure` callback — because there's no task instance to call `on_failure` on when the lookup itself fails. Fixed by adding a module-scope `@task_unknown.connect` handler in `celery_app.py` (lines 141-160 today). The `on_failure` branch was kept as defense in depth in case Celery's routing changes.

### 2.3 Worker-package i18n pass — `8ef3047`, `3d52435`, `174bfb4`

A lot of legacy Portuguese docstrings/comments in `app/worker/` were touched during the refactor and translated to English for consistency with the rest of the codebase. Not behavior-relevant but worth knowing — these commits show as worker-related but contain zero logic changes.

## 3. Additional CI hardening — `a1eeab0`

`worker-smoke.yml` initially called `uv sync --frozen`, but the lockfile is gitignored — CI was failing on every run. Dropped the flag; smoke is green since.

## 4. Lessons learned

- **"Drop the cache" is rarely enough.** Cross-loop hazards in async Python come from *any* global that owns loop-bound primitives — httpx clients, asyncpg pools, anything wrapping a `Future`. The audit needs to walk the full transitive graph, not just the entry point.
- **Celery's exception surfaces are split.** `on_failure` fires from a task instance; `task_unknown` fires from the consumer before any task instance exists. Plans involving `NotRegistered`/include-list drift must hook the signal, not the task callback.
- **One-query tasks hide pool bugs.** A regression test must include at least two sequential DB operations per task — single-query reproducers pass when the underlying pool is broken.
- **`uv sync --frozen` in CI requires `uv.lock` committed.** This repo gitignores lockfiles; any future CI job must use `uv sync` (no `--frozen`) or the lockfile policy must change.

## 5. Where the code lives now

| Concern | Path |
|---|---|
| Per-task async runner | [`backend/app/worker/_runner.py`](../../../../backend/app/worker/_runner.py) |
| Per-task SQLAlchemy session | [`backend/app/worker/_session.py`](../../../../backend/app/worker/_session.py) |
| Celery app + signal handlers | [`backend/app/worker/celery_app.py`](../../../../backend/app/worker/celery_app.py) |
| Runner regression tests | [`backend/tests/unit/test_worker_runner.py`](../../../../backend/tests/unit/test_worker_runner.py) |
| Eager-mode kwargs/contract tests | [`backend/tests/integration/test_worker_eager_mode.py`](../../../../backend/tests/integration/test_worker_eager_mode.py) |
| Route/queue drift guard | [`backend/tests/unit/test_celery_routes_drift.py`](../../../../backend/tests/unit/test_celery_routes_drift.py) |
| CI smoke (real worker + Redis) | [`.github/workflows/worker-smoke.yml`](../../../../.github/workflows/worker-smoke.yml) |
| Runbook | [`docs/architecture/deployment.md`](../../../../docs/architecture/deployment.md) §§ "Worker — task runner", "Observability — task-registry alerts" |
| AI-assistant guidance | [`.claude/skills/backend-development/SKILL.md`](../../../../.claude/skills/backend-development/SKILL.md) (line 208 + 233 reference the new runner) |

## 6. Not done — explicitly out of scope

These items appeared in the plan's "explicitly NOT modified" list and remain untouched. If revisited later, they need their own plan:

- `railway.toml`, `Dockerfile`, `Makefile` — no infra changes.
- `backend/app/services/*` — service-level refactors. The `article_scope: str  # noqa: ARG001` parameter in `export_extraction_task` was called out as a real code smell deserving a follow-up; not addressed here.
- Frontend E2E `extraction-export.e2e.ts` — its polite "skip when worker absent" branch is now informational only (CI smoke covers the gap), but the test itself was not modified.
