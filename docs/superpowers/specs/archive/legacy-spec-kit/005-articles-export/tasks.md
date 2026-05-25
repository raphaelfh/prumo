# Tasks: Articles List Export

**Input**: Design documents from `specs/005-articles-export/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `backend/app/`, `backend/tests/`
- **Frontend**: `frontend/components/`, `frontend/services/`, `frontend/lib/copy/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Register export route and define API schemas

- [x] T001 Register articles-export router in `backend/app/api/v1/router.py` (include endpoints module, prefix/tag per
  plan)
- [x] T002 [P] Create Pydantic schemas in `backend/app/schemas/articles_export.py`: ExportRequest (projectId,
  articleIds, formats, fileScope), ExportStatusResponse (jobId, status, progress, downloadUrl, expiresAt, skippedFiles,
  error), ExportProgress, SkippedFileEntry per contracts/articles-export-api.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend export service, endpoints, and Celery task so that all user stories can call the API

**⚠️ CRITICAL**: No user story frontend work can begin until export API and service exist

- [x] T003 Implement ArticlesExportService in `backend/app/services/articles_export_service.py`: build CSV/RIS/RDF from
  articles (per research.md), build ZIP for metadata-only (single or multi-format), for main_only (flat layout), for
  all (one subfolder per article named id_sanitized_title with metadata + files), upload ZIP to storage at
  exports/{user_id}/{job_id}.zip, get signed URL, collect skipped_files and write manifest (e.g. README_export.txt) into
  package
- [x] T004 Implement POST start-export and sync response in `backend/app/api/v1/endpoints/articles_export.py`: validate
  request, enforce project membership, if metadata-only and small article count run service in-process and return 200
  with file (Content-Disposition, binary body), else enqueue Celery task and return 202 with jobId
- [x] T005 Implement Celery task in `backend/app/worker/tasks/export_tasks.py`: export_articles_task(project_id,
  article_ids, formats, file_scope, user_id), call ArticlesExportService, upload ZIP to storage, return dict with
  download_url, expires_at, skipped_files
- [x] T006 Implement GET status in `backend/app/api/v1/endpoints/articles_export.py`: GET
  /api/v1/articles-export/status/{job_id}, resolve task result and ownership, return ExportStatusResponse with status,
  progress (from Redis if used), downloadUrl when completed, skippedFiles, error when failed
- [x] T007 Implement cancel in `backend/app/api/v1/endpoints/articles_export.py`: POST or DELETE cancel for job_id,
  revoke Celery task, return 200 with cancelled true/false

**Checkpoint**: Export API is callable; sync metadata-only and async file-inclusive flows work from API

---

## Phase 3: User Story 1 - Export article metadata in standard formats (Priority: P1) 🎯 MVP

**Goal**: User can export current list or selection as CSV, RIS, or RDF from the articles list and receive a
downloadable file.

**Independent Test**: From articles list, trigger export, choose CSV (or RIS or RDF), receive a valid file that opens in
a spreadsheet or reference manager with expected fields.

### Implementation for User Story 1

- [x] T008 [P] [US1] Add export trigger (button or dropdown) in `frontend/components/articles/ArticlesList.tsx` that
  opens the export dialog
- [x] T009 [US1] Create ArticlesExportDialog in `frontend/components/articles/ArticlesExportDialog.tsx`: form with
  format checkboxes (CSV, RIS, RDF), file scope (None / Main only / All), article scope (Current list / Selected),
  default article scope to Current list when no selection (FR-001); disable export submit when article count is zero (
  empty list or no selection when "selected" — per spec edge case)
- [x] T010 [US1] Create export API client in `frontend/services/articlesExportService.ts`: startExport(projectId,
  articleIds, formats, fileScope) calling POST articles-export, handle 200 (return blob for download) and 202 (return
  jobId)
- [x] T011 [US1] Wire ArticlesExportDialog submit to articlesExportService.startExport and trigger browser download when
  response is 200 (blob + filename from Content-Disposition or default) in
  `frontend/components/articles/ArticlesExportDialog.tsx`

**Checkpoint**: User can export metadata-only (formats CSV/RIS/RDF) from the UI and get a file

---

## Phase 4: User Story 2 - Export metadata plus main PDFs only (Priority: P2)

**Goal**: User can export with "Main files only" and receive one package with metadata file(s) and one PDF per article
where a main file exists (flat structure).

**Independent Test**: Choose "Include files: Main files only", export; receive download with metadata and at most one
file per article, no subfolders per article.

### Implementation for User Story 2

- [x] T012 [US2] Ensure "Main files only" option is available and passes fileScope main_only in
  `frontend/components/articles/ArticlesExportDialog.tsx` (if not already from US1)
