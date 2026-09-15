---
status: draft
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# AI Batch Runs — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durable, server-side AI batches: a reviewer starts AI on up to 100 articles of one project tool, a dispatcher runs at most 2 at a time through the reviewer's own session run, and every article ends with a readable outcome.

**Architecture:** Two backend-only tables (`extraction_batches`, `extraction_batch_items`) hold the batch; its state is derived, never stored. `POST /api/v1/extraction/batches` validates, writes the rows and kicks the Celery task `advance_extraction_batch`, which claims queued items, runs per-article guards, opens the owner's session run, creates a durable attempt (`ExtractionAttemptService.prepare_request`) and enqueues the existing `run_section_extraction_task` with `link`/`link_error` back to itself. Extraction batches use a new full-pass branch in `SectionExtractionService.run_from_request`.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, Celery 5 + Redis, Pydantic v2, pytest against the local Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-09-15-ai-batch-runs-design.md` — §6 (data model), §7 (API), §8 (dispatcher), §9 (guardrails G1–G18), §14 backend tests, §15 item 2. PR 1 (toolbar) merged as #929; PR 3 (frontend) is a separate plan.

## Global Constraints

- English only: code, comments, commits, docs.
- Worktree `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/regras-injecao-skills-669947`, branch `claude/ai-batch-runs-backend`. Absolute paths; never edit the main checkout. Run each `git` command on its own (the worktree session guard refuses compound shell with `git`).
- Backend commands run from `backend/` with `uv run …` (e.g. `cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/regras-injecao-skills-669947/backend && uv run pytest tests/unit/test_x.py -q`). Integration tests need the local Supabase stack (`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:54321/auth/v1/health` → `200`); if it is down, stop and ask the user — the stack is shared by every session.
- Layering `api → services → repositories → models` (`scripts/fitness/check_layered_arch.py`). Endpoints never touch `app.models` or a repository. Repositories `flush()`, never `commit()`.
- BOLA: one predicate, one implementation, scope in the WHERE clause (`.claude/rules/backend.md` § Ownership guards; `scripts/fitness/check_scope_guards.py`). Membership/role from a service = `SELECT public.is_project_member(...)` / `public.is_project_reviewer(...)`, never `project_members` SQL.
- Every JSON response is `ApiResponse[T]` with a typed `T` (`check_api_response_envelope.py`). Custom error codes are `AppError` subclasses (the handler serializes `error.code`); new codes are added to `ApiErrorCode` first.
- Migration revision id ≤ 32 chars: `0076_extraction_batches`. `alembic check` must report zero drift. New backend-only tables: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL … FROM anon, authenticated`.
- Every Celery task module is in `celery_app.include` AND has an explicit route (`tests/unit/test_celery_app_task_registry.py`). Batch tasks route to `extractions`.
- Dead code: vulture shrink-only ratchet (`uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`); delete, don't baseline.
- Conventional commits, each ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. No push or PR unless the user asks.
- Load before coding: `backend-development`; tests: `web-testing`; before calling it done: `code-review`.

## Rulings on the spec (made while planning — executors follow these)

1. **Wire naming is snake_case.** Spec §7 says camelCase, but `backend/app/schemas/common.py` fixes the contract ("new schemas should not introduce new aliases"). Request body: `project_id`, `template_id`, `article_ids`, `skip_articles_with_ai_suggestions`; query `project_id`, `active`. The frontend reads generated `schema.d.ts`, so the name is invisible to it.
2. **Celery semantics (§16 item 1, verified in the installed Celery):** `celery/app/trace.py` calls errbacks with `call_errbacks=False` on RETRY, so `link_error` fires once, on final failure; `link` fires once on success. Task 6 adds a unit test that `signature_from_request` carries `link`/`link_error` into a retry.
3. **An attempt is in flight while `status IN ('pending','running')`.** Nothing writes `running` today (`execute_attempt` goes `pending → completed|failed`), so `pending` is the live state; both are accepted.
4. **Per-batch serialization uses a session-level advisory lock** (`pg_advisory_lock` on `hashtextextended('extraction_batch:'||id, 0)`), held for one `advance` call and released in `finally`. A second dispatcher waits and then recounts, so a completion callback never loses a free slot. Row locks alone cannot do this: `prepare_request` commits mid-loop.
5. **Resume re-enqueues lost jobs.** `advance(batch_id, reenqueue_stale=True)` (Resume only) re-enqueues dispatched items whose attempt is still `pending` and was last updated over 60 min ago (same bound as G9 and the Redis visibility timeout). Completion callbacks never re-enqueue.
6. **Disabled tool (§16 item 4):** a project template with `is_active = false` is `NO_LONGER_AVAILABLE` (G7); a deleted one cascades the batch away.
7. **Full pass generalizes to every root repeating group** (spec §7.3), where `useFullAIExtraction` used only the first. An entry whose child sections all fail counts as one failed section; the article still completes.
8. **Kickoff enqueue failure after the queue ping** logs and still answers 202: the batch reads `stalled` after 15 min and Resume recovers it. The 503 path stays "queue ping failed, nothing written".
9. **Two concurrent POSTs** are serialized by `pg_advisory_xact_lock(owner, template)`; the test proves the sequential refusal (one test session = one connection). The lock is the concurrency guarantee.
10. **Queue ping reuse:** the batches endpoint imports `_is_queue_available` from `section_extraction` rather than adding a fourth private copy (three endpoints already carry one); consolidating them is out of scope.
11. **Index `(owner_id, created_at)`** without `DESC` (a btree scans backwards; an expression index drifts under `alembic check`).
12. **`skip_fields_with_human_proposals` in child sections:** `extract_all_sections` has no such flag. The full pass passes it to `extract_for_run` only; child-section behaviour is unchanged (spec non-goal "changing what Run AI extracts"). AI only adds proposals; it never overwrites a decision.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/alembic/versions/0076_extraction_batches.py` | Create | Tables, FKs, CHECK, indexes, RLS + REVOKE |
| `backend/app/models/extraction_batch.py` | Create | `ExtractionBatch`, `ExtractionBatchItem` |
| `backend/app/models/__init__.py` | Modify | Import the new models (autogenerate) |
| `backend/app/services/article_read_service.py` | Modify | Plural `owned_articles`; `owned_article` delegates |
| `backend/app/services/section_extraction_service.py` | Modify | Full-pass branch + `extract_full_pass` + `_root_entry_instance_ids` |
| `backend/app/schemas/extraction_batch.py` | Create | Request, summary, detail, item DTOs |
| `backend/app/services/extraction_batch_view.py` | Create | Pure derivation: outcome, counts, state, stalled |
| `backend/app/repositories/extraction_batch_repository.py` | Create | Batch/item queries shared by read, create and dispatch |
| `backend/app/services/extraction_batch_service.py` | Create | `owned_batch` guard, create, cancel, list, detail |
| `backend/app/services/extraction_batch_dispatcher.py` | Create | `ExtractionBatchDispatcher.advance` + G6–G12 |
| `backend/app/worker/tasks/extraction_batch_tasks.py` | Create | `advance_extraction_batch` task + `enqueue_attempt` |
| `backend/app/worker/celery_app.py` | Modify | include + route |
| `backend/app/schemas/common.py` | Modify | `ApiErrorCode.AI_BATCH_ALREADY_ACTIVE` |
| `backend/app/api/v1/endpoints/extraction_batches.py` | Create | 5 endpoints |
| `backend/app/api/v1/router.py` | Modify | Mount at `/extraction/batches` |
| `frontend/types/api/{openapi.json,schema.d.ts}` | Regenerate | `npm run generate:api-types` |
| `docs/reference/extraction-hitl-architecture.md` | Modify | Migration head + batches section |
| `.claude/rules/backend.md` | Modify | Guard list: `owned_articles`, `owned_batch` |
| Tests | Create | see each task |

---

### Task 1: Tables and models

**Files:**
- Create: `backend/app/models/extraction_batch.py`
- Modify: `backend/app/models/__init__.py` (next to the `extraction_attempt` import, line ~37)
- Create: `backend/alembic/versions/0076_extraction_batches.py`
- Test: `backend/tests/integration/test_extraction_batch_tables.py`

**Interfaces:**
- Produces: `ExtractionBatch(owner_id, project_id, template_id, skip_articles_with_ai_suggestions, cancelled_at, stop_code, stop_message, created_at, updated_at, id)`; `ExtractionBatchItem(batch_id, article_id, attempt_id, status, reason_code, created_at, updated_at, id)`; `ITEM_STATUSES = ("queued","dispatched","skipped","failed","cancelled")`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_extraction_batch_tables.py`:

```python
"""0076: batch tables are backend-only and never block a delete (spec §6, G17)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms


async def _article(db: AsyncSession, project_id: UUID) -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'batch table test', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    return article_id


async def _batch_with_item(
    db: AsyncSession, *, project_id: UUID, template_id: UUID, article_id: UUID
) -> tuple[UUID, UUID]:
    batch_id, item_id = uuid4(), uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_batches (id, owner_id, project_id, template_id) "
            "VALUES (:id, :owner, :pid, :tid)"
        ),
        {"id": str(batch_id), "owner": str(SEED.primary_profile), "pid": str(project_id), "tid": str(template_id)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_batch_items (id, batch_id, article_id) "
            "VALUES (:id, :bid, :aid)"
        ),
        {"id": str(item_id), "bid": str(batch_id), "aid": str(article_id)},
    )
    return batch_id, item_id


async def _exists(db: AsyncSession, table: str, row_id: UUID) -> bool:
    return (
        await db.execute(text(f"SELECT 1 FROM public.{table} WHERE id = :id"), {"id": str(row_id)})
    ).first() is not None


@pytest.mark.asyncio
async def test_item_status_defaults_to_queued_and_is_checked(db_session: AsyncSession) -> None:
    article_id = await _article(db_session, SEED.primary_project)
    _, item_id = await _batch_with_item(
        db_session, project_id=SEED.primary_project, template_id=SEED.primary_template, article_id=article_id
    )
    status = (
        await db_session.execute(
            text("SELECT status FROM public.extraction_batch_items WHERE id = :id"), {"id": str(item_id)}
        )
    ).scalar_one()
    assert status == "queued"
    with pytest.raises(DBAPIError):
        async with db_session.begin_nested():
            await db_session.execute(
                text("UPDATE public.extraction_batch_items SET status = 'running' WHERE id = :id"),
                {"id": str(item_id)},
            )


@pytest.mark.asyncio
async def test_one_item_per_article_per_batch(db_session: AsyncSession) -> None:
    article_id = await _article(db_session, SEED.primary_project)
    batch_id, _ = await _batch_with_item(
        db_session, project_id=SEED.primary_project, template_id=SEED.primary_template, article_id=article_id
    )
    with pytest.raises(DBAPIError):
        async with db_session.begin_nested():
            await db_session.execute(
                text("INSERT INTO public.extraction_batch_items (batch_id, article_id) VALUES (:b, :a)"),
                {"b": str(batch_id), "a": str(article_id)},
            )


@pytest.mark.asyncio
async def test_deleting_the_article_removes_its_item(db_session: AsyncSession) -> None:
    article_id = await _article(db_session, SEED.primary_project)
    batch_id, item_id = await _batch_with_item(
        db_session, project_id=SEED.primary_project, template_id=SEED.primary_template, article_id=article_id
    )
    await db_session.execute(text("DELETE FROM public.articles WHERE id = :id"), {"id": str(article_id)})
    assert not await _exists(db_session, "extraction_batch_items", item_id)
    assert await _exists(db_session, "extraction_batches", batch_id)


@pytest.mark.asyncio
async def test_deleting_the_project_removes_the_batch(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    article_id = await _article(db_session, project_id)
    batch_id, item_id = await _batch_with_item(
        db_session, project_id=project_id, template_id=template_id, article_id=article_id
    )
    await db_session.execute(text("DELETE FROM public.projects WHERE id = :id"), {"id": str(project_id)})
    assert not await _exists(db_session, "extraction_batches", batch_id)
    assert not await _exists(db_session, "extraction_batch_items", item_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("table", ["extraction_batches", "extraction_batch_items"])
async def test_client_roles_cannot_read_batch_tables(db_session: AsyncSession, role: str, table: str) -> None:
    with pytest.raises(DBAPIError, match="permission denied"):
        async with db_session.begin_nested():
            await db_session.execute(text(f"SET LOCAL ROLE {role}"))
            await db_session.execute(text(f"SELECT 1 FROM public.{table} LIMIT 1"))
```

If deleting `public.projects` is refused by an unrelated RESTRICT FK in the seeded CHARMS graph, use `tests/integration/conftest.py:purge_templates(db, [template_id])` first and keep the assertion on the batch rows; do not weaken the article test.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && uv run pytest tests/integration/test_extraction_batch_tables.py -q`
Expected: every test FAILS with `relation "public.extraction_batches" does not exist` (or `…_items`).

- [ ] **Step 3: Add the models**

Create `backend/app/models/extraction_batch.py`:

```python
"""A reviewer's AI batch over many articles of one project tool (spec 2026-09-15 §6).

Backend-only (RLS on, client roles revoked). The batch has no status column:
its state is derived from ``cancelled_at``/``stop_code`` and its items, and a
dispatched item's outcome is its attempt's, so nothing can drift.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

ITEM_STATUSES = ("queued", "dispatched", "skipped", "failed", "cancelled")


