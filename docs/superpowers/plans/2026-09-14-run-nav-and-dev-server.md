---
status: approved
last_reviewed: 2026-09-14
owner: '@raphaelfh'
---

# Run Navigation and Dev Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move worklist progress behind a typed article-progress API. Give the worklists and the dashboard explicit loading, error and unavailable states. Collapse the section rail to a dot strip, track the active section by heading position, move the article pager to `[` / `]`, and let the Vite dev server honour `PORT`.

**Architecture:** A new FastAPI read `GET …/article-progress` (api → service → repository, set-based SQL, caller-scoped values) replaces the browser's PostgREST progress reads. The frontend reads it through `apiClient` in a service. `useArticleExtractionValues` maps it to the same per-article map. Consumers gate their render on the ordered state flags. The rail, scroll and pager slices are frontend-only changes to existing run-screen components and hooks.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest; TypeScript strict, React 19, Vite, TanStack Query v5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-run-nav-and-dev-server-design.md` (R1–R38). Binding rulings: `.superpowers/sdd/2026-09-14-run-nav-and-dev-server/progress.md`, including "Rulings (panel) — first pass" and "— second pass".

## Global Constraints

- English only: code, comments, commits, docs, copy keys and copy text.
- Work only in the worktree `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`, on branch `feat/run-nav-and-dev-server`. Use absolute paths and never edit the main checkout.
- Frontend tooling runs from the worktree ROOT (`package.json`, `vite.config.ts`, `vitest.config.ts`). There is no `frontend/package.json`. Never run `cd frontend && npm …`.
- Dependencies: the worktree has no `node_modules`, no `backend/.venv` and no `.env`. Install once, the same way as CI (`.github/workflows/ci.yml`): `npm ci` at the worktree root, then `cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/backend && uv sync --frozen --extra dev`. Then `cp /Users/raphael/PycharmProjects/prumo/.env /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/.env && cp /Users/raphael/PycharmProjects/prumo/backend/.env /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/backend/.env`. Check first with `test -d node_modules && test -d backend/.venv`, and skip what already exists.
- Backend integration tests need the local Supabase Docker stack. One stack is shared by every session: never run `make reset-db` or `make db-fresh`, and scope fixtures to rows the test creates. Run them with `cd backend && uv run pytest tests/integration/test_article_progress_read.py -v`.
- Integration test setup scopes every read of templates (and of articles) by `project_id` as well as by id (`.claude/rules/backend.md` § Tests). For example, the template-version lookup joins `project_extraction_templates` and filters `project_id = :pid` as well as `project_template_id = :t`, because `extraction_template_versions` has no `project_id` column (`backend/app/models/extraction_versioning.py:59-61`).
- Every endpoint returns the `ApiResponse[T]` envelope (`app.schemas.common.ApiResponse`, `ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))`) with a typed Pydantic response model.
- Layering is api → services → repositories (`scripts/fitness/check_layered_arch.py`). An endpoint never touches SQLAlchemy, and a service never builds an HTTP response.
- Ownership guards: only `Depends(require_project_scope)` (`backend/app/api/deps/security.py:128`) and `project_template_active_service.owned_template`. No new ownership predicate. `scripts/fitness/check_scope_guards.py` stays green with no baseline growth.
- No new direct-PostgREST `extraction_*` read in the browser. `scripts/fitness/check_frontend_data_path.py` stays green with no baseline growth.
- No dead code ships: `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` both at zero findings after every task, with one exception: after Task 4a exactly one `--production` finding is expected (`frontend/hooks/extraction/useCallerArticleProgress.ts`, used only by its test until Task 4b), and it must be gone after Task 4b. The harden gate requires zero in both modes. `scripts/fitness/check_copy_keys.py` is shrink-only, so every new copy key must be referenced. The vulture ratchet (`backend/.vulture_baseline`, `scripts/vulture_baseline.py`) is shrink-only.
- File-size budgets (`scripts/fitness/check_file_size.py`, 800 lines unless baselined): `QualityAssessmentFullScreen.tsx` 1019/1021 (2 lines of headroom, Tasks 6 and 8); `ArticleExtractionTable.tsx` 1048/1134; `run_lifecycle_service.py` 795/800 (Task 1a; the resolver extraction must shrink it, never grow it); `QualityAssessmentFullScreen.review.test.tsx` 739/800; `project_templates.py` 737/800 (Task 2); `lib/copy/extraction.ts` 700/800; `HITLArticleTable.tsx` 634/800; `ExtractionInterface.tsx` 505/800; `QualityAssessmentInterface.tsx` 293/800 on `origin/dev` (Task 9). Absorb growth by extracting a hook or component in the same task. Never bump the baseline and never run `--update-baseline`.
- API types: after any backend schema or route change, run `npm run generate:api-types` and commit `frontend/types/api/{openapi.json,schema.d.ts}`. The CI `api-contract` job fails on drift.
- No DB migration and no new index in this run, whatever the timings show. Task 1b records the wall time of `test_more_than_1000_instances_returned_in_full` in its report and ledger entry; that is all. An index, if one is needed, is a follow-up.
- Rate limiting: the new handler carries `@limiter.limit("60/minute")` (constitution §IV). Pre-existing undecorated routes in `project_templates.py` are not touched.
- Sync with dev before build: Task 0 commits the imported WIP and MERGES `origin/dev` (`b3192e7e` or newer) into `feat/run-nav-and-dev-server`. Never rebase: a rebase would rewrite the SHAs the gate evidence is recorded against. Every later task builds on that merged base.
- Use conventional commits with one commit per task, in the worktree, on `feat/run-nav-and-dev-server`. End each message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never push.
- Never use `--no-verify` and never skip hooks.
- Test-first: write each named NEW test, watch it fail for the right reason, then implement. Test names are the exact strings in the spec.
- Typecheck is `npm run typecheck` (`tsc -p tsconfig.app.json --noEmit`). Never use `npx tsc --noEmit -p .`: the root `tsconfig.json` has `"files": []`, so that command checks nothing.
- Commits are path-scoped (`git commit -m "…" -- <paths>`). Task 0 makes ONE path-scoped `chore` commit of the imported WIP: every path that `git status --porcelain` lists, untracked `loadArticleProgressData{,.test}.ts` and `paneScroll{,.test}.ts` included, plus the spec and this plan, and nothing under `.superpowers/`. After Task 0 the WIP is committed, so there is no staged WIP. Each task stages and commits only the paths it changed, and its verify step checks with `git show --stat HEAD` that no other path went in. Tasks 3, 4c and 5–8 edit lines the WIP commit already carries; they change those lines in place, and their commits contain only their own hunks.

## File Structure

**Task 0 — sync with dev (plan only, no spec cluster)**
- Commit (one path-scoped `chore` commit): every path in the imported WIP that `git status --porcelain` lists, untracked files included, plus the spec and this plan. Nothing under `.superpowers/`.
- Merge `origin/dev` (`git merge --no-ff origin/dev`, never rebase). Possible conflict: `frontend/test/QualityAssessmentInterface.test.tsx` (a scratchpad 3-way merge on `b3192e7e` predicted it clean; resolve as follows only if `dev` has moved). Keep PR #911's version, plus the WIP's `range: () => b,` line in `makeBuilder` (R14).
- Expected typecheck break after the merge (verify against the `npm run typecheck` output, not this note). PR #911's `QualityAssessmentInterface.tsx:44-47` imports `articleExtractionValuesKeys` from the hook module and destructures `error`, but the WIP hook exports neither. The minimal bridge: point that import at `@/lib/query-keys/extraction`, and add `error: query.error` to the WIP hook's return. Task 3 removes `error`, and Task 9 ports the consumer.
- Verify: `npm run typecheck` exit 0, and `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx` green. 0 NEW tests.

**Task 1a — backend kind-agnostic progress read + one resolver (cluster 1a)**
- Create `backend/app/schemas/article_progress.py`: the response models and the `ArticleProgressKind` literal.
- Create `backend/app/repositories/article_progress_repository.py`: `ArticleProgressRepository` with `list_instances` and the single-statement `list_caller_values`. In 1a that statement has no form-run scoping yet.
- Modify `backend/app/services/value_semantics.py`: add `resolve_reviewer_value`. Modify `backend/app/services/run_lifecycle_service.py`: `_resolved_reviewer_values` calls it (795/800 lines; must shrink).
- Create `backend/app/services/article_progress_service.py`: `get_article_progress`, which runs the guard and applies the merge rule through `resolve_reviewer_value`.
- Create `backend/tests/integration/test_article_progress_read.py`: the service-level tests for R7, R9, R11 and R12.

**Task 1b — extraction form-run scoping inside the one statement (cluster 1b)**
- Modify `backend/app/repositories/article_progress_repository.py`: add the `form_runs` CTE to `list_caller_values` for `kind="extraction"`.
- Modify `backend/tests/integration/test_article_progress_read.py`: the R8 and R10 tests, including the one-statement test. Record the >1000-instance wall time (no index).

**Task 2 — endpoint + guards + rate limit + types (cluster 2)**
- Modify `backend/app/api/v1/endpoints/project_templates.py`: the handler `get_template_article_progress`, with `@limiter.limit("60/minute")`.
- Modify `backend/tests/integration/test_article_progress_read.py`: the HTTP tests (R3, R5, R6, R33, R36).
- Modify `frontend/types/api/openapi.json` and `frontend/types/api/schema.d.ts`: regenerated.

**Task 3 — frontend service + hook + deletions (cluster 3a)**
- Create `frontend/services/articleProgressService.ts`: `getArticleProgress` and the `ArticleProgressData` type.
- Create `frontend/test/services/articleProgressService.test.ts`.
- Modify `frontend/hooks/extraction/useArticleExtractionValues.ts`: read the API and return the four-flag shape.
- Create `frontend/test/hooks/useArticleExtractionValues.test.tsx`.
- Modify `frontend/lib/query-keys/extraction.ts`: `articleExtractionValuesKeys`, verified unchanged.
- Modify `frontend/services/articlesService.ts` and `frontend/test/services/articlesService.test.ts`: R13 paging, plus 2 NEW tests.
- Verify, do not re-add, the `range` stubs: `frontend/test/QualityAssessmentInterface.test.tsx` `makeBuilder` (merged in Task 0) and `frontend/test/helpers/qaFullScreenMocks.tsx:107`. After Task 0 that suite mocks `@/hooks/extraction/useArticleExtractionValues` at the module boundary, so the old `apiClient` (:83) and `extraction_instances` stub (:134) edits no longer apply.
- Modify `frontend/components/quality/QualityAssessmentInterface.tsx` (compile port only): the destructure `error: valuesError` becomes `isError: valuesError`, and the Task 0 bridge `error: query.error` leaves the hook. Modify `frontend/test/QualityAssessmentInterface.test.tsx`: the hoisted `progress` state's `error` becomes `isError` (its default and the progress-fails test). Task 9 does the full port.
- Modify `frontend/services/extractionValueService.ts` and `frontend/test/services/extractionValueService.test.ts`: delete `findFormRunsByArticle` and its describe.
- Modify `frontend/hooks/runs/types.ts`: delete `ArticleRunRef`.
- Modify `backend/app/services/extraction_run_read_service.py:642`: reword the docstring.
- Modify `frontend/components/extraction/ArticleExtractionTable.test.tsx:67`: remove the keys mock.
- Delete `frontend/lib/extraction/loadArticleProgressData.ts`, `loadArticleProgressData.test.ts`, `articleValues.ts` and `articleValues.test.ts`.

**Tasks 4a/4b/4c — consumer states + one shared gate (cluster 3b).** Renamed from the panel-round plan: the former Task 4a (dashboard) is now **4b**, and the former Task 4b (tables) is now **4c**. The new **4a** is the shared gate.

**Task 4a — shared progress gate (cluster 3b)**
- Create `frontend/hooks/extraction/useCallerArticleProgress.ts` (R37): the hook plus the pure `resolveProgressGate`, the one shared order of the progress steps.
- Create `frontend/test/hooks/useCallerArticleProgress.test.tsx`: 3 spec tests + 2 plan-added `resolveProgressGate` tests.
- Modify `frontend/hooks/extraction/useActiveTemplateStructure.ts`: add `refetch` (moved here from the former 4a).

**Task 4b — dashboard states (cluster 3c)**
- Modify `frontend/components/extraction/ExtractionInterface.tsx`: `articlesQuery` replaces `loadArticles`, its effect and the toast; `useCallerArticleProgress` replaces the direct hook call; the ordered dashboard gate (its own steps 1–4, then `resolveProgressGate` for steps 5–8); the page-level `ErrorState`.
- Modify `frontend/services/articlesService.ts` and `frontend/test/services/articlesService.test.ts`: delete `loadProjectArticles` and its parameter row.
- Modify `frontend/lib/copy/extraction.ts`: 2 new keys, and delete `errorLoadArticles`.
- Create `frontend/test/components/ExtractionInterface.progressStates.test.tsx`.
- Modify `frontend/test/components/ExtractionInterface.gear.test.tsx` and `frontend/test/components/ExtractionInterface.templateSwitch.test.tsx`: the progress mocks move to the new shape, and the `loadProjectArticles` mock (:38 / :48) becomes a `fetchProjectArticles` mock. Both suites already mount a `QueryClientProvider` (:61 / :88).

**Task 4c — worklist tables (cluster 3d)**
- Modify `frontend/components/extraction/ArticleExtractionTable.tsx` and `frontend/components/hitl/HITLArticleTable.tsx`: take `userId` from `useCallerArticleProgress`, and order the progress states through `resolveProgressGate`.
- Modify `frontend/services/authService.ts`: delete `getCurrentUserId`.
- Modify `frontend/components/extraction/ArticleExtractionTable.test.tsx` and `frontend/components/hitl/HITLArticleTable.test.tsx`.

**Task 5 — rail dot strip + rail copy (cluster 4)**
- Modify `frontend/lib/copy/runs.ts` (text only).
- Verify (committed by Task 0): `frontend/components/extraction/SectionNavRail.tsx` and `frontend/components/runs/SectionNavLayout.tsx`. Modify them only if a NEW test proves a gap (Task 5 Step 8).
- Modify `frontend/test/SectionNavRail.test.tsx`, `frontend/components/runs/SectionNavLayout.test.tsx`, `frontend/components/extraction/SectionNavRail.jumpNext.test.tsx` and `frontend/test/QualityAssessmentFullScreen.review.test.tsx:126`.
- Create `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts`.

**Task 6 — position scrollspy + pane scroll (cluster 5)**
- Verify (committed by Task 0): `frontend/hooks/extraction/useActiveSection.ts`, `frontend/hooks/extraction/useJumpToNextPendingField.ts`, `frontend/components/extraction/ExtractionFormView.tsx`, `frontend/hooks/qa/useQASectionNav.ts` and `frontend/pages/QualityAssessmentFullScreen.tsx`. Modify one only where a NEW test fails without a mutation.
- Verify (committed by Task 0): `frontend/lib/runs/paneScroll.ts`, `frontend/lib/runs/paneScroll.test.ts` and `frontend/hooks/extraction/useJumpToNextPendingField.test.tsx`.
- Modify `frontend/test/useActiveSection.test.tsx`, `frontend/components/runs/SectionNavLayout.test.tsx`, `frontend/test/ExtractionFormView.test.tsx` and `frontend/test/QualityAssessmentFullScreen.review.test.tsx`.

**Task 7 — dev tooling (cluster 6)**
- Modify `.claude/launch.json` and `vite.config.ts` (committed by Task 0; verify them).
- Create `frontend/test/devTooling.config.test.ts`.

**Task 8 — pager keys (cluster 7)**
- Modify `frontend/lib/runs/shortcuts.ts` (the key-definition comment) and `frontend/e2e/flows/extraction-article-pager.ui.e2e.ts` (a code change at :151, the pager key press; its header comment was committed by Task 0).
- Verify (committed by Task 0): `frontend/hooks/runs/useRunShortcuts.ts`, `frontend/lib/copy/runs.ts` (edited only by the Step 4 fallback), `frontend/components/runs/header/Worklist.tsx` and `frontend/pages/QualityAssessmentFullScreen.tsx:415` (a comment).
- Modify `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts` (1 NEW test).
- Verify (committed by Task 0): `frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`, `frontend/components/runs/header/__tests__/Help.test.tsx`, `frontend/components/runs/header/__tests__/Worklist.test.tsx`, `frontend/test/QualityAssessmentFullScreen.navigation.test.tsx` and `frontend/test/ExtractionFullScreen.articleSwitch.test.tsx`.

