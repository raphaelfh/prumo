---
status: draft
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# PR-B — Make every ingest path enqueue parse, durably — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a manually-uploaded article PDF actually get parsed
(today it never does), and make a parse failure durably visible.

**Architecture:** The browser keeps uploading PDF bytes directly to
Supabase Storage under the user JWT, but the `article_files` row is now
created by a new backend endpoint that (a) enforces project membership,
(b) validates the storage key against the server-resolved project/article,
and (c) calls the existing `enqueue_parse_at_ingest` hook — without
swallowing enqueue failures. A second endpoint re-enqueues a parse for an
existing file (recovery). Separately, the Celery task records a terminal
`parse_failed` status in its own committed transaction so the status
survives the worker's rollback.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Celery, Pydantic v2,
structlog (backend); React 19 + TS strict, TanStack, Vitest (frontend);
pytest (backend tests). Design spec:
[`2026-06-20-parse-to-markdown-end-to-end-design.md`](../specs/2026-06-20-parse-to-markdown-end-to-end-design.md).

## Global Constraints

- English only for code, comments, commits, docs, copy keys.
- Conventional Commits; PR targets `dev`, squash-merged.
- Backend membership gate: every endpoint touching project data calls
  `ensure_project_member(db, project_id, user_sub)` BEFORE access;
  resolve `project_id` server-side from `article_id`/`article_file_id`,
  never trust the request body.
- API responses use the `ApiResponse` envelope: return
  `-> ApiResponse[X]` and `ApiResponse.success(payload, trace_id=...)`
  (no `response_model=`). Frontend single-unwraps via `apiClient<T>`.
- New frontend backend calls go through `apiClient` (no new
  `supabase.from(...)` writes). Import request/response shapes from the
  generated `frontend/types/api/schema.d.ts` (run
  `npm run generate:api-types`); never hand-mirror enums.
- Alembic revision ids ≤ 32 chars (not used in this PR — no migration).
- `extraction_status` real values are `pending | parsed | parse_failed`.

---

## File Structure

- **Create** `backend/app/api/v1/endpoints/article_files.py` — new router
  hosting `POST /api/v1/articles/{article_id}/files` (confirm upload →
  create row → enqueue) and `POST /api/v1/article-files/{article_file_id}/reparse`
  (re-enqueue). One responsibility: article-file ingest/recovery HTTP.
- **Modify** `backend/app/api/v1/router.py` — register the new module.
- **Modify** `backend/app/worker/tasks/parsing_tasks.py` — add
  `_mark_parse_failed` + durable terminal-failure handling in the task.
- **Modify** `backend/app/services/document_parsing_service.py` — also set
  `extraction_error` on the in-session `parse_failed` flush (so the
  success-path/last-attempt error is captured; durable write is in the
  task). *(small, optional — see Task 1 note.)*
- **Modify** `frontend/services/articlesService.ts` — add
  `confirmArticleFileUpload` + `reparseArticleFile`; route `addArticle`
  and `uploadArticleFile` through the confirm endpoint instead of the
  direct `supabase.from('article_files').insert`.
- **Modify** `frontend/components/articles/ArticleDetailDialog.tsx` — a
  per-file "Re-parse" button calling `reparseArticleFile`.
- **Regenerate** `frontend/types/api/{openapi.json,schema.d.ts}`.
- **Tests:** `backend/tests/integration/test_parsing_tasks_durable_failure.py`,
  `backend/tests/integration/test_article_files_endpoints.py`,
  `frontend/test/services/articlesService.test.ts` (extend).

---

### Task 1: Durable `parse_failed` in the Celery task

A terminal parse failure must persist. Today the worker's
`session.rollback()` (`parsing_tasks.py:88`) discards the service's
`parse_failed` flush, so a failed file stays `pending` forever.

