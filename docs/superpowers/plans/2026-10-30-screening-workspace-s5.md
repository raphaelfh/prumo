---
status: draft
last_reviewed: 2026-11-01
owner: '@raphaelfh'
---

# Screening workspace S5 — Articles "Screening" column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every row of the Articles list shows where its article stands in screening — Not enrolled, a title/abstract status, a full-text status, Included, Excluded or Duplicate — as one small chip in a "Screening" column.

**Architecture:** The S1 records read (`GET /projects/{id}/screening/records`) makes `phase` optional. Without it, it returns one row per project article: the title/abstract row (incl. not-enrolled), replaced by the full-text row when one exists, plus the ids of removed duplicates. Rows are built by the phased code path on each phase's own snapshots, so the blind rules hold unchanged. On the frontend one shared query feeds a per-row `ArticleScreeningChip`; `ArticlesList.tsx` gets only the column wiring.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Pydantic v2, pytest on real Postgres; React 19 (React Compiler) + TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-30-screening-workspace-design.md` — slice S5 only: §3 R5, §4.3 (vocabulary; "a removed duplicate … in S5, on the Articles list as 'Duplicate'"), §5 ("S5 makes `phase` optional"), §9 "S5 detail", S5 gates (= the S1 set), S5 acceptance row, "all | Design" row. **Base:** S1 + S2 + S3 merged on `dev` (symbols named per their plans: `docs/superpowers/plans/2026-10-30-screening-workspace-s1.md` and `-s3.md` in this tree, `-s2.md`; Phase B re-checks this plan against the merged code before any task starts).

**Scope:** 4 tasks, one PR to `dev`, title `feat(screening): screening stage column on the Articles list`. No migration.

## Task graph

| Task | Depends on | Parallel group |
| --- | --- | --- |
| 1 No-phase records read (backend) | S1+S2+S3 merged | G1 |
| 2 Stage vocabulary + data hook (frontend) | 1 (generated types) | G2 |
| 3 `ArticleScreeningChip` + ArticlesList column (frontend) | 2 | G3 |
| 4 Slice verification + design review | 1–3 | G4 |

Sequential: Task 2 consumes Task 1's regenerated `schema.d.ts`; Task 3 consumes Task 2's hook and pure function.

## Global Constraints

