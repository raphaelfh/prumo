---
status: completed
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Finish the extraction data-path consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (same-session, fresh implementer per task + task review). Steps use checkbox
> (`- [ ]`) syntax for tracking.

> **STATUS — implementation complete & locally verified 2026-06-19 (pending merge to `dev`).**
> All three gaps shipped via subagent-driven-development (Tasks 1–9 + cleanup),
> each task spec+quality reviewed, plus a final whole-branch review (verdict:
> ready to merge). Verification: backend 44 targeted integration tests + the
> blind-filter/migration regression anchors green; frontend `npm run test:run`
> **552/552**; `make lint-backend` clean; `scripts/fitness/run_all.sh` all 8
> checks OK; `npm run generate:api-types` no drift; `npm run typecheck` clean.
> Zero `supabase` reads remain across the extraction run-open/run-resolution
> path. The broader app-schema API buildout (template/project/QA/article-admin
> services) remains the separate, out-of-scope effort.

**Goal:** Close the three remaining gaps of the extraction data-path
consolidation so the extraction run-open + run-resolution path reads/writes
through the typed API client only (ADR-0007), with **no** direct
`supabase.from(...)` PostgREST reads left in the extraction services/hooks on
that path:

- **(a)** Re-point `ExtractionValueService.findActiveRun` /
  `findLatestFinalizedRun` / `findFormRunsByArticle` and `AISuggestionService`
  off direct PostgREST onto new typed backend endpoints.
- **(b)** Phase 2 **Task 12**: serve `instances` (and the already-served
  `entity_types`) from the server `RunView`, source the run-open form from
  `runDetail` via adapters, and strip the direct `extraction_entity_types` +
  `extraction_instances` reads from `useExtractionData` (+ the
  `useModelManagement` double-read).
- **(c)** Route all run query-keys through the `runsKeys` factory.

**Scope boundary:** ONLY the extraction run-open / run-resolution path. The
~15 other service files (template/project/QA/article-admin/profile/zotero CRUD)
remain on PostgREST — that is the separate, larger app-schema API buildout, out
of scope here. No `supabase.auth`/`supabase.storage` usage is touched (ADR-0007
allow-list).

**No migration:** every new backend read uses existing tables/columns. Do NOT
create an Alembic migration.

**Tech Stack:** Backend FastAPI + SQLAlchemy 2.0 async + Pydantic v2, pytest
integration (local Supabase @ alembic head `0026`). Frontend React 18 + TS
strict + TanStack Query + vitest. Branch: `claude/strange-spence-9f6e39`
(worktree off `dev`). Verify: `cd backend && uv run pytest`, `make lint-backend`,
`npm run typecheck`, `npm run test:run`, `bash scripts/fitness/run_all.sh`.

---

## Global Constraints (the reviewer attention lens)

1. **ADR-0007 single read path.** New extraction-path reads go through
   `apiClient` (`frontend/integrations/api`). After the re-points, a
   multiline-aware grep of `extractionValueService.ts`, `aiSuggestionService.ts`,
   and `useExtractionData.ts` must show **zero** `supabase.from(`.
2. **Behavior parity.** Each re-point returns the **identical shape** the old
   Supabase read produced: `findActiveRun`/`findLatestFinalizedRun` → `RunRef |
   null` (`{id, stage, status, template_id}`); `findFormRunsByArticle` →
   `Map<articleId, runId>`; `AISuggestionService.loadSuggestions` →
   `{suggestions: Record<key,AISuggestion>, count}`; `getHistory` →
   `AISuggestionHistoryItem[]`. Do not change caller contracts.
3. **Caller-scoped suggestion status (blind).** The accepted/rejected status in
   `load_suggestions` is derived from the CALLER's own
   `extraction_reviewer_states` only (`reviewer_id == caller_id`). Never read or
   leak another reviewer's decisions. AI proposals (`source='ai'`) are shared
   (not blinded); only the *status overlay* is caller-scoped.
4. **BOLA on every new endpoint.** Article-scoped reads gate via
   `get_article_project_id(db, article_id)` → `ensure_project_member(db,
   project_id, user_sub)`; the batch endpoint gates on the body's `project_id`
   via `ensure_project_member`. Mirror the citations endpoint pattern.