**Files:**
- Modify: `backend/app/worker/tasks/parsing_tasks.py` (add helper at end of
  module; change the task's `except` at `:107-112`)
- Test: `backend/tests/integration/test_parsing_tasks_durable_failure.py`

**Interfaces:**
- Produces: `async def _mark_parse_failed(article_file_id: str, error_message: str) -> None`
  — opens a fresh `worker_session()`, sets
  `extraction_status="parse_failed"` + `extraction_error=error_message[:500]`,
  commits. No-ops if the row is gone.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_parsing_tasks_durable_failure.py`:

```python
"""Durable parse_failed: a terminal failure must survive in its own txn."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article, ArticleFile
from app.worker._session import worker_session
from app.worker.tasks.parsing_tasks import _mark_parse_failed


async def _seed_pending_file(db: AsyncSession) -> UUID:
    """Insert an article + a pending PDF file under a seeded project."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar_one_or_none()
    if project_id is None:
        pytest.skip("Need at least one seeded project")
    article = Article(project_id=project_id, title="durable-fail-test")
    db.add(article)
    await db.flush()
    file = ArticleFile(
        project_id=project_id,
        article_id=article.id,
        file_type="PDF",
        storage_key=f"{project_id}/{article.id}/x.pdf",
        extraction_status="pending",
    )
    db.add(file)
    await db.commit()
    return file.id


@pytest.mark.asyncio
async def test_mark_parse_failed_persists_in_its_own_transaction(
    db_session: AsyncSession,
) -> None:
    file_id = await _seed_pending_file(db_session)

    await _mark_parse_failed(str(file_id), "boom: parser exploded")

    # Read back via a brand-new session to prove the write was committed.
    async with worker_session() as verify:
        row = (
            await verify.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert row.extraction_status == "parse_failed"
        assert "boom" in (row.extraction_error or "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_parsing_tasks_durable_failure.py -v`
Expected: FAIL with `ImportError: cannot import name '_mark_parse_failed'`.

- [ ] **Step 3: Add the helper + durable terminal handling**

In `backend/app/worker/tasks/parsing_tasks.py`, add this coroutine after
`_run_parse` (before the `@celery_app.task` decorator):

```python
async def _mark_parse_failed(article_file_id: str, error_message: str) -> None:
    """Persist a terminal parse failure in its own committed transaction.

    The main worker_session() rolls back on parser error (discarding any
    in-session status flush), so the failure is recorded out-of-band in a
    fresh session that commits independently. Covers parser errors AND
    pre-parse failures (e.g. storage download) the service never marks.
    """
    from sqlalchemy import select

    from app.models.article import ArticleFile
    from app.worker._session import worker_session

    async with worker_session() as session:
        article_file = (
            await session.execute(
                select(ArticleFile).where(ArticleFile.id == UUID(article_file_id))
            )
        ).scalar_one_or_none()
        if article_file is None:
            return
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = error_message[:500]
        await session.commit()
```

Then change the task body (`parsing_tasks.py:107-112`) from:

```python
    try:
        return run_task(
            lambda: _run_parse(article_file_id, project_id, user_id, trace_id or self.request.id)
        )
    except Exception as exc:
        self.retry(exc=exc)
```

to:

```python
    try:
        return run_task(
            lambda: _run_parse(article_file_id, project_id, user_id, trace_id or self.request.id)
        )
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            # Terminal: the main session already rolled back, so persist the
            # failure durably in its own transaction before the task dies.
            run_task(lambda: _mark_parse_failed(article_file_id, str(exc)))
            raise
        raise self.retry(exc=exc)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/integration/test_parsing_tasks_durable_failure.py -v`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && uv run ruff check app/worker/tasks/parsing_tasks.py && uv run ruff format app/worker/tasks/parsing_tasks.py
git add backend/app/worker/tasks/parsing_tasks.py backend/tests/integration/test_parsing_tasks_durable_failure.py
git commit -m "fix(parsing): persist terminal parse_failed in its own transaction"
```

> Note: leaving `document_parsing_service.py` untouched is fine — the task
> handler now covers every failure mode (parser error AND storage/download
> error), which the service path never marked. Do NOT also write
> `extraction_error` in the service (it would be rolled back anyway).

---

### Task 2: Confirm-upload endpoint (`POST /api/v1/articles/{article_id}/files`)

Creates the `article_files` row server-side (membership-gated,
storage-key-validated) and enqueues the parse — without swallowing enqueue
failures.

**Files:**
- Create: `backend/app/api/v1/endpoints/article_files.py`
- Modify: `backend/app/api/v1/router.py:9-26` (import) and `:97-125`
  (register)
- Test: `backend/tests/integration/test_article_files_endpoints.py`

**Interfaces:**
- Consumes: `ConfirmUploadRequest` (`backend/app/schemas/article.py:231`),
  `ArticleFileResponse` (`:181`), `get_article_project_id`
  (`citation_read_service.py`), `ensure_project_member`,
  `get_current_user_sub`, `ArticleFileIngestService.enqueue_parse_at_ingest`.
- Produces: `router` (FastAPI `APIRouter`, no prefix, absolute paths) with
  `POST /articles/{article_id}/files -> ApiResponse[ArticleFileResponse]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_article_files_endpoints.py`:

```python
"""Integration tests for the article-file ingest/recovery endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.article import Article, ArticleFile


@pytest_asyncio.fixture
async def member_article(
    db_session: AsyncSession,
) -> AsyncGenerator[tuple[UUID, UUID, UUID], None]:
    """Yield (project_id, member_user_id, article_id); JWT override = member."""
    row = (
        await db_session.execute(
            text(
                "SELECT pm.project_id, pm.user_id FROM public.project_members pm LIMIT 1"
            )
        )
    ).first()
    if row is None:
        pytest.skip("Need a seeded project member")
    project_id, member_id = UUID(str(row[0])), UUID(str(row[1]))
    article = Article(project_id=project_id, title="confirm-upload-test")
    db_session.add(article)
    await db_session.commit()

    async def _override() -> TokenPayload:
        return TokenPayload(sub=str(member_id), email="m@x.com", role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = _override
    try:
        yield project_id, member_id, article.id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _body(project_id: UUID, article_id: UUID, key: str | None = None) -> dict:
    return {
        "articleId": str(article_id),
        "storageKey": key or f"{project_id}/{article_id}/doc.pdf",
        "originalFilename": "doc.pdf",
        "contentType": "PDF",
        "bytes": 1234,
        "fileRole": "MAIN",
    }


@pytest.mark.asyncio
async def test_confirm_creates_row_and_enqueues(
    db_client: AsyncClient, db_session: AsyncSession, member_article
) -> None:
    project_id, _, article_id = member_article
    with patch(
        "app.api.v1.endpoints.article_files.ArticleFileIngestService.enqueue_parse_at_ingest",
        return_value="task-123",
    ) as enq:
        res = await db_client.post(
            f"/api/v1/articles/{article_id}/files", json=_body(project_id, article_id)
        )
    assert res.status_code == 201, res.text
    assert res.json()["data"]["extractionStatus"] == "pending"
    enq.assert_called_once()
    row = (
        await db_session.execute(
            select(ArticleFile).where(ArticleFile.article_id == article_id)
        )
    ).scalar_one()
    assert row.storage_key == f"{project_id}/{article_id}/doc.pdf"


@pytest.mark.asyncio
async def test_confirm_rejects_non_member(db_client: AsyncClient, member_article) -> None:
    project_id, _, article_id = member_article

    async def _outsider() -> TokenPayload:
        return TokenPayload(sub=str(uuid4()), email="o@x.com", role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = _outsider
    res = await db_client.post(
        f"/api/v1/articles/{article_id}/files", json=_body(project_id, article_id)
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_confirm_rejects_foreign_storage_key(
    db_client: AsyncClient, member_article
) -> None:
    project_id, _, article_id = member_article
    bad = _body(project_id, article_id, key=f"{uuid4()}/{uuid4()}/evil.pdf")
    res = await db_client.post(f"/api/v1/articles/{article_id}/files", json=bad)
    assert res.status_code == 400, res.text


@pytest.mark.asyncio
async def test_confirm_does_not_swallow_enqueue_failure(
    db_client: AsyncClient, db_session: AsyncSession, member_article
) -> None:
    project_id, _, article_id = member_article
    with patch(
        "app.api.v1.endpoints.article_files.ArticleFileIngestService.enqueue_parse_at_ingest",
        side_effect=RuntimeError("broker down"),
    ):
        res = await db_client.post(
            f"/api/v1/articles/{article_id}/files", json=_body(project_id, article_id)
        )
    assert res.status_code == 503, res.text
    row = (
        await db_session.execute(
            select(ArticleFile).where(ArticleFile.article_id == article_id)
        )
    ).scalar_one()
    await db_session.refresh(row)
    assert row.extraction_status == "parse_failed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_article_files_endpoints.py -v`
Expected: FAIL (404 — route not registered yet).

- [ ] **Step 3: Create the endpoint module**

Create `backend/app/api/v1/endpoints/article_files.py`:

```python
"""Article-file ingest + recovery endpoints.

Every code path that creates an ArticleFile MUST enqueue a parse (the
single sanctioned hook is ArticleFileIngestService). The browser uploads
the bytes to Supabase Storage under its own JWT; this endpoint creates the
DB row server-side so membership is enforced and the parse is scheduled —
the direct PostgREST insert that bypassed parsing is retired.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.core.logging import get_logger
from app.models.article import ArticleFile
from app.repositories.article_repository import ArticleFileRepository
from app.schemas.article import ArticleFileResponse, ConfirmUploadRequest
from app.schemas.common import ApiResponse
from app.services.article_file_ingest_service import ArticleFileIngestService
from app.services.citation_read_service import ArticleNotFoundError, get_article_project_id

logger = get_logger(__name__)
router = APIRouter(tags=["article-files"])


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.post("/articles/{article_id}/files", status_code=status.HTTP_201_CREATED)
async def confirm_article_file_upload(
    article_id: UUID,
    body: ConfirmUploadRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ArticleFileResponse]:
    """Register an already-uploaded object and enqueue its parse."""
    trace_id = _trace(request)
    if body.article_id != article_id:
        raise HTTPException(status_code=400, detail="article_id mismatch")
    try:
        project_id = await get_article_project_id(db, article_id)
    except ArticleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    # The service role bypasses RLS, so the storage key must be proven to
    # live under the resolved project/article prefix (not a client claim).
    expected_prefix = f"{project_id}/{article_id}/"
    if not body.storage_key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="storage_key outside article path")

    article_file = ArticleFile(
        project_id=project_id,
        article_id=article_id,
        file_type=body.content_type,
        storage_key=body.storage_key,
        original_filename=body.original_filename,
        bytes=body.bytes,
        file_role=body.file_role,
    )
    article_file = await ArticleFileRepository(db).create(article_file)
    # Commit BEFORE enqueue: the Celery task loads the row in its own session.
    await db.commit()

    try:
        ArticleFileIngestService().enqueue_parse_at_ingest(
            article_file_id=article_file.id,
            project_id=project_id,
            user_id=str(current_user_sub),
            trace_id=trace_id,
        )
    except Exception as exc:  # do NOT swallow — surface so the user can retry
        logger.warning(
            "article_file_enqueue_failed",
            trace_id=trace_id,
            article_file_id=str(article_file.id),
            error=str(exc),
        )
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = f"enqueue failed: {exc}"[:500]
        await db.commit()
        raise HTTPException(
            status_code=503, detail="Failed to schedule parsing; please retry"
        ) from exc

    return ApiResponse.success(
        ArticleFileResponse.model_validate(article_file), trace_id=trace_id
    )
```

- [ ] **Step 4: Register the router**

In `backend/app/api/v1/router.py`, add `article_files` to the import tuple
(`:9-26`, keep alphabetical):

```python
    article_files,
    article_text_blocks,
```

Then append an include block near the other article routers (`:97-113`):

```python
api_router.include_router(article_files.router)
```

(No prefix — the decorator paths are absolute under the `/api/v1` mount.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/integration/test_article_files_endpoints.py -v`
Expected: 4 PASS.

- [ ] **Step 6: Lint + commit**

```bash
cd backend && uv run ruff check app/api/v1/endpoints/article_files.py app/api/v1/router.py && uv run ruff format app/api/v1/endpoints/article_files.py
git add backend/app/api/v1/endpoints/article_files.py backend/app/api/v1/router.py backend/tests/integration/test_article_files_endpoints.py
git commit -m "feat(parsing): backend confirm-upload endpoint that enqueues parse with BOLA gate"
```

---

### Task 3: Re-parse endpoint (`POST /api/v1/article-files/{article_file_id}/reparse`)

Recovers a stuck/failed file (the "teste" article + the 39 pending) by
re-enqueuing on the existing `article_file_id`.

**Files:**
- Modify: `backend/app/api/v1/endpoints/article_files.py`
- Test: `backend/tests/integration/test_article_files_endpoints.py` (extend)

**Interfaces:**
- Consumes: `get_article_file_project_id`
  (`article_text_block_read_service.py`), `ArticleFileNotFoundError`.
- Produces: `POST /article-files/{article_file_id}/reparse -> ApiResponse[ArticleFileResponse]`.

- [ ] **Step 1: Write the failing test** (append to the test file)

```python
@pytest.mark.asyncio
async def test_reparse_resets_status_and_enqueues(
    db_client: AsyncClient, db_session: AsyncSession, member_article
) -> None:
    project_id, _, article_id = member_article
    file = ArticleFile(
        project_id=project_id,
        article_id=article_id,
        file_type="PDF",
        storage_key=f"{project_id}/{article_id}/old.pdf",
        extraction_status="parse_failed",
        extraction_error="boom",
    )
    db_session.add(file)
    await db_session.commit()

    with patch(
        "app.api.v1.endpoints.article_files.ArticleFileIngestService.enqueue_parse_at_ingest",
        return_value="task-9",
    ) as enq:
        res = await db_client.post(f"/api/v1/article-files/{file.id}/reparse")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["extractionStatus"] == "pending"
    enq.assert_called_once()
    await db_session.refresh(file)
    assert file.extraction_status == "pending"
    assert file.extraction_error is None


@pytest.mark.asyncio
async def test_reparse_missing_file_404(db_client: AsyncClient, member_article) -> None:
    res = await db_client.post(f"/api/v1/article-files/{uuid4()}/reparse")
    assert res.status_code == 404, res.text
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_article_files_endpoints.py -k reparse -v`
Expected: FAIL (404 route unknown for the success case at the wrong layer).

- [ ] **Step 3: Add the re-parse endpoint**

Append to `article_files.py` (and add the import at top):

```python
from app.services.article_text_block_read_service import (
    ArticleFileNotFoundError,
    get_article_file_project_id,
)
```

```python
@router.post("/article-files/{article_file_id}/reparse")
async def reparse_article_file(
    article_file_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ArticleFileResponse]:
    """Re-enqueue a parse for an existing ArticleFile (recovery)."""
    trace_id = _trace(request)
    try:
        project_id = await get_article_file_project_id(db, article_file_id)
    except ArticleFileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    article_file = await ArticleFileRepository(db).get_by_id(article_file_id)
    if article_file is None:  # defensive — gate already resolved the project
        raise HTTPException(status_code=404, detail="Article file not found")
    article_file.extraction_status = "pending"
    article_file.extraction_error = None
    await db.commit()

    try:
        ArticleFileIngestService().enqueue_parse_at_ingest(
            article_file_id=article_file.id,
            project_id=project_id,
            user_id=str(current_user_sub),
            trace_id=trace_id,
        )
    except Exception as exc:
        logger.warning(
            "article_file_reparse_enqueue_failed",
            trace_id=trace_id,
            article_file_id=str(article_file.id),
            error=str(exc),
        )
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = f"enqueue failed: {exc}"[:500]
        await db.commit()
        raise HTTPException(
            status_code=503, detail="Failed to schedule parsing; please retry"
        ) from exc

    return ApiResponse.success(
        ArticleFileResponse.model_validate(article_file), trace_id=trace_id
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && uv run pytest tests/integration/test_article_files_endpoints.py -v`
Expected: all PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && uv run ruff check app/api/v1/endpoints/article_files.py && uv run ruff format app/api/v1/endpoints/article_files.py
git add backend/app/api/v1/endpoints/article_files.py backend/tests/integration/test_article_files_endpoints.py
git commit -m "feat(parsing): re-parse endpoint to recover stuck/failed article files"
```

---

### Task 4: Regenerate the API contract types

The frontend must import the new endpoint shapes from the generated
contract (frontend rule: no hand-mirroring).

**Files:**
- Modify: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

- [ ] **Step 1: Regenerate**

Run (from repo root): `npm run generate:api-types`

- [ ] **Step 2: Verify the new paths are present**

Run: `grep -c "articles/{article_id}/files\|article-files/{article_file_id}/reparse" frontend/types/api/openapi.json`
Expected: ≥ 2.

- [ ] **Step 3: Commit**

```bash
git add frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "chore(api): regenerate contract types for article-file ingest endpoints"
```

---

### Task 5: Route `addArticle` through the confirm endpoint

**Files:**
- Modify: `frontend/services/articlesService.ts`
- Test: `frontend/test/services/articlesService.test.ts` (extend)

**Interfaces:**
- Produces: `confirmArticleFileUpload(params) => apiClient<ArticleFileResponse>('/api/v1/articles/{articleId}/files', {method:'POST', body})`.
  `addArticle` now calls it instead of `supabase.from('article_files').insert`.

- [ ] **Step 1: Write the failing test**

Add `vi.mock('@/integrations/api', ...)` at the top of
`frontend/test/services/articlesService.test.ts` (next to the existing
mocks) and a new test:

```typescript
vi.mock('@/integrations/api', () => ({apiClient: vi.fn(async () => ({}))}));
```

```typescript
import {apiClient} from '@/integrations/api';

describe('articlesService.addArticle — backend confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers the file via the backend, not a direct article_files insert', async () => {
    // article insert + storage upload succeed
    vi.mocked(supabase.from).mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.insert = vi.fn(() => c);
      c.select = vi.fn(() => c);
      c.single = vi.fn(async () => ({data: {id: 'art-1'}, error: null}));
      c.delete = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      return c;
    });
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: vi.fn(async () => ({error: null})),
    } as never);

    const res = await addArticle(ARTICLE_DATA as never, {
      file: FAKE_PDF,
      detectedFormat: 'PDF',
    } as never);

    expect(res.ok).toBe(true);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/v1/articles/art-1/files',
      expect.objectContaining({method: 'POST'}),
    );
    // No direct article_files PostgREST insert anymore:
    const fromCalls = vi.mocked(supabase.from).mock.calls.map(c => c[0]);
    expect(fromCalls).not.toContain('article_files');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (repo root): `npm run test:run -- frontend/test/services/articlesService.test.ts`
