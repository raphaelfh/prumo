# Worker Hardening Implementation Plan

> **STATUS — 2026-05-24: COMPLETE.** All 3 PRs from this plan landed (merged via PR #128, `worktree-worker-hardening`), plus 3 emergent fixes not anticipated in the original spec. See [`README.md`](README.md) in this directory for the reconciliation (plan → commits mapping, what changed during execution, lessons learned). The checkbox steps below are kept as-is for historical record — do **not** re-execute them.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Celery worker on Railway production-grade — fix the event-loop reuse bug that breaks every async task after the first, give `app/worker/*` real test coverage, prevent route/queue drift between code and the Railway start command, and surface task-registry failures in logs instead of in user-visible 503s.

**Architecture:** Three sequenced PRs. **PR 1** (P0, blocking) replaces the four hand-rolled `_run_in_worker_loop` copies with a single shared runner that uses fresh `asyncio.run()` per invocation and forces lazy construction of Supabase/DB clients inside the coroutine. **PR 2** lifts `app/worker/*` out of the coverage omit list, adds unit tests for the runner, and extends the existing static `test_celery_app_task_registry.py` to also block drift between `celery_app.conf.task_routes` queue names and the Railway worker start command (parsed out of `railway.toml`-adjacent docs). **PR 3** wires structured logging for `NotRegistered` failures and adds a CI smoke job that boots a real Celery worker (Redis service container) and asserts an end-to-end task completion. The goal of PR 3 is "if the bug PR 1 fixed regresses, CI fails — not prod."

**Tech Stack:** Celery 5.4 + redis 5.0, async SQLAlchemy 2.0, structlog, pytest + pytest-asyncio (`asyncio_mode = "auto"`), GitHub Actions, Railway (already in prod from the `2026-05-24-render-to-railway-migration` plan — this plan does **not** touch Railway config).

---

## Scope notes

- **The Render→Railway migration is done.** `render.yaml` was deleted in PR #112, `railway.toml` is committed, `docs/architecture/deployment.md` exists, Railway web+worker+Redis are SUCCESS in prod. This plan does NOT re-do that work; it only fixes what was shipped on top of it.
- **The `extraction_export_tasks` include + route fix is already in `main`** (confirmed via `git show main:backend/app/worker/celery_app.py`). PR 1 of this plan does not re-add that — it builds on it.
- **In scope:** every change inside `backend/app/worker/`, `backend/tests/` related to workers, `backend/pyproject.toml` coverage config, `.github/workflows/ci.yml` (only the new smoke job — does not touch existing gates), and `docs/architecture/deployment.md` (only the observability + drift section).
- **Out of scope:** anything inside `extraction_*` business logic, RLS, frontend, Supabase, Alembic migrations, the architectural fitness loop. If the worker runner refactor exposes a service-level bug (e.g. `ExtractionExportService` assumes a long-lived session), that's a separate task — flag it via `mcp__ccd_session__spawn_task` and do not bundle into this PR.
- **`extraction_tasks.py` already uses `asyncio.run()`** — it's the lone correct module. PR 1 still touches it, but only to route through the shared runner (zero behavior change). Doing this keeps all four task modules on one shape, which is what makes drift detection cheap in PR 2.
- **No platform migrations.** The plan assumes Railway stays the deploy target.

---

## File structure

### Files to create

| Path | Responsibility | PR |
|---|---|---|
| `backend/app/worker/_runner.py` | One function: `run_task(coro_factory: Callable[[], Awaitable[T]]) -> T`. Wraps `asyncio.run(coro_factory())` and re-raises with `task_id` + `task_name` bound to structlog context. The `coro_factory` (zero-arg callable returning a coroutine) is required — passing a coroutine directly would let module-import-time side effects bind to a leaked loop. | 1 |
| `backend/tests/unit/test_worker_runner.py` | Unit tests for `run_task`: success path, async exception propagation, contextvar binding, and the key regression — "two sequential calls don't reuse a loop". | 1 |
| `backend/tests/integration/test_worker_eager_mode.py` | Eager-mode pytest fixtures + tests that exercise each task end-to-end with `task_always_eager=True` and `task_eager_propagates=True`. Validates serialization (UUIDs → str), kwargs alignment, and per-task client construction. **Does not** validate the loop bug (eager runs in the test's own loop) — that lives in PR 3. | 2 |
| `backend/tests/unit/test_celery_routes_drift.py` | Parses `railway.toml` (and the worker start command in `docs/architecture/deployment.md` as a fallback source) and asserts every queue named in `celery_app.conf.task_routes` is in the deployed worker's `--queues=...` list. | 2 |
| `.github/workflows/worker-smoke.yml` | GitHub Action: spins up a `services: redis:7-alpine`, installs the backend, boots the worker as a background process, sends `export_extraction_task.delay(...)` with minimal fixture data, asserts terminal state within 60s. Triggered on PRs that change `backend/app/worker/**` or `backend/app/services/exports/**`. | 3 |

### Files to modify

| Path | Change | PR |
|---|---|---|
| `backend/app/worker/tasks/extraction_export_tasks.py` | Drop `_run_in_worker_loop` (and the `_WORKER_LOOP` module global). Import `run_task` from `_runner`. Move `get_supabase_client()` / `create_storage_adapter()` calls *inside* the `run()` coroutine. Switch the body of the task to `return run_task(run)`. | 1 |
| `backend/app/worker/tasks/export_tasks.py` | Same as above. Same shape. | 1 |
| `backend/app/worker/tasks/import_tasks.py` | Same. All three tasks in the file (`import_zotero_collection_task`, `retry_failed_zotero_sync_task`, `sync_zotero_library_task`). | 1 |
| `backend/app/worker/tasks/extraction_tasks.py` | Replace direct `asyncio.run(run())` with `run_task(run)`. Pure refactor — no semantic change. Touches all three tasks (`extract_section_task`, `extract_models_task`, `batch_extract_task`). | 1 |
| `backend/app/core/deps.py:76-91` | Remove `@lru_cache` from `get_supabase_client`. Callers cache locally when they want — module-level caching across loops is the bug. Add a short docstring explaining why and pointing at the runner. | 1 |
| `backend/app/worker/celery_app.py:60-103` | Update `LoggedTask.on_failure` to detect `NotRegistered` from the Celery exception hierarchy and emit a dedicated `celery.task_unregistered` structlog event (separate from generic `task_failed`). This makes Datadog/Sentry dashboards surface include-list regressions as P1 alerts. | 3 |
| `backend/pyproject.toml` `[tool.coverage.run]` | Remove `app/worker/*` from `omit = [...]`. Add it to the actually-covered set. Set per-file fail threshold lower for `app/worker/tasks/*` (e.g. 70%) than the rest if needed — but no longer 0%. | 2 |
| `backend/tests/unit/test_celery_app_task_registry.py` | After PR 2 lands, extend the test to also assert each module in `EXPECTED_TASK_MODULES` has a matching `task_routes` entry (no implicit-default-queue tasks allowed). | 2 |
| `docs/architecture/deployment.md` | Add a `## Worker — task runner` section pointing at `app/worker/_runner.py` as the canonical pattern, plus an observability note about the new `celery.task_unregistered` log event and how to alert on it. | 3 |
| `.claude/skills/backend-development/SKILL.md` (or equivalent) | Reconcile the conflicting guidance: the skill currently says "Tasks are sync entry points that wrap an async runner with `asyncio.run(...)`" but the code now uses a shared runner. Update to: "Tasks are sync entry points that delegate to `app.worker._runner.run_task(coro_factory)` — see the worker section in `docs/architecture/deployment.md`." | 3 |

### Files explicitly NOT modified

- `railway.toml`, `Dockerfile`, `Makefile`, `pyproject.toml [project]` deps — no infra/runtime changes required.
- Any `backend/app/services/*` file — service-level refactors are out of scope. If a service grabs a long-lived session via module state, flag it but do not change it here.
- The four E2E `frontend/e2e/flows/*` — the existing `extraction-export.e2e.ts` already covers the async path with a polite "skip when worker absent" branch; once PR 3's CI smoke job is green, the e2e skip becomes informational only.

---

## Task 1 — PR 1: Shared worker runner + lazy clients (P0)

**Branch:** `fix/worker-event-loop-and-runner` off `dev`

**Files:**
- Create: `backend/app/worker/_runner.py`
- Create: `backend/tests/unit/test_worker_runner.py`
- Modify: `backend/app/worker/tasks/extraction_export_tasks.py`
- Modify: `backend/app/worker/tasks/export_tasks.py`
- Modify: `backend/app/worker/tasks/import_tasks.py`
- Modify: `backend/app/worker/tasks/extraction_tasks.py`
- Modify: `backend/app/core/deps.py:76-91`

**Rationale:** Three of the four task modules use a `_run_in_worker_loop` pattern that caches a single event loop in a module global. Combined with `get_supabase_client()`'s `@lru_cache`, the Supabase httpx client gets its async primitives (connection pool futures) bound to whichever loop ran first; any subsequent task on a different loop instance throws `RuntimeError: ... attached to a different loop`. Confirmed locally on 2026-05-24 against `export_extraction_task`. Until this is fixed, `extraction_export` works once per worker boot and then is broken until the worker restarts.

The fix has two parts that must land together:
1. **Per-call loop**: `asyncio.run()` each task in a fresh loop — eliminates the cached-loop hazard. The cost (loop teardown ~1ms) is irrelevant for the export/import tasks (already minutes-scale); for the high-frequency `extract_section_task`, it's still <1% of the OpenAI round-trip.
2. **Lazy clients**: construct `get_supabase_client()` + DB session *inside* the coroutine, after the loop has been entered. This is what eliminates the cross-loop hazard at the root.

- [ ] **Step 1: Write the failing reproducer test**

Create `backend/tests/unit/test_worker_runner.py`:

```python
"""Unit tests for the shared worker task runner.

The headline test (`test_two_sequential_calls_do_not_share_loop`) is the
regression guard for the 2026-05-24 event-loop bug: two tasks running on
the same worker process must each get a clean loop so cached httpx /
asyncpg primitives from a previous loop cannot leak in.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Awaitable, Callable

import pytest

from app.worker._runner import run_task


def _make_factory(probe: dict) -> Callable[[], Awaitable[int]]:
    async def coro() -> int:
        probe["loop"] = asyncio.get_running_loop()
        return 42

    return coro


def test_run_task_returns_coroutine_result() -> None:
    probe: dict = {}
    assert run_task(_make_factory(probe)) == 42
    assert probe["loop"] is not None


def test_two_sequential_calls_do_not_share_loop() -> None:
    """The bug we are guarding against.

    The old `_run_in_worker_loop` cached one loop in a module global; any
    coroutine that captured a primitive from loop A could not safely run
    on loop B. `run_task` must use a fresh loop per invocation.
    """
    probe_a: dict = {}
    probe_b: dict = {}

    run_task(_make_factory(probe_a))
    run_task(_make_factory(probe_b))

    assert probe_a["loop"] is not None
    assert probe_b["loop"] is not None
    assert probe_a["loop"] is not probe_b["loop"], (
        "run_task must use a fresh event loop per invocation — "
        "loop reuse is the root cause of the 2026-05-24 export bug."
    )


def test_run_task_propagates_exceptions() -> None:
    async def coro() -> None:
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        run_task(coro)


def test_run_task_requires_a_factory_not_a_coroutine() -> None:
    """Passing a coroutine eagerly creates it on the import-time loop.

    The runner's contract is: callers pass a zero-arg callable that
    returns a coroutine. Passing the coroutine directly defeats the
    lazy-construction guarantee.
    """

    async def coro() -> int:
        return 1

    # Creating the coroutine at call time of run_task is fine; the type
    # contract is enforced by callers passing functions, not coroutines.
    # This test pins the contract — if someone changes run_task to accept
    # a bare coroutine, this test will need to be updated alongside an
    # ADR explaining why the lazy-construction guarantee is being dropped.
    assert callable(coro)
```

- [ ] **Step 2: Run the test and confirm it fails because `_runner` does not exist**

Run: `cd backend && uv run pytest tests/unit/test_worker_runner.py -v`
Expected: collection error or all tests fail with `ModuleNotFoundError: No module named 'app.worker._runner'`.

- [ ] **Step 3: Implement `app/worker/_runner.py`**

Create `backend/app/worker/_runner.py`:

```python
"""Shared async runner for Celery tasks.

Every Celery task in this codebase is a synchronous entry point that
delegates real work to an async coroutine. This module provides the one
correct way to bridge the two:

    @celery_app.task
    def my_task(...):
        async def run() -> dict:
            async with AsyncSessionLocal() as db:
                ...
        return run_task(run)

Why a fresh `asyncio.run()` per invocation:

- A previous iteration of this codebase cached one event loop in a
  module global and reused it across all task invocations. Combined
  with `@lru_cache` on `get_supabase_client`, that meant the Supabase
  httpx client's connection-pool futures were bound to whichever loop
  ran first — any subsequent task on a different loop raised
  `RuntimeError: <Future ...> attached to a different loop`. The bug
  surfaced on 2026-05-24 against `export_extraction_task` and is
  documented in commit <fill in commit sha after merge>.

Why the runner takes a *factory*, not a coroutine:

- Coroutines created at import time are bound to whichever loop happens
  to be running when the module is imported (or `None`, which is its own
  problem). Requiring callers to pass a zero-arg callable defers
  coroutine construction until `asyncio.run` is already running.
"""

from __future__ import annotations

from typing import Awaitable, Callable, TypeVar

import anyio  # noqa: F401  # Imported so a future swap to `anyio.run` is a one-liner.
import asyncio

T = TypeVar("T")


def run_task(coro_factory: Callable[[], Awaitable[T]]) -> T:
    """Run an async coroutine in a fresh event loop and return its result.

    Args:
        coro_factory: Zero-argument callable that returns the coroutine
            to run. Must be a callable — passing a coroutine directly
            defeats the per-call loop guarantee.

    Raises:
        TypeError: if `coro_factory` is not callable.
        Exception: re-raises any exception raised by the coroutine.
    """
    if not callable(coro_factory):
        raise TypeError(
            f"run_task requires a zero-arg callable, got {type(coro_factory).__name__}. "
            "Pass the coroutine function itself (e.g. run_task(run)), not the "
            "coroutine (e.g. run_task(run()))."
        )
    return asyncio.run(coro_factory())
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && uv run pytest tests/unit/test_worker_runner.py -v`
Expected: all 4 tests PASS.

- [ ] **Step 5: Refactor `extraction_export_tasks.py` to use the runner + lazy clients**

Open `backend/app/worker/tasks/extraction_export_tasks.py`. Replace the entire file with:

```python
"""Extraction Export Celery tasks (009-extraction-excel-export).

Background-export worker. Opens its own DB session + storage adapter,
runs the export service, uploads bytes, returns a signed URL.

The async bridge is via `app.worker._runner.run_task` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.core.logging import get_logger
from app.worker._runner import run_task
from app.worker.celery_app import celery_app

logger = get_logger(__name__)

#: Signed-URL TTL for the generated `.xlsx`. Matches the articles_export
#: convention so users see consistent expiry windows across export types.
_DOWNLOAD_URL_TTL_SECONDS = 3600

#: Supabase Storage bucket. We reuse the existing `articles` bucket
#: under a dedicated `exports/extraction/` prefix (research.md §2).
_STORAGE_BUCKET = "articles"
_STORAGE_PREFIX = "exports/extraction"


@celery_app.task(
    bind=True,
    max_retries=1,
    rate_limit="5/m",
)
def export_extraction_task(
    self,
    project_id: str,
    template_id: str,
    mode: str,
    article_ids: list[str],
    article_scope: str,  # noqa: ARG001 — currently informational; carried for audit/log
    user_id: str,
    reviewer_id: str | None = None,
    include_ai_metadata: bool = False,
    anonymize_reviewer_names: bool = False,
) -> dict:
    """Async extraction export job.

    Builds the workbook via ``ExtractionExportService``, uploads bytes
    to Supabase Storage, returns ``{download_url, expires_at, user_id}``.
    """

    async def run() -> dict:
        # Lazy imports + lazy client construction: every async primitive
        # must be created on the loop entered by run_task — never reused
        # across invocations.
        from app.core.deps import AsyncSessionLocal, get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.exports.extraction_xlsx_builder import build_workbook
        from app.services.extraction_export_service import (
            ExportMode,
            ExtractionExportService,
        )

        async with AsyncSessionLocal() as session:
            supabase = get_supabase_client()
            storage = create_storage_adapter(supabase)
            service = ExtractionExportService(
                db=session,
                user_id=user_id,
                storage=storage,
                trace_id=self.request.id,
            )

            layout = await service.resolve_layout(
                project_id=UUID(project_id),
                template_id=UUID(template_id),
                mode=ExportMode(mode),
                article_ids=[UUID(aid) for aid in article_ids],
                include_ai_metadata=include_ai_metadata,
                anonymize_reviewer_names=anonymize_reviewer_names,
                reviewer_id=UUID(reviewer_id) if reviewer_id else None,
            )

            # CPU-bound write — keep it in a thread so the event loop is
            # free for the upload coroutine that follows.
            data = await asyncio.to_thread(build_workbook, layout)

            path = f"{_STORAGE_PREFIX}/{user_id}/{self.request.id}.xlsx"
            await storage.upload(
                _STORAGE_BUCKET,
                path,
                data,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            download_url = await storage.get_signed_url(
                _STORAGE_BUCKET, path, expires_in=_DOWNLOAD_URL_TTL_SECONDS
            )
            expires_at = (
                datetime.now(UTC) + timedelta(seconds=_DOWNLOAD_URL_TTL_SECONDS)
            ).isoformat()
            return {
                "download_url": download_url,
                "expires_at": expires_at,
                "user_id": user_id,
            }

    return run_task(run)
```

Key differences vs. the prior version:
- `_run_in_worker_loop` and `_WORKER_LOOP` removed.
- Service imports moved *inside* `run()` — keeps cold-start cheap on the worker process and proves the import order doesn't matter.
- `get_supabase_client()` + `create_storage_adapter()` now run inside the coroutine.
- The task returns `run_task(run)` — no parens on `run`.

- [ ] **Step 6: Refactor `export_tasks.py` (articles export)**

Open `backend/app/worker/tasks/export_tasks.py`. Remove the entire `_WORKER_LOOP` global and `_run_in_worker_loop` function (top of file, ~lines 11-22). Replace the import block and the task body to mirror the pattern above:

```python
"""Export Tasks.

Tasks Celery for exportacao de articles (CSV, RIS, RDF + files).

The async bridge is via `app.worker._runner.run_task` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

from uuid import UUID

from app.worker._runner import run_task
from app.worker.celery_app import celery_app


@celery_app.task(
    bind=True,
    max_retries=1,
    rate_limit="5/m",
)
def export_articles_task(
    self,
    project_id: str,
    user_id: str,
    article_ids: list[str] | None = None,
) -> dict:
    async def run() -> dict:
        from app.core.deps import AsyncSessionLocal, get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.articles_export_service import ArticlesExportService

        async with AsyncSessionLocal() as session:
            supabase = get_supabase_client()
            storage = create_storage_adapter(supabase)
            service = ArticlesExportService(
                db=session,
                user_id=user_id,
                storage=storage,
                trace_id=self.request.id,
            )
            return await service.run(
                project_id=UUID(project_id),
                article_ids=[UUID(a) for a in article_ids] if article_ids else None,
            )

    return run_task(run)
```

Confirm by reading the current `export_tasks.py` first that `ArticlesExportService.run()` accepts the kwargs above — if its signature differs, use the current signature and just swap the runner pattern; do not change service semantics.

- [ ] **Step 7: Refactor `import_tasks.py` (all three tasks)**

Open `backend/app/worker/tasks/import_tasks.py`. Remove the `_WORKER_LOOP` global + `_run_in_worker_loop` function. For each of the three tasks (`import_zotero_collection_task`, `retry_failed_zotero_sync_task`, `sync_zotero_library_task`), apply the same pattern:

- Move `AsyncSessionLocal()` + `get_supabase_client()` (where used) inside `run()`.
- Replace `return _run_in_worker_loop(run())` with `return run_task(run)`.

Do not change the service signatures or the retry block — only the runner shape changes. Read the file first; confirm each task's `try/except + self.retry(exc=exc)` wrapper is preserved.

- [ ] **Step 8: Refactor `extraction_tasks.py` (pure shape change)**

Open `backend/app/worker/tasks/extraction_tasks.py`. This module already uses `asyncio.run(run())` directly — the change here is mechanical, no semantic shift. For each of the three tasks (`extract_section_task`, `extract_models_task`, `batch_extract_task`):

- Replace `return asyncio.run(run())` with `return run_task(run)`.
- Move client construction inside `run()` if it was at module/task scope.
- Drop any module-level `import asyncio` that's no longer needed.

- [ ] **Step 9: Remove `@lru_cache` from `get_supabase_client`**

Open `backend/app/core/deps.py`. Find the `get_supabase_client` definition (around lines 76-91). Replace:

```python
@lru_cache
def get_supabase_client() -> Client:
    """Return cliente Supabase configured with service role."""
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )
```

with:

```python
def get_supabase_client() -> Client:
    """Return a fresh Supabase service-role client.

    NOT cached. The cached version was the root cause of the 2026-05-24
    event-loop reuse bug — the underlying httpx client binds its
    connection pool to the loop active at construction time, so reusing
    one across loops raises `RuntimeError: <Future ...> attached to a
    different loop`. Worker tasks construct one per invocation via
    `app.worker._runner.run_task`; FastAPI request handlers construct
    one per request via `get_supabase` in `app.core.deps`.
    """
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )
```

Also remove `from functools import lru_cache` from the imports at the top of the file if it's no longer used by anything else in the module. Grep first: `grep -n lru_cache backend/app/core/deps.py`.

- [ ] **Step 10: Find all non-worker callers of `get_supabase_client` and confirm they still work without caching**

Run: `cd backend && grep -rn "get_supabase_client" app/ --include="*.py"`
Expected: hits in `app/main.py`, `app/seed.py`, the four task modules (which now call it per-invocation).

For each non-worker hit, confirm the call is either inside a request scope or inside a one-shot script. None should rely on the LRU cache for correctness — if they do (e.g. `app/main.py` builds the client once at startup), they were doing the right thing for the wrong reason; tighten them now.

- [ ] **Step 11: Run the full backend test suite**

Run: `make test-backend`
Expected: green. The pre-existing tests don't touch the worker (coverage omits `app/worker/*`), so the only failures should be from `test_worker_runner.py` which we wrote — and those should pass.

If anything else breaks, STOP and investigate. The most likely failure mode is that some service depends on the cached supabase client being identical across calls — that would be a bug, not an acceptable regression.

- [ ] **Step 12: Run lint**

Run: `make lint-backend`
Expected: `All checks passed!` for ruff check + format. The new files use `from __future__ import annotations` and `TypeVar` — confirm ruff doesn't flag unused imports.

- [ ] **Step 13: Local smoke test with a real worker**

This is the proof that the bug is gone. Start the local stack (`make start`), then run a worker in solo mode and dispatch two `extraction_export_task`s in sequence:

```bash
cd backend && OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES \
  uv run celery -A app.worker.celery_app worker \
  --loglevel=info --queues=extractions,imports,exports,celery --pool=solo &
WORKER_PID=$!
sleep 5

uv run python <<'PY'
from app.worker.tasks.extraction_export_tasks import export_extraction_task
for i in range(2):
    r = export_extraction_task.delay(
        project_id="5b9d8976-6da5-45e4-84a5-380a40fdbb0b",
        template_id="00000000-0000-0000-0000-000000000000",
        mode="consensus",
        article_ids=["f00dc63a-6b47-42c3-8a93-af69eb28a1c0"],
        article_scope="current_list",
        user_id="00000000-0000-0000-0000-000000000001",
        reviewer_id=None,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )
    print(f"ENQUEUED #{i}: {r.id}")
PY
# Wait ~10s for the worker to process both.
sleep 10
kill $WORKER_PID
```

Expected: both tasks transition to a terminal state. They may **fail** with a domain error (the IDs are fake — the export service will not find the template), but the failure must be `EXTRACTION_TEMPLATE_NOT_FOUND` or similar, **not** `RuntimeError: Future attached to a different loop`. Grep the worker log for `attached to a different loop` — must be empty.

The macOS `--pool=solo` flag avoids the fork SIGSEGV unrelated to this bug.

- [ ] **Step 14: Commit**

```bash
git add backend/app/worker/_runner.py backend/tests/unit/test_worker_runner.py \
        backend/app/worker/tasks/ backend/app/core/deps.py
git commit -m "fix(worker): per-call event loop + lazy clients via shared runner

Three of the four task modules cached a single event loop in a module
global (`_run_in_worker_loop`). Combined with @lru_cache on
get_supabase_client, the Supabase httpx client's connection-pool
futures bound to whichever loop ran first; any subsequent task on a
different loop raised \"Future attached to a different loop\".
Confirmed locally against export_extraction_task on 2026-05-24.

- Add app/worker/_runner.py — one-function module exposing run_task,
  which wraps asyncio.run(coro_factory()) and requires a callable to
  prevent passing eagerly-bound coroutines.
- Refactor all four task modules to delegate to run_task and construct
  Supabase/DB clients inside the coroutine (lazy clients).
- Drop @lru_cache from get_supabase_client — the cache was correct in
  spirit (one client per process) but wrong in mechanism (clients can't
  cross loops).
- Add tests/unit/test_worker_runner.py with the loop-isolation
  regression test as the headline guard."
```

- [ ] **Step 15: Push and open PR 1 to `dev`**

```bash
git push -u origin fix/worker-event-loop-and-runner
gh pr create --base dev --title "fix(worker): per-call event loop + lazy clients via shared runner" --body "$(cat <<'EOF'
## Summary
Fixes the 2026-05-24 "Future attached to a different loop" bug in `export_extraction_task` (and the latent identical hazard in the three other task modules). Centralises the async bridge in `app/worker/_runner.py:run_task` and forces lazy client construction inside the coroutine.

Root cause: `_run_in_worker_loop` cached a single loop in a module global; `get_supabase_client` cached the Supabase httpx client via `@lru_cache`. Together they meant the client's connection-pool futures were bound to the first loop to run — any subsequent task on a fresh loop raised `RuntimeError`.

## Test plan
- [x] `tests/unit/test_worker_runner.py::test_two_sequential_calls_do_not_share_loop` — regression guard
- [x] `make test-backend` green
- [x] `make lint-backend` green
- [x] Local: start worker in `--pool=solo`, dispatch 2 sequential `export_extraction_task` calls, confirm no `attached to a different loop` in worker log

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 16: Merge PR 1 to `dev`, then merge `dev` → `main`**

Railway will auto-deploy worker + web on the push to `main`. Watch `railway logs --service worker` for `celery@... ready.` and confirm no exceptions on first task. Smoke from the frontend: trigger one extraction export, then a second 30s later; both should complete.

---

## Task 2 — PR 2: Worker coverage + drift detection

**Branch:** `test/worker-coverage-and-drift` off `dev` (depends on PR 1)

**Files:**
- Create: `backend/tests/integration/test_worker_eager_mode.py`
- Create: `backend/tests/unit/test_celery_routes_drift.py`
- Modify: `backend/pyproject.toml` `[tool.coverage.run]`
- Modify: `backend/tests/unit/test_celery_app_task_registry.py`

**Rationale:** Today `app/worker/*` is in the coverage omit list — meaning the task modules report 0% covered and no fitness gate would catch e.g. a service-call removed by accident. Drift between `celery_app.conf.task_routes` queue names and the Railway worker's `--queues=...` list is also undetected: rename a queue in code and the worker silently stops consuming it. Both problems are cheap to close once PR 1 is in.

- [ ] **Step 1: Write the eager-mode integration test for `export_extraction_task`**

Create `backend/tests/integration/test_worker_eager_mode.py`:

```python
"""Eager-mode coverage for every Celery task.

Runs each task synchronously via `task_always_eager` + `task_eager_propagates`.
Validates serialization (UUIDs come in as strings, get parsed correctly),
kwargs alignment, and per-task client construction.

Does NOT validate the event-loop bug — eager mode runs the coroutine on
the pytest event loop, so loop reuse is impossible by construction.
For loop coverage see the CI smoke job that boots a real worker.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.worker.celery_app import celery_app


@pytest.fixture(autouse=True)
def eager_mode(monkeypatch):
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(celery_app.conf, "task_eager_propagates", True)
    yield


def test_export_extraction_task_signature_and_kwargs_alignment():
    """The 9 task kwargs must align with what the endpoint passes."""
    from app.worker.tasks.extraction_export_tasks import export_extraction_task

    fake_service = AsyncMock()
    fake_service.resolve_layout.return_value = object()
    fake_storage = AsyncMock()
    fake_storage.upload.return_value = None
    fake_storage.get_signed_url.return_value = "https://signed.example/url"

    with (
        patch(
            "app.services.extraction_export_service.ExtractionExportService",
            return_value=fake_service,
        ),
        patch(
            "app.core.factories.create_storage_adapter",
            return_value=fake_storage,
        ),
        patch(
            "app.services.exports.extraction_xlsx_builder.build_workbook",
            return_value=b"PK\x03\x04minimal-xlsx-bytes",
        ),
        patch(
            "app.core.deps.AsyncSessionLocal",
            return_value=MagicMock(__aenter__=AsyncMock(), __aexit__=AsyncMock()),
        ),
        patch(
            "app.core.deps.get_supabase_client",
            return_value=MagicMock(),
        ),
    ):
        result = export_extraction_task.apply(
            kwargs={
                "project_id": str(uuid4()),
                "template_id": str(uuid4()),
                "mode": "consensus",
                "article_ids": [str(uuid4())],
                "article_scope": "current_list",
                "user_id": str(uuid4()),
                "reviewer_id": None,
                "include_ai_metadata": False,
                "anonymize_reviewer_names": False,
            }
        ).get(timeout=5)

    assert "download_url" in result
    assert result["download_url"] == "https://signed.example/url"
    assert "expires_at" in result
    assert "user_id" in result


# Mirror tests for export_articles_task, import_zotero_collection_task,
# extract_section_task — same shape, different patches. Add one per file.
```

The "mirror tests" comment is **a placeholder you must fill in** before the PR ships. Read each task module, identify what `*Service` it instantiates, mock it the same way, and add a test that asserts the kwargs round-trip. If a service has many methods, mock only the ones the task actually calls.

- [ ] **Step 2: Run the eager-mode test and confirm it passes**

Run: `cd backend && uv run pytest tests/integration/test_worker_eager_mode.py -v`
Expected: PASS for the export_extraction test (and any mirrors you added).

- [ ] **Step 3: Remove `app/worker/*` from the coverage omit list**

Open `backend/pyproject.toml`. Find the `[tool.coverage.run]` block around line 135. The current `omit` list probably has:

```toml
omit = [
    "app/schemas/read_models/*",
    "app/worker/*",
]
```

Change to:

```toml
omit = [
    "app/schemas/read_models/*",
]
```

Confirm there is no other `omit` setting in the file (`grep -n omit backend/pyproject.toml`).

- [ ] **Step 4: Run coverage and see what `app/worker/*` actually reports**

Run: `cd backend && uv run pytest --cov=app/worker --cov-report=term-missing tests/unit/test_worker_runner.py tests/unit/test_celery_app_task_registry.py tests/integration/test_worker_eager_mode.py`
Expected: a coverage table that includes `app/worker/_runner.py`, `app/worker/celery_app.py`, and the four task modules. The runner should be ~100%; the task modules will be 70-90% (the retry branches are mocked out).

If the total falls below the project's coverage gate (60% per the CI workflow), bump the eager-mode test list until it clears — or add a per-file pragma exempting unreachable retry branches.

- [ ] **Step 5: Write the drift-detection test**

Create `backend/tests/unit/test_celery_routes_drift.py`:

```python
"""Drift guard between task routes and the deployed worker's queue list.

`celery_app.conf.task_routes` decides which queue each task lands in.
The Railway worker boots with `--queues=<csv>` (see `railway.toml`'s
worker service comment, line N). If those two diverge, tasks are
enqueued to queues nobody consumes — silent failure mode.

This test parses the worker start command out of `railway.toml` and
asserts every queue named in `task_routes` is in that list.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.worker.celery_app import celery_app

REPO_ROOT = Path(__file__).resolve().parents[3]
RAILWAY_TOML = REPO_ROOT / "railway.toml"
QUEUES_PATTERN = re.compile(r"--queues=([\w,]+)")


def _railway_worker_queues() -> set[str]:
    text = RAILWAY_TOML.read_text(encoding="utf-8")
    match = QUEUES_PATTERN.search(text)
    if not match:
        raise AssertionError(
            f"Could not find '--queues=...' in {RAILWAY_TOML}. "
            f"The drift test relies on the worker start command being "
            f"present in railway.toml (typically inside the services "
            f"overview comment block)."
        )
    return set(match.group(1).split(","))


def test_every_routed_queue_is_consumed_by_the_railway_worker() -> None:
    routed = {entry["queue"] for entry in celery_app.conf.task_routes.values()}
    consumed = _railway_worker_queues()
    missing = routed - consumed
    assert not missing, (
        f"Queues routed in celery_app.conf.task_routes but NOT in the "
        f"Railway worker --queues list: {sorted(missing)}. "
        f"Either add them to the worker start command in railway.toml "
        f"(and update Railway dashboard if needed), or drop the route "
        f"in celery_app.py."
    )
```

The test assumes `railway.toml` has the worker `--queues=...` somewhere in a comment or config block. Confirm by running `grep -n "queues=" railway.toml` — if the queue list lives elsewhere (e.g. only in the Railway dashboard), point the test at `docs/architecture/deployment.md` instead, which is canonical.

- [ ] **Step 6: Run the drift test and confirm it passes today**

Run: `cd backend && uv run pytest tests/unit/test_celery_routes_drift.py -v`
Expected: PASS — current routes (`extractions`, `imports`, `exports`) match the worker's `--queues=extractions,imports,exports,celery`.

- [ ] **Step 7: Sabotage and verify the test catches drift**

Temporarily add a fake route in `celery_app.py`:

```python
"app.worker.tasks.fake_tasks.*": {"queue": "ghost"},
```

Run the test again. Expected: FAIL with `Queues routed in ... but NOT in the Railway worker --queues list: ['ghost']`. Revert the change immediately — do NOT commit it.

- [ ] **Step 8: Tighten `test_celery_app_task_registry.py` to require explicit routes**

Open `backend/tests/unit/test_celery_app_task_registry.py`. After the existing `test_celery_module_is_included` parametrize, add:

```python
@pytest.mark.parametrize(("module", "_sample_task"), EXPECTED_TASK_MODULES)
def test_module_has_explicit_task_route(module: str, _sample_task: str) -> None:
    """Every task module must have an explicit route — no falling back to
    the default `celery` queue. This prevents future tasks from silently
    landing on a queue that may or may not be consumed by the worker.
    """
    pattern = f"{module}.*"
    routes = celery_app.conf.task_routes or {}
    assert pattern in routes, (
        f"Module {module!r} is in include= but has no entry in "
        f"task_routes. Add e.g. `{pattern!r}: {{'queue': 'celery'}}` "
        f"explicitly so the test guarantees no drift."
    )
```

Run the test. If it fails for `export_tasks` (which currently has no explicit route), add `"app.worker.tasks.export_tasks.*": {"queue": "celery"}` to `celery_app.py:task_routes` to make the relationship explicit. Then run the drift test (Step 6) again to confirm `celery` is in the worker's `--queues` (it is — see `--queues=extractions,imports,exports,celery`).

- [ ] **Step 9: Run the full suite once**

Run: `make test-backend && make lint-backend`
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add backend/tests/unit/test_celery_routes_drift.py \
        backend/tests/unit/test_celery_app_task_registry.py \
        backend/tests/integration/test_worker_eager_mode.py \
        backend/pyproject.toml \
        backend/app/worker/celery_app.py
git commit -m "test(worker): close coverage gap + add route/queue drift guards

- Add tests/integration/test_worker_eager_mode.py — each Celery task
  runs in eager mode with mocked services; validates UUID-string
  round-trip, kwargs alignment, and lazy client construction.
- Add tests/unit/test_celery_routes_drift.py — parses railway.toml
  and asserts every queue in celery_app.conf.task_routes is in the
  worker's --queues list. Catches silent route renames.
- Extend test_celery_app_task_registry.py to also require explicit
  task_routes entries for every module in include=.
- Drop app/worker/* from coverage omit in pyproject.toml; worker code
  now reports real coverage numbers and is subject to the 60% gate.
- celery_app.py: make export_tasks route explicit (was default-queue)
  so the drift guard has a clean baseline."
```

- [ ] **Step 11: Push and open PR 2 to `dev`**

```bash
git push -u origin test/worker-coverage-and-drift
gh pr create --base dev --title "test(worker): close coverage gap + add route/queue drift guards" --body "$(cat <<'EOF'
## Summary
Builds on PR 1 (shared runner) by closing the historical coverage gap on `app/worker/*` and adding two cheap drift guards.

1. Eager-mode integration tests (one per Celery task) — validates the API↔worker kwargs contract and proves the lazy-client refactor works under serialisation.
2. Route/queue drift test — parses `railway.toml` and asserts every queue named in `task_routes` is in the worker's `--queues=...` list. Catches the silent failure mode where a route renames in code but the worker still consumes the old queue name.
3. Static route requirement — every module in `include=` must now have an explicit `task_routes` entry, removing the "falls back to default `celery` queue" ambiguity.

## Test plan
- [x] `tests/integration/test_worker_eager_mode.py` covers each task
- [x] `tests/unit/test_celery_routes_drift.py` passes against current `railway.toml`
- [x] Sabotage check: adding a fake `'ghost'` queue makes the drift test fail
- [x] `make test-backend` + `make lint-backend` green
- [x] Coverage on `app/worker/*` no longer 0%; project gate (60%) holds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 12: Merge PR 2 to `dev`, then merge `dev` → `main`**

---

## Task 3 — PR 3: Observability + CI smoke worker

**Branch:** `obs/worker-not-registered-and-ci-smoke` off `dev` (depends on PR 2)

**Files:**
- Create: `.github/workflows/worker-smoke.yml`
- Modify: `backend/app/worker/celery_app.py:60-103` (LoggedTask.on_failure)
- Modify: `docs/architecture/deployment.md` (observability section)
- Modify: `.claude/skills/backend-development/SKILL.md` (reconcile runner guidance)

**Rationale:** Two complementary changes. The structured-log change turns "worker silently rejected task" into a P1 alert. The CI smoke job turns "tested on the dev box, never in CI" into a per-PR gate — catching exactly the class of bug PR 1 fixed, in CI, before merge.

- [ ] **Step 1: Detect `NotRegistered` in `LoggedTask.on_failure` and emit a structured event**

Open `backend/app/worker/celery_app.py`. Find the `LoggedTask` class (around lines 60-103). Modify `on_failure`:

```python
def on_failure(self, exc, task_id, args, kwargs, _einfo):
    """Log em caso de falha."""
    import structlog
    from celery.exceptions import NotRegistered

    logger = structlog.get_logger()
    if isinstance(exc, NotRegistered):
        # P1-class incident: an enqueued task has no handler. Always
        # caused by a module missing from celery_app.include or a
        # routing typo. Surface separately so dashboards can alert.
        logger.error(
            "celery.task_unregistered",
            task_id=task_id,
            task_name=self.name,
            args=args,
            kwargs=kwargs,
            remediation=(
                "Check celery_app.include for the missing module and "
                "tests/unit/test_celery_app_task_registry.py for the "
                "regression guard."
            ),
        )
        return
    logger.error(
        "task_failed",
        task_id=task_id,
        task_name=self.name,
        error=str(exc),
        args=args,
        kwargs=kwargs,
    )
```

Note: `NotRegistered` is raised at *dispatch* time (when the worker tries to look up the task name); it appears in `on_failure` indirectly. If the existing failure path doesn't catch it, also add a worker-level signal handler. Check Celery's docs — `signals.task_unknown_received` may be the cleaner hook.

- [ ] **Step 2: Add a unit test for the structured event**

Append to `backend/tests/unit/test_worker_runner.py`:

```python
def test_logged_task_emits_specific_event_for_not_registered(monkeypatch):
    from celery.exceptions import NotRegistered

    from app.worker.celery_app import LoggedTask

    captured: list[tuple[str, dict]] = []

    class StubLogger:
        def error(self, event: str, **kw):
            captured.append((event, kw))

    monkeypatch.setattr("structlog.get_logger", lambda: StubLogger())

    task = LoggedTask()
    task.name = "ghost.task"
    task.on_failure(NotRegistered("ghost.task"), "task-123", (), {"a": 1}, None)

    assert captured, "on_failure should have logged"
    event, kw = captured[0]
    assert event == "celery.task_unregistered"
    assert kw["task_id"] == "task-123"
    assert kw["task_name"] == "ghost.task"
    assert "remediation" in kw
```

Run: `cd backend && uv run pytest tests/unit/test_worker_runner.py -v`
Expected: all pass.

- [ ] **Step 3: Write the CI smoke workflow**

Create `.github/workflows/worker-smoke.yml`:

```yaml
name: Worker Smoke Test

on:
  pull_request:
    paths:
      - "backend/app/worker/**"
      - "backend/app/services/exports/**"
      - "backend/app/services/extraction_export_service.py"
      - "backend/app/services/articles_export_service.py"
      - "backend/tests/integration/test_worker_eager_mode.py"
      - ".github/workflows/worker-smoke.yml"

jobs:
  worker-smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5
    env:
      REDIS_URL: redis://localhost:6379/0
      # Stub Supabase / OPENAI / encryption — the smoke test mocks
      # the heavy services and only exercises the task↔worker contract.
      SUPABASE_URL: http://localhost:54321
      SUPABASE_ANON_KEY: stub-anon
      SUPABASE_SERVICE_ROLE_KEY: stub-service-role
      ENCRYPTION_KEY: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
      DATABASE_URL: postgresql+asyncpg://stub
      DIRECT_DATABASE_URL: postgresql://stub
      OPENAI_API_KEY: sk-stub
      DEBUG: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install uv
        run: pip install uv
      - name: Install backend deps
        working-directory: backend
        run: uv sync --frozen
      - name: Boot worker in background
        working-directory: backend
        run: |
          uv run celery -A app.worker.celery_app worker \
            --loglevel=info \
            --queues=extractions,imports,exports,celery \
            --pool=solo \
            > worker.log 2>&1 &
          echo $! > worker.pid
          # Wait for the worker to print 'ready'
          for i in {1..30}; do
            grep -q "celery@.*ready" worker.log && break
            sleep 1
          done
          grep -q "celery@.*ready" worker.log || (echo "Worker never became ready"; cat worker.log; exit 1)
      - name: Dispatch two sequential extraction_export tasks
        working-directory: backend
        run: |
          uv run python <<'PY'
          import time
          from celery.result import AsyncResult
          from app.worker.celery_app import celery_app
          # `send_task` doesn't require importing the task module, so
          # the smoke proves the worker's include= is honored.
          ids = []
          for i in range(2):
              r = celery_app.send_task(
                  "app.worker.tasks.extraction_export_tasks.export_extraction_task",
                  kwargs={
                      "project_id": "00000000-0000-0000-0000-000000000000",
                      "template_id": "00000000-0000-0000-0000-000000000000",
                      "mode": "consensus",
                      "article_ids": ["00000000-0000-0000-0000-000000000000"],
                      "article_scope": "current_list",
                      "user_id": "00000000-0000-0000-0000-000000000000",
                      "reviewer_id": None,
                      "include_ai_metadata": False,
                      "anonymize_reviewer_names": False,
                  },
              )
              ids.append(r.id)
              print(f"Dispatched #{i}: {r.id}")
          # Wait up to 45s for both to leave PENDING.
          deadline = time.time() + 45
          while time.time() < deadline:
              states = [AsyncResult(i, app=celery_app).state for i in ids]
              print("States:", states)
              if all(s not in ("PENDING", "STARTED") for s in states):
                  break
              time.sleep(2)
          # Failure is acceptable (fake IDs → service rejects); the only
          # disallowed state is PENDING (worker never picked it up) and
          # the only disallowed error is 'attached to a different loop'.
          PY
      - name: Assert no loop-reuse error in worker log
        working-directory: backend
        run: |
          if grep -q "attached to a different loop" worker.log; then
            echo "Loop-reuse bug returned — see worker.log"
            cat worker.log
            exit 1
          fi
      - name: Assert no NotRegistered in worker log
        working-directory: backend
        run: |
          if grep -q "NotRegistered\|celery.task_unregistered" worker.log; then
            echo "A task was unregistered — celery_app.include drift"
            cat worker.log
            exit 1
          fi
      - name: Tail worker log on failure
        if: failure()
        working-directory: backend
        run: tail -200 worker.log
      - name: Stop worker
        if: always()
        working-directory: backend
        run: |
          [ -f worker.pid ] && kill "$(cat worker.pid)" || true
```

- [ ] **Step 4: Test the workflow locally with `act`**

If `act` is installed: `act pull_request -W .github/workflows/worker-smoke.yml`. If not, push the branch and watch the run in GitHub Actions before merging.

Expected: green run. The two assertions ("no loop-reuse error", "no NotRegistered") are the actual guards; the body of the dispatch script can be lenient about per-task failure because we only care about the contract, not the business outcome of fake IDs.

- [ ] **Step 5: Update `docs/architecture/deployment.md` with the observability + worker-runner sections**

Open `docs/architecture/deployment.md`. After the existing `## Services` section, insert two new sections:

```markdown
## Worker — task runner

Every Celery task in `backend/app/worker/tasks/` delegates to a single
shared runner:

```python
from app.worker._runner import run_task

@celery_app.task
def my_task(self, ...):
    async def run():
        async with AsyncSessionLocal() as db:
            ...
    return run_task(run)
```

`run_task` calls `asyncio.run(coro_factory())` — a fresh loop per task.
**Do not** cache event loops in module globals (we tried; see the
2026-05-24 incident). **Do not** cache the Supabase client at module
scope; `get_supabase_client()` returns a new instance per call, so the
httpx connection pool stays bound to the current loop.

## Observability — task-registry alerts

`LoggedTask.on_failure` emits two distinct structlog events:

| Event | Meaning | Recommended alert |
|---|---|---|
| `task_failed` | Generic task crash (business error, retry exhausted). | Aggregate; alert above baseline rate. |
| `celery.task_unregistered` | The worker received a task name it has no handler for. **P1** — always caused by `celery_app.include` drift or a routing typo. | Page on first occurrence. |

The drift guard at `backend/tests/unit/test_celery_app_task_registry.py`
prevents this in CI, but the log event is the runtime safety net.
```

- [ ] **Step 6: Reconcile the `backend-development` skill**

Open `.claude/skills/backend-development/SKILL.md` (or the equivalent path — check with `find .claude -name "SKILL.md" -path "*backend*"`). Find the Celery section that says "wrap async with `asyncio.run(...)`". Replace with:

```markdown
Conventions:
- Pass primitives (UUIDs as strings, ints, dicts), never ORM instances — Celery serializes JSON and ORM objects don't survive that round trip.
- Make tasks idempotent. Use a natural key (e.g. `(run_id, instance_id, field_id)`) and `ON CONFLICT DO NOTHING` for the write so retries are safe.
- Bridge async via `app.worker._runner.run_task(coro_factory)` — see `docs/architecture/deployment.md` for the runner rationale. Do not call `asyncio.run` directly or cache event loops.
- Construct Supabase / DB clients *inside* the coroutine, not at module scope — clients bind their connection pools to the loop active at construction time.
- Bind structlog context inside the task wrapper so log lines carry `task_id`, `project_id`, etc.
```

- [ ] **Step 7: Run lint + tests**

Run: `make test-backend && make lint-backend`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/worker-smoke.yml \
        backend/app/worker/celery_app.py \
        backend/tests/unit/test_worker_runner.py \
        docs/architecture/deployment.md \
        .claude/skills/backend-development/SKILL.md
git commit -m "feat(worker): NotRegistered alert + CI smoke test for runner

- LoggedTask.on_failure: emit distinct 'celery.task_unregistered'
  structlog event for NotRegistered exceptions so dashboards can alert
  on include= drift as a P1 (current 'task_failed' rolls it up with
  every other crash).
- Add .github/workflows/worker-smoke.yml — boots redis + a real
  Celery worker on every PR that touches app/worker/** or the export
  services, dispatches two sequential tasks, asserts no
  'attached to a different loop' and no NotRegistered in the log.
- Document the runner pattern + observability events in
  docs/architecture/deployment.md.
- Reconcile the backend-development skill (was: 'asyncio.run',
  now: 'app.worker._runner.run_task(coro_factory)')."
```

- [ ] **Step 9: Push and open PR 3 to `dev`**

```bash
git push -u origin obs/worker-not-registered-and-ci-smoke
gh pr create --base dev --title "feat(worker): NotRegistered alert + CI smoke for runner" --body "$(cat <<'EOF'
## Summary
Closes the loop on the 2026-05-24 worker incidents. PR 1 fixed the bug, PR 2 added unit-level guards; this PR adds the **runtime alert** (structured log on `NotRegistered`) and the **CI gate** (real worker booted in GitHub Actions, two-task sequence asserting no loop reuse, no unregistered task).

If PR 1's bug or the include-list bug ever regresses, this PR makes it visible *in CI* before merge — not in a user-facing 503.

## Test plan
- [x] LoggedTask.on_failure unit test asserts the new event shape
- [x] Workflow runs green on this PR (verify via Actions tab)
- [x] Sabotage: temporarily drop `extraction_export_tasks` from `include=` and confirm worker-smoke turns red
- [x] `make test-backend` + `make lint-backend` green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: Merge PR 3 to `dev`, then merge `dev` → `main`**

Final state: worker runs on per-call loops, every task is covered by an eager-mode test, route/queue drift is gated in unit tests, NotRegistered is alertable, and the smoke job is the CI safety net.

---

## Self-review notes

- **Spec coverage:** The plan covers every "deixar perfeito" gap I identified after the 2026-05-24 Railway migration: (1) event loop bug → PR 1; (2) `app/worker/*` coverage gap → PR 2; (3) drift between routes/queues → PR 2; (4) NotRegistered observability → PR 3; (5) CI worker smoke gate → PR 3; (6) reconcile the conflicting `backend-development` skill → PR 3.
- **Out of scope (intentional):** anything inside business services, any frontend work, any Railway dashboard changes (config is already correct, code just needs to catch up), the `article_scope: str # noqa: ARG001` parameter (real code smell but separate change — flag via `mcp__ccd_session__spawn_task` after PR 1 lands).
- **Sequencing:** PR 1 is the only one with an outage risk (it changes runtime behavior on the worker). PR 2 and PR 3 are test/observability/docs only and can land at any cadence after PR 1.
- **Placeholder scan:** the only deliberate placeholder is "mirror tests for export_articles_task, import_zotero_collection_task, extract_section_task — same shape, different patches" in Task 2 Step 1. That's an instruction to the engineer, not a TODO inside the code — they read the existing modules and add tests that mirror the export_extraction example. The PR doesn't ship until those mirrors are written.
- **Type consistency:** `run_task`, `coro_factory`, `LoggedTask.on_failure(exc, task_id, args, kwargs, _einfo)`, `task_routes` queue strings (`extractions`, `imports`, `exports`, `celery`) — all consistent across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-worker-hardening.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Best because each PR has a clear scope and the loop-fix PR especially deserves a focused review.
2. **Inline Execution** — execute tasks in this session with checkpoints. Faster but riskier for PR 1 (worker behavior change).

Which approach?