- **Worktree.** `WT=/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/screening-workspace-s5` (branch `screening-workspace-s5`). Every command uses absolute paths or `git -C "$WT"`; never touch the main checkout, never `git switch`/`checkout`, never bare `git stash`. After each task `git -C "$WT" status --short` shows only that task's files.
- **Precondition (S1+S2+S3 merged).** `grep -q "def records" "$WT/backend/app/services/screening_review_service.py" && grep -rqE "def removed_duplicate\(" "$WT/backend/app/repositories/" && grep -q "full_text" "$WT/backend/app/schemas/screening.py"`. If any fails, stop and report `status: blocked`. (S2's predicate module is `duplicate_predicates.py` in S2's plan, `duplicate_repository.py` in spec §8.3 — import it from wherever S2 put it.)
- **English only** — code, comments, commits, copy keys and copy.
- **No migration, no write path.** Read-only slice (constitution §VI). `alembic check` is not in the S5 gate set and must stay untouched.
- **Ownership (BOLA).** The route keeps `require_project_scope`; every new query carries the project predicate in its WHERE clause. Gate: `check_scope_guards.py`.
- **Blind review.** The no-phase read reuses the phased row builder (`_record_row`) with each phase's own `assignment_states(phase=…)` snapshots and `reviewer_count_of(settings, phase)` count. No row merges TA and FT decisions; `my_decision`/`my_exclusion_reason` come from the row's own phase. No peer id, name or pre-outcome reason in any payload.
- **Envelope / errors.** `ApiResponse.success(model, trace_id=…)`; unconfigured → 409 `SCREENING_NOT_CONFIGURED` (unchanged, with or without `phase`); bad `phase` → 422. Keep the route's `responses={409: …}`.
- **Generated types.** After the schema/route edit: `cd "$WT" && npm run generate:api-types`; commit `frontend/types/api/openapi.json` + `schema.d.ts`. Never hand-edit. Only Task 1 regenerates.
- **Frontend data path.** component → hook (`frontend/hooks/screening/`) → `services/screeningService.ts` → `apiClient`; keys only from `lib/query-keys/screening.ts`; copy through `t('screening', key)`. Gates: `check_react_query_keys.py`, `check_frontend_data_path.py`, `check_copy_keys.py`.
- **React Compiler** (`panicThreshold: 'all_errors'`): no ref read/write during render; no `try/finally` in a component/hook body.
- **Errors are logged, not swallowed.** `toResult` (`frontend/lib/error-utils.ts:57-65`) already logs every failed service call with its context; the chip's blank cell on error is a UI choice on top of that log, not a silent drop.
- **File size.** `ArticlesList.tsx` baseline 1,335 (`scripts/fitness/check_file_size.baseline`); measure `wc -l` on the merged tree before Task 3 — the wiring must fit the headroom (18 lines on S1's tip). `check_file_size.py` exits 0. No `<Button>` with an `h-*` class in ArticlesList (`check_button_scale`).
- **Post-edit hook** strips unused imports: add an import in the same edit as its first use.
- **No dead code.** `npm run deadcode` and `npm run deadcode:production` at zero after Task 3 (Task 2 may leave the hook unused until Task 3; note it in the task report); vulture green (`cd "$WT/backend" && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`).
- **Commands.** Frontend from `$WT` (never `cd frontend`): `npm run test:run -- <paths>`, `npm run typecheck`, `npm run lint`, `npm run deadcode`, `npm run deadcode:production`, `npm run generate:api-types`. No `npx` on PATH → `~/.local/bin/mise exec node@24 -- <cmd>`. No `node_modules` → `npm ci` (never a symlink). Backend: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_records.py -x -q`; `make -C "$WT" lint-backend`. Fitness: `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/<check>.py`.
- **Backend integration DB (port 55435, this slice's).** `docker run -d --name prumo-s5-pg -p 55435:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:17` (reuse if running); `CREATE DATABASE postgres_test_s5`; `$WT/backend/.env` with fake values only (`DATABASE_URL=postgresql://postgres:postgres@localhost:55435/postgres_test_s5`, `SUPABASE_URL=http://localhost:54321`, `SUPABASE_SERVICE_ROLE_KEY=stub-service-role`, `SUPABASE_ENV=local`, `OPENAI_API_KEY=sk-test-not-real`); from `$WT/backend`: `uv sync --frozen --extra dev`, `psql postgresql://postgres:postgres@localhost:55435/postgres_test_s5 -f tests/integration/supabase_stub.sql`, `uv run alembic upgrade head`, `uv run python -m app.seed`. Never `make db-fresh`/`reset-db`. `docker` may need the unsandboxed retry.
- **Commits:** conventional, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Report file.** Each seat writes `$WT/.superpowers/sdd/2026-10-30-screening-workspace-s5/reports/task-N.md` FIRST and appends as it goes.

## Review Focus

1. **A reviewer with a TA decision on an article now in full text.** The chip shows the FT status from FT snapshots; the TA decision never leaks into the FT row's `my_decision` — Task 1 `test_no_phase_rows_use_each_phase_snapshot`.
2. **A full-text reason conflict seen from the Articles list.** Non-arbitrators read `waiting`/`in_review`, never `conflict`, and no peer reason appears — Task 1 `test_no_phase_role_matrix_full_text`.
3. **5,000 articles.** One request for the whole list, not one per row; rows mounting later (filter, sort) do not refetch inside the stale window — Task 2 `fetches once for many chips`.
4. **Screening not configured / the read fails.** The Articles list renders normally, the cell is empty, no request is sent while unconfigured, no toast — Task 3 `renders nothing when screening is not configured`, `renders nothing on a records error`.
5. **An article imported a second ago** (absent from the cached payload). Its cell is empty (not "Not enrolled") until the invalidation refetch lands — Task 3 `renders nothing for an article absent from the read`.

## Rulings (from the spec gate; full ledger `$WT/.superpowers/sdd/2026-10-30-screening-workspace-s5/progress.md`)

1. Same endpoint, `phase` optional (§5). No-phase read = one row per article in TA queue order; the FT row replaces the TA row when full text is on (`reviewer_count_of(settings, FULL_TEXT) is not None`); top-level `phase: null`, `reviewer_count` = TA count.
2. Row gains `phase: ScreeningPhase` on every read (explicit stage; no inference from `ta_reviewer_count`).
3. Duplicates: `ScreeningRecordsRead.removed_duplicate_ids: list[UUID]` — empty on phased reads; on the no-phase read, the project's articles matching S2's `removed_duplicate(Article)`. Not a new status value, so S1/S3's exhaustive status maps stay untouched. Visible to every member (a manager verdict, not a peer decision).
4. Chip precedence: Duplicate > FT row > TA row > absent. Labels in Task 2's table.
5. Hook in `frontend/hooks/screening/` (constitution File Locations); "its own component" = outside ArticlesList.
6. One shared query keyed `screeningKeys.records(projectId)` (spec §5: the phase-less key drops the trailing element; S1 already defines it and pins it as the prefix of both phase keys), per-row chip reading a `Map` built once per fetch inside `queryFn`; `staleTime: 30_000`, `retry: false`, `structuralSharing: false`. Config gate through `screeningConfigQueryOptions` (no per-row `refetchOnMount: 'always'`). Nothing may `setQueriesData`/`getQueriesData` on the `records(projectId)` prefix (it would match two payload shapes) — none does today.
8. A failed or not-yet-loaded read leaves the cell blank (no toast, no `ErrorState`): the Articles list is not a screening view (§4.6 covers the screening sub-views), and the failure is logged by `toResult`.
7. Column `screening`, default visible, `md` breakpoint, width 150, no sort/filter, table view only (the narrow card view is unchanged). No E2E (spec names none).


**Phase B re-check (merged dev 2be83eb9, 2026-11-01):** route `phase` param moves last; shared `remove_duplicate` test helper; FT-on idiom `_reviewer_count(…, FULL_TEXT)`; co-located test paths; prefixes reuse `tabTitleAbstract`/`tabFullText`; `RECORD_CSV_COLUMNS` excludes `phase`; cell snippet corrected; fixture list named. ArticlesList headroom 18 (1,317/1,335).

**Panel round (ship-panel, 2026-11-01: 0 blocking, 0 unverified, 1 refuted, 13 advisory).** Refuted: "no invalidation reaches the stages query" — S1's `invalidateScreening` call sites (article create/edit/delete, RIS/Zotero/PubMed import) invalidate `project(projectId)`, which prefixes the hook's key. Advisories taken: `TABLE_COLUMNS` entry shape (`id` + `visibleKey`); key = S1's `records(projectId)` (not a new `stages` key); lookup built in `queryFn` (no module WeakMap); cross-project duplicate test; scope-convention parametrize; no-phase `queue_rank` re-ranked; hook test for `fullTextOn`; `useScreeningConfig` keeps `refetchOnMount: 'always'`; predicate located by `grep`, not file path; snapshot note in the docstring; blank-on-error ruled (logged by `toResult`). Declined: drop the `__wrapped__` handler test (project convention); reuse TA snapshots in the FT pass (one extra indexed query; not worth a new parameter).

---

### Task 1: No-phase records read (backend)

**Files:**
- Modify: `backend/app/api/v1/endpoints/screening.py` (`get_screening_records`)
- Modify: `backend/app/schemas/screening.py` (`ScreeningRecordRow`, `ScreeningRecordsRead`)
- Modify: `backend/app/services/screening_review_service.py` (`records`, `_record_row`)
- Modify: `backend/app/repositories/screening_repository.py` (new `removed_duplicate_ids`)
- Test: `backend/tests/integration/test_screening_records.py`, `backend/tests/unit/test_screening_records_unit.py`, `backend/tests/unit/test_screening_review_unit.py` (scope parametrize)
- Modify: `backend/tests/integration/helpers/screening_fixtures.py` (new shared `remove_duplicate` helper)
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`; Modify: frontend fixtures that build `ScreeningRecordRow`/`ScreeningRecordsRead` literally (add `phase` to each `ScreeningRecordRow` literal and `removed_duplicate_ids: []` to each `ScreeningRecordsRead` literal: `frontend/components/screening/__tests__/` screeningWorkspace.fixtures.tsx, ScreeningRecordPanel.test.tsx, ScreeningRecordList.scale.test.tsx, ScreeningRecordTable.narrow.test.tsx, ScreeningRecordList.window.test.tsx, FullTextRecordView.test.tsx, FullTextWorkspace.test.tsx, ScreeningTab.test.tsx, ScreeningRecordList.test.tsx, AssignmentView.test.tsx; `frontend/hooks/screening/__tests__/` useScreeningRecords.test.tsx, useScreeningMutations.test.tsx; `frontend/lib/screening/records.test.ts`), the `RECORD_CSV_COLUMNS` doc comment in `frontend/lib/screening/records.ts` ("the §5 row fields in wire order, except `phase`" — a phase export needs no phase column; its 20-name test stays), and any TS `ScreeningPhase` derived from `ScreeningRecordsRead['phase']` → derive from `ScreeningRecordRow['phase']` (`lib/query-keys/screening.ts`, `services/screeningService.ts`).

**Interfaces:**
- Consumes (S1/S2/S3, merged): `assignment_states(db, *, project_id, phase, reviewer_count, assignment_ids=None)` (service :130), `self._reviewer_count(project_id, phase)` (:299; FT on ⇔ `await self._reviewer_count(project_id, FULL_TEXT) is not None`), `_title_abstract_outcomes` (:337, the FT path's `ta_*` source), `_record_row(rank, source, snapshot, viewer_id, roles, ta=None)` (:241), `ScreeningRepository.record_rows(*, project_id, phase)` (:275, already excludes removed duplicates), `removed_duplicate(Article)` (`app/repositories/duplicate_predicates.py:17`, takes the class/alias; already imported in `screening_repository.py:33`), constants `TITLE_ABSTRACT`/`FULL_TEXT` (`app/models/screening.py:33-34`). Repository neighbours to copy the shape of: `count_removed` (:143), `removed_among` (:152).
- Produces:
  - `GET /api/v1/projects/{project_id}/screening/records` with `phase: Annotated[ScreeningPhase | None, Query()] = None` placed **last** in the signature (after `user_sub`; `db` has no default, so it cannot stay in its current slot).
  - `remove_duplicate(db, project_id, article_id, kept_article_id) -> None` in `tests/integration/helpers/screening_fixtures.py` — adds an `ArticleDuplicateVerdict(verdict="duplicate", basis="manual", decided_by=MANAGER, …)` and flushes (same as the private `_verdict` in `test_screening_removal.py:55`; those private copies are left as they are).
  - `ScreeningRecordRow.phase: ScreeningPhase` (21 wire fields after S3's 20).
  - `ScreeningRecordsRead.phase: ScreeningPhase | None`, `ScreeningRecordsRead.removed_duplicate_ids: list[UUID]`.
  - `ScreeningReviewService.records(project_id, viewer_id, phase: ScreeningPhase | None)`.
  - `ScreeningRepository.removed_duplicate_ids(*, project_id: UUID) -> list[UUID]`.
  - No-phase `queue_rank` = 0-based position in the merged list (re-ranked after the merge; documented on the field).

- [ ] **Step 1: Write the failing tests** in `test_screening_records.py`:
  - Parametrize S1's `test_records_role_matrix` with `@pytest.mark.parametrize("query", ["?phase=title_abstract", ""], ids=["ta", "no_phase"])`, passing `query` to every `_path(...)`/`_records(...)` call (give `_records` a `query` parameter). The expectations are unchanged (full text off ⇒ the no-phase rows equal the TA rows); add `assert data["removed_duplicate_ids"] == []` and every row `phase == "title_abstract"`. `_WIRE_FIELDS` gains `"phase"`.
  - `test_no_phase_role_matrix_full_text` — reuse S3's `test_full_text_records_role_matrix` setup (:351-361: `_ft_project`, members a/b/c/k/v, 4 articles, `_ft_enroll`, 5 decisions; extract it into `_full_text_matrix_fixture(db)` returning the ids, used by both tests; the FT articles have no TA assignment, so their FT row replaces a `not_enrolled` TA row) plus one TA-only article T (A include, rc 2, undecided by B) and one not-enrolled article N. Call with no phase. Per caller, F1–F4 rows have `phase == "full_text"` and the same statuses S3 asserts; T has `phase == "title_abstract"` and the TA status (A: `waiting`; C: `to_screen`; K/MANAGER: `to_screen`; V: `in_review`); N is `not_enrolled`; each article appears once (`len(rows) == len({r["article_id"] for r in rows})`); no other member id, no "Screening Test User" (new assertions — S3's FT matrix has neither), and for A and C no "Wrong outcome" anywhere in `response.text`.
  - `test_no_phase_rows_use_each_phase_snapshot` — article X: TA decided include by A and B (consensus), FT enrolled, FT undecided. No-phase as A → X row `phase == "full_text"`, `status == "to_screen"`, `my_decision is None`, `ta_outcome == "include"`.
  - `test_no_phase_lists_removed_duplicates` — a pair with S2's verdict removing D (`remove_duplicate(db, project_id, D, kept)`). No phase, as a reviewer and as a viewer → `removed_duplicate_ids == [str(D)]`, D absent from `rows`. `?phase=title_abstract` → `removed_duplicate_ids == []`. A second project P2 with its own removed duplicate D2 → `str(D2) not in removed_duplicate_ids` of P1. The no-phase rows' `queue_rank` values are `0..len(rows)-1`.
  - `test_no_phase_full_text_off_has_no_full_text_rows` — FT off: every row `phase == "title_abstract"`; status 200 (never the FT 409).
  - Rename `test_records_phase_is_required_and_closed` (:236) → `test_records_phase_is_optional_and_closed`; flip its `_path(project_id, "")` assertion (:239) to 200 with `data["phase"] is None` and `data["reviewer_count"]` = the TA count; `phase=other` → 422; S3's FT assertions kept.
  - `test_records_unconfigured_is_409` also asserts 409 `SCREENING_NOT_CONFIGURED` with no phase.
  - Unit (`test_screening_records_unit.py`): its own `_WIRE_FIELDS` (:22) gains `phase`; the two existing positional `get_screening_records.__wrapped__(request, PROJECT, "<phase>", MagicMock(), CALLER)` calls (:70-72, :94-96) switch to keyword arguments; `test_records_handler_passes_no_phase` — call `get_screening_records.__wrapped__` by keyword with `phase=None` and a patched service; assert `records` called with `phase=None` and the envelope wraps its result (kept: the project's handler-coverage convention, S3 Global Constraints "Handler coverage"). Add `"removed_duplicate_ids"` to S1's `test_screening_reads_require_a_project_scope` parametrize in `tests/unit/test_screening_review_unit.py` (keyword-only, required `project_id`).

- [ ] **Step 2: Run to verify they fail**

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_records.py tests/unit/test_screening_records_unit.py -x -q`
Expected: FAIL (no phase → 422; `phase` not in row keys).

- [ ] **Step 3: Implement**
  - Schemas: `ScreeningRecordRow.phase: ScreeningPhase` (first field after `assignment_id`); `ScreeningRecordsRead.phase: ScreeningPhase | None`, `removed_duplicate_ids: list[UUID] = []` — update both docstrings (no-phase = one row per article, FT row wins; duplicates listed by id only).
  - Route: `phase: Annotated[ScreeningPhase | None, Query()] = None`; docstring names the no-phase form.
  - Service `records(project_id, viewer_id, phase)`: when `phase` is set, today's path with `row.phase = phase` and `removed_duplicate_ids=[]`. When `None`: build TA rows exactly as `phase=TITLE_ABSTRACT` does; if `reviewer_count_of(settings, FULL_TEXT) is not None`, build FT rows exactly as `phase=FULL_TEXT` does; merge by `article_id` keeping TA order and replacing a TA row with the FT row, then re-rank `queue_rank` 0..n-1; `removed_duplicate_ids = await repo.removed_duplicate_ids(project_id=…)`; top-level `phase=None`, `reviewer_count` = TA count. Factor the phased path (from `assignment_states` through the `rows=[…]` comprehension, incl. the FT `_title_abstract_outcomes` call) into one private `_phase_rows(project_id, viewer_id, phase, roles) -> list[ScreeningRecordRow]` called once (phased) or twice (no phase) — no copy of the row logic. The docstring notes the three reads share no snapshot (a transition committed between them can show an overlap for one fetch; the chip's precedence hides it; read-only, self-heals on refetch).
  - Repository `removed_duplicate_ids(*, project_id)`: `SELECT Article.id WHERE Article.project_id == project_id AND removed_duplicate(Article)` ordered by id.