Expected: FAIL (`apiClient` not called; `article_files` still in `from` calls).

- [ ] **Step 3: Implement**

In `frontend/services/articlesService.ts`, add the import and helper:

```typescript
import {apiClient} from '@/integrations/api';

interface ConfirmUploadParams {
  articleId: string;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  bytes: number;
  fileRole: FileRole;
}

function confirmArticleFileUpload(p: ConfirmUploadParams): Promise<unknown> {
  return apiClient(`/api/v1/articles/${p.articleId}/files`, {
    method: 'POST',
    body: {
      articleId: p.articleId,
      storageKey: p.storageKey,
      originalFilename: p.originalFilename,
      contentType: p.contentType,
      bytes: p.bytes,
      fileRole: p.fileRole,
    },
  });
}
```

Replace the `article_files` insert block in `addArticle` (`:76-91`) with:

```typescript
      try {
        await confirmArticleFileUpload({
          articleId: article.id,
          storageKey,
          originalFilename: pdfInput.file.name,
          contentType: pdfInput.detectedFormat,
          bytes: pdfInput.file.size,
          fileRole: FILE_ROLES.MAIN,
        });
      } catch (e) {
        // Rollback: remove storage object and article row
        await supabase.storage.from('articles').remove([storageKey]);
        await supabase.from('articles').delete().eq('id', article.id);
        throw e instanceof Error ? e : new Error('File registration failed');
      }
```