5. **API contract types.** After backend endpoint/schema changes, run
   `npm run generate:api-types` and commit the diff (the `api-contract` CI job
   fails otherwise).
6. **React Compiler.** No `try/finally` or `throw`-inside-`try` in component/hook
   bodies. IO stays in `frontend/services/*`. `apiClient` throws `ApiError` on
   failure; service methods that currently throw keep throwing (preserve the
   existing contract — do not silently convert throw→ErrorResult here).
7. **TanStack keys from factories** (`runsKeys`); the key-factory fitness check
   (`scripts/fitness/check_react_query_keys.py`) must stay green.
8. **`instances` are NOT run-scoped.** `_instances_for_run` scopes by
   `(article_id, template_id)` — the canonical rule from
   `ExtractionExportService._load_instances_for_runs`. Do not import that method;
   replicate the scope.
9. **`metadata` wire key.** The `ExtractionInstance` ORM attr is `metadata_`
   (DB/wire column `metadata`). `RunViewInstance` must serialize JSON key
   `metadata` (validation_alias `metadata_`), asserted by a test.

---

## Reference designs (verified against the code 2026-06-19)

- BOLA helpers: `ensure_project_member(db, project_id, user_sub)` in
  `app/api/deps/security.py`; `get_article_project_id(db, article_id)` in
  `app/services/citation_read_service.py`. Endpoint template: `get_run` in
  `app/api/v1/endpoints/extraction_runs.py` (DbSession dep,
  `get_current_user_sub`, `ApiResponse.success(..., trace_id=_trace(request))`).
- `RunSummaryResponse` (already exists) carries `id, project_id, article_id,
  template_id, kind, version_id, stage, status, ... created_at, created_by` and
  has `from_attributes=True`.
- ORM: `ExtractionRun` (run repo `app/repositories/extraction_run_repository.py`
  has `get_by_article`/`get_latest_by_article` as structural references — none
  cover kind+template+multi-stage, so add new service methods).
  `ExtractionProposalRecord`/`ExtractionReviewerState`/`ExtractionReviewerDecision`
  in `app/models/extraction_workflow.py`; `ExtractionEvidence`/`ExtractionInstance`
  in `app/models/extraction.py` (`ExtractionInstance.metadata_` → column
  `"metadata"`; all RunViewInstance fields exist on the ORM).
- `build_run_view(db, run_id, *, caller_id, can_see_peers)` in
  `app/services/extraction_run_read_service.py` builds `RunViewResponse(...)`; it
  is called by BOTH `GET /runs/{id}/view` (extraction_runs.py) and the session
  embed (hitl_sessions.py:89) — adding `instances` flows to both.
- apiClient: `apiClient<T>(endpoint, options?)` returns the UNWRAPPED `data` (type
  `T`), throws `ApiError` (from `@/integrations/api`) on `ok:false`/non-2xx
  (reads `error.message`). GET query params are built inline into the path
  string. Import `{ apiClient }` from `@/integrations/api`.
- `runsKeys` lives in `frontend/hooks/runs/types.ts` (`all`, `detail`). Inline
  literals to fold in: `["runs","disabled"]` (useRun:22),
  `["runs", runId, "reviewers"]` + `["runs","no-run","reviewers"]`
  (useRunReviewers:38,47). These are NOT a current CI failure (ternary form
  hides them from the regex) — this is centralization, not a forced fix.
- Hazard audit (ExtractionFullScreen): the 6 `refreshInstances()` sites
  (144, 516, 538, 584, 692, 728, 958) are all fire-and-forget — NONE reads the
  `instances` array synchronously after the await. `handleFinalize` reads
  `instances.map(i=>i.id)` (805) but NOT after a refresh in the same flow. So
  deriving `instances` from a `useMemo(()=>instancesFromRunView(runDetail))` and
  replacing `refreshInstances()`→`refetchRun()` is safe. The implementer MUST
  re-confirm no refresh-then-synchronous-read site exists before relying on this.

---

## Tasks

### Task 1 — [BE] Run-resolution service + `/articles` endpoints (gap a, part 1)

Replace `findActiveRun` / `findLatestFinalizedRun` / `findFormRunsByArticle`'s
PostgREST queries with server endpoints.

