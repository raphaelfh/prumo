# Article Delete Safety (PR 1 of #1054) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every article delete through a manager-only typed endpoint that deletes rows before storage, so a non-manager can no longer destroy PDFs while the rows survive.

**Architecture:** New `POST /api/v1/projects/{project_id}/articles/delete` takes an `ArticleSelection` (ids mode only in this PR). It deletes the rows in one transaction, commits, then removes storage objects best-effort through the backend storage adapter. The frontend's two client delete paths (`deleteArticle`, `bulkDeleteArticles`) are deleted, and `ArticlesList` calls the endpoint. Delete controls render only for managers.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Pydantic v2, Supabase storage (service role via `create_storage_adapter`), React 19 + `apiClient`, Vitest, pytest integration.

**Spec:** `docs/superpowers/specs/2026-10-24-server-driven-article-list-design.md` (§2 last delete row, §6.4, §7.2 "Delete controls", §10 step 1)

**Worktree:** `/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/server-article-list`. Work on this branch (`claude/confident-brahmagupta-tm8ef4`): PR 1 carries the spec and this plan into `dev`. Before Task 1, wait for #1055 to merge, then sync `dev` in with a merge (no rebase). Every command uses `git -C "$WT"`.

## Global Constraints

- Gate order: non-member or missing project → **404**; member who is not a manager → **403, before anything is touched** (spec §6.4.1). Membership and role come from `is_project_member` / `is_project_manager` (`app/api/deps/security.py`), never hand-rolled.
- Ids are bound to the project via `article_read_service.owned_articles`, the one article-in-project guard. A foreign id and a missing id get the same 404, and the whole batch is refused.
- Order: delete rows → commit → storage removal. Storage failures are logged with the keys and never fail the request (§6.4.4).
- Response `ApiResponse[ArticleDeleteRead]` with `{deleted: int, storage_failures: int}` (§6.4.5).
- `ids` mode: `1 ≤ len(ids) ≤ 10,000` (§6.4).
- Single-article delete uses the same endpoint, in ids mode with one id (§6.4).
- No change to who may delete, or to what a delete cascades to (§3 non-goals).
- English only. After any public schema edit, run `npm run generate:api-types` from the repo root and commit `frontend/types/api/schema.d.ts`.
- Dead code: `npx knip` and `npx knip --production` at zero. Tighten `scripts/fitness/check_frontend_data_path.baseline` to the new counts.

## Builder calls recorded in this plan

- **Ids mode only.** The `query` mode and `expected_count` (409 on drift) need the 6.1 filter builder, so they land in PR 2 with `resolve_selection`. In ids mode, drift is already covered: `owned_articles` refuses the whole batch if any id is gone.
- **Storage batching:** a concrete `StorageAdapter.delete_many(bucket, paths) -> list[str]` returns the paths that failed. The base default loops `delete`, so test fakes keep working. The Supabase adapter overrides it with `remove()` in chunks of 1,000. That limit is a guess: the builder checks the Supabase storage remove limit and fixes the constant if it differs.
- **Celery vs sync:** sync in this PR. The 5k/20k measurement (§6.4, §8) needs the PR 2 perf seed. Record it there.

## Review Focus

1. **A reviewer's delete** (today's data-loss bug): 403, rows intact, and **no** storage call. Pinned in Task 2.
2. **An article that has extraction runs/attempts**: `extraction_attempts.article_id` is a DEFERRED FK with no `ondelete`, and attempts go through `run_id CASCADE`. The delete must succeed once constraints are checked. Pinned in Task 2 with `SET CONSTRAINTS ALL IMMEDIATE`.
3. **A storage failure after commit**: 200 with `storage_failures > 0`, rows gone, nothing raised. Pinned in Task 1 and Task 2.
4. **One foreign id in a batch**: 404, nothing deleted, no storage call. Pinned in Task 2.
5. **The manager role is still loading on the frontend**: controls stay hidden (no flash of a Delete item a reviewer can click). Pinned in Task 4.