- [ ] **Step 4: Run to verify it passes**

Run (repo root): `npm run test:run -- frontend/test/services/articlesService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add frontend/services/articlesService.ts frontend/test/services/articlesService.test.ts
git commit -m "feat(parsing): route addArticle file registration through the backend enqueue endpoint"
```

---

### Task 6: Route `uploadArticleFile` through the confirm endpoint

**Files:**
- Modify: `frontend/services/articlesService.ts`
- Test: `frontend/test/services/articlesService.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```typescript
describe('articlesService.uploadArticleFile — backend confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers supplements via the backend, not a direct insert', async () => {
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: vi.fn(async () => ({error: null})),
    } as never);

    const res = await uploadArticleFile({
      projectId: 'proj-1',
      articleId: 'art-1',
      storageKey: 'proj-1/art-1/supp.pdf',
      file: FAKE_PDF,
      role: 'SUPPLEMENT',
    } as never);

    expect(res.ok).toBe(true);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/v1/articles/art-1/files',
      expect.objectContaining({method: 'POST'}),
    );
    const fromCalls = vi.mocked(supabase.from).mock.calls.map(c => c[0]);
    expect(fromCalls).not.toContain('article_files');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/test/services/articlesService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — replace the `article_files` insert block in
`uploadArticleFile` (`:312-322`) with:

