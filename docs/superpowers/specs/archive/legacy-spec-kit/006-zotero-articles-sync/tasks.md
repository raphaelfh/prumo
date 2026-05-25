# Tasks: Zotero Article Data Parity

**Input**: Design documents from `specs/006-zotero-articles-sync/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`)
- Every task includes an exact file path

## Path Conventions

- **Backend**: `backend/app/`, `backend/alembic/versions/`, `backend/tests/`
- **Frontend**: `frontend/integrations/`, `frontend/services/`, `frontend/components/`, `frontend/hooks/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare routing and schema structure for the new sync actions.

- [x] T001 Register new Zotero sync actions in `backend/app/api/v1/endpoints/zotero_import.py`
- [x] T002 [P] Add sync request/response DTOs in `backend/app/schemas/zotero.py`
- [x] T003 [P] Extend Zotero action type definitions in `frontend/integrations/api/client.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the core persistence and orchestration required by all user stories.

**⚠️ CRITICAL**: No user story work should begin before this phase is complete.

- [x] T004 Create Alembic migration for parity/enrichment/sync entities in
  `backend/alembic/versions/20260328_006_zotero_article_parity.py`
- [x] T005 Implement RLS enablement and policies for all new public tables in
  `backend/alembic/versions/20260328_006_zotero_article_parity.py`
- [x] T006 Update article model with sync and enrichment fields in `backend/app/models/article.py`
- [x] T007 [P] Add canonical author and association models in `backend/app/models/article_author.py`
- [x] T008 [P] Add repository for canonical authors and links in `backend/app/repositories/article_author_repository.py`
- [x] T009 Extend article repository with canonical identity upsert/state methods in
  `backend/app/repositories/article_repository.py`
- [x] T010 Implement sync run and sync event persistence methods in `backend/app/repositories/article_repository.py`
- [x] T011 Extend async import task orchestration for sync runs/retries in `backend/app/worker/tasks/import_tasks.py`
- [x] T012 Add shared endpoint safeguards (rate limits, AppError mapping, trace_id propagation helpers) in
  `backend/app/api/v1/endpoints/zotero_import.py`

**Checkpoint**: Data model, repositories, and async orchestration are ready for story-specific behavior.

---

## Phase 3: User Story 1 - Complete Metadata Ingestion (Priority: P1) 🎯 MVP

**Goal**: Import Zotero records with full source parity and hybrid author modeling without data loss.

**Independent Test**: Import a representative Zotero item set and verify all source fields are preserved, including
optional/custom fields and ordered authors.

### Implementation for User Story 1

- [x] T013 [US1] Implement full parity field mapping pipeline in `backend/app/services/zotero_import_service.py`
- [x] T014 [US1] Implement hybrid author write flow (payload + canonical links) in
  `backend/app/services/zotero_import_service.py`
- [x] T015 [US1] Implement canonical identity dedup during import in `backend/app/services/zotero_import_service.py`
- [x] T016 [US1] Wire `sync-collection` action with project authorization enforcement in
  `backend/app/api/v1/endpoints/zotero_import.py`
- [x] T017 [US1] Add sync start client method in `frontend/services/zoteroImportService.ts`
- [x] T018 [US1] Update import UI trigger to start sync run in `frontend/components/extraction/ZoteroImportDialog.tsx`

**Checkpoint**: Full parity ingestion with hybrid authors is functional and independently verifiable.

---

## Phase 4: User Story 2 - Reliable Historical Sync (Priority: P2)

**Goal**: Keep local records aligned with source updates using deterministic conflict precedence, soft-delete, and
reactivation.

**Independent Test**: Re-sync existing imported records after source updates/removals/reappearance and confirm
deterministic updates without duplicates.

### Implementation for User Story 2

- [x] T019 [US2] Implement authority-rule conflict resolution (source parity vs local enrichment) in
  `backend/app/services/zotero_import_service.py`
- [x] T020 [US2] Implement removed-at-source transition and reactivation flow in
  `backend/app/services/zotero_import_service.py`
- [x] T021 [US2] Persist authority rule and lifecycle transitions into sync events in
  `backend/app/services/zotero_import_service.py`
- [x] T022 [US2] Implement `sync-retry-failed` action with ownership checks in
  `backend/app/api/v1/endpoints/zotero_import.py`
- [x] T023 [US2] Add retry-failed client method in `frontend/services/zoteroImportService.ts`

**Checkpoint**: Historical sync behavior is deterministic, idempotent, and resilient to retries.

---

## Phase 5: User Story 3 - Traceable Import Outcomes (Priority: P3)

**Goal**: Expose run-level and item-level diagnostics for support and operational visibility.

**Independent Test**: Run a mixed batch (success/failure/skipped) and confirm status and diagnostics expose actionable
outcomes per item.

### Implementation for User Story 3

- [x] T024 [US3] Implement `sync-status` action returning aggregate run counters with strict ownership checks in
  `backend/app/api/v1/endpoints/zotero_import.py`
- [x] T025 [US3] Implement `sync-item-result` action with filter/pagination and ownership checks in
  `backend/app/api/v1/endpoints/zotero_import.py`
- [x] T026 [US3] Add status and diagnostics client methods in `frontend/services/zoteroImportService.ts`
- [x] T027 [US3] Implement polling hook for sync status in `frontend/hooks/zotero/useZoteroSyncStatus.ts`
- [x] T028 [US3] Render run status, counters, and failed-item diagnostics in
  `frontend/components/extraction/ZoteroImportDialog.tsx`