- [x] T013 [US2] When API returns 202 with jobId, show in-progress state and poll GET status in
  `frontend/services/articlesExportService.ts` (e.g. getExportStatus(jobId)) and in
  `frontend/components/articles/ArticlesExportDialog.tsx` until status is completed or failed
- [x] T014 [US2] When status is completed, show notification with one-time download link or button (e.g. toast + "
  Download" opening response.downloadUrl) in `frontend/components/articles/ArticlesExportDialog.tsx` (FR-009)

**Checkpoint**: User can export with main files only and get async download link when ready

---

## Phase 5: User Story 3 - Export all files with folder per article (Priority: P3)

**Goal**: User can export with "All files" and receive one subfolder per article (id_sanitized_title), each with
metadata and all linked files; skipped files reported in UI and in package manifest.

**Independent Test**: Choose "All files", export; root has one folder per article; each folder contains metadata and all
files; skipped files listed in UI and in package.

### Implementation for User Story 3

- [x] T015 [US3] Ensure "All files" option is available and passes fileScope all in
  `frontend/components/articles/ArticlesExportDialog.tsx`
- [x] T016 [US3] Ensure export package includes manifest (e.g. README_export.txt or export_manifest.txt) listing skipped
  files inside ZIP when any file could not be included in `backend/app/services/articles_export_service.py` (FR-010)
- [x] T017 [US3] Show skipped files summary in export UI when response includes skippedFiles (sync summary or from
  status when async) in `frontend/components/articles/ArticlesExportDialog.tsx` (FR-010)

**Checkpoint**: All file modes work; folder-per-article and skipped-files feedback are in place

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: i18n, rate limiting, and validation

- [x] T018 [P] Add i18n keys for export UI (Export, formats, file scope, article scope, current list, selected, download
  ready, etc.) in `frontend/lib/copy/articles.ts`
- [x] T019 Add rate limiting to export endpoints (e.g. @limiter.limit per user) in
  `backend/app/api/v1/endpoints/articles_export.py`
- [x] T020 Run quickstart.md acceptance checklist and fix any gaps (implementation matches checklist; manual QA
  recommended)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story implementation
- **Phase 3 (US1)**: Depends on Phase 2 — MVP metadata-only export from UI
- **Phase 4 (US2)**: Depends on Phase 2 and Phase 3 (dialog exists) — main files + async download link
- **Phase 5 (US3)**: Depends on Phase 2 and Phase 4 — all files + folder per article + skipped-files feedback
- **Phase 6 (Polish)**: Depends on Phase 3+ complete

### User Story Dependencies

- **US1 (P1)**: After Foundational; no dependency on US2/US3. Delivers metadata export from UI.
- **US2 (P2)**: Builds on US1 dialog; adds main_only and async polling + download link.
- **US3 (P3)**: Builds on US2; adds all files, manifest in package, skipped-files UI.

### Parallel Opportunities

- T001 and T002 can run in parallel (router vs schemas).
- Within Phase 3: T008 can be done in parallel with T009/T010 once contract is fixed; T010 and T009 are independent
  files.
- T018 (i18n) can run in parallel with other Polish tasks.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 is done:
# Option A: Implement dialog and service in parallel
Task T009: "Create ArticlesExportDialog in frontend/components/articles/ArticlesExportDialog.tsx"
Task T010: "Create export API client in frontend/services/articlesExportService.ts"

# Then wire and trigger
Task T008: "Add export trigger in frontend/components/articles/ArticlesList.tsx"
Task T011: "Wire dialog submit and browser download in ArticlesExportDialog.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T007)
3. Complete Phase 3: User Story 1 (T008–T011)
4. **STOP and VALIDATE**: Export metadata (CSV/RIS/RDF) from articles list and open file in spreadsheet/reference
   manager
5. Deploy or demo

### Incremental Delivery

1. Setup + Foundational → API ready
2. Add US1 → Metadata export from UI (MVP)
3. Add US2 → Main files + async download link
4. Add US3 → All files + folder per article + skipped-files feedback
5. Polish → i18n, rate limit, checklist

### Parallel Team Strategy

- Developer A: Phase 1 + Phase 2 (backend)
- Once Phase 2 is done: Developer B takes US1 (frontend), Developer C can start US2/US3 frontend (dialog options,
  polling, download link, manifest/skipped UI)

---

## Notes

- [P] tasks = different files, no shared state dependencies
- [USn] label maps task to user story for traceability
- No new DB migrations; export uses existing Article and ArticleFile
- Tests: not explicitly requested in spec; add unit/integration tests per project norms if desired
- Commit after each task or logical group; stop at any checkpoint to validate story independently