**Files:**
- Modify: `backend/app/services/extraction_run_read_service.py` —
  `find_active_run(db, article_id, *, template_id=None) -> RunSummaryResponse |
  None`, `find_finalized_run(db, article_id, *, template_id=None) ->
  RunSummaryResponse | None`, `resolve_form_runs(db, article_ids, *,
  template_id) -> list[ArticleRunRef]`.
- Modify: `backend/app/schemas/extraction_run.py` — `ArticleRunRef {article_id:
  UUID, run_id: UUID | None}`, `FormRunsRequest {article_ids: list[UUID],
  template_id: UUID, project_id: UUID}`.
- Create: `backend/app/api/v1/endpoints/articles.py` — router with
  `GET /{article_id}/active-run?template_id=`,
  `GET /{article_id}/finalized-run?template_id=`,
  `POST /form-runs` (body `FormRunsRequest`).
- Modify: `backend/app/api/v1/router.py` — register `articles.router` under
  `/articles` (a citations router is already under `/articles`; FastAPI merges).
- Test: `backend/tests/integration/test_run_resolution_endpoints.py` (new).

Resolution semantics (parity with current frontend):
- active: `kind='extraction'`, `stage IN (pending,proposal,review,consensus)`,
  optional `template_id`, latest `created_at`.
