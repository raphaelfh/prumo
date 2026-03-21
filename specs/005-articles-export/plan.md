# Implementation Plan: Articles List Export

**Branch**: `005-articles-export` | **Date**: 2026-03-15 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/005-articles-export/spec.md`

## Summary

Enable users to export the articles list (or a selection) as bibliographic data in CSV, RIS, and/or Zotero RDF, with an
optional inclusion of linked files (main only or all). When files are included, "main only" produces a flat package; "
all files" produces one subfolder per article named `id_sanitized_title`. Long-running exports run asynchronously with
progress and cancellation; the user is notified with a one-time download link when ready. Skipped files are reported in
the UI and in a manifest inside the package.

## Technical Context

**Language/Version**: Python 3.11+ (backend), TypeScript strict (frontend)  
**Primary Dependencies**: FastAPI, SQLAlchemy 2.0 async, Celery + Redis, Supabase (auth + storage); React 18, Vite,
TanStack Query, Zustand, shadcn/Radix  
**Storage**: PostgreSQL (public schema, Alembic) for articles/article_files; Supabase Storage for file binaries and
export ZIPs (temp path or dedicated bucket)  
**Testing**: pytest (backend, 70% cov), Vitest + Testing Library (frontend)  
**Target Platform**: Web (browser); backend Linux server  
**Project Type**: Web application (FastAPI backend + React frontend)  
**Performance Goals**: Metadata-only export for 100 articles &lt; 30s (SC-004); large file-inclusive exports async with
progress and optional cancel  
**Constraints**: Layered architecture (API → Service → Repository → Model); async I/O; long-running export offloaded to
Celery; one-time download link for async result  
**Scale/Scope**: Export up to hundreds of articles with files; no hard limit; progress feedback and cancellation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                       | Status | Notes                                                                                                      |
|---------------------------------|--------|------------------------------------------------------------------------------------------------------------|
| I. Layered Architecture         | Pass   | Export endpoint → export service → article/article_file repositories + storage adapter; no DB in endpoints |
| II. Dependency Injection        | Pass   | Service receives db, user_id, storage, trace_id via deps; storage from factory                             |
| III. Split Migration Ownership  | Pass   | No new app tables in Supabase migrations; export temp storage uses existing bucket or new path only        |
| IV. Security by Design          | Pass   | user_id from JWT; project membership enforced; rate limit on export endpoint; signed URLs for download     |
| V. Typed Everything             | Pass   | Pydantic request/response; TypeScript strict; Zod for frontend forms                                       |
| VI. Frontend Conventions        | Pass   | apiClient for export API; TanStack Query for status/polling; component under frontend/components/articles  |
| VII. Async All The Way          | Pass   | Export service async; long-running export in Celery task; no blocking I/O in endpoint                      |
| VIII. Standardized API Contract | Pass   | ApiResponse envelope; trace_id; AppError for failures                                                      |

## Project Structure

### Documentation (this feature)

```text
specs/005-articles-export/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (API request/response)
└── tasks.md             # Phase 2 (/speckit.tasks — not created by plan)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/v1/endpoints/articles_export.py   # Export endpoints (sync + async status)
│   ├── services/articles_export_service.py   # Build CSV/RIS/RDF, ZIP, storage
│   ├── repositories/                         # Existing article_repository, article_file repository
│   ├── schemas/articles_export.py            # Request/response for export
│   ├── infrastructure/storage/               # Existing; add upload path for export ZIP if needed
│   └── worker/tasks/export_tasks.py          # Celery task for async export
├── alembic/                                  # No new tables for export (job state via Celery result)
└── tests/
    ├── unit/test_articles_export_service.py
    └── integration/test_articles_export_api.py

frontend/
├── components/articles/
│   ├── ArticlesList.tsx                      # Add export trigger
│   ├── ArticlesExportDialog.tsx              # Export dialog (formats, scope, file mode)
│   └── (optional) useExportArticles.ts       # Hook: start export, poll status, download link
├── services/
│   └── articlesExportService.ts              # API client for export + status
└── lib/copy/articles.ts                      # i18n keys for export UI
```

**Structure Decision**: Backend adds one new endpoint module and one new service; frontend adds an export dialog and
optional hook. Articles and article_files remain in existing repositories; export uses existing StorageAdapter (upload
ZIP, then get_signed_url for one-time download).

## Complexity Tracking

No constitution violations. Export fits existing layers and Celery pattern (see import_tasks).