**Task 9 — port the QA dashboard consumer (cluster 8, mandatory, no merge step)**
- Modify `frontend/components/quality/QualityAssessmentInterface.tsx` (as merged in Task 0 from PR #911): `useCallerArticleProgress(projectId, dashboardTemplateId, 'quality_assessment')` replaces the direct `useAuth` user and hook call. It uses the R17 shape (`isError`, `isUnavailable`, `refetch`) and R38's precedence. `retryDashboard` refetches progress only when `!isUnavailable`. The `articleExtractionValuesKeys` import and `useQueryClient` go if nothing else uses them.
- Modify `frontend/test/QualityAssessmentInterface.test.tsx`: the hoisted `progress` state takes the R17 shape with a `refetch` spy; the `articleExtractionValuesKeys` stub goes; the `useAuth` mock gains `loading`; the 3 NEW R38 tests.

## Interfaces contract

This is the single source of truth for names that cross a task boundary. A task section that disagrees with it is wrong. `(chosen)` marks a name the spec left open.

**Endpoint (Tasks 2 → 3)**
- `GET /api/v1/projects/{project_id}/templates/{template_id}/article-progress?kind=extraction|quality_assessment`
- Decorators, in this order: `@router.get("/{project_id}/templates/{template_id}/article-progress", response_model=ApiResponse[ArticleProgressRead])`, then `@limiter.limit("60/minute")` (existing import `from app.utils.rate_limiter import limiter`, `project_templates.py:107`).
- Handler: `async def get_template_article_progress(project_id: UUID, template_id: UUID, request: Request, db: DbSession, kind: ArticleProgressKind, user_sub: UUID = Depends(require_project_scope)) -> ApiResponse[ArticleProgressRead]`. `kind` is a required query param with no default. `ProjectTemplateNotFoundError` → `HTTPException(404)`. Statuses: 200 / 401 / 403 / 404 / 422 / 429.
- Rate-limit test (chosen, behavioural): `test_article_progress_is_rate_limited_at_60_per_minute`. In one test, 60 member requests to a template with no instances return 200 and the 61st returns 429. The limiter is live in the integration suite and reset per test (`tests/integration/conftest.py:60-73`).

**Pydantic models (Task 1, file `backend/app/schemas/article_progress.py`)**
- `ArticleProgressKind = Literal["extraction", "quality_assessment"]` (chosen)
- `class ArticleProgressInstanceRead(BaseModel): id: UUID; entity_type_id: UUID`
- `class ArticleProgressValueRead(BaseModel): instance_id: UUID; field_id: UUID; value: Any`
- `class ArticleProgressItemRead(BaseModel): article_id: UUID; instances: list[ArticleProgressInstanceRead]; values: list[ArticleProgressValueRead]`
- `class ArticleProgressRead(BaseModel): articles: list[ArticleProgressItemRead]`
- Ordering: `articles` by `article_id`, `instances` by `id`.

**Repository (Task 1, `backend/app/repositories/article_progress_repository.py`)**
- `class ArticleProgressRepository:` with `def __init__(self, db: AsyncSession) -> None` (chosen: not a `BaseRepository` subclass, because it spans several models).
- Row types (chosen), frozen dataclasses in the same module:
  - `ProgressInstanceRow(id: UUID, article_id: UUID, entity_type_id: UUID)`
  - `CallerValueRow(source: Literal["state", "proposal"], instance_id: UUID, field_id: UUID, decision: str | None, value: Any, proposed_value: Any, created_at: datetime, id: UUID)` (chosen; replaces `ReviewerValueRow` and `HumanProposalRow`). A `state` row has `decision` = the current decision's kind, `value` = the decision row's value, `proposed_value` = the referenced proposal's value (LEFT JOIN on `proposal_record_id`, else `None`), and `created_at`/`id` = the decision's. A `proposal` row has `decision = None`, `value` = the proposal's `proposed_value`, `proposed_value = None`, and `created_at`/`id` = the proposal's.
- `async def list_instances(self, *, project_id: UUID, template_id: UUID) -> list[ProgressInstanceRow]` (chosen signature). It filters `project_id` AND `template_id`, orders by `article_id`, then `id`, and selects only instances whose `article_id` is not null. (Task 1a)
- `async def list_caller_values(self, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> list[CallerValueRow]` (chosen signature; final after Task 1b). Task 1a writes it WITHOUT `kind` (an unused parameter fails vulture and ruff ARG002); Task 1b adds `kind` and passes it from `article_progress_service.py`. ONE statement. It returns the caller's reviewer states joined to their `current_decision_id` decision, `UNION ALL` the caller's `source='human'` proposals. Proposal rows are ordered by `created_at` desc, then `id` desc. Both branches join `extraction_instances` filtered on `project_id` AND `template_id`. Task 1a writes it without run scoping. Task 1b adds, for `kind="extraction"` only, ONE CTE named `form_runs` (chosen) that both branches join on `run_id` (R10). One statement means one snapshot, so the form-run choice is made once per request.
- Statements per read (the bind-parameter and one-statement tests count these): `owned_template`, then `list_instances`, then `list_caller_values` (skipped when there are no instances). No other SQL.
- No method binds a Python list of article, instance or run ids.

**Resolver (Task 1a, `backend/app/services/value_semantics.py`)**
- `def resolve_reviewer_value(decision: str, value: Any, proposed_value: Any) -> Any | None` (chosen). It returns `None` for `reject`. Otherwise `resolved = value if value is not None else proposed_value`; it returns `strip_verification(resolved)` when `is_value_filled(resolved)`, else `None`.
- `RunLifecycleService._resolved_reviewer_values` (`run_lifecycle_service.py:535`) calls it, with `proposed_value = proposal_values.get(proposal_record_id)` when `proposal_record_id` is not `None`. Its output is unchanged, and the file shrinks.

**Service (Task 1a, `backend/app/services/article_progress_service.py`)**
- `async def get_article_progress(db: AsyncSession, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> ArticleProgressRead`
- It calls `owned_template(db, project_id=project_id, template_id=template_id, kind=kind)` first. On no instances it returns `ArticleProgressRead(articles=[])` without calling `list_caller_values` (R12).
- Merge per `(instance_id, field_id)` (spec R9): a `state` row whose `resolve_reviewer_value(decision, value, proposed_value)` is not `None` wins. Otherwise the first `proposal` row (newest first) that is not `is_value_empty` wins.

**Frontend service (Task 3, `frontend/services/articleProgressService.ts`)**
- `export type ArticleProgressRead = components['schemas']['ArticleProgressRead'];`
- `export type ArticleProgressData = Pick<components['schemas']['ArticleProgressItemRead'], 'instances' | 'values'>;` (chosen derivation)
- `export function getArticleProgress(projectId: string, templateId: string, kind: ReviewKind): Promise<ArticleProgressRead>`. It calls `apiClient<ArticleProgressRead>(`/api/v1/projects/${projectId}/templates/${templateId}/article-progress?kind=${kind}`)` and throws on error. `ReviewKind` comes from `@/lib/comparison/permissions`.

**Hook (Task 3 → Task 4a; consumers reach it only through the shared gate)**
- `useArticleExtractionValues(projectId: string | null | undefined, templateId: string | null | undefined, userId: string | null | undefined, kind: ReviewKind = 'extraction')`
- Returns `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown> }`.
- `enabled = !!projectId && !!templateId && !!userId`; `isLoading = enabled && query.isPending`; `isError = query.isError`; `isUnavailable = !enabled`; `refetch = query.refetch`. The old `error` field is gone.

**Query key factory (Task 3)**
- `articleExtractionValuesKeys` in `frontend/lib/query-keys/extraction.ts`: `all: ['article-extraction-values']` and `byTemplate(projectId: string, templateId: string, userId: string, kind: string)` → `['article-extraction-values', projectId, templateId, userId, kind]`. Unchanged.

**`useActiveTemplateStructure` (Task 4a)**
- The return gains `refetch: query.refetch` (type `() => Promise<unknown>`). `entityTypes`, `isLoading` (`query.isPending`), `isError` and `error` are unchanged.

**Shared progress gate (Task 4a → Tasks 4b, 4c, 9; spec R37)**
- File (chosen): `frontend/hooks/extraction/useCallerArticleProgress.ts`.
- `export function useCallerArticleProgress(projectId: string | null | undefined, templateId: string | null | undefined, kind: ReviewKind = 'extraction'): CallerArticleProgress` (chosen).
- `CallerArticleProgress` = `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown>; userId: string | null | undefined; isAuthResolving: boolean; isSignedOut: boolean }`. It is exported only if a consumer imports it; knip decides.
- Body: `const { user, loading } = useAuth();` then `const userId = loading ? undefined : (user?.id ?? null);`. It returns `{ ...useArticleExtractionValues(projectId, templateId, userId, kind), userId, isAuthResolving: !!loading, isSignedOut: !loading && !user }`. `isAuthResolving` and `isSignedOut` are never both true. A mocked `useAuth` without `loading` reads as resolved.
- The hook owns no precedence (R37). The shared ORDER of the progress steps lives in one pure function in the same module, below. Each surface decides where that order applies and renders each state itself (R18, R19, R38).
- NEW tests (`frontend/test/hooks/useCallerArticleProgress.test.tsx`): `reports auth resolving and passes no user id while the user lookup resolves`; `reports signed out and passes a null user id once auth resolves with no user`; `passes the signed-in user's id to the progress read`.

**Shared progress-step order (Task 4a → Tasks 4b, 4c; chosen, ledger pre-flight ruling 2, A9)**
- Exported from `frontend/hooks/extraction/useCallerArticleProgress.ts`. It is a pure function with no hooks:
  ```ts
  type ProgressRead = { isLoading: boolean; isError: boolean; refetch: () => Promise<unknown> };
  type ProgressGate =
    | { state: 'authResolving' }
    | { state: 'signedOut' }
    | { state: 'error'; retry: () => void }
    | { state: 'loading' }
    | { state: 'ready' };
  export function resolveProgressGate(
    progress: ProgressRead & Pick<CallerArticleProgress, 'isAuthResolving' | 'isSignedOut'>,
    structure: ProgressRead,
  ): ProgressGate;
  ```
- Order, first match wins: `progress.isAuthResolving` → `authResolving`; `progress.isSignedOut` → `signedOut`; `progress.isError || structure.isError` → `error`, whose `retry` calls `progress.refetch()` only if progress failed and `structure.refetch()` only if structure failed; `progress.isLoading || structure.isLoading` → `loading`; otherwise `ready`. This is R19 steps 1–3 plus the structure/values half of step 4, and R18 steps 5–8. `ProgressRead` and `ProgressGate` are not exported; consumers narrow on `gate.state`.
- Callers pass the whole `useCallerArticleProgress(...)` result and the whole `useActiveTemplateStructure(...)` result. The dashboard (4b) calls it after its own steps 1–4. Both tables (4c) call it and add their own article `loading` to the skeleton branch (R19 step 4). The QA dashboard (Task 9) does not call it: R38 has no structure read and joins the article and progress errors under one `retryDashboard`.
- Plan-added tests, not spec names (same file, `describe('resolveProgressGate')`): `orders auth resolving, signed out, a failed read and a pending read before ready`; `retries only the read that failed`.
- `ExtractionInterface`, `ArticleExtractionTable`, `HITLArticleTable` and `QualityAssessmentInterface` call only this hook for progress, never `useArticleExtractionValues` directly. `getCurrentUserId`, the tables' `currentUserId` state and every copied `progressUserId` derivation are deleted. The tables' article fetch keys on the gate's `userId`.

**ExtractionInterface article list (Task 4b; spec R18)**
- `const articlesQuery = useQuery({ queryKey: articleKeys.byProject(projectId), queryFn: async () => { const result = await fetchProjectArticles(projectId); if (!result.ok) throw …; return result.data; } });` (chosen name `articlesQuery`). It has the same key and fetcher as `QualityAssessmentInterface.tsx:90-97`. `articles = articlesQuery.data ?? []`.
- The dashboard reads `articlesQuery.isPending` (R18 step 3), `articlesQuery.isError` (step 4) and `articlesQuery.refetch` (step 4 retry). There is no `articlesLoading` or `articlesLoadFailed`.
- Deleted: `loadArticles` and its effect, the `errorLoadArticles` toast and copy key, and `articlesService.loadProjectArticles` (no production caller left).
- The dashboard gate order is R18 steps 1–9. The skeleton test id stays `dashboard-skeleton`.
- The extraction table's loading skeleton gets the test id `extraction-table-loading` (chosen, Task 4c).

**Page-level templates ErrorState (Task 4b)**
- Condition and placement are unchanged (`{templatesError && …}` below the tab container). It renders `<ErrorState title={t('extraction', 'errorLoadTemplates')} message={templatesError} onRetry={() => void projectTemplatesQuery.refetch()} />`, which replaces the destructive `Card`.

**Progress ErrorStates (Tasks 4b, 4c, 9; chosen: copy goes in `message`, and the default title `patterns.errorDefaultTitle` stays)**
- `<ErrorState message={t('extraction', 'errorLoadProgress')} onRetry={…} />`
- `<ErrorState message={t('extraction', 'progressUnavailable')} />`, with no `onRetry`. The QA dashboard (Task 9) reuses this key.

**QA dashboard (Task 9; spec R38)**
- `const progress = useCallerArticleProgress(projectId, dashboardTemplateId, 'quality_assessment');` Precedence: `isAuthResolving` → skeleton; `isSignedOut` → unavailable; articles or progress `isError` → `qa.dashboardLoadError` + `retryDashboard`; articles `isPending` or progress `isLoading` → skeleton; figures.
- `retryDashboard = () => { void dashboardArticles.refetch(); if (!progress.isUnavailable) void progress.refetch(); }`.

**Copy keys**
- NEW `extraction.errorLoadProgress`: "Could not load progress" (chosen text). Task 4b.
- NEW `extraction.progressUnavailable`: "Progress is unavailable without a signed-in user" (chosen text). Task 4b.
- DELETED `extraction.errorLoadArticles` (its toast goes with `loadArticles`). Task 4b.
- CHANGED `runs.shortcutSectionNav`: "Collapse / expand sections". Task 5.
- CHANGED `runs.sectionNavShow`: "Expand sections". Task 5.
- CHANGED `runs.sectionNavHide`: "Collapse sections". Task 5.
- `runs.shortcutNextPrev`: "Previous / next article" (committed by Task 0; asserted in Task 8).

**NEW test files**
- `backend/tests/integration/test_article_progress_read.py` (created in Task 1a, extended in Tasks 1b and 2)
- `frontend/test/services/articleProgressService.test.ts` (Task 3)
- `frontend/test/hooks/useArticleExtractionValues.test.tsx` (Task 3)
- `frontend/test/hooks/useCallerArticleProgress.test.tsx` (Task 4a)
- `frontend/test/components/ExtractionInterface.progressStates.test.tsx` (Task 4b)
- `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts` (created in Task 5, extended in Task 8)
- `frontend/test/devTooling.config.test.ts` (Task 7)
- NEW tests in existing files are listed per task in the spec's acceptance lines. `frontend/lib/runs/paneScroll.test.ts` is committed in Task 0, and its existing tests are not counted as NEW.

## Task list

Execution is serial in one worktree, in table order.

| Task | Spec cluster | R-ids | Depends on | NEW tests |
|---|---|---|---|---|
| 0. Sync with dev: commit the imported WIP, merge `origin/dev` | none (plan only) | none | none | 0 |
| 1a. Backend kind-agnostic progress read + one reviewer-value resolver | 1a | R7, R9, R11, R12 | 0 | 11 |
| 1b. Extraction form-run scoping inside the one value statement | 1b | R8, R10 | 1a | 6 |
| 2. Article-progress endpoint, guards, rate limit, API types regen | 2 | R3, R4, R5, R6, R33, R36 | 1b | 9 |
| 3. Frontend progress service, hook, paging, deletions | 3a | R13, R14, R15, R16, R17 (hook), R20, R21 | 2 | 8 |
| 4a. Shared progress gate + structure `refetch` | 3b | R17 (`useActiveTemplateStructure.refetch`), R37 | 3 | 5 |
| 4b. Dashboard progress states, article query, page-level templates ErrorState | 3c | R18 | 4a | 12 |
| 4c. Worklist tables through the shared gate, delete `getCurrentUserId` | 3d | R19, R35 | 4a, 4b | 10 |
| 5. Collapsed rail as a dot strip + rail copy | 4 | R22, R23, R24, R34 | 0 | 6 |
| 6. Position-based active section + pane scroll | 5 | R25, R26, R27, R28, R29 | 5 | 6 |
| 7. Dev tooling (`launch.json` with `db-migrate`, Vite `PORT`) | 6 | R1, R2 | 0 | 2 |
| 8. Pager keys `[` / `]` | 7 | R30, R31, R32 | 5, 6 | 1 |
| 9. Port the QA dashboard consumer to the shared gate | 8 | R38 | 0, 1a, 1b, 2, 3, 4a, 4b, 4c, 5, 6, 7, 8 | 3 |
| **Total** | | | | **79** |

Task 4a's count is the spec's 3 plus 2 plan-added `resolveProgressGate` tests, which cover a helper this plan introduces (ledger pre-flight ruling 2); the spec's R-lists are unchanged.

Renamed after the panel: the former Task 1 is split into **1a/1b** (its brief would exceed 300 lines once the resolver, the B2 precedence tests and the one-statement form-run choice are added). The former 4a (dashboard) is **4b**, and the former 4b (tables) is **4c**. The new **4a** holds the shared gate. **Task 0** runs first and adds no tests. It makes one path-scoped `chore` commit of the imported WIP, then MERGES `origin/dev` (`b3192e7e` or newer; never rebase). It resolves any `frontend/test/QualityAssessmentInterface.test.tsx` conflict (predicted clean on `b3192e7e`) and applies only the minimal typecheck bridge named in File Structure. It verifies with `npm run typecheck` (exit 0) and `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx`. **Task 9 is mandatory** (PR #911 merged on `origin/dev` `b3192e7e`) and has no merge step: Task 0 already brought the peer's consumer in. It ports that consumer to `useCallerArticleProgress` and the R17 shape, with R38's precedence and retry guard. It then re-runs knip in both modes, `npm run typecheck`, and the QualityAssessmentInterface suite. The tree on the merged base wins over the ledger's "Rebase obligation" summary.

## Tasks

### Task 0: Sync with dev — commit the imported WIP, merge `origin/dev`

**Files:**
- Commit (one path-scoped `chore` commit): the 33 paths staged at import, the 4 untracked files `frontend/lib/extraction/loadArticleProgressData.ts`, `frontend/lib/extraction/loadArticleProgressData.test.ts`, `frontend/lib/runs/paneScroll.ts` and `frontend/lib/runs/paneScroll.test.ts`, plus the spec and this plan (both intent-to-add today). Nothing under `.superpowers/` (gitignored by `.gitignore:178`).
- Merge: `origin/dev` (`b3192e7e` = PR #911, or newer). #911 changes `frontend/components/quality/QualityAssessmentInterface.tsx`, `frontend/lib/copy/qa.ts` and `frontend/test/QualityAssessmentInterface.test.tsx`.
- Modify (typecheck bridge): `frontend/components/quality/QualityAssessmentInterface.tsx:44-47` (import), `frontend/hooks/extraction/useArticleExtractionValues.ts:47-53` (return).
- Test: none new. Existing `frontend/test/QualityAssessmentInterface.test.tsx` (9 tests).

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (Tasks 1a–9 build on it): the merged base. `QualityAssessmentInterface.tsx` is #911's version, importing `useArticleExtractionValues` from `@/hooks/extraction/useArticleExtractionValues` and `articleExtractionValuesKeys` from `@/lib/query-keys/extraction`, and destructuring `error: valuesError`. The WIP hook `useArticleExtractionValues(projectId, templateId, userId, kind)` temporarily returns `{ valuesByArticle, isLoading, error }` (bridge; Task 3 replaces it with the contract's `{ valuesByArticle, isLoading, isError, isUnavailable, refetch }` and removes `error`). #911's test mocks `@/hooks/extraction/useArticleExtractionValues` at the module boundary with a hoisted `progress` state (`valuesByArticle`, `isLoading`, `error`), and its `makeBuilder` carries the WIP's `range: () => b,` (R14). Copy key `qa.dashboardLoadError` exists.

All commands run from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip` (below: `W`). Run every `git` command on its own line: the worktree shell guard refuses compound lines (`&&`, `;`, `$( )`) that contain `git`. So the brief's `git fetch origin dev && git merge origin/dev` is split into two plain commands.

- [ ] **Step 1: Confirm the dependencies are present**

Run: `test -d node_modules && test -d backend/.venv && test -f .env && test -f backend/.env && echo DEPS_OK`
Expected: `DEPS_OK`. If it prints nothing, install only what is missing, the same way as CI: `npm ci` (worktree root); `cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/backend && uv sync --frozen --extra dev`; `cp /Users/raphael/PycharmProjects/prumo/.env /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/.env`; `cp /Users/raphael/PycharmProjects/prumo/backend/.env /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/backend/.env`. Re-run the check.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip branch --show-current`
Expected: `feat/run-nav-and-dev-server`.

- [ ] **Step 2: Commit the imported WIP, path-scoped (spec and plan included)**

The spec and plan go into THIS commit, not a separate step (Global Constraints: "plus the spec and this plan"). First confirm the tree holds exactly the expected WIP:

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip status --porcelain`
Expected: 39 lines. 33 `M ` lines (the paths in the `add` command below, minus the six `A`/`??` paths), ` A docs/superpowers/plans/2026-09-14-run-nav-and-dev-server.md`, ` A docs/superpowers/specs/2026-09-14-run-nav-and-dev-server-design.md`, and `??` for the four untracked files. If any other path prints, STOP and report it: do not commit a path this list does not name.

Untracked files cannot be committed by pathspec alone, so add first. Run as ONE command:

```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add -- .claude/launch.json frontend/components/extraction/ArticleExtractionTable.test.tsx frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/extraction/ExtractionFormView.tsx frontend/components/extraction/ExtractionInterface.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/extraction/SectionNavRail.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/components/runs/SectionNavLayout.tsx frontend/components/runs/header/Worklist.tsx frontend/components/runs/header/__tests__/Help.test.tsx frontend/components/runs/header/__tests__/Worklist.test.tsx frontend/e2e/flows/extraction-article-pager.ui.e2e.ts frontend/hooks/extraction/useActiveSection.ts frontend/hooks/extraction/useArticleExtractionValues.ts frontend/hooks/extraction/useJumpToNextPendingField.test.tsx frontend/hooks/extraction/useJumpToNextPendingField.ts frontend/hooks/qa/useQASectionNav.ts frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx frontend/hooks/runs/useRunShortcuts.ts frontend/lib/copy/runs.ts frontend/lib/query-keys/extraction.ts frontend/lib/runs/shortcuts.ts frontend/pages/QualityAssessmentFullScreen.tsx frontend/services/articlesService.ts frontend/test/ExtractionFullScreen.articleSwitch.test.tsx frontend/test/QualityAssessmentFullScreen.navigation.test.tsx frontend/test/QualityAssessmentInterface.test.tsx frontend/test/SectionNavRail.test.tsx frontend/test/helpers/qaFullScreenMocks.tsx frontend/test/services/articlesService.test.ts frontend/test/useActiveSection.test.tsx vite.config.ts frontend/lib/extraction/loadArticleProgressData.ts frontend/lib/extraction/loadArticleProgressData.test.ts frontend/lib/runs/paneScroll.ts frontend/lib/runs/paneScroll.test.ts docs/superpowers/specs/2026-09-14-run-nav-and-dev-server-design.md docs/superpowers/plans/2026-09-14-run-nav-and-dev-server.md
```

Then commit with the same 39 paths as the pathspec. Run as ONE command:

```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "chore(run-nav): import the run-nav and dev-server work in progress" -m "Commits the imported WIP (article paging, section rail, scrollspy, pager keys, Vite PORT, the untracked progress loader and pane-scroll helpers) with its spec and plan, so the branch can merge origin/dev without replaying a conflict inside a later task." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- .claude/launch.json frontend/components/extraction/ArticleExtractionTable.test.tsx frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/extraction/ExtractionFormView.tsx frontend/components/extraction/ExtractionInterface.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/extraction/SectionNavRail.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/components/runs/SectionNavLayout.tsx frontend/components/runs/header/Worklist.tsx frontend/components/runs/header/__tests__/Help.test.tsx frontend/components/runs/header/__tests__/Worklist.test.tsx frontend/e2e/flows/extraction-article-pager.ui.e2e.ts frontend/hooks/extraction/useActiveSection.ts frontend/hooks/extraction/useArticleExtractionValues.ts frontend/hooks/extraction/useJumpToNextPendingField.test.tsx frontend/hooks/extraction/useJumpToNextPendingField.ts frontend/hooks/qa/useQASectionNav.ts frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx frontend/hooks/runs/useRunShortcuts.ts frontend/lib/copy/runs.ts frontend/lib/query-keys/extraction.ts frontend/lib/runs/shortcuts.ts frontend/pages/QualityAssessmentFullScreen.tsx frontend/services/articlesService.ts frontend/test/ExtractionFullScreen.articleSwitch.test.tsx frontend/test/QualityAssessmentFullScreen.navigation.test.tsx frontend/test/QualityAssessmentInterface.test.tsx frontend/test/SectionNavRail.test.tsx frontend/test/helpers/qaFullScreenMocks.tsx frontend/test/services/articlesService.test.ts frontend/test/useActiveSection.test.tsx vite.config.ts frontend/lib/extraction/loadArticleProgressData.ts frontend/lib/extraction/loadArticleProgressData.test.ts frontend/lib/runs/paneScroll.ts frontend/lib/runs/paneScroll.test.ts docs/superpowers/specs/2026-09-14-run-nav-and-dev-server-design.md docs/superpowers/plans/2026-09-14-run-nav-and-dev-server.md
```

Expected: the commit succeeds (the repo has only a pre-push hook; never `--no-verify`).

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --shortstat --format=%s HEAD`
Expected: subject `chore(run-nav): import the run-nav and dev-server work in progress` and `39 files changed`.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip status --porcelain`
Expected: no output. The tree is clean, so from here on nothing is staged.

- [ ] **Step 3: Fetch and merge `origin/dev` (never rebase)**

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip fetch origin dev`
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip log --oneline HEAD..origin/dev`
Expected: `b3192e7e fix(qa): surface dashboard read failures instead of zero counts (#911)`, possibly with newer dev commits above it. Name any newer commit in the report.

Merge without committing, so the bridge (Step 5) lands in the merge commit and no commit on the branch fails typecheck:
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip merge --no-ff --no-commit origin/dev`
Expected (predicted): `Automatic merge went well; stopped before committing as requested`. A 3-way `git merge-file` of the three versions of `frontend/test/QualityAssessmentInterface.test.tsx` (base `801d0a2d`, the WIP, `b3192e7e`) resolves with no conflict: #911's edit to the `makeBuilder` signature and `result` line ends 5 unchanged lines above the WIP's `range: () => b,` insertion, and #911's `defaultRows` rewrite starts below it. #911's other two files are untouched by the WIP, and no other WIP path is changed on `b3192e7e`.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip diff --name-only --diff-filter=U`
Expected: no output. If a path other than `frontend/test/QualityAssessmentInterface.test.tsx` prints (possible only if dev moved past `b3192e7e`), run `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip merge --abort`, then STOP and report `unexpected merge conflict` with the paths.

- [ ] **Step 4: Resolve the test-file conflict (only if Step 3 reported one)**

`frontend/test/QualityAssessmentInterface.test.tsx`, hunk by hunk:
- Imports, the `ARTICLE_1` / `db` / `session` / `progress` hoisted state, the `@/hooks/extraction/useArticleExtractionValues` mock, the `useAuth` mock, the supabase `from` body with `defaultRows`, `renderInterface(entry)`, `beforeEach`, and the `QualityAssessmentInterface dashboard` describe: **theirs (#911) wins in full**. The WIP did not change these lines.
- `makeBuilder`: **theirs wins for the signature and the `result` line; ours wins for `range: () => b,`**. `fetchProjectArticles` pages through `selectAllProjectArticles` with `.range(...)` (R13), so without the stub every test throws `range is not a function`. The resolved function must read exactly:

```tsx
  function makeBuilder(rows: unknown, error: { message: string } | null = null) {
    const result = { data: error ? null : rows, error, count: null };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      range: () => b,
      then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
    };
    return b;
  }
```

`frontend/components/quality/QualityAssessmentInterface.tsx` and `frontend/lib/copy/qa.ts`: the WIP never touched them, so they cannot conflict. They arrive as #911's versions.

Whether or not a conflict occurred, check:
Run: `grep -n '^<<<<<<<\|^>>>>>>>\|^=======' frontend/test/QualityAssessmentInterface.test.tsx`
Expected: no output.
Run: `grep -c 'range: () => b,' frontend/test/QualityAssessmentInterface.test.tsx`
Expected: `1`.
Run: `grep -c 'const defaultRows' frontend/test/QualityAssessmentInterface.test.tsx`
Expected: `1`.
If you edited the file: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add -- frontend/test/QualityAssessmentInterface.test.tsx`

- [ ] **Step 5: Apply the minimal typecheck bridge**

Run: `npm run typecheck`
Expected: FAIL, with diagnostics ONLY in `frontend/components/quality/QualityAssessmentInterface.tsx`: the hook module has no exported member `articleExtractionValuesKeys` (#911's import at :44-47), and property `error` does not exist on the hook's return (:103). If any other file reports an error, STOP and report the diagnostics: the bridge covers only these two.

In `frontend/components/quality/QualityAssessmentInterface.tsx`, before:
```tsx
import {
  articleExtractionValuesKeys,
  useArticleExtractionValues,
} from "@/hooks/extraction/useArticleExtractionValues";
```
After:
```tsx
import { useArticleExtractionValues } from "@/hooks/extraction/useArticleExtractionValues";
import { articleExtractionValuesKeys } from "@/lib/query-keys/extraction";
```

In `frontend/hooks/extraction/useArticleExtractionValues.ts`, before:
```ts
    isLoading: query.isPending || query.isError,
  };
}
```
After:
```ts
    isLoading: query.isPending || query.isError,
    error: query.error,
  };
}
```

Nothing else changes. Task 3 removes `error` from the hook and ports the destructure to `isError`; Task 9 ports the consumer to `useCallerArticleProgress`.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add -- frontend/components/quality/QualityAssessmentInterface.tsx frontend/hooks/extraction/useArticleExtractionValues.ts`

- [ ] **Step 6: Verify**

Run: `npm run typecheck; echo "TYPECHECK_EXIT=$?"`
Expected: `TYPECHECK_EXIT=0`, no diagnostics.

Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx; echo "VITEST_EXIT=$?"`
Expected: `Tests  9 passed (9)` (4 in `QualityAssessmentInterface`, 5 in `QualityAssessmentInterface dashboard`) and `VITEST_EXIT=0`.

If either fails, fix only inside the bridge or the conflict resolution. Never touch other files here.

- [ ] **Step 7: Commit the merge and record its SHA**

Git refuses a path-scoped (partial) commit while a merge is in progress, so this one commit takes the whole index. Check the index first:
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip status --porcelain`
Expected: only `M ` lines for #911's three files and the two bridge files (plus any files a newer dev commit brought, as named in Step 3). No `UU`, `AA` or ` M` lines, and no `??`.

Run as ONE command:
```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "chore(sync): merge origin/dev into feat/run-nav-and-dev-server" -m "Brings in #911 (QA dashboard read failures). Minimal typecheck bridge: its dashboard imports articleExtractionValuesKeys from @/lib/query-keys/extraction, and the in-progress hook returns error until the article-progress port replaces that shape." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip rev-parse HEAD`
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip rev-parse HEAD^2`
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip rev-parse origin/dev`
Expected: `HEAD^2` equals `origin/dev` (`b3192e7eadd720609b3be08994052e7c35506372` or newer). Report the merge SHA (`HEAD`), the WIP commit SHA (`HEAD^1`), and the Step 6 exit codes against that merge SHA. Never push.

### Task 1a: Backend kind-agnostic progress read + one reviewer-value resolver

Spec cluster 1a (R7, R9, R11, R12). Run commands from `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/backend` with the local Supabase stack up; never `make reset-db` or `make db-fresh`. Code blocks are compressed but valid Python; Step 9's ruff restores the layout. No form-run scoping here (Task 1b adds it); every test run is at stage `extract`, so the tests stay valid after 1b.

**Files:**
- Create: `backend/app/schemas/article_progress.py`, `backend/app/repositories/article_progress_repository.py`, `backend/app/services/article_progress_service.py`
- Modify: `backend/app/services/value_semantics.py` (add `resolve_reviewer_value`), `backend/app/services/run_lifecycle_service.py` (`_resolved_reviewer_values` calls it; 795 → 791 lines)
- Test (create): `backend/tests/integration/test_article_progress_read.py`

**Interfaces:**
- Consumes: `owned_template(db, *, project_id, template_id, kind=None, for_update=False)` (`app/services/project_template_active_service.py:34`, raises `ProjectTemplateNotFoundError`); `is_value_empty`, `is_value_filled`, `strip_verification` (`app/services/value_semantics.py`); `TemplateFactory` (`tests/factories/template_factory.py:75`); `SEED` (`tests/integration/conftest.py:147`).
- Produces (contract names, verbatim): `ArticleProgressKind`, `ArticleProgressInstanceRead`, `ArticleProgressValueRead`, `ArticleProgressItemRead`, `ArticleProgressRead`; `ArticleProgressRepository(db)` with `list_instances(*, project_id, template_id) -> list[ProgressInstanceRow]` and `list_caller_values(...) -> list[CallerValueRow]`; the frozen dataclasses `ProgressInstanceRow` and `CallerValueRow`; `resolve_reviewer_value(decision: str, value: Any, proposed_value: Any) -> Any | None`; `async def get_article_progress(db: AsyncSession, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> ArticleProgressRead`.
- **Interim signature (1a only):** `list_caller_values(self, *, project_id: UUID, template_id: UUID, user_id: UUID)`, with NO `kind` parameter. The statement does not use `kind` until Task 1b, and an unused parameter fails two gates: vulture reports `unused variable 'kind' (100% confidence)` and ruff reports `ARG002`. Task 1b adds `kind: ArticleProgressKind` and passes it from the service, which yields the contract signature.

- [ ] **Step 1: Record the regression baseline first.** Run `uv run pytest tests/integration/test_run_lifecycle_service.py tests/integration/test_absent_reason_gate.py -q` and write down its `N passed, M skipped` line. Expected: `0 failed`. These suites guard `_resolved_reviewer_values`: `test_accepted_marker_round_trips_to_published_and_fills_gate` calls it directly, and `test_annotated_accept_agrees_with_clean_edit_and_publishes_clean` exercises the accept path.

- [ ] **Step 2: Write the 11 failing tests.** Create `backend/tests/integration/test_article_progress_read.py`. `_VERSION` joins `project_extraction_templates` and filters `project_id`, because `extraction_template_versions` has no `project_id` column (backend.md § Tests):
```python
"""Article progress read (spec R7-R12): service tests; Tasks 1b and 2 append. created_at is explicit (now() is fixed per transaction)."""
from __future__ import annotations
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.extraction import ExtractionRun
from app.models.extraction_workflow import ExtractionProposalRecord, ExtractionReviewerDecision, ExtractionReviewerState
from app.repositories.article_progress_repository import ArticleProgressRepository
from app.schemas.article_progress import ArticleProgressKind, ArticleProgressRead
from app.services.article_progress_service import get_article_progress
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED
PID, ME, OTHER = SEED.primary_project, SEED.primary_profile, SEED.reviewer_profile
T0 = datetime(2026, 1, 1, tzinfo=UTC)
MARKER = {"value": None, "absent_reason": "no_information"}
_FIELD = ("INSERT INTO public.extraction_fields (id, entity_type_id, name, label, field_type, is_required) "
          "VALUES (:id, :et, 'arm_name', 'Arm name', 'text', false)")
_ARTICLES = ("INSERT INTO public.articles (id, project_id, title, row_version) SELECT gen_random_uuid(), "
             ":pid, 'progress ' || g, 1 FROM generate_series(1, :n) g RETURNING id")
_INSTANCES = ("INSERT INTO public.extraction_instances (id, project_id, template_id, entity_type_id, article_id, label, "
              "created_by) SELECT gen_random_uuid(), :pid, :tid, :et, a.id, 'arm', :uid "
              "FROM unnest(CAST(:aids AS uuid[])) AS a(id), generate_series(1, :k) RETURNING id, article_id")
_VERSION = ("SELECT v.id FROM public.extraction_template_versions v JOIN public.project_extraction_templates t "
            "ON t.id = v.project_template_id WHERE t.project_id = :pid AND v.project_template_id = :t AND v.is_active")
class World(NamedTuple):
    kind: ArticleProgressKind; tid: UUID; fid: UUID; aids: list[UUID]; inst: dict[UUID, list[UUID]]  # article_id -> instance ids
async def _world(db: AsyncSession, *, kind: ArticleProgressKind = "extraction", articles: int = 1, per_article: int = 1) -> World:
    factory = TemplateFactory(db, PID, ME)
    tid = await factory.create(name=f"progress-{uuid4().hex[:8]}", kind=kind)
    etid = await factory.add_study_section(tid, name="arms", cardinality="many")  # many: N instances per article
    fid = uuid4()
    await db.execute(text(_FIELD), {"id": str(fid), "et": str(etid)})
    aids = list((await db.execute(text(_ARTICLES), {"pid": str(PID), "n": articles})).scalars())
    params = {"pid": str(PID), "tid": str(tid), "et": str(etid), "uid": str(ME), "k": per_article, "aids": [str(a) for a in aids]}
    inst: dict[UUID, list[UUID]] = {a: [] for a in aids}
    for iid, aid in (await db.execute(text(_INSTANCES), params)).all():
        inst[aid].append(iid)
    return World(kind, tid, fid, aids, inst)
async def _add(db: AsyncSession, row: Any) -> UUID:
    db.add(row)
    await db.flush()
    return row.id
async def _run(db: AsyncSession, w: World, aid: UUID, stage: str, minute: int) -> UUID:
    vid = (await db.execute(text(_VERSION), {"pid": str(PID), "t": str(w.tid)})).scalar_one()
    return await _add(db, ExtractionRun(project_id=PID, article_id=aid, template_id=w.tid, kind=w.kind, version_id=vid, stage=stage,
                                        status="pending", created_by=ME, created_at=T0 + timedelta(minutes=minute)))
async def _decide(db: AsyncSession, run: UUID, iid: UUID, fid: UUID, decision: str, value: Any = None, *,
                  proposal: UUID | None = None, reviewer: UUID = ME, minute: int = 0) -> UUID:
    return await _add(db, ExtractionReviewerDecision(id=uuid4(), run_id=run, instance_id=iid, field_id=fid, reviewer_id=reviewer,
                      decision=decision, value=value, proposal_record_id=proposal, created_at=T0 + timedelta(minutes=minute)))
async def _point(db: AsyncSession, run: UUID, iid: UUID, fid: UUID, decision_id: UUID, reviewer: UUID = ME) -> None:
    await _add(db, ExtractionReviewerState(id=uuid4(), run_id=run, instance_id=iid, field_id=fid, reviewer_id=reviewer, current_decision_id=decision_id))
async def _state(db: AsyncSession, run: UUID, iid: UUID, fid: UUID, decision: str, value: Any = None, *,
                 proposal: UUID | None = None, reviewer: UUID = ME, minute: int = 0) -> None:
    await _point(db, run, iid, fid, await _decide(db, run, iid, fid, decision, value, proposal=proposal, reviewer=reviewer, minute=minute), reviewer)
async def _proposal(db: AsyncSession, run: UUID, iid: UUID, fid: UUID, raw: Any, *, minute: int = 0,
                    user: UUID | None = ME, source: str = "human") -> UUID:
    return await _add(db, ExtractionProposalRecord(id=uuid4(), run_id=run, instance_id=iid, field_id=fid, source=source,
                      source_user_id=user, proposed_value=raw, created_at=T0 + timedelta(minutes=minute)))
async def _read(db: AsyncSession, w: World) -> ArticleProgressRead:
    return await get_article_progress(db, project_id=PID, template_id=w.tid, user_id=ME, kind=w.kind)
async def _values(db: AsyncSession, w: World) -> dict[UUID, dict[tuple[UUID, UUID], Any]]:
    return {a.article_id: {(v.instance_id, v.field_id): v.value for v in a.values} for a in (await _read(db, w)).articles}
async def _one_coord(db: AsyncSession, kind: ArticleProgressKind = "extraction") -> tuple[World, UUID, UUID, UUID]:
    w = await _world(db, kind=kind)
    return w, w.aids[0], w.inst[w.aids[0]][0], await _run(db, w, w.aids[0], "extract", 0)
async def test_second_reviewer_rows_never_appear(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _proposal(db_session, run, iid, w.fid, {"value": "mine"}, minute=1)
    await _state(db_session, run, iid, w.fid, "edit", {"value": "theirs"}, reviewer=OTHER)  # a leaked state would beat my proposal
    await _proposal(db_session, run, iid, w.fid, {"value": "theirs, newer"}, minute=5, user=OTHER)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "mine"}}
async def test_rejected_decision_falls_back_to_human_proposal(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _state(db_session, run, iid, w.fid, "reject")
    await _proposal(db_session, run, iid, w.fid, {"value": "kept"})
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "kept"}}
async def test_newest_nonempty_human_proposal_wins(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    for minute, raw in enumerate(({"value": "old"}, {"value": "new"}, {"value": ""}, {"value": None})):
        await _proposal(db_session, run, iid, w.fid, raw, minute=minute)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "new"}}
async def test_absent_reason_marker_counts_as_value(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _proposal(db_session, run, iid, w.fid, {"value": "old"}, minute=0)
    await _proposal(db_session, run, iid, w.fid, MARKER, minute=1)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): MARKER}
async def test_accepted_ai_proposal_counts_as_a_value(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    ai = await _proposal(db_session, run, iid, w.fid, {"value": "ai"}, user=None, source="ai")
    await _state(db_session, run, iid, w.fid, "accept_proposal", proposal=ai)  # value stays None, as accept_proposal stores it
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "ai"}}
async def test_accepted_absent_reason_marker_counts_as_filled(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _proposal(db_session, run, iid, w.fid, {"value": "older own"}, minute=0)
    ai = await _proposal(db_session, run, iid, w.fid, MARKER, minute=1, user=None, source="ai")
    await _state(db_session, run, iid, w.fid, "accept_proposal", proposal=ai, minute=2)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): MARKER}
async def test_own_edit_state_wins_over_own_newer_human_proposal(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _state(db_session, run, iid, w.fid, "edit", {"value": "state"}, minute=0)
    await _proposal(db_session, run, iid, w.fid, {"value": "newer proposal"}, minute=9)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "state"}}
async def test_superseded_decision_is_ignored_for_the_current_decision(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    # The superseded row carries the LATER created_at, so only the current_decision_id join (not recency) picks the current one.
    await _decide(db_session, run, iid, w.fid, "edit", {"value": "superseded"}, minute=5)
    current = await _decide(db_session, run, iid, w.fid, "edit", {"value": "current"}, minute=1)
    await _point(db_session, run, iid, w.fid, current)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "current"}}
async def test_quality_assessment_is_not_run_scoped(db_session: AsyncSession) -> None:
    w, aid, iid, _ = await _one_coord(db_session, kind="quality_assessment")
    await _proposal(db_session, await _run(db_session, w, aid, "cancelled", 1), iid, w.fid, {"value": "cancelled run"})
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "cancelled run"}}
async def test_template_without_instances_returns_empty_list(db_session: AsyncSession) -> None:
    assert (await _read(db_session, await _world(db_session, per_article=0))).articles == []
async def test_template_without_instances_runs_no_value_query(db_session: AsyncSession) -> None:
    w = await _world(db_session, per_article=0)
    with patch.object(ArticleProgressRepository, "list_caller_values", new_callable=AsyncMock) as values:
        assert (await _read(db_session, w)).articles == []
    values.assert_not_awaited()
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run `uv run pytest tests/integration/test_article_progress_read.py -v`. Expected: collection ERROR, `ModuleNotFoundError: No module named 'app.repositories.article_progress_repository'`.

- [ ] **Step 4: Write the schemas.** Create `backend/app/schemas/article_progress.py`. It imports nothing from `app.models` (layering).
```python
"""Article progress read model (spec R3): articles ordered by article_id, instances by id."""
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel
ArticleProgressKind = Literal["extraction", "quality_assessment"]
class ArticleProgressInstanceRead(BaseModel): id: UUID; entity_type_id: UUID
class ArticleProgressValueRead(BaseModel): instance_id: UUID; field_id: UUID; value: Any
class ArticleProgressItemRead(BaseModel): article_id: UUID; instances: list[ArticleProgressInstanceRead]; values: list[ArticleProgressValueRead]
class ArticleProgressRead(BaseModel): articles: list[ArticleProgressItemRead]
```

- [ ] **Step 5: Add the one resolver.** In `backend/app/services/value_semantics.py`, add directly below `is_value_filled`. It uses the literal `"reject"`, because this module stays pure (no model import):
```python
def resolve_reviewer_value(decision: str, value: Any, proposed_value: Any) -> Any | None:
    """A reviewer's CURRENT decision -> its value, or ``None`` for ``reject`` or an empty result. ``accept_proposal`` stores
    ``value=None``, so it resolves to ``proposed_value``; a filled result loses ``verification``. The ONE resolver (lifecycle + progress)."""
    if decision == "reject":
        return None
    resolved = value if value is not None else proposed_value
    return strip_verification(resolved) if is_value_filled(resolved) else None
```

- [ ] **Step 6: Refactor `_resolved_reviewer_values` onto it.** In `backend/app/services/run_lifecycle_service.py`, replace the 10 lines at :577-586, from `resolved_values: list[tuple[UUID, UUID, Any]] = []` through `return resolved_values` (today they skip `reject`, fall back to `proposal_values.get(proposal_record_id)` and strip filled values inline), with:
```python
        resolved_values: list[tuple[UUID, UUID, Any]] = []
        for instance_id, field_id, decision, value, proposal_record_id in state_rows:
            proposed = proposal_values.get(proposal_record_id) if proposal_record_id else None
            resolved = resolve_reviewer_value(decision, value, proposed)
            if resolved is not None:
                resolved_values.append((instance_id, field_id, resolved))
        return resolved_values
```
Then delete the `    ExtractionReviewerDecisionType,` line from the `app.models.extraction_workflow` import block (:27; its only use was :579). Change :37 to `from app.services.value_semantics import is_value_filled, resolve_reviewer_value, strip_verification` (100 chars; `is_value_filled` is still used at :527 and `strip_verification` at :763). Run `wc -l app/services/run_lifecycle_service.py`. Expected: `791`. Run the Step 1 command again. Expected: the same `N passed, M skipped` line, `0 failed`.

- [ ] **Step 7: Write the repository.** Create `backend/app/repositories/article_progress_repository.py`. Every `.where()` holds equalities with no `id` column, so `check_scope_guards.py` sees no ownership predicate. The id comparisons live in `join()`.
```python
"""Set-based reads behind the article progress read (spec R8-R12); no statement binds a Python id list. list_caller_values
is ONE statement: current-decision states (LEFT JOIN accepted proposal) UNION ALL human proposals; instances filter project+template."""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from sqlalchemy import String, and_, cast, literal_column, null, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.models.extraction import ExtractionInstance
from app.models.extraction_workflow import ExtractionProposalRecord, ExtractionReviewerDecision, ExtractionReviewerState
@dataclass(frozen=True)
class ProgressInstanceRow: id: UUID; article_id: UUID; entity_type_id: UUID
@dataclass(frozen=True)
class CallerValueRow:
    source: Literal["state", "proposal"]; instance_id: UUID; field_id: UUID; decision: str | None
    value: Any; proposed_value: Any; created_at: datetime; id: UUID
class ArticleProgressRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
    async def list_instances(self, *, project_id: UUID, template_id: UUID) -> list[ProgressInstanceRow]:
        inst = ExtractionInstance
        stmt = (select(inst.id, inst.article_id, inst.entity_type_id)
                .where(inst.project_id == project_id, inst.template_id == template_id)
                .where(inst.article_id.is_not(None)).order_by(inst.article_id, inst.id))
        return [ProgressInstanceRow(*row) for row in (await self.db.execute(stmt)).all()]
    async def list_caller_values(self, *, project_id: UUID, template_id: UUID, user_id: UUID) -> list[CallerValueRow]:
        inst, state, dec, prop = ExtractionInstance, ExtractionReviewerState, ExtractionReviewerDecision, ExtractionProposalRecord
        accepted = aliased(ExtractionProposalRecord)
        states = (select(literal_column("'state'", String).label("source"), state.instance_id, state.field_id,
                         cast(dec.decision, String).label("decision"), dec.value.label("value"),
                         accepted.proposed_value.label("proposed_value"), dec.created_at, dec.id)
                  .select_from(state)
                  .join(dec, and_(dec.id == state.current_decision_id, dec.run_id == state.run_id))
                  .outerjoin(accepted, accepted.id == dec.proposal_record_id)
                  .join(inst, inst.id == state.instance_id)
                  .where(inst.project_id == project_id, inst.template_id == template_id)
                  .where(state.reviewer_id == user_id))
        proposals = (select(literal_column("'proposal'", String).label("source"), prop.instance_id, prop.field_id,
                            cast(null(), String).label("decision"), prop.proposed_value.label("value"),
                            cast(null(), JSONB).label("proposed_value"), prop.created_at, prop.id)
                     .select_from(prop)
                     .join(inst, inst.id == prop.instance_id)
                     .where(inst.project_id == project_id, inst.template_id == template_id)
                     .where(prop.source == "human", prop.source_user_id == user_id))
        values = union_all(states, proposals).subquery("caller_values")
        stmt = select(values).order_by(values.c.created_at.desc(), values.c.id.desc())  # proposals newest first
        return [CallerValueRow(*row) for row in (await self.db.execute(stmt)).all()]
```

- [ ] **Step 8: Write the service.** Create `backend/app/services/article_progress_service.py`:
```python
"""The caller's article progress per template (spec R7-R12). Per (instance_id, field_id): the current decision wins when
resolve_reviewer_value resolves it, else the newest non-empty human proposal; an absent_reason marker is filled (§IX)."""
from typing import Any
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.article_progress_repository import ArticleProgressRepository
from app.schemas.article_progress import (ArticleProgressInstanceRead, ArticleProgressItemRead, ArticleProgressKind,
                                          ArticleProgressRead, ArticleProgressValueRead)
from app.services.project_template_active_service import owned_template
from app.services.value_semantics import is_value_empty, resolve_reviewer_value
async def get_article_progress(db: AsyncSession, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> ArticleProgressRead:
    await owned_template(db, project_id=project_id, template_id=template_id, kind=kind)
    repo = ArticleProgressRepository(db)
    instances = await repo.list_instances(project_id=project_id, template_id=template_id)
    if not instances:
        return ArticleProgressRead(articles=[])
    items: dict[UUID, ArticleProgressItemRead] = {}  # insertion order = article_id order
    article_of: dict[UUID, UUID] = {}
    for inst in instances:
        if inst.article_id not in items:
            items[inst.article_id] = ArticleProgressItemRead(article_id=inst.article_id, instances=[], values=[])
        items[inst.article_id].instances.append(ArticleProgressInstanceRead(id=inst.id, entity_type_id=inst.entity_type_id))
        article_of[inst.id] = inst.article_id
    rows = await repo.list_caller_values(project_id=project_id, template_id=template_id, user_id=user_id)
    winners: dict[tuple[UUID, UUID], Any] = {}
    for row in rows:  # pass 1: the caller's current decisions
        if row.source == "state" and row.decision is not None:
            resolved = resolve_reviewer_value(row.decision, row.value, row.proposed_value)
            if resolved is not None:
                winners.setdefault((row.instance_id, row.field_id), resolved)
    for row in rows:  # pass 2: human proposals, newest first (statement order)
        if row.source == "proposal" and not is_value_empty(row.value):
            winners.setdefault((row.instance_id, row.field_id), row.value)
    for (instance_id, field_id), value in winners.items():
        article_id = article_of.get(instance_id)  # None for an article-less instance
        if article_id is not None:
            items[article_id].values.append(ArticleProgressValueRead(instance_id=instance_id, field_id=field_id, value=value))
    return ArticleProgressRead(articles=list(items.values()))
```
Run `uv run pytest tests/integration/test_article_progress_read.py -v`. Expected: `11 passed`.

- [ ] **Step 9: Format, lint, and run the gates this task touches**
```bash
F="app/schemas/article_progress.py app/repositories/article_progress_repository.py app/services/article_progress_service.py app/services/value_semantics.py app/services/run_lifecycle_service.py tests/integration/test_article_progress_read.py"
bash -c "uv run ruff format $F && uv run ruff check --fix $F && uv run ruff format $F && uv run ruff check $F"  # bash splits $F; zsh would not
uv run pytest tests/integration/test_article_progress_read.py tests/integration/test_run_lifecycle_service.py tests/integration/test_absent_reason_gate.py -q
wc -l app/services/run_lifecycle_service.py && python3 ../scripts/fitness/check_file_size.py
python3 ../scripts/fitness/check_layered_arch.py
python3 ../scripts/fitness/check_scope_guards.py
git diff --exit-code ../scripts/fitness/check_scope_guards.baseline ../scripts/fitness/check_layered_arch.baseline ../scripts/fitness/check_file_size.baseline .vulture_baseline .mypy_baseline
{ uv run mypy app --ignore-missing-imports || true; } | uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline
uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
```
Expected: `All checks passed!`; pytest 11 more passed than Step 1, same skips, `0 failed`; `791` and file-size exit 0; `check_layered_arch.py: OK (…)`; `check_scope_guards: OK (…; 7 baselined duplication sites, none new)`; empty baseline diff; no new mypy entries; vulture `nothing new`. Never pass `--update`/`--update-baseline` or edit a baseline; delete any symbol vulture flags; split a string ruff reports as `E501`.

- [ ] **Step 10: Commit (path-scoped).** Run each line as its own command (the worktree guard refuses compound shell with git), from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`:
```bash
git add backend/app/schemas/article_progress.py backend/app/repositories/article_progress_repository.py backend/app/services/article_progress_service.py backend/tests/integration/test_article_progress_read.py
git commit -m "feat(extraction): caller-scoped article progress read and one reviewer-value resolver" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- backend/app/schemas/article_progress.py backend/app/repositories/article_progress_repository.py backend/app/services/article_progress_service.py backend/app/services/value_semantics.py backend/app/services/run_lifecycle_service.py backend/tests/integration/test_article_progress_read.py
git show --stat HEAD
```
Expected: `git show --stat HEAD` lists exactly those 6 paths.

### Task 1b: Extraction form-run scoping inside the one value statement

Spec cluster 1b (R8, R10). Run every command from `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip/backend` with the local Supabase stack up. Never run `make reset-db` or `make db-fresh`. This task builds on Task 1a's committed files. The code blocks are compressed to fit the brief; Step 7's `ruff format` restores the canonical layout. No index and no migration, whatever the timing shows (Global Constraints; spec §2).

**Files:**
- Modify: `backend/app/repositories/article_progress_repository.py` (add the `kind` parameter and the `form_runs` CTE to `list_caller_values`)
- Modify: `backend/app/services/article_progress_service.py` (one call: pass `kind=kind` to `list_caller_values`)
- Test (modify): `backend/tests/integration/test_article_progress_read.py` (append a capture helper and 6 tests)

**Interfaces:**
- Consumes (from Task 1a): the test helpers `World`, `_world`, `_run`, `_state`, `_proposal`, `_read`, `_values`, `_one_coord`, `PID`; `ArticleProgressRepository.list_caller_values(self, *, project_id, template_id, user_id)`; `get_article_progress`. From existing code, in the parity test only: `resolve_form_runs(db, article_ids, *, project_id, template_id) -> list[ArticleRunRef]` (`app/services/extraction_run_read_service.py:633`; its live stages are `_ACTIVE_STAGES` at :595).
- Produces (contract, verbatim): `async def list_caller_values(self, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> list[CallerValueRow]`. It is ONE statement. For `kind="extraction"` it defines ONE CTE named `form_runs` that both `UNION ALL` branches join on `run_id`; for `kind="quality_assessment"` it has no CTE (R11). Statements per read: `owned_template`, `list_instances`, `list_caller_values`.
- Why `kind` arrives only now: Task 1a's statement did not use it, and an unused parameter fails vulture (100% confidence) and ruff `ARG002`.

- [ ] **Step 1: Write the 6 tests.** In `backend/tests/integration/test_article_progress_read.py`, add `import re` above `from datetime import …`. Change `from sqlalchemy import text` to `from sqlalchemy import event, text`. Add `from app.services.extraction_run_read_service import resolve_form_runs` below the `article_progress_service` import. Then append:
```python
async def _statements(db: AsyncSession, w: World) -> list[tuple[str, Any]]:
    """Every (SQL, bind params) the read executes, captured at the cursor."""
    conn = (await db.connection()).sync_connection
    seen: list[tuple[str, Any]] = []
    def capture(_c: Any, _cur: Any, statement: str, params: Any, _ctx: Any, _many: bool) -> None:
        seen.append((statement, params))
    event.listen(conn, "before_cursor_execute", capture)
    try:
        await _read(db, w)
    finally:
        event.remove(conn, "before_cursor_execute", capture)
    return seen
async def test_more_than_1000_instances_returned_in_full(db_session: AsyncSession) -> None:
    w = await _world(db_session, per_article=1001)
    ids = [i.id for i in (await _read(db_session, w)).articles[0].instances]
    assert len(ids) == 1001 and set(ids) == set(w.inst[w.aids[0]]) and ids == sorted(ids)
async def test_extraction_ignores_values_from_a_stale_run(db_session: AsyncSession) -> None:
    w = await _world(db_session)
    aid, iid = w.aids[0], w.inst[w.aids[0]][0]
    await _state(db_session, await _run(db_session, w, aid, "finalized", 0), iid, w.fid, "edit", {"value": "stale"})
    await _proposal(db_session, await _run(db_session, w, aid, "extract", 1), iid, w.fid, {"value": "fresh"})
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "fresh"}}
async def test_article_without_form_run_is_listed_with_no_values(db_session: AsyncSession) -> None:
    w = await _world(db_session, articles=2)
    with_run, without = w.aids
    await _proposal(db_session, await _run(db_session, w, with_run, "extract", 0), w.inst[with_run][0], w.fid, {"value": "x"})
    await _proposal(db_session, await _run(db_session, w, without, "cancelled", 0), w.inst[without][0], w.fid, {"value": "y"})
    read = {a.article_id: a for a in (await _read(db_session, w)).articles}
    assert read[with_run].values and read[without].values == []
    assert [i.id for i in read[without].instances] == w.inst[without]  # listed with its instances: renders 0 %
async def test_bind_parameter_count_is_independent_of_article_count(db_session: AsyncSession) -> None:
    small = [len(p) for _, p in await _statements(db_session, await _world(db_session, articles=3))]
    large = [len(p) for _, p in await _statements(db_session, await _world(db_session, articles=1500))]
    assert len(small) == 3  # owned_template, list_instances, list_caller_values
    assert small == large
async def test_form_run_scoping_agrees_with_resolve_form_runs(db_session: AsyncSession) -> None:
    w = await _world(db_session, articles=3)
    mixed, finalized_only, no_run = w.aids
    plan = {mixed: [("cancelled", 2), ("finalized", 0), ("extract", 1)], finalized_only: [("finalized", 0), ("finalized", 1)], no_run: []}
    for aid, runs in plan.items():
        for stage, minute in runs:  # older runs get NEWER proposals: a leaked non-chosen run would win the merge
            run = await _run(db_session, w, aid, stage, minute)
            await _proposal(db_session, run, w.inst[aid][0], w.fid, {"value": str(run)}, minute=10 - minute)
    refs = await resolve_form_runs(db_session, w.aids, project_id=PID, template_id=w.tid)
    values = await _values(db_session, w)
    assert [r.run_id is None for r in refs] == [False, False, True]
    for ref in refs:
        want = {} if ref.run_id is None else {(w.inst[ref.article_id][0], w.fid): {"value": str(ref.run_id)}}
        assert values[ref.article_id] == want
async def test_values_are_read_in_one_statement_with_one_form_run_choice(db_session: AsyncSession) -> None:
    w, _, iid, run = await _one_coord(db_session)
    await _state(db_session, run, iid, w.fid, "edit", {"value": "x"})
    value_reads = [sql for sql, _ in await _statements(db_session, w)
                   if "extraction_reviewer_states" in sql or "extraction_proposal_records" in sql]
    assert len(value_reads) == 1
    assert "extraction_reviewer_states" in value_reads[0] and "extraction_proposal_records" in value_reads[0]
    assert len(re.findall(r"\bform_runs AS\s*\(", value_reads[0])) == 1  # SQLAlchemy renders "WITH form_runs AS \n("
```

- [ ] **Step 2: Run them and confirm the right ones fail.** Run `uv run pytest tests/integration/test_article_progress_read.py -v`. Expected: `4 failed, 13 passed`.
  - The 4 failures are `test_extraction_ignores_values_from_a_stale_run` (gets `stale`), `test_article_without_form_run_is_listed_with_no_values` (the cancelled run's `y` is listed), `test_form_run_scoping_agrees_with_resolve_form_runs` (the finalized run's newer proposal wins) and `test_values_are_read_in_one_statement_with_one_form_run_choice` (0 `form_runs` CTEs).
  - `test_more_than_1000_instances_returned_in_full` and `test_bind_parameter_count_is_independent_of_article_count` already pass. They guard R8, which 1a's statement shape already meets (no Python id list is bound), so they must stay green through Step 3.
  - Any other failure is a fixture error: fix the fixture before continuing.

- [ ] **Step 3: Add the `form_runs` CTE.** In `backend/app/repositories/article_progress_repository.py`:
  - Change the imports to `from sqlalchemy import CTE, String, and_, case, cast, literal_column, null, select, union_all` and `from app.models.extraction import ExtractionInstance, ExtractionRun, ExtractionRunStage`, and add `from app.schemas.article_progress import ArticleProgressKind`.
  - Below the imports, add (repositories may not import `extraction_run_read_service._ACTIVE_STAGES`, so the parity test pins the copy):
```python
_LIVE = (ExtractionRunStage.PENDING.value, ExtractionRunStage.EXTRACT.value, ExtractionRunStage.CONSENSUS.value)
def _form_runs(*, project_id: UUID, template_id: UUID) -> CTE:
    """Each article's form run with resolve_form_runs semantics: the newest live run, else the newest finalized run,
    never a cancelled one (parity: test_form_run_scoping_agrees_with_resolve_form_runs). Set-based: no id list is bound."""
    run = ExtractionRun
    return (select(run.id.label("run_id"))
            .where(run.project_id == project_id, run.template_id == template_id)
            .where(run.kind == "extraction", run.stage.in_([*_LIVE, ExtractionRunStage.FINALIZED.value]))
            .distinct(run.article_id)
            .order_by(run.article_id, case((run.stage.in_(_LIVE), 0), else_=1), run.created_at.desc(), run.id.desc())
            .cte("form_runs"))
```
  - Change the `list_caller_values` signature to `async def list_caller_values(self, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> list[CallerValueRow]:`.
  - Directly above `values = union_all(states, proposals).subquery("caller_values")`, insert:
```python
        if kind == "extraction":  # R10: ONE form-run choice both branches share, so one snapshot; QA is not run-scoped (R11)
            form_runs = _form_runs(project_id=project_id, template_id=template_id)
            states = states.join(form_runs, form_runs.c.run_id == state.run_id)
            proposals = proposals.join(form_runs, form_runs.c.run_id == prop.run_id)
```
  - In the module docstring, add after its first paragraph: `For kind="extraction" both branches join one form_runs CTE (R10), so the form-run choice is made once per request.`
  - None of these `.where()` calls compares an `id` column, so `check_scope_guards.py` sees no new ownership predicate.

- [ ] **Step 4: Pass `kind` from the service.** In `backend/app/services/article_progress_service.py`, change the call to `rows = await repo.list_caller_values(project_id=project_id, template_id=template_id, user_id=user_id, kind=kind)`.

- [ ] **Step 5: Run the file and confirm everything passes.** Run `uv run pytest tests/integration/test_article_progress_read.py -v`. Expected: `17 passed` (Task 1a's 11 and this task's 6, including `test_quality_assessment_is_not_run_scoped`, which proves the CTE is extraction-only).

- [ ] **Step 6: Record the >1000-instance timing (no index).** Run `uv run pytest "tests/integration/test_article_progress_read.py::test_more_than_1000_instances_returned_in_full" -v --durations=1`. Expected: `1 passed`, and a `slowest durations` line such as `N.NNs call tests/integration/test_article_progress_read.py::test_more_than_1000_instances_returned_in_full`. Copy that line verbatim into the task report, so the Task 1b ledger entry carries it. Add no index and no migration, whatever the number is. If an index looks warranted, name it as a follow-up in the report.

- [ ] **Step 7: Format, lint, and run the gates this task touches**
```bash
F="app/repositories/article_progress_repository.py app/services/article_progress_service.py tests/integration/test_article_progress_read.py"
bash -c "uv run ruff format $F && uv run ruff check --fix $F && uv run ruff format $F && uv run ruff check $F"  # bash splits $F; zsh would not
uv run pytest tests/integration/test_article_progress_read.py tests/integration/test_run_lifecycle_service.py tests/integration/test_absent_reason_gate.py -q
python3 ../scripts/fitness/check_layered_arch.py
python3 ../scripts/fitness/check_scope_guards.py
python3 ../scripts/fitness/check_file_size.py
git diff --exit-code ../scripts/fitness/check_scope_guards.baseline ../scripts/fitness/check_layered_arch.baseline ../scripts/fitness/check_file_size.baseline .vulture_baseline .mypy_baseline
{ uv run mypy app --ignore-missing-imports || true; } | uv run python ../scripts/mypy_baseline.py --baseline .mypy_baseline
uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec
git diff --stat -- alembic/versions
```
Expected:
- ruff: `All checks passed!`
- pytest: `0 failed`, with the progress file at 17 passed and the other two suites at their Task 1a counts.
- `check_layered_arch.py: OK (…)`, `check_scope_guards: OK (…; 7 baselined duplication sites, none new)`, and the file-size check exits 0.
- The baseline diff is empty and the mypy ratchet has no new entries. Vulture ends with `nothing new` (every `CallerValueRow` field is read by name, and `kind` is now used).
- `git diff --stat -- alembic/versions` prints nothing (no migration).

Never pass `--update` or `--update-baseline`, and never edit a baseline. If ruff reports `E501` on a string the formatter could not wrap, split the string.

- [ ] **Step 8: Commit (path-scoped).** Run each line as its own command, from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`:
```bash
git commit -m "feat(extraction): scope extraction progress values to the form run in one statement" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- backend/app/repositories/article_progress_repository.py backend/app/services/article_progress_service.py backend/tests/integration/test_article_progress_read.py
git show --stat HEAD
```
Expected: `git show --stat HEAD` lists exactly those 3 paths.

### Task 2: Article-progress endpoint, guards, rate limit, API types regen

Spec cluster 2 (R3, R4, R5, R6, R33, R36). 9 NEW tests. Depends on Task 1b.

**Files:**
- Modify: `backend/app/api/v1/endpoints/project_templates.py` (737/800 lines; projected about 770). Touch the imports (:36-107) and the module docstring (:1-31). Put the new handler directly after `get_template_active_version` (:594-617).
- Test: `backend/tests/integration/test_article_progress_read.py`. Task 1a creates it and Task 1b extends it; this task appends the HTTP tests.
- Modify (generated): `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

**Interfaces:**
- Consumes (Task 1a/1b): `async def get_article_progress(db: AsyncSession, *, project_id: UUID, template_id: UUID, user_id: UUID, kind: ArticleProgressKind) -> ArticleProgressRead` (`app.services.article_progress_service`); `ArticleProgressKind`, `ArticleProgressRead` (`app.schemas.article_progress`). The service calls `owned_template(db, project_id=project_id, template_id=template_id, kind=kind)` first, which raises `ProjectTemplateNotFoundError` (`app.services.project_template_active_service`) for a foreign, unknown or other-kind template, and returns `ArticleProgressRead(articles=[])` without calling `ArticleProgressRepository.list_caller_values` when `list_instances` is empty.
- Produces (Task 3): `GET /api/v1/projects/{project_id}/templates/{template_id}/article-progress?kind=extraction|quality_assessment` → `ApiResponse[ArticleProgressRead]`, served by `async def get_template_article_progress(project_id: UUID, template_id: UUID, request: Request, db: DbSession, kind: ArticleProgressKind, user_sub: UUID = Depends(require_project_scope)) -> ApiResponse[ArticleProgressRead]`, decorated `@router.get(..., response_model=ApiResponse[ArticleProgressRead])` then `@limiter.limit("60/minute")`. Statuses 200 / 401 / 403 / 404 / 422 / 429. It also produces `components['schemas']['ArticleProgressRead']` and `['ArticleProgressItemRead']` in `frontend/types/api/schema.d.ts`.

Notes (verified against the tree):
- Limiter in tests: `limiter` (`backend/app/utils/rate_limiter.py`) is a plain `Limiter(key_func=_principal_key, …)` with no `enabled=` argument, and neither `.env` sets `RATELIMIT_ENABLED`, so it is live in pytest. The autouse fixture `_isolated_rate_limits` (`backend/tests/integration/conftest.py:59-73`) calls `limiter.reset()` before every integration test, so the 61 requests of the rate-limit test cannot leak into another test. Do not add a reset of your own. `db_client` sends no `Authorization` header, so its bucket is `ip:1.2.3.4` (httpx `ASGITransport` default client). `app.main` registers `_rate_limit_exceeded_handler`, which answers 429. slowapi's async wrapper raises `Exception("parameter `request` must be an instance of starlette.requests.Request")` when the limiter is enabled and `request` is anything else. The direct handler calls therefore pass a real `starlette.requests.Request`, never a `MagicMock`.
- Coverage: handler lines reached through httpx `ASGITransport` register no coverage, and CI's diff-cover gate needs 80%. Three tests therefore also call the decorated coroutine directly. Seed: `SEED.primary_profile` manages `primary_project` and `secondary_project`. `SEED.outsider_profile` has no memberships. `SEED.primary_template` is `kind='extraction'` in `primary_project`. `db_session` is SAVEPOINT-isolated, so rows a test inserts roll back at teardown.

- [ ] **Step 1: Write the failing tests**

Merge these imports into the test file's import block, skipping duplicates. Import the endpoint as a MODULE, so the Task 1a/1b tests still collect while the handler is missing. Step 5's `ruff check --fix` sorts the block.

```python
from collections.abc import AsyncGenerator
from uuid import UUID, uuid4
import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
import app.api.v1.endpoints.project_templates as project_templates_endpoints
from app.core.deps import get_db
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.services.article_progress_service import get_article_progress
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED, make_proposal, open_session
```

Append this to the end of the file. Blank lines are compact here; Step 5's `ruff format` restores them.

```python
# =================== HTTP: endpoint + guards + rate limit (Task 2) ===================
_ART_HI, _ART_LO = UUID("ffffffff-9999-00f2-0000-000000000002"), UUID("ffffffff-9999-00f2-0000-000000000001")
_PROBE_ET = UUID("ffffffff-9999-00f4-0000-000000000001")

def _progress_url(project_id: UUID, template_id: UUID, kind: str | None = "extraction") -> str:
    url = f"/api/v1/projects/{project_id}/templates/{template_id}/article-progress"
    return url if kind is None else f"{url}?kind={kind}"

async def _call_handler(db: AsyncSession, project_id: UUID, template_id: UUID, kind: str):
    # A real starlette Request: slowapi's wrapper rejects anything else while the limiter is live.
    scope = {"type": "http", "method": "GET", "path": _progress_url(project_id, template_id, None),
             "headers": [], "query_string": b"", "client": ("127.0.0.1", 1), "app": app}
    request = Request(scope)
    request.state.trace_id = "trace-article-progress"
    return await project_templates_endpoints.get_template_article_progress(
        project_id=project_id, template_id=template_id, request=request, db=db, kind=kind, user_sub=SEED.primary_profile)

def _pin_token_subject(user_id: UUID) -> None:
    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(sub=str(user_id), email=None, role="authenticated", aal="aal1")
    app.dependency_overrides[get_current_user] = override_get_current_user

@pytest_asyncio.fixture
async def progress_member_client(db_client: AsyncClient) -> AsyncClient:
    _pin_token_subject(SEED.primary_profile)  # db_client clears overrides at teardown
    return db_client

@pytest_asyncio.fixture
async def progress_outsider_client(db_client: AsyncClient) -> AsyncClient:
    _pin_token_subject(SEED.outsider_profile)
    return db_client

@pytest_asyncio.fixture
async def progress_anonymous_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides.pop(get_current_user, None)  # no test auth override: real bearer check
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)

@pytest.mark.asyncio
async def test_member_reads_own_progress_per_article(db_session, progress_member_client) -> None:
    session = await open_session(db_session, project_id=SEED.primary_project, article_id=SEED.primary_article,
                                 template_id=SEED.primary_template, user_id=SEED.primary_profile)
    await make_proposal(db_session, run_id=session.run_id, instance_id=SEED.primary_instance,
                        field_id=SEED.primary_field, user_id=SEED.primary_profile, value=42)
    resp = await progress_member_client.get(_progress_url(SEED.primary_project, SEED.primary_template))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    item = next(a for a in body["data"]["articles"] if a["article_id"] == str(SEED.primary_article))
    assert set(item) == {"article_id", "instances", "values"}
    instance = {"id": str(SEED.primary_instance), "entity_type_id": str(SEED.primary_entity_type)}
    assert instance in item["instances"]
    key = (str(SEED.primary_instance), str(SEED.primary_field))
    assert len([v for v in item["values"] if (v["instance_id"], v["field_id"]) == key]) == 1
    expected = await get_article_progress(db_session, project_id=SEED.primary_project,
                                          template_id=SEED.primary_template, user_id=SEED.primary_profile, kind="extraction")
    assert body["data"] == expected.model_dump(mode="json")
    direct = await _call_handler(db_session, SEED.primary_project, SEED.primary_template, "extraction")
    assert direct.ok is True and direct.trace_id == "trace-article-progress"
    assert direct.data.model_dump(mode="json") == body["data"]

@pytest.mark.asyncio
async def test_response_is_ordered_by_article_then_instance_id(db_session, progress_member_client) -> None:
    # Every row is inserted in DESCENDING id order, so an unordered scan cannot pass by accident.
    params = {"pid": str(SEED.primary_project), "tid": str(SEED.primary_template), "uid": str(SEED.primary_profile),
              "et1": str(SEED.primary_entity_type), "et2": str(_PROBE_ET), "hi": str(_ART_HI), "lo": str(_ART_LO)}
    await db_session.execute(text(
        "INSERT INTO public.extraction_entity_types (id, project_template_id, name, label, cardinality, "
        "parent_entity_type_id, sort_order, is_required) VALUES (:et2, :tid, 'ordering_probe', 'Ordering probe', 'one', NULL, 1, false)"), params)
    await db_session.execute(text(
        "INSERT INTO public.articles (id, project_id, title, row_version) "
        "VALUES (:hi, :pid, 'ordering probe', 1), (:lo, :pid, 'ordering probe', 1)"), params)
    await db_session.execute(text(
        "INSERT INTO public.extraction_instances (id, project_id, template_id, entity_type_id, "
        "article_id, label, created_by) VALUES "
        "('ffffffff-9999-00f6-0000-000000000004', :pid, :tid, :et2, :hi, 'p', :uid), "
        "('ffffffff-9999-00f6-0000-000000000003', :pid, :tid, :et1, :hi, 'p', :uid), "
        "('ffffffff-9999-00f6-0000-000000000002', :pid, :tid, :et2, :lo, 'p', :uid), "
        "('ffffffff-9999-00f6-0000-000000000001', :pid, :tid, :et1, :lo, 'p', :uid)"), params)
    await db_session.flush()
    resp = await progress_member_client.get(_progress_url(SEED.primary_project, SEED.primary_template))
    assert resp.status_code == 200, resp.text
    articles = resp.json()["data"]["articles"]
    article_ids = [a["article_id"] for a in articles]
    assert {str(_ART_HI), str(_ART_LO)} <= set(article_ids)
    assert article_ids == sorted(article_ids, key=UUID)
    hi = next(a for a in articles if a["article_id"] == str(_ART_HI))
    assert len(hi["instances"]) == 2  # precondition: per-article order is observable
    for item in articles:
        instance_ids = [i["id"] for i in item["instances"]]
        assert instance_ids == sorted(instance_ids, key=UUID)

@pytest.mark.asyncio
async def test_missing_kind_is_422(progress_member_client) -> None:
    resp = await progress_member_client.get(_progress_url(SEED.primary_project, SEED.primary_template, kind=None))
    assert resp.status_code == 422, resp.text

@pytest.mark.asyncio
async def test_unknown_kind_is_422(progress_member_client) -> None:
    resp = await progress_member_client.get(_progress_url(SEED.primary_project, SEED.primary_template, kind="qa"))
    assert resp.status_code == 422, resp.text

@pytest.mark.asyncio
async def test_non_member_gets_403_for_real_and_unknown_template(progress_outsider_client) -> None:
    real = await progress_outsider_client.get(_progress_url(SEED.primary_project, SEED.primary_template))
    unknown = await progress_outsider_client.get(_progress_url(SEED.primary_project, uuid4()))
    assert real.status_code == 403, real.text
    assert unknown.status_code == 403, unknown.text
    assert real.json()["error"] == unknown.json()["error"]  # no existence oracle

@pytest.mark.asyncio
async def test_missing_or_invalid_token_gets_401(progress_anonymous_client) -> None:
    assert get_current_user not in app.dependency_overrides  # precondition: real auth runs
    url = _progress_url(SEED.primary_project, SEED.primary_template)
    missing = await progress_anonymous_client.get(url)
    invalid = await progress_anonymous_client.get(url, headers={"Authorization": "Bearer not-a-jwt"})
    assert missing.status_code == 401, missing.text
    assert invalid.status_code == 401, invalid.text

@pytest.mark.asyncio
async def test_template_from_other_project_is_not_found(db_session, progress_member_client) -> None:
    # The caller manages BOTH projects, so a 404 (not a 403) is the template guard speaking.
    foreign = await progress_member_client.get(_progress_url(SEED.secondary_project, SEED.primary_template))
    unknown = await progress_member_client.get(_progress_url(SEED.primary_project, uuid4()))
    assert foreign.status_code == 404, foreign.text
    assert unknown.status_code == 404, unknown.text
    with pytest.raises(HTTPException) as exc:
        await _call_handler(db_session, SEED.secondary_project, SEED.primary_template, "extraction")
    assert exc.value.status_code == 404

@pytest.mark.asyncio
async def test_kind_mismatch_is_not_found(db_session, progress_member_client) -> None:
    kind = (await db_session.execute(
        text("SELECT kind FROM public.project_extraction_templates WHERE id = :id AND project_id = :pid"),
        {"id": str(SEED.primary_template), "pid": str(SEED.primary_project)})).scalar_one()
    assert kind == "extraction"  # precondition
    resp = await progress_member_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template, kind="quality_assessment"))
    assert resp.status_code == 404, resp.text
    with pytest.raises(HTTPException) as exc:
        await _call_handler(db_session, SEED.primary_project, SEED.primary_template, "quality_assessment")
    assert exc.value.status_code == 404

@pytest.mark.asyncio
async def test_article_progress_is_rate_limited_at_60_per_minute(db_session, progress_member_client) -> None:
    # The autouse _isolated_rate_limits fixture reset the limiter before this test.
    template_id = await TemplateFactory(db_session, SEED.primary_project, SEED.primary_profile).create(
        name="rate-limit-probe", kind="extraction")
    count = (await db_session.execute(text("SELECT count(*) FROM public.extraction_instances WHERE template_id = :t "
             "AND project_id = :pid"), {"t": str(template_id), "pid": str(SEED.primary_project)})).scalar_one()
    assert count == 0  # precondition: no instances, so each request is three cheap statements
    url = _progress_url(SEED.primary_project, template_id)
    for attempt in range(60):
        resp = await progress_member_client.get(url)
        assert resp.status_code == 200, f"request {attempt + 1}: {resp.text}"
        assert resp.json()["data"] == {"articles": []}
    limited = await progress_member_client.get(url)
    assert limited.status_code == 429, limited.text
    assert "Rate limit exceeded" in limited.text
```

- [ ] **Step 2: Run the tests and watch them fail**

Run from `backend/`: `uv run pytest tests/integration/test_article_progress_read.py -v -k "own_progress or ordered_by_article or kind_is_422 or gets_403 or gets_401 or other_project or kind_mismatch or rate_limited"`
Expected: 9 failed. Every HTTP call gets `404 Not Found` because there is no route yet (the rate-limit test fails on `request 1`); the two not-found tests fail on their HTTP asserts before `_call_handler` runs. The same command with `-k "not (…the same expression…)"` passes every Task 1a and 1b test.

- [ ] **Step 3: Implement the handler, without the rate limit**

In `backend/app/api/v1/endpoints/project_templates.py`, add these imports in isort position (before `app.schemas.common` and before `app.services.project_template_active_service`):

```python
from app.schemas.article_progress import ArticleProgressKind, ArticleProgressRead
from app.services.article_progress_service import get_article_progress
```

In the module docstring, add this after the `DELETE …` bullet:

```text
* ``GET /api/v1/projects/{project_id}/templates/{template_id}/article-progress``
  — the caller's own per-article values for worklist progress (members).
```

Insert this handler directly after `get_template_active_version`:

```python
@router.get(
    "/{project_id}/templates/{template_id}/article-progress",
    response_model=ApiResponse[ArticleProgressRead],
)
async def get_template_article_progress(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    kind: ArticleProgressKind,
    user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[ArticleProgressRead]:
    """The caller's own per-article progress values for a template's worklist.

    Member-gated like ``active-version``: 403 before any template lookup (no existence
    oracle). Missing or unknown ``kind`` is a 422; a foreign, unknown or other-kind template, 404.
    """
    try:
        result = await get_article_progress(
            db, project_id=project_id, template_id=template_id, user_id=user_sub, kind=kind
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))
```

Run from `backend/`: `uv run pytest tests/integration/test_article_progress_read.py -v -k rate_limited`. Expected: 1 failed, `AssertionError: 200 == 429` on the 61st request. That is the right reason: the route works and is not limited yet.

- [ ] **Step 4: Add the rate limit (R36)**

Between the `@router.get(...)` decorator and `async def get_template_article_progress`, add the line `@limiter.limit("60/minute")`. `limiter` is already imported (`from app.utils.rate_limiter import limiter`, :107); the order matches `user_connections.py:46-47`.

- [ ] **Step 5: Format, then run the tests and watch them pass**

Run from `backend/`: `uv run ruff check --fix app/api/v1/endpoints/project_templates.py tests/integration/test_article_progress_read.py && uv run ruff format app/api/v1/endpoints/project_templates.py tests/integration/test_article_progress_read.py && uv run ruff check app/api/v1/endpoints/project_templates.py tests/integration/test_article_progress_read.py`
Expected: ends with `All checks passed!`. Then run: `uv run pytest tests/integration/test_article_progress_read.py tests/unit/test_template_active_version_endpoint.py tests/integration/test_template_active_version_read.py -v`. Expected: all pass, including the 9 Task 2 tests. Re-run Step 2's first command: `9 passed`.

**R33 arbiter:** the test, not the spec prose, decides the missing-header status. If ONLY the `missing` assert of `test_missing_or_invalid_token_gets_401` fails, FastAPI 0.136.3's `HTTPBearer` (`backend/app/core/security.py:28`, default `auto_error`) returns some other status. Change no handler or auth code. Set that one assert to the observed status, and report it. In the same commit, amend two places in `docs/superpowers/specs/2026-09-14-run-nav-and-dev-server-design.md`: R33's sentence "The expected status for a missing header is 401 …" and the §4 endpoint row's "401 on a missing or invalid token" cell. The `invalid` assert stays 401, because `verify_supabase_jwt` maps `jwt.PyJWTError` to 401. If the `invalid` assert fails, stop and report it: that is an auth defect, not a test to adjust.

- [ ] **Step 6: Regenerate the API types**

Run from the worktree root: `npm run generate:api-types && git diff --stat frontend/types/api/`. Expected: the output shows `Generated frontend/types/api/{openapi.json,schema.d.ts}`, then `2 files changed`, only `openapi.json` and `schema.d.ts`, almost all insertions.
Then run `grep -c '"/api/v1/projects/{project_id}/templates/{template_id}/article-progress"' frontend/types/api/openapi.json; grep -c 'ArticleProgressItemRead' frontend/types/api/schema.d.ts`. Expected: `1`, then ≥ 2. The route declares no `responses={422: …}`, so the generated types do not depend on the Python version. If `git diff frontend/types/api/` touches another route or schema, the local generator differs from CI (Python 3.11): stop and report it, and commit no unrelated drift.

- [ ] **Step 7: Fitness, file size, dead code, diff coverage**

Run from the worktree root: `python3 scripts/fitness/check_api_response_envelope.py && python3 scripts/fitness/check_layered_arch.py && python3 scripts/fitness/check_scope_guards.py && python3 scripts/fitness/check_file_size.py && wc -l backend/app/api/v1/endpoints/project_templates.py && git diff --stat scripts/fitness/`. Expected: every check exits 0, `wc` shows ≤ 800 (about 770), and the final diff is empty. If `check_scope_guards.py` names a duplicate predicate, it is in Task 1a/1b's repository: reuse the function it names (R4). Never add a baseline line, and never bump `check_file_size.baseline`.

Run from `backend/`: `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`. Expected: exit 0. Then (about 2.5 min, as CI runs it): `uv run pytest tests/ --cov=app --cov-report=xml -q && uv run diff-cover coverage.xml --compare-branch=origin/dev --fail-under=80`. Expected: `project_templates.py` has no missing lines, and the gate passes.

- [ ] **Step 8: Commit (path-scoped)**

If the R33 arbiter amended the spec, append `docs/superpowers/specs/2026-09-14-run-nav-and-dev-server-design.md` to the path list.

```bash
git commit -m "feat(api): rate-limited article-progress read endpoint with membership and template guards

GET …/article-progress (R3); require_project_scope then owned_template (R4):
401/403/404/422 (R5, R6, R33); 60/minute (R36). Regenerated API types.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- backend/app/api/v1/endpoints/project_templates.py backend/tests/integration/test_article_progress_read.py frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git show --stat HEAD
```

Expected: `git show --stat HEAD` lists exactly those 4 paths (5 with the spec amendment), and nothing else.

### Task 3: Frontend progress service, hook, paging, deletions

**Spec:** cluster 3a (R13, R14, R15, R16, R17 hook part, R20, R21). **NEW tests:** 8. **Base:** the branch after Task 0, which holds the WIP commit and the merge of `origin/dev` `b3192e7e` (PR #911). Every path below is read as committed at `HEAD`.

**Files:**
- Create: `frontend/services/articleProgressService.ts`, `frontend/test/services/articleProgressService.test.ts` (1 NEW test)
- Modify: `frontend/hooks/extraction/useArticleExtractionValues.ts`. Create: `frontend/test/hooks/useArticleExtractionValues.test.tsx` (5 NEW tests)
- Modify: `frontend/test/services/articlesService.test.ts` (2 NEW tests)
- Modify (compile port only): `frontend/components/quality/QualityAssessmentInterface.tsx`, `frontend/test/QualityAssessmentInterface.test.tsx`
- Modify: `frontend/services/extractionValueService.ts`, `frontend/test/services/extractionValueService.test.ts`, `frontend/hooks/runs/types.ts`, `backend/app/services/extraction_run_read_service.py` (docstring)
- Delete: `frontend/lib/extraction/loadArticleProgressData.ts`, `loadArticleProgressData.test.ts`, `articleValues.ts`, `articleValues.test.ts` (all tracked since Task 0)
- Verify, no edit (the Task 0 WIP commit already carries them): `frontend/lib/query-keys/extraction.ts` (key unchanged), `frontend/services/articlesService.ts` (R13 paging), the `range` stubs in `frontend/test/QualityAssessmentInterface.test.tsx` `makeBuilder` and `frontend/test/helpers/qaFullScreenMocks.tsx:107` (R14), and the removed keys mock in `frontend/components/extraction/ArticleExtractionTable.test.tsx` (R16)

**Interfaces:**
- Consumes (Task 2, `frontend/types/api/schema.d.ts`): `components['schemas']['ArticleProgressRead']` and `components['schemas']['ArticleProgressItemRead']` (`article_id`, `instances: {id, entity_type_id}[]`, `values: {instance_id, field_id, value}[]`), served by `GET /api/v1/projects/{project_id}/templates/{template_id}/article-progress?kind=`. Also `apiClient` (`@/integrations/api`), `ReviewKind` (`@/lib/comparison/permissions`), `articleExtractionValuesKeys` (`@/lib/query-keys/extraction`).
- Produces: `ArticleProgressRead`, `ArticleProgressData`, `getArticleProgress(projectId: string, templateId: string, kind: ReviewKind): Promise<ArticleProgressRead>`.
- Produces for Task 4a: `useArticleExtractionValues(projectId, templateId, userId, kind = 'extraction')` → `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown> }`. The `error` field (Task 0's bridge) is gone.

Interim, by design: `ExtractionInterface` and the two tables gate only on `isLoading` until Tasks 4b/4c, so a failed or disabled read renders 0% instead of a skeleton. The same PR ships all of these tasks. Do not edit those consumers here. The QA dashboard's full port is Task 9; this task only renames one destructured field.

- [ ] **Step 1: Check the preconditions**

Run: `grep -c "ArticleProgressRead\|ArticleProgressItemRead" frontend/types/api/schema.d.ts`. Expected: ≥ 2. If it prints 0, stop: Task 2 has not landed. Then run `grep -n "articleExtractionValuesKeys" frontend/components/quality/QualityAssessmentInterface.tsx` and `grep -n "error: query.error" frontend/hooks/extraction/useArticleExtractionValues.ts`. Expected: the keys import comes from `@/lib/query-keys/extraction` (Task 0's bridge), and the hook has exactly one `error: query.error` line. If the keys are still imported from the hook module, stop: Task 0 is incomplete.

- [ ] **Step 2: Write the failing service test**

Create `frontend/test/services/articleProgressService.test.ts`:

```ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api', () => ({apiClient: apiClientMock}));

import {getArticleProgress} from '@/services/articleProgressService';

beforeEach(() => apiClientMock.mockReset());

describe('articleProgressService.getArticleProgress', () => {
  it('requests the article-progress route with the kind', async () => {
    const read = {articles: []};
    apiClientMock.mockResolvedValueOnce(read);
    await expect(getArticleProgress('proj-1', 'tpl-1', 'quality_assessment')).resolves.toBe(read);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/templates/tpl-1/article-progress?kind=quality_assessment',
    );
  });
});
```

Run: `npx vitest run frontend/test/services/articleProgressService.test.ts -t "requests the article-progress route with the kind"`. Expected: FAIL, because `@/services/articleProgressService` does not resolve.

- [ ] **Step 3: Implement the service**

Create `frontend/services/articleProgressService.ts`:

```ts
/** Article progress (R15): the caller's per-article instances + merged values. The
 * backend owns the merge and the form-run scoping. Throws; TanStack owns errors. */
import {apiClient} from '@/integrations/api';
import type {ReviewKind} from '@/lib/comparison/permissions';
import type {components} from '@/types/api/schema';

export type ArticleProgressRead = components['schemas']['ArticleProgressRead'];

export type ArticleProgressData = Pick<
  components['schemas']['ArticleProgressItemRead'],
  'instances' | 'values'
>;

export function getArticleProgress(
  projectId: string,
  templateId: string,
  kind: ReviewKind,
): Promise<ArticleProgressRead> {
  return apiClient<ArticleProgressRead>(
    `/api/v1/projects/${projectId}/templates/${templateId}/article-progress?kind=${kind}`,
  );
}
```

Run the Step 2 command. Expected: PASS (1 test).

- [ ] **Step 4: Write the failing hook tests**

Create `frontend/test/hooks/useArticleExtractionValues.test.tsx`:

```tsx
import {QueryClient, QueryClientProvider, onlineManager} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {getArticleProgress} = vi.hoisted(() => ({getArticleProgress: vi.fn()}));
vi.mock('@/services/articleProgressService', () => ({getArticleProgress}));

import {useArticleExtractionValues} from '@/hooks/extraction/useArticleExtractionValues';

function setup() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {queryClient, wrapper};
}

const A1 = {article_id: 'a1', instances: [{id: 'i1', entity_type_id: 'et1'}], values: [{instance_id: 'i1', field_id: 'f1', value: 'x'}]};
const A2 = {article_id: 'a2', instances: [{id: 'i2', entity_type_id: 'et1'}], values: []};

beforeEach(() => vi.clearAllMocks());
afterEach(() => onlineManager.setOnline(true));

describe('useArticleExtractionValues', () => {
  it('maps the response to a per-article map', async () => {
    getArticleProgress.mockResolvedValue({articles: [A1, A2]});
    const {wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', 'u1'), {wrapper});
    await waitFor(() => expect(result.current.valuesByArticle.size).toBe(2));
    expect(result.current.valuesByArticle.get('a1')).toEqual({instances: A1.instances, values: A1.values});
    expect(result.current.valuesByArticle.get('a2')).toEqual({instances: A2.instances, values: []});
    expect(result.current).toMatchObject({isLoading: false, isError: false, isUnavailable: false});
    expect(getArticleProgress).toHaveBeenCalledWith('p1', 't1', 'extraction');
  });
  it('keys the cache by project, template, user and kind', async () => {
    getArticleProgress.mockResolvedValue({articles: []});
    const {queryClient, wrapper} = setup();
    const {result} = renderHook(
      () => useArticleExtractionValues('p1', 't1', 'u1', 'quality_assessment'), {wrapper});
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([
      ['article-extraction-values', 'p1', 't1', 'u1', 'quality_assessment'],
    ]);
    expect(getArticleProgress).toHaveBeenCalledWith('p1', 't1', 'quality_assessment');
  });
  it('reports isError, not endless loading, when the fetch fails', async () => {
    getArticleProgress.mockRejectedValue(new Error('boom'));
    const {wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', 'u1'), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current).toMatchObject({isLoading: false, isUnavailable: false});
    expect(result.current.valuesByArticle.size).toBe(0);
  });
  it('is unavailable, not loading, when the query is disabled because userId is null', () => {
    const {wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', null), {wrapper});
    expect(result.current).toMatchObject({isUnavailable: true, isLoading: false, isError: false});
    expect(getArticleProgress).not.toHaveBeenCalled();
  });
  it('reports loading, not unavailable, while an enabled query is paused', async () => {
    onlineManager.setOnline(false);
    getArticleProgress.mockResolvedValue({articles: []});
    const {queryClient, wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', 'u1'), {wrapper});
    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()[0]?.state.fetchStatus).toBe('paused'));
    expect(result.current).toMatchObject({isLoading: true, isUnavailable: false, isError: false});
    expect(getArticleProgress).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run frontend/test/hooks/useArticleExtractionValues.test.tsx`. Expected: FAIL, 5 failed. The hook still calls `loadArticleProgressData`, so `getArticleProgress` is never called; `isUnavailable` is `undefined`; and `isLoading` is `isPending || isError`. A suite-level import error is not the right failure: fix the test file first.

- [ ] **Step 5: Rewrite the hook**

Replace the whole of `frontend/hooks/extraction/useArticleExtractionValues.ts` (this also drops Task 0's `error: query.error` bridge) with:

```ts
/** Per-article progress for the worklists and dashboards, via the article-progress API (R15).
 * The key keeps `userId`, so an identity change never serves another user's cache (R16).
 * R17: `isLoading` = enabled && isPending (a paused offline query stays pending while
 * TanStack's isLoading is false); a DISABLED query is `isUnavailable`, never loading. */
import {useQuery} from '@tanstack/react-query';

import type {ReviewKind} from '@/lib/comparison/permissions';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {getArticleProgress, type ArticleProgressData} from '@/services/articleProgressService';

export function useArticleExtractionValues(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  userId: string | null | undefined,
  kind: ReviewKind = 'extraction',
) {
  const enabled = !!projectId && !!templateId && !!userId;
  const query = useQuery({
    queryKey: articleExtractionValuesKeys.byTemplate(
      projectId ?? '', templateId ?? '', userId ?? '', kind),
    enabled,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Map<string, ArticleProgressData>> => {
      const read = await getArticleProgress(projectId as string, templateId as string, kind);
      const map = new Map<string, ArticleProgressData>();
      for (const a of read.articles) {
        map.set(a.article_id, {instances: a.instances, values: a.values});
      }
      return map;
    },
  });

  return {
    valuesByArticle: query.data ?? new Map<string, ArticleProgressData>(),
    isLoading: enabled && query.isPending,
    isError: query.isError,
    isUnavailable: !enabled,
    refetch: query.refetch,
  };
}
```

Run the Step 4 command. Expected: PASS (5 tests). Then run `git diff HEAD -- frontend/lib/query-keys/extraction.ts` (expected: no output) and `grep -n "'article-extraction-values'" frontend/lib/query-keys/extraction.ts` (expected: the one `all: ['article-extraction-values'] as const` line).

- [ ] **Step 6: Port the QA dashboard's destructure (compile port only)**

In `frontend/components/quality/QualityAssessmentInterface.tsx`, inside the `useArticleExtractionValues(` destructure, change the line `    error: valuesError,` to `    isError: valuesError,`. Leave everything else alone: `valuesError` is already used only as a boolean (`dashboardArticles.isError || valuesError`), and `retryDashboard`, `useAuth` and the keys import are Task 9's job.

In `frontend/test/QualityAssessmentInterface.test.tsx` (#911's version: the hook is mocked at the module boundary), make exactly these edits:
- The hoisted `progress` state: `  error: null as Error | null,` becomes `  isError: false,`.
- Its comment, where it reads `independent of how the hook reads (PostgREST today, the API later).`, becomes `independent of how the hook reads.`
- In `beforeEach`: `  progress.error = null;` becomes `  progress.isError = false;`.
- In `'shows the error state, not zero counts, when the progress read fails'`: `    progress.error = new Error('permission denied');` becomes `    progress.isError = true;`.

Do not touch its `apiClient` mock, the `supabase` mock or the `articleExtractionValuesKeys` stub: the hook is mocked, so no progress path reaches them.

Run: `grep -n "progress.error\|error: null as Error" frontend/test/QualityAssessmentInterface.test.tsx`. Expected: no output. Then run `grep -n "range: () =>" frontend/test/QualityAssessmentInterface.test.tsx frontend/test/helpers/qaFullScreenMocks.tsx`. Expected: one line per file (R14). Then run `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx frontend/test/QualityAssessmentFullScreen.navigation.test.tsx`. Expected: PASS. `'shows the error state, not zero counts, when the progress read fails'` must pass, which proves the renamed flag still drives the error state.

- [ ] **Step 7: Add R13's two paging tests and prove they bite**

In `frontend/test/services/articlesService.test.ts`, inside `mockArticleRows`, replace the `chain.order = vi.fn((column: string) => { … });` assignment with a named spy:

```ts
    const order = vi.fn((column: string, _opts?: {ascending?: boolean}) => {
      orderedBy.push(column);
      return chain;
    });
    chain.order = order;
```

Change its `return {ranges, orderedBy};` to `return {ranges, orderedBy, order};`. Then add these two tests after `'%s breaks created_at ties on a second column'`, in the same describe:

```ts
  it.each(loaders)('%s stops paging on the first short page', async (_name, load) => {
    // 1200 rows = one full page, then a short page of 200. No third request.
    const {ranges} = mockArticleRows(1200);
    await load('proj-1');
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });
  it.each(loaders)('%s orders by created_at descending, then id ascending', async (_name, load) => {
    const {order} = mockArticleRows(3);
    await load('proj-1');
    expect(order.mock.calls).toEqual([['created_at', {ascending: false}], ['id']]);
  });
```

Run: `npx vitest run frontend/test/services/articlesService.test.ts -t "stops paging on the first short page"` and `npx vitest run frontend/test/services/articlesService.test.ts -t "orders by created_at descending, then id ascending"`. Expected: PASS, 3 cases each (`loadExtractionTableArticles`, `loadProjectArticles`, `fetchProjectArticles`), because the paging is already committed.

Prove each test bites. In `selectAllProjectArticles` (`frontend/services/articlesService.ts`), temporarily change `if (page.length < ARTICLES_PAGE) return rows;` to `if (page.length === 0) return rows;`. Re-run the first command: expected FAIL (a third range `[2000, 2999]`). Revert. Then temporarily change `.order('id')` to `.order('id', {ascending: false})`. Re-run the second command: expected FAIL. Revert. Finally, `git diff HEAD -- frontend/services/articlesService.ts` must print nothing.

- [ ] **Step 8: Delete the replaced client code (R20, R21)**

- `git rm frontend/lib/extraction/loadArticleProgressData.ts frontend/lib/extraction/loadArticleProgressData.test.ts frontend/lib/extraction/articleValues.ts frontend/lib/extraction/articleValues.test.ts`
- `frontend/services/extractionValueService.ts`: delete from the blank line after `findLatestFinalizedRun`'s closing `  },` (:44) through the blank line before `};` (:84). That removes the `findFormRunsByArticle` JSDoc and method (:46-83), so the object ends `  },` then `};`. Change the import (:10) to `import type { RunSummaryResponse } from '@/hooks/runs/types';`. In the header comment (:3), change `(reopen detection, batch form-run resolution)` to `(reopen detection)`.
- `frontend/test/services/extractionValueService.test.ts`: delete lines 72–138, from the blank line after the `findLatestFinalizedRun` describe's closing `});` (:71) to the end of the file. That removes the `// findFormRunsByArticle` banner (:73-75) and its describe (:76), including the test at :103.
- `frontend/hooks/runs/types.ts`: delete `export interface ArticleRunRef { … }` (:256-259) and the blank line after it (:260).
- `backend/app/services/extraction_run_read_service.py:642`: replace `    Parity with frontend ``findFormRunsByArticle``:` with `    Form-run rule (the article-progress read applies it set-based in SQL):`, keeping the 4-space indent.

Run: `npx vitest run frontend/test/services/extractionValueService.test.ts`. Expected: PASS (5 tests, all under `findLatestFinalizedRun`). Then run `grep -c articleExtractionValuesKeys frontend/components/extraction/ArticleExtractionTable.test.tsx`. Expected: `0` (R16; no edit).

- [ ] **Step 9: Verify the whole task**

Run from the worktree root:
- `npx vitest run frontend/test/services/articleProgressService.test.ts frontend/test/hooks/useArticleExtractionValues.test.tsx frontend/test/services/articlesService.test.ts frontend/test/services/extractionValueService.test.ts frontend/test/QualityAssessmentInterface.test.tsx frontend/test/QualityAssessmentFullScreen.navigation.test.tsx frontend/components/extraction/ArticleExtractionTable.test.tsx frontend/components/hitl/HITLArticleTable.test.tsx frontend/test/components/ExtractionInterface.gear.test.tsx frontend/test/components/ExtractionInterface.templateSwitch.test.tsx`. Expected: all pass, 0 failed.
- `npm run typecheck`. Expected: exit 0. A consumer error here means the schema's `ArticleProgressItemRead` shape differs from the old `{instances: {id, entity_type_id}[], values: {instance_id, field_id, value}[]}`; report `CONTRACT ISSUE` rather than casting.
- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`. Expected: zero findings in both.
- `python3 scripts/fitness/check_frontend_data_path.py` and `python3 scripts/fitness/check_react_query_keys.py`. Expected: exit 0, no baseline growth.
- `test ! -e frontend/lib/extraction/loadArticleProgressData.ts && test ! -e frontend/lib/extraction/articleValues.ts && echo gone`. Expected: `gone`.
- `rg -n supabase frontend/hooks/extraction/useArticleExtractionValues.ts frontend/services/articleProgressService.ts`, `rg -n findFormRunsByArticle frontend backend/app` and `rg -n ArticleRunRef frontend --glob '!frontend/types/api/**'`. Expected: no output from any of the three.
- `uv run --directory backend ruff check app/services/extraction_run_read_service.py` and `uv run --directory backend ruff format --check app/services/extraction_run_read_service.py`. Expected: exit 0.

- [ ] **Step 10: Commit only this task's paths**

```bash
git add frontend/services/articleProgressService.ts frontend/test/services/articleProgressService.test.ts frontend/test/hooks/useArticleExtractionValues.test.tsx
git commit -m "feat(extraction): read worklist progress through the article-progress API

useArticleExtractionValues reads it via apiClient and reports isLoading, isError and isUnavailable; the paging tests pin the short-page stop and the order; the client-side merge, findFormRunsByArticle and ArticleRunRef are deleted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  frontend/services/articleProgressService.ts frontend/test/services/articleProgressService.test.ts \
  frontend/hooks/extraction/useArticleExtractionValues.ts frontend/test/hooks/useArticleExtractionValues.test.tsx \
  frontend/test/services/articlesService.test.ts \
  frontend/components/quality/QualityAssessmentInterface.tsx frontend/test/QualityAssessmentInterface.test.tsx \
  frontend/services/extractionValueService.ts frontend/test/services/extractionValueService.test.ts \
  frontend/hooks/runs/types.ts backend/app/services/extraction_run_read_service.py \
  frontend/lib/extraction/loadArticleProgressData.ts frontend/lib/extraction/loadArticleProgressData.test.ts \
  frontend/lib/extraction/articleValues.ts frontend/lib/extraction/articleValues.test.ts
```

Run: `git show --stat HEAD`. Expected: exactly these 15 paths (3 created, 8 modified, 4 deleted). Then run `git status --short frontend/lib/extraction frontend/services frontend/hooks frontend/test/services frontend/test/hooks frontend/test/QualityAssessmentInterface.test.tsx frontend/components/quality backend/app/services/extraction_run_read_service.py`. Expected: no output.

### Task 4a: Shared caller-progress gate and structure refetch (cluster 3b, R17 structure refetch, R37)

**Spec:** cluster 3b (R17: `useActiveTemplateStructure` gains `refetch`; R37). **NEW tests:** 5 (3 spec tests + 2 plan-added tests for `resolveProgressGate`, ledger pre-flight ruling 2).

**Files:**
- Create: `frontend/hooks/extraction/useCallerArticleProgress.ts` (the hook and `resolveProgressGate`)
- Create: `frontend/test/hooks/useCallerArticleProgress.test.tsx` (5 NEW tests)
- Modify: `frontend/hooks/extraction/useActiveTemplateStructure.ts:57-71` (return gains `refetch`)
- Modify: `frontend/test/hooks/useActiveTemplateStructure.test.tsx` (one existing test gains a `refetch` assertion; not a NEW test)

**Interfaces:**
- Consumes (Task 3): `useArticleExtractionValues(projectId: string | null | undefined, templateId: string | null | undefined, userId: string | null | undefined, kind: ReviewKind = 'extraction')` → `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown> }`. Also `useAuth()` from `@/contexts/AuthContext` → `{ user: User | null; session; loading: boolean; signOut }`, and `ReviewKind` from `@/lib/comparison/permissions`.
- Produces (for Tasks 4b, 4c and 9):
  - `export function useCallerArticleProgress(projectId: string | null | undefined, templateId: string | null | undefined, kind: ReviewKind = 'extraction'): CallerArticleProgress`, in `frontend/hooks/extraction/useCallerArticleProgress.ts`.
  - `CallerArticleProgress` = `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown>; userId: string | null | undefined; isAuthResolving: boolean; isSignedOut: boolean }`. The type is NOT exported, because no consumer imports it (knip).
  - `userId` is `undefined` while auth is resolving, `null` once auth resolved with no user, and the user's id otherwise. `isAuthResolving = !!loading`. `isSignedOut = !loading && !user`. The two flags are never both true. A mocked `useAuth` without `loading` reads as resolved.
  - `useActiveTemplateStructure(projectId, templateId)` returns `{ entityTypes, isLoading, isError, error, refetch }`, where `refetch = query.refetch`. The other four fields are unchanged.
  - `export function resolveProgressGate(progress: ProgressRead & Pick<CallerArticleProgress, 'isAuthResolving' | 'isSignedOut'>, structure: ProgressRead): ProgressGate`, in the same file. It is pure, with no hooks. `ProgressRead = { isLoading: boolean; isError: boolean; refetch: () => Promise<unknown> }`. `ProgressGate = { state: 'authResolving' } | { state: 'signedOut' } | { state: 'error'; retry: () => void } | { state: 'loading' } | { state: 'ready' }`. Neither type is exported. First match wins: auth resolving, signed out, either read `isError` (`retry` refetches only the read that failed), either read `isLoading`, ready. Tasks 4b (dashboard steps 5–8) and 4c (both tables) call it. Task 9 does not.
- The hook orders nothing (R37). `resolveProgressGate` is the one shared order of the progress steps, and each surface keeps its earlier steps and its rendering (R18, R19). Do not modify any consumer in this task. `ExtractionInterface`, both tables and `QualityAssessmentInterface` move onto the gate in Tasks 4b, 4c and 9.

- [ ] **Step 1: Write the failing gate tests**

Create `frontend/test/hooks/useCallerArticleProgress.test.tsx`:

```tsx
/** R37: ONE place derives the progress user id from auth. `useAuth` and the progress
 * read are mocked at the module boundary; the gate under test is real. */
import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {useAuthMock, valuesMock, refetch} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  valuesMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({useAuth: () => useAuthMock()}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: (...args: unknown[]) => valuesMock(...args),
}));

import {resolveProgressGate, useCallerArticleProgress} from '@/hooks/extraction/useCallerArticleProgress';

const DISABLED = {
  valuesByArticle: new Map(),
  isLoading: false,
  isError: false,
  isUnavailable: true,
  refetch,
};

beforeEach(() => {
  vi.clearAllMocks();
  valuesMock.mockReturnValue(DISABLED);
});

describe('useCallerArticleProgress', () => {
  it('reports auth resolving and passes no user id while the user lookup resolves', () => {
    useAuthMock.mockReturnValue({user: null, loading: true});
    const {result} = renderHook(() => useCallerArticleProgress('p1', 't1'));

    expect(valuesMock).toHaveBeenLastCalledWith('p1', 't1', undefined, 'extraction');
    expect(result.current).toHaveProperty('userId');
    expect(result.current.userId).toBeUndefined();
    expect(result.current.isAuthResolving).toBe(true);
    expect(result.current.isSignedOut).toBe(false);
  });

  it('reports signed out and passes a null user id once auth resolves with no user', () => {
    useAuthMock.mockReturnValue({user: null, loading: false});
    const {result} = renderHook(() => useCallerArticleProgress('p1', 't1'));

    expect(valuesMock).toHaveBeenLastCalledWith('p1', 't1', null, 'extraction');
    expect(result.current.userId).toBeNull();
    expect(result.current.isAuthResolving).toBe(false);
    expect(result.current.isSignedOut).toBe(true);
  });

  it("passes the signed-in user's id to the progress read", () => {
    // No `loading` key: the shape `QualityAssessmentInterface.test.tsx:32` mocks. It reads as resolved.
    useAuthMock.mockReturnValue({user: {id: 'user-1'}});
    const enabled = {...DISABLED, isUnavailable: false, isLoading: true};
    valuesMock.mockReturnValue(enabled);
    const {result} = renderHook(() => useCallerArticleProgress('p1', 't1', 'quality_assessment'));

    expect(valuesMock).toHaveBeenLastCalledWith('p1', 't1', 'user-1', 'quality_assessment');
    // The five progress fields pass through untouched, plus the three auth fields.
    expect(result.current).toEqual({
      ...enabled,
      userId: 'user-1',
      isAuthResolving: false,
      isSignedOut: false,
    });
    expect(result.current.refetch).toBe(refetch);
  });
});

describe('resolveProgressGate', () => { // plan-added coverage, not spec names
  type Flags = {isLoading?: boolean; isError?: boolean; isAuthResolving?: boolean; isSignedOut?: boolean};
  const read = ({isLoading = false, isError = false}: Flags = {}) => ({isLoading, isError, refetch: vi.fn()});
  const caller = ({isAuthResolving = false, isSignedOut = false, ...rest}: Flags = {}) => ({isAuthResolving, isSignedOut, ...read(rest)});
  const state = (progress: Flags, structure: Flags = {}) => resolveProgressGate(caller(progress), read(structure)).state;

  it('orders auth resolving, signed out, a failed read and a pending read before ready', () => {
    // Each case also sets every later step's flags, so only first-match-wins yields its state.
    const both = {isError: true, isLoading: true};
    expect(state({isAuthResolving: true, ...both}, both)).toBe('authResolving');
    expect(state({isSignedOut: true, ...both}, both)).toBe('signedOut');
    expect([state({isLoading: true}, {isError: true}), state({isError: true}, {isLoading: true})]).toEqual(['error', 'error']);
    expect([state({}, {isLoading: true}), state({isLoading: true})]).toEqual(['loading', 'loading']);
    expect(state({})).toBe('ready');
  });

  it('retries only the read that failed', () => {
    // The other read is still pending, so a retry must leave it alone.
    const failed = [caller({isError: true}), read({isError: true})] as const;
    const pending = [caller({isLoading: true}), read({isLoading: true})] as const;
    const gates = [resolveProgressGate(failed[0], pending[1]), resolveProgressGate(pending[0], failed[1])];
    expect(gates.map((gate) => gate.state)).toEqual(['error', 'error']);
    for (const gate of gates) if (gate.state === 'error') gate.retry();
    failed.forEach((r) => expect(r.refetch).toHaveBeenCalledTimes(1));
    pending.forEach((r) => expect(r.refetch).not.toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the gate tests and confirm they fail**

Run: `npx vitest run frontend/test/hooks/useCallerArticleProgress.test.tsx`
Expected: FAIL. The suite cannot resolve `@/hooks/extraction/useCallerArticleProgress`, because the file does not exist yet.

- [ ] **Step 3: Implement the gate**

Create `frontend/hooks/extraction/useCallerArticleProgress.ts`:

```ts
/**
 * The caller's article progress (R37): the ONE place that derives the progress
 * user id from auth and reads progress. Every progress surface (the extraction
 * dashboard, both worklist tables, the QA dashboard) calls this, never
 * `useArticleExtractionValues` directly.
 *
 * `userId` is `undefined` while auth resolves and `null` once it resolved with
 * no user; both disable the progress query (`isUnavailable`). Use
 * `isSignedOut`, not `isUnavailable`, for "no user": `isUnavailable` is also
 * true when a surface passes no template. This hook orders nothing (R37);
 * `resolveProgressGate` below is the one shared order of the progress steps.
 */
import {useAuth} from '@/contexts/AuthContext';
import {useArticleExtractionValues} from '@/hooks/extraction/useArticleExtractionValues';
import type {ReviewKind} from '@/lib/comparison/permissions';
import type {ArticleProgressData} from '@/services/articleProgressService';

type CallerArticleProgress = {
  valuesByArticle: Map<string, ArticleProgressData>;
  isLoading: boolean;
  isError: boolean;
  isUnavailable: boolean;
  refetch: () => Promise<unknown>;
  userId: string | null | undefined;
  isAuthResolving: boolean;
  isSignedOut: boolean;
};

export function useCallerArticleProgress(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  kind: ReviewKind = 'extraction',
): CallerArticleProgress {
  const {user, loading} = useAuth();
  const userId = loading ? undefined : (user?.id ?? null);
  return {
    ...useArticleExtractionValues(projectId, templateId, userId, kind),
    userId,
    isAuthResolving: !!loading,
    isSignedOut: !loading && !user,
  };
}

type ProgressRead = {isLoading: boolean; isError: boolean; refetch: () => Promise<unknown>};
type ProgressGate = {state: 'authResolving'} | {state: 'signedOut'} | {state: 'loading'} | {state: 'ready'}
  | {state: 'error'; retry: () => void};

/** The ONE order of the progress steps (R18 steps 5-8; R19 steps 1-3 + the reads half of 4), first match wins:
 * a failed read beats a pending one, which may be paused. `retry` refetches only the read that failed. */
export function resolveProgressGate(
  progress: ProgressRead & Pick<CallerArticleProgress, 'isAuthResolving' | 'isSignedOut'>,
  structure: ProgressRead,
): ProgressGate {
  if (progress.isAuthResolving) return {state: 'authResolving'};
  if (progress.isSignedOut) return {state: 'signedOut'};
  if (progress.isError || structure.isError) {
    const retry = () => {
      if (progress.isError) void progress.refetch();
      if (structure.isError) void structure.refetch();
    };
    return {state: 'error', retry};
  }
  if (progress.isLoading || structure.isLoading) return {state: 'loading'};
  return {state: 'ready'};
}
```

- [ ] **Step 4: Run the gate tests and confirm they pass**

Run: `npx vitest run frontend/test/hooks/useCallerArticleProgress.test.tsx`
Expected: PASS, 5 tests.

Prove the first two tests bite. Temporarily change `loading ? undefined : (user?.id ?? null)` to `user?.id ?? null`. Re-run and expect `reports auth resolving and passes no user id while the user lookup resolves` to FAIL, because it receives `null`. Revert. Then temporarily change `isSignedOut: !loading && !user` to `isSignedOut: !user`. Re-run and expect the same test to FAIL, because `isSignedOut` is `true` while resolving. Revert. Finally, `git diff -- frontend/hooks/extraction/useCallerArticleProgress.ts` prints nothing, because the file is untracked. Check with `rg -n "loading \? undefined" frontend/hooks/extraction/useCallerArticleProgress.ts`, which must print one line.

Prove the gate tests bite, one mutation at a time, reverting each. (1) Change `if (progress.isError) void progress.refetch();` to `void progress.refetch();`. Expect `retries only the read that failed` to FAIL, because the pending progress read's `refetch` was called. (2) Move the line `if (progress.isLoading || structure.isLoading) return {state: 'loading'};` above the `if (progress.isError || structure.isError) {` block. Expect `orders auth resolving, signed out, a failed read and a pending read before ready` to FAIL, because it received `['loading', 'loading']` where it expected `['error', 'error']`. After reverting, re-run and expect PASS, 5 tests.

- [ ] **Step 5: Make the structure hook's refetch fail first**

In `frontend/test/hooks/useActiveTemplateStructure.test.tsx`, change the RTL import to `import {act, renderHook, waitFor} from '@testing-library/react';`. At the end of the existing test `passes entity-level is_required through to consumers`, after its `toMatchObject` assertion, append:

```tsx
    // R17: consumers retry a failed structure read through `refetch`.
    expect(getActiveTemplateStructure).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refetch();
    });
    expect(getActiveTemplateStructure).toHaveBeenCalledTimes(2);
```

Run: `npx vitest run frontend/test/hooks/useActiveTemplateStructure.test.tsx`
Expected: FAIL in `passes entity-level is_required through to consumers`, with `TypeError: result.current.refetch is not a function`. The other test passes.

- [ ] **Step 6: Add refetch to the structure hook**

In `frontend/hooks/extraction/useActiveTemplateStructure.ts`, replace the last two return fields:

```ts
    isError: query.isError,
    error: query.error,
  };
```

with:

```ts
    isError: query.isError,
    error: query.error,
    // Retry for a failed structure read; the progress surfaces' ErrorState calls it (R17, R19).
    refetch: query.refetch,
  };
```

Run: `npx vitest run frontend/test/hooks/useActiveTemplateStructure.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 7: Run the task's gates**

Run from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`:

- `npx vitest run frontend/test/hooks/useCallerArticleProgress.test.tsx frontend/test/hooks/useActiveTemplateStructure.test.tsx frontend/test/hooks/useArticleExtractionValues.test.tsx frontend/components/extraction/ArticleExtractionTable.test.tsx frontend/components/hitl/HITLArticleTable.test.tsx`
  Expected: PASS. No consumer changed, so the table suites pass exactly as they did after Task 3.
- `npm run typecheck`
  Expected: exit 0.
- `npx knip --no-tag-hints`
  Expected: zero findings. The test imports the new hook and `resolveProgressGate`, and neither `CallerArticleProgress`, `ProgressRead` nor `ProgressGate` is exported.
- `npx knip --production --no-tag-hints`
  Expected: exactly ONE finding, `Unused files (1)` → `frontend/hooks/extraction/useCallerArticleProgress.ts`. Only its test imports the hook until Task 4b makes `ExtractionInterface` its first production caller. Any other finding is a failure. Record this output in the task report. Task 4b's knip run must show zero findings.
- `python3 scripts/fitness/check_copy_keys.py`
  Expected: exit 0 (no copy change).
- `python3 scripts/fitness/check_file_size.py`
  Expected: exit 0. Both new files are far below 800 lines. Never pass `--update-baseline`.
- `python3 scripts/fitness/check_react_query_keys.py`
  Expected: exit 0 (no new query key).
- `rg -n "useCallerArticleProgress|resolveProgressGate" frontend --glob '!frontend/test/**' --glob '!frontend/hooks/extraction/useCallerArticleProgress.ts'`
  Expected: no output (exit 1). No consumer uses the hook or the gate yet.

- [ ] **Step 8: Commit only this task's paths**

```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add \
  frontend/hooks/extraction/useCallerArticleProgress.ts \
  frontend/test/hooks/useCallerArticleProgress.test.tsx
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "feat(extraction): one shared caller-progress gate; structure hook exposes refetch

useCallerArticleProgress derives the progress user id from useAuth (undefined while
resolving, null when signed out) and reads progress through useArticleExtractionValues,
adding isAuthResolving and isSignedOut. resolveProgressGate is the one shared order of the
progress steps. useActiveTemplateStructure returns refetch so a failed structure read can be retried.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  frontend/hooks/extraction/useCallerArticleProgress.ts \
  frontend/test/hooks/useCallerArticleProgress.test.tsx \
  frontend/hooks/extraction/useActiveTemplateStructure.ts \
  frontend/test/hooks/useActiveTemplateStructure.test.tsx
```

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --stat HEAD`
Expected: exactly these 4 paths. Two are new files, and none is under `.superpowers/`.

### Task 4b: Dashboard progress states, article query, page-level templates ErrorState (cluster 3c, R18)

**Files:**
- Modify: `frontend/components/extraction/ExtractionInterface.tsx:17, :26-31, :38, :53, :74-91, :101, :110, :185-210, :271-298, :459-472`
- Modify: `frontend/services/articlesService.ts:439-458` (delete the dashboard banner, `ArticleRow` and `loadProjectArticles`) and `frontend/test/services/articlesService.test.ts` (its import and `loaders` row)
- Modify: `frontend/lib/copy/extraction.ts:65` (`errorLoadArticles` → the 2 new keys); `frontend/test/components/ExtractionInterface.gear.test.tsx:16-39`, `frontend/test/components/ExtractionInterface.templateSwitch.test.tsx:18-49` (mocks move to the new shapes)
- Create: `frontend/test/components/ExtractionInterface.progressStates.test.tsx` (12 NEW tests)
- Line anchors are for the tree after Task 0. Tasks 1a–4a leave these lines alone, but Task 3 adds tests to `articlesService.test.ts`, so find that file's edits by text.

**Interfaces:**
- Consumes (Task 4a): `useCallerArticleProgress(projectId, templateId, kind = 'extraction')` → `{ valuesByArticle, isLoading, isError, isUnavailable, refetch, userId, isAuthResolving, isSignedOut }`; `useActiveTemplateStructure(...).refetch`; `resolveProgressGate(progress, structure)` from the same module → `{ state: 'authResolving' } | { state: 'signedOut' } | { state: 'error'; retry: () => void } | { state: 'loading' } | { state: 'ready' }` (first match wins, in that order; `retry` refetches only the failed read). The dashboard orders its own steps 1–4 and hands steps 5–8 to it. Consumes (existing): `articleKeys.byProject(projectId)` from `@/lib/query-keys`; `fetchProjectArticles(projectId): Promise<ErrorResult<ArticleListItem[]>>`; `ErrorState({title?, message, onRetry?})`; `useProjectTemplates` returns the `useQuery` result (`data`, `isError`, `error`, `refetch`).
- Produces (Tasks 4c and 9 reuse): the copy keys `extraction.errorLoadProgress` and `extraction.progressUnavailable`. The `dashboard-skeleton` test id is unchanged. Deletes: `articlesService.loadProjectArticles` and `ArticleRow`, `extraction.errorLoadArticles`. `projectsService.loadProjectArticles` is a DIFFERENT function (used by `ProjectView.tsx:154`) and stays.

- [ ] **Step 1: Swap the copy keys and move the old suites' mocks to the new shapes**

In `frontend/lib/copy/extraction.ts`, replace `    errorLoadArticles: 'Error loading articles',` (:65) with:
```ts
    errorLoadProgress: 'Could not load progress',
    progressUnavailable: 'Progress is unavailable without a signed-in user',
```

In BOTH `ExtractionInterface.gear.test.tsx` and `ExtractionInterface.templateSwitch.test.tsx`:
- In the `useProjectTemplates` mock object, after `error: null,` add `isError: false, refetch: vi.fn(),`. Keep its `data` array.
- Replace the `useArticleExtractionValues`, `useActiveTemplateStructure`, `AuthContext` and `articlesService` mocks with the block below; the real `useCallerArticleProgress` composes the first and third. In templateSwitch, replace the separate `AuthContext` mock (:41) in place and put the `articlesService` mock where the old one was (:47-49).
```tsx
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({valuesByArticle: new Map(), isLoading: false, isError: false, isUnavailable: false, refetch: vi.fn()}),
}));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({entityTypes: [], isLoading: false, isError: false, error: null, refetch: vi.fn()}),
}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'user-1'}, loading: false})}));
vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: vi.fn(() => new Promise(() => {})),
}));
```

- [ ] **Step 2: Write the failing dashboard tests**

Create `frontend/test/components/ExtractionInterface.progressStates.test.tsx`. The `it.each` row titles are exact spec test names, so the suite reports 12 tests.
```tsx
/** R18: the dashboard gate, first match wins. Each test starts from the all-resolved state and changes only its step's inputs. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {articleKeys} from '@/lib/query-keys';
const m = vi.hoisted(() => ({
  useAuthMock: vi.fn(), fetchArticlesMock: vi.fn(), templatesMock: vi.fn(), valuesMock: vi.fn(), structureMock: vi.fn(),
}));
// Envless CI has no VITE_SUPABASE_* — the real client module throws at import.
vi.mock('@/integrations/supabase/client', () => ({supabase: {auth: {getUser: vi.fn()}}}));
vi.mock('@/hooks/hitl/useProjectTemplates', () => ({
  useProjectTemplates: () => m.templatesMock(), useInvalidateProjectTemplates: () => vi.fn(),
}));
// The REAL shared gate (useCallerArticleProgress) runs: it composes the mocked useAuth with this mocked read.
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({useArticleExtractionValues: () => m.valuesMock()}));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({useActiveTemplateStructure: () => m.structureMock()}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({useTemplateConfigCaches: () => ({invalidateAfterImport: vi.fn()})}));
vi.mock('@/hooks/useProjectMemberRole', () => ({useProjectMemberRole: () => ({isManager: true, role: 'manager', loading: false})}));
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => m.useAuthMock()}));
vi.mock('@/services/articlesService', () => ({fetchProjectArticles: (...a: unknown[]) => m.fetchArticlesMock(...a)}));
vi.mock('@/components/extraction/ArticleExtractionTable', () => ({ArticleExtractionTable: () => null}));
vi.mock('@/components/hitl/HITLExportDialog', () => ({HITLExportDialog: () => null}));
vi.mock('@/lib/extraction/progress', () => ({computeRowProgress: () => 50}));
import {ExtractionInterface} from '@/components/extraction/ExtractionInterface';
const ARTICLES = t('extraction', 'dashboardArticles'), AVG = t('extraction', 'dashboardStatAvgCompleteness');
const DISTRIBUTION = t('extraction', 'dashboardDistributionTitle'), CONFIGURE = t('extraction', 'dashboardConfigureTitle');
const TEMPLATES_ERROR = t('extraction', 'errorLoadTemplates'), PROGRESS_ERROR = t('extraction', 'errorLoadProgress');
const UNAVAILABLE = t('extraction', 'progressUnavailable'), TRY_AGAIN = t('patterns', 'errorTryAgain');
const TEMPLATE = {id: 'tpl-1', name: 'T', kind: 'extraction', is_active: true}, PROGRESS = {instances: [], values: []};
type Over = Record<string, unknown>;
const templates = (over: Over = {}) => ({data: [TEMPLATE], isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over});
const values = (over: Over = {}) => ({valuesByArticle: new Map([['a1', PROGRESS], ['a2', PROGRESS]]),
  isLoading: false, isError: false, isUnavailable: false, refetch: vi.fn(), ...over});
const structure = (over: Over = {}) => ({entityTypes: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over});
function renderInterface() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const ui = () => ( // a fresh element per call, so a rerender re-reads the mocked hooks
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?extractionTab=dashboard']}><ExtractionInterface projectId="p1" /></MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui()); return {client, rerender: () => view.rerender(ui())};
}
const stat = (label: string) => screen.getByText(label).previousElementSibling?.textContent;
async function renderResolved() { // precondition: real figures rendered before one input flips
  const view = renderInterface();
  expect(await screen.findByText(ARTICLES)).toBeInTheDocument();
  await waitFor(() => expect(stat(ARTICLES)).toBe('2'));
  return view;
}
const expectNoFigures = () => [screen.queryByText(ARTICLES), screen.queryByRole('img', {name: DISTRIBUTION})]
  .forEach((el) => expect(el).toBeNull());
beforeEach(() => {
  vi.clearAllMocks(); m.useAuthMock.mockReturnValue({user: {id: 'user-1'}, loading: false});
  m.fetchArticlesMock.mockResolvedValue({ok: true, data: [{id: 'a1'}, {id: 'a2'}]});
  m.templatesMock.mockReturnValue(templates());
  m.valuesMock.mockReturnValue(values());
  m.structureMock.mockReturnValue(structure());
});
describe('ExtractionInterface dashboard progress states', () => {
  it('shows the page-level templates skeleton, not the dashboard, while templates load', async () => {
    m.templatesMock.mockReturnValue(templates({data: undefined, isLoading: true}));
    const {client} = renderInterface();
    // The article read settled, so only the templates load can be what hides the dashboard.
    await waitFor(() => expect(client.getQueryState(articleKeys.byProject('p1'))?.status).toBe('success'));
    expect(screen.getByLabelText(t('extraction', 'loadingTemplates'))).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
    expectNoFigures();
  });
  it('shows the templates error once, with a retry that refetches templates', async () => {
    const q = templates({data: undefined, isError: true, error: new Error('boom')});
    m.templatesMock.mockReturnValue(q);
    renderInterface();
    expect(await screen.findAllByText(TEMPLATES_ERROR)).toHaveLength(1);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText(CONFIGURE)).toBeNull();
    expectNoFigures();
    await userEvent.click(screen.getByRole('button', {name: TRY_AGAIN}));
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the dashboard figures when a template refetch fails with cached data', async () => {
    const view = await renderResolved();
    m.templatesMock.mockReturnValue(templates({isError: true, error: new Error('boom')})); // v5 refetch error: data kept
    view.rerender();
    expect(stat(ARTICLES)).toBe('2');
    expect(stat(AVG)).toBe('50%');
    expect(screen.getAllByText(TEMPLATES_ERROR)).toHaveLength(1);
  });
  it('shows only the configure card when no template is active', async () => {
    m.templatesMock.mockReturnValue(templates({data: []}));
    m.structureMock.mockReturnValue(structure({isLoading: true}));
    renderInterface();
    expect(await screen.findByText(CONFIGURE)).toBeInTheDocument();
    expectNoFigures();
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
  });
  it('shows the skeleton while the article list is loading', async () => {
    m.fetchArticlesMock.mockReturnValue(new Promise(() => {}));
    renderInterface();
    await waitFor(() => expect(m.fetchArticlesMock).toHaveBeenCalledWith('p1'));
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expectNoFigures();
  });
  it('renders the error state when the article list fails to load', async () => {
    m.fetchArticlesMock.mockResolvedValue({ok: false, error: new Error('down')});
    renderInterface();
    expect(await screen.findByText(PROGRESS_ERROR)).toBeInTheDocument();
    expectNoFigures();
    m.fetchArticlesMock.mockClear();
    await userEvent.click(screen.getByRole('button', {name: TRY_AGAIN}));
    await waitFor(() => expect(m.fetchArticlesMock).toHaveBeenCalledWith('p1'));
  });
  it.each([
    ['shows the skeleton while the user lookup is resolving', () => m.useAuthMock.mockReturnValue({user: null, loading: true})],
    ['shows the skeleton while progress loads', () => m.valuesMock.mockReturnValue(values({isLoading: true}))],
  ])('%s', async (_name, flip) => {
    const view = await renderResolved();
    flip();
    view.rerender();
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    expectNoFigures();
  });
  it('renders progress unavailable once the lookup resolves with no user', async () => {
    const view = await renderResolved();
    m.useAuthMock.mockReturnValue({user: null, loading: false});
    m.valuesMock.mockReturnValue(values({isUnavailable: true}));
    view.rerender();
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expectNoFigures();
    expect(screen.queryByRole('button', {name: TRY_AGAIN})).toBeNull();
  });
  it.each([
    ['shows an error with retry when progress fails', 'values'],
    ['shows an error with retry when the template structure fails', 'structure'],
  ] as const)('%s', async (_name, failed) => {
    const view = await renderResolved();
    const v = values({isError: failed === 'values'}), s = structure({isError: failed === 'structure'});
    m.valuesMock.mockReturnValue(v);
    m.structureMock.mockReturnValue(s);
    view.rerender();
    expect(screen.getByText(PROGRESS_ERROR)).toBeInTheDocument();
    expectNoFigures();
    await userEvent.click(screen.getByRole('button', {name: TRY_AGAIN}));
    expect((failed === 'values' ? v : s).refetch).toHaveBeenCalledTimes(1);
    expect((failed === 'values' ? s : v).refetch).not.toHaveBeenCalled();
  });
  it('renders the dashboard figures once progress has loaded', async () => {
    renderInterface();
    expect(await screen.findByText(ARTICLES)).toBeInTheDocument();
    await waitFor(() => expect(stat(ARTICLES)).toBe('2'));
    expect(stat(AVG)).toBe('50%');
    expect(screen.queryByTestId('dashboard-skeleton')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail for the right reason**

Run: `npx vitest run frontend/test/components/ExtractionInterface.progressStates.test.tsx`. Expected: all 12 FAIL. The component still loads articles through `loadProjectArticles`. The mock does not define it, so vitest also reports an unhandled rejection naming `loadProjectArticles`. No article query exists, so the first test's query-state precondition and the `'2'` precondition in `renderResolved` and the figures test never hold. Nothing gates on templates error, auth, the article read or a progress error. If a test passes here, stop and check its precondition before you continue.

- [ ] **Step 4: Replace the loader with the article query, route progress through the gate, order the dashboard**

`ExtractionInterface.tsx`, imports:
- Replace `import {useArticleExtractionValues} from '@/hooks/extraction/useArticleExtractionValues';` (:17) with `import {resolveProgressGate, useCallerArticleProgress} from '@/hooks/extraction/useCallerArticleProgress';`.
- Delete `import {useAuth} from '@/contexts/AuthContext';` (:26) and `import {toast} from 'sonner';` (:30); nothing else uses them. `import {loadProjectArticles} …` (:28) becomes `import {fetchProjectArticles} from '@/services/articlesService';`.
- Add `import {useQuery} from '@tanstack/react-query';`, `import {ErrorState} from '@/components/patterns/ErrorState';` and `import {articleKeys} from '@/lib/query-keys';`. All other imports stay.

Delete `const { user } = useAuth();` (:38). Replace `const [articles, setArticles] = useState<any[]>([]);` (:53) with:
```tsx
  // Same key + fetcher as the QA dashboard: one shared cache entry (R18).
  const articlesQuery = useQuery({
    queryKey: articleKeys.byProject(projectId),
    queryFn: async () => {
      const result = await fetchProjectArticles(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
  const articles = articlesQuery.data ?? [];
```
Replace the two hook calls, from the comment `// Per-article values + required-field structure` (:74) through `} = useActiveTemplateStructure(projectId, activeTemplate?.id);` (:91), with:
```tsx
  // Per-article values + required-field structure, shared with the list tables
  // through the one caller-progress gate (R37).
  const progress = useCallerArticleProgress(projectId, activeTemplate?.id, 'extraction');
  // ACTIVE snapshot (B-3a). Loading/error must render a placeholder, never
  // stats computed from an empty tree (reads as inflated completeness).
  const structure = useActiveTemplateStructure(projectId, activeTemplate?.id);
  const {entityTypes} = structure;
```
In `extractionStats`, change `valuesByArticle.get(article.id)` (:101) to `progress.valuesByArticle.get(article.id)` and `valuesByArticle.size` (:110) to `progress.valuesByArticle.size`.

Delete `loadArticles`, the `// Load articles and statistics` effect and the blank line after it (:185-202).

Move the configure card out of the figures. Delete the wrapper line `{!activeTemplate && !templatesLoading && (` (:271) and its closing `)}` (:298). Move the `<Card className="border-info/30 bg-info/5">…</Card>` they wrapped (:272-297) verbatim into `const renderConfigureCard = () => (…);`, declared just above `renderDashboard`. The figures `<div className="space-y-4">` then holds only the stat strip and the distribution card.

Replace the head of `renderDashboard`, from `const renderDashboard = () => {` (:205) through the old skeleton `}` (:210). The figures `return (` (:211) stays as step 9:
```tsx
  const renderDashboard = () => {
    const skeleton = <Skeleton data-testid="dashboard-skeleton" className="h-48 w-full rounded-md border" />;
    const loadError = (onRetry: () => void) => (
      <ErrorState message={t('extraction', 'errorLoadProgress')} onRetry={onRetry} />
    );
    // R18, first match wins (templates LOADING never reaches here). 1. First template load failed, nothing
    // cached: the page-level ErrorState is the one surface. A failed REFETCH keeps `data` and falls through.
    if (projectTemplatesQuery.isError && projectTemplatesQuery.data === undefined) return null;
    // 2. Before 3-8: without a template both progress reads are disabled and structure stays pending.
    if (!activeTemplate) return renderConfigureCard();
    if (articlesQuery.isPending) return skeleton; // 3
    // 4. The article query keys on projectId alone, so its retry refetches that query, not progress.
    if (articlesQuery.isError) return loadError(() => void articlesQuery.refetch());
    // 5-8, in the ONE shared order (R37): auth resolving, signed out, a failed read (retry only it), pending reads.
    const gate = resolveProgressGate(progress, structure);
    if (gate.state === 'authResolving' || gate.state === 'loading') return skeleton; // 5, 8
    if (gate.state === 'signedOut') return <ErrorState message={t('extraction', 'progressUnavailable')} />; // 6
    if (gate.state === 'error') return loadError(gate.retry); // 7
    // 9. The figures.
```
Replace the page-level `{/* Error state */}` block with its `{templatesError && (<Card className="border-destructive">…</Card>)}` (:459-472). Keep its place below the tab container:
```tsx
      {templatesError && (
        <ErrorState title={t('extraction', 'errorLoadTemplates')} message={templatesError}
          onRetry={() => void projectTemplatesQuery.refetch()} />
      )}
