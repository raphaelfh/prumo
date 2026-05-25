# Implementation Plan: Zotero Article Data Parity

**Branch**: `006-zotero-articles-sync` | **Date**: 2026-03-28 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/006-zotero-articles-sync/spec.md`

## Summary

Upgrade Zotero ingestion so the `articles` domain preserves full source-parity metadata, supports robust and auditable
resynchronization, and introduces explicit local enrichment capabilities (PDF extracted text + semantic-search-ready
content) without mixing source authority rules. The design keeps project consistency by extending existing layered
backend modules (`zotero_import`, `article_repository`, Celery `import_tasks`) and frontend API integration patterns.
Canonical ingestion rules (identity, deduplication, conflict precedence, and validation classes) must remain reusable
across Zotero, RIS, and manual import pipelines.
A dedicated source-adapter normalization module must centralize canonical identity and field normalization rules for
reuse
across Zotero, RIS, and manual ingestion flows.

## Technical Context

**Language/Version**: Python 3.11+ (backend), TypeScript strict (frontend)  
**Primary Dependencies**: FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis, Supabase Auth/Storage, React 18,
TanStack Query, Zustand, Zod  
**Storage**: PostgreSQL `public` schema (`articles` and related domain tables) + Supabase Storage bucket `articles`  
**Testing**: pytest (unit + integration, coverage gate), Vitest + Testing Library for frontend contracts  
**Target Platform**: Linux backend service + browser frontend  
**Project Type**: Web application (FastAPI backend + React frontend)  
**Performance Goals**: For a 1,000-item sync run: end-to-end completion p95 <= 10 minutes under normal worker load, sync
status endpoint p95 <= 500ms, duplicate creation rate = 0%, and retry success >= 99% for transient failures  
**Constraints**: API -> Service -> Repository -> Model layering, no endpoint DB access, async I/O only, Alembic-only app
schema migrations with RLS for new tables, mandatory endpoint rate limiting, ApiResponse envelope + AppError + trace_id,
and strict source/parity vs enrichment authority split  
**Scale/Scope**: Per-project Zotero collections up to tens of thousands of records over time; initial rollout focuses on
single-project sync workflows with resumable/retriable batches

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial Gate (Pre-Research)

| Principle                       | Status | Notes                                                                                                  |
|---------------------------------|--------|--------------------------------------------------------------------------------------------------------|
| I. Layered Architecture         | Pass   | Plan keeps `zotero_import` endpoint thin; mapping/update logic stays in service; persistence in repos  |
| II. Dependency Injection        | Pass   | Services receive `db`, `user_id`, `storage`, `trace_id`; no hidden singletons beyond allowed EventBus  |
| III. Split Migration Ownership  | Pass   | All schema evolution planned in `backend/alembic/versions`; no app table changes in Supabase SQL       |
| IV. Security by Design          | Pass   | JWT-derived user identity, project-scoped authorization, rate-limited sync endpoints, auditable events |
| V. Typed Everything             | Pass   | Pydantic DTOs and typed service/repository interfaces required for new fields/entities                 |
| VI. Frontend Conventions        | Pass   | Continue `apiClient`/`zoteroClient`; no ad-hoc fetch wrappers                                          |
| VII. Async All The Way          | Pass   | Long sync and retries stay on Celery tasks; endpoint remains non-blocking                              |
| VIII. Standardized API Contract | Pass   | All new responses stay inside `ApiResponse` envelope with typed error codes                            |

### Post-Design Re-Check (After Phase 1)

| Principle                       | Status | Notes                                                                                        |
|---------------------------------|--------|----------------------------------------------------------------------------------------------|
| I. Layered Architecture         | Pass   | Data model and contracts isolate mapping in service and relational writes in repositories    |
| II. Dependency Injection        | Pass   | Quickstart preserves constructor injection and existing factory paths                        |
| III. Split Migration Ownership  | Pass   | Data-model changes scoped to public schema and Alembic migration sequence                    |
| IV. Security by Design          | Pass   | Contracts enforce user-scoped sync ownership and auditable conflict resolution               |
| V. Typed Everything             | Pass   | Contracts and data model define explicit payload fields for parity and enrichment separation |
| VI. Frontend Conventions        | Pass   | Frontend quickstart uses existing integration clients and query patterns                     |
| VII. Async All The Way          | Pass   | Retry and status flows continue through Celery + Redis                                       |
| VIII. Standardized API Contract | Pass   | API contract document uses envelope-compliant responses and deterministic status payloads    |

## Project Structure

### Documentation (this feature)

```text
specs/006-zotero-articles-sync/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── zotero-article-sync-api.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/                              # public schema changes for article sync parity/enrichment
├── app/
│   ├── api/v1/endpoints/zotero_import.py          # add sync actions/status/retry endpoints
│   ├── services/zotero_import_service.py          # parity mapping, conflict precedence, soft-delete/reactivation
│   ├── repositories/article_repository.py         # extend upsert/state transition/read models
│   ├── repositories/article_author_repository.py  # new canonical author and association persistence
│   ├── models/article.py                          # extend article fields + sync state markers
│   ├── models/article_author.py                   # new canonical author/association/sync event models
│   ├── schemas/zotero.py                          # request/response DTOs for sync actions
│   └── worker/tasks/import_tasks.py               # async sync/retry orchestration
└── tests/
    ├── unit/
    │   ├── test_zotero_import_service.py
    │   └── test_article_author_repository.py
    └── integration/
        └── test_zotero_import_api.py

frontend/
├── integrations/api/client.ts                     # extend ZoteroAction union for new sync actions
├── services/zoteroImportService.ts                # sync, status, retry flow with typed payloads
├── hooks/zotero/                                  # optional polling hook for sync status
└── components/extraction/                         # existing import UI receives richer status summaries
```

**Structure Decision**: Keep the existing web-app split and existing Zotero module boundaries. Extend current files
where
behavior already exists, and add only focused modules for canonical author persistence to avoid overloading article
repository responsibilities.

## Complexity Tracking

No constitution violations identified. Additional complexity (author hybrid model + sync state lifecycle) is required by
clarified functional requirements and is bounded to the Zotero import path.
