# Implementation Plan: Extraction Excel Export

**Branch**: `009-extraction-excel-export` | **Date**: 2026-05-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-extraction-excel-export/spec.md`

## Summary

Add a project-member-accessible `.xlsx` download of the Data Extraction page's structured data — section-as-row + article-as-column layout that matches the reference CHARMS workbook — with three value-source modes (Consensus default / Single user / All users) and an optional AI metadata sheet. Backend is a new async-capable endpoint that mirrors the existing `articles_export` pipeline (sync inline blob for small payloads; Celery + Supabase Storage signed URL for large ones). Frontend is a Radix dialog modelled exactly on `ArticlesExportDialog.tsx`, opened from a new "Export" top-bar button on the Data Extraction page. No database schema changes — the feature is purely read-side over `extraction_template_versions`, `extraction_instances`, `extraction_published_states`, `extraction_reviewer_decisions`/`states`, and `extraction_proposal_records`.

## Technical Context

**Language/Version**: Python 3.11 (backend) + TypeScript strict (frontend, React 18 + Vite).

**Primary Dependencies**:

- Backend: FastAPI, SQLAlchemy 2.0 async, Pydantic v2, structlog, slowapi, Celery + Redis, **openpyxl ≥ 3.1** (new dependency — see research.md §1).
- Frontend: TanStack Query v5, Zustand (`useBackgroundJobs` store, already exists), shadcn/Radix Dialog primitive, react-hook-form is not required (the form is simple radios + a checkbox), Zod is not required (no user-supplied free-form input).

**Storage**: PostgreSQL (`public` schema, read-only for this feature) + Supabase Storage (signed URLs for async exports, reusing the existing `articles` bucket under a new `exports/extraction/{user_id}/{job_id}.xlsx` prefix — see research.md §2).

**Testing**: `pytest` for backend (unit + integration via real PostgreSQL + Alembic migrations), `vitest` + MSW for frontend component tests, Playwright for the end-to-end "click Export → download" flow (deferred to `/speckit-tasks` if time-bound).

**Target Platform**: Linux server (FastAPI on Gunicorn, Celery worker). The downloaded `.xlsx` MUST open in Microsoft Excel ≥ 2016 and LibreOffice Calc ≥ 7.

**Project Type**: Web application (existing `backend/` + `frontend/` split — Option 2 in the template).

**Performance Goals**: Per spec SC-001 / SC-002 / SC-007:

- ≤ 100 articles × ≤ 80 fields → P50 ≤ 10 s, P95 ≤ 30 s, **sync delivery**.
- 500 articles × 100 fields × ~3 model instances → P95 ≤ 60 s, **async delivery via Celery**.
- "Include AI metadata sheet" toggle adds ≤ 20 % at P95.

**Constraints**: Constitution-mandated:

- Layered architecture (Endpoint → Service → Repository → Model) is non-negotiable.
- Async I/O end-to-end; no blocking calls in the main event loop. Excel generation MUST run in a thread-pool executor (the openpyxl writer is sync-only — `loop.run_in_executor`) so it does not block the event loop, OR be entirely offloaded to Celery for the async path.
- `user_id` from JWT only (never from request body/query). Project-membership check via `ProjectMemberRepository.is_member()` before any data read. Manager-only modes via `ProjectMemberRepository.has_role(ProjectMemberRole.MANAGER)`.
- Rate limit on the export endpoint: `@limiter.limit("10/minute")` to match `articles_export`.
- New endpoint contract returns the `ApiResponse[T]` envelope; errors carry `error.message` (frontend already reads from `error.message`, per memory).

**Scale/Scope**: Same project-size envelope as the rest of the extraction stack — a single project may have up to ~500 articles and a template with up to ~100 fields; the export must work without UI lockup for the upper bound.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | Compliance plan |
|---|---|---|
| **I. Layered Architecture** (NON-NEGOTIABLE) | API → Service → Repository → Model; no DB access in endpoints | New `extraction_export` endpoint will only call into a new `ExtractionExportService`; the service composes existing repos (`ExtractionRunRepository`, `ExtractionPublishedStateRepository`, `ExtractionReviewerStateRepository`, `ExtractionProposalRepository`, `ExtractionRepository` for instances/fields, `ProjectMemberRepository` for auth) plus a new `ExtractionTemplateVersionRepository` if the version snapshot reader does not already exist. The Excel-writing pure helper module (`backend/app/services/exports/extraction_xlsx_builder.py`) takes domain objects in and bytes out — no I/O, no DB session — so it is unit-testable in isolation. ✅ |
| **II. Dependency Injection First** | All runtime deps injected; no global singletons | Endpoint takes `DbSession`, `CurrentUser`, `SupabaseClient` via FastAPI `Depends`. Service constructor takes `db`, `user_id`, `storage`, `trace_id` — same shape as `ArticlesExportService`. Celery task receives ids only, builds its own service inside the task body. ✅ |
| **III. Split Migration Ownership** (NON-NEGOTIABLE) | Alembic = `public` schema; Supabase CLI = storage/auth | **No schema migrations required for V1** — the feature is read-only over existing tables. The optional follow-up (`edited_from_proposal_id` FK on `extraction_reviewer_decisions`) is explicitly deferred and would belong to a separate Alembic migration outside this feature. No new Storage bucket needed — we reuse the existing `articles` bucket with a new `exports/extraction/` prefix. ✅ |
| **IV. Security by Design** | JWT-only user_id, RLS-honouring reads, rate limit, no wildcard CORS | Endpoint extracts `user.sub` from JWT. Project-membership check is the first thing the endpoint does. Manager-only modes gated by `has_role(MANAGER)`. Reads go through repository methods that already inherit project-scoped RLS via the user's PostgREST-stamped session (or via the Python role check when the read uses the backend service role — the existing `articles_export` does both; we will match). Rate limit `10/minute`. ✅ |
| **V. Typed Everything** | mypy strict; Pydantic for I/O; TS strict | All new modules use Python 3.11+ type hints. Pydantic schemas: `ExtractionExportRequest`, `ExtractionExportStartedResponse`, `ExtractionExportStatusResponse` (mirror the articles_export ones). Frontend TS contracts in `frontend/types/extraction-export.ts`. ✅ |
| **VI. Frontend Conventions** | `apiClient`, TanStack Query, Zustand for client state, shadcn/Radix, react-hook-form/Zod for forms | Dialog uses `Dialog` primitive (already used by `ArticlesExportDialog`). Service file `frontend/services/extractionExportService.ts` uses `apiClient`. Background-job tracking via existing `useBackgroundJobs` store + a new `createExtractionExportJob` factory in `frontend/types/background-jobs.ts`. No new client-state stores. ✅ |
| **VII. Async All The Way** | All I/O async; long tasks → Celery | Endpoint is `async def`; repos already async; the openpyxl write (CPU/memory work) runs in `asyncio.to_thread()` for the sync path and in a Celery task for the async path. ✅ |
| **VIII. Standardized API Contract** | `ApiResponse` envelope, `AppError` hierarchy, `trace_id` | All new endpoint responses use `ApiResponse.success` / `ApiResponse.failure`. Project-membership failure → `ApiResponse.failure(code="FORBIDDEN", ...)`. Validation failures → `ApiResponse.failure(code="VALIDATION_ERROR", ...)`. Trace id from `request.headers["x-trace-id"]` or freshly minted. ✅ |

**Gate status**: PASS. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/009-extraction-excel-export/
├── plan.md                        # This file
├── research.md                    # Phase 0 — technical decisions
├── data-model.md                  # Phase 1 — read-side data shapes
├── quickstart.md                  # Phase 1 — developer setup & manual test plan
├── contracts/
│   └── extraction-export.openapi.yaml  # Phase 1 — API contract
├── checklists/
│   └── requirements.md            # From /speckit-specify (already exists)
└── tasks.md                       # From /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/v1/endpoints/
│   │   └── extraction_export.py                     # NEW — start/status/cancel endpoints
│   ├── api/v1/router.py                             # MODIFIED — register router
│   ├── services/
│   │   ├── extraction_export_service.py             # NEW — orchestrator (auth, scope resolution, mode resolution, calls builder)
│   │   └── exports/
│   │       ├── __init__.py                          # NEW
│   │       └── extraction_xlsx_builder.py           # NEW — pure openpyxl writer (no I/O, no DB)
│   ├── repositories/
│   │   └── extraction_template_version_repository.py # NEW — only if not already present (reads `extraction_template_versions`)
│   ├── schemas/
│   │   └── extraction_export.py                     # NEW — request/response Pydantic models
│   ├── worker/tasks/
│   │   └── extraction_export_tasks.py               # NEW — Celery task `export_extraction_task`
│   └── core/
│       └── deps.py                                  # UNCHANGED — re-uses existing CurrentUser/DbSession/SupabaseClient
├── pyproject.toml                                   # MODIFIED — add openpyxl ≥ 3.1
└── tests/
    ├── unit/
    │   └── test_extraction_xlsx_builder.py          # NEW — pure-function builder tests, no DB
    └── integration/
        ├── test_extraction_export_endpoint.py       # NEW — endpoint + auth + scope tests
        └── test_extraction_export_service.py        # NEW — service-level tests with seeded data

frontend/
├── components/
│   └── extraction/
│       ├── ExtractionExportDialog.tsx               # NEW — modelled on ArticlesExportDialog.tsx
│       ├── ExtractionInterface.tsx                  # MODIFIED — add Export button to the header area
│       └── ExtractionExport.tsx                     # DELETED (V1) or kept as a doc-only stub; the existing placeholder is now replaced by the dialog flow
├── services/
│   └── extractionExportService.ts                   # NEW — startExport(), getStatus(), cancel()
├── hooks/
│   └── exports/
│       └── useExtractionExportJob.ts                # NEW — TanStack Query wrapper for polling status
├── types/
│   ├── background-jobs.ts                           # MODIFIED — add createExtractionExportJob factory
│   └── extraction-export.ts                         # NEW — TS types (mode, articleScope, sheets, jobId)
└── lib/copy/
    └── extraction.ts                                # MODIFIED — new i18n keys (extractionExportDialogTitle, …)
```