```typescript
    try {
      await confirmArticleFileUpload({
        articleId: params.articleId,
        storageKey: params.storageKey,
        originalFilename: params.file.name,
        contentType: detectedFormat,
        bytes: params.file.size,
        fileRole: params.role,
      });
    } catch (e) {
      await supabase.storage.from('articles').remove([params.storageKey]);
      throw e instanceof Error ? e : new Error('File registration failed');
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/test/services/articlesService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add frontend/services/articlesService.ts frontend/test/services/articlesService.test.ts
git commit -m "feat(parsing): route supplement uploads through the backend enqueue endpoint"
```

---

### Task 7: Re-parse service + button

**Files:**
- Modify: `frontend/services/articlesService.ts` (add `reparseArticleFile`)
- Modify: `frontend/components/articles/ArticleDetailDialog.tsx` (button on
  each file row, near the role badge at `:329`)
- Test: `frontend/test/services/articlesService.test.ts` (extend)

**Interfaces:**
- Produces: `reparseArticleFile(articleFileId: string) => Promise<ErrorResult<unknown>>`.

- [ ] **Step 1: Write the failing test**

```typescript
import {reparseArticleFile} from '@/services/articlesService';

describe('articlesService.reparseArticleFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the reparse endpoint for the given file id', async () => {
    const res = await reparseArticleFile('file-7');
    expect(res.ok).toBe(true);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/v1/article-files/file-7/reparse',
      expect.objectContaining({method: 'POST'}),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/test/services/articlesService.test.ts`