class ExtractionBatch(BaseModel):
    __tablename__ = "extraction_batches"

    # Cascades are deliberate (G17): a batch never blocks deleting its owner,
    # project or tool.
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("public.profiles.id", ondelete="CASCADE"))
    project_id: Mapped[UUID] = mapped_column(ForeignKey("public.projects.id", ondelete="CASCADE"))
    template_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.project_extraction_templates.id", ondelete="CASCADE")
    )
    skip_articles_with_ai_suggestions: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stop_code: Mapped[str | None] = mapped_column(Text)
    stop_message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_extraction_batches_owner_created", "owner_id", "created_at"),
        {"schema": "public"},
    )


class ExtractionBatchItem(BaseModel):
    __tablename__ = "extraction_batch_items"

    batch_id: Mapped[UUID] = mapped_column(
        ForeignKey("public.extraction_batches.id", ondelete="CASCADE")
    )
    article_id: Mapped[UUID] = mapped_column(ForeignKey("public.articles.id", ondelete="CASCADE"))
    attempt_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("public.extraction_attempts.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(Text, default="queued", server_default="queued")
    reason_code: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','dispatched','skipped','failed','cancelled')", name="status"
        ),
        UniqueConstraint("batch_id", "article_id", name="uq_extraction_batch_items_batch_article"),
        Index("ix_extraction_batch_items_batch_status", "batch_id", "status"),
        {"schema": "public"},
    )
```

In `backend/app/models/__init__.py`, directly below the `ExtractionAttempt` import, add:

```python
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem  # noqa: F401
```

If that module has an `__all__` list, add both names to it.

- [ ] **Step 4: Generate and complete the migration**

Run: `cd backend && uv run alembic revision --autogenerate -m "extraction batches" --rev-id 0076_extraction_batches`
Rename the generated file to `backend/alembic/versions/0076_extraction_batches.py`. Confirm `revision = "0076_extraction_batches"` and `down_revision = "0075_extraction_attempts"`. Delete any operation the autogenerate emitted that does not touch the two new tables (pre-existing drift is not this PR's to fix; if any appears, report it).

At the end of `upgrade()` append:

```python
    op.execute("ALTER TABLE public.extraction_batches ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON public.extraction_batches FROM anon, authenticated")
    op.execute("ALTER TABLE public.extraction_batch_items ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON public.extraction_batch_items FROM anon, authenticated")
```

`downgrade()` must drop `extraction_batch_items` before `extraction_batches` (indexes with them). Give the module docstring: `"""AI batch runs: extraction_batches + extraction_batch_items (spec 2026-09-15 §6)."""`

- [ ] **Step 5: Apply and prove zero drift**

Run: `cd backend && uv run alembic upgrade head`
Expected: `Running upgrade 0075_extraction_attempts -> 0076_extraction_batches`.

Run: `cd backend && uv run alembic check`
Expected: `No new upgrade operations detected.`

Run: `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: both succeed.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd backend && uv run pytest tests/integration/test_extraction_batch_tables.py -q`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/extraction_batch.py backend/app/models/__init__.py backend/alembic/versions/0076_extraction_batches.py backend/tests/integration/test_extraction_batch_tables.py
```

```bash
git commit -m "feat(extraction): extraction batch tables (0076)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Plural article guard

**Files:**
- Modify: `backend/app/services/article_read_service.py`
- Test: `backend/tests/integration/test_article_read_service.py` (create if absent; otherwise append)

**Interfaces:**
- Produces: `async def owned_articles(db: AsyncSession, *, project_id: UUID, article_ids: Sequence[UUID]) -> list[UUID]` — the ids deduplicated in input order; raises `ArticleNotFoundError` when any id is missing or foreign. `owned_article` keeps its signature and delegates.

- [ ] **Step 1: Write the failing tests**

Append (or create with these imports):

```python
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.article_read_service import ArticleNotFoundError, owned_article, owned_articles
from tests.integration.conftest import SEED


async def _second_article(db: AsyncSession):
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'owned_articles test', 1)"
        ),
        {"id": str(article_id), "pid": str(SEED.primary_project)},
    )
    return article_id


@pytest.mark.asyncio
async def test_owned_articles_returns_deduplicated_ids_in_order(db_session: AsyncSession) -> None:
    second = await _second_article(db_session)
    got = await owned_articles(
        db_session,
        project_id=SEED.primary_project,
        article_ids=[second, SEED.primary_article, second],
    )
    assert got == [second, SEED.primary_article]


@pytest.mark.asyncio
async def test_owned_articles_refuses_a_foreign_or_missing_id(db_session: AsyncSession) -> None:
    with pytest.raises(ArticleNotFoundError):
        await owned_articles(
            db_session, project_id=SEED.secondary_project, article_ids=[SEED.primary_article]
        )
    with pytest.raises(ArticleNotFoundError):
        await owned_articles(
            db_session, project_id=SEED.primary_project, article_ids=[SEED.primary_article, uuid4()]
        )


@pytest.mark.asyncio
async def test_owned_article_still_answers_one_id(db_session: AsyncSession) -> None:
    assert (
        await owned_article(db_session, project_id=SEED.primary_project, article_id=SEED.primary_article)
        == SEED.primary_article
    )
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && uv run pytest tests/integration/test_article_read_service.py -q`
Expected: FAIL with `ImportError: cannot import name 'owned_articles'`.

- [ ] **Step 3: Implement**

In `backend/app/services/article_read_service.py`, add `from collections.abc import Sequence` to the imports and replace the whole `owned_article` function with:

```python
async def owned_articles(
    db: AsyncSession, *, project_id: UUID, article_ids: Sequence[UUID]
) -> list[UUID]:
    """The ids (deduplicated, input order), only when EVERY one belongs to ``project_id``.

    THE article-in-project pair guard (`.claude/rules/backend.md`
    § Ownership guards). The scope is in the WHERE clause, not a compare
    after a bare ``db.get``: a foreign article and a missing one raise the
    same error with the same message shape, so no caller can leak which
    articles exist in projects the caller cannot see.
    """
    wanted = list(dict.fromkeys(article_ids))
    found = set(
        (
            await db.execute(
                select(Article.id).where(Article.id.in_(wanted), Article.project_id == project_id)
            )
        ).scalars()
    )
    missing = next((article_id for article_id in wanted if article_id not in found), None)
    if missing is not None:
        raise ArticleNotFoundError(f"Article {missing} not found")
    return wanted


async def owned_article(db: AsyncSession, *, project_id: UUID, article_id: UUID) -> UUID:
    """The article's id, only when it belongs to ``project_id`` (see :func:`owned_articles`).

    Distinct from :func:`get_article_project_id` above, which answers the
    opposite question ("which project owns this?") for routers that must
    resolve an article's project *before* they can check membership at all.
    """
    return (await owned_articles(db, project_id=project_id, article_ids=[article_id]))[0]
```

- [ ] **Step 4: Run tests and the guard gate**

Run: `cd backend && uv run pytest tests/integration/test_article_read_service.py tests/integration/test_section_extraction_scope.py -q`
Expected: all PASS.

Run: `cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/regras-injecao-skills-669947 && uv run --project backend python scripts/fitness/check_scope_guards.py`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/article_read_service.py backend/tests/integration/test_article_read_service.py
```

```bash
git commit -m "feat(articles): plural owned_articles guard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Full-pass dispatch branch

**Files:**
- Modify: `backend/app/services/section_extraction_service.py` (`run_from_request` ~1737; new methods beside `extract_for_run`)
- Test: `backend/tests/unit/test_section_extraction_full_pass.py`, `backend/tests/integration/test_root_entry_instances.py`

**Interfaces:**
- Produces: a `SectionExtractionRequest` with `run_id` set, `extract_all_sections=True` and no `entity_type_id`/`parent_instance_id` dispatches to `SectionExtractionService.extract_full_pass(*, run_id: UUID, skip_fields_with_human_proposals: bool, engine: LlmTarget) -> BatchExtractionResult`. Helper `_root_entry_instance_ids(run) -> list[UUID]` (run needs `article_id`, `template_id`).

- [ ] **Step 1: Write the failing unit test**

Create `backend/tests/unit/test_section_extraction_full_pass.py`:

```python
"""Full pass (spec §7.3): top-level + entries, then every entry's child sections."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.schemas.extraction import SectionExtractionRequest
from app.services.section_extraction_service import (
    BatchAllSectionsFailed,
    BatchExtractionResult,
    SectionExtractionService,
)


def _result(total: int, ok: int, failed: int, suggestions: int) -> BatchExtractionResult:
    return BatchExtractionResult(
        extraction_run_id="run",
        total_sections=total,
        successful_sections=ok,
        failed_sections=failed,
        total_suggestions_created=suggestions,
        sections=[{"entity_type_id": "x", "success": True}] * total,
    )


def _service(run: SimpleNamespace) -> SectionExtractionService:
    service = SectionExtractionService.__new__(SectionExtractionService)
    service.db = MagicMock()
    service.db.get = AsyncMock(return_value=run)
    service.user_id = str(uuid4())
    return service


@pytest.mark.asyncio
async def test_run_id_with_extract_all_sections_routes_to_the_full_pass() -> None:
    run_id = uuid4()
    service = _service(SimpleNamespace(id=run_id))
    service.extract_full_pass = AsyncMock(return_value=_result(1, 1, 0, 1))
    service.extract_for_run = AsyncMock()
    request = SectionExtractionRequest(
        project_id=uuid4(), article_id=uuid4(), template_id=uuid4(), run_id=run_id, extract_all_sections=True
    )

    await service.run_from_request(request, engine=MagicMock())

    service.extract_full_pass.assert_awaited_once()
    service.extract_for_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_plain_run_id_still_routes_to_extract_for_run() -> None:
    run_id = uuid4()
    service = _service(SimpleNamespace(id=run_id))
    service.extract_full_pass = AsyncMock()
    service.extract_for_run = AsyncMock(return_value=_result(1, 1, 0, 1))
    request = SectionExtractionRequest(project_id=uuid4(), article_id=uuid4(), template_id=uuid4(), run_id=run_id)

    await service.run_from_request(request, engine=MagicMock())

    service.extract_for_run.assert_awaited_once()
    service.extract_full_pass.assert_not_awaited()


@pytest.mark.asyncio
async def test_full_pass_sweeps_every_entry_and_merges_counts() -> None:
    run = SimpleNamespace(id=uuid4(), project_id=uuid4(), article_id=uuid4(), template_id=uuid4())
    entries = [uuid4(), uuid4()]
    service = _service(run)
    service.extract_for_run = AsyncMock(return_value=_result(3, 3, 0, 5))
    service._root_entry_instance_ids = AsyncMock(return_value=entries)
    service.extract_all_sections = AsyncMock(
        side_effect=[_result(4, 3, 1, 7), BatchAllSectionsFailed("all failed")]
    )
    engine = MagicMock()

    result = await service.extract_full_pass(
        run_id=run.id, skip_fields_with_human_proposals=True, engine=engine
    )

    service.extract_for_run.assert_awaited_once_with(
        run_id=run.id, skip_fields_with_human_proposals=True, engine=engine
    )
    swept = [call.kwargs["parent_instance_id"] for call in service.extract_all_sections.await_args_list]
    assert swept == entries
    assert all(call.kwargs["run_id"] == run.id for call in service.extract_all_sections.await_args_list)
    assert (result.total_sections, result.successful_sections, result.failed_sections) == (8, 6, 2)
    assert result.total_suggestions_created == 12
    assert result.extraction_run_id == str(run.id)
```

- [ ] **Step 2: Write the failing integration test for the entry query**

Create `backend/tests/integration/test_root_entry_instances.py`:

```python
"""Entries of root repeating groups only — never singletons, never nested rows."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.section_extraction_service import SectionExtractionService
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms


async def _entity_type(db: AsyncSession, template_id: UUID, *, cardinality: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND parent_entity_type_id IS NULL "
                "AND cardinality = :card ORDER BY sort_order LIMIT 1"
            ),
            {"tid": str(template_id), "card": cardinality},
        )
    ).scalar_one()


async def _instance(
    db: AsyncSession, *, project_id: UUID, article_id: UUID, template_id: UUID,
    entity_type_id: UUID, parent: UUID | None = None, sort_order: int = 0,
) -> UUID:
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances (id, project_id, article_id, template_id, "
            "entity_type_id, parent_instance_id, label, sort_order, metadata, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :et, :parent, 'entry', :so, '{}'::jsonb, :by)"
        ),
        {"id": str(instance_id), "pid": str(project_id), "aid": str(article_id), "tid": str(template_id),
         "et": str(entity_type_id), "parent": str(parent) if parent else None, "so": sort_order,
         "by": str(SEED.primary_profile)},
    )
    return instance_id