**Checkpoint**: Support-facing diagnostics are available with run and item detail.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden quality, observability, and delivery readiness across stories.

- [x] T029 [P] Add integration tests for authorization boundaries and endpoint ownership (403/404 paths) in
  `backend/tests/integration/test_zotero_import_api.py`
- [x] T030 [P] Add integration tests for AppError envelope, trace_id presence, and rate limiting behavior in
  `backend/tests/integration/test_zotero_import_api.py`
- [x] T031 [P] Add/update backend unit coverage for parity/conflict/lifecycle logic in
  `backend/tests/unit/test_zotero_import_service.py`
- [x] T032 [P] Add unit coverage for canonical author repository behavior in
  `backend/tests/unit/test_article_author_repository.py`
- [x] T033 [P] Add/update frontend service/hook coverage in `frontend/tests/services/zoteroImportService.test.ts`
- [x] T034 Add regression tests ensuring non-Zotero article flows remain unchanged in
  `backend/tests/integration/test_articles_non_zotero_regression.py`
- [x] T035 Add structured logging fields for sync run observability in `backend/app/services/zotero_import_service.py`
- [x] T036 Add performance validation test script and report for sync SLO checks in
  `backend/tests/performance/test_zotero_sync_performance.py`
- [x] T037 Execute production-readiness validation and attach evidence in
  `specs/006-zotero-articles-sync/quickstart.md` (RLS/policies verified, rate-limit verified, AppError+trace_id
  verified, perf SLO report attached, rollback steps validated)
- [x] T038 Implement source-agnostic canonical normalization module and wire Zotero ingestion to it in
  `backend/app/services/article_source_normalization.py`
- [x] T039 Add cross-source normalization contract tests (Zotero vs RIS vs manual for same article identity/dedup
  outcome) in `backend/tests/integration/test_articles_cross_source_consistency.py`
- [x] T040 Add source-lineage mapping unit coverage to ensure non-authoritative source differences do not break
  canonical identity in `backend/tests/unit/test_article_source_normalization.py`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 (US1)**: Depends on Phase 2.
- **Phase 4 (US2)**: Depends on Phase 2 and extends US1 flows.
- **Phase 5 (US3)**: Depends on Phase 2 and uses outputs from US1/US2.
- **Phase 6 (Polish)**: Depends on all implemented stories.

### User Story Dependencies

- **US1 (P1)**: First deliverable and MVP scope.
- **US2 (P2)**: Builds on imported records created by US1.
- **US3 (P3)**: Depends on run/event data produced by US1 and US2 behavior.

### Within Each User Story

- Service/domain logic before endpoint wiring.
- Endpoint wiring before frontend service integration.
- Frontend service integration before UI polling/diagnostics rendering.

### Parallel Opportunities

- **Phase 1**: T002 and T003 parallel.
- **Phase 2**: T007 and T008 parallel; after that T009 and T010 can progress together.
- **US1**: T017 can start after T003/T016 while T014 and T015 evolve in backend service.
- **US3**: T026 and T027 parallel once T024/T025 contracts stabilize.
- **Polish**: T029, T030, T031, T032, T033, and T040 parallel after T038 is complete.

---

## Parallel Example: User Story 1

```bash
# Backend parity + author tracks in parallel after foundational phase:
Task T014: "Implement hybrid author write flow in backend/app/services/zotero_import_service.py"
Task T015: "Implement canonical identity dedup in backend/app/services/zotero_import_service.py"

# Frontend sync-start wiring in parallel after endpoint action exists:
Task T017: "Add sync start client method in frontend/services/zoteroImportService.ts"
Task T018: "Update import UI trigger in frontend/components/extraction/ZoteroImportDialog.tsx"
```

## Parallel Example: User Story 2

```bash
# Run conflict and lifecycle behavior workstreams together:
Task T019: "Implement authority-rule conflict resolution in backend/app/services/zotero_import_service.py"
Task T020: "Implement removed-at-source and reactivation flow in backend/app/services/zotero_import_service.py"
```

## Parallel Example: User Story 3

```bash
# Frontend status consumption tasks after status APIs are available:
Task T026: "Add status and diagnostics client methods in frontend/services/zoteroImportService.ts"
Task T027: "Implement polling hook in frontend/hooks/zotero/useZoteroSyncStatus.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001-T003).
2. Complete Phase 2 (T004-T012).
3. Complete Phase 3 (T013-T018).
4. Validate US1 independently with representative Zotero payload imports.

### Incremental Delivery

1. Deliver US1 for complete parity ingestion.
2. Add US2 for deterministic historical synchronization and retries.
3. Add US3 for operational diagnostics and support visibility.
4. Complete Phase 6 for confidence and release readiness.

### Parallel Team Strategy

1. One backend stream handles schema/repository foundation (Phase 2).
2. A second stream starts frontend contract wiring from Phase 1.
3. After US1, split backend stream into lifecycle logic (US2) and diagnostics API (US3), while frontend stream builds
   polling and diagnostics UI.

---

## Notes

- Tasks follow the required checklist format: checkbox, Task ID, optional `[P]`, required `[USn]` in story phases, and
  exact file path.
- Story phases are independently scoped for incremental delivery.