- finalized: same with `stage='finalized'`.
- form-runs (batch): per article, latest non-terminal run; else latest
  finalized; cancelled excluded. (Mirror `findFormRunsByArticle`'s scan.)

- [ ] **Step 1 (RED):** Write `test_run_resolution_endpoints.py` — seed (or reuse
  a seeded) extraction run, assert: `GET /api/v1/articles/{aid}/active-run`
  returns the active run (200, `data.id`), `finalized-run` returns null/empty when
  none, `POST /api/v1/articles/form-runs` returns one `{article_id, run_id}` per
  input article, and a non-member caller gets **403** on each. Run; expect
  failures (routes/methods absent).
- [ ] **Step 2 (GREEN):** Implement the service methods + schemas + endpoints +
  router registration. Gate each via the BOLA helpers (Constraint 4). Endpoints
  return `ApiResponse.success(...)`.
- [ ] **Step 3:** `cd backend && uv run pytest
  tests/integration/test_run_resolution_endpoints.py -v` — PASS.
- [ ] **Step 4:** `make lint-backend` for the touched files — clean.
- [ ] **Step 5: Commit** `feat(api): article-scoped run-resolution endpoints (active/finalized/form-runs)`.

### Task 2 — [BE] AI-suggestion read service + `/articles` endpoints (gap a, part 2)

**Files:**
- Create: `backend/app/services/extraction_suggestion_read_service.py` —
  `get_article_instance_ids(db, article_id) -> list[UUID]`;
  `load_suggestions(db, instance_ids, *, caller_id, run_id=None) ->
  AISuggestionsResponse` (proposals `source='ai'` for the instances/run, evidence
  joined by `proposal_record_id`, per-coord status from the CALLER's
  `reviewer_states`→`reviewer_decisions.decision`, latest-per-`(instance,field)`);
  `get_suggestion_history(db, instance_id, field_id, *, limit=10) ->
  list[AISuggestionHistoryItem]`.
- Modify: `backend/app/schemas/` (new module `extraction_suggestion.py` or add to
  `extraction_run.py`) — `EvidenceResponse {proposal_record_id, text_content,
  page_number}`, `AISuggestionItem {id, run_id, instance_id, field_id,
  proposed_value, confidence_score, rationale, created_at, evidence, status}`,
  `AISuggestionsResponse {suggestions: list[AISuggestionItem], count}`,
  `AISuggestionHistoryItem` (same item shape minus status).
- Modify: `backend/app/api/v1/endpoints/articles.py` —
  `GET /{article_id}/instance-ids`,
  `GET /{article_id}/suggestions?instance_ids=&run_id=`,
  `GET /{article_id}/suggestions/history?instance_id=&field_id=&limit=`.
- Test: `backend/tests/integration/test_suggestion_read.py` (new).

- [ ] **Step 1 (RED):** Write `test_suggestion_read.py` — using the two-reviewer
  helper (`tests/integration/test_blind_review_isolation._build_two_reviewer_review_run`
  or the seed graph): assert `load_suggestions` returns AI proposals with
  `status` resolved from the CALLER's reviewer_state (and that reviewer A's
  status overlay never reflects reviewer B's decisions — caller scope);
  `instance-ids` returns the article's instances; `suggestions/history` returns
  AI proposals for a coord. Endpoint tests: 200 + 403 BOLA. Run; expect failures.
- [ ] **Step 2 (GREEN):** Implement the service + schemas + endpoints. The status
  overlay reads ONLY `reviewer_states.reviewer_id == caller_id` (Constraint 3).
- [ ] **Step 3:** `cd backend && uv run pytest tests/integration/test_suggestion_read.py -v` — PASS.
- [ ] **Step 4:** `make lint-backend` touched files — clean.
- [ ] **Step 5: Commit** `feat(api): caller-scoped AI-suggestion read endpoints`.

### Task 3 — [BE] `instances` on the RunView (gap b backend / Phase 2 Task 12 step 0)

**Files:**
- Modify: `backend/app/schemas/extraction_run.py` — `RunViewInstance` (fields:
  `id, entity_type_id, parent_instance_id, label, sort_order, status, metadata,
  project_id, article_id, template_id, created_by, created_at, updated_at`;
  `ConfigDict(from_attributes=True, populate_by_name=True)`; `metadata` field via
  `validation_alias="metadata_"` so JSON emits `metadata`). Add
  `instances: list[RunViewInstance]` to `RunViewResponse`.
- Modify: `backend/app/services/extraction_run_read_service.py` —
  `_instances_for_run(db, run: RunSummaryResponse) -> list[RunViewInstance]`
  (select `ExtractionInstance` where `article_id == run.article_id AND
  template_id == run.template_id`, order by `(entity_type_id, sort_order)`,
  `model_validate`); call it in `build_run_view` and add `instances=` to the
  `RunViewResponse(...)`.
- Test: extend `test_build_run_view.py` (instances present + scoped),
  `test_run_view_endpoint.py` (`data.instances` present + `metadata` wire key),
  `test_hitl_session_embeds_run_view.py` (embed carries instances).

- [ ] **Step 1 (RED):** Extend the three tests to assert `instances` is present on
  `build_run_view`, on `GET /runs/{id}/view` (`data["instances"]`), and on the
  session embed — plus one assertion that an instance dict has key `"metadata"`
  (not `"metadata_"`). Run; expect failures.
- [ ] **Step 2 (GREEN):** Add the schema + `_instances_for_run` + wire into
  `build_run_view`. (Mirror the `metadata_` handling of any existing schema; else
  use `validation_alias`.)
- [ ] **Step 3:** `cd backend && uv run pytest
  tests/integration/test_build_run_view.py tests/integration/test_run_view_endpoint.py
  tests/integration/test_hitl_session_embeds_run_view.py -v` — PASS.
- [ ] **Step 4:** `make lint-backend` touched files — clean.
- [ ] **Step 5: Commit** `feat(extraction): serve instances from build_run_view (Task 12 step 0)`.

### Task 4 — [FE] Regenerate API types + frontend response types

**Files:**
- Modify: `frontend/types/api/{openapi.json,schema.d.ts}` (generated).
- Modify: `frontend/hooks/runs/types.ts` — add `RunViewInstanceResponse` and
  `instances: RunViewInstanceResponse[]` to `RunViewResponse` (remove the
  Task-12-deferred comment). Add a `RunRefResponse` (`{id, stage, status,
  template_id}`) + `ArticleRunRef` (`{article_id, run_id: string|null}`) if not
  already exported, for the service re-points.

- [ ] **Step 1:** `npm run generate:api-types`.
- [ ] **Step 2:** Add the hand-mirrored run/instance types above.
- [ ] **Step 3:** `npm run typecheck` — clean.
- [ ] **Step 4: Commit** `chore(api-types): regenerate for run-resolution + suggestions + RunViewInstance`.

### Task 5 — [FE] Re-point `extractionValueService` run-resolution (gap a)

**Files:**
- Modify: `frontend/services/extractionValueService.ts` — `findActiveRun`,
  `findLatestFinalizedRun`, `findFormRunsByArticle` call `apiClient` against the
  Task-1 endpoints; drop the `supabase` import if it becomes unused (the
  decisions writes already use apiClient). Preserve return shapes + the
  `kind='extraction'` semantics (now server-side).
- Test: `frontend/test/...` for this service (mock `@/integrations/api`'s
  `apiClient`; assert path + parity shapes + that `supabase.from` is not called).

- [ ] **Step 1 (RED):** Write/extend the service test to assert each method hits
  the right endpoint path and maps the response to the existing return shape
  (`RunRef|null`, `Map`). Run; expect failure (still PostgREST).
- [ ] **Step 2 (GREEN):** Re-point onto `apiClient`. `findFormRunsByArticle` POSTs
  `{article_ids, template_id, project_id}` — note: it needs `project_id`; thread
  it from the caller (check the call site; if the current signature lacks it,
  add a `projectId` param and update callers minimally).
- [ ] **Step 3:** `npm run test:run -- <this test>` — PASS.
- [ ] **Step 4:** `npm run typecheck` + eslint touched files — clean.
- [ ] **Step 5: Commit** `refactor(extraction): run-resolution reads via typed API client`.

### Task 6 — [FE] Re-point `aiSuggestionService` (gap a)

**Files:**
- Modify: `frontend/services/aiSuggestionService.ts` — `loadSuggestions`,
  `getHistory`, `getArticleInstanceIds` call the Task-2 endpoints; drop the
  `supabase` import + the `supabase.auth.getUser()` (status is now server-derived
  caller-scoped). Preserve the `AISuggestion`/`AISuggestionHistoryItem` shapes
  and `getSuggestionKey` mapping.
- Test: the `aiSuggestionService`/`useAISuggestions` test (mock apiClient).

- [ ] **Step 1 (RED):** Test asserts `loadSuggestions` maps the server response to
  the `{suggestions, count}` shape with statuses, `getHistory` returns the list,
  no `supabase.from`/`supabase.auth` calls. Run; expect failure.
- [ ] **Step 2 (GREEN):** Re-point onto `apiClient`.
- [ ] **Step 3:** `npm run test:run -- <this test>` — PASS.
- [ ] **Step 4:** `npm run typecheck` + eslint — clean.
- [ ] **Step 5: Commit** `refactor(extraction): AI-suggestion reads via typed API client`.

### Task 7 — [FE] `runViewAdapters.ts` (gap b)

**Files:**
- Create: `frontend/lib/extraction/runViewAdapters.ts` —
  `entityTypesFromRunView(view) -> ExtractionEntityTypeWithFields[]` (inject
  `template_id: view.run.template_id`; `created_at` placeholder `view.run.created_at`;
  cast `cardinality`/`role`/`allowed_values`/`allowed_units`/`validation_schema`),
  `instancesFromRunView(view) -> ExtractionInstance[]` (straight map from
  `view.instances`; `label ?? ''`).
- Test: `frontend/test/lib/runViewAdapters.test.ts` (new) — shape parity, the
  injected `template_id`, empty inputs.

- [ ] **Step 1 (RED):** Write the adapter unit tests. Run; expect failure (module
  absent).
- [ ] **Step 2 (GREEN):** Implement the adapters.
- [ ] **Step 3:** `npm run test:run -- frontend/test/lib/runViewAdapters.test.ts` — PASS.
- [ ] **Step 4:** `npm run typecheck` + eslint — clean.
- [ ] **Step 5: Commit** `feat(extraction): runViewAdapters map the view onto form types`.

### Task 8 — [FE] Source the form from the view; strip direct reads (gap b)

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx` — derive `entityTypes`/
  `instances` via `useMemo(()=>adapter(runDetail))`; replace every
  `refreshInstances()` with `refetchRun()`; pass a `modelInstances` derived prop
  to `useModelManagement`. Stop destructuring `entityTypes`/`instances`/
  `refreshInstances` from `useExtractionData`.
- Modify: `frontend/hooks/extraction/useModelManagement.ts` — accept optional
  `modelInstances`; when provided, skip `loadModelInstances` (drop that
  `supabase.from('extraction_instances')` read); keep the `calculate_model_progress`
  RPC.
- Modify: `frontend/hooks/extraction/useExtractionData.ts` — remove the
  `extraction_entity_types` + `extraction_instances` reads (`loadEntityTypesWithFields`,
  `loadInstances`, `refreshInstances`, `mergeInstancesById`); keep
  article/project/template/articles. Re-point any other consumer of the removed
  exports (`grep -rn useExtractionData frontend/`).
- Test: extend the ExtractionFullScreen / useExtractionData / useModelManagement
  tests to cover the view-sourced render + the model-instances prop path.

- [ ] **Step 1:** Re-confirm no refresh-then-synchronous-read site exists (re-grep
  `instances`/`refreshInstances` in ExtractionFullScreen). If any exists, convert
  it to refetch-and-derive (`const {data}=await refetchRun(); const fresh=
  instancesFromRunView(data); ...`).
- [ ] **Step 2 (RED→GREEN):** Update tests, then make the edits. Frozen-snapshot
  `entity_types` now drive rendering (verify study/model partition still works via
  `role`).
- [ ] **Step 3:** `npm run test:run` for the touched suites — PASS.
- [ ] **Step 4:** `npm run typecheck` + eslint — clean. Confirm a multiline grep
  shows `useExtractionData.ts` has **no** `supabase.from`.
- [ ] **Step 5: Commit** `feat(extraction): run-open form sources entity_types+instances from the view`.

### Task 9 — [FE] Route run query-keys through the factory (gap c)

**Files:**
- Modify: `frontend/hooks/runs/types.ts` — add `reviewers: (runId) => ["runs",
  runId, "reviewers"]`, `disabled: ["runs","disabled"]`, `noRunReviewers:
  ["runs","no-run","reviewers"]` to `runsKeys`.
- Modify: `frontend/hooks/runs/useRun.ts` (use `runsKeys.disabled`),
  `frontend/hooks/runs/useRunReviewers.ts` (drop local `reviewersKey`; use
  `runsKeys.reviewers` / `runsKeys.noRunReviewers`).
- Test: extend `frontend/test/hooks-runs.test.tsx` / reviewers test as needed.

- [ ] **Step 1 (RED):** Assert `useRunReviewers` uses `runsKeys.reviewers(runId)`
  and `useRun`'s disabled key comes from the factory. Run; expect failure.
- [ ] **Step 2 (GREEN):** Add the factory entries + route consumers.
- [ ] **Step 3:** `npm run test:run -- <these tests>` — PASS.
- [ ] **Step 4:** `python3 scripts/fitness/check_react_query_keys.py` — green;
  `npm run typecheck` + eslint — clean.
- [ ] **Step 5: Commit** `refactor(runs): all run query-keys come from the runsKeys factory`.

### Task 10 — [VERIFY] Full sweep + plan registration

- [ ] **Step 1:** `npm run generate:api-types` — confirm no further diff (drift gate).
- [ ] **Step 2:** `cd backend && uv run pytest tests/integration/test_run_resolution_endpoints.py
  test_suggestion_read.py test_build_run_view.py test_run_view_endpoint.py
  test_hitl_session_embeds_run_view.py test_run_read_blind_filter.py
  test_migration_roundtrip.py -v` — PASS. `make lint-backend` — clean.
- [ ] **Step 3:** `npm run typecheck && npm run test:run` — clean/green.
- [ ] **Step 4:** `bash scripts/fitness/run_all.sh` — all checks OK.
- [ ] **Step 5:** Multiline-aware audit: `rg -U "supabase\s*\.?\s*\n?\s*\.from\("
  frontend/services/extractionValueService.ts frontend/services/aiSuggestionService.ts
  frontend/hooks/extraction/useExtractionData.ts` returns **nothing**.
- [ ] **Step 6:** Add this plan doc to `.markdownlintignore`; flip frontmatter
  `status: shipped` with a verification note. Commit.

---

## Self-Review

- **Spec coverage:** (a) Tasks 1–2 (BE endpoints) + 5–6 (FE re-points); (b)
  Tasks 3 (BE instances) + 7–8 (FE adapters/strip); (c) Task 9. ✓
- **No migration** (all reads use existing columns); no `supabase.auth`/`storage`
  touched (ADR-0007 allow-list). ✓
- **Blind/BOLA:** suggestion status caller-scoped (Constraint 3); every new
  endpoint membership-gated (Constraint 4). ✓
- **Parity:** re-points preserve return shapes (Constraint 2); Task 8 relies on
  the verified zero-Hazard-1 audit (re-confirmed in Task 8 Step 1). ✓
- **Out of scope:** the broader app-schema API buildout + the ADR-0007 enforcing
  fitness function (would flag the out-of-scope services) are NOT in this plan.