@pytest.mark.asyncio
async def test_root_entry_instance_ids(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    article_id = uuid4()
    await db_session.execute(
        text("INSERT INTO public.articles (id, project_id, title, row_version) VALUES (:id, :pid, 'entries', 1)"),
        {"id": str(article_id), "pid": str(project_id)},
    )
    group = await _entity_type(db_session, template_id, cardinality="many")
    singleton = await _entity_type(db_session, template_id, cardinality="one")
    first = await _instance(db_session, project_id=project_id, article_id=article_id, template_id=template_id, entity_type_id=group, sort_order=0)
    second = await _instance(db_session, project_id=project_id, article_id=article_id, template_id=template_id, entity_type_id=group, sort_order=1)
    await _instance(db_session, project_id=project_id, article_id=article_id, template_id=template_id, entity_type_id=singleton)

    service = SectionExtractionService.__new__(SectionExtractionService)
    service.db = db_session
    got = await service._root_entry_instance_ids(SimpleNamespace(article_id=article_id, template_id=template_id))

    assert got == [first, second]
```

If the CHARMS clone has no root `cardinality='one'` type, drop the singleton lines; the group/order assertion is the contract.

- [ ] **Step 3: Run and confirm failure**

Run: `cd backend && uv run pytest tests/unit/test_section_extraction_full_pass.py tests/integration/test_root_entry_instances.py -q`
Expected: FAIL — `extract_full_pass` / `_root_entry_instance_ids` missing, and the first routing test awaits `extract_for_run` instead.

- [ ] **Step 4: Implement**

In `run_from_request`, insert this block directly above `if payload.run_id is not None:` and extend the docstring's branch list with a matching item "3. ``run_id`` + ``extract_all_sections`` → ``extract_full_pass`` (extraction batches, spec §7.3)" (renumber the old 3 to 4):

```python
        if payload.run_id is not None and payload.extract_all_sections:
            return await self.extract_full_pass(
                run_id=payload.run_id,
                skip_fields_with_human_proposals=payload.skip_fields_with_human_proposals,
                engine=engine,
            )
```

Add both methods directly after `extract_for_run` (ensure `ExtractionEntityType` and `ExtractionInstance` are imported from `app.models.extraction`; add `select` from `sqlalchemy` if absent):

```python
    async def extract_full_pass(
        self,
        *,
        run_id: UUID,
        skip_fields_with_human_proposals: bool,
        engine: LlmTarget,
    ) -> BatchExtractionResult:
        """Everything a reviewer's Run AI covers, in one job (spec 2026-09-15 §7.3).

        ``extract_for_run`` fills the top-level sections and identifies the
        entries of every root repeating group; each entry's child sections
        then run through ``extract_all_sections`` on the SAME run. An entry
        whose child sections all fail counts as one failed section — the
        article still completes with issues rather than failing whole.
        """
        top = await self.extract_for_run(
            run_id=run_id,
            skip_fields_with_human_proposals=skip_fields_with_human_proposals,
            engine=engine,
        )
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")

        total, successful, failed = top.total_sections, top.successful_sections, top.failed_sections
        suggestions = top.total_suggestions_created
        sections = list(top.sections)
        for entry_id in await self._root_entry_instance_ids(run):
            try:
                child = await self.extract_all_sections(
                    project_id=run.project_id,
                    article_id=run.article_id,
                    template_id=run.template_id,
                    parent_instance_id=entry_id,
                    engine=engine,
                    run_id=run.id,
                )
            except BatchAllSectionsFailed as exc:
                total += 1
                failed += 1
                sections.append(
                    {"entity_type_id": str(entry_id), "success": False, "error": str(exc)}
                )
                continue
            total += child.total_sections
            successful += child.successful_sections
            failed += child.failed_sections
            suggestions += child.total_suggestions_created
            sections.extend(child.sections)

        return BatchExtractionResult(
            extraction_run_id=str(run.id),
            total_sections=total,
            successful_sections=successful,
            failed_sections=failed,
            total_suggestions_created=suggestions,
            sections=sections,
        )

    async def _root_entry_instance_ids(self, run: Any) -> list[UUID]:
        """Entries of the run's root repeating groups, in template then entry order."""
        stmt = (
            select(ExtractionInstance.id)
            .join(ExtractionEntityType, ExtractionEntityType.id == ExtractionInstance.entity_type_id)
            .where(
                ExtractionInstance.article_id == run.article_id,
                ExtractionInstance.template_id == run.template_id,
                ExtractionInstance.parent_instance_id.is_(None),
                ExtractionEntityType.parent_entity_type_id.is_(None),
                ExtractionEntityType.cardinality == "many",
            )
            .order_by(ExtractionEntityType.sort_order, ExtractionInstance.sort_order, ExtractionInstance.id)
        )
        return list((await self.db.execute(stmt)).scalars())
```

- [ ] **Step 5: Run the tests and gates**

Run: `cd backend && uv run pytest tests/unit/test_section_extraction_full_pass.py tests/integration/test_root_entry_instances.py tests/unit/test_run_section_extraction_task.py -q`
Expected: all PASS.

Run: `cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/regras-injecao-skills-669947 && uv run --project backend python scripts/fitness/check_scope_guards.py`
Expected: exit 0. If it reports a duplicate predicate for `ExtractionInstance`, move the query into `ExtractionInstanceRepository` as `root_entry_ids(article_id, template_id)` and call it from the service; do not baseline it.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/section_extraction_service.py backend/tests/unit/test_section_extraction_full_pass.py backend/tests/integration/test_root_entry_instances.py
```

```bash
git commit -m "feat(extraction): full-pass dispatch branch for a session run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Batch schemas and derived view

**Files:**
- Create: `backend/app/schemas/extraction_batch.py`
- Create: `backend/app/services/extraction_batch_view.py`
- Test: `backend/tests/unit/test_extraction_batch_view.py`, `backend/tests/unit/test_extraction_batch_schemas.py`

**Interfaces:**
- Produces (schemas): `CreateExtractionBatchRequest(project_id, template_id, article_ids: list[UUID], skip_articles_with_ai_suggestions: bool = True)`; `BatchState = Literal["active","finished","stopped","cancelled"]`; `ItemOutcome = Literal["queued","running","done","done_with_issues","needs_attention","skipped","not_run"]`; `ExtractionBatchCounts(total, queued, running, done, done_with_issues, needs_attention, skipped, not_run)`; `ExtractionBatchSummary(id, project_id, project_name, template_id, template_name, kind, created_at, finished_at, state, stalled, stop_code, stop_message, counts)`; `ExtractionBatchItemView(article_id, title, outcome, reason_code, message, failed_sections, total_sections)`; `ExtractionBatchDetail(ExtractionBatchSummary + items: list[ExtractionBatchItemView])`.
- Produces (view): `ItemRow` dataclass; `ENGINE_STOP_CODES`; `STALL_AFTER = timedelta(minutes=15)`; `ATTEMPT_LIVE = frozenset({"pending","running"})`; `item_outcome(row: ItemRow) -> tuple[ItemOutcome, str | None]` (outcome, reason_code); `derive_batch(*, cancelled_at, stop_code, created_at, rows, now) -> BatchDerivation(state, stalled, finished_at, counts, items)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_extraction_batch_schemas.py`:

```python
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.extraction_batch import CreateExtractionBatchRequest


def _body(ids: list) -> dict:
    return {"project_id": str(uuid4()), "template_id": str(uuid4()), "article_ids": ids}


def test_article_ids_are_deduplicated_in_order() -> None:
    a, b = uuid4(), uuid4()
    request = CreateExtractionBatchRequest.model_validate(_body([str(a), str(b), str(a)]))
    assert request.article_ids == [a, b]
    assert request.skip_articles_with_ai_suggestions is True


@pytest.mark.parametrize("count", [0, 101])
def test_article_count_outside_1_to_100_is_rejected(count: int) -> None:
    with pytest.raises(ValidationError):
        CreateExtractionBatchRequest.model_validate(_body([str(uuid4()) for _ in range(count)]))


def test_100_after_dedupe_is_accepted() -> None:
    ids = [str(uuid4()) for _ in range(100)]
    assert len(CreateExtractionBatchRequest.model_validate(_body(ids + ids[:5])).article_ids) == 100


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        CreateExtractionBatchRequest.model_validate({**_body([str(uuid4())]), "owner_id": str(uuid4())})
```

Create `backend/tests/unit/test_extraction_batch_view.py`:

```python
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.services.extraction_batch_view import ItemRow, derive_batch, item_outcome

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)


def row(status: str = "queued", *, attempt: str | None = None, result: dict | None = None,
        error_code: str | None = None, reason: str | None = None, attempt_id=True,
        minutes_ago: int = 1) -> ItemRow:
    at = NOW - timedelta(minutes=minutes_ago)
    return ItemRow(
        article_id=uuid4(), title="t", status=status, reason_code=reason, updated_at=at,
        attempt_id=uuid4() if (attempt and attempt_id) else None, attempt_status=attempt,
        attempt_result=result, attempt_error_code=error_code, attempt_error="boom" if error_code else None,
        attempt_updated_at=at if attempt else None,
    )


def test_item_outcomes() -> None:
    assert item_outcome(row("queued")) == ("queued", None)
    assert item_outcome(row("skipped", reason="RUN_FINALIZED")) == ("skipped", "RUN_FINALIZED")
    assert item_outcome(row("failed", reason="NO_LONGER_AVAILABLE")) == ("needs_attention", "NO_LONGER_AVAILABLE")
    assert item_outcome(row("cancelled", reason="CANCELLED")) == ("not_run", "CANCELLED")
    assert item_outcome(row("dispatched", attempt="pending")) == ("running", None)
    assert item_outcome(row("dispatched", attempt="running")) == ("running", None)
    assert item_outcome(row("dispatched", attempt="completed", result={"failed_sections": 0})) == ("done", None)
    assert item_outcome(row("dispatched", attempt="completed", result={"failed_sections": 2, "total_sections": 9})) == ("done_with_issues", None)
    assert item_outcome(row("dispatched", attempt="failed", error_code="PDF_NOT_FOUND")) == ("needs_attention", "PDF_NOT_FOUND")
    assert item_outcome(row("dispatched", attempt="cancelled")) == ("not_run", None)
    # Attempt deleted with its run (FK SET NULL).
    assert item_outcome(row("dispatched")) == ("skipped", "NO_LONGER_AVAILABLE")


def test_active_while_anything_is_queued_or_running() -> None:
    view = derive_batch(cancelled_at=None, stop_code=None, created_at=NOW, now=NOW,
                        rows=[row("dispatched", attempt="completed", result={}), row("queued")])
    assert view.state == "active" and view.finished_at is None and not view.stalled
    assert view.counts.total == 2 and view.counts.done == 1 and view.counts.queued == 1


def test_finished_takes_the_latest_update() -> None:
    rows = [row("dispatched", attempt="completed", result={}, minutes_ago=5), row("skipped", reason="AI_ALREADY_RUNNING", minutes_ago=2)]
    view = derive_batch(cancelled_at=None, stop_code=None, created_at=NOW, now=NOW, rows=rows)
    assert view.state == "finished"
    assert view.finished_at == NOW - timedelta(minutes=2)


def test_cancelled_stays_active_until_in_flight_articles_finish() -> None:
    rows = [row("dispatched", attempt="pending"), row("cancelled", reason="CANCELLED")]
    assert derive_batch(cancelled_at=NOW, stop_code=None, created_at=NOW, now=NOW, rows=rows).state == "active"
    rows[0] = row("dispatched", attempt="completed", result={})
    view = derive_batch(cancelled_at=NOW, stop_code=None, created_at=NOW, now=NOW, rows=rows)
    assert view.state == "cancelled" and view.counts.not_run == 1


def test_stopped_by_engine_error() -> None:
    rows = [row("dispatched", attempt="failed", error_code="MISSING_API_KEY"), row("cancelled", reason="STOPPED_ENGINE_ERROR")]
    view = derive_batch(cancelled_at=None, stop_code="MISSING_API_KEY", created_at=NOW, now=NOW, rows=rows)
    assert view.state == "stopped" and view.counts.needs_attention == 1 and view.counts.not_run == 1


def test_stalled_after_15_minutes_without_progress() -> None:
    fresh = derive_batch(cancelled_at=None, stop_code=None, created_at=NOW, now=NOW, rows=[row("dispatched", attempt="pending", minutes_ago=14)])
    stale = derive_batch(cancelled_at=None, stop_code=None, created_at=NOW, now=NOW, rows=[row("dispatched", attempt="pending", minutes_ago=16)])
    assert not fresh.stalled and stale.stalled


def test_item_view_carries_section_counts_and_message() -> None:
    view = derive_batch(cancelled_at=None, stop_code=None, created_at=NOW, now=NOW, rows=[
        row("dispatched", attempt="completed", result={"failed_sections": 2, "total_sections": 9}),
        row("dispatched", attempt="failed", error_code="EXTRACTION_FAILED"),
    ])
    done, failed = view.items
    assert (done.failed_sections, done.total_sections, done.outcome) == (2, 9, "done_with_issues")
    assert (failed.reason_code, failed.message) == ("EXTRACTION_FAILED", "boom")
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && uv run pytest tests/unit/test_extraction_batch_schemas.py tests/unit/test_extraction_batch_view.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.schemas.extraction_batch'`.

- [ ] **Step 3: Implement the schemas**

Create `backend/app/schemas/extraction_batch.py`:

```python
"""AI batch runs over many articles (spec 2026-09-15 §7). snake_case on the wire."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

MAX_ARTICLES_PER_BATCH = 100

BatchState = Literal["active", "finished", "stopped", "cancelled"]
ItemOutcome = Literal[
    "queued", "running", "done", "done_with_issues", "needs_attention", "skipped", "not_run"
]


class CreateExtractionBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    template_id: UUID
    article_ids: list[UUID]
    skip_articles_with_ai_suggestions: bool = True

    @field_validator("article_ids")
    @classmethod
    def _dedupe_and_bound(cls, value: list[UUID]) -> list[UUID]:
        unique = list(dict.fromkeys(value))
        if not 1 <= len(unique) <= MAX_ARTICLES_PER_BATCH:
            raise ValueError(f"article_ids must hold 1 to {MAX_ARTICLES_PER_BATCH} distinct ids")
        return unique


class ExtractionBatchCounts(BaseModel):
    total: int
    queued: int
    running: int
    done: int
    done_with_issues: int
    needs_attention: int
    skipped: int
    not_run: int


class ExtractionBatchSummary(BaseModel):
    id: UUID
    project_id: UUID
    project_name: str
    template_id: UUID
    template_name: str
    kind: str
    created_at: datetime
    finished_at: datetime | None
    state: BatchState
    stalled: bool
    stop_code: str | None
    stop_message: str | None
    counts: ExtractionBatchCounts


class ExtractionBatchItemView(BaseModel):
    article_id: UUID
    title: str
    outcome: ItemOutcome
    reason_code: str | None
    message: str | None
    failed_sections: int | None
    total_sections: int | None


class ExtractionBatchDetail(ExtractionBatchSummary):
    items: list[ExtractionBatchItemView]
```

