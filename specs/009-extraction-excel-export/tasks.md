---

description: "Task list for 009-extraction-excel-export"
---

# Tasks: Extraction Excel Export

**Input**: Design documents in `/specs/009-extraction-excel-export/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/extraction-export.openapi.yaml ✓, quickstart.md ✓

**Tests**: Interleaved per the project's "always test during implementation" rule — test tasks live next to the implementation tasks they cover, not batched at the end.

**Organization**: Tasks are grouped by user story (US1 = Consensus / P1 / MVP; US2 = Single-user / P2; US3 = All-users / P3). Phase 1 (Setup) and Phase 2 (Foundational) block all user stories.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: User-story label (omitted for Setup, Foundational, Polish)
- File paths are absolute from repo root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the new dependency, create the new directories, and update the API router scaffold. Cheap, mostly parallelizable.

- [ ] T001 Add `openpyxl ≥ 3.1` as a backend runtime dependency via `cd backend && uv add openpyxl`; commit the updated `backend/pyproject.toml` and `backend/uv.lock`.
- [ ] T002 [P] Create the `backend/app/services/exports/` package with an `__init__.py` exporting nothing (marker package per the plan's module layout).
- [ ] T003 [P] Create the `frontend/hooks/exports/` directory with an empty `index.ts` so future hooks have a home (mirrors the existing `frontend/hooks/runs/` pattern).
- [ ] T004 [P] Append i18n keys for the export dialog to `frontend/lib/copy/extraction.ts` (keys: `exportButton`, `exportDialogTitle`, `exportDialogSubtitle`, `exportSourceConsensus`, `exportSourceSingleUser`, `exportSourceAllUsers`, `exportScopeCurrentList`, `exportScopeSelectedOnly`, `exportIncludeAiMetadata`, `exportAnonymizeReviewers`, `exportEmptyConsensusReason`, `exportEmptySingleUserReason`, `exportGenerating`, `exportRetry`, `exportFilenamePreviewLabel`).

**Checkpoint**: dependency added, directories ready, copy keys in place.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ground all three user stories — shared schemas, the new repository, the auth gate, the API/Celery scaffolds, the frontend service + dialog skeleton. No business logic for any specific mode lands here; only what every mode needs.

**⚠️ CRITICAL**: No user-story phase can begin until this phase is complete.

### Backend foundation

- [ ] T005 [P] Create `backend/app/schemas/extraction_export.py` with Pydantic v2 models: `ExtractionExportMode` (StrEnum), `ExtractionArticleScope` (StrEnum), `ExtractionExportRequest` (matches contracts/extraction-export.openapi.yaml §ExtractionExportRequest), `ExportStartedResponse`, `ExportStatusResponse`, `ExportCancelResponse`. Use `populate_by_name=True` and `camelCase` aliases for the frontend.
- [ ] T006 [P] Create `backend/app/repositories/extraction_template_version_repository.py` exposing `async def get_active(self, project_template_id: UUID) -> ExtractionTemplateVersion`, joining the `is_active` partial unique index. Mirror existing repository conventions (constructor takes `db`, no `commit()`, only `flush()`).
- [ ] T007 In `backend/app/services/extraction_export_service.py`, define the in-memory `ExportLayout` dataclass tree from data-model.md §2 (`FieldDescriptor`, `SectionDescriptor`, `ArticleDescriptor`, `ReviewerDescriptor`, `ExportLayout`, `ExportNotes`). No resolver logic yet — just the dataclasses with `__init__`/`__repr__` from `@dataclass(frozen=True)`.
- [ ] T008 In the same service file (T007), implement `ExtractionExportService.__init__` taking `db`, `user_id`, `storage`, `trace_id` (constructor injection per constitution §II); add `async def assert_can_export(self, project_id: UUID, mode: ExportMode, target_reviewer_id: UUID | None) -> None` that calls `ProjectMemberRepository.is_member` and (for cross-reviewer modes) `has_role(MANAGER)`, raising `AppError` subclasses on failure. Add `BLOCKED_BY: T005, T007`.
- [ ] T009 In `backend/app/services/exports/extraction_xlsx_builder.py`, create the pure-function entry point `def build_workbook(layout: ExportLayout) -> bytes` and an internal `_write_main_sheet(workbook, layout)` skeleton that wires the section/field rows and article-column-header row but leaves cell value writing as a `pass`. Add `_write_notes_sheet(workbook, layout)` with the basic metadata block. Use `openpyxl.Workbook(write_only=True)` for memory headroom. Add `BLOCKED_BY: T007`.
- [ ] T010 Add `backend/tests/unit/test_extraction_xlsx_builder.py` with one passing test that builds a minimal `ExportLayout` (1 section, 1 field, 1 article) and asserts the resulting bytes are a valid `.xlsx` (use `openpyxl.load_workbook(io.BytesIO(bytes))` to round-trip). `BLOCKED_BY: T009`.
- [ ] T011 [P] Create `backend/app/worker/tasks/extraction_export_tasks.py` with `@celery_app.task(bind=True) def export_extraction_task(self, project_id, ...): ...` skeleton mirroring `export_articles_task`. The body raises `NotImplementedError` for now; wiring lands in T032.
- [ ] T012 Create `backend/app/api/v1/endpoints/extraction_export.py` with three async routes per the OpenAPI contract — `POST /api/v1/projects/{project_id}/extraction-export`, `GET .../status/{job_id}`, `POST .../status/{job_id}/cancel` — each registered with `@limiter.limit("10/minute")` (start) and `@limiter.limit("30/minute")` (status), returning canned `ApiResponse.success`/`failure` payloads. Reuse the Redis owner-record helpers (`_remember_export_owner` / `_lookup_export_owner`) from `articles_export.py` — extract them into `backend/app/utils/export_jobs.py` if cleaner. `BLOCKED_BY: T005`.
- [ ] T013 Register the new router in `backend/app/api/v1/router.py` under `/api/v1/projects/{project_id}/extraction-export`. Add a smoke test in `backend/tests/integration/test_extraction_export_endpoint.py` asserting all three paths exist in `/api/openapi.json` (per quickstart.md §3).

### Frontend foundation

- [ ] T014 [P] Create `frontend/types/extraction-export.ts` exporting `ExtractionExportMode = 'consensus' | 'single_user' | 'all_users'`, `ExtractionArticleScope = 'current_list' | 'selected_only'`, `StartExtractionExportResult` (sync `{kind: 'sync', blob, filename}` vs async `{kind: 'async', jobId: string}`), `ExtractionExportRequest`, `ExtractionExportStatus`.
- [ ] T015 [P] Extend `frontend/types/background-jobs.ts` with a `createExtractionExportJob(projectId, jobId, meta)` factory mirroring `createArticlesExportJob`. Add the new job kind to the union type and to the `useBackgroundJobs` reducer's `addJob` switch (read the existing file before editing — make a minimal addition).
- [ ] T016 Create `frontend/services/extractionExportService.ts` with `startExport(projectId, request): Promise<StartExtractionExportResult>`, `getExportStatus(projectId, jobId)`, `cancelExport(projectId, jobId)`. All calls go through the shared `apiClient` (constitution §VI). Sync responses come back as `Blob` with `Content-Disposition` parsing; async responses as JSON `{job_id}`.
- [ ] T017 [P] Create `frontend/components/extraction/ExtractionExportDialog.tsx` modelled on `ArticlesExportDialog.tsx`: same Radix `Dialog` primitives, same prop shape (`open`, `onOpenChange`, `projectId`, `currentListIds`, `selectedIds`, `defaultArticleScope`). Stub the body with the three radio groups (source / scope / additional content) — no submit handler yet, the `Export` button is a no-op. Read the existing `ArticlesExportDialog.tsx:1-120` for the visual pattern to mirror exactly.
- [ ] T018 Modify `frontend/components/extraction/ExtractionInterface.tsx` to add the "Export" top-bar action button alongside the existing actions. Wire it to a new local state `[exportDialogOpen, setExportDialogOpen]` and render `<ExtractionExportDialog … />`. Pass the current article list ids (from the `articles` state) and currently-selected ids (from the existing `ArticleExtractionTable` selection — extend the table's props if needed to lift selection). The button is enabled whenever `articles.length > 0`. `BLOCKED_BY: T017`.
- [ ] T019 [P] Delete or refactor `frontend/components/extraction/ExtractionExport.tsx`: the placeholder component is superseded by the dialog flow. If any caller still references it, redirect them or remove the import.

**Checkpoint**: foundation ready — three endpoints exist and return safe stubs, frontend dialog opens and closes, no business logic for any mode yet. All three user stories can now begin in parallel.

---

## Phase 3: User Story 1 — Consensus export (Priority: P1) 🎯 MVP

**Goal**: A reviewer or manager clicks Export, accepts the defaults (Consensus / Current list / no AI metadata / no anonymize), and downloads a `.xlsx` whose main sheet matches the reference CHARMS workbook layout: section rows, field rows, one column per finalized article, with multi-instance articles fanned out into model sub-columns.

**Independent Test**: Per spec User Story 1 — with one finalized Run on a CHARMS-like template, the default-options export produces an `.xlsx` whose main sheet matches the reference `12874_2023_1849_MOESM2_ESM.xlsx` column-per-article + section-as-row layout.

### US1 — Backend: layout resolver

- [ ] T020 [US1] In `ExtractionExportService`, implement `async def resolve_layout(self, project_id, template_id, mode, article_ids, article_scope, include_ai_metadata, anonymize_reviewer_names) -> ExportLayout`. For US1 this only needs the Consensus branch: fetch active TemplateVersion via `ExtractionTemplateVersionRepository.get_active`, traverse the JSONB snapshot to produce `SectionDescriptor` + `FieldDescriptor` trees in the order defined by `sort_order` (use `partitionEntityTypes`-style logic by `role`). The snapshot traversal MUST also yield **multi-value sub-field rows verbatim** when a section contains sub-fields with a hierarchical label scheme (e.g. CHARMS `2.8.1`, `2.8.2`, `2.8.3` — FR-020): each sub-field becomes its own `FieldDescriptor` in display order, no special-casing in the builder. `BLOCKED_BY: T006, T007, T008`.
- [ ] T021 [US1] Add `async def _resolve_articles_for_consensus(self, template_id, candidate_ids) -> tuple[list[ArticleDescriptor], dict[str, int]]` in the service: fetch Runs for `(article_id ∈ candidate_ids, template_id, kind='extraction')`, partition by `stage`. Returns only `finalized` articles as `ArticleDescriptor` rows; the dict is `omitted_articles_by_stage` for the Notes sheet (FR-013).
- [ ] T022 [US1] Add `async def _build_consensus_value_map(self, run_ids) -> dict[tuple[UUID, UUID, UUID], Any]` performing a **single bulk query** on `extraction_published_states WHERE run_id IN (:run_ids)`, returning a `(run_id, instance_id, field_id) -> value` dict (data-model.md §4). This is the cornerstone of SC-002.
- [ ] T023 [US1] Add `async def _load_model_instances(self, run_ids) -> dict[UUID, list[UUID]]`: for each Run, return ordered instance ids per `model_section` entity (preserves display order via `sort_order`). Used by the multi-instance fan-out in T024. Returns `{}` when the template has no `model_container`.
- [ ] T024 [US1] Add `async def _load_article_headers(self, article_ids, value_map) -> dict[UUID, str]`: applies the FR-012 fallback chain — extracted `author, year` if present in the consensus value_map, else `article.title[:60]`, else short article id. One query on `articles` for fallback fields.

### US1 — Backend: builder cell-writing (Consensus)

- [ ] T025 [US1] In `extraction_xlsx_builder._write_main_sheet`, implement the row/column iteration that walks `layout.sections` → fields → article columns and writes each cell via a `_value_for(article, instance, field) -> Any` closure provided by the orchestrator. Apply FR-010: for multi-instance articles, **repeat** the study-section value across all model sub-columns (never merge). Apply FR-009: section-name rows have bold font + a light background fill style. Apply FR-019 via a dedicated pure helper `_format_cell(value: Any, field: FieldDescriptor, locale: str) -> Any` written in the same module: `text/number/date` → as-is (typed cells, not strings); `select` → display label of the selected option; `multiselect` → labels joined with `"; "` (semicolon-space, never plain comma, to disambiguate comma-bearing labels); `boolean` → `Yes`/`No` localised to the dialog locale; `None`/missing → blank. `BLOCKED_BY: T009, T020`.
- [ ] T026 [US1] In the builder, implement `_write_notes_sheet` per FR-007 §3 and FR-013: write template name + version, export mode label, timestamp, `omitted_articles_by_stage` counts, `obsolete_fields_per_article` per FR-017, and the FR-040 lineage-caveat sentence (this is emitted whether or not the AI metadata sheet is included — keeps the caveat discoverable).
- [ ] T027 [US1] Add `backend/tests/unit/test_extraction_xlsx_builder.py` cases for: (a) single-article single-section single-field consensus; (b) multi-instance article with 2 model_section instances repeats study-section values; (c) section header rows have the expected style flags; (d) FR-019 value formatting per type — `text/number/date` stay typed (not stringified), `select` renders the option label, `multiselect` joins with `"; "` and survives comma-bearing labels (`"A, with comma"; "B"`), `boolean True/False` → `Yes`/`No`, `None` → blank; (e) FR-020 multi-value sub-field rows (e.g. CHARMS 2.8.1/2.8.2/2.8.3) appear as separate rows in display order under the parent section. Round-trip via `openpyxl.load_workbook` to assert structure. `BLOCKED_BY: T025, T026`.

### US1 — Backend: endpoint wiring (sync + async)

- [ ] T028 [US1] In `extraction_export.py:start_export`, implement the validation + auth block: parse `ExtractionExportRequest`, call `assert_can_export`, return `ApiResponse.failure(code="FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND")` as appropriate per the OpenAPI contract.
- [ ] T029 [US1] In `extraction_export.py:start_export`, implement the **sync path**: when `article_ids ≤ SYNC_EXPORT_MAX_ARTICLES (=50)` AND `mode in (consensus, single_user)` AND `include_ai_metadata == False`, call `service.resolve_layout(...)` + `extraction_xlsx_builder.build_workbook(layout)` via `asyncio.to_thread()`, return `Response(content=..., media_type=XLSX_MIME, headers={Content-Disposition})`. Filename from `service.format_filename(project, template, mode)` per FR-024. `BLOCKED_BY: T020-T026, T028`.
- [ ] T030 [US1] In `extraction_export.py:start_export`, implement the **async fallback**: enqueue `export_extraction_task.delay(...)`, return `202` with `ApiResponse.success(data=ExportStartedResponse(job_id=task.id))`. On Redis failure return `503 SERVICE_UNAVAILABLE` per the contract.
- [ ] T031 [US1] Implement `get_export_status` and `cancel_export` mirroring the articles_export pattern exactly (state mapping, ownership via Redis key, 404 when owner unknown, terminal states no-op).
- [ ] T032 [US1] Implement `export_extraction_task` body in `extraction_export_tasks.py`: open a fresh DB session + storage adapter, build the `ExtractionExportService`, call `resolve_layout` + `build_workbook`, upload bytes to `articles` bucket at `exports/extraction/{user_id}/{job_id}.xlsx`, get signed URL (1 h TTL), return `{download_url, expires_at, user_id}`. `BLOCKED_BY: T011, T020-T026`.
- [ ] T033 [US1] Add `backend/tests/integration/test_extraction_export_endpoint.py` cases: (a) non-member → 403; (b) consensus sync export with 3 finalized articles returns 200 with `.xlsx` Content-Type; (c) 51-article consensus export returns 202 + job_id; (d) `EMPTY_ELIGIBLE_ARTICLES` 422 when no finalized articles in the scope. `BLOCKED_BY: T028-T032`.
- [ ] T034 [US1] Add `backend/tests/integration/test_extraction_export_service.py` covering the `resolve_layout` consensus branch against a seeded project (use the existing `tests/factories/template_factory.py`): asserts on `layout.articles` filtered by stage, `omitted_articles_by_stage` populated, multi-instance article gets N model instances.

### US1 — Frontend: dialog → submit → download/notify

- [ ] T035 [US1] In `ExtractionExportDialog.tsx`, wire the `Export` button to `startExport(projectId, request)` with full in-flight UX (FR-030 + FR-031):
  - **In-flight state**: while the request is pending, render `<Loader2 />` + label "Generating…" on the Export button; disable all dialog controls (`Source`, `Reviewer picker`, `Articles to export`, all toggles, Cancel button keeps Esc/click → abort).
  - **Cancel during sync**: keep an `AbortController` in component state, attach `signal` to the `startExport` fetch; on Esc keypress, the `Cancel` button click, or `onOpenChange(false)`, call `controller.abort()` so the browser aborts the in-flight request. Server-side cancellation is best-effort and the dialog does NOT wait for an ack.
  - **Sync success**: `triggerDownload(result.blob, result.filename)`, `toast.success`, `onOpenChange(false)`.
  - **Async success**: `useBackgroundJobs().addJob(createExtractionExportJob(...))`, `toast.info(t('extraction','exportStarted'))`, `onOpenChange(false)`.
  - **Error path (FR-031)**: catch any non-2xx (including AbortError → just close, no error toast); read `response.error.message` from the API envelope (NEVER `response.detail`); render an inline error banner inside the dialog (red `Alert` component with the message) and a `Retry` button next to `Cancel` that re-submits with the same payload; log the error via the existing client logger.
  - Mirror `ArticlesExportDialog.handleSubmit` lines 98–125 for the happy path while adding the abort + error handling on top.
  - `BLOCKED_BY: T016, T017`.
- [ ] T036 [US1] In the same dialog, implement the **live preview line** (FR-027): a derived string `${effectiveArticleCount} articles × ${fieldCount} fields → ~${estimatedSize}, ${expectedDelivery}`. Estimate `effectiveArticleCount` from the chosen scope and the local article list; `fieldCount` is a fixed prop from the parent (pass the active template's field count via a new prop). Render below the footer actions.
- [ ] T037 [US1] In the dialog, implement the **smart default** for `Articles to export` (FR-029): when `selectedIds.length > 0`, default to `selected_only`; else default to `current_list`. Show counts in the radio labels.
- [ ] T038 [US1] Implement the **empty-state guard** (FR-005): the `Export` button is disabled when the effective universe intersected with mode eligibility is zero. Show inline reason ("No finalized data to export yet" for Consensus + zero finalized). The intersection count is reported by the parent via a new `eligibleArticleCount` prop (parent computes it from finalized-Run counts cached in TanStack Query).
- [ ] T039 [US1] Add `frontend/components/extraction/ExtractionExportDialog.test.tsx` (vitest + Testing Library + MSW) covering:
  - **Happy sync**: renders the dialog, clicks `Export`, MSW returns a sync blob, asserts `triggerDownload` was called with the expected filename and `toast.success` was called.
  - **In-flight UI (FR-030)**: while the MSW handler is held, asserts the `Export` button shows "Generating…" with a spinner and that other controls are disabled.
  - **Abort during sync**: starts an export, presses `Esc`, asserts the AbortController fired and the dialog closed without a success toast.
  - **Error envelope (FR-031)**: MSW returns `{ok:false, error:{code:'FORBIDDEN', message:'You are not allowed to do this'}}`; asserts the inline error banner shows the `error.message` text (not the HTTP status), and that a `Retry` button is rendered.
  - **Retry re-submits**: clicking `Retry` re-issues the same request payload (MSW handler asserts second call carries identical body).
  - `BLOCKED_BY: T035`.
- [ ] T040 [US1] Add `frontend/hooks/exports/useExtractionExportJob.ts`: a TanStack Query wrapper that polls `getExportStatus(projectId, jobId)` while status ∈ {`pending`,`running`}, with backoff. Used by `useBackgroundJobs` UI to surface progress. Mirror `useArticlesExportJob` if it exists; otherwise model on the existing `articles_export` polling code.

### US1 — Backend: AI metadata sheet (orthogonal, US1 acceptance scenarios 6-7)

- [ ] T041 [US1] In `ExtractionExportService`, add `async def _load_ai_proposals(self, run_ids) -> list[AiProposalRow]` performing a single bulk query joining `extraction_proposal_records` (filter `source='ai'`, `run_id IN (...)`) ← LEFT JOIN `extraction_evidence` ← LEFT JOIN the latest `reviewer_state`'s decision per `(run, instance, field)`. Implement the outcome heuristic in data-model.md §5. `BLOCKED_BY: T008`.
- [ ] T042 [US1] In the builder, implement `_write_ai_metadata_sheet(workbook, layout, rows)` per FR-037: flat-tabular with the 12 columns in the exact order. Place between main sheet and Notes sheet. When `rows` is empty, emit the placeholder row from FR-039. `BLOCKED_BY: T041, T025`.
- [ ] T043 [US1] In `start_export`, route to the async path whenever `include_ai_metadata == True` (per research.md §3). Update the sync-eligibility check accordingly.
- [ ] T044 [US1] Extend `test_extraction_xlsx_builder.py` and `test_extraction_export_service.py` with AI-metadata cases: (a) sheet present + 1 row per proposal + correct outcome labelling for accept/edit/reject/pending/superseded; (b) placeholder row when no proposals exist; (c) sheet absent when toggle is off.

### US1 — Frontend: AI metadata toggle

- [ ] T045 [US1] In `ExtractionExportDialog.tsx`, render the "Include AI metadata sheet" checkbox under section §3 of the dialog (FR-002 §3). Tooltip text from the new i18n key. Default off. The checkbox state is passed in the request.
- [ ] T046 [US1] Extend `ExtractionExportDialog.test.tsx`: ticking the checkbox sends `include_ai_metadata: true` in the request body; the live preview line mentions the AI metadata sheet.

**Checkpoint**: US1 is fully functional and testable. A user can download a Consensus `.xlsx` with optional AI metadata sheet via either sync (≤ 50 articles, no AI) or async (otherwise) delivery. **STOP HERE for MVP demo.**

---

## Phase 4: User Story 2 — Single-user export (Priority: P2)

**Goal**: A reviewer can switch the source-of-values to "Single user", target themselves (or — for managers — any reviewer), and download a `.xlsx` populated with that reviewer's latest non-reject decisions (including articles still in `review`). Cells with no decision are blank.

**Independent Test**: Per spec User Story 2 — with 2 articles in `review` and the current user having decisions on them, the Single-user export contains those values.

### US2 — Backend

- [ ] T047 [P] [US2] In `ExtractionExportService`, add `async def _resolve_articles_for_single_user(self, template_id, candidate_ids, reviewer_id) -> tuple[list[ArticleDescriptor], dict[str,int]]`: include Runs in any non-terminal stage where the target reviewer has ≥ 1 non-reject decision; exclude `cancelled` and "no decisions at all". Returns the same shape as the consensus variant.
- [ ] T048 [P] [US2] In the service, add `async def _build_single_user_value_map(self, run_ids, reviewer_id) -> dict[tuple[UUID,UUID,UUID], Any]` performing the single bulk JOIN from data-model.md §3 (Single-user mode). Decision rules: `accept_proposal` → `proposal.proposed_value`; `edit` → `decision.value`; `reject` → `None`.
- [ ] T049 [US2] Extend `resolve_layout` to branch on `mode == single_user`: call `_resolve_articles_for_single_user` instead of the consensus equivalent, then feed `_build_single_user_value_map` into the builder. `BLOCKED_BY: T020, T047, T048`.
- [ ] T050 [US2] In `start_export`, when `mode == single_user` AND `reviewer_id != user.sub`, additionally call `ProjectMemberRepository.has_role(MANAGER)`; fail with `FORBIDDEN` envelope if not a manager (FR-004). `BLOCKED_BY: T028`.
- [ ] T051 [US2] Add `async def list_reviewers_with_decisions(self, project_id, template_id) -> list[ReviewerInfo]` to the service: returns reviewers with ≥ 1 non-reject decision on this template's Runs, sorted by display name. Exposed via a sub-route `GET /api/v1/projects/{project_id}/extraction-export/reviewers?template_id=...` (manager-only when callers want the full list; non-managers get only themselves). Add the route to `extraction_export.py`.
- [ ] T052 [US2] Extend `test_extraction_export_endpoint.py` with: (a) single-user self export returns 200 with the caller's values; (b) single-user other reviewer as non-manager → 403; (c) single-user other reviewer as manager → 200 with that reviewer's values; (d) reject decisions render as blank cells.
- [ ] T053 [US2] Extend `test_extraction_xlsx_builder.py` with a Single-user case using a hand-crafted value_map asserting reject → blank, accept_proposal → proposed value, edit → decision value.

### US2 — Frontend

- [ ] T054 [P] [US2] In `ExtractionExportDialog.tsx`, render the **reviewer picker** below the source-of-values radio when `mode === 'single_user'` (FR-028). Use a shadcn `Combobox` (or `Select` if combobox is overkill). Fetch the eligible reviewer list via a new TanStack Query hook `useEligibleReviewers(projectId, templateId)` that calls the route from T051. Default value: the current user's id.
- [ ] T055 [US2] When the caller is **not** a manager (read role from a `useProjectMemberRole(projectId)` hook, already exists in the codebase), restrict the reviewer picker to the current user only (show name as read-only text rather than a combobox).
- [ ] T056 [US2] Add a `frontend/hooks/exports/useEligibleReviewers.ts` TanStack Query wrapper around the reviewers endpoint.
- [ ] T057 [US2] Extend `ExtractionExportDialog.test.tsx` with: (a) selecting "Single user" reveals the reviewer picker pre-filled with the current user; (b) non-managers cannot change the picker; (c) submitting in single_user mode sends `reviewer_id` in the request body.

**Checkpoint**: US1 + US2 both functional. A reviewer can export their in-progress decisions; a manager can do the same for any other reviewer.

---

## Phase 5: User Story 3 — All-users side-by-side audit (Priority: P3)

**Goal**: A manager selects "All users" mode and downloads a `.xlsx` whose each article column splits into `Consensus` + one sub-column per reviewer who participated. Optionally anonymize reviewer names.

**Independent Test**: Per spec User Story 3 — with consensus + 2 reviewers on an article, the All-users export has 3 sub-columns labelled "Consensus", "Reviewer A", "Reviewer B" (or real names) under that article's header.

### US3 — Backend

- [ ] T058 [P] [US3] In `ExtractionExportService`, add `async def _list_reviewers_for_runs(self, run_ids) -> list[ReviewerDescriptor]`: distinct reviewers with ≥ 1 non-reject decision across the run set, ordered alphabetically by display name; populate `ReviewerDescriptor.display_label` as real name OR `Reviewer A/B/...` per `anonymize_reviewer_names`. Reviewer-id stable ordering when anonymized (FR-011).
- [ ] T059 [P] [US3] Add `async def _build_all_users_value_map(self, run_ids, reviewer_ids) -> dict[tuple[UUID,UUID,UUID,UUID|None], Any]`: 4-tuple key adds `reviewer_id` (or `None` for the consensus sub-column). Reuses `_build_single_user_value_map` per reviewer + `_build_consensus_value_map` for the `None` slot. Bulk-loaded — at most `len(reviewer_ids) + 1` queries regardless of article count (data-model.md §4).
- [ ] T060 [US3] Extend `resolve_layout` to branch on `mode == all_users`: populate `layout.reviewers` via T058 and use the 4-tuple value_map from T059. `BLOCKED_BY: T020, T058, T059`.
- [ ] T061 [US3] In `extraction_xlsx_builder`, extend `_write_main_sheet` to produce the per-article × per-model × per-reviewer fan-out (FR-011): sub-column order `Consensus, Reviewer 1, Reviewer 2, …`. The article-header merge spans `(model_count × reviewer_sub_col_count)` columns. The reviewer label row sits between the article header and the section/field rows. `BLOCKED_BY: T025`.
- [ ] T062 [US3] In `start_export`, when `mode == all_users`, gate on manager role (re-uses `assert_can_export` from T008 — verify it covers this case; if not, add a manager check).
- [ ] T063 [US3] Extend `test_extraction_export_endpoint.py`: (a) all_users as non-manager → 403; (b) all_users as manager with 2 reviewers + consensus → 200 with sheet shape 3 sub-columns per article; (c) anonymized variant → labels "Reviewer A/B" in stable id order.
- [ ] T064 [US3] Extend `test_extraction_xlsx_builder.py` with All-users layout cases: (a) header merge dimensions match `models × (1 + reviewer_count)`; (b) anonymized labels are stable across two runs of the builder with the same input.

### US3 — Frontend

- [ ] T065 [P] [US3] In `ExtractionExportDialog.tsx`, render the **"Anonymize reviewer names" toggle** visible only when `mode === 'all_users'` (FR-028). Helper text per FR-028. Default off. State passed in the request body.
- [ ] T066 [US3] Disable the "All users" radio for non-managers with a tooltip explaining the permission requirement (FR-004). Read role from `useProjectMemberRole` (used in T055 too).
- [ ] T067 [US3] Extend `ExtractionExportDialog.test.tsx`: (a) non-manager sees All-users disabled; (b) toggling anonymize sends `anonymize_reviewer_names: true`; (c) live preview line reflects the multiplied column count.

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Audit logging, performance smoke test, retention follow-up, documentation hygiene. Optional for MVP; required before production rollout.

- [ ] T068 [P] In `ExtractionExportService`, emit a structlog audit entry on every export start (FR-025): logger name `app.audit.extraction_export`, fields `{actor, project_id, mode, target_reviewer_id, template_id, article_count, scope, include_ai_metadata, anonymize_reviewer_names, generated_at, trace_id}`. Verify via a log-capture test in `tests/integration/test_extraction_export_endpoint.py`.
- [ ] T069 [P] In `frontend/components/extraction/ExtractionExportDialog.tsx`, verify keyboard focus order matches FR-035 (Source → Reviewer picker → Articles to export → Anonymize → Include-AI-metadata → Cancel → Export). Add a Playwright e2e covering the keyboard-only flow when time allows.
- [ ] T070 [P] Create `backend/scripts/seed_large_extraction_project.py` per quickstart.md §5: seeds a project with 500 articles, finalises all Runs on a CHARMS-like template, ~3 model instances per article on average. Doc the command in quickstart.md.
- [ ] T071 [P] Add performance smoke tests in `backend/tests/integration/test_extraction_export_perf.py` covering three budgets (skip in CI; gated by `RUN_PERF_TESTS=1`):
  - **SC-001 (small project)**: 50 articles × 80 fields × ≤ 5 model instances per article → P50 ≤ 10 s, P95 ≤ 30 s, sync path taken.
  - **SC-002 (worst case)**: 500 articles × 100 fields × ~3 model instances → P95 ≤ 60 s, async path taken, file opens cleanly in `openpyxl.load_workbook`.
  - **SC-007 (AI-metadata budget)**: run the SC-002 scenario twice, once with `include_ai_metadata=False` and once with `True` (proposals seeded on ≥ 30 % of fields); assert the AI-enabled wall-clock is ≤ 1.20× the AI-disabled wall-clock.
- [ ] T072 [P] File a follow-up ticket (do not implement): Alembic migration adding nullable `edited_from_proposal_id` FK on `extraction_reviewer_decisions`, plus a CHECK relaxation. This upgrades the AI metadata sheet's `Reviewer outcome` from `(best-effort)` to exact. Out of V1 scope per spec FR-040.
- [ ] T073 [P] File a follow-up ticket: Celery beat task to delete `articles/exports/extraction/*.xlsx` objects older than 7 days. Out of V1 scope per research.md §2.
- [ ] T074 Run the manual test recipe from quickstart.md §4 end-to-end against a local stack (project member, manager, non-manager). Capture screenshots for the PR description.
- [ ] T075 Update `CHANGELOG.md` (if the project keeps one) and any relevant section of `docs/architecture/extraction-hitl-architecture.md` to mention the new read-side export path.
- [ ] T076 [P] Add `backend/tests/integration/test_extraction_export_determinism.py` covering SC-006: run the same export twice against unchanged DB state (no writes between invocations), strip the `Notes` sheet's `generated_at` line and the Content-Disposition filename's timestamp suffix, then assert the remaining workbook bytes are byte-identical (compare via SHA-256). Covers Consensus, Single-user, and All-users modes — three sub-tests. Confirms FR-026 (idempotent / no DB side-effects) and SC-006 (byte-identical re-run).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies — start immediately.
- **Phase 2 (Foundational)**: depends on Phase 1; **blocks all user-story phases**.
- **Phase 3 (US1, MVP)**: depends on Phase 2 only.
- **Phase 4 (US2)**: depends on Phase 2; independent of US1 (no shared mutable state) — can ship as MVP+1.
- **Phase 5 (US3)**: depends on Phase 2; reuses Single-user value resolution helpers from US2 (T048) but does not require US2 endpoint behaviour, so US3 can technically ship before US2 if Phase 4's helpers are merged into Phase 2 — keep as listed for clarity.
- **Phase 6 (Polish)**: depends on whichever user stories are scheduled for release.

### Critical-path within US1 (MVP)

```
T005 (schemas) ─┬─ T007 (layout dataclasses) ─ T009 (builder skeleton) ─ T025/T026 (cells/notes) ─ T029 (sync endpoint) ─ T035 (dialog submit) — MVP demo
T006 (repo)    ─┘                            ╲                                                  ╲
                                              T020 (resolve_layout) ──────────────────────────── T032 (Celery task body)
```

### Parallel opportunities

- **Phase 1**: T001 must finish before any backend import of openpyxl; T002, T003, T004 are all [P] with each other and with T001.
- **Phase 2**: backend (T005-T013) and frontend (T014-T019) are mutually independent — split between two contributors.
- **Phase 3**: within US1, the AI metadata sub-flow (T041-T046) is independent of the core consensus flow (T020-T040). Treat them as two parallel tracks once T020 lands.
- **Phase 4 & 5**: can run in parallel after Phase 2 if separate contributors; they touch overlapping service methods but in additive ways.
- **Phase 6**: all polish tasks are [P] with each other (different files).

### Tests-with-code policy

Per the project's "always test during implementation" memory: each implementation task is paired with a test task in the same checkpoint (e.g. T025 is followed by T027; T029 by T033). Do NOT defer all tests to a final phase.

---

## Parallel Example: kicking off US1 with two contributors

```bash
# Contributor A — backend resolver track
Task: "T020 implement resolve_layout consensus branch in extraction_export_service.py"
Task: "T021 _resolve_articles_for_consensus"
Task: "T022 _build_consensus_value_map (single bulk query)"

# Contributor B — frontend track (in parallel after T017/T018/T019 land)
Task: "T035 wire Export button to startExport()"
Task: "T036 live preview line"
Task: "T037 smart default for Articles-to-export"
```

---

## Implementation Strategy

### MVP first (US1 only — ship this)

1. Phase 1 (Setup) — ~1 hour.
2. Phase 2 (Foundational) — ~1 day for one contributor, or half a day with FE/BE in parallel.
3. Phase 3 (US1) — ~2 days; AI metadata sub-flow optional for MVP (tag T041-T046 as deferrable).
4. **Validate end-to-end via quickstart.md §4** on a real seeded project. Demo. Decide on US2/US3 timing.

### Incremental delivery

- After MVP → add US2 (P2) → demo → add US3 (P3) → demo.
- Each user-story phase ships independently because the dialog UI gracefully degrades when a mode is not yet implemented (the radio option can be temporarily hidden).

### Format validation

All tasks above conform to `- [ ] TNNN [P?] [Story?] Description with file path`. Setup, Foundational, and Polish tasks have no story label; all user-story tasks carry `[US1]`/`[US2]`/`[US3]`.

---

## Notes

- Task IDs T001–T075 are reserved sequentially in execution order; do not renumber when subdividing.
- "Tests-with-code" pairing: T010↔T009, T027↔T025/T026, T033/T034↔T028-T032, T039↔T035, T044↔T041-T043, T046↔T045, T052/T053↔T047-T051, T057↔T054-T056, T063/T064↔T058-T062.
- Avoid: mixing US2's reviewer picker into US1's dialog logic before US1 ships (keep the picker behind a `mode === 'single_user'` conditional); coupling US3's anonymize toggle to the value resolver before US3 lands.
- The constitution's split-migration rule means no Alembic or Supabase CLI migrations are touched by this feature. Any follow-up that does (T072) is filed as a separate spec.