```
`frontend/services/articlesService.ts`: delete :439-458 (the `// ExtractionInterface: article list for dashboard stats` banner and its two rule lines, `export interface ArticleRow`, `loadProjectArticles` and its doc line). No production caller remains.

`frontend/test/services/articlesService.test.ts`: delete `  loadProjectArticles,` from the import and the row `    ['loadProjectArticles', loadProjectArticles],` from `loaders`. The cases now cover `loadExtractionTableArticles` and `fetchProjectArticles` (R13).

- [ ] **Step 5: Run the tests and the gates**

- `npx vitest run frontend/test/components/ExtractionInterface.progressStates.test.tsx frontend/test/components/ExtractionInterface.gear.test.tsx frontend/test/components/ExtractionInterface.templateSwitch.test.tsx frontend/test/services/articlesService.test.ts` → PASS: 12 + 1 + 1 tests in the three component suites, and `articlesService` green with no `loadProjectArticles` row in its output. No unhandled errors.
- `npm run typecheck` → exit 0. `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints` → zero findings in both.
- `python3 scripts/fitness/check_copy_keys.py` → exit 0 (both new keys referenced, `errorLoadArticles` gone). `python3 scripts/fitness/check_file_size.py` → exit 0; `wc -l frontend/components/extraction/ExtractionInterface.tsx` ≈ 500 (baseline 505, cap 800).
- `grep -rn "loadProjectArticles" frontend --include='*.ts' --include='*.tsx'` → only `services/projectsService.ts`, `pages/ProjectView.tsx`, `test/pages/ProjectView.articleEditor.test.tsx` (the other function). `grep -n "useArticleExtractionValues\|useAuth\|toast\|errorLoadArticles\|refetchStructure\|isAuthResolving\|isSignedOut" frontend/components/extraction/ExtractionInterface.tsx` → no output (the progress steps are ordered only by `resolveProgressGate`).
- `npx eslint frontend/components/extraction/ExtractionInterface.tsx frontend/test/components/ExtractionInterface.progressStates.test.tsx` → exit 0.