---

### Task 1: Batched storage removal

**Files:**
- Modify: `backend/app/infrastructure/storage/base.py` (add a concrete method after `delete`)
- Modify: `backend/app/infrastructure/storage/supabase_storage.py` (override)
- Test: `backend/tests/unit/test_storage_delete_many.py`

**Interfaces:**
- Produces: `async def delete_many(self, bucket: str, paths: Sequence[str]) -> list[str]`, which returns the paths that failed (empty list = all removed; empty input = no call).

- [ ] **Step 1: Write failing tests** (unit, `MagicMock` Supabase client):
  - `test_delete_many_chunks_by_1000`: 2,500 paths → `client.storage.from_("articles").remove` called 3 times with lengths `[1000, 1000, 500]`; returns `[]`.
  - `test_delete_many_returns_failed_chunk_paths`: the 2nd `remove` raises → returns exactly the paths of chunk 2; chunks 1 and 3 still attempted.
  - `test_delete_many_empty_makes_no_call`: `[]` → `remove` not called, returns `[]`.
  - `test_base_default_loops_delete`: a minimal `StorageAdapter` subclass whose `delete` returns `False` for one path → that path is returned.
- [ ] **Step 2:** `cd backend && uv run pytest tests/unit/test_storage_delete_many.py -v`. Expected: FAIL (`delete_many` missing).
- [ ] **Step 3:** Implement. Base: loop `await self.delete(...)` and collect the paths where it returns `False` or raises. Supabase: `_REMOVE_CHUNK = 1000`, then `remove(chunk)` per chunk; log `storage_delete_many_error` with bucket, count and error on failure, and add the chunk's paths to the result.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(storage): remove objects in batches and report the paths that failed`.

### Task 2: Delete endpoint and service

**Files:**
- Create: `backend/app/schemas/article_delete.py`
- Create: `backend/app/services/article_delete_service.py`
- Create: `backend/app/api/v1/endpoints/article_delete.py`
- Modify: `backend/app/api/v1/router.py` (include under `prefix="/projects", tags=["articles"]`, next to `project_delete`)
- Test: `backend/tests/integration/test_article_delete_api.py`

**Interfaces:**
- Consumes: `owned_articles(db, *, project_id, article_ids) -> list[UUID]` (raises `ArticleNotFoundError`); `StorageAdapter.delete_many` (Task 1); `create_storage_adapter(supabase)`.
- Produces:
  - Schemas: `ArticleIdsSelection(mode: Literal["ids"], ids: list[UUID] = Field(min_length=1, max_length=10_000))`; `ArticleSelection = Annotated[ArticleIdsSelection, Field(discriminator="mode")]` (PR 2 adds `ArticleQuerySelection` to the union); `ArticleDeleteRequest(selection: ArticleSelection)`; `ArticleDeleteRead(deleted: int, storage_failures: int)`. Give each class a docstring, since they are published in OpenAPI.
  - Service, flush-only: `async def delete_project_articles(db, *, project_id: UUID, article_ids: Sequence[UUID]) -> DeletedArticles`, where `DeletedArticles` is a frozen dataclass `(deleted: int, storage_keys: list[str])`. It calls `owned_articles` first, collects `ArticleFile.storage_key` for those ids **before** deleting (the cascade removes the file rows), deletes with `Article.project_id == project_id` in the WHERE, then flushes.
  - Service: `async def remove_article_objects(storage: StorageAdapter, keys: list[str]) -> int`, which calls `delete_many("articles", keys)`, logs `article_delete_storage_orphans` with the failed keys, and returns the failure count.
  - Endpoint: `POST /{project_id}/articles/delete` → `ApiResponse[ArticleDeleteRead]`. `ArticleNotFoundError` → 404. Rate limit `30/minute`. Declare the 403 and 404 `responses` as `project_delete.py` does.