**Structure Decision**: Web application (backend + frontend) following the existing prumo layout. The feature adds files in already-existing module locations — no new top-level directories. The only new sub-directory is `backend/app/services/exports/` for the pure XLSX builder helper, isolating the CPU work from the orchestrator service. This mirrors the pattern of putting prompt builders in `backend/app/services/llm/` (per the architecture doc's "LLM prompt module pattern").

## Phase 0: Outline & Research

See [research.md](research.md). Four decisions resolved:

1. **Excel library choice** — `openpyxl` over `xlsxwriter` or `pandas`.
2. **Storage bucket + path** — reuse `articles` bucket, prefix `exports/extraction/`.
3. **Sync/async threshold** — article count (matches articles_export's `SYNC_METADATA_ONLY_MAX_ARTICLES = 50` pattern).
4. **Frozen vs live template version for layout** — use the currently-active TemplateVersion of the project template as the layout anchor; older Runs' surviving fields are matched by `field_id`.

No `NEEDS CLARIFICATION` items remain.

## Phase 1: Design & Contracts

Outputs already generated alongside this plan:

- [data-model.md](data-model.md) — read-side data shapes the export needs (no schema changes).
- [contracts/extraction-export.openapi.yaml](contracts/extraction-export.openapi.yaml) — endpoint contract for `POST /api/v1/projects/{project_id}/extraction-export`, `GET /…/status/{job_id}`, `POST /…/status/{job_id}/cancel`.
- [quickstart.md](quickstart.md) — developer setup, dependency add, manual test recipe, and contract-test commands.

Agent context update (the plan reference between `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` in `CLAUDE.md`) is applied automatically by `/speckit-plan` per the workflow.

## Post-Design Constitution Re-check

After fleshing out Phase 1, the design holds against all gates:

- The new endpoint and service introduce no new global state; the Celery task body re-creates the service inside the task — same DI contract as `articles_export_task`. ✅
- The XLSX builder is a pure function (input: layout descriptor + value cells; output: bytes); unit-testable without a DB or storage. ✅
- `openpyxl`'s `Workbook.save` is sync; we wrap calls in `asyncio.to_thread()` (sync path) or run them inside a Celery task (async path) so the main event loop is never blocked. ✅
- All cross-reviewer reads (the "All users" mode, the "Single user (other)" mode) go through `ProjectMemberRepository.has_role(MANAGER)` before the data fetch, surfacing `FORBIDDEN` via the standard envelope when the caller is not a manager. ✅

## Complexity Tracking

> No constitution violations — table left intentionally empty.