- [ ] **Step 6: Commit (path-scoped)**

```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add frontend/test/components/ExtractionInterface.progressStates.test.tsx
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "feat(extraction): ordered dashboard states over the shared article query and progress gate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- frontend/components/extraction/ExtractionInterface.tsx frontend/services/articlesService.ts frontend/test/services/articlesService.test.ts frontend/lib/copy/extraction.ts frontend/test/components/ExtractionInterface.progressStates.test.tsx frontend/test/components/ExtractionInterface.gear.test.tsx frontend/test/components/ExtractionInterface.templateSwitch.test.tsx
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --stat HEAD  # expect exactly these 7 paths, no other
```

### Task 4c: Worklist tables through the shared gate, delete getCurrentUserId (cluster 3d, R19, R35)

**Spec:** cluster 3d (R19, R35). **NEW tests:** 10 (5 per table suite).

**Files:**
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx:71-73, :179, :191-200, :233-240, :244, :286-291, :302-305, :323, :343, :582-584`
- Modify: `frontend/components/hitl/HITLArticleTable.tsx:9-12, :33, :59, :65, :157, :170-189, :193-228, :381-388`
- Modify: `frontend/services/authService.ts:13-26` (delete the banner and `getCurrentUserId`)
- Test: `frontend/components/extraction/ArticleExtractionTable.test.tsx` (5 NEW), `frontend/components/hitl/HITLArticleTable.test.tsx` (5 NEW)

**Interfaces:**
- Consumes (Task 4a, verbatim): `export function useCallerArticleProgress(projectId: string | null | undefined, templateId: string | null | undefined, kind: ReviewKind = 'extraction'): CallerArticleProgress`, in `frontend/hooks/extraction/useCallerArticleProgress.ts`. `CallerArticleProgress` = `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown>; userId: string | null | undefined; isAuthResolving: boolean; isSignedOut: boolean }` (not exported). `userId` is `undefined` while auth resolves, `null` once it resolved with no user, and the id otherwise. The two flags are never both true.
- Consumes (Task 4a): `useActiveTemplateStructure(projectId, templateId)` → `{ entityTypes, isLoading, isError, error, refetch }`.
- Consumes (Task 4a, verbatim): `export function resolveProgressGate(progress: ProgressRead & Pick<CallerArticleProgress, 'isAuthResolving' | 'isSignedOut'>, structure: ProgressRead): ProgressGate`, from the same module. `ProgressRead = { isLoading: boolean; isError: boolean; refetch: () => Promise<unknown> }`. `ProgressGate = { state: 'authResolving' } | { state: 'signedOut' } | { state: 'error'; retry: () => void } | { state: 'loading' } | { state: 'ready' }` (neither type exported). First match wins in that order; `retry` refetches only the failed read. Each table renders the states itself and adds its own article `loading` to the skeleton (R19 step 4).
- Consumes (Task 4b): copy keys `extraction.errorLoadProgress` and `extraction.progressUnavailable`. Also `ErrorState` from `@/components/patterns/ErrorState` (`{ title?, message, onRetry? }`), whose retry button is labelled `patterns.errorTryAgain`.
- Produces: the test id `extraction-table-loading` on the extraction table's skeleton. `getCurrentUserId` no longer exists.

**Mocking strategy (chosen, both suites):** a hoisted `useAuthMock` behind `@/contexts/AuthContext` (the precedent is `HITLExportDialog.test.tsx:49,66,89`). `@/hooks/extraction/useArticleExtractionValues` and `@/hooks/extraction/useActiveTemplateStructure` are mocked at the module boundary, each with its own `refetch` spy. `useCallerArticleProgress` stays REAL, so the auth → `userId` derivation reaches the table's fetch exactly as in production. This is R19's test text, and the same approach as the Task 4b suite.

- [ ] **Step 1: ArticleExtractionTable suite: new mocks and 5 failing tests**

In `frontend/components/extraction/ArticleExtractionTable.test.tsx`:
- Imports: change the RTL import to `import { render, screen, waitFor, within } from '@testing-library/react';`, and add `import userEvent from '@testing-library/user-event';` and `import type { ReactNode } from 'react';`.
- Replace the hoisted block (:31-35) with the block below. Delete the `@/services/authService` mock (:45-47). Replace the two hook mocks (:53-67) with the mocks below, keeping their leading comment (:49-52). In `beforeEach`, replace `getUserSpy.mockResolvedValue({ ok: true, data: 'user-1' });` (:91) with `useAuthMock.mockReturnValue(AUTH_USER); structure.isError = false; Object.assign(values, { isLoading: false, isError: false });`.

```tsx
const { loadSpy, useAuthMock, structure, values, structureRefetch, valuesRefetch } = vi.hoisted(() => ({
  loadSpy: vi.fn(), useAuthMock: vi.fn(), structureRefetch: vi.fn(), valuesRefetch: vi.fn(),
  structure: { isLoading: true, isError: false }, values: { isLoading: false, isError: false },
}));
const AUTH_USER = { user: { id: 'user-1' }, loading: false };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({ entityTypes: [], error: null, refetch: structureRefetch, ...structure }),
}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({ valuesByArticle: new Map(), isUnavailable: false, refetch: valuesRefetch, ...values }),
}));
```

Replace `renderTable` (:75-86). A rerender builds fresh elements, so the table re-reads the mocks:

```tsx
function renderTable(toolbarActions?: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ArticleExtractionTable projectId="p1" templateId="t1" toolbarActions={toolbarActions} /></MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}
```

Append the block below. `t` is mocked to echo the key.

```tsx
describe('ArticleExtractionTable → progress states', () => {
  beforeEach(() => { structure.isLoading = false; });
  // A11: the retry refetches ONLY the query that failed.
  it.each([
    ['renders the error state when progress fails', values, valuesRefetch, structureRefetch],
    ['renders the error state when the structure fails', structure, structureRefetch, valuesRefetch],
  ])('%s', async (_name, failing, failedRefetch, otherRefetch) => {
    failing.isError = true;
    renderTable();
    expect(await screen.findByText('errorLoadProgress')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'errorTryAgain' }));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
    expect(otherRefetch).not.toHaveBeenCalled();
  });
  it('keeps the toolbar actions rendered while progress loads', async () => {
    values.isLoading = true;
    renderTable(<button type="button">toolbar-action</button>);
    expect(await screen.findByRole('button', { name: 'toolbar-action' })).toBeInTheDocument();
    expect(screen.getByTestId('extraction-table-loading')).toBeInTheDocument();
  });
  it('shows the skeleton while the user lookup is resolving', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    const view = renderTable();
    expect(screen.getByTestId('extraction-table-loading')).toBeInTheDocument();
    expect(screen.queryByText('progressUnavailable')).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
    // Precondition: the same mount loads once auth resolves, so the skeleton was auth's.
    useAuthMock.mockReturnValue(AUTH_USER);
    view.rerender();
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith('p1'));
  });
  it('renders progress unavailable once the lookup resolves with no user', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    renderTable();
    expect(await screen.findByText('progressUnavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'errorTryAgain' })).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: HITLArticleTable suite: new mocks and 5 failing tests**

In `frontend/components/hitl/HITLArticleTable.test.tsx` (real copy; `userEvent` is already imported):
- Add `import type { ReactNode } from 'react';` and `import { t } from '@/lib/copy';`. Replace the hoisted block (:14-16) with the block below. Delete the `@/services/authService` mock (:18-20). Replace the two hook mocks (:33-45) with the mocks below. In the top `beforeEach` (:84), add these lines first: `vi.clearAllMocks(); useAuthMock.mockReturnValue(AUTH_USER); Object.assign(structure, { isLoading: false, isError: false }); Object.assign(values, { isLoading: false, isError: false });`.

```tsx
const { progressById, useAuthMock, structure, values, structureRefetch, valuesRefetch } = vi.hoisted(() => ({
  progressById: new Map<string, number>(), useAuthMock: vi.fn(), structureRefetch: vi.fn(), valuesRefetch: vi.fn(),
  structure: { isLoading: false, isError: false }, values: { isLoading: false, isError: false },
}));
const AUTH_USER = { user: { id: 'user-1' }, loading: false };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({ entityTypes: [], error: null, refetch: structureRefetch, ...structure }),
}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({
    valuesByArticle: new Map([
      ['a-wip', { instances: [{ id: 'i1' }], values: 'a-wip' }],
      ['a-done', { instances: [{ id: 'i2' }], values: 'a-done' }],
    ]),
    isUnavailable: false, refetch: valuesRefetch, ...values,
  }),
}));
```

Replace `renderTable` (:60-79). The elements are built inside `ui()` so that a rerender re-renders the table:

```tsx
function renderTable(toolbarActions?: ReactNode) {
  const ui = () => (
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route path="/list" element={<HITLArticleTable kind="quality_assessment" projectId="p1" templateId="t1"
          rowActionHref={(articleId, templateId) => `/qa/${articleId}/${templateId}`} toolbarActions={toolbarActions} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}
```

Append:

```tsx
describe('HITLArticleTable progress states', () => {
  const LOADING = 'hitl-quality_assessment-table-loading';
  const retryName = t('patterns', 'errorTryAgain');
  // A11: the retry refetches ONLY the query that failed.
  it.each([
    ['renders the error state when progress fails', values, valuesRefetch, structureRefetch],
    ['renders the error state when the structure fails', structure, structureRefetch, valuesRefetch],
  ])('%s', async (_name, failing, failedRefetch, otherRefetch) => {
    failing.isError = true;
    renderTable();
    expect(await screen.findByText(t('extraction', 'errorLoadProgress'))).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: retryName }));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
    expect(otherRefetch).not.toHaveBeenCalled();
  });
  it('keeps the toolbar actions rendered while progress loads', async () => {
    values.isLoading = true;
    renderTable(<button type="button">toolbar-action</button>);
    expect(await screen.findByRole('button', { name: 'toolbar-action' })).toBeInTheDocument();
    expect(screen.getByTestId(LOADING)).toBeInTheDocument();
  });
  it('shows the skeleton while the user lookup is resolving', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    const view = renderTable();
    expect(screen.getByTestId(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(t('extraction', 'progressUnavailable'))).toBeNull();
    useAuthMock.mockReturnValue(AUTH_USER); // precondition: rows arrive once auth resolves
    view.rerender();
    expect(await openControl('Half done')).toBeInTheDocument();
  });
  it('renders progress unavailable once the lookup resolves with no user', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    renderTable();
    expect(await screen.findByText(t('extraction', 'progressUnavailable'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: retryName })).toBeNull();
  });
});
```

- [ ] **Step 3: Run both suites and confirm the new tests fail**

Run: `npx vitest run frontend/components/extraction/ArticleExtractionTable.test.tsx frontend/components/hitl/HITLArticleTable.test.tsx`
Expected: FAIL, with none of the 10 new tests passing. Both tables still read `getCurrentUserId` and call `useArticleExtractionValues` directly, so `useAuthMock` gates nothing. Neither table has an `ErrorState` branch, the extraction skeleton has no `extraction-table-loading` test id, and the HITL skeleton renders no toolbar. A suite that aborts at import, because the unmocked `@/services/authService` loads the Supabase client, is also the expected failure.

- [ ] **Step 4: Implement ArticleExtractionTable**

- Imports: replace the `getCurrentUserId`, `useActiveTemplateStructure` and `useArticleExtractionValues` imports (:71-73) with:

```tsx
import {useActiveTemplateStructure} from '@/hooks/extraction/useActiveTemplateStructure';
import {resolveProgressGate, useCallerArticleProgress} from '@/hooks/extraction/useCallerArticleProgress';
import {ErrorState} from '@/components/patterns/ErrorState';
```

- Deletions: delete the `currentUserId` state (:179). Delete `loadCurrentUser` with its `// Declare loadCurrentUser…` comment (:233-240) and the blank line after it. Delete the `// Load current user ID` effect (:286-291) and its trailing blank line.
- Hook calls: replace the two calls (:191-200) with:

```tsx
  const structure = useActiveTemplateStructure(projectId, templateId);
  const {entityTypes} = structure;
  // Per-article values and the progress user id, through the ONE shared gate (R37).
  const progress = useCallerArticleProgress(projectId, templateId);
  const {valuesByArticle, userId} = progress;
```

- Renames: every remaining `currentUserId` becomes `userId`. That covers the `loadArticles` guard (:244), the load effect (:302, :305) and the auto-refresh effect (:323, :343). Gate: replace the gate line and the skeleton's opening `<div className="space-y-3">` (:582-584) with the code below. The rest of the skeleton `return` is unchanged.

```tsx
  // R19 in the ONE shared order (R37): auth resolving → skeleton; signed out → unavailable, before
  // `loading`, which never clears without a user; a failed read → retry THAT read; pending → skeleton.
  const gate = resolveProgressGate(progress, structure);
  if (gate.state === 'signedOut') return <ErrorState message={t('extraction', 'progressUnavailable')} />;
  if (gate.state === 'error') return <ErrorState message={t('extraction', 'errorLoadProgress')} onRetry={gate.retry} />;
  if (gate.state !== 'ready' || loading) {
    return (
        <div className="space-y-3" data-testid="extraction-table-loading">
```

- [ ] **Step 5: Implement HITLArticleTable and delete getCurrentUserId**

- In the header comment (:9-12), change ``from ``useArticleExtractionValues`` (the shared`` to ``from ``useCallerArticleProgress`` (the shared``. Add `import { ErrorState } from "@/components/patterns/ErrorState";` after the `IconButton` import (:33). Delete the `getCurrentUserId` import (:59). Replace the `useArticleExtractionValues` import (:65) with `import { resolveProgressGate, useCallerArticleProgress } from "@/hooks/extraction/useCallerArticleProgress";`.
- Delete the `currentUserId` state (:157), and the lookup effect (:180-189) with its trailing blank line.
- Hook calls: replace the destructures (:170-178) with:

```tsx
  const structure = useActiveTemplateStructure(projectId, templateId);
  const { entityTypes } = structure;
  // Per-article values and the progress user id, through the ONE shared gate (R37).
  const progress = useCallerArticleProgress(projectId, templateId, kind);
  const { valuesByArticle, userId } = progress;
```

- Renames: every `currentUserId` in the `prevQueryKey` block and the fetch effect (:193-228) becomes `userId`, including the object key. That gives `useState({ projectId, templateId, userId })`, `userId !== prevQueryKey.userId`, `setPrevQueryKey({ projectId, templateId, userId })`, and the effect's guard and dependency list.
- Loading block: replace the whole block (:381-388) with:

```tsx
  const gate = resolveProgressGate(progress, structure); // R19, in the ONE shared order (R37)
  if (gate.state === "signedOut") return <ErrorState message={t("extraction", "progressUnavailable")} />;
  if (gate.state === "error") return <ErrorState message={t("extraction", "errorLoadProgress")} onRetry={gate.retry} />;
  if (gate.state !== "ready" || loading) {
    return (
      <div className="space-y-3" data-testid={`hitl-${kind}-table-loading`}>
        {toolbarActions && <div className="flex justify-end">{toolbarActions}</div>}
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
```

- `frontend/services/authService.ts`: delete lines 13-26. That removes the `ArticleExtractionTable: current authenticated user id` banner, the JSDoc, `getCurrentUserId` and the blank line after it. The `supabase`, `toResult` and `ErrorResult` imports stay, because the remaining exports use them.

- [ ] **Step 6: Run the tests and the gates**

Run everything from the worktree root, `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`:
- `npx vitest run frontend/components/extraction/ArticleExtractionTable.test.tsx frontend/components/hitl/HITLArticleTable.test.tsx`. Expected: PASS. That is 10 new tests plus 8 existing ones: 2 in the extraction suite, and 6 in the HITL suite, counting the `it.each` keyboard cases as 2.
- `npx vitest run frontend/test/hooks/useCallerArticleProgress.test.tsx frontend/test/QualityAssessmentInterface.test.tsx frontend/test/components/ExtractionInterface.progressStates.test.tsx frontend/test/components/ExtractionInterface.gear.test.tsx frontend/test/components/ExtractionInterface.templateSwitch.test.tsx`. Expected: PASS. `QualityAssessmentInterface.test.tsx:32` mocks `useAuth` without a `loading` key around the real `HITLArticleTable`, which reads as resolved.
- Prove A11 bites through both tables. In `frontend/hooks/extraction/useCallerArticleProgress.ts` (committed by Task 4a), temporarily change `if (progress.isError) void progress.refetch();` to `void progress.refetch();`. Re-run the first command. Expected: `renders the error state when the structure fails` FAILS in both table suites. Revert, then run `git diff --quiet -- frontend/hooks/extraction/useCallerArticleProgress.ts && echo restored`. Expected: `restored`.
- `rg -n "resolveProgressGate\(" frontend --glob '!frontend/test/**'`. Expected: exactly 4 lines: the definition in `useCallerArticleProgress.ts`, then `ExtractionInterface.tsx`, `ArticleExtractionTable.tsx` and `HITLArticleTable.tsx`. `rg -n "refetchValues|refetchStructure|isAuthResolving|isSignedOut" frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/hitl/HITLArticleTable.tsx`. Expected: no output (exit 1), because no table orders the progress flags itself.
- `rg -n getCurrentUserId frontend` and `rg -n "currentUserId|progressUserId" frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/hitl/HITLArticleTable.tsx`. Expected: no output from either (exit 1).
- `rg -n "useArticleExtractionValues\(" frontend/components`. Expected: exactly one line, in `frontend/components/quality/QualityAssessmentInterface.tsx`. Task 9 ports it.
- `npm run typecheck`. Expected: exit 0. `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`. Expected: zero findings in both.
- `python3 scripts/fitness/check_copy_keys.py` and `python3 scripts/fitness/check_file_size.py`. Expected: exit 0 for both. `wc -l frontend/components/extraction/ArticleExtractionTable.tsx` shows about 1050 and must be ≤ 1134. `HITLArticleTable.tsx` must be ≤ 800. Never pass `--update-baseline`.

- [ ] **Step 7: Commit only this task's paths**

```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "feat(worklists): read progress through the shared caller gate; drop getCurrentUserId

Both tables take the user id from useCallerArticleProgress, order its flags per R19 and
retry only the failed read. getCurrentUserId has no caller left and is deleted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/extraction/ArticleExtractionTable.test.tsx \
  frontend/components/hitl/HITLArticleTable.tsx frontend/components/hitl/HITLArticleTable.test.tsx \
  frontend/services/authService.ts
```

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --stat HEAD`. Expected: exactly these 5 paths.

### Task 5: Collapsed rail as a dot strip + rail copy

Spec cluster 4 (R22, R23, R24, R34). Task 0 committed the dot strip with the imported WIP. It is `compact` in `SectionNavRail.tsx` and the `w-8` strip in `SectionNavLayout.tsx:115-118`. Inspect it as it is in the tree: read both files, or run `git log -p -1 -- frontend/components/extraction/SectionNavRail.tsx frontend/components/runs/SectionNavLayout.tsx`. The existing tests `in compact mode keeps only status dots, hiding labels and the footer`, `collapses to a left-aligned dot strip and remembers the choice`, `mod+\\ toggles the rail between labels and dots` and `keeps the jump control in compact mode as an icon-only button` already cover part of it. This task proves the rest with 5 NEW behaviour tests. It adds 1 NEW copy test, the only one that starts red, and changes the copy TEXT (keys unchanged). Do not rewrite the rail or the layout. Change them only if a NEW test proves a gap (Step 8).

**Files:**
- Create: `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts`
- Modify: `frontend/lib/copy/runs.ts:88,91-92` (text only)
- Modify: `frontend/test/SectionNavRail.test.tsx` (3 NEW tests)
- Modify: `frontend/components/extraction/SectionNavRail.jumpNext.test.tsx` (1 NEW test)
- Modify: `frontend/components/runs/SectionNavLayout.test.tsx:51` (rename) and 1 NEW test
- Modify: `frontend/test/QualityAssessmentFullScreen.review.test.tsx:126` (`"Hide sections"` → `"Collapse sections"`)
- Verify only (committed in Task 0): `frontend/components/extraction/SectionNavRail.tsx`, `frontend/components/runs/SectionNavLayout.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (Tasks 6 and 8 rely on these):
  - `SectionNavRailProps.compact?: boolean` (default `false`).
  - `SectionNavLayoutProps.onActivate?: (id: string) => void`. It is already in the committed `SectionNavLayout.tsx`, and Task 6 wires and tests it. Keep it.
  - Copy: `runs.shortcutSectionNav` = "Collapse / expand sections", `runs.sectionNavShow` = "Expand sections", `runs.sectionNavHide` = "Collapse sections". Keys unchanged.
  - `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts` with `describe('runs copy — run-screen shortcut labels', …)`. Task 8 appends `names the pager previous first, like the chevrons` inside this describe.

Radix Tooltip in jsdom (checked): `userEvent.tab()` focus and `userEvent.hover()` both open it (precedents: `frontend/components/ui/tooltip.test.tsx`, `frontend/components/patterns/IconButton.test.tsx:22-26`). The compact dot's `<Tooltip delayDuration={0}>` opens at once without an app provider. The hover test below was probed against this tree and passed.

All commands run from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`.

- [ ] **Step 1: Baseline — existing rail suites are green**

Run: `npx vitest run frontend/test/SectionNavRail.test.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx`
Expected: PASS (3 files). If any existing test is red, stop and use `superpowers:systematic-debugging` before going on.

- [ ] **Step 2: Write the failing copy test**

Create `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts`. Import the namespace directly, as `extraction.legacyKeys.test.ts` does, so no `t` mock hides the text:

```ts
import { describe, expect, it } from 'vitest';
import { runs } from '@/lib/copy/runs';

describe('runs copy — run-screen shortcut labels', () => {
  it('names the rail toggle collapse and expand, not hide and show', () => {
    expect(runs.shortcutSectionNav).toBe('Collapse / expand sections');
    expect(runs.sectionNavShow).toBe('Expand sections');
    expect(runs.sectionNavHide).toBe('Collapse sections');
  });
});
```

Then update the two tests that name the toggle. In `frontend/components/runs/SectionNavLayout.test.tsx:51`, rename the test. Its body is unchanged, because this file mocks `t` to return keys:

```tsx
  it('shows the section rail by default, with a toggle that says it collapses it', () => {
```

In `frontend/test/QualityAssessmentFullScreen.review.test.tsx:126`, which uses the real copy:

```tsx
    expect(screen.getByRole("button", { name: "Collapse sections" })).toHaveAttribute(
```

- [ ] **Step 3: Run the copy tests to verify they fail**

Run: `npx vitest run frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts -t "names the rail toggle collapse and expand, not hide and show"`
Expected: FAIL with `expected 'Show / hide sections' to be 'Collapse / expand sections'`.

Run: `npx vitest run frontend/test/QualityAssessmentFullScreen.review.test.tsx -t "gives the assessment form the same section rail as extraction, one entry per domain"`
Expected: FAIL. No button is named "Collapse sections", because the button is still "Hide sections".

- [ ] **Step 4: Change the copy text**

In `frontend/lib/copy/runs.ts`, change only these three values:

```ts
  shortcutSectionNav: 'Collapse / expand sections',
```

```ts
  // SectionNavLayout — the form's section rail toggle
  sectionNavShow: 'Expand sections',
  sectionNavHide: 'Collapse sections',
```

Leave `shortcutNextPrev: 'Previous / next article'` as it is. Task 0 committed it, and Task 8 asserts it.

- [ ] **Step 5: Run the copy tests to verify they pass**

Run: `npx vitest run frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts frontend/test/QualityAssessmentFullScreen.review.test.tsx frontend/components/runs/SectionNavLayout.test.tsx`
Expected: PASS (3 files). The renamed test `shows the section rail by default, with a toggle that says it collapses it` is listed.

- [ ] **Step 6: Add the 5 NEW behaviour tests**

`frontend/test/SectionNavRail.test.tsx`: add `import userEvent from '@testing-library/user-event';` below the `@testing-library/react` import. Then append inside `describe('SectionNavRail', …)`. The hover test asserts no tooltip before the hover and no focus after it, so it proves pointer hover alone opens the tooltip:

```tsx
  it('shows the label and count in a tooltip when a dot takes focus', async () => {
    render(<SectionNavRail compact items={items} activeId="s1" onSelect={() => {}} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Source of data 1/1' })).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Source of data');
    expect(tooltip).toHaveTextContent('1/1');
  });

  it('shows the label and count in a tooltip when a dot is hovered', async () => {
    render(<SectionNavRail compact items={items} activeId="s1" onSelect={() => {}} />);
    const dot = screen.getByRole('button', { name: 'Participants 3/12' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(dot);
    expect(dot).not.toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Participants');
    expect(tooltip).toHaveTextContent('3/12');
  });

  it('clicking a compact dot selects that section', () => {
    const onSelect = vi.fn();
    render(<SectionNavRail compact items={items} activeId="s1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Predictors 0/6' }));
    expect(onSelect).toHaveBeenCalledWith('cs');
  });
```

`frontend/components/extraction/SectionNavRail.jumpNext.test.tsx`: append inside `describe('SectionNavRail jump-to-next-unfilled', …)`. The dot assertion proves the compact rail rendered, so the absence check is not vacuous:

```tsx
  it('hides the jump control in compact mode on a read-only run', () => {
    render(
      <RunEditabilityProvider stage="finalized">
        <SectionNavRail compact items={incomplete} activeId={null} onSelect={vi.fn()} onJumpToNextPending={vi.fn()} />
      </RunEditabilityProvider>,
    );
    expect(screen.getByRole('button', { name: 'Participants 1/3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sectionNavJumpNext/ })).not.toBeInTheDocument();
  });
```

`frontend/components/runs/SectionNavLayout.test.tsx`: add this directly after `collapses to a left-aligned dot strip and remembers the choice`. The rail `<nav>` (the `rail()` helper, :43) sits inside the sticky strip `<div>` (`SectionNavLayout.tsx:115-118`):

```tsx
  it('the collapsed strip is the compact w-8 rail', async () => {
    render(<Layout />);
    const strip = () => rail()?.parentElement;
    expect(strip()).toHaveClass('w-[184px]');
    expect(strip()).not.toHaveClass('w-8');
    await userEvent.click(screen.getByRole('button', { name: 'sectionNavHide' }));
    expect(strip()).toHaveClass('w-8');
    expect(strip()).not.toHaveClass('w-[184px]');
  });
```

- [ ] **Step 7: Run the NEW behaviour tests**

Run: `npx vitest run frontend/test/SectionNavRail.test.tsx -t "shows the label and count in a tooltip when a dot takes focus"`
Run: `npx vitest run frontend/test/SectionNavRail.test.tsx -t "shows the label and count in a tooltip when a dot is hovered"`
Run: `npx vitest run frontend/test/SectionNavRail.test.tsx -t "clicking a compact dot selects that section"`
Run: `npx vitest run frontend/components/extraction/SectionNavRail.jumpNext.test.tsx -t "hides the jump control in compact mode on a read-only run"`
Run: `npx vitest run frontend/components/runs/SectionNavLayout.test.tsx -t "the collapsed strip is the compact w-8 rail"`
Expected: PASS for each, because the committed code already implements the behaviour. If one fails, go to Step 8. Otherwise skip Step 8 and go to Step 9.

- [ ] **Step 8: Fix only what a red test proves missing (skip if Step 7 was green)**

The required code for each test:
- Tooltip on focus and hover (R23): `SectionNavRail.tsx` wraps the compact row in `<Tooltip delayDuration={0}><TooltipTrigger asChild>{row}</TooltipTrigger><TooltipContent side="right" className="flex items-center gap-2"><span>{item.label}</span><span className="text-background/70">{count}</span></TooltipContent></Tooltip>`, where `count = \`${item.requiredFilled}/${item.requiredTotal}\``.
- Dot click (R23): the compact row button keeps `onClick={() => onSelect(item.id)}` and `aria-label={compact ? \`${item.label} ${count}\` : undefined}`.
- Read-only compact (R24): `const showJump = !readOnly && !!onJumpToNextPending && global.requiredLeft > 0;`, and the compact jump renders under `{compact && showJump && (…)}`.
- Strip (R22): the strip `div` class is `cn('sticky top-0 flex flex-col self-start border-r border-border/40', railOpen ? 'w-[184px] bg-muted/30 py-2' : 'w-8 items-center py-1')`.

Apply the missing piece, then re-run the Step 7 command until it passes.

- [ ] **Step 9: Prove the 5 behaviour tests bite (mutation check)**

These tests were green on arrival, so show that each one fails without its behaviour. If you skipped Step 8, both source files still match `HEAD`, and `git restore` returns them:

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip diff --quiet -- frontend/components/extraction/SectionNavRail.tsx frontend/components/runs/SectionNavLayout.tsx`
Expected: exit 0. If Step 8 changed either file, the command exits 1. In that case, undo the temporary edits below by hand instead of using `git restore`, so your Step 8 fix survives.

Apply these temporary edits:
- `SectionNavRail.tsx`: `{compact ? (` → `{false ? (`, which drops the tooltip.
- `SectionNavRail.tsx`: `onClick={() => onSelect(item.id)}` → `onClick={() => { if (!compact) onSelect(item.id); }}`.
- `SectionNavRail.tsx`: `{compact && showJump && (` → `{compact && !!onJumpToNextPending && (`.
- `SectionNavLayout.tsx`: `'w-8 items-center py-1'` → `'items-center py-1'`.

Run: `npx vitest run frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/runs/SectionNavLayout.test.tsx`
Expected: FAIL, with exactly these 5 tests red: `shows the label and count in a tooltip when a dot takes focus`, `shows the label and count in a tooltip when a dot is hovered`, `clicking a compact dot selects that section`, `hides the jump control in compact mode on a read-only run`, `the collapsed strip is the compact w-8 rail`.

Restore the committed versions:

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip restore frontend/components/extraction/SectionNavRail.tsx frontend/components/runs/SectionNavLayout.tsx`
Run: `npx vitest run frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/runs/SectionNavLayout.test.tsx`
Expected: PASS (3 files).

- [ ] **Step 10: Verify the whole task**

Run: `npx vitest run frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx frontend/components/runs/header/__tests__/Help.test.tsx`
Expected: PASS (6 files), with the 6 NEW tests listed.

Run: `rg -n "Hide sections|Show sections|Show / hide sections" frontend`
Expected: no output.

Run: `npm run typecheck`
Expected: exit 0. Do not use `npx tsc --noEmit -p .`: the root `tsconfig.json` has `"files": []`, so it checks nothing.

Run: `npx eslint frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts frontend/lib/copy/runs.ts frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx`
Expected: exit 0.

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0 (keys unchanged, no new unreferenced key).

Run: `python3 scripts/fitness/check_file_size.py`
Expected: exit 0. `QualityAssessmentFullScreen.review.test.tsx` stays at 739/800, because the edit is line-neutral.

- [ ] **Step 11: Commit**

Commits are path-scoped. Stage and commit only this task's paths. Add `frontend/components/extraction/SectionNavRail.tsx` and `frontend/components/runs/SectionNavLayout.tsx` to both lists only if Step 8 changed them.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts frontend/lib/copy/runs.ts frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx`
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "feat(runs): collapse the section rail to a status-dot strip" -m "Collapsing keeps a w-8 strip of status dots with focus and hover tooltips, dot selection and the jump control (hidden on read-only runs), now pinned by tests. The toggle copy says collapse/expand; keys unchanged." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts frontend/lib/copy/runs.ts frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx`
Expected: a commit on `feat/run-nav-and-dev-server` that passes the hooks.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --stat --format=%s HEAD`
Expected: exactly the 6 paths above (8 if Step 8 changed the two source files).

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip status --porcelain -- frontend/lib/copy frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx frontend/components/extraction/SectionNavRail.tsx frontend/components/runs/SectionNavLayout.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx`
Expected: no output. Nothing from this task is left uncommitted.

### Task 6: Position-based active section + pane scroll

Spec cluster 5 (R25–R29). Depends on Task 5. 6 NEW tests. Task 0 already committed the behaviour, `paneScroll{,.test}.ts` included. Inspect that committed code in the tree (read the file, or `git log -p -- <file>`). Verify the existing tests, add the 6 NEW tests, and prove each one red with a temporary mutation. Change production code only where a NEW test fails WITHOUT a mutation. Never rewrite working code. Commands run from the worktree root. `-t` is a regex, so `+` is escaped.

**Files:**
- Verify (committed by Task 0): `frontend/lib/runs/paneScroll.ts`, `frontend/lib/runs/paneScroll.test.ts`
- Verify (committed by Task 0; modify only where a NEW test fails without a mutation): `frontend/hooks/extraction/useActiveSection.ts`, `frontend/hooks/extraction/useJumpToNextPendingField.ts`, `frontend/components/extraction/ExtractionFormView.tsx:87,117`, `frontend/hooks/qa/useQASectionNav.ts:42-43`, `frontend/pages/QualityAssessmentFullScreen.tsx:928`
- Test: `frontend/test/useActiveSection.test.tsx` (3 NEW), `frontend/components/runs/SectionNavLayout.test.tsx` (1 NEW), `frontend/test/ExtractionFormView.test.tsx` (1 NEW), `frontend/test/QualityAssessmentFullScreen.review.test.tsx` (1 NEW), `frontend/hooks/extraction/useJumpToNextPendingField.test.tsx` (committed by Task 0; verify)

**Budget:** `QualityAssessmentFullScreen.tsx` is 1019/1021. The net line count of this file must not grow; verify with `python3 scripts/fitness/check_file_size.py`. `QualityAssessmentFullScreen.review.test.tsx` (739, not baselined) must stay ≤ 800.

**Interfaces:**
- Consumes (Task 5): `SectionNavLayout({ items, activeId, onSelect, onActivate?, children, ref? })`. Rail rows carry `aria-current="true"` when active.
- Produces (cluster-internal; no later task depends on it): `pickActiveSection(tops: readonly { id: string; top: number }[], anchor: number, atBottom: boolean): string | null`. `useActiveSection(sectionIds: string[])` → `{ activeId, registerSection, scrollToSection, activateSection }`. `findScrollParent(el: HTMLElement | null): HTMLElement | null` and `scrollIntoPane(el: HTMLElement, block?: 'start' | 'center'): void`. `PendingSections.onLanded?: (sectionId: string) => void`. `useQASectionNav(...)` also returns `activateSection`.

- [ ] **Step 1: Preflight and existing tests**

Run: `git log --oneline -1 && git log --oneline -1 -- frontend/lib/runs/paneScroll.ts && test -d node_modules && echo ready`
Expected: Task 5's commit on top, then Task 0's `chore` commit (it added `paneScroll.ts`), then `ready`. If `node_modules` is missing, install per Global Constraints.

Run: `npx vitest run frontend/test/useActiveSection.test.tsx frontend/lib/runs/paneScroll.test.ts frontend/hooks/extraction/useJumpToNextPendingField.test.tsx`
Expected: PASS: R25's 5 `pickActiveSection` tests, R27's 4 existing tests, R28's 5 `paneScroll` tests, and R29's `reports the section it landed in so the rail can shade it immediately`.

Run: `rg -n IntersectionObserver frontend/hooks/extraction/useActiveSection.ts`
Expected: no output, exit 1 (R26).

- [ ] **Step 2: Write the 3 NEW `useActiveSection` tests (R26, R27)**

In `frontend/test/useActiveSection.test.tsx`, import `afterEach` from `vitest` too. Add these helpers above `describe('useActiveSection', …)`:

```tsx
/** jsdom has no layout and no frame loop: frames run when the test says so. */
function manualFrames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { pending: () => queue.length, flush: () => act(() => queue.splice(0).forEach((cb) => cb(0))) };
}

/** An overflowing pane holding one section per entry, `top` px below the pane's top edge. */
function paneWith(tops: Record<string, number>) {
  const pane = document.createElement('div');
  pane.style.overflowY = 'auto';
  Object.defineProperty(pane, 'scrollHeight', { value: 3000 });
  Object.defineProperty(pane, 'clientHeight', { value: 600 });
  Object.defineProperty(pane, 'scrollTop', { value: 0, writable: true });
  pane.getBoundingClientRect = () => ({ top: 0, height: 600 }) as DOMRect;
  const sections = Object.entries(tops).map(([id, top]) => {
    const el = document.createElement('section');
    el.getBoundingClientRect = () => ({ top, height: 200 }) as DOMRect;
    pane.appendChild(el);
    return [id, el] as const;
  });
  document.body.appendChild(pane);
  return { pane, sections };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
```

Append inside `describe('useActiveSection', …)`:

```tsx
  it('recomputes the active section from a pane scroll, once per frame', () => {
    const frames = manualFrames();
    const { result } = renderHook(() => useActiveSection(['s1', 's2', 's3']));
    const { pane, sections } = paneWith({ s1: -500, s2: 100, s3: 700 });
    act(() => sections.forEach(([id, el]) => result.current.registerSection(id, el)));
    pane.dispatchEvent(new Event('scroll'));
    pane.dispatchEvent(new Event('scroll'));
    expect(frames.pending()).toBe(1);
    expect(result.current.activeId).toBe('s1');
    frames.flush();
    // 's2' starts above the 120px activation line and 's3' below it.
    expect(result.current.activeId).toBe('s2');
  });

  it('holds a clicked section for two frames against the landing scroll', () => {
    const frames = manualFrames();
    const { result } = renderHook(() => useActiveSection(['s1', 's2', 's3']));
    const { pane, sections } = paneWith({ s1: -500, s2: 100, s3: 700 });
    act(() => sections.forEach(([id, el]) => result.current.registerSection(id, el)));
    act(() => result.current.scrollToSection('s3'));
    // Frame 1: the landing scroll measures 's2' at the line; the hold keeps 's3'.
    pane.dispatchEvent(new Event('scroll'));
    frames.flush();
    expect(result.current.activeId).toBe('s3');
    // Frame 2 releases the hold, so the next scroll belongs to the reader again.
    frames.flush();
    pane.dispatchEvent(new Event('scroll'));
    frames.flush();
    expect(result.current.activeId).toBe('s2');
  });

  it('focuses the section with preventScroll so focus never scrolls an ancestor', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    const el = document.createElement('div');
    el.tabIndex = -1;
    const focus = vi.spyOn(el, 'focus');
    act(() => result.current.registerSection('s1', el));
    act(() => result.current.scrollToSection('s1'));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
```

Run: `npx vitest run frontend/test/useActiveSection.test.tsx -t "once per frame|two frames against the landing|preventScroll so focus"`
Expected: PASS (3 passed); the committed `useActiveSection.ts` already implements R26 and R27. If one FAILS, the tree lost that behaviour. Restore this code in `useActiveSection.ts` and re-run:

```ts
  const holdThroughScroll = useCallback(() => {
    settling.current += 1;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        settling.current -= 1;
      });
    });
  }, []);
  // in scrollToSection, after `if (!el) return;`:
      scrollIntoPane(el, 'start');
      el.focus({ preventScroll: true });
  // in the effect:
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
```

- [ ] **Step 3: Write the NEW `SectionNavLayout` wiring test (R29)**

In `frontend/components/runs/SectionNavLayout.test.tsx`, append inside `describe('SectionNavLayout — section open state', …)` (it reuses that describe's `sections` and the file's `Section`):

```tsx
  it('a mod+Enter jump calls onActivate with the section it lands in', async () => {
    const onActivate = vi.fn();
    render(
      <SectionNavLayout items={sections} activeId={null} onSelect={vi.fn()} onActivate={onActivate}>
        <Section id="done" pending={false} />
        <Section id="todo" pending />
      </SectionNavLayout>,
    );
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByLabelText('todo field')).toHaveFocus();
    expect(onActivate).toHaveBeenCalledWith('todo');
    expect(onActivate).not.toHaveBeenCalledWith('done');
  });
```

Run: `npx vitest run frontend/components/runs/SectionNavLayout.test.tsx -t "a mod\+Enter jump calls onActivate"`
Expected: PASS (`SectionNavLayout.tsx:89` passes `onLanded: onActivate`).

- [ ] **Step 4: Write the NEW extraction screen test (R29)**

In `frontend/test/ExtractionFormView.test.tsx`, add `import userEvent from '@testing-library/user-event';`. Change the `SectionAccordion` mock's self-closing `<div … />` into a `<div …>` that keeps the same four attributes and wraps one pending row. Existing fixtures have no required field, so the other tests are unaffected:

```tsx
    >
      {props.fields.some((f: any) => f.is_required) && (
        <div data-pending-required="">
          <input aria-label={`${props.entityType.name} field`} />
        </div>
      )}
    </div>
```

Append at the end of the file:

```tsx
describe('ExtractionFormView → jump to the next pending field', () => {
  it('a jump to the next pending field marks the section it lands in active', async () => {
    const requiredSecond = {
      ...SECOND_STUDY,
      fields: [{id: 'f2', name: 'n_participants', label: 'Count', field_type: 'number', is_required: true}],
    };
    // The rail counts required fields per instance, so each root gets one.
    const instances = [
      {id: 'i1', entity_type_id: 'study-et', parent_instance_id: null},
      {id: 'i2', entity_type_id: 'study2-et', parent_instance_id: null},
    ];
    render(<ExtractionFormView {...baseProps({entityTypes: [STUDY, requiredSecond], instances})} />);
    const row = (name: RegExp) => within(screen.getByRole('navigation')).getByRole('button', {name});
    expect(row(/Study Metadata/)).toHaveAttribute('aria-current', 'true'); // precondition

    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(screen.getByLabelText('participants field')).toHaveFocus();
    expect(row(/Participants/)).toHaveAttribute('aria-current', 'true');
    expect(row(/Study Metadata/)).not.toHaveAttribute('aria-current');
  });
});
```

Run: `npx vitest run frontend/test/ExtractionFormView.test.tsx`
Expected: PASS (9 passed).

- [ ] **Step 5: Write the NEW QA screen test (R29)**

In `frontend/test/QualityAssessmentFullScreen.review.test.tsx`, add below `membersFixture`: `const tablesFixture = vi.hoisted(() => ({}) as Record<string, unknown>);`. Change the supabase factory to `makeSupabaseClientMock(membersFixture, tablesFixture)`; it checks `table in tables` per call, so a per-test mutation applies. Extend the `./helpers/qaFullScreenMocks` import to `BLIND_PERMISSIONS, PARTICIPANTS_DOMAIN, ROB_FIELD, SIGNALING_QUESTION, makeApiClientDefault`. Append at the end of the file:

```tsx
describe("QualityAssessmentFullScreen — jump to the next pending item", () => {
  const ANALYSIS = { ...PARTICIPANTS_DOMAIN, id: "et-2", name: "analysis", label: "Analysis", sort_order: 2 };
  const REQUIRED = { ...SIGNALING_QUESTION, id: "f-3", entity_type_id: "et-2", name: "q4_1", is_required: true };

  beforeEach(() => {
    mockedPermissions.mockReturnValue(BLIND_PERMISSIONS);
    tablesFixture.extraction_entity_types = [
      { ...PARTICIPANTS_DOMAIN, extraction_fields: [SIGNALING_QUESTION, ROB_FIELD] },
      { ...ANALYSIS, extraction_fields: [REQUIRED] },
    ];
    const byDefault = makeApiClientDefault();
    vi.mocked(apiClient).mockImplementation(async (url: string) =>
      url === "/api/v1/hitl/sessions"
        ? { run_id: "run-1", kind: "quality_assessment", project_template_id: "tpl-1",
            instances_by_entity_type: { "et-1": "inst-1", "et-2": "inst-2" } }
        : byDefault(url),
    );
  });

  afterEach(() => {
    delete tablesFixture.extraction_entity_types;
    vi.mocked(apiClient).mockImplementation(makeApiClientDefault());
  });

  it("a jump to the next pending item marks the section it lands in active", async () => {
    renderPage();
    const rail = await screen.findByRole("navigation", { name: "Section navigation" });
    const analysis = await within(rail).findByRole("button", { name: /Analysis/ });
    const participants = within(rail).getByRole("button", { name: /Participants/ });
    // Precondition: the first domain owns the rail; "Analysis" is closed and pending.
    expect(participants).toHaveAttribute("aria-current", "true");
    expect(analysis).not.toHaveAttribute("aria-current");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(analysis).toHaveAttribute("aria-current", "true"));
    expect(participants).not.toHaveAttribute("aria-current");
  });
});
```

Run: `npx vitest run frontend/test/QualityAssessmentFullScreen.review.test.tsx && wc -l frontend/test/QualityAssessmentFullScreen.review.test.tsx`
Expected: PASS for the whole suite (the `afterEach` restores both overrides), then a count ≤ 800.

- [ ] **Step 6: Mutation check (each NEW test goes red for the right reason)**

Apply each edit alone, run its command, see the FAIL, then undo it before the next.

1. `useActiveSection.ts`: `if (frame === 0) frame = requestAnimationFrame(apply);` → `frame = requestAnimationFrame(apply);`. Run `npx vitest run frontend/test/useActiveSection.test.tsx -t "once per frame"`. Expected: FAIL `expected 2 to be 1`.
2. `useActiveSection.ts`: collapse the nested hold to a single `requestAnimationFrame(() => { settling.current -= 1; });`. Run `… -t "two frames against the landing"`. Expected: FAIL `expected 's2' to be 's3'`.
3. `useActiveSection.ts`: `el.focus({ preventScroll: true });` → `el.focus();`. Run `… -t "preventScroll so focus"`. Expected: FAIL on `toHaveBeenCalledWith`.
4. `SectionNavLayout.tsx`: delete `onLanded: onActivate,`. Run `npx vitest run frontend/components/runs/SectionNavLayout.test.tsx -t "a mod\+Enter jump calls onActivate"`. Expected: FAIL (never called).
5. `ExtractionFormView.tsx:117`: delete ` onActivate={activateSection}`. Run `npx vitest run frontend/test/ExtractionFormView.test.tsx -t "marks the section it lands in active"`. Expected: FAIL on `aria-current`.
6. `QualityAssessmentFullScreen.tsx:928`: delete ` onActivate={sectionNav.activateSection}`. Run `npx vitest run frontend/test/QualityAssessmentFullScreen.review.test.tsx -t "marks the section it lands in active"`. Expected: FAIL (`waitFor` timeout on `aria-current`).

Run: `git diff --quiet -- frontend/hooks/extraction/useActiveSection.ts frontend/components/runs/SectionNavLayout.tsx frontend/components/extraction/ExtractionFormView.tsx frontend/pages/QualityAssessmentFullScreen.tsx && echo restored`
Expected: `restored` (the files match `HEAD`). If Step 2 had to restore code in `useActiveSection.ts`, that file differs from `HEAD` by design: drop it from this command and re-run Step 2's command instead. A NEW test that stays green under its mutation is vacuous: tighten its assertion, never the mutation.

- [ ] **Step 7: Full verification**

Run: `npx vitest run frontend/test/useActiveSection.test.tsx frontend/lib/runs/paneScroll.test.ts frontend/hooks/extraction/useJumpToNextPendingField.test.tsx frontend/components/runs/SectionNavLayout.test.tsx frontend/test/ExtractionFormView.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx frontend/test/SectionNavRail.test.tsx frontend/components/extraction/SectionNavRail.jumpNext.test.tsx`
Expected: PASS, 0 failed.

Run: `npm run typecheck`
Expected: exit 0. Do not use `npx tsc --noEmit -p .`: the root `tsconfig.json` has `"files": []`, so it type-checks nothing.

Run: `npx knip --no-tag-hints && npx knip --production --no-tag-hints`
Expected: zero findings, exit 0.

Run: `wc -l frontend/pages/QualityAssessmentFullScreen.tsx && python3 scripts/fitness/check_file_size.py`
Expected: `1019 frontend/pages/QualityAssessmentFullScreen.tsx`, then `file-size: OK (… none grew, no new offenders)`, exit 0. If the page grew, move the growth into `frontend/hooks/qa/useQASectionNav.ts`. Never touch the baseline.

- [ ] **Step 8: Commit**

Task 0 committed the production code, `paneScroll{,.test}.ts` and the `[ / ]` comment at `QualityAssessmentFullScreen.tsx:415`, so this commit holds only this task's hunks. Commit by path (Global Constraints). First list what changed:

Run: `git status --short`
Expected: ` M` for the 4 test files below. A production file appears only if a NEW test failed without a mutation and you changed it; add each such path to the commit's path list. No other path may appear; if one does, stop and report it.

```bash
git commit -m "test(runs): cover the position scrollspy, the landing hold and the jump activation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  frontend/test/useActiveSection.test.tsx frontend/components/runs/SectionNavLayout.test.tsx \
  frontend/test/ExtractionFormView.test.tsx frontend/test/QualityAssessmentFullScreen.review.test.tsx
git show --stat HEAD
```
Expected: one commit listing exactly these 4 test files, plus any production path you added above.

### Task 7: Dev tooling (`launch.json` with `db-migrate`, Vite `PORT`)

Spec cluster 6 (R1, R2). Task 0 committed most of this cluster with the imported WIP. Inspect it as it is in the tree now: read `.claude/launch.json` and `vite.config.ts`, or run `git log -p -1 -- .claude/launch.json vite.config.ts`.
- `.claude/launch.json` has three configurations. `frontend-attach` is gone, `autoPort` is gone from `frontend`/`backend`, and `full-stack` runs `sh -c`. That `full-stack` command still lacks `db-migrate`, and R1 requires it. This task adds it.
- `vite.config.ts:9` is `port: Number(process.env.PORT) || 8080`. R2 is already met.

This task adds 2 NEW config-assertion tests. The `launch.json` test starts red because `db-migrate` is missing. The Vite test is green on arrival, so a mutation check proves it can fail. Do not rewrite `vite.config.ts` unless its test is red (Step 5).

**Files:**
- Create: `frontend/test/devTooling.config.test.ts`
- Modify: `.claude/launch.json` (the `full-stack` `runtimeArgs` only)
- Verify only (committed in Task 0): `vite.config.ts:9`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing another task imports. The `preview_start` names are the contract for agents that start dev servers: `frontend` (port 8080), `backend` (8000), and `full-stack` (8080, `autoPort: true`, command `make supabase-start supabase-migrate db-migrate backend-start && npm run dev`).

Facts checked when this section was written (vitest 4.1.11, vite 8.2.2, Makefile on `origin/dev` `b3192e7e`, which the Task 0 merge does not change for these paths):
- Importing `vite.config.ts` from a vitest test in the default jsdom environment works: `__dirname` resolves, and the default export is the `UserConfigFnObject` passed to `defineConfig`.
- `vi.stubEnv('PORT', undefined)` deletes `process.env.PORT`, and `vi.unstubAllEnvs()` restores it.
- `vite.config.ts` type-checks under `tsconfig.app.json`, which it joins through this test's import.
- The Makefile targets exist: `supabase-migrate` (`Makefile:64`, Supabase auth/storage migrations), `backend` (`:140`), `backend-start` (`:141`), `supabase-start` (`:175`) and `db-migrate` (`:236-238`). The `db-migrate` recipe is `cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run alembic upgrade head`. Make runs the goals left to right, so the Alembic app schema is applied after the Supabase migrations and before the backend starts.

All commands run from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`.

- [ ] **Step 1: Write the two tests**

Create `frontend/test/devTooling.config.test.ts`. File paths are resolved from the test file, as in `frontend/test/copy-run-vocabulary.test.ts:13`:

```ts
/**
 * Dev tooling contract (spec R1, R2): the `preview_start` configurations in
 * .claude/launch.json and the Vite dev-server port. `full-stack` applies the
 * Alembic app schema (`db-migrate`) before the backend starts. A second
 * worktree takes another port through `PORT`; an unset or non-numeric value
 * falls back to 8080.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UserConfigFnObject } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import viteConfig from '../../vite.config';

const here = dirname(fileURLToPath(import.meta.url));

interface LaunchConfiguration {
  name: string;
  runtimeExecutable?: string;
  runtimeArgs?: string[];
  port?: number;
  autoPort?: boolean;
  url?: string;
}

function readLaunchConfigurations(): LaunchConfiguration[] {
  const raw = readFileSync(resolve(here, '../../.claude/launch.json'), 'utf-8');
  return (JSON.parse(raw) as { configurations: LaunchConfiguration[] }).configurations;
}

function devServerPort(): number | undefined {
  return (viteConfig as UserConfigFnObject)({ command: 'serve', mode: 'development' }).server?.port;
}

describe('dev tooling config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('launch.json declares frontend, backend and full-stack with the agreed ports', () => {
    // toStrictEqual: an extra key (a stray `autoPort`, a `url` attach entry) fails,
    // and so does a full-stack command that skips `db-migrate` or reorders it.
    expect(readLaunchConfigurations()).toStrictEqual([
      { name: 'frontend', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 8080 },
      { name: 'backend', runtimeExecutable: 'make', runtimeArgs: ['backend'], port: 8000 },
      {
        name: 'full-stack',
        runtimeExecutable: 'sh',
        runtimeArgs: ['-c', 'make supabase-start supabase-migrate db-migrate backend-start && npm run dev'],
        port: 8080,
        autoPort: true,
      },
    ]);
  });

  it('vite dev server honours PORT and falls back to 8080', () => {
    vi.stubEnv('PORT', '5174');
    expect(devServerPort()).toBe(5174);

    vi.stubEnv('PORT', undefined);
    expect(process.env.PORT).toBeUndefined();
    expect(devServerPort()).toBe(8080);

    vi.stubEnv('PORT', 'abc');
    expect(devServerPort()).toBe(8080);
  });
});
```

- [ ] **Step 2: Run the tests to see the launch test fail**

Run: `npx vitest run frontend/test/devTooling.config.test.ts -t "launch.json declares frontend, backend and full-stack with the agreed ports"`
Expected: FAIL. The `toStrictEqual` diff shows the `full-stack` `runtimeArgs[1]`: expected `make supabase-start supabase-migrate db-migrate backend-start && npm run dev`, received `make supabase-start supabase-migrate backend-start && npm run dev`. If it fails for any other key (`autoPort`, a fourth entry, a port), fix that key in Step 3 as well.

Run: `npx vitest run frontend/test/devTooling.config.test.ts -t "vite dev server honours PORT and falls back to 8080"`
Expected: PASS, because `vite.config.ts:9` already implements R2. If it fails, apply the Step 5 fix before Step 4.

- [ ] **Step 3: Add `db-migrate` to the full-stack command**

In `.claude/launch.json`, change only the `full-stack` `runtimeArgs` line:

```json
      "runtimeArgs": ["-c", "make supabase-start supabase-migrate db-migrate backend-start && npm run dev"],
```

The whole file must then read:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "frontend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 8080
    },
    {
      "name": "backend",
      "runtimeExecutable": "make",
      "runtimeArgs": ["backend"],
      "port": 8000
    },
    {
      "name": "full-stack",
      "runtimeExecutable": "sh",
      "runtimeArgs": ["-c", "make supabase-start supabase-migrate db-migrate backend-start && npm run dev"],
      "port": 8080,
      "autoPort": true
    }
  ]
}
```

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8'))"`
Expected: exit 0 (valid JSON).

- [ ] **Step 4: Run both tests to verify they pass**

Run: `npx vitest run frontend/test/devTooling.config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Fix Vite only if its test is red (skip if Step 2 showed it green)**

`vite.config.ts` `server` block:

```ts
  server: {
    host: "::",
    port: Number(process.env.PORT) || 8080,
  },
```

Re-run `npx vitest run frontend/test/devTooling.config.test.ts -t "vite dev server honours PORT and falls back to 8080"` until it passes.

- [ ] **Step 6: Prove the Vite test bites (mutation check)**

The Vite test was green on arrival, so show that it fails without its behaviour. The launch test already failed for the right reason in Step 2. If you skipped Step 5, `vite.config.ts` still matches `HEAD`:

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip diff --quiet -- vite.config.ts`
Expected: exit 0. If Step 5 changed the file, undo the mutation below by hand instead of using `git restore`.

Apply this temporary edit: `vite.config.ts:9` `port: Number(process.env.PORT) || 8080,` → `port: 8080,`.

Run: `npx vitest run frontend/test/devTooling.config.test.ts -t "vite dev server honours PORT and falls back to 8080"`
Expected: FAIL with `expected 8080 to be 5174`.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip restore vite.config.ts`
Run: `npx vitest run frontend/test/devTooling.config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Verify the whole task**

Run: `npm run typecheck`
Expected: exit 0. Do not use `npx tsc --noEmit -p .`: the root `tsconfig.json` has `"files": []`, so it checks nothing. `tsconfig.app.json` includes `frontend`, so it type-checks this test and, through its import, `vite.config.ts`.

Run: `npx eslint frontend/test/devTooling.config.test.ts vite.config.ts`
Expected: exit 0.

Run: `npx knip --no-tag-hints`
Expected: zero findings.

Run: `npx knip --production --no-tag-hints`
Expected: zero findings. The test lives under `frontend/test/**`, which production mode excludes.

Run: `grep -nE '^(supabase-start|supabase-migrate|db-migrate|backend-start|backend):' Makefile`
Expected: 5 matching lines, so every target `full-stack` and `backend` name exists.

Run: `grep -n -A2 '^db-migrate:' Makefile`
Expected: the recipe line contains `uv run alembic upgrade head`.

- [ ] **Step 8: Commit**

Commits are path-scoped. Stage and commit only this task's paths. Add `vite.config.ts` to both lists only if Step 5 changed it.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip add .claude/launch.json frontend/test/devTooling.config.test.ts`
Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "chore(dev): run db-migrate in the full-stack launch and pin dev tooling" -m "The full-stack preview_start entry now runs make supabase-start supabase-migrate db-migrate backend-start before npm run dev, so the Alembic app schema is current before the backend starts. devTooling.config.test.ts pins the three launch.json entries and the Vite PORT fallback to 8080." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- .claude/launch.json frontend/test/devTooling.config.test.ts`
Expected: a commit on `feat/run-nav-and-dev-server` that passes the hooks.

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --stat --format=%s HEAD`
Expected: exactly `.claude/launch.json` and `frontend/test/devTooling.config.test.ts` (plus `vite.config.ts` only if Step 5 changed it).

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip status --porcelain -- .claude/launch.json vite.config.ts frontend/test/devTooling.config.test.ts`
Expected: no output. Nothing from this task is left uncommitted.

### Task 8: Pager keys `[` / `]`

Spec cluster 7 (R30, R31, R32). Depends on Tasks 5 and 6. 1 NEW test. The key swap, the Help combo, the copy text and the J/K → `[ / ]` renames were committed by Task 0. Inspect that committed code in the tree (read the file, or `git log -p -- <file>`). Verify the existing tests, add the NEW copy test, prove it red with a temporary mutation, record the known AltGr limitation at the key definitions, and commit. Change production behaviour only where a test fails WITHOUT a mutation. Commands run from the worktree root.

Decided (spec §D): matching is by `event.key` through the existing `useKeyboardShortcuts`. There is no `event.code` matching and no matcher change. **Known limitation:** on layouts that need AltGr/Option to type `[` or `]` (German QWERTZ, Mac AZERTY) the keyboard pager does not fire, because the bare-chord matcher rejects Alt/Ctrl (`frontend/hooks/useKeyboardShortcuts.ts:85-87`). The Worklist prev/next buttons still page. Do not "fix" this in this task.

**Files:**
- Verify (committed by Task 0): `frontend/hooks/runs/useRunShortcuts.ts`, `frontend/lib/copy/runs.ts` (`shortcutNextPrev`), `frontend/components/runs/header/Worklist.tsx:81`
- Modify: `frontend/lib/runs/shortcuts.ts` (key-definition comment, Step 5), `frontend/e2e/flows/extraction-article-pager.ui.e2e.ts:151` (Step 5; its header comment was committed by Task 0)
- Verify only: `frontend/pages/QualityAssessmentFullScreen.tsx:415` (comment, line-neutral; committed by Task 0)
- Test: `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts` (created by Task 5; 1 NEW test), `frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`, `frontend/components/runs/header/__tests__/Help.test.tsx`, `frontend/components/runs/header/__tests__/Worklist.test.tsx:40`, `frontend/test/QualityAssessmentFullScreen.navigation.test.tsx`, `frontend/test/ExtractionFullScreen.articleSwitch.test.tsx`

**Budget:** `QualityAssessmentFullScreen.tsx` is 1019/1021. The net line count of this file must not grow; verify with `python3 scripts/fitness/check_file_size.py`. This task makes no edit to it.

**Interfaces:**
- Consumes: Task 5's `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts`, a top-level `describe` holding `names the rail toggle collapse and expand, not hide and show`. Task 6's commit. Task 0's commit, which carries the QA page's `[ / ]` comment.
- Produces (end state): `ARTICLE_PREV_KEY = '['` and `ARTICLE_NEXT_KEY = ']'` in `frontend/lib/runs/shortcuts.ts`. `RUN_SHORTCUTS` entry `{ id: 'nextPrev', combo: '[ / ]', copyKey: 'shortcutNextPrev' }`. Copy key `runs.shortcutNextPrev`: "Previous / next article" (unchanged key, changed text).

- [ ] **Step 1: Preflight**

Run: `git log --oneline -3 && test -f frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts && echo ready`
Expected: Task 7's commit, then Task 6's, then Task 5's (execution is serial in table order), then `ready`.

Run: `git diff HEAD --quiet -- frontend/pages/QualityAssessmentFullScreen.tsx && grep -n "(\[ / \], ⌘K, Escape)" frontend/pages/QualityAssessmentFullScreen.tsx`
Expected: `415:  // Every run-screen keyboard binding ([ / ], ⌘K, Escape) lives in the one`. If `git diff HEAD --quiet` exits 1 instead, an earlier task left uncommitted edits in the page. This task makes no edit to it, so stop and report.

- [ ] **Step 2: Verify the existing tests and renames (R30, R31, R32)**

Run: `npx vitest run frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx frontend/components/runs/header/__tests__/Help.test.tsx frontend/components/runs/header/__tests__/Worklist.test.tsx frontend/test/QualityAssessmentFullScreen.navigation.test.tsx frontend/test/ExtractionFullScreen.articleSwitch.test.tsx`
Expected: PASS, 0 failed. These include:
- `] navigates to the next article`, `[ navigates to the previous article`, `does not navigate past the ends`, `ignores [ / ] while the user is typing in a field`, `ignores [ / ] when %s is held` (Alt, Control, Meta), `ignores [ / ] while a dialog or popover is open`, `is inert with fewer than two articles`
- `opens a panel listing shortcuts and glossary`, which asserts the `[ / ]` combo
- `exposes the position via a visually-hidden polite live region, so a [ / ] move is announced`
- `] opens the next article — the binding the help panel already promised`, `] on the LAST article stays put (end-of-list guard, no wrap); [ still walks back`
- the three article-switch tests, each paging with `]`

(user-event reads `[` as a descriptor opener, so the suites type `[[` for a literal `[`. Keep that.)

Run: `rg -n "J/K|J / K" frontend`
Expected: no output, exit 1 (R32).

Run: `rg -n "shortcutNextPrev: 'Previous / next article'" frontend/lib/copy/runs.ts && rg -n "combo: \`\\$\{ARTICLE_PREV_KEY\} / \\$\{ARTICLE_NEXT_KEY\}\`" frontend/lib/runs/shortcuts.ts`
Expected: one match in each file.

- [ ] **Step 3: Write the NEW copy test (R31)**

In `frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts`, keep Task 5's content. Make sure these two imports exist, and add whichever is missing:

```ts
import { runs } from '@/lib/copy/runs';
import { RUN_SHORTCUTS } from '@/lib/runs/shortcuts';
```

Append inside the file's top-level `describe`, after Task 5's test:

```ts
  it('names the pager previous first, like the chevrons', () => {
    // The header renders ‹ before ›, so the label and the combo read previous → next.
    expect(runs.shortcutNextPrev).toBe('Previous / next article');
    expect(RUN_SHORTCUTS.find((s) => s.id === 'nextPrev')?.combo).toBe('[ / ]');
  });
```

- [ ] **Step 4: Run it, then prove it red**

Run: `npx vitest run frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts -t "names the pager previous first"`
Expected: PASS (1 passed, 1 skipped); the committed code already carries the text and the combo order. If it FAILS, set `shortcutNextPrev: 'Previous / next article',` in `frontend/lib/copy/runs.ts`, and `{ id: 'nextPrev', combo: \`${ARTICLE_PREV_KEY} / ${ARTICLE_NEXT_KEY}\`, copyKey: 'shortcutNextPrev' },` in `frontend/lib/runs/shortcuts.ts`, then re-run.

Mutations: apply each edit alone, run the same command, see the FAIL, then undo it.
1. `frontend/lib/copy/runs.ts`: `'Previous / next article'` → `'Next / previous article'`. Expected: FAIL `expected 'Next / previous article' to be 'Previous / next article'`.
2. `frontend/lib/runs/shortcuts.ts`: `` `${ARTICLE_PREV_KEY} / ${ARTICLE_NEXT_KEY}` `` → `` `${ARTICLE_NEXT_KEY} / ${ARTICLE_PREV_KEY}` ``. Expected: FAIL `expected '] / [' to be '[ / ]'`.

Run: `git diff --quiet -- frontend/lib/copy/runs.ts frontend/lib/runs/shortcuts.ts && echo restored`
Expected: `restored`.

- [ ] **Step 5: Record the AltGr limitation and drop the case fold**

In `frontend/lib/runs/shortcuts.ts`, replace the line `/** Horizontal pager keys — previous / next, matching the header chevrons. */` with:

```ts
/**
 * Horizontal pager keys — previous / next, matching the header chevrons.
 * Matched by `event.key` through `useKeyboardShortcuts`, whose bare-chord
 * matcher rejects Alt/Ctrl: where `[` or `]` needs AltGr/Option (German
 * QWERTZ, Mac AZERTY) the keys never fire, and the Worklist buttons still page.
 */
```

In `frontend/e2e/flows/extraction-article-pager.ui.e2e.ts:151`, the case fold dates from J/K, whose matching was case-insensitive. Brackets have no case, so it is dead. Replace:

```ts
  const key = (nextEnabled ? ARTICLE_NEXT_KEY : ARTICLE_PREV_KEY).toLowerCase();
```
with:
```ts
  const key = nextEnabled ? ARTICLE_NEXT_KEY : ARTICLE_PREV_KEY;
```

Run: `rg -n "KEY\)\.toLowerCase" frontend/e2e/flows/extraction-article-pager.ui.e2e.ts; rg -n "AltGr/Option" frontend/lib/runs/shortcuts.ts`
Expected: no output from the first command, one match from the second.

The e2e flow itself (`a keyboard article change does not lose a pending edit`) needs the `E2E_*` environment and a running stack. CI runs it; `npm run typecheck` (whose `tsconfig.app.json` includes `frontend/`, so `frontend/e2e`) and eslint cover this edit locally.

- [ ] **Step 6: Full verification**

Run: `npx vitest run frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx frontend/components/runs/header/__tests__/Help.test.tsx frontend/components/runs/header/__tests__/Worklist.test.tsx frontend/test/QualityAssessmentFullScreen.navigation.test.tsx frontend/test/ExtractionFullScreen.articleSwitch.test.tsx`
Expected: PASS, 0 failed.

Run: `npm run typecheck`
Expected: exit 0. Do not use `npx tsc --noEmit -p .`: the root `tsconfig.json` has `"files": []`, so it type-checks nothing.

Run: `npx eslint frontend/lib/runs/shortcuts.ts frontend/hooks/runs/useRunShortcuts.ts frontend/components/runs/header/Worklist.tsx frontend/e2e/flows/extraction-article-pager.ui.e2e.ts frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts`
Expected: exit 0, no errors.

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: `check_copy_keys.py: OK (… all baselined)`, exit 0. No key was added or removed, and `shortcutNextPrev` is still referenced by `RUN_SHORTCUTS`.

Run: `wc -l frontend/pages/QualityAssessmentFullScreen.tsx && python3 scripts/fitness/check_file_size.py`
Expected: `1019 frontend/pages/QualityAssessmentFullScreen.tsx`, then `file-size: OK (… none grew, no new offenders)`, exit 0.

Run: `npx knip --no-tag-hints && npx knip --production --no-tag-hints`
Expected: zero findings, exit 0. `ARTICLE_PREV_KEY` and `ARTICLE_NEXT_KEY` are used by `useRunShortcuts.ts` and `Worklist.tsx`.

Run: `rg -n "J/K|J / K" frontend`
Expected: no output, exit 1.

- [ ] **Step 7: Commit**

Task 0 committed the key swap, the Help combo, the copy text and the renames, so this commit holds only this task's hunks. Commit by path (Global Constraints). First list what changed:

Run: `git status --short`
Expected: ` M` for the 3 paths below. `frontend/lib/copy/runs.ts` appears only if Step 4's fallback had to set the text; add it to the commit's path list then. No other path may appear; if one does, stop and report it.

```bash
git commit -m "feat(runs): list the pager previous first and record the AltGr limitation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  frontend/lib/runs/shortcuts.ts frontend/e2e/flows/extraction-article-pager.ui.e2e.ts \
  frontend/lib/copy/__tests__/runs.shortcutCopy.test.ts
git show --stat HEAD && git status --short -- frontend/lib/runs frontend/lib/copy frontend/e2e/flows
```
Expected: one commit listing these 3 files (4 if `runs.ts` was added); `git status` prints nothing for those paths.

### Task 9: Port the QA dashboard consumer to the shared progress gate

**Files:**
- Modify: `frontend/components/quality/QualityAssessmentInterface.tsx` (#911's "Dashboard counters" block, merged in Task 0: imports, `useAuth`/`useQueryClient`, the progress read, `retryDashboard`, the dashboard render gate)
- Test: `frontend/test/QualityAssessmentInterface.test.tsx` (the `session` and `progress` hoisted state, the hook and `useAuth` mocks, `beforeEach`, the `QualityAssessmentInterface dashboard` describe)

**Interfaces:**
- Consumes (Task 4a): `useCallerArticleProgress(projectId: string | null | undefined, templateId: string | null | undefined, kind: ReviewKind = 'extraction'): CallerArticleProgress` from `@/hooks/extraction/useCallerArticleProgress`, where `CallerArticleProgress` = `{ valuesByArticle: Map<string, ArticleProgressData>; isLoading: boolean; isError: boolean; isUnavailable: boolean; refetch: () => Promise<unknown>; userId: string | null | undefined; isAuthResolving: boolean; isSignedOut: boolean }`. It spreads `useArticleExtractionValues(projectId, templateId, userId, kind)` (Task 3: `{ valuesByArticle, isLoading, isError, isUnavailable, refetch }`) and reads `useAuth()` `{ user, loading }`.
- Consumes (Task 4b): copy key `extraction.progressUnavailable` ("Progress is unavailable without a signed-in user"). From #911 (Task 0): `qa.dashboardLoadError`, the `dashboardArticles` query (`articleKeys.byProject` + `fetchProjectArticles`), and test id `qa-dashboard-skeleton`.
- Produces: nothing new. After this task no component calls `useArticleExtractionValues` directly (R37).

Run everything from the worktree root `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip`. Keep each `git` command on its own line (the worktree shell guard refuses compound lines containing `git`).

- [ ] **Step 1: Confirm the starting state**

Run: `grep -n "useArticleExtractionValues\|articleExtractionValuesKeys\|useAuth\|useQueryClient\|valuesError\|valuesLoading" frontend/components/quality/QualityAssessmentInterface.tsx`
Expected: the Task 0 bridge import from `@/lib/query-keys/extraction`, the hook import, `useAuth` and `useQueryClient` imports and calls, the destructure `isError: valuesError` (Task 3's compile port), and the uses in `retryDashboard` and the render gate.
Run: `grep -c "progressUnavailable" frontend/lib/copy/extraction.ts frontend/hooks/extraction/useCallerArticleProgress.ts`
Expected: `extraction.ts:1`, and the gate file exists (any count). If a check fails, STOP and report it: an earlier task is missing.

- [ ] **Step 2: Port the test file and write the 3 NEW tests**

In `frontend/test/QualityAssessmentInterface.test.tsx`:

Add after `import { articleKeys } from '@/lib/query-keys';`:
```tsx
import { t } from '@/lib/copy';
```

Replace the `session` hoisted line with:
```tsx
const session = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  loading: false,
}));
```

Replace the whole block from `// The per-article progress read is mocked at the hook boundary` through the closing `}));` of `vi.mock('@/hooks/extraction/useArticleExtractionValues', …)` (Task 3 left `isError: false` in it; the `articleExtractionValuesKeys` stub goes) with:
```tsx
// The per-article progress read is mocked at the hook boundary. The real shared
// gate (useCallerArticleProgress) runs on top of it, fed by the useAuth mock.
const progress = vi.hoisted(() => ({
  valuesByArticle: new Map<string, unknown>(),
  isLoading: false,
  isError: false,
  isUnavailable: false,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({ ...progress }),
}));
```

Replace the `useAuth` mock with:
```tsx
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: session.user, loading: session.loading }),
}));
```

Replace the whole `beforeEach` with:
```tsx
beforeEach(() => {
  db.rows = {};
  db.errors = {};
  session.user = { id: 'user-1' };
  session.loading = false;
  progress.valuesByArticle = new Map();
  progress.isLoading = false;
  progress.isError = false;
  progress.isUnavailable = false;
  progress.refetch = vi.fn();
});
```

Run: `grep -n "progress.isError = true;" frontend/test/QualityAssessmentInterface.test.tsx`
Expected: one line, inside `shows the error state, not zero counts, when the progress read fails` (Task 3's port). If it still reads `progress.error = new Error('permission denied');`, replace that line with `    progress.isError = true;`.

In `recovers the counts when the user retries after a failed read`, add after `    expect(screen.queryByText(LOAD_ERROR)).not.toBeInTheDocument();` (an assertion in an existing test, not a new test):
```tsx
    expect(progress.refetch).toHaveBeenCalledTimes(1);
```

In the `QualityAssessmentInterface dashboard` describe, add under `const LOAD_ERROR = …;`:
```tsx
  const UNAVAILABLE = t('extraction', 'progressUnavailable');
```

Delete #911's test `shows the skeleton, not zero counts, while there is no user` (the whole `it(…)`), and add in its place:
```tsx
  it('shows progress unavailable, not the skeleton, once auth resolves with no user', async () => {
    session.user = null;
    progress.isUnavailable = true;
    seedTwoArticlesOneStarted();
    renderInterface(DASHBOARD);

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByTestId('qa-dashboard-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('shows the skeleton while the user lookup is resolving', async () => {
    session.user = null;
    session.loading = true;
    progress.isUnavailable = true;
    seedTwoArticlesOneStarted();
    const { queryClient } = renderInterface(DASHBOARD);

    // Precondition: the article read resolved, so only auth can hold the skeleton.
    await waitFor(() =>
      expect(queryClient.getQueryState(articleKeys.byProject('p1'))?.status).toBe('success'),
    );
    // Give the resolved read time to re-render: the figures must never appear.
    await expect(screen.findByText('50%', {}, { timeout: 300 })).rejects.toThrow();
    expect(screen.getByTestId('qa-dashboard-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('does not refetch progress on retry while progress is unavailable', async () => {
    const user = userEvent.setup();
    seedTwoArticlesOneStarted();
    progress.isUnavailable = true;
    db.errors.articles = { message: 'network down' };
    renderInterface(DASHBOARD);

    await screen.findByText(LOAD_ERROR);
    delete db.errors.articles;
    await user.click(screen.getByRole('button', { name: /try again/i }));

    // Precondition: the retry ran, because the article read recovered the figures.
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(progress.refetch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the suite and read which tests fail**

Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx`
Expected: 2 FAIL, 9 pass.
- `shows progress unavailable, not the skeleton, once auth resolves with no user` fails with "Unable to find an element with the text: Progress is unavailable without a signed-in user": the unported gate `!user` shows the skeleton.
- `recovers the counts when the user retries after a failed read` fails with `expected "spy" to be called 1 times, but got 0 times`: the unported retry invalidates a key instead of calling `refetch`.
- `shows the skeleton while the user lookup is resolving` and `does not refetch progress on retry while progress is unavailable` pass before the port: the old code shows a skeleton for any missing user and never calls `refetch`. They guard the port, and Step 6 proves each one catches its own regression.

- [ ] **Step 4: Port the component**

In `frontend/components/quality/QualityAssessmentInterface.tsx`:

Before: `import { useQuery, useQueryClient } from "@tanstack/react-query";`
After: `import { useQuery } from "@tanstack/react-query";`

Delete the line `import { useAuth } from "@/contexts/AuthContext";`. The gate owns the user now.

Before:
```tsx
import { useArticleExtractionValues } from "@/hooks/extraction/useArticleExtractionValues";
import { articleExtractionValuesKeys } from "@/lib/query-keys/extraction";
```
After:
```tsx
import { useCallerArticleProgress } from "@/hooks/extraction/useCallerArticleProgress";
```

Delete the two lines `  const { user } = useAuth();` and `  const queryClient = useQueryClient();`.

Before (from `const dashboardTemplateId` through the end of `retryDashboard`):
```tsx
  const dashboardTemplateId = onDashboard ? activeTemplate?.id : undefined;
  const {
    valuesByArticle,
    isLoading: valuesLoading,
    isError: valuesError,
  } = useArticleExtractionValues(
    projectId,
    dashboardTemplateId,
    user?.id,
    "quality_assessment",
  );

  const totalArticles = dashboardArticles.data?.length ?? 0;
  // The map is keyed by every article with at least one instance of the tool.
  const assessmentsStarted = valuesByArticle.size;
  const progressPercentage =
    totalArticles > 0 ? Math.round((assessmentsStarted / totalArticles) * 100) : 0;

  const retryDashboard = () => {
    void dashboardArticles.refetch();
    void queryClient.invalidateQueries({
      queryKey: articleExtractionValuesKeys.byTemplate(
        projectId,
        dashboardTemplateId ?? "",
        user?.id ?? "",
        "quality_assessment",
      ),
    });
  };
```
After:
```tsx
  const dashboardTemplateId = onDashboard ? activeTemplate?.id : undefined;
  const progress = useCallerArticleProgress(
    projectId,
    dashboardTemplateId,
    "quality_assessment",
  );

  const totalArticles = dashboardArticles.data?.length ?? 0;
  // The map is keyed by every article with at least one instance of the tool.
  const assessmentsStarted = progress.valuesByArticle.size;
  const progressPercentage =
    totalArticles > 0 ? Math.round((assessmentsStarted / totalArticles) * 100) : 0;

  const retryDashboard = () => {
    void dashboardArticles.refetch();
    // refetch() ignores `enabled: false`: a disabled progress read (no user or
    // no active template) must stay unrequested.
    if (!progress.isUnavailable) void progress.refetch();
  };
```

Before (the dashboard gate, above `<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">`):
```tsx
          {dashboardArticles.isError || valuesError ? (
            <ErrorState message={t("qa", "dashboardLoadError")} onRetry={retryDashboard} />
          ) : !user || dashboardArticles.isPending || valuesLoading ? (
            // No user yet = the values read is disabled, not empty: zeros here
            // would read as "nothing started".
            <Skeleton data-testid="qa-dashboard-skeleton" className="h-28 w-full" />
          ) : (
```
After (R38, first match wins):
```tsx
          {progress.isAuthResolving ? (
            <Skeleton data-testid="qa-dashboard-skeleton" className="h-28 w-full" />
          ) : progress.isSignedOut ? (
            <ErrorState message={t("extraction", "progressUnavailable")} />
          ) : dashboardArticles.isError || progress.isError ? (
            <ErrorState message={t("qa", "dashboardLoadError")} onRetry={retryDashboard} />
          ) : dashboardArticles.isPending || progress.isLoading ? (
            // Pending, including a paused read: zeros would read as "nothing started".
            <Skeleton data-testid="qa-dashboard-skeleton" className="h-28 w-full" />
          ) : (
```

With no active QA template, progress is `isUnavailable` with `isLoading` false, so the figures render as on `dev` (R38, spec §2).

- [ ] **Step 5: Run the suite green**

Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx`
Expected: `Tests  11 passed (11)` (4 in `QualityAssessmentInterface`, 7 in `QualityAssessmentInterface dashboard`).

- [ ] **Step 6: Mutation-check the two guard tests (ledger B3)**

(a) Delete `if (!progress.isUnavailable) ` from `retryDashboard`, leaving `    void progress.refetch();`.
Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx -t "does not refetch progress on retry while progress is unavailable"`
Expected: FAIL, `expected "spy" to not be called at all`. Restore the guard exactly as in Step 4.

(b) Replace the first two branches of the gate, `{progress.isAuthResolving ? (` + its `<Skeleton … />` + `) : progress.isSignedOut ? (`, with `{progress.isSignedOut ? (`.
Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx -t "shows the skeleton while the user lookup is resolving"`
Expected: FAIL (the `findByText('50%')` promise resolves instead of rejecting). Restore the branch exactly as in Step 4.

Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx`
Expected: `Tests  11 passed (11)` again, so both restores are exact.

- [ ] **Step 7: Verify**

Run: `npm run typecheck; echo "TYPECHECK_EXIT=$?"`
Expected: `TYPECHECK_EXIT=0`, no diagnostics.

Run: `npx knip --no-tag-hints; echo "KNIP_EXIT=$?"`
Expected: `KNIP_EXIT=0`, zero findings.

Run: `npx knip --production --no-tag-hints; echo "KNIP_PROD_EXIT=$?"`
Expected: `KNIP_PROD_EXIT=0`, zero findings. If `CallerArticleProgress` is now an unused export, remove the `export` keyword on the type in `frontend/hooks/extraction/useCallerArticleProgress.ts` (contract: exported only if a consumer imports it), add that path to the commit, and re-run both knip modes.

Run: `grep -rn "useArticleExtractionValues(\|useAuth\|useQueryClient\|articleExtractionValuesKeys" frontend/components --include=QualityAssessmentInterface.tsx; grep -rn "useArticleExtractionValues(" frontend/components`
Expected: no output (R37 acceptance).

Run: `python3 scripts/fitness/check_file_size.py; echo "SIZE_EXIT=$?"; python3 scripts/fitness/check_copy_keys.py; echo "COPY_EXIT=$?"`
Expected: `SIZE_EXIT=0` (the component stays near 293 lines) and `COPY_EXIT=0`.

If a command fails, fix it inside this task. Never bump a baseline, never `--update-baseline`.

- [ ] **Step 8: Commit, path-scoped**

Run as ONE command:
```bash
git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip commit -m "refactor(qa): read dashboard progress through the shared caller gate" -m "The QA dashboard reads progress through useCallerArticleProgress (R38): skeleton while auth resolves, progress unavailable once it resolves with no user, the load error with retry on an article or progress failure. Retry refetches progress only while the read is enabled." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- frontend/components/quality/QualityAssessmentInterface.tsx frontend/test/QualityAssessmentInterface.test.tsx
```
(Append `frontend/hooks/extraction/useCallerArticleProgress.ts` to the pathspec only if Step 7 changed it.)

Run: `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip show --stat --format=%s HEAD`
Expected: the subject above and exactly the committed paths (2 files, or 3 with the knip fix). No other path. Report `git -C /Users/raphael/PycharmProjects/prumo/.claude/worktrees/run-nav-wip rev-parse HEAD` with the Step 5–7 results. Never push.