- [ ] **Step 4: Run to verify they pass** — same command → PASS. Then `cd "$WT/backend" && uv run pytest tests/integration/test_screening_review.py tests/unit -q -k screening` → PASS; `make -C "$WT" lint-backend` → clean; `uv run --frozen python ../scripts/fitness/check_scope_guards.py` and `check_api_response_envelope.py` → exit 0.

- [ ] **Step 5: Regenerate types and fix the TS fallout** — `cd "$WT" && npm run generate:api-types && npm run typecheck`; fix only the fixtures/derivations listed under Files; `npm run test:run -- frontend/components/screening frontend/lib/screening frontend/hooks/screening` → PASS.

- [ ] **Step 6: Commit**

```bash
git -C "$WT" add backend frontend/types/api <fixture files>
git -C "$WT" commit -m "feat(screening): records read without phase — one row per article, removed duplicates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stage vocabulary + data hook (frontend)

**Files:**
- Create: `frontend/lib/screening/articleStage.ts`, `frontend/lib/screening/articleStage.test.ts` (co-located, as `records.test.ts`)
- Create: `frontend/hooks/screening/useArticleScreeningStages.ts`, `frontend/hooks/screening/__tests__/useArticleScreeningStages.test.tsx`
- Modify: `frontend/hooks/screening/useScreeningConfig.ts` (extract `screeningConfigQueryOptions`)
- Modify: `frontend/services/screeningService.ts` (`fetchScreeningRecords` phase optional); Create: `frontend/services/__tests__/screeningService.test.ts` (no runtime test exists yet)
- Modify: `frontend/components/screening/RecordStatusChip.tsx` (export `TONE` as `RECORD_STATUS_TONE`)
- Modify: `frontend/lib/copy/screening.ts`

**Interfaces:**
- Consumes: Task 1 generated types (`ScreeningRecordRow.phase`, `ScreeningRecordsRead.removed_duplicate_ids`, nullable top-level `phase`); S3's `ScreeningConfigRead.full_text_reviewer_count`.
- Produces:
  - The hook's key is S1's `screeningKeys.records(projectId)` (no new key factory).
  - `fetchScreeningRecords(projectId: string, phase?: ScreeningPhase)` — omits `?phase=` when absent.
  - `screeningConfigQueryOptions(projectId: string)` — `queryKey`, `queryFn`, `enabled` of today's `useScreeningConfig` (which spreads it and keeps `refetchOnMount: 'always'`).
  - `type ArticleStage = {label: ScreeningCopyKey; prefix: 'tabTitleAbstract' | 'tabFullText' | null; tone: string}` (`ScreeningCopyKey` = a local `keyof typeof screening` alias, as `RecordStatusChip.tsx:10` does; prefixes reuse the existing `tabTitleAbstract` "Title/abstract" / `tabFullText` "Full text" keys) and `articleScreeningStage(row: ScreeningRecordRow | undefined, opts: {fullTextOn: boolean; isDuplicate: boolean}): ArticleStage | null`.
  - `useArticleScreeningStages(projectId: string): {stageOf(articleId: string): ArticleStage | null}` — `stageOf` returns `null` while loading, on error, when unconfigured, or for an unknown id.

- [ ] **Step 1: Write the failing tests**
  - `articleStage.test.ts` — one case per row of this table (`row` = a minimal `ScreeningRecordRow` factory with `phase`/`status`):

| Input | label | prefix |
| --- | --- | --- |
| `isDuplicate: true` (any row, or `undefined`) | `stageDuplicate` | null |
| `undefined`, not duplicate | → `null` | |
| TA `not_enrolled` | `statusNotEnrolled` | null |
| TA `to_screen` / `waiting` / `in_review` / `conflict` | the S1 `RECORD_STATUS_LABEL` key | `tabTitleAbstract` |
| TA `excluded` | `statusExcluded` | null |
| TA `included`, FT off | `statusIncluded` | null |
| TA `included`, FT on | `statusIncluded` | `tabTitleAbstract` |
| TA `maybe` (FT on or off) | `statusMaybe` | `tabTitleAbstract` |
| FT `to_screen` / `waiting` / `in_review` / `conflict` / `not_retrieved` | the status key | `tabFullText` |
| FT `included` | `statusIncluded` | null |
| FT `excluded` | `statusExcluded` | null |

  Tone: `included` success, `excluded` destructive, duplicate and not-enrolled muted dashed, the rest reuse the S1 `RecordStatusChip` tones (export S1's `TONE` map from `RecordStatusChip.tsx` as `RECORD_STATUS_TONE` rather than copying it).
  - `useArticleScreeningStages.test.tsx` (MSW + `createQueryWrapper()`):
    - `full text on prefixes a TA-included row` — same TA `included` row, config `full_text_reviewer_count: null` → no prefix; `2` → `tabTitleAbstract`.
    - `does not call records while screening is unconfigured` — config `reviewer_count: null` → zero requests to `/screening/records`; `stageOf(x)` null.
    - `calls records without phase once configured` — request URL has no `phase` param; `stageOf` maps per the table, `stageOf(removedId)` → duplicate, `stageOf(unknown)` → null.
    - `fetches once for many chips` — render the hook in 50 sibling components → exactly 1 records request and 1 config request; unmount/remount one sibling within the stale window → still 1.
    - `returns null on a records error` — 500 → `stageOf` null, no retry (1 request).
    - `refetches after invalidateScreening` — call `invalidateScreening(queryClient, projectId)` → a second records request.
  - `useScreeningConfig` keeping `refetchOnMount: 'always'` after the extraction is already pinned by `hooks/screening/__tests__/screeningQueries.remount.test.tsx:41-47`; it must stay green (run it in Step 4).
  - `screeningService` test: `fetchScreeningRecords(p)` hits `/screening/records` with no query string; `fetchScreeningRecords(p, 'title_abstract')` unchanged.

- [ ] **Step 2: Run to verify they fail** — `npm run test:run -- frontend/lib/screening frontend/hooks/screening frontend/services` → FAIL (missing modules).

- [ ] **Step 3: Implement**
  - Copy keys in `frontend/lib/copy/screening.ts`: add `columnScreening: 'Screening'`, `stageDuplicate: 'Duplicate'` (prefixes reuse `tabTitleAbstract`/`tabFullText`).
  - Hook: `useQuery({...screeningConfigQueryOptions(projectId), staleTime: 30_000})`; `configured = config?.reviewer_count != null`; `useQuery({queryKey: screeningKeys.records(projectId), enabled: configured, staleTime: 30_000, retry: false, structuralSharing: false, queryFn})` where `queryFn` unwraps `fetchScreeningRecords(projectId)` as `useScreeningRecords` does and returns `{rows: Map<article_id, row>, removed: Set<string>}` — built once per fetch. `fullTextOn = config.full_text_reviewer_count != null`. The file's doc comment states why it is not `refetchOnMount: 'always'` (one observer per row).

- [ ] **Step 4: Run to verify they pass** — same command → PASS; `npm run typecheck` → 0; `npx eslint <changed files>` → clean; `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/check_react_query_keys.py` → exit 0.

- [ ] **Step 5: Commit** — `feat(screening): article stage vocabulary and shared stages query` (+ Co-Authored-By). Note in the report: `useArticleScreeningStages`/`articleScreeningStage` are consumed in Task 3 (knip runs after Task 3).

---

### Task 3: `ArticleScreeningChip` + ArticlesList column (frontend)

**Files:**
- Create: `frontend/components/articles/ArticleScreeningChip.tsx`, `frontend/components/articles/ArticleScreeningChip.test.tsx` (co-located, as `ArticlesExportDialog.test.tsx`)
- Modify: `frontend/components/articles/ArticlesList.tsx` (wiring only)
- Modify: `frontend/test/ArticlesList.deleteGate.test.tsx`, `frontend/test/ArticlesList.rowControls.test.tsx`, `frontend/test/ArticlesList.toolbar.test.tsx` (mock the chip), plus one new wiring test file `frontend/test/ArticlesList.screeningColumn.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useArticleScreeningStages(projectId).stageOf(articleId)`, `ArticleStage`, copy keys.
- Produces: `ArticleScreeningChip({projectId, articleId}: {projectId: string; articleId: string})` — a `<span>` chip (S1 `RecordStatusChip` geometry `inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-none`, text in a `truncate` span, tone from `articleScreeningStage`), text `"<prefix> · <label>"` when a prefix exists, else `<label>`; renders `null` when `stageOf` is null.

- [ ] **Step 1: Measure** `wc -l "$WT/frontend/components/articles/ArticlesList.tsx"`; headroom = 1335 − that. Record it in the report. If < 8, stop with `status: blocked`.

- [ ] **Step 2: Write the failing tests**
  - `ArticleScreeningChip.test.tsx` (mock `@/hooks/screening/useArticleScreeningStages`): `renders "Title/abstract · Conflict"`; `renders "Full text · Not retrieved"`; `renders "Included"`, `"Excluded"`, `"Not enrolled"`, `"Duplicate"` each with no prefix; `renders nothing when stageOf returns null` (covers unconfigured / loading / error / absent article — container empty).
  - Hook-level edge states live in Task 2; here, `ArticlesList.screeningColumn.test.tsx` (real hook, MSW): `shows a Screening column header and a chip per row` (config configured, records for two articles → "Not enrolled" and "Title/abstract · To screen" in their rows); `renders nothing when screening is not configured` (config `reviewer_count: null` → header present, no chip text, zero records requests); `renders nothing on a records error` (500 → rows render, no chip, no toast); `renders nothing for an article absent from the read`; `the column can be hidden from Display properties` (toggle off → header gone).
  - In the three existing suites add `vi.mock('@/components/articles/ArticleScreeningChip', () => ({ArticleScreeningChip: () => null}))`.

- [ ] **Step 3: Run to verify they fail** — `npm run test:run -- frontend/components/articles frontend/test/ArticlesList` → FAIL.

- [ ] **Step 4: Implement**
  - `ArticleScreeningChip.tsx` per Interfaces.
  - `ArticlesList.tsx` wiring, nothing else: the import; a one-line `TABLE_COLUMNS` entry placed after `year` and before `keywords`: `{ id: 'screening', label: t('screening', 'columnScreening'), visibleKey: 'screening', breakpoint: 'md' }` (the array's type is `{id, label, sortField?, filterKey?, visibleKey?, flexible?, breakpoint?}`; `visibleKey` is what puts it in Display properties and gates the header; no `sortField`/`filterKey`); `screening: true` in the default-visible builder; `screening: 150` in `DEFAULT_COLUMN_WIDTHS`; one cell, placed between the year and keywords cells: `{visibleColumns.screening === true && (<TableCell className={`${TABLE_CELL_CLASS} ${colVisibilityClass('md')}`} style={getColumnStyle('screening')}><ArticleScreeningChip projectId={projectId} articleId={article.id} /></TableCell>)}` (`colVisibilityClass` takes a breakpoint; pattern of the year cell :919-920). The narrow card view is unchanged.

- [ ] **Step 5: Run to verify they pass** — same command → PASS; `wc -l` ≤ 1335; `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/check_file_size.py` and `check_button_scale.py` and `check_copy_keys.py` → exit 0; `npm run deadcode && npm run deadcode:production` → 0 issues; `npm run typecheck && npm run lint` → clean.

- [ ] **Step 6: Commit** — `feat(articles): screening stage column` (+ Co-Authored-By).

---

### Task 4: Slice verification + design review

**Files:** none expected; fixes go back to the owning task's files.

- [ ] **Step 1: Full gate set (S1 set)** from `$WT/backend` with `uv run --frozen python ../scripts/fitness/<x>.py` for `check_copy_keys`, `check_react_query_keys`, `check_file_size`, `check_retired_symbols`, `check_scope_guards`, `check_button_scale`, `check_api_response_envelope`, `check_frontend_data_path` → each exit 0; vulture command → clean; `npm run deadcode`, `npm run deadcode:production` → 0; `npm run typecheck`, `npm run lint`, `npm run test:run` → green; `cd "$WT/backend" && uv run pytest tests/integration/test_screening_records.py tests/unit -q` → green.
- [ ] **Step 2: `/design-review`** of the Articles list (route `?tab=articles` of the seeded screening project from `make db-seed-screening` — on the shared local Supabase only with the orchestrator's OK; else the throwaway-E2E `loginViaUi` route on Vite port 5185) at desktop (1440) and narrow (390) widths, light and dark: the chip aligns with the row baseline, truncates inside its 150px column, never wraps the row; at narrow width the column is absent and the card view unchanged. Fix diffs, re-capture. Delete any throwaway spec.
- [ ] **Step 3: Report** — gate outputs (last lines), screenshots paths, headroom used.