- [ ] **Step 4: Implement the view derivation**

Create `backend/app/services/extraction_batch_view.py`:

```python
"""Derived batch state (spec 2026-09-15 §7.2) — pure, so every reader agrees."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from app.schemas.extraction_batch import (
    BatchState,
    ExtractionBatchCounts,
    ExtractionBatchItemView,
    ItemOutcome,
)

#: An attempt failing with one of these stops the whole batch (G12).
ENGINE_STOP_CODES = frozenset({"MISSING_API_KEY", "ENGINE_RETIRED", "LLM_ENDPOINT_UNAVAILABLE"})
ATTEMPT_LIVE = frozenset({"pending", "running"})
STALL_AFTER = timedelta(minutes=15)
NO_LONGER_AVAILABLE = "NO_LONGER_AVAILABLE"


@dataclass(frozen=True)
class ItemRow:
    article_id: UUID
    title: str
    status: str
    reason_code: str | None
    updated_at: datetime
    attempt_id: UUID | None
    attempt_status: str | None
    attempt_result: dict[str, Any] | None
    attempt_error_code: str | None
    attempt_error: str | None
    attempt_updated_at: datetime | None


@dataclass(frozen=True)
class BatchDerivation:
    state: BatchState
    stalled: bool
    finished_at: datetime | None
    counts: ExtractionBatchCounts
    items: list[ExtractionBatchItemView]


_BY_ITEM_STATUS: dict[str, ItemOutcome] = {
    "queued": "queued",
    "skipped": "skipped",
    "failed": "needs_attention",
    "cancelled": "not_run",
}


def item_outcome(row: ItemRow) -> tuple[ItemOutcome, str | None]:
    if row.status != "dispatched":
        return _BY_ITEM_STATUS[row.status], row.reason_code
    if row.attempt_id is None:
        return "skipped", NO_LONGER_AVAILABLE
    if row.attempt_status in ATTEMPT_LIVE:
        return "running", None
    if row.attempt_status == "completed":
        failed = int((row.attempt_result or {}).get("failed_sections") or 0)
        return ("done_with_issues" if failed > 0 else "done"), None
    if row.attempt_status == "failed":
        return "needs_attention", row.attempt_error_code
    return "not_run", None


def _last_touch(row: ItemRow) -> datetime:
    return max(t for t in (row.updated_at, row.attempt_updated_at) if t is not None)


def derive_batch(
    *,
    cancelled_at: datetime | None,
    stop_code: str | None,
    created_at: datetime,
    rows: list[ItemRow],
    now: datetime,
) -> BatchDerivation:
    items: list[ExtractionBatchItemView] = []
    tally: Counter[str] = Counter()
    for row in rows:
        outcome, reason = item_outcome(row)
        tally[outcome] += 1
        result = row.attempt_result or {}
        items.append(
            ExtractionBatchItemView(
                article_id=row.article_id,
                title=row.title,
                outcome=outcome,
                reason_code=reason,
                message=row.attempt_error if outcome == "needs_attention" else None,
                failed_sections=result.get("failed_sections"),
                total_sections=result.get("total_sections"),
            )
        )

    counts = ExtractionBatchCounts(
        total=len(rows),
        queued=tally["queued"],
        running=tally["running"],
        done=tally["done"],
        done_with_issues=tally["done_with_issues"],
        needs_attention=tally["needs_attention"],
        skipped=tally["skipped"],
        not_run=tally["not_run"],
    )
    halted = cancelled_at is not None or stop_code is not None
    active = counts.running > 0 or (counts.queued > 0 and not halted)
    last = max((_last_touch(r) for r in rows), default=created_at)

    state: BatchState
    if active:
        state = "active"
    elif cancelled_at is not None:
        state = "cancelled"
    elif stop_code is not None:
        state = "stopped"
    else:
        state = "finished"

    return BatchDerivation(
        state=state,
        stalled=active and now - last > STALL_AFTER,
        finished_at=None if active else last,
        counts=counts,
        items=items,
    )
```

- [ ] **Step 5: Run and confirm pass**

Run: `cd backend && uv run pytest tests/unit/test_extraction_batch_schemas.py tests/unit/test_extraction_batch_view.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/extraction_batch.py backend/app/services/extraction_batch_view.py backend/tests/unit/test_extraction_batch_schemas.py backend/tests/unit/test_extraction_batch_view.py
```

```bash
git commit -m "feat(extraction): batch schemas and derived batch state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Repository, ownership guard and reads

**Files:**
- Create: `backend/app/repositories/extraction_batch_repository.py`
- Create: `backend/app/services/extraction_batch_service.py`
- Test: `backend/tests/integration/test_extraction_batch_reads.py`
- Test helper (create): `backend/tests/integration/helpers/batch_fixtures.py`

**Interfaces:**
- Consumes: Task 1 models; Task 4 `ItemRow`, `derive_batch`, `ATTEMPT_LIVE`, `ENGINE_STOP_CODES`, schemas.
- Produces (repository `ExtractionBatchRepository(db)`):
  - `get_owned(batch_id: UUID, owner_id: UUID) -> ExtractionBatch | None` — scope in WHERE (`id`, `owner_id`) plus `public.is_project_member(project_id, owner_id)`.
  - `list_owned(owner_id: UUID, *, since: datetime, project_id: UUID | None) -> list[ExtractionBatch]` — newest first, member-scoped.
  - `item_rows(batch_ids: list[UUID]) -> dict[UUID, list[ItemRow]]`
  - `labels(batch: ExtractionBatch) -> tuple[str, str, str]` — `(project_name, template_name, template_kind)`
  - `add(batch: ExtractionBatch, article_ids: list[UUID]) -> None`
  - `active_batch_id(owner_id: UUID, template_id: UUID) -> UUID | None`
  - `cancel_queued(batch_id: UUID, reason_code: str) -> None`
  - `count_in_flight(batch_id: UUID, *, since: datetime) -> int`
  - `claim_queued(batch_id: UUID, limit: int) -> list[ExtractionBatchItem]` (`FOR UPDATE SKIP LOCKED`, oldest first)
  - `engine_stop_failure(batch_id: UUID) -> tuple[str, str | None] | None`
  - `stale_dispatched_attempts(batch_id: UUID, *, before: datetime) -> list[ExtractionAttempt]`
- Produces (service module):
  - `class BatchNotFoundError(Exception)`; `async def owned_batch(db, *, owner_id: UUID, batch_id: UUID) -> ExtractionBatch` — THE batch guard.
  - `class ExtractionBatchService(db)`: `detail(owner_id, batch_id, *, now) -> ExtractionBatchDetail`; `list_for_owner(owner_id, *, project_id, active_only, now) -> list[ExtractionBatchSummary]`. (Task 7 adds `create`, `cancel`.)
- Produces (test helper): `async def make_batch(db, *, owner_id, project_id, template_id, article_ids, **fields) -> UUID`; `async def make_article(db, project_id) -> UUID`.

- [ ] **Step 1: Write the test helper and failing tests**

Create `backend/tests/integration/helpers/batch_fixtures.py`:

```python
"""Shared setup for the extraction batch suites (rows written in the test SAVEPOINT)."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def make_article(db: AsyncSession, project_id: UUID, title: str = "batch article") -> UUID:
    article_id = uuid4()
    await db.execute(
        text("INSERT INTO public.articles (id, project_id, title, row_version) VALUES (:id, :pid, :t, 1)"),
        {"id": str(article_id), "pid": str(project_id), "t": title},
    )
    return article_id


async def make_batch(
    db: AsyncSession,
    *,
    owner_id: UUID,
    project_id: UUID,
    template_id: UUID,
    article_ids: list[UUID],
    **fields: Any,
) -> UUID:
    batch_id = uuid4()
    columns = {"id": str(batch_id), "owner_id": str(owner_id), "project_id": str(project_id),
               "template_id": str(template_id), **fields}
    await db.execute(
        text(
            f"INSERT INTO public.extraction_batches ({', '.join(columns)}) "
            f"VALUES ({', '.join(':' + c for c in columns)})"
        ),
        columns,
    )
    for offset, article_id in enumerate(article_ids):
        await db.execute(
            text(
                "INSERT INTO public.extraction_batch_items (batch_id, article_id, created_at) "
                "VALUES (:b, :a, now() + make_interval(secs => :o))"
            ),
            {"b": str(batch_id), "a": str(article_id), "o": offset},
        )
    return batch_id
```

Create `backend/tests/integration/test_extraction_batch_reads.py`:

```python
"""Reads are owner-only, member-only, 7 days, and derived (spec §7.1–7.2)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_batch_service import BatchNotFoundError, ExtractionBatchService, owned_batch
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch


@pytest.mark.asyncio
async def test_owner_reads_detail_with_derived_counts(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project, "First")
    b = await make_article(db_session, SEED.primary_project, "Second")
    batch_id = await make_batch(db_session, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                                template_id=SEED.primary_template, article_ids=[a, b])
    await db_session.execute(
        text("UPDATE public.extraction_batch_items SET status='skipped', reason_code='RUN_FINALIZED' WHERE batch_id=:b AND article_id=:a"),
        {"b": str(batch_id), "a": str(b)},
    )

    detail = await ExtractionBatchService(db_session).detail(SEED.primary_profile, batch_id, now=datetime.now(UTC))

    assert detail.state == "active"
    assert (detail.counts.total, detail.counts.queued, detail.counts.skipped) == (2, 1, 1)
    assert [i.title for i in detail.items] == ["First", "Second"]
    assert detail.items[1].reason_code == "RUN_FINALIZED"
    assert detail.project_name and detail.template_name and detail.kind


@pytest.mark.asyncio
async def test_foreign_and_missing_batches_are_indistinguishable(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project)
    batch_id = await make_batch(db_session, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                                template_id=SEED.primary_template, article_ids=[a])
    with pytest.raises(BatchNotFoundError) as foreign:
        await owned_batch(db_session, owner_id=SEED.reviewer_profile, batch_id=batch_id)
    with pytest.raises(BatchNotFoundError) as missing:
        await owned_batch(db_session, owner_id=SEED.primary_profile, batch_id=SEED.primary_article)
    assert str(foreign.value) == str(missing.value)


@pytest.mark.asyncio
async def test_an_owner_who_left_the_project_loses_the_batch(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project)
    batch_id = await make_batch(db_session, owner_id=SEED.outsider_profile, project_id=SEED.primary_project,
                                template_id=SEED.primary_template, article_ids=[a])
    with pytest.raises(BatchNotFoundError):
        await owned_batch(db_session, owner_id=SEED.outsider_profile, batch_id=batch_id)


@pytest.mark.asyncio
async def test_list_is_seven_days_newest_first_and_filters_active(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project)
    old = await make_batch(db_session, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                           template_id=SEED.primary_template, article_ids=[a])
    await db_session.execute(text("UPDATE public.extraction_batches SET created_at = now() - interval '8 days' WHERE id=:id"), {"id": str(old)})
    finished = await make_batch(db_session, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                                template_id=SEED.primary_template, article_ids=[a], created_at=datetime.now(UTC))
    await db_session.execute(text("UPDATE public.extraction_batch_items SET status='skipped' WHERE batch_id=:b"), {"b": str(finished)})
    active = await make_batch(db_session, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                              template_id=SEED.primary_template, article_ids=[a])
    await db_session.execute(text("UPDATE public.extraction_batches SET created_at = now() + interval '1 second' WHERE id=:id"), {"id": str(active)})

    service = ExtractionBatchService(db_session)
    now = datetime.now(UTC)
    everything = await service.list_for_owner(SEED.primary_profile, project_id=None, active_only=False, now=now)
    only_active = await service.list_for_owner(SEED.primary_profile, project_id=SEED.primary_project, active_only=True, now=now)

    ids = [s.id for s in everything]
    assert old not in ids
    assert ids.index(active) < ids.index(finished)
    assert [s.id for s in only_active] == [active]
    assert await service.list_for_owner(SEED.reviewer_profile, project_id=None, active_only=False, now=now) == []
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && uv run pytest tests/integration/test_extraction_batch_reads.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.extraction_batch_service'`.

- [ ] **Step 3: Implement the repository**

Create `backend/app/repositories/extraction_batch_repository.py`:

```python
"""Batch persistence shared by the batch service and the dispatcher."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem
from app.models.project import Project
from app.services.extraction_batch_view import ATTEMPT_LIVE, ENGINE_STOP_CODES, ItemRow


def _member(owner_id: UUID):  # noqa: ANN202 — SQL expression
    return func.public.is_project_member(ExtractionBatch.project_id, owner_id)


class ExtractionBatchRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_owned(self, batch_id: UUID, owner_id: UUID) -> ExtractionBatch | None:
        return (
            await self.db.execute(
                select(ExtractionBatch).where(
                    ExtractionBatch.id == batch_id,
                    ExtractionBatch.owner_id == owner_id,
                    _member(owner_id),
                )
            )
        ).scalar_one_or_none()

    async def list_owned(
        self, owner_id: UUID, *, since: datetime, project_id: UUID | None
    ) -> list[ExtractionBatch]:
        stmt = select(ExtractionBatch).where(
            ExtractionBatch.owner_id == owner_id,
            ExtractionBatch.created_at >= since,
            _member(owner_id),
        )
        if project_id is not None:
            stmt = stmt.where(ExtractionBatch.project_id == project_id)
        stmt = stmt.order_by(ExtractionBatch.created_at.desc(), ExtractionBatch.id)
        return list((await self.db.execute(stmt)).scalars())

    async def item_rows(self, batch_ids: list[UUID]) -> dict[UUID, list[ItemRow]]:
        rows: dict[UUID, list[ItemRow]] = {batch_id: [] for batch_id in batch_ids}
        if not batch_ids:
            return rows
        stmt = (
            select(ExtractionBatchItem, Article.title, ExtractionAttempt)
            .join(Article, Article.id == ExtractionBatchItem.article_id)
            .outerjoin(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
            .where(ExtractionBatchItem.batch_id.in_(batch_ids))
            .order_by(ExtractionBatchItem.created_at, ExtractionBatchItem.id)
        )
        for item, title, attempt in (await self.db.execute(stmt)).all():
            rows[item.batch_id].append(
                ItemRow(
                    article_id=item.article_id,
                    title=title,
                    status=item.status,
                    reason_code=item.reason_code,
                    updated_at=item.updated_at,
                    attempt_id=item.attempt_id,
                    attempt_status=attempt.status if attempt else None,
                    attempt_result=attempt.result if attempt else None,
                    attempt_error_code=attempt.error_code if attempt else None,
                    attempt_error=attempt.error if attempt else None,
                    attempt_updated_at=attempt.updated_at if attempt else None,
                )
            )
        return rows

    async def labels(self, batch: ExtractionBatch) -> tuple[str, str, str]:
        project_name, template_name, kind = (
            await self.db.execute(
                select(Project.name, ProjectExtractionTemplate.name, ProjectExtractionTemplate.kind)
                .join(ProjectExtractionTemplate, ProjectExtractionTemplate.project_id == Project.id)
                .where(Project.id == batch.project_id, ProjectExtractionTemplate.id == batch.template_id)
            )
        ).one()
        return project_name, template_name, str(kind)

    async def add(self, batch: ExtractionBatch, article_ids: list[UUID]) -> None:
        self.db.add(batch)
        await self.db.flush()
        self.db.add_all(
            ExtractionBatchItem(batch_id=batch.id, article_id=article_id) for article_id in article_ids
        )
        await self.db.flush()

    async def active_batch_id(self, owner_id: UUID, template_id: UUID) -> UUID | None:
        queued = (
            select(ExtractionBatchItem.id)
            .where(ExtractionBatchItem.batch_id == ExtractionBatch.id, ExtractionBatchItem.status == "queued")
            .exists()
        )
        running = (
            select(ExtractionBatchItem.id)
            .join(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
            .where(
                ExtractionBatchItem.batch_id == ExtractionBatch.id,
                ExtractionBatchItem.status == "dispatched",
                ExtractionAttempt.status.in_(ATTEMPT_LIVE),
            )
            .exists()
        )
        halted = ExtractionBatch.cancelled_at.is_not(None) | ExtractionBatch.stop_code.is_not(None)
        return (
            await self.db.execute(
                select(ExtractionBatch.id)
                .where(
                    ExtractionBatch.owner_id == owner_id,
                    ExtractionBatch.template_id == template_id,
                    running | (queued & ~halted),
                )
                .order_by(ExtractionBatch.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def cancel_queued(self, batch_id: UUID, reason_code: str) -> None:
        await self.db.execute(
            update(ExtractionBatchItem)
            .where(ExtractionBatchItem.batch_id == batch_id, ExtractionBatchItem.status == "queued")
            .values(status="cancelled", reason_code=reason_code)
        )

    async def count_in_flight(self, batch_id: UUID, *, since: datetime) -> int:
        return (
            await self.db.execute(
                select(func.count())
                .select_from(ExtractionBatchItem)
                .join(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
                .where(
                    ExtractionBatchItem.batch_id == batch_id,
                    ExtractionBatchItem.status == "dispatched",
                    ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                    ExtractionAttempt.updated_at >= since,
                )
            )
        ).scalar_one()

    async def claim_queued(self, batch_id: UUID, limit: int) -> list[ExtractionBatchItem]:
        return list(
            (
                await self.db.execute(
                    select(ExtractionBatchItem)
                    .where(ExtractionBatchItem.batch_id == batch_id, ExtractionBatchItem.status == "queued")
                    .order_by(ExtractionBatchItem.created_at, ExtractionBatchItem.id)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )

    async def engine_stop_failure(self, batch_id: UUID) -> tuple[str, str | None] | None:
        row = (
            await self.db.execute(
                select(ExtractionAttempt.error_code, ExtractionAttempt.error)
                .join(ExtractionBatchItem, ExtractionBatchItem.attempt_id == ExtractionAttempt.id)
                .where(
                    ExtractionBatchItem.batch_id == batch_id,
                    ExtractionAttempt.status == "failed",
                    ExtractionAttempt.error_code.in_(ENGINE_STOP_CODES),
                )
                .order_by(ExtractionAttempt.updated_at.desc())
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def stale_dispatched_attempts(
        self, batch_id: UUID, *, before: datetime
    ) -> list[ExtractionAttempt]:
        return list(
            (
                await self.db.execute(
                    select(ExtractionAttempt)
                    .join(ExtractionBatchItem, ExtractionBatchItem.attempt_id == ExtractionAttempt.id)
                    .where(
                        ExtractionBatchItem.batch_id == batch_id,
                        ExtractionBatchItem.status == "dispatched",
                        ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                        ExtractionAttempt.updated_at < before,
                    )
                )
            ).scalars()
        )
```

Repositories may import `app.services.extraction_batch_view` only if `check_layered_arch.py` allows repository → service imports; if it refuses, move `ItemRow`, `ATTEMPT_LIVE` and `ENGINE_STOP_CODES` into `backend/app/schemas/extraction_batch.py` (schemas are importable from every layer) and import them from there in both the view and the repository. Run the gate in Step 5 to decide.

- [ ] **Step 4: Implement the guard and reads**

Create `backend/app/services/extraction_batch_service.py`:

```python
"""AI batch runs: the ownership guard, reads, and (Task 7) create/cancel."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_batch import ExtractionBatch
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.extraction_batch import ExtractionBatchDetail, ExtractionBatchSummary
from app.services.extraction_batch_view import ItemRow, derive_batch

LIST_WINDOW = timedelta(days=7)


class BatchNotFoundError(Exception):
    """Missing, foreign, or no longer visible to its owner — one error for all."""


async def owned_batch(db: AsyncSession, *, owner_id: UUID, batch_id: UUID) -> ExtractionBatch:
    """THE batch guard: owned by ``owner_id``, who is still a project member.

    Owner and membership live in the WHERE clause, so a foreign batch and a
    missing one raise the same error with the same message.
    """
    batch = await ExtractionBatchRepository(db).get_owned(batch_id, owner_id)
    if batch is None:
        raise BatchNotFoundError("Batch not found")
    return batch


class ExtractionBatchService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.batches = ExtractionBatchRepository(db)

    async def detail(self, owner_id: UUID, batch_id: UUID, *, now: datetime) -> ExtractionBatchDetail:
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        rows = (await self.batches.item_rows([batch.id]))[batch.id]
        summary = await self._summary(batch, rows, now)
        items = derive_batch(
            cancelled_at=batch.cancelled_at, stop_code=batch.stop_code,
            created_at=batch.created_at, rows=rows, now=now,
        ).items
        return ExtractionBatchDetail(**summary.model_dump(), items=items)

    async def list_for_owner(
        self, owner_id: UUID, *, project_id: UUID | None, active_only: bool, now: datetime
    ) -> list[ExtractionBatchSummary]:
        batches = await self.batches.list_owned(owner_id, since=now - LIST_WINDOW, project_id=project_id)
        rows = await self.batches.item_rows([b.id for b in batches])
        summaries = [await self._summary(b, rows[b.id], now) for b in batches]
        return [s for s in summaries if s.state == "active"] if active_only else summaries

    async def _summary(
        self, batch: ExtractionBatch, rows: list[ItemRow], now: datetime
    ) -> ExtractionBatchSummary:
        view = derive_batch(
            cancelled_at=batch.cancelled_at, stop_code=batch.stop_code,
            created_at=batch.created_at, rows=rows, now=now,
        )
        project_name, template_name, kind = await self.batches.labels(batch)
        return ExtractionBatchSummary(
            id=batch.id,
            project_id=batch.project_id,
            project_name=project_name,
            template_id=batch.template_id,
            template_name=template_name,
            kind=kind,
            created_at=batch.created_at,
            finished_at=view.finished_at,
            state=view.state,
            stalled=view.stalled,
            stop_code=batch.stop_code,
            stop_message=batch.stop_message,
            counts=view.counts,
        )
```

- [ ] **Step 5: Run tests and gates**

Run: `cd backend && uv run pytest tests/integration/test_extraction_batch_reads.py -q`
Expected: all PASS.

Run each from the worktree root:
`uv run --project backend python scripts/fitness/check_scope_guards.py`
`uv run --project backend python scripts/fitness/check_layered_arch.py`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add backend/app/repositories/extraction_batch_repository.py backend/app/services/extraction_batch_service.py backend/tests/integration/helpers/batch_fixtures.py backend/tests/integration/test_extraction_batch_reads.py
```

```bash
git commit -m "feat(extraction): batch repository, owned_batch guard and reads

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Dispatcher and Celery task

**Files:**
- Create: `backend/app/services/extraction_batch_dispatcher.py`
- Create: `backend/app/worker/tasks/extraction_batch_tasks.py`
- Modify: `backend/app/worker/celery_app.py` (include + route)
- Modify: `backend/tests/unit/test_celery_app_task_registry.py` (`EXPECTED_TASK_MODULES`)
- Test: `backend/tests/integration/test_extraction_batch_dispatcher.py`, `backend/tests/unit/test_extraction_batch_tasks.py`

**Interfaces:**
- Consumes: Task 5 repository; `HITLSessionService(db).open_or_resume(*, kind, project_id, article_id, user_id, project_template_id)`; `ExtractionAttemptService(db).prepare_request(payload, owner_id, *, job_id)`; `owned_articles`, `owned_template`; `take_advisory_xact_lock` is NOT used here (see Ruling 4).
- Produces:
  - `EnqueueAttempt = Callable[[ExtractionAttempt, UUID], None]`
  - `class ExtractionBatchDispatcher(db: AsyncSession, *, enqueue: EnqueueAttempt, now: Callable[[], datetime] = ...)` with `MAX_IN_FLIGHT = 2`, `LIVE_WINDOW = timedelta(hours=1)`, `async def advance(self, batch_id: UUID, *, reenqueue_stale: bool = False) -> None`.
  - Skip reason codes: `RUN_FINALIZED`, `RUN_NOT_EDITABLE`, `AI_ALREADY_RUNNING`, `ALREADY_HAS_AI_SUGGESTIONS`, `NO_LONGER_AVAILABLE`; cancel reasons `CANCELLED`, `STOPPED_ENGINE_ERROR`.
  - `batch_request_id(item_id: UUID) -> UUID` (uuid5).
  - Task `advance_extraction_batch(batch_id: str, reenqueue_stale: bool = False) -> None` (name `app.worker.tasks.extraction_batch_tasks.advance_extraction_batch`, queue `extractions`, `rate_limit=None`) and `enqueue_attempt(attempt: ExtractionAttempt, batch_id: UUID) -> None`.

- [ ] **Step 1: Write the failing unit tests (task wiring, Celery semantics)**

Create `backend/tests/unit/test_extraction_batch_tasks.py`:

```python
"""Wiring of the batch task and the Celery semantics the dispatcher relies on."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from celery.app.task import Context

from app.worker.celery_app import celery_app
from app.worker.tasks import extraction_batch_tasks as tasks
from app.worker.tasks.extraction_tasks import run_section_extraction_task


def test_batch_task_routes_to_extractions_without_rate_limit() -> None:
    route = celery_app.conf.task_routes["app.worker.tasks.extraction_batch_tasks.*"]
    assert route == {"queue": "extractions"}
    assert tasks.advance_extraction_batch.rate_limit is None


def test_enqueue_attempt_links_success_and_final_failure_back_to_the_batch() -> None:
    attempt = SimpleNamespace(id=uuid4(), owner_id=uuid4(), job_id="job-1", request_payload={"x": 1})
    batch_id = uuid4()
    with patch.object(run_section_extraction_task, "apply_async") as apply_async:
        tasks.enqueue_attempt(attempt, batch_id)

    kwargs = apply_async.call_args.kwargs
    assert kwargs["task_id"] == "job-1"
    assert kwargs["kwargs"] == {"attempt_id": str(attempt.id)}
    for key in ("link", "link_error"):
        sig = kwargs[key]
        assert sig.task == tasks.advance_extraction_batch.name
        assert sig.args == (str(batch_id),)
        assert sig.immutable


def test_a_retry_keeps_the_callbacks() -> None:
    link = tasks.advance_extraction_batch.si("b")
    request = Context(id="job-1", args=(), kwargs={}, callbacks=[link], errbacks=[link], retries=0)
    retried = run_section_extraction_task.signature_from_request(request)
    assert retried.options["link"] == [link]
    assert retried.options["link_error"] == [link]
```

If `signature_from_request` in the installed Celery names the options differently, read `celery/app/task.py:signature_from_request` and assert on the keys it actually sets for `callbacks`/`errbacks`; the assertion's intent (a retry re-sends both callbacks) must stay.

In `backend/tests/unit/test_celery_app_task_registry.py`, add to `EXPECTED_TASK_MODULES`:

```python
    ("app.worker.tasks.extraction_batch_tasks", "advance_extraction_batch"),
```

- [ ] **Step 2: Write the failing dispatcher integration tests**

Create `backend/tests/integration/test_extraction_batch_dispatcher.py`:

```python
"""Dispatcher (spec §8, G6–G12, G16): real session runs and attempts, fake queue."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher, batch_request_id
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch


class FakeQueue:
    def __init__(self) -> None:
        self.calls: list[tuple[UUID, UUID]] = []

    def __call__(self, attempt, batch_id: UUID) -> None:  # noqa: ANN001
        self.calls.append((attempt.id, batch_id))


async def _items(db: AsyncSession, batch_id: UUID) -> list[tuple[str, str | None, UUID | None]]:
    return [
        (r.status, r.reason_code, r.attempt_id)
        for r in (
            await db.execute(
                text("SELECT status, reason_code, attempt_id FROM public.extraction_batch_items "
                     "WHERE batch_id=:b ORDER BY created_at, id"),
                {"b": str(batch_id)},
            )
        ).all()
    ]


async def _batch(db: AsyncSession, count: int, **fields) -> tuple[UUID, list[UUID]]:
    articles = [await make_article(db, SEED.primary_project, f"A{i}") for i in range(count)]
    batch_id = await make_batch(db, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                                template_id=SEED.primary_template, article_ids=articles, **fields)
    await db.commit()
    return batch_id, articles


@pytest.mark.asyncio
async def test_dispatches_at_most_two_articles(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 3)
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    items = await _items(db_session, batch_id)
    assert [s for s, _, _ in items] == ["dispatched", "dispatched", "queued"]
    assert len(queue.calls) == 2 and all(b == batch_id for _, b in queue.calls)
    payload = (
        await db_session.execute(text("SELECT request_payload FROM public.extraction_attempts WHERE id=:id"),
                                 {"id": str(items[0][2])})
    ).scalar_one()
    assert payload["run_id"] and payload["skip_fields_with_human_proposals"] is True


@pytest.mark.asyncio
async def test_advancing_again_creates_no_duplicate_attempt(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 2)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)

    await dispatcher.advance(batch_id)
    await dispatcher.advance(batch_id, reenqueue_stale=True)

    attempts = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_attempts a JOIN public.extraction_batch_items i "
                 "ON i.attempt_id = a.id WHERE i.batch_id=:b"), {"b": str(batch_id)})
    ).scalar_one()
    assert attempts == 2 and len(queue.calls) == 2


@pytest.mark.asyncio
async def test_completion_frees_a_slot(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 3)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    first_attempt = (await _items(db_session, batch_id))[0][2]
    await db_session.execute(text("UPDATE public.extraction_attempts SET status='completed', result='{}' WHERE id=:id"),
                             {"id": str(first_attempt)})

    await dispatcher.advance(batch_id)

    assert [s for s, _, _ in await _items(db_session, batch_id)] == ["dispatched"] * 3


@pytest.mark.asyncio
async def test_engine_class_failure_stops_the_batch(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 3)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    first_attempt = (await _items(db_session, batch_id))[0][2]
    await db_session.execute(
        text("UPDATE public.extraction_attempts SET status='failed', error_code='MISSING_API_KEY', error='no key' WHERE id=:id"),
        {"id": str(first_attempt)})

    await dispatcher.advance(batch_id)

    stop = (await db_session.execute(text("SELECT stop_code, stop_message FROM public.extraction_batches WHERE id=:b"),
                                     {"b": str(batch_id)})).one()
    assert stop == ("MISSING_API_KEY", "no key")
    assert (await _items(db_session, batch_id))[2][:2] == ("cancelled", "STOPPED_ENGINE_ERROR")
    assert len(queue.calls) == 2


@pytest.mark.asyncio
async def test_cancelled_batch_cancels_queued_and_dispatches_nothing(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 2, cancelled_at=datetime.now(UTC))
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert [(s, r) for s, r, _ in await _items(db_session, batch_id)] == [("cancelled", "CANCELLED")] * 2
    assert queue.calls == []


@pytest.mark.asyncio
async def test_owner_without_reviewer_role_skips_every_article(db_session: AsyncSession) -> None:
    articles = [await make_article(db_session, SEED.primary_project)]
    batch_id = await make_batch(db_session, owner_id=SEED.outsider_profile, project_id=SEED.primary_project,
                                template_id=SEED.primary_template, article_ids=articles)
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert (await _items(db_session, batch_id))[0][:2] == ("skipped", "NO_LONGER_AVAILABLE")
    assert queue.calls == []


@pytest.mark.asyncio
async def test_disabled_tool_skips(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 1)
    await db_session.execute(text("UPDATE public.project_extraction_templates SET is_active=false WHERE id=:t"),
                             {"t": str(SEED.primary_template)})

    await ExtractionBatchDispatcher(db_session, enqueue=FakeQueue()).advance(batch_id)

    assert (await _items(db_session, batch_id))[0][:2] == ("skipped", "NO_LONGER_AVAILABLE")


@pytest.mark.asyncio
async def test_run_stage_reasons(db_session: AsyncSession) -> None:
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=FakeQueue())
    batch = SimpleNamespace(owner_id=SEED.primary_profile, skip_articles_with_ai_suggestions=False)
    item = SimpleNamespace(id=uuid4())

    assert await dispatcher._run_reason(batch, item, uuid4(), "finalized") == "RUN_FINALIZED"
    assert await dispatcher._run_reason(batch, item, uuid4(), "consensus") == "RUN_NOT_EDITABLE"
    assert await dispatcher._run_reason(batch, item, uuid4(), "extract") is None


@pytest.mark.asyncio
async def test_owner_already_running_ai_on_the_run_is_skipped(db_session: AsyncSession) -> None:
    first_batch, articles = await _batch(db_session, 1)
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=FakeQueue())
    await dispatcher.advance(first_batch)
    second_batch = await make_batch(db_session, owner_id=SEED.primary_profile, project_id=SEED.primary_project,
                                    template_id=SEED.primary_template, article_ids=articles)

    await dispatcher.advance(second_batch)

    assert (await _items(db_session, second_batch))[0][:2] == ("skipped", "AI_ALREADY_RUNNING")


@pytest.mark.asyncio
async def test_existing_ai_suggestions_skip_only_when_asked(db_session: AsyncSession, monkeypatch) -> None:
    async def has_ai(self, run_id):  # noqa: ANN001
        return True

    monkeypatch.setattr(ExtractionBatchDispatcher, "_run_has_ai_suggestions", has_ai)
    skip_on, _ = await _batch(db_session, 1)
    skip_off, _ = await _batch(db_session, 1, skip_articles_with_ai_suggestions=False)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)

    await dispatcher.advance(skip_on)
    await dispatcher.advance(skip_off)

    assert (await _items(db_session, skip_on))[0][:2] == ("skipped", "ALREADY_HAS_AI_SUGGESTIONS")
    assert (await _items(db_session, skip_off))[0][0] == "dispatched"


@pytest.mark.asyncio
async def test_resume_reenqueues_an_hour_old_pending_attempt(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 1)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    attempt_id = (await _items(db_session, batch_id))[0][2]
    await db_session.execute(text("UPDATE public.extraction_attempts SET updated_at = now() - interval '61 minutes' WHERE id=:id"),
                             {"id": str(attempt_id)})

    await dispatcher.advance(batch_id)
    assert len(queue.calls) == 1
    await dispatcher.advance(batch_id, reenqueue_stale=True)
    assert len(queue.calls) == 2 and queue.calls[1][0] == attempt_id


def test_request_id_is_stable_per_item() -> None:
    item = uuid4()
    assert batch_request_id(item) == batch_request_id(item) != batch_request_id(uuid4())
```

The dispatcher commits, so `_batch` commits its fixture rows first; under `db_session` every commit lands in the test SAVEPOINT and is still rolled back at teardown.

If `updated_at` on `extraction_attempts` is refreshed by a trigger on UPDATE (so the "61 minutes" write does not stick), set it in a second statement with `ALTER TABLE … DISABLE TRIGGER USER` inside `begin_nested()` — check `0075_extraction_attempts.py` for such a trigger first.

- [ ] **Step 3: Run and confirm failure**

Run: `cd backend && uv run pytest tests/unit/test_extraction_batch_tasks.py tests/unit/test_celery_app_task_registry.py tests/integration/test_extraction_batch_dispatcher.py -q`
Expected: FAIL with `ModuleNotFoundError` for `extraction_batch_tasks` / `extraction_batch_dispatcher`, and the registry test naming the missing module.

- [ ] **Step 4: Implement the dispatcher**

Create `backend/app/services/extraction_batch_dispatcher.py`:

```python
"""Advance one AI batch (spec 2026-09-15 §8): claim, guard, dispatch, stop.

Called by the ``advance_extraction_batch`` task after a kickoff, after every
attempt's success or final failure (Celery ``link`` / ``link_error``), and on
Resume. A session-level advisory lock serializes calls per batch: a second
call waits, then recounts, so a freed slot is never lost. Every write commits
before the queue is touched.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4, uuid5

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import ConflictError, NotFoundError
from app.core.logging import get_logger
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem
from app.models.extraction_versioning import TemplateKind
from app.models.extraction_workflow import ExtractionProposalRecord
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.extraction import SectionExtractionRequest
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.extraction_attempt_service import ExtractionAttemptService
from app.services.extraction_batch_view import ATTEMPT_LIVE
from app.services.extraction_run_read_service import get_run_or_raise
from app.services.hitl_session_service import HITLSessionInputError, HITLSessionService
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.run_lifecycle_service import InvalidStageTransitionError

logger = get_logger(__name__)

EnqueueAttempt = Callable[[ExtractionAttempt, UUID], None]

_REQUEST_NAMESPACE = UUID("6f0d0c1e-7a47-4f5e-9d61-3b1f0f4a9b20")


def batch_request_id(item_id: UUID) -> UUID:
    """The attempt request id of a batch item — stable, so Resume is idempotent."""
    return uuid5(_REQUEST_NAMESPACE, str(item_id))


class ExtractionBatchDispatcher:
    MAX_IN_FLIGHT = 2
    #: An in-flight attempt untouched this long no longer holds a slot or blocks
    #: G9, and Resume re-enqueues it (Redis visibility timeout is 1h too).
    LIVE_WINDOW = timedelta(hours=1)

    def __init__(
        self,
        db: AsyncSession,
        *,
        enqueue: EnqueueAttempt,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self.enqueue = enqueue
        self.now = now
        self.batches = ExtractionBatchRepository(db)

    async def advance(self, batch_id: UUID, *, reenqueue_stale: bool = False) -> None:
        await self._lock(batch_id)
        try:
            await self._advance(batch_id, reenqueue_stale=reenqueue_stale)
        except Exception:
            await self.db.rollback()
            raise
        finally:
            await self._unlock(batch_id)

    async def _lock(self, batch_id: UUID) -> None:
        await self.db.execute(
            text("SELECT pg_advisory_lock(hashtextextended(:k, 0))"),
            {"k": f"extraction_batch:{batch_id}"},
        )

    async def _unlock(self, batch_id: UUID) -> None:
        await self.db.execute(
            text("SELECT pg_advisory_unlock(hashtextextended(:k, 0))"),
            {"k": f"extraction_batch:{batch_id}"},
        )
        await self.db.commit()

    async def _advance(self, batch_id: UUID, *, reenqueue_stale: bool) -> None:
        batch = await self.db.get(ExtractionBatch, batch_id)
        if batch is None:
            return  # cascaded away with its project, tool or owner

        if batch.cancelled_at is not None or batch.stop_code is not None:
            reason = "CANCELLED" if batch.cancelled_at is not None else "STOPPED_ENGINE_ERROR"
            await self.batches.cancel_queued(batch.id, reason)
            await self.db.commit()
            return

        failure = await self.batches.engine_stop_failure(batch.id)
        if failure is not None:
            batch.stop_code, batch.stop_message = failure
            await self.batches.cancel_queued(batch.id, "STOPPED_ENGINE_ERROR")
            await self.db.commit()
            logger.warning("extraction_batch.stopped", batch_id=str(batch.id), stop_code=failure[0])
            return

        if reenqueue_stale:
            stale = await self.batches.stale_dispatched_attempts(
                batch.id, before=self.now() - self.LIVE_WINDOW
            )
            await self.db.commit()
            for attempt in stale:
                self.enqueue(attempt, batch.id)

        kind = await self._template_kind(batch)
        while True:
            live_since = self.now() - self.LIVE_WINDOW
            capacity = self.MAX_IN_FLIGHT - await self.batches.count_in_flight(batch.id, since=live_since)
            if capacity <= 0:
                return
            claimed = await self.batches.claim_queued(batch.id, capacity)
            if not claimed:
                await self.db.commit()
                return
            for item in claimed:
                await self._dispatch_one(batch, item, kind)

    async def _template_kind(self, batch: ExtractionBatch) -> str | None:
        try:
            template = await owned_template(
                self.db, project_id=batch.project_id, template_id=batch.template_id
            )
        except ProjectTemplateNotFoundError:
            return None
        return str(template.kind) if template.is_active else None

    async def _dispatch_one(
        self, batch: ExtractionBatch, item: ExtractionBatchItem, kind: str | None
    ) -> None:
        reason = await self._preflight(batch, item, kind)
        if reason is not None:
            await self._skip(item, reason)
            return
        assert kind is not None

        try:
            session = await HITLSessionService(self.db).open_or_resume(
                kind=TemplateKind(kind),
                project_id=batch.project_id,
                article_id=item.article_id,
                user_id=batch.owner_id,
                project_template_id=batch.template_id,
            )
            run = await get_run_or_raise(self.db, session.run_id)
            reason = await self._run_reason(batch, item, run.id, run.stage)
            if reason is not None:
                await self._skip(item, reason)
                return
            attempt = await ExtractionAttemptService(self.db).prepare_request(
                SectionExtractionRequest(
                    request_id=batch_request_id(item.id),
                    project_id=batch.project_id,
                    article_id=item.article_id,
                    template_id=batch.template_id,
                    run_id=run.id,
                    extract_all_sections=kind == TemplateKind.EXTRACTION.value,
                    skip_fields_with_human_proposals=True,
                ),
                batch.owner_id,
                job_id=str(uuid4()),
            )
        except (HITLSessionInputError, NotFoundError, ConflictError):
            await self._skip(item, "NO_LONGER_AVAILABLE", discard_writes=True)
            return
        except InvalidStageTransitionError:
            await self._skip(item, "RUN_NOT_EDITABLE", discard_writes=True)
            return

        item = await self.db.merge(item)
        item.attempt_id, item.status = attempt.id, "dispatched"
        await self.db.commit()
        if attempt.status in ATTEMPT_LIVE:
            self.enqueue(attempt, batch.id)

    async def _preflight(
        self, batch: ExtractionBatch, item: ExtractionBatchItem, kind: str | None
    ) -> str | None:
        """G6 reviewer role, G7 article and tool still there."""
        is_reviewer = (
            await self.db.execute(
                text("SELECT public.is_project_reviewer(:pid, :uid)"),
                {"pid": str(batch.project_id), "uid": str(batch.owner_id)},
            )
        ).scalar_one()
        if not is_reviewer or kind is None:
            return "NO_LONGER_AVAILABLE"
        try:
            await owned_articles(self.db, project_id=batch.project_id, article_ids=[item.article_id])
        except ArticleNotFoundError:
            return "NO_LONGER_AVAILABLE"
        return None

    async def _run_reason(
        self, batch: ExtractionBatch, item: ExtractionBatchItem, run_id: UUID, stage: str
    ) -> str | None:
        """G8 run stage, G9 owner already running AI, G10 existing AI suggestions."""
        if stage == "finalized":
            return "RUN_FINALIZED"
        if stage != "extract":
            return "RUN_NOT_EDITABLE"
        running = (
            await self.db.execute(
                select(ExtractionAttempt.id).where(
                    ExtractionAttempt.owner_id == batch.owner_id,
                    ExtractionAttempt.run_id == run_id,
                    ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                    ExtractionAttempt.updated_at >= self.now() - self.LIVE_WINDOW,
                    ExtractionAttempt.request_id != batch_request_id(item.id),
                ).limit(1)
            )
        ).first()
        if running is not None:
            return "AI_ALREADY_RUNNING"
        if batch.skip_articles_with_ai_suggestions and await self._run_has_ai_suggestions(run_id):
            return "ALREADY_HAS_AI_SUGGESTIONS"
        return None

    async def _run_has_ai_suggestions(self, run_id: UUID) -> bool:
        return (
            await self.db.execute(
                select(ExtractionProposalRecord.id)
                .where(ExtractionProposalRecord.run_id == run_id, ExtractionProposalRecord.source == "ai")
                .limit(1)
            )
        ).first() is not None

    async def _skip(
        self, item: ExtractionBatchItem, reason: str, *, discard_writes: bool = False
    ) -> None:
        # Only a half-done session open has writes to discard; a guard skip has none.
        if discard_writes:
            await self.db.rollback()
        item = await self.db.merge(item)
        item.status, item.reason_code = "skipped", reason
        await self.db.commit()
```

