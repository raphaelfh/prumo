---
status: draft
last_reviewed: 2026-07-08
owner: '@raphaelfh'
---
# Manager reopen: Consensus → Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager/consensus arbitrator send an extraction run back from `consensus` to `extract` (in place, same run), discarding the run's consensus work behind an explicit confirmation.

**Architecture:** New arbitrator-only, destructive backward transition. A dedicated service method (`reopen_to_extract`) sets `stage=extract` directly — NOT via `advance_stage`, and NOT added to `_ALLOWED_TRANSITIONS` (so the reviewer-gated `/advance` cannot pull a run backward). It hard-deletes the run's `ExtractionConsensusDecision` + `ExtractionPublishedState` rows (consensus-attached evidence cascades). A dedicated endpoint (`POST /runs/{id}/reopen-extraction`, arbitrator-gated) drives it. Frontend surfaces a consensus-stage `RunHeader` menu item + destructive `AlertDialog` whose copy adapts to the discard count.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic (no migration here), Pydantic v2, structlog; React 19 + TS strict + TanStack Query + shadcn/Radix `AlertDialog`; pytest (integration, real Postgres) + vitest + Playwright.

## Global Constraints

- **English only** for code, comments, docs, copy keys.
- **No Alembic migration** — no schema change (rows deleted at runtime).
- Responses use the `ApiResponse` envelope; errors expose `error.message`. Reuse `RunSummaryResponse` — **no new Pydantic schema** (avoid envelope drift).
- Every project-scoped endpoint checks project membership (`_load_run_and_check_member`) THEN the role gate. Arbitrator gate = `ensure_project_arbitrator` (manager/consensus), symmetric with Start-consensus/Approve-finalize.
- `reopen_to_extract` is reachable ONLY through its arbitrator-gated endpoint; do NOT add `consensus → extract` to `_ALLOWED_TRANSITIONS`.
- Discard is **dry** (no DB snapshot). Justification lives in ADR-0017; operational trace = structlog `hitl_run_reopened_to_extract` with discarded counts + actor.
- Frontend: data flows component → hook (TanStack) → `apiClient`; no `fetch`/`supabase.from` in components/services. TanStack keys from `runsKeys`; the reopen mutation invalidates the run detail/view family (stale-cache is a known incident class). All copy via `frontend/lib/copy/extraction.ts`; must pass the "Run"-noun vocabulary guard (`frontend/test/copy-run-vocabulary.test.ts`). React Compiler: no `try/finally`/`throw` in component/hook bodies.
- Tests integration-first on real Postgres; endpoints ALSO get a direct endpoint-coroutine unit test (httpx ASGITransport lines don't register for diff-cover; target diff-cover ≥ 80).
- After changing the endpoint surface, regenerate `frontend/types/api/{openapi.json,schema.d.ts}` (`npm run generate:api-types`); the `api-contract` CI job fails on drift.

---

### Task 1: Backend service — `reopen_to_extract`

**Files:**
- Modify: `backend/app/services/run_lifecycle_service.py` (add method + imports `delete`, `ExtractionConsensusDecision` already imported, `ExtractionPublishedState` already imported)
- Test: `backend/tests/integration/test_reopen_to_extract.py` (new)

**Interfaces:**
- Produces: `RunLifecycleService.reopen_to_extract(*, run_id: UUID, user_id: UUID) -> tuple[ExtractionRun, int, int]` returning `(run, discarded_consensus_count, discarded_published_count)`. Raises `InvalidStageTransitionError` (wrong stage/kind), `ValueError` (not found).
- Consumes: `load_run_for_update`, `ExtractionRunStage`, `TemplateKind`, `ExtractionConsensusDecision`, `ExtractionPublishedState` (all already imported in the module).

- [ ] **Step 1: Write the failing test** — happy path + preservation + guards.

**Fixtures (verified real):** `db_session` (SAVEPOINT auto-rollback — NOT `db_session_real`; the cascade is a plain immediate `ON DELETE CASCADE`, no deferred trigger, so no teardown burden and no LIMIT-1 poisoning), `db_client` (bound to `db_session`), `auth_as_profile` (default caller = `SEED.primary_profile` = manager). Seed ids are the module constant `from tests.integration.conftest import SEED` — fields `primary_profile` (manager of `primary_project`), `reviewer_profile`, `outsider_profile`, `primary_project`. There is **no** `seed` fixture and no `manager_id`/`reviewer_id`. Build the consensus run with the existing endpoint-driven builders (they bind to `db_session`): `_setup_consensus_run(db_client, db_session) -> (run_id, instance_id, field_id, decision_id)` reaches an unresolved consensus stage; POST `/consensus` `select_existing` resolves one coord (→ 1 `ConsensusDecision` + 1 `PublishedState v1`), mirroring `test_create_consensus_select_existing_returns_201`. `_setup_review_run` lands a run pre-consensus (wrong-stage test).

```python
# backend/tests/integration/test_reopen_to_extract.py
from tests.integration.conftest import SEED
from tests.integration.test_extraction_runs_endpoints import (
    API_PREFIX, _setup_consensus_run, _setup_review_run,
)

async def _resolve_one(db_client, run_id, instance_id, field_id, decision_id):
    r = await db_client.post(f"{API_PREFIX}/{run_id}/consensus", json={
        "instance_id": str(instance_id), "field_id": str(field_id),
        "mode": "select_existing", "selected_decision_id": str(decision_id)})
    assert r.status_code == 201, r.text

async def test_reopen_to_extract_clears_consensus_preserves_reviewer_work(db_client, db_session, auth_as_profile):
    run_id, instance_id, field_id, decision_id = await _setup_consensus_run(db_client, db_session)
    await _resolve_one(db_client, run_id, instance_id, field_id, decision_id)
    reopened, dc, dp = await RunLifecycleService(db_session).reopen_to_extract(
        run_id=run_id, user_id=SEED.primary_profile)
    assert reopened.stage == ExtractionRunStage.EXTRACT.value
    assert (dc, dp) == (1, 1)
    for model in (ExtractionConsensusDecision, ExtractionPublishedState):
        assert (await db_session.execute(select(func.count()).select_from(model).where(
            model.run_id == run_id))).scalar_one() == 0
    assert (await db_session.execute(select(func.count()).select_from(ExtractionReviewerDecision).where(
        ExtractionReviewerDecision.run_id == run_id))).scalar_one() >= 1  # reviewer work preserved

async def test_reopen_to_extract_no_resolution_is_noop_delete(db_client, db_session, auth_as_profile):
    run_id, *_ = await _setup_consensus_run(db_client, db_session)  # consensus, unresolved
    reopened, dc, dp = await RunLifecycleService(db_session).reopen_to_extract(
        run_id=run_id, user_id=SEED.primary_profile)
    assert reopened.stage == ExtractionRunStage.EXTRACT.value and (dc, dp) == (0, 0)

async def test_reopen_to_extract_from_extract_stage_rejected(db_client, db_session, auth_as_profile):
    run_id, *_ = await _setup_review_run(db_client, db_session)  # pre-consensus
    with pytest.raises(InvalidStageTransitionError):
        await RunLifecycleService(db_session).reopen_to_extract(run_id=run_id, user_id=SEED.primary_profile)

async def test_reopen_to_extract_missing_run_raises_valueerror(db_session):
    with pytest.raises(ValueError):
        await RunLifecycleService(db_session).reopen_to_extract(run_id=uuid4(), user_id=SEED.primary_profile)

async def test_reopen_to_extract_cascades_consensus_evidence(db_client, db_session, auth_as_profile):
    run_id, instance_id, field_id, decision_id = await _setup_consensus_run(db_client, db_session)
    await _resolve_one(db_client, run_id, instance_id, field_id, decision_id)
    consensus_id = (await db_session.execute(select(ExtractionConsensusDecision.id).where(
        ExtractionConsensusDecision.run_id == run_id))).scalar_one()
    # One evidence row on the consensus decision (must cascade) + one on the reviewer
    # decision (must survive). Fill non-null cols per the ExtractionEvidence model at impl time.
    await _insert_evidence(db_session, run_id, consensus_decision_id=consensus_id)
    await _insert_evidence(db_session, run_id, reviewer_decision_id=decision_id)
    await db_session.flush()
    await RunLifecycleService(db_session).reopen_to_extract(run_id=run_id, user_id=SEED.primary_profile)
    assert (await db_session.execute(select(func.count()).select_from(ExtractionEvidence).where(
        ExtractionEvidence.consensus_decision_id == consensus_id))).scalar_one() == 0   # cascaded
    assert (await db_session.execute(select(func.count()).select_from(ExtractionEvidence).where(
        ExtractionEvidence.reviewer_decision_id == decision_id))).scalar_one() == 1     # preserved
```

The QA-kind guard is exercised at the endpoint layer (Task 2) with a manager caller — the arbitrator gate runs before the service kind-check, so a non-arbitrator would 403 before reaching the 400.

- [ ] **Step 2: Run to verify it fails** — `cd backend && uv run pytest tests/integration/test_reopen_to_extract.py -x` → FAIL (`AttributeError: reopen_to_extract`).

- [ ] **Step 3: Implement the method** (after `approve_and_finalize`, near the existing `reopen_run`):

```python
async def reopen_to_extract(
    self, *, run_id: UUID, user_id: UUID
) -> tuple[ExtractionRun, int, int]:
    """Return a CONSENSUS extraction run to EXTRACT, discarding consensus work.

    Arbitrator-only escape hatch for "opened consensus too early". Deletes the
    run's ConsensusDecision + PublishedState rows (consensus-attached evidence
    cascades, 0044) so the slate is clean on both the frontend ('resolved' is
    derived from consensus_decisions) and the backend (approve-all / finalize
    gate key off PublishedState). Reviewer decisions/states/proposals and
    reviewers_ready are preserved. Sets stage directly (NOT advance_stage) so
    the forward-only transition map and the reviewer-gated /advance stay intact.
    Extraction-only. Returns (run, discarded_consensus, discarded_published).
    """
    run = await load_run_for_update(self.db, run_id)
    if run is None:
        raise ValueError(f"Run {run_id} not found")
    if run.kind != TemplateKind.EXTRACTION.value:
        raise InvalidStageTransitionError(
            "reopen_to_extract applies to extraction runs only."
        )
    if run.stage != ExtractionRunStage.CONSENSUS.value:
        raise InvalidStageTransitionError(
            f"reopen_to_extract requires stage 'consensus', got '{run.stage}'."
        )
    # ConsensusDecision first: its evidence cascades (FK ON DELETE CASCADE, 0044).
    # rowcount gives the discarded counts with NO extra SELECT (YAGNI panel); the
    # shared FOR UPDATE lock makes them exact.
    consensus_res = await self.db.execute(
        delete(ExtractionConsensusDecision).where(ExtractionConsensusDecision.run_id == run_id)
    )
    published_res = await self.db.execute(
        delete(ExtractionPublishedState).where(ExtractionPublishedState.run_id == run_id)
    )
    discarded_consensus = consensus_res.rowcount or 0
    discarded_published = published_res.rowcount or 0
    run.stage = ExtractionRunStage.EXTRACT.value  # status untouched (mirrors advance_stage)
    await self.db.flush()
    await self.db.refresh(run)
    return run, discarded_consensus, discarded_published
```

Add `delete` to the top `from sqlalchemy import ...` line.

- [ ] **Step 4: Run to verify pass** — `uv run pytest tests/integration/test_reopen_to_extract.py -v` → all PASS.

- [ ] **Step 5: Commit** — `feat(extraction): reopen_to_extract service (consensus→extract, discard consensus work)`.

---

### Task 2: Backend endpoint — `POST /runs/{id}/reopen-extraction`

**Files:**
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (new route, after `/reopen`)
- Test: `backend/tests/integration/test_extraction_runs_endpoints.py` (endpoint + auth), `backend/tests/unit/test_run_write_endpoints_unit.py` (direct coroutine — ASGI blind spot)

**Interfaces:**
- Consumes: `RunLifecycleService.reopen_to_extract`, `_load_run_and_check_member`, `ensure_project_arbitrator`, `scrub_results_ranby`, `RunSummaryResponse`.
- Produces: `POST /api/v1/runs/{run_id}/reopen-extraction` → `ApiResponse[RunSummaryResponse]`.

- [ ] **Step 1: Write failing integration tests.**

Use `db_client` + `db_session` + `_auth_as(profile_id)` (the real role-switch), mirroring `test_create_consensus_rejects_non_arbitrator_reviewer` (`test_extraction_runs_endpoints.py:811`) and `test_create_consensus_rejects_viewer_member` (`:838`). Default `auth_as_profile` = manager (arbitrator). No seeded viewer exists — insert one at runtime.

```python
# test_extraction_runs_endpoints.py
async def test_reopen_extraction_manager_ok(db_client, db_session, auth_as_profile):
    run_id, i, f, d = await _setup_consensus_run(db_client, db_session)
    r = await db_client.post(f"{API_PREFIX}/{run_id}/reopen-extraction")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["stage"] == "extract"

async def test_reopen_extraction_reviewer_forbidden(db_client, db_session, auth_as_profile):
    run_id, *_ = await _setup_consensus_run(db_client, db_session)
    _auth_as(SEED.reviewer_profile)
    assert (await db_client.post(f"{API_PREFIX}/{run_id}/reopen-extraction")).status_code == 403

async def test_reopen_extraction_viewer_forbidden(db_client, db_session, auth_as_profile):
    run_id, *_ = await _setup_consensus_run(db_client, db_session)
    await db_session.execute(text(
        "INSERT INTO public.project_members (project_id, user_id, role) VALUES (:p,:u,'viewer')"),
        {"p": str(SEED.primary_project), "u": str(SEED.outsider_profile)})
    await db_session.flush()
    _auth_as(SEED.outsider_profile)
    assert (await db_client.post(f"{API_PREFIX}/{run_id}/reopen-extraction")).status_code == 403

async def test_reopen_extraction_wrong_stage_400(db_client, db_session, auth_as_profile):
    run_id, *_ = await _setup_review_run(db_client, db_session)  # pre-consensus, manager caller
    assert (await db_client.post(f"{API_PREFIX}/{run_id}/reopen-extraction")).status_code == 400

# QA-kind guard: build a QA run in consensus (see test_qa_publish_flow.py helpers);
# manager caller reaches the service kind-check → 400.
async def test_reopen_extraction_qa_kind_400(db_client, db_session, auth_as_profile): ...
```

- [ ] **Step 2: Run to verify fail** — `uv run pytest tests/integration/test_extraction_runs_endpoints.py -k reopen_extraction` → 404 (route missing).

- [ ] **Step 3: Implement the endpoint.**

```python
@router.post("/{run_id}/reopen-extraction")
async def reopen_run_to_extract(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunSummaryResponse]:
    """Return a consensus-stage extraction run to extract, discarding consensus work.

    Arbitrator-only (manager/consensus): this hard-deletes the run's consensus
    decisions + published values. Gate lives at the API layer because the
    service-role session bypasses RLS. See ADR-0017.
    """
    member_run = await _load_run_and_check_member(db, run_id, current_user_sub)
    await ensure_project_arbitrator(db, member_run.project_id, current_user_sub)
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        run, discarded_consensus, discarded_published = await service.reopen_to_extract(
            run_id=run_id, user_id=current_user_sub
        )
    except InvalidStageTransitionError as e:
        logger.warning("hitl_reopen_to_extract_rejected", trace_id=trace_id,
                       run_id=str(run_id), error=str(e))
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    # Self-contained forensic line (panel §IX/security): the sole DB-external
    # record of a destructive discard — include project + article for SRE scoping.
    logger.info("hitl_run_reopened_to_extract", trace_id=trace_id, run_id=str(run.id),
                project_id=str(run.project_id), article_id=str(run.article_id),
                discarded_consensus_count=discarded_consensus,
                discarded_published_count=discarded_published, by=str(current_user_sub))
    summary = RunSummaryResponse.model_validate(run)
    summary = summary.model_copy(update={"results": scrub_results_ranby(summary.results)})
    return ApiResponse.success(summary, trace_id=trace_id)
```

- [ ] **Step 4: Add the direct coroutine unit test** (ASGI blind spot) in `test_run_write_endpoints_unit.py`, mirroring `test_reopen_run_awaits_reviewer_role_gate` (`:201`) but adapted: patch `{_EP}.ensure_project_arbitrator` (NOT `ensure_project_reviewer`); `service.reopen_to_extract = AsyncMock(return_value=(run_ns, 1, 1))` where `run_ns` is a full `SimpleNamespace` with every `RunSummaryResponse` field incl. a real `results` dict (so `scrub_results_ranby` works); the handler signature has **no** `response` param; assert both `gate.assert_awaited_once_with(db, project_id, caller)` and `service.reopen_to_extract.assert_awaited_once_with(run_id=run_id, user_id=caller)`.

- [ ] **Step 5: Run both** — integration `-k reopen_extraction` + `uv run pytest tests/unit/test_run_write_endpoints_unit.py -k reopen` → PASS.

- [ ] **Step 6: Commit** — `feat(extraction): POST /runs/{id}/reopen-extraction (arbitrator-gated)`.

---

### Task 3: Regenerate API types

**Files:** Modify `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`.

- [ ] **Step 1:** `npm run generate:api-types` (backend importable; from repo root).
- [ ] **Step 2:** `git diff --stat frontend/types/api` shows the new path `/api/v1/runs/{run_id}/reopen-extraction`.
- [ ] **Step 3: Commit** — `chore(api-types): regenerate for reopen-extraction endpoint`.

---

### Task 4: Frontend — copy keys + `useReopenExtraction` hook

**Files:**
- Modify: `frontend/lib/copy/extraction.ts` (new keys)
- Create: `frontend/hooks/runs/useReopenExtraction.ts`
- Test: `frontend/test/hooks/useReopenExtraction.test.tsx`

**Interfaces:**
- Produces: `useReopenExtraction() -> UseMutationResult<RunSummaryResponse, Error, string>` (arg = runId). `onSuccess` invalidates `runsKeys.detail(runId)` and the run-view key family used by the consensus panel (confirm the exact key in `frontend/hooks/runs/types.ts` — invalidate whatever backs `runDetail` incl. `consensus_decisions`/`stage`).
- Copy keys — 7 total (YAGNI panel cut 2): `runHeaderReopenExtraction` ("Reopen extraction", menu label), `reopenExtractionTitle`, `reopenExtractionBodyDiscard` (takes count), `reopenExtractionBodyClean`, `reopenExtractionConfirmDiscard` ("Reopen & discard"), `reopenExtractionConfirmClean` ("Reopen"), `reopenExtractionToast` (success). **Do NOT add** a `…Cancel` key (reuse existing `t('common','cancel')`, as `DeleteFieldConfirm` does) or a `…Tooltip` key (menu items have no tooltip slot).

- [ ] **Step 1: Failing hook test** — mock `apiClient`; assert POST to `/api/v1/runs/<id>/reopen-extraction` and that success invalidates `runsKeys.detail(<id>)`. (Mirror an existing hook test under `frontend/test/hooks/`.)
- [ ] **Step 2: Run** `npm run test:run -- useReopenExtraction` → FAIL.
- [ ] **Step 3: Implement** (mirror `useReopenRun.ts`):

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api";
import { runsKeys, type RunSummaryResponse } from "./types";

export function useReopenExtraction() {
  const queryClient = useQueryClient();
  return useMutation<RunSummaryResponse, Error, string>({
    mutationFn: (runId) =>
      apiClient<RunSummaryResponse>(`/api/v1/runs/${runId}/reopen-extraction`, { method: "POST" }),
    onSuccess: (_run, runId) => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
  });
}
```

- [ ] **Step 4: Add copy keys** to `frontend/lib/copy/extraction.ts` (English; no "Run" noun).
- [ ] **Step 5: Run** hook test + `npm run test:run -- copy-run-vocabulary` → PASS.
- [ ] **Step 6: Commit** — `feat(runs): useReopenExtraction hook + copy`.

---

### Task 5: Frontend — `ReopenExtractionDialog` (destructive, adaptive copy)

**Files:**
- Create: `frontend/components/extraction/dialogs/ReopenExtractionDialog.tsx` (sibling to `DeleteFieldConfirm.tsx` — the established destructive-confirm precedent; the shared `RunHeader` owns no dialogs, so this renders at the page level)
- Test: `frontend/test/ReopenExtractionDialog.test.tsx`

**Interfaces:**
- Produces: `ReopenExtractionDialog({ open, onOpenChange, resolvedCount, onConfirm, pending })`. shadcn `AlertDialog`, modelled on `DeleteFieldConfirm` (~40–60 lines). `resolvedCount > 0`: destructive body (`reopenExtractionBodyDiscard`, names the count + "can't be undone") + confirm `reopenExtractionConfirmDiscard`. `resolvedCount === 0`: soft body (`reopenExtractionBodyClean`) + confirm `reopenExtractionConfirmClean`. Cancel = `t('common','cancel')`. Confirm calls `onConfirm`; disabled while `pending`.

- [ ] **Step 1: Failing component test** — render with `resolvedCount=2` → discard copy + "Reopen & discard" present; `resolvedCount=0` → soft copy; clicking confirm fires `onConfirm`, cancel does not.
- [ ] **Step 2: Run** `npm run test:run -- ReopenExtractionDialog` → FAIL.
- [ ] **Step 3: Implement** the component (AlertDialog; copy via `t('extraction', ...)`; no `try/finally`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(runs): ReopenExtractionDialog with adaptive discard copy`.

---

### Task 6: Frontend — wire into header + page

**Files:**
- Modify: `frontend/components/extraction/ExtractionHeader.tsx` (new optional props `canReopenExtraction`, `onReopenExtraction`, `reopeningExtraction`; add a consensus-stage Menu item mirroring the `canReopen` item at ~L234/L324, arbitrator + `stage==='consensus'` gated)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (instantiate `useReopenExtraction` + `ReopenExtractionDialog`; derive `resolvedCount` from `runDetail.consensus_decisions` via `deriveConsensusResolution`; pass `canReopenExtraction = canResolveConflicts && stage==='consensus'`)
- Test: `ExtractionHeader`-level test (menu shows item only when `canReopenExtraction`); PLUS a derivation test for the `canResolveConflicts && stage==='consensus'` gate (the panel flagged this lives in the page and is otherwise untested — a wrong derivation passes every prop-level test). Assert hidden when `stage !== 'consensus'` and when `!canResolveConflicts`.

- [ ] **Step 1: Failing header test** — with `canReopenExtraction` true → menu contains "Reopen extraction"; false → absent. Plus the derivation test above.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the Menu item + prop plumbing; open the dialog on select; wire confirm → `mutate(runId)` → on success toast + (cache invalidation handles the re-render to extract).
- [ ] **Step 4: Run** header + page tests → PASS. `npm run test:run` (touched files) green.
- [ ] **Step 5: Commit** — `feat(extraction): reopen-extraction menu affordance in consensus header`.

---

### Task 7: Docs — ADR-0017 + architecture back-edge

**Files:**
- Create: `docs/adr/0017-reopen-consensus-to-extract.md`
- Modify: `docs/reference/extraction-hitl-architecture.md` (lifecycle §2 gains the arbitrator-only, destructive `consensus → extract` back-edge; bump `last_reviewed`)

- [ ] **Step 1:** Write ADR-0017 (Context: forward-only dead-end; Decision: in-place backward + dry delete of intermediate consensus state; Consequences: §IX reconciliation, evidence cascade, structlog trace). Confirm `0017` is free.
- [ ] **Step 2:** Add the back-edge to the architecture doc lifecycle diagram/prose + note it does NOT weaken `_ALLOWED_TRANSITIONS` (endpoint-only).
- [ ] **Step 3: Commit** — `docs(adr): ADR-0017 reopen consensus→extract + architecture back-edge`.

---

### Task 8: E2E flow (Playwright)

**Files:** Create `frontend/e2e/flows/extraction-reopen-to-extract.ui.e2e.ts` (mirror `extraction-reopen.ui.e2e.ts`).

- [ ] **Step 1:** Build a run to consensus (fixtures/`hitl.ts`), resolve one divergence, open the header menu → "Reopen extraction" → confirm.
- [ ] **Step 2:** Assert the run is back in extract (editable form; AI action re-enabled) and consensus is cleared.
- [ ] **Step 3:** Run `npm run test:e2e:local -- extraction-reopen-to-extract` → PASS.
- [ ] **Step 4: Commit** — `test(e2e): reopen consensus→extract flow`.

---

## Self-Review

- **Spec coverage:** service (Task 1), endpoint+auth (Task 2), api-types (Task 3), hook+copy (Task 4), dialog (Task 5), header/page wiring (Task 6), ADR+architecture (Task 7), E2E (Task 8). Risk register lives in **spec §7**; mapping: #1 audit (ADR-0017 + self-contained structlog line), #2 stale cache (hook invalidation, Task 4/6), #3/#4 FK cascade (Task 1 `test_..._cascades_consensus_evidence`, real DB), #5 TOCTOU (`load_run_for_update`), #6 reviewers-not-notified (deliberate V1 non-behavior — no test), #7 status untouched (Task 1). Panel-verified: §IX append-only clause names only `ReviewerDecision` (preserved), so the dry delete is defensible; no code path assumes consensus rows are undeletable (finalize gate recomputes; exports read only finalized `PublishedState`).
- **No new schema/migration** — reused `RunSummaryResponse`; discarded counts to log only.
- **Type consistency:** `reopen_to_extract` returns `(run, int, int)` in Task 1 and is destructured identically in Task 2; hook name `useReopenExtraction` and endpoint path identical across Tasks 2/4.