Expected: FAIL (`reparseArticleFile` not exported).

- [ ] **Step 3: Implement the service function**

In `frontend/services/articlesService.ts`:

```typescript
export function reparseArticleFile(articleFileId: string): Promise<ErrorResult<unknown>> {
  return toResult(
    () => apiClient(`/api/v1/article-files/${articleFileId}/reparse`, {method: 'POST'}),
    'articlesService.reparseArticleFile',
  );
}
```

- [ ] **Step 4: Run to verify the service test passes**

Run: `npm run test:run -- frontend/test/services/articlesService.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the button** in `ArticleDetailDialog.tsx` file-row
render (near `getFileRoleLabel`, `:329`). Import at top:
`import {reparseArticleFile} from '@/services/articlesService';` and
`import {toast} from 'sonner';` (if not present). In the file row JSX:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={async () => {
    const r = await reparseArticleFile(file.id);
    if (r.ok) toast.success(t('articles', 'reparseQueued'));
    else toast.error(r.error.message);
  }}
>
  {t('articles', 'reparse')}
</Button>
```

Add the copy keys to `frontend/lib/copy/articles.ts`:

```typescript
  reparse: 'Re-parse',
  reparseQueued: 'Re-parse queued',
```

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add frontend/services/articlesService.ts frontend/components/articles/ArticleDetailDialog.tsx frontend/lib/copy/articles.ts frontend/test/services/articlesService.test.ts
git commit -m "feat(parsing): per-file Re-parse action to recover stuck article files"
```

---

## Final verification

- [ ] `cd backend && uv run pytest tests/integration/test_article_files_endpoints.py tests/integration/test_parsing_tasks_durable_failure.py -v` — all PASS
- [ ] `make lint-backend` — clean
- [ ] `npm run test:run -- frontend/test/services/articlesService.test.ts` — PASS
- [ ] `npm run lint && npm run typecheck` — clean
- [ ] Manual (against a worker): add an article with a PDF → the file row
  appears `pending` → worker parses → status `parsed`; kill the broker and
  add a file → endpoint returns 503 and the row is `parse_failed`; click
  Re-parse → status returns to `pending`.

## Out of scope (later PRs)

- The status badge + "Reader / Indexed" column + enum single-source — PR-C.
- Reader wiring + document switcher — PR-D. Supplement parsing — PR-E.
- Hardening the Supabase Storage INSERT policy to be project-scoped (today
  any authed user can write any key; the confirm endpoint's prefix check
  closes the read-access path, but the storage policy is a separate RLS
  migration) — follow-up.