- [ ] **Step 1: Write failing integration tests.** Use `engine_setup.client_as_manager/_reviewer/_outsider` and `SEED.primary_project`. Override `get_supabase` with a test-local `MagicMock` so storage calls can be asserted. For an article with a file, insert one `article_files` row (`file_role='MAIN'`, known `storage_key`) scoped by `project_id`.
  - `test_gate_order`: the reviewer gets 403, and the article plus its `article_files` row still exist, with `remove` **not called**. Outsider → 404. Missing project as manager → 404, with the same `error` as the outsider's.
  - `test_manager_deletes_rows_then_storage`: 200, `data == {"deleted": 1, "storage_failures": 0}`, both rows gone, `remove` called once with `[storage_key]`.
  - `test_foreign_id_refuses_whole_batch`: one id from the primary project plus one from another project (or `uuid4()`) → 404, the primary article still exists, `remove` not called.
  - `test_storage_failure_still_succeeds`: `remove` raises → 200, `storage_failures == 1`, rows gone.
  - `test_article_without_files_makes_no_storage_call`: `deleted == 1`, `remove` not called.
  - `test_article_with_extraction_run_deletes`: pick a seed article that has an `extraction_runs` row with an `extraction_attempts` row (create one if the seed has none). Delete it, then run `SET CONSTRAINTS ALL IMMEDIATE` on the test session. Assert no `IntegrityError`, and that the run and attempt are gone.
  - `test_schema_bounds`: `ids: []` → 422; 10,001 ids → 422.
- [ ] **Step 2:** `make test-backend ARGS="tests/integration/test_article_delete_api.py"`, or the repo's equivalent pytest invocation against local Supabase. Expected: FAIL (route 404s / module missing).
- [ ] **Step 3:** Implement the schemas, service and endpoint. Endpoint body, in order: the member check (404), the manager check (403), `delete_project_articles`, `await db.commit()`, `remove_article_objects`, then return. Keep the module docstring in the style of `project_delete.py`, and name the RLS rule it mirrors (`articles_delete` = manager).
- [ ] **Step 4:** Re-run. Expected: PASS. Then run `make lint-backend`, `uv run python scripts/fitness/check_scope_guards.py` and `check_api_response_envelope.py` from the repo root. Expected: clean.
- [ ] **Step 5:** `npm run generate:api-types` (repo root). Expected: `schema.d.ts` gains `ArticleDeleteRequest`, `ArticleDeleteRead` and the path.
- [ ] **Step 6:** Commit `feat(articles): manager-only bulk delete endpoint that deletes rows before storage`.

### Task 3: Frontend delete service

**Files:**
- Create: `frontend/services/articleListService.ts` (PR 2/3 add the list reads here)
- Test: `frontend/test/services/articleListService.test.ts`

**Interfaces:**
- Consumes: `components['schemas']['ArticleDeleteRequest' | 'ArticleDeleteRead']`; `apiClient`; `toResult`.
- Produces: `deleteArticles(projectId: string, selection: ArticleSelection): Promise<ErrorResult<ArticleDeleteRead>>` and `export type ArticleSelection = components['schemas']['ArticleDeleteRequest']['selection']`.