Notes for the implementer (verify each, do not guess):
- `ExtractionRunStage` values are lowercase (`"extract"`, `"finalized"`, `"consensus"`); `get_run_or_raise(...).stage` is a `str`.
- `open_or_resume` and `prepare_request` may commit; that releases the `FOR UPDATE SKIP LOCKED` item locks, which is safe because the advisory lock serializes dispatchers and cancel only touches `queued` rows. `db.merge(item)` re-attaches the item after a commit/rollback expired it.
- `TemplateKind.EXTRACTION.value` must equal the template's stored `kind` string (`"extraction"`); confirm in `app/models/extraction_versioning.py`.
- The dispatcher catches only the typed errors listed; anything else propagates, the task logs it, and the batch reads `stalled` (Resume retries).

- [ ] **Step 5: Implement the task module and register it**

Create `backend/app/worker/tasks/extraction_batch_tasks.py`:

```python
"""AI batch dispatcher task (spec 2026-09-15 §8)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from celery import Task

from app.core.logging import get_logger
from app.worker._runner import run_task
from app.worker.celery_app import celery_app
from app.worker.tasks.extraction_tasks import run_section_extraction_task

logger = get_logger(__name__)


def enqueue_attempt(attempt: Any, batch_id: UUID) -> None:
    """Queue one article's attempt; its success or FINAL failure re-advances the batch.

    ``link_error`` fires once, after retries are exhausted (Celery skips
    errbacks on RETRY), and a retry re-sends both callbacks.
    """
    advance = advance_extraction_batch.si(str(batch_id))
    run_section_extraction_task.apply_async(
        args=(attempt.request_payload, str(attempt.owner_id), None),
        kwargs={"attempt_id": str(attempt.id)},
        task_id=attempt.job_id,
        link=advance,
        link_error=advance,
    )


@celery_app.task(bind=True, rate_limit=None, max_retries=0)
def advance_extraction_batch(
    self: Task[Any, Any], batch_id: str, reenqueue_stale: bool = False
) -> None:
    async def run() -> None:
        from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher
        from app.worker._session import worker_session

        async with worker_session() as db:
            await ExtractionBatchDispatcher(db, enqueue=enqueue_attempt).advance(
                UUID(batch_id), reenqueue_stale=reenqueue_stale
            )

    logger.info("extraction_batch.advance", batch_id=batch_id, task_id=self.request.id)
    run_task(run)
```

In `backend/app/worker/celery_app.py` add `"app.worker.tasks.extraction_batch_tasks",` to `include` (after `extraction_tasks`) and to `task_routes`:

```python
        # AI batch dispatcher: no LLM work, but it hands jobs to the
        # extraction queue, so it lives beside them.
        "app.worker.tasks.extraction_batch_tasks.*": {"queue": "extractions"},
```

- [ ] **Step 6: Run and confirm pass**

Run: `cd backend && uv run pytest tests/unit/test_extraction_batch_tasks.py tests/unit/test_celery_app_task_registry.py tests/unit/test_celery_routes_drift.py tests/integration/test_extraction_batch_dispatcher.py -q`
Expected: all PASS.

Run from the worktree root: `uv run --project backend python scripts/fitness/check_layered_arch.py` and `uv run --project backend python scripts/fitness/check_scope_guards.py`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/extraction_batch_dispatcher.py backend/app/worker/tasks/extraction_batch_tasks.py backend/app/worker/celery_app.py backend/tests/unit/test_celery_app_task_registry.py backend/tests/unit/test_extraction_batch_tasks.py backend/tests/integration/test_extraction_batch_dispatcher.py
```

```bash
git commit -m "feat(extraction): AI batch dispatcher task

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Endpoints, create and cancel

**Files:**
- Modify: `backend/app/schemas/common.py` (`ApiErrorCode`)
- Modify: `backend/app/services/extraction_batch_service.py` (`BatchAlreadyActiveError`, `create`, `cancel`)
- Create: `backend/app/api/v1/endpoints/extraction_batches.py`
- Modify: `backend/app/api/v1/router.py`
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`
- Test: `backend/tests/integration/test_extraction_batches_endpoints.py`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces:
  - `ApiErrorCode.AI_BATCH_ALREADY_ACTIVE = "AI_BATCH_ALREADY_ACTIVE"`
  - `class BatchAlreadyActiveError(AppError)` — 409, `details={"batch_id": str}`
  - `class BatchScopeError(Exception)` — foreign/missing template or article
  - `ExtractionBatchService.create(owner_id: UUID, request: CreateExtractionBatchRequest) -> UUID` (commits)
  - `ExtractionBatchService.cancel(owner_id: UUID, batch_id: UUID, *, now: datetime) -> None` (commits)
  - Routes under `/api/v1/extraction/batches`: `POST ""` 202, `GET ""` (`project_id`, `active`), `GET /{batch_id}`, `POST /{batch_id}/cancel`, `POST /{batch_id}/resume`.

- [ ] **Step 1: Write the failing endpoint tests**

Create `backend/tests/integration/test_extraction_batches_endpoints.py`:

```python
"""/api/v1/extraction/batches — G1–G5b at the edge; the queue is the only stub."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import extraction_batches as ep
from app.services.llm_engine_service import EngineRetiredError
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup
from tests.integration.helpers.batch_fixtures import make_article

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider

URL = "/api/v1/extraction/batches"


@pytest.fixture
def queue(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    task = MagicMock()
    monkeypatch.setattr(ep, "advance_extraction_batch", task)
    monkeypatch.setattr(ep, "_is_queue_available", lambda: True)

    async def engine(*_args, **_kwargs):  # noqa: ANN002, ANN003
        return MagicMock()

    monkeypatch.setattr(ep, "resolve_engine", engine)
    return task


def _body(article_ids, **extra) -> dict:  # noqa: ANN001
    return {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template),
            "article_ids": [str(a) for a in article_ids], **extra}


async def _batch_count(db: AsyncSession) -> int:
    return (await db.execute(text("SELECT count(*) FROM public.extraction_batches WHERE owner_id=:o"),
                             {"o": str(SEED.primary_profile)})).scalar_one()


@pytest.mark.asyncio
async def test_start_returns_202_detail_and_kicks_the_dispatcher(
    client_as_manager: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    a = await make_article(db_session, SEED.primary_project, "Alpha")
    response = await client_as_manager.post(URL, json=_body([a, a]))

    assert response.status_code == 202, response.text
    data = response.json()["data"]
    assert data["state"] == "active" and data["counts"]["total"] == 1
    assert data["items"][0]["title"] == "Alpha"
    queue.delay.assert_called_once_with(data["id"])


@pytest.mark.asyncio
async def test_non_member_is_refused_and_nothing_is_written(
    client_as_outsider: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    before = await _batch_count(db_session)
    response = await client_as_outsider.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 403
    assert await _batch_count(db_session) == before
    queue.delay.assert_not_called()


@pytest.mark.asyncio
async def test_viewer_is_refused(client_as_outsider: AsyncClient, db_session: AsyncSession, queue: MagicMock) -> None:
    await db_session.execute(
        text("INSERT INTO public.project_members (project_id, user_id, role) VALUES (:p, :u, 'viewer')"),
        {"p": str(SEED.primary_project), "u": str(SEED.outsider_profile)},
    )
    response = await client_as_outsider.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_foreign_template_and_foreign_article_answer_the_same_400(
    client_as_manager: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    foreign_article = await make_article(db_session, SEED.secondary_project)
    bad_template = await client_as_manager.post(URL, json={**_body([SEED.primary_article]), "template_id": str(uuid4())})
    bad_article = await client_as_manager.post(URL, json=_body([SEED.primary_article, foreign_article]))
    assert bad_template.status_code == bad_article.status_code == 400
    assert bad_template.json()["error"] == bad_article.json()["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 101])
async def test_article_count_out_of_bounds_is_422(client_as_manager: AsyncClient, queue: MagicMock, count: int) -> None:
    response = await client_as_manager.post(URL, json=_body([uuid4() for _ in range(count)]))
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_retired_engine_is_409_and_writes_nothing(
    client_as_manager: AsyncClient, db_session: AsyncSession, queue: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def retired(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise EngineRetiredError("retired")

    monkeypatch.setattr(ep, "resolve_engine", retired)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 409 and response.json()["error"]["code"] == "LLM_ENGINE_RETIRED"
    assert await _batch_count(db_session) == before


@pytest.mark.asyncio
async def test_queue_down_is_503_and_writes_nothing(
    client_as_manager: AsyncClient, db_session: AsyncSession, queue: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ep, "_is_queue_available", lambda: False)
    before = await _batch_count(db_session)
    response = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert response.status_code == 503
    assert await _batch_count(db_session) == before


@pytest.mark.asyncio
async def test_second_batch_for_the_same_tool_is_409_with_the_active_id(
    client_as_manager: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    a = await make_article(db_session, SEED.primary_project)
    first = (await client_as_manager.post(URL, json=_body([a]))).json()["data"]["id"]
    second = await client_as_manager.post(URL, json=_body([SEED.primary_article]))
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "AI_BATCH_ALREADY_ACTIVE"
    assert second.json()["error"]["details"] == {"batch_id": first}


@pytest.mark.asyncio
async def test_list_detail_cancel_and_resume(
    client_as_manager: AsyncClient, client_as_outsider: AsyncClient, db_session: AsyncSession, queue: MagicMock
) -> None:
    a = await make_article(db_session, SEED.primary_project)
    batch_id = (await client_as_manager.post(URL, json=_body([a]))).json()["data"]["id"]

    listed = await client_as_manager.get(URL, params={"project_id": str(SEED.primary_project), "active": "true"})
    assert [b["id"] for b in listed.json()["data"]] == [batch_id]
    assert (await client_as_outsider.get(f"{URL}/{batch_id}")).status_code == 404
    assert (await client_as_manager.get(f"{URL}/{uuid4()}")).status_code == 404

    cancelled = await client_as_manager.post(f"{URL}/{batch_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["data"]["state"] == "cancelled"
    assert cancelled.json()["data"]["items"][0]["reason_code"] == "CANCELLED"

    queue.delay.reset_mock()
    resumed = await client_as_manager.post(f"{URL}/{batch_id}/resume")
    assert resumed.status_code == 200
    queue.delay.assert_called_once_with(batch_id, True)
```

`client_as_outsider` sends its own identity header, so the viewer test reuses it after inserting the membership row. If `project_members` requires more columns (e.g. `id`), copy the insert from `backend/tests/integration/test_blind_review_isolation.py:138`.

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && uv run pytest tests/integration/test_extraction_batches_endpoints.py -q`
Expected: FAIL with `ImportError: cannot import name 'extraction_batches'`.

- [ ] **Step 3: Add the error code and the create/cancel service methods**

In `backend/app/schemas/common.py`, add to `ApiErrorCode` after `CONFLICT`:

```python
    AI_BATCH_ALREADY_ACTIVE = "AI_BATCH_ALREADY_ACTIVE"
```

In `backend/app/services/extraction_batch_service.py`, add imports:

```python
from app.core.error_handler import AppError
from app.schemas.common import ApiErrorCode
from app.schemas.extraction_batch import CreateExtractionBatchRequest
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
```

Add below `BatchNotFoundError`:

```python
class BatchScopeError(Exception):
    """The template or an article is missing or outside the project (one error, G2/G3)."""


class BatchAlreadyActiveError(AppError):
    """The caller already runs a batch for this tool (G5b)."""

    def __init__(self, batch_id: UUID) -> None:
        super().__init__(
            code=ApiErrorCode.AI_BATCH_ALREADY_ACTIVE.value,
            message="An AI batch is already running for this tool",
            status_code=409,
            details={"batch_id": str(batch_id)},
        )
```

Add to `ExtractionBatchService`:

```python
    async def create(self, owner_id: UUID, request: CreateExtractionBatchRequest) -> UUID:
        """G2, G3, G5b, then the rows. The caller checked G1 and G5 and enqueues after."""
        try:
            await owned_template(self.db, project_id=request.project_id, template_id=request.template_id)
            article_ids = await owned_articles(
                self.db, project_id=request.project_id, article_ids=request.article_ids
            )
        except (ProjectTemplateNotFoundError, ArticleNotFoundError) as exc:
            raise BatchScopeError("template_id or article_ids do not belong to project_id") from exc

        await take_advisory_xact_lock(self.db, owner_id, request.template_id)
        active = await self.batches.active_batch_id(owner_id, request.template_id)
        if active is not None:
            raise BatchAlreadyActiveError(active)

        batch = ExtractionBatch(
            owner_id=owner_id,
            project_id=request.project_id,
            template_id=request.template_id,
            skip_articles_with_ai_suggestions=request.skip_articles_with_ai_suggestions,
        )
        await self.batches.add(batch, article_ids)
        await self.db.commit()
        return batch.id

    async def cancel(self, owner_id: UUID, batch_id: UUID, *, now: datetime) -> None:
        """Queued articles become not-run; in-flight ones finish (spec §7.1)."""
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        if batch.cancelled_at is None:
            batch.cancelled_at = now
        await self.batches.cancel_queued(batch.id, "CANCELLED")
        await self.db.commit()
```

- [ ] **Step 4: Add the endpoints and mount the router**

Create `backend/app/api/v1/endpoints/extraction_batches.py`:

```python
"""AI batch runs over many articles (spec 2026-09-15 §7).

