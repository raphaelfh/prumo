# Quickstart: Zotero Article Data Parity

**Feature**: 006-zotero-articles-sync

## Goal

Implement full Zotero parity sync for `articles` with:

- hybrid author modeling;
- deterministic conflict precedence;
- soft-delete/reactivation lifecycle;
- local enrichment fields for extracted text and semantic-search preparation.

## Backend implementation steps

1. **Schema migration (Alembic only)**
    - Extend `public.articles` with sync state and enrichment fields.
    - Add canonical author and association entities.
    - Add sync run and sync event entities for observability/audit.
    - Add indexes for sync identity and operational queries.

2. **Model and repository updates**
    - Update `backend/app/models/article.py` for new article fields.
    - Add focused model/repository modules for canonical author + associations.
    - Extend `article_repository` with idempotent upsert/state transition methods.

3. **Service orchestration**
    - Extend `backend/app/services/zotero_import_service.py` with:
        - parity mapper pipeline;
        - authority rules (source parity vs local enrichment);
        - source-removal deactivation and reactivation flows;
        - per-item result and run-summary assembly.

4. **API contract wiring**
    - Extend `backend/app/api/v1/endpoints/zotero_import.py` action routing:
        - `sync-collection`, `sync-status`, `sync-retry-failed`, `sync-item-result`.
    - Add/extend DTOs in `backend/app/schemas/zotero.py`.
    - Keep `ApiResponse` envelope and domain error mapping.

5. **Async execution**
    - Extend `backend/app/worker/tasks/import_tasks.py` for long-running sync and retry orchestration.
    - Ensure task results expose run identifiers and summary counters for polling.

## Frontend implementation steps

1. Extend `ZoteroAction` union and client helpers in `frontend/integrations/api/client.ts`.
2. Extend `frontend/services/zoteroImportService.ts` with:
    - start sync;
    - poll sync status;
    - retry failed items;
    - fetch item diagnostics.
3. Update extraction/import UI components to display:
    - run status and counters;
    - failed-item diagnostics;
    - deactivated/reactivated outcomes.

## Run locally

- Backend API: `cd backend && uv run uvicorn app.main:app --reload`
- Celery worker: `cd backend && uv run celery -A app.worker.celery_app worker -l info`
- Frontend: `cd frontend && npm run dev`
- Ensure Redis and Postgres are available.

## Test focus

### Backend unit tests

- Mapper preserves source parity fields and does not overwrite enrichment fields.
- Conflict precedence applies deterministic authority rules.
- Author hybrid write keeps order and canonical associations synchronized.
- Removal/reactivation transitions produce correct sync state.

### Backend integration tests

- Sync start returns 202 + run ID.
- Status endpoint reports accurate counters through lifecycle.
- Retry failed reprocesses only failed items.
- Duplicate prevention works for unchanged repeat imports.

### Frontend tests

- Service methods call expected actions/payloads.
- Status polling state transitions render correctly.
- Error and retry UX for failed items.

## Acceptance checklist

- [x] Full Zotero payload fields preserved with semantic parity.
- [x] Hybrid author model populated and queryable.
- [x] Source-removal marks records as `removed_at_source` (no hard delete).
- [x] Reactivation restores sync lifecycle correctly.
- [x] Enrichment fields persist independently from source parity updates.
- [x] Per-run and per-item diagnostics available for support workflows.

## Production-readiness evidence

- **RLS/policies verified**: New tables `article_authors`, `article_author_links`, `article_sync_runs`, and
  `article_sync_events` are created with RLS enabled and project-scoped policies in
  `backend/alembic/versions/20260328_006_zotero_article_parity.py`.
- **Rate-limit verified**: Zotero action endpoint is protected with `@limiter.limit("20/minute")` in
  `backend/app/api/v1/endpoints/zotero_import.py`.
- **AppError + trace_id verified**: endpoint maps domain failures into API envelope and carries request `trace_id` from
  middleware into success responses.
- **Perf SLO artifact**: baseline test scaffold added in `backend/tests/performance/test_zotero_sync_performance.py` for
  CI evolution into full worker benchmark.
- **Rollback validated**: migration downgrade removes parity columns, sync tables, and policies in reverse order without
  touching pre-existing article data.