- [ ] **Step 1: Failing test** (mock `@/integrations/api/client`, following `projectSettingsService`'s tests):
  - `deleteArticles('p1', {mode: 'ids', ids: ['a1','a2']})` calls `apiClient('/api/v1/projects/p1/articles/delete', {method: 'POST', body: {selection: {mode: 'ids', ids: ['a1','a2']}}})`. Match the body shape the repo's `apiClient` expects, and returns `{ok: true, data: {deleted: 2, storage_failures: 0}}`.
  - An `ApiError` 403 → `{ok: false}` with the error's message preserved.
- [ ] **Step 2:** `npm run test:run -- frontend/test/services/articleListService.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, with a module header in the style of `projectSettingsService.ts`: errors return as `ErrorResult`, and toasts are the caller's job.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(articles): typed client for the article delete endpoint`.

### Task 4: ArticlesList onto the endpoint, with manager-gated controls

**Files:**
- Modify: `frontend/components/articles/ArticlesList.tsx` (imports at lines 22-23, handlers at 480-512, row menu at ~1036-1044, mobile card menu at ~1100-1105, bulk bar at ~1218-1227, `ArticlesListDialogs` at ~1265)
- Modify: `frontend/services/articlesService.ts`: delete `deleteArticle` (lines ~345-378) and `bulkDeleteArticles` (lines ~466-490) with their section comments
- Modify: `frontend/test/ArticlesList.rowControls.test.tsx`, `frontend/test/ArticlesList.toolbar.test.tsx` (drop the two mocks; mock `useProjectMemberRole`)
- Create: `frontend/test/ArticlesList.deleteGate.test.tsx`
- Modify: `scripts/fitness/check_frontend_data_path.baseline` (`articlesService.ts|articles` and `|article_files` each drop by the removed calls; run the gate to read the new numbers)

**Interfaces:**
- Consumes: `deleteArticles` (Task 3); `useProjectMemberRole(projectId) -> {role, isManager, loading}`.

- [ ] **Step 1: Failing tests** in `ArticlesList.deleteGate.test.tsx` (mock `useProjectMemberRole` and `@/services/articleListService`):
  - `isManager: false` → no row "Delete" menu item and no bulk Delete button, even after selecting a row.
  - `loading: true, isManager: false` → no Delete controls.
  - `isManager: true`: bulk delete of 2 selected rows → `deleteArticles` called with `{mode: 'ids', ids: [both]}`. The success toast shows the server's `deleted` count, the selection clears, and `onArticlesChange` is called once.
  - `isManager: true`: row Delete → `deleteArticles(projectId, {mode: 'ids', ids: [id]})`.
  - Failure result → error toast, selection **kept**, `onArticlesChange` not called.
- [ ] **Step 2:** `npm run test:run -- frontend/test/ArticlesList` (all ArticlesList tests). Expected: the new tests FAIL; the existing ones still pass.
- [ ] **Step 3:** Implement. Read `const {isManager} = useProjectMemberRole(projectId)`. Render both Delete menu items (and their preceding `DropdownMenuSeparator`) and the bulk Delete button only when `isManager` is true. Route both handlers through `deleteArticles`, and build the bulk toast from `result.data.deleted`. Delete the two functions in `articlesService.ts`.
- [ ] **Step 4:** Re-run the ArticlesList tests. Expected: PASS. Then from the repo root: `npm run lint`, `npx knip`, `npx knip --production`, `python scripts/fitness/check_frontend_data_path.py` (tighten the baseline to what it reports), `python scripts/fitness/check_copy_keys.py`. Expected: all clean.
- [ ] **Step 5:** Commit `fix(articles): delete through the API and show delete only to managers`.

### Task 5: Verify and open the PR

- [ ] **Step 1:** `make quality-scan`. Expected: green. Record the SHA.
- [ ] **Step 2:** Manual check on the local stack (`make start`). As a manager, delete one article with a PDF: the row disappears and the object is gone from the `articles` bucket. As a reviewer, no Delete control shows. A direct `curl` of the endpoint with the reviewer's token returns 403, and the article and object remain.
- [ ] **Step 3:** Run the `code-review` skill on the diff and fix its blocking findings.
- [ ] **Step 4:** PR into `dev`, titled `fix(articles): stop non-manager deletes from removing PDFs while rows survive (#1054)`. The body has: the bug (spec §2 row), the gate order, the row → commit → storage order, `Refs #1054`, and the builder calls above. Squash. Arm auto-merge only when no other auto-merge is armed (AGENTS.md § Branch & merge).