The batch runs server-side: POST writes it and kicks
``advance_extraction_batch``; GETs derive its state from items and attempts.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from app.api.deps.security import ensure_project_reviewer, get_current_user_sub
from app.api.v1.endpoints.section_extraction import _is_queue_available
from app.core.deps import DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction_batch import (
    CreateExtractionBatchRequest,
    ExtractionBatchDetail,
    ExtractionBatchSummary,
)
from app.services.extraction_batch_service import (
    BatchNotFoundError,
    BatchScopeError,
    ExtractionBatchService,
)
from app.services.llm_engine_service import resolve_engine
from app.utils.rate_limiter import limiter
from app.worker.tasks.extraction_batch_tasks import advance_extraction_batch

router = APIRouter()
logger = get_logger(__name__)


def _trace_id(request: Request) -> str:
    return getattr(request.state, "trace_id", None) or str(uuid.uuid4())


def _queue_unavailable(trace_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=ApiResponse.failure(
            code="SERVICE_UNAVAILABLE",
            message="Background extraction queue is unavailable. Please try again later.",
            trace_id=trace_id,
        ).model_dump(),
    )


def _kick(batch_id: UUID, *, reenqueue_stale: bool = False) -> None:
    try:
        if reenqueue_stale:
            advance_extraction_batch.delay(str(batch_id), True)
        else:
            advance_extraction_batch.delay(str(batch_id))
    except Exception:
        # The rows are committed: the batch reads stalled and Resume recovers it.
        logger.exception("extraction_batch.kick_failed", batch_id=str(batch_id))


async def _detail(db: DbSession, owner_id: UUID, batch_id: UUID) -> ExtractionBatchDetail:
    try:
        return await ExtractionBatchService(db).detail(owner_id, batch_id, now=datetime.now(UTC))
    except BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch not found") from exc


@router.post("", response_model=None, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/minute")
async def start_extraction_batch(
    request: Request,
    payload: CreateExtractionBatchRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse:
    trace_id = _trace_id(request)
    await ensure_project_reviewer(db, payload.project_id, current_user_sub)  # G1
    await resolve_engine(db, payload.project_id, current_user_sub)  # G5: typed 409s
    if not _is_queue_available():
        return _queue_unavailable(trace_id)
    try:
        batch_id = await ExtractionBatchService(db).create(current_user_sub, payload)
    except BatchScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _kick(batch_id)
    detail = await _detail(db, current_user_sub, batch_id)
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=ApiResponse.success(detail, trace_id=trace_id).model_dump(mode="json"),
    )


@router.get("")
@limiter.limit("60/minute")
async def list_extraction_batches(
    request: Request,
    db: DbSession,
    project_id: UUID | None = Query(default=None),
    active: bool = Query(default=False),
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[ExtractionBatchSummary]]:
    summaries = await ExtractionBatchService(db).list_for_owner(
        current_user_sub, project_id=project_id, active_only=active, now=datetime.now(UTC)
    )
    return ApiResponse.success(summaries, trace_id=_trace_id(request))


@router.get("/{batch_id}")
@limiter.limit("60/minute")
async def get_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ExtractionBatchDetail]:
    return ApiResponse.success(
        await _detail(db, current_user_sub, batch_id), trace_id=_trace_id(request)
    )


@router.post("/{batch_id}/cancel")
@limiter.limit("20/minute")
async def cancel_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ExtractionBatchDetail]:
    try:
        await ExtractionBatchService(db).cancel(current_user_sub, batch_id, now=datetime.now(UTC))
    except BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch not found") from exc
    return ApiResponse.success(
        await _detail(db, current_user_sub, batch_id), trace_id=_trace_id(request)
    )


@router.post("/{batch_id}/resume", response_model=None)
@limiter.limit("20/minute")
async def resume_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse | ApiResponse[ExtractionBatchDetail]:
    trace_id = _trace_id(request)
    detail = await _detail(db, current_user_sub, batch_id)
    if not _is_queue_available():
        return _queue_unavailable(trace_id)
    _kick(batch_id, reenqueue_stale=True)
    return ApiResponse.success(detail, trace_id=trace_id)
```

The POST returns `JSONResponse` so the 202 survives; `model_dump(mode="json")` serializes UUIDs and datetimes. If `check_api_response_envelope.py` refuses a `JSONResponse` return without `ApiResponse` in the annotation, annotate it `-> JSONResponse | ApiResponse[ExtractionBatchDetail]` as `section_extraction.py` does.

In `backend/app/api/v1/router.py` import `extraction_batches` beside `section_extraction` and mount it right after the `/extraction/sections` include:

```python
api_router.include_router(
    extraction_batches.router,
    prefix="/extraction/batches",
    tags=["extraction-batches"],
)
```

(Match the surrounding `include_router` calls' `tags` style; drop `tags` if its neighbours have none.)

- [ ] **Step 5: Run tests and gates**

Run: `cd backend && uv run pytest tests/integration/test_extraction_batches_endpoints.py tests/integration/test_extraction_batch_dispatcher.py tests/integration/test_extraction_batch_reads.py -q`
Expected: all PASS.

Run from the worktree root, each on its own:
`uv run --project backend python scripts/fitness/check_api_response_envelope.py`
`uv run --project backend python scripts/fitness/check_layered_arch.py`
`uv run --project backend python scripts/fitness/check_scope_guards.py`
Expected: each exits 0.

- [ ] **Step 6: Regenerate API types**

Run from the worktree root: `npm run generate:api-types`
Expected: `frontend/types/api/openapi.json` and `schema.d.ts` gain `/api/v1/extraction/batches` paths and the `ExtractionBatch*` schemas; no other path changes. Then `npm run typecheck` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/common.py backend/app/services/extraction_batch_service.py backend/app/api/v1/endpoints/extraction_batches.py backend/app/api/v1/router.py backend/tests/integration/test_extraction_batches_endpoints.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
```

```bash
git commit -m "feat(extraction): AI batch endpoints

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, guard list and full verification

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (frontmatter `last_reviewed`; migration-head line ~139; new section after "Extraction attempts and per-call generation (0075)")
- Modify: `.claude/rules/backend.md` (§ Ownership guards list)
- Possibly modify: `backend/.vulture_baseline` (only to tighten)

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Update the architecture doc**

Set `last_reviewed: 2026-09-15` (already today — confirm). Replace `` `0075_extraction_attempts` `` on the migration-head line with `` `0076_extraction_batches` ``. Insert after the 0075 section (before the next `###`):

```markdown
### AI batch runs (0076)

Migration `0076_extraction_batches` (down revision `0075_extraction_attempts`).
Design: `docs/superpowers/specs/2026-09-15-ai-batch-runs-design.md`.

- **`extraction_batches`** (`ExtractionBatch`) — a reviewer's AI batch over
  articles of one project tool: `owner_id`, `project_id`, `template_id` (all
  `ON DELETE CASCADE`), `skip_articles_with_ai_suggestions`, `cancelled_at`,
  `stop_code`/`stop_message`. No status column: state (`active` / `finished` /
  `stopped` / `cancelled`, plus `stalled` after 15 min without progress) is
  derived in `extraction_batch_view.derive_batch`.
- **`extraction_batch_items`** (`ExtractionBatchItem`) — one row per article,
  `UNIQUE (batch_id, article_id)`; `status` `queued` / `dispatched` /
  `skipped` / `failed` / `cancelled`, `reason_code`, `attempt_id`
  (`ON DELETE SET NULL`). A dispatched item's outcome is its attempt's.
- Backend-only: RLS enabled, `anon`/`authenticated` revoked.
- Execution: `advance_extraction_batch` (queue `extractions`) keeps at most 2
  articles in flight, opens the owner's session run
  (`HITLSessionService.open_or_resume`), creates the attempt with request id
  `uuid5(item.id)`, and enqueues `run_section_extraction_task` with
  `link`/`link_error` back to itself. Extraction templates run the full pass
  (`run_id` + `extract_all_sections` → `extract_full_pass`); QA runs
  `extract_for_run`. An attempt failing with `MISSING_API_KEY`,
  `ENGINE_RETIRED` or `LLM_ENDPOINT_UNAVAILABLE` stops the batch.
- API: `/api/v1/extraction/batches` (`POST`, `GET`, `GET /{id}`,
  `POST /{id}/cancel`, `POST /{id}/resume`); guard `owned_batch`.
```

- [ ] **Step 2: Update the guard list**

In `.claude/rules/backend.md` § Ownership guards, replace `` `article_read_service.owned_article`, `` with `` `article_read_service.owned_articles` (and `owned_article`, which delegates), `extraction_batch_service.owned_batch` (a batch in its owner, who is still a project member), ``.

- [ ] **Step 3: Run the backend gates**

From `backend/`, each on its own:
- `uv run ruff check . && uv run ruff format --check .` → exit 0
- `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` → exit 0. A new finding means dead code: delete it. If a finding is a framework-consumed symbol, stop and report instead of baselining.
- `uv run mypy app --ignore-missing-imports > /private/tmp/claude-501/-Users-raphael-PycharmProjects-prumo--claude-worktrees-regras-injecao-skills-669947/b2eeff74-063b-4441-abf0-5c48ba2392f1/scratchpad/mypy.out; uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline --input /private/tmp/claude-501/-Users-raphael-PycharmProjects-prumo--claude-worktrees-regras-injecao-skills-669947/b2eeff74-063b-4441-abf0-5c48ba2392f1/scratchpad/mypy.out` → no new errors in the files this PR touched.
- `uv run alembic check` → `No new upgrade operations detected.`
- `uv run pytest tests/unit -q` → all pass.
- `uv run pytest tests/integration -q -x -p no:randomly` → all pass. Record the summary line; compare any failure against `git stash`-free evidence: re-run that single test on `origin/dev` in a throwaway worktree only if it looks unrelated.

From the worktree root: `bash scripts/fitness/run_all.sh` → exit 0; `npm run typecheck` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/extraction-hitl-architecture.md .claude/rules/backend.md
```

```bash
git commit -m "docs(extraction): AI batch tables, dispatcher and guard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If Step 3 changed `backend/.vulture_baseline` (tightened only), add it to this commit.

- [ ] **Step 5: Review before hand-off**

Load `code-review` and run it on `git diff origin/dev...HEAD`. Report the gate results and any finding to the user. Push and open the PR only when the user asks.
