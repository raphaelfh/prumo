---
status: draft
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

# HITL Phase 2 — Consensus + finalize rework, per-reviewer ready, auto-reveal (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extraction HITL consensus → finalize flow a single, always-satisfiable action; add a per-reviewer "ready" signal that does not auto-advance; and auto-reveal a blind manager on entering consensus — without regressing Quality-Assessment.

**Architecture:** The finalize dead-end (ADR-0009 / spec I2) is fixed by *coupling publish to finalize*: a new atomic backend `approve_and_finalize` publishes a consensus value for every agreed-but-unpublished coordinate, then advances `consensus → finalized` in one transaction — so `EmptyFinalizeError` (≥1 `ConsensusDecision`) and `IncompleteFinalizeError` (every required coord resolved) are satisfied *naturally* and the gates stay as invariants. A per-reviewer "ready" flag lands in a dedicated `(run_id, reviewer_id)` table (the existing `extraction_reviewer_states` is per-coordinate, the wrong grain). Auto-reveal is a *run-scoped* read-path change: a manager (arbitrator) is unblinded once the run reaches `consensus`, mirroring the existing `finalized` auto-unblind — no persistent project-toggle mutation. The header primary action becomes phase-aware via `buildExtractionTransition`: **Mark ready** (reviewer, extract) / **Open consensus** (manager, extract) / **Approve & finalize** (manager, consensus).

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2.0 async / Alembic / pytest (backend); TypeScript / React 19 / Vitest (frontend). Source-of-truth spec: `docs/superpowers/specs/2026-06-21-hitl-lifecycle-alignment-design.md` (§4.2, §4.3, §6, §7, §8, §9). Supersedes ADR-0009 (finalize gate). Phase 1 (stage collapse) shipped via ADR-0014 / PR #369.

## Global Constraints

- **English only** for code, comments, commits, docs, and copy keys.
- **SQLAlchemy model change ⇒ Alembic migration.** From `backend/`:
  `alembic revision --autogenerate -m "..."` then rewrite by hand (project rule:
  hand-written migrations). Revision id **≤ 32 chars** (`alembic_version.version_num`
  is varchar(32)). New head chains `down_revision = "0028_run_stage_extract"`.
- Migration touches `extraction_*` ⇒ bump the **migration-head line** (`§3`) **and**
  `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.
- **Layering** (CI-enforced `scripts/fitness/check_layered_arch.py`): `api → services →
  repositories → models`. Endpoints never touch the DB and never return ORM objects;
  services never import api / return HTTP objects. New endpoints get a **typed Pydantic
  response model** — never `ApiResponse[dict[str, Any]]`.
- **BOLA**: every run route gates membership via `_load_run_and_check_member`
  (`ensure_project_member`, membership — NOT `require_project_manager`).
- **RLS**: every new table enables RLS + explicit policies in the *same* migration,
  using `is_project_member` / `is_project_reviewer` / `is_project_arbitrator`
  (`SECURITY DEFINER` helpers). Mirror `0025_reviewer_scoped_select_rls.py`.
- **Frontend data access**: backend calls go through `frontend/integrations/api/client.ts`
  (`apiClient`). No new `supabase.from(...)`. All user-facing strings via
  `frontend/lib/copy/`. TanStack keys come from `runsKeys`
  (`frontend/hooks/runs/types.ts`); mutations invalidate the owning family.
- **API contract types** are generated: after any backend schema/endpoint change run
  `npm run generate:api-types` and commit `frontend/types/api/{openapi.json,schema.d.ts}`
  (CI `api-contract` job).
- **React Compiler** `panicThreshold:'all_errors'`: no `try/finally` or `throw`-in-`try`
  in component/hook bodies. Use the `.then(()=>true).catch(()=>false)` idiom; IO that can
  throw lives in a `frontend/services/` function returning `ErrorResult<T>`.
- Backend tests `make test-backend` (real local Supabase Postgres; **never run two at
  once** — advisory-lock hang). Frontend `npm run test:run`, `npm run typecheck`,
  `npm run lint` from the **repo root**. Full gate before PR: `make quality-scan`.
- Commit per task (conventional commits). End commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. PR targets `dev`,
  squash-merged.

---

## Design decisions (resolving the spec's deferred open items)

These were left open in the spec §6/§8/§10 and are decided here. Confirm during plan
review.

- **D1 — Ready-flag storage: a dedicated table `extraction_reviewer_ready (run_id,
  reviewer_id)`.** NOT a column on `extraction_reviewer_states`: that table's grain is
  per-coordinate `(run_id, reviewer_id, instance_id, field_id)`, so a boolean there is
  "ready for this one field," and a reviewer with no decision row for a coord has nowhere
  to store readiness. A dedicated `(run_id, reviewer_id)` row gives O(1) reads, a clean
  `COUNT(*) … WHERE is_ready` for the hint, a `marked_ready_at` audit, and cascade on run
  delete. (Spec §6.)
- **D2 — Ready is advisory; it does NOT gate `extract → consensus`.** Per project memory
  the HITL config is inert (no quorum gate, one user can finalize alone) and the brief
  says *do not build consensus gating on reviewer counts*. "Mark ready" only sets the
  flag. "Open consensus" is a separate, manual manager action. The "N/M ready" hint is
  informational. (Spec §4.2, brief "Critical context".)
- **D3 — "N/M ready" hint.** `N = COUNT(is_ready)`; `M = max(reviewer_count, ready_count)`
  where `reviewer_count = run.hitl_config_snapshot["reviewer_count"]` (frozen, default 1).
  The `max(...)` guarantees `N ≤ M` even when more reviewers mark ready than the (inert,
  often default-1) configured count — so the hint never reads "3 of 2". This formula is
  computed in **exactly one place** (`ExtractionReviewerReadyService.ready_summary_from`,
  Task 2) and reused by both the `/ready` endpoint and `build_run_view` — no duplicated
  `max()`. Surfaced on the run-view as `ready_count` + `reviewer_count` + `reviewers_ready`
  (ids). The manager (an arbitrator) does not get a "Mark ready" button (their primary
  action is "Open consensus"); the hint is advisory only.
- **D4 — "Approve & finalize" is an atomic backend endpoint**
  `POST /runs/{id}/approve-finalize` → `RunLifecycleService.approve_and_finalize`, which
  (a) publishes, via the existing per-coord `ExtractionConsensusService.record_consensus`,
  a consensus value for every *existing-instance × snapshot-field* coord that has a single
  unambiguous resolved reviewer value and no `PublishedState` yet, then (b) calls
  `advance_stage(FINALIZED)` — all in one transaction / one commit. This makes both
  finalize gates satisfiable *structurally* (publish happens before the gate check, same
  tx). Chosen over a client-side loop (QA's pattern) because it is atomic (no half-published
  run on mid-loop failure) and produces no duplicate `ConsensusDecision` rows on retry.
  Reuses `record_consensus` per the brief. (Spec §4.3, §7; brief deliverable 2/3.)
- **D5 — Auto-reveal is a run-scoped read-path reveal for arbitrators, not a toggle
  flip.** Extend the blind predicate in
  `extraction_run_read_service.get_run_with_workflow_history` from
  `can_see_peers or stage == FINALIZED` to also reveal when
  `stage == CONSENSUS and caller_is_arbitrator`. This mirrors the shipped `FINALIZED`
  precedent, is scoped to *this run*, needs no persisted state, keeps plain reviewers
  blind to peers even in consensus, and is consistent with RLS 0025 (arbitrators may
  already SELECT peer rows). A new `peers_revealed: bool` on the run-view payload makes the
  frontend show the compare/evaluate-all surface for the now-revealed manager *without*
  re-deriving visibility. `peers_revealed` lives on **`RunDetailResponse`** (not just
  `RunViewResponse`) and is set inside `get_run_with_workflow_history` from the same
  `unblinded` local that drives the data filter — so it can never drift from the actual
  filtering (the single-blind-filter invariant). `build_run_view` copies it; `get_run`
  carries it for free. The persistent project toggle (manual "Reveal reviewers" during
  extract) is unchanged, but the manual reveal affordance is hidden once the run is in
  `consensus` / `peers_revealed` is true (Task 7). (Spec §4.2, §10; brief deliverable 4.)
- **D6 — Header primary action (one source of truth, `buildExtractionTransition`),
  resolving I6:** extract + reviewer → **Mark ready** (sets ready flag, no advance,
  gated on the reviewer's own completeness; reflects "Marked ready" state when the caller
  is in `reviewers_ready`); extract + manager/consensus → **Open consensus** (advances
  `extract→consensus`, `gate:{ok:true}` — the manager decides timing via the N/M hint);
  consensus + manager/consensus → **Approve & finalize**, gated
  `gate.ok = isComplete && allDivergencesResolved` (spec §4.3 "enabled only when every
  diverging field is resolved and all required fields are filled"). This is **not** a
  dead-end for the case I2 cares about: a *complete, no-divergence* run has
  `isComplete=true` and `allDivergencesResolved=true` (no divergences) → enabled → approve
  publishes the agreed coords → finalize. A genuinely incomplete run is correctly disabled
  (must reopen to fill required fields — ADR-0009's intent). The legacy header
  `handleFinalize` path is unwired. (Spec §4.3, §5, §8.)
- **D9 — Role/kind guards:** the `/ready` endpoint adds a reviewer-role gate (a read-only
  *viewer* cannot mark ready — RLS is bypassed by the service-role connection, so the gate
  must live at the API layer); `approve_and_finalize` guards `run.kind == extraction`
  (QA keeps its own publish-then-advance path and is never routed through it).
- **D7 — Legacy finalize (`instance.status`):** Phase 2 stops writing it. The page-local
  `handleFinalize` in `ExtractionFullScreen.tsx` becomes unreachable; an unreferenced
  local function fails eslint/react-compiler, so this plan **deletes the page-local
  `handleFinalize` and its `markInstancesCompleted` import** (a minimal, justified fold-in
  of Phase-3 cleanup limited to the page). The service function `markInstancesCompleted`
  in `extractionInstanceService.ts` (and any test) **stays** for Phase 3 full deletion.
  (Brief "Explicitly OUT of scope".)
- **D8 — QA is untouched.** `ConsensusPanel`'s evaluate-all rendering is gated by a new
  optional `evaluateAllCoords` prop supplied only by extraction; QA passes nothing and
  keeps divergent-only rendering + its `handlePublish` publish-then-advance and its panel
  finalize button. (Spec §8, §10; brief deliverable 2.)

---

## File map (what changes)

**Backend — new:**
- `backend/app/models/extraction_workflow.py` — add `ExtractionReviewerReady` model.
- `backend/app/repositories/extraction_reviewer_ready_repository.py` — upsert + reads.
- `backend/app/services/extraction_reviewer_ready_service.py` — `mark_ready` + `ready_summary`.
- `backend/alembic/versions/0029_reviewer_ready_flag.py` — table + RLS.

**Backend — modified:**
- `backend/app/services/run_lifecycle_service.py` — `approve_and_finalize` + coord-value resolver.
- `backend/app/services/extraction_run_read_service.py` — consensus auto-reveal in the blind
  filter; `peers_revealed` + ready summary in `build_run_view`; thread `caller_is_arbitrator`.
- `backend/app/api/v1/endpoints/extraction_runs.py` — `POST /{id}/ready`,
  `POST /{id}/approve-finalize`; pass arbitrator flag into `build_run_view`/`get_run_*`.
- `backend/app/api/v1/endpoints/hitl_sessions.py` — pass arbitrator flag into `build_run_view`.
- `backend/app/schemas/extraction_run.py` — `MarkReadyRequest`, `RunReadyStateResponse`,
  `ApproveFinalizeResponse`; add `peers_revealed` to **`RunDetailResponse`** (so `get_run`
  + `/view` both carry it) and `ready_count`/`reviewer_count`/`reviewers_ready` to
  `RunViewResponse`.
- `backend/app/models/__init__.py` — export `ExtractionReviewerReady`.
- (No UnitOfWork registration: extraction-workflow repos are instantiated directly in their
  services — e.g. `extraction_consensus_service.py` — so the new repo follows that pattern.)

**Frontend — modified:**
- `frontend/types/api/{openapi.json,schema.d.ts}` — regenerated.
- `frontend/hooks/runs/types.ts` — **hand-mirrored** (not generated); `useRun` is typed by
  it, so the new fields MUST be hand-added: `peers_revealed: boolean` on `RunDetailResponse`,
  `ready_count: number` / `reviewer_count: number` / `reviewers_ready: string[]` on
  `RunViewResponse`. Regenerating `schema.d.ts` does NOT change the `useRun` shape.
- `frontend/hooks/runs/useMarkReady.ts` (new) — POST `/ready`.
- `frontend/hooks/runs/useApproveFinalize.ts` (new) — POST `/approve-finalize`.
- `frontend/hooks/runs/useReviewerSummary.ts` — surface `readyCount`/`reviewerCount`.
- `frontend/lib/extraction/stageTransition.ts` — three phase-aware actions.
- `frontend/pages/ExtractionFullScreen.tsx` — rewire `onMarkReady`, add `onOpenConsensus`
  + `handleApproveFinalize`, consume `peers_revealed`, delete legacy `handleFinalize`.
- `frontend/components/runs/ConsensusPanel.tsx` — optional evaluate-all rendering;
  `showFinalize` gate.
- `frontend/lib/copy/extraction.ts` (+ maybe `consensus.ts`) — new copy keys.
- Tests: `frontend/test/stageTransition.test.ts`, `frontend/test/ConsensusPanel.test.tsx`,
  new hook tests.

**Docs:**
- `docs/adr/0015-finalize-via-approve-publish.md` (new, supersedes 0009).
- `docs/adr/0009-extraction-finalize-completeness-gate.md` — frontmatter `superseded`.
- `docs/reference/extraction-hitl-architecture.md` — §2.2 stage/primary-action, stage-advance,
  finalize-gates glossary, auto-reveal note, migration-head bump, new table row.
- `.markdownlintignore` — add this plan path.

---

### Task 1: `ExtractionReviewerReady` model + repository + migration `0029`

**Files:**
- Modify: `backend/app/models/extraction_workflow.py` (add model after `ExtractionReviewerState`, ~L248)
- Modify: `backend/app/models/__init__.py` (export)
- Create: `backend/app/repositories/extraction_reviewer_ready_repository.py`
- Create: `backend/alembic/versions/0029_reviewer_ready_flag.py`
- Modify: `docs/reference/extraction-hitl-architecture.md` (migration head + table row)
- Test: `backend/tests/integration/test_extraction_reviewer_ready.py` (new)

**Interfaces:**
- Produces: table `public.extraction_reviewer_ready(id, run_id, reviewer_id, is_ready,
  marked_ready_at, created_at)`, unique `(run_id, reviewer_id)`.
- Produces: `ExtractionReviewerReadyRepository.upsert(run_id, reviewer_id, is_ready) ->
  ExtractionReviewerReady`; `ready_reviewer_ids(run_id) -> list[UUID]`;
  `count_ready(run_id) -> int`.

- [ ] **Step 1: Add the SQLAlchemy model**

In `backend/app/models/extraction_workflow.py`, after `ExtractionReviewerState`
(verify imports already include `Boolean`, `DateTime`, `func`, `text`, `UniqueConstraint`;
add any missing atomically — the PostToolUse ruff hook strips partial-edit imports):

```python
class ExtractionReviewerReady(BaseModel):
    """Per-reviewer 'I'm done extracting' signal for a run.

    Run+reviewer grain (NOT per-coordinate like ExtractionReviewerState). Advisory:
    the manager/consensus opens consensus manually; this never auto-advances the run.
    """

    __tablename__ = "extraction_reviewer_ready"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    is_ready: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    marked_ready_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "run_id", "reviewer_id", name="uq_extraction_reviewer_ready_run_reviewer"
        ),
        {"schema": "public"},
    )
```

`BaseModel` (via `UUIDMixin` + `TimestampMixin`, `backend/app/models/base.py:176-218`)
already provides `id` (uuid PK), `created_at`, **and `updated_at`** (NOT NULL,
`onupdate=now()`) — so the model declares none of those, but the migration's CREATE TABLE
MUST include all three columns or the ORM upsert/UPDATE will reference a non-existent
`updated_at` column (schema drift; every sibling workflow table has both timestamps).

Export it in `backend/app/models/__init__.py` alongside the other workflow models.

- [ ] **Step 2: Write the migration (hand-written, chains 0028)**

Create `backend/alembic/versions/0029_reviewer_ready_flag.py` (revision id is 24 chars ≤32).
RLS mirrors `0025`: SELECT for project members (ready is not blind-sensitive); INSERT/UPDATE
self-scoped to `reviewer_id = auth.uid()` AND `is_project_reviewer`. The policy joins
`extraction_runs r` for `project_id` (no enum-typed column referenced → no enum
drop/recreate dance).

```python
"""Per-reviewer 'ready' signal table (HITL Phase 2)

Revision ID: 0029_reviewer_ready_flag
Revises: 0028_run_stage_extract
Create Date: 2026-06-21

A new per-(run, reviewer) row recording that a reviewer has finished extracting.
Advisory only (the manager opens consensus manually); it does NOT gate any stage
transition. Grain is run+reviewer (one row per reviewer per run), distinct from the
per-coordinate extraction_reviewer_states. RLS: SELECT for any project member (knowing
someone is "done" leaks no values); INSERT/UPDATE self-scoped to the authoring reviewer.
"""

from alembic import op

revision = "0029_reviewer_ready_flag"
down_revision = "0028_run_stage_extract"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE public.extraction_reviewer_ready (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            is_ready boolean NOT NULL DEFAULT false,
            marked_ready_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_reviewer_ready_run_reviewer UNIQUE (run_id, reviewer_id)
        );
        """
    )
    op.execute(
        "CREATE INDEX ix_extraction_reviewer_ready_run_id "
        "ON public.extraction_reviewer_ready (run_id);"
    )
    op.execute("ALTER TABLE public.extraction_reviewer_ready ENABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_select"
            ON public.extraction_reviewer_ready
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_member(r.project_id, auth.uid())
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_insert"
            ON public.extraction_reviewer_ready
            FOR INSERT WITH CHECK (
                extraction_reviewer_ready.reviewer_id = auth.uid()
                AND EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_reviewer(r.project_id, auth.uid())
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_reviewer_ready_update"
            ON public.extraction_reviewer_ready
            FOR UPDATE USING (
                extraction_reviewer_ready.reviewer_id = auth.uid()
                AND EXISTS (
                    SELECT 1 FROM public.extraction_runs r
                    WHERE r.id = extraction_reviewer_ready.run_id
                      AND public.is_project_reviewer(r.project_id, auth.uid())
                )
            );
        """
    )


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS "extraction_reviewer_ready_update" ON public.extraction_reviewer_ready;')
    op.execute('DROP POLICY IF EXISTS "extraction_reviewer_ready_insert" ON public.extraction_reviewer_ready;')
    op.execute('DROP POLICY IF EXISTS "extraction_reviewer_ready_select" ON public.extraction_reviewer_ready;')
    op.execute("DROP TABLE IF EXISTS public.extraction_reviewer_ready;")
```

- [ ] **Step 3: Verify the migration offline + apply**

From `backend/`:
```bash
uv run alembic upgrade head --sql | grep -i extraction_reviewer_ready | head
uv run alembic upgrade head
uv run alembic current   # → 0029_reviewer_ready_flag
```
Expected: the SQL creates the table + 3 policies; `upgrade head` succeeds.

- [ ] **Step 4: Write the repository**

Create `backend/app/repositories/extraction_reviewer_ready_repository.py`, mirroring
`extraction_reviewer_state_repository.py`'s `on_conflict_do_update` upsert:

```python
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionReviewerReady


class ExtractionReviewerReadyRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upsert(
        self, *, run_id: UUID, reviewer_id: UUID, is_ready: bool
    ) -> ExtractionReviewerReady:
        marked_at = func.now() if is_ready else None
        stmt = (
            pg_insert(ExtractionReviewerReady)
            .values(
                run_id=run_id,
                reviewer_id=reviewer_id,
                is_ready=is_ready,
                marked_ready_at=marked_at,
            )
            .on_conflict_do_update(
                constraint="uq_extraction_reviewer_ready_run_reviewer",
                set_={"is_ready": is_ready, "marked_ready_at": marked_at},
            )
            .returning(ExtractionReviewerReady)
        )
        row = (await self.db.execute(stmt)).scalar_one()
        await self.db.flush()
        return row

    async def ready_reviewer_ids(self, run_id: UUID) -> list[UUID]:
        rows = (
            await self.db.execute(
                select(ExtractionReviewerReady.reviewer_id).where(
                    ExtractionReviewerReady.run_id == run_id,
                    ExtractionReviewerReady.is_ready.is_(True),
                )
            )
        ).scalars().all()
        return list(rows)
```

- [ ] **Step 5: Write the failing tests**

Create `backend/tests/integration/test_extraction_reviewer_ready.py` (use the `_fixtures`
+ `SEED` sentinel pattern from `test_run_lifecycle_service.py`):

```python
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_reviewer_ready_repository import (
    ExtractionReviewerReadyRepository,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _ctx(db: AsyncSession):
    if (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        return None
    return SEED.primary_project, SEED.primary_article, SEED.primary_template, SEED.primary_profile


@pytest.mark.asyncio
async def test_reviewer_ready_table_exists(db_session_real) -> None:
    rows = (
        await db_session_real.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name='extraction_reviewer_ready'"
            )
        )
    ).scalars().all()
    assert {"id", "run_id", "reviewer_id", "is_ready", "marked_ready_at",
            "created_at", "updated_at"} <= set(rows)


@pytest.mark.asyncio
async def test_ready_upsert_is_idempotent_and_toggles(db_session: AsyncSession) -> None:
    ctx = await _ctx(db_session)
    if ctx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = ctx
    run = await RunLifecycleService(db_session).create_run(
        project_id=project_id, article_id=article_id,
        project_template_id=template_id, user_id=profile_id,
    )
    repo = ExtractionReviewerReadyRepository(db_session)
    await repo.upsert(run_id=run.id, reviewer_id=profile_id, is_ready=True)
    await repo.upsert(run_id=run.id, reviewer_id=profile_id, is_ready=True)  # idempotent
    assert await repo.ready_reviewer_ids(run.id) == [profile_id]
    await repo.upsert(run_id=run.id, reviewer_id=profile_id, is_ready=False)  # un-ready
    assert await repo.ready_reviewer_ids(run.id) == []
    await db_session.rollback()
```

- [ ] **Step 6: Run the tests**

Run: `make test-backend PYTEST_ARGS="-k reviewer_ready -v"`
Expected: PASS (autouse fixture applied 0029).

- [ ] **Step 7: Bump the architecture doc + commit**

In `docs/reference/extraction-hitl-architecture.md`: set the migration-head line (§3) to
`0029_reviewer_ready_flag`, bump `last_reviewed` to `2026-06-21`, and add a row to the
core-HITL-tables table for `extraction_reviewer_ready` (per-(run,reviewer) advisory ready
flag).

```bash
git add backend/app/models/extraction_workflow.py backend/app/models/__init__.py \
  backend/app/repositories/extraction_reviewer_ready_repository.py \
  backend/alembic/versions/0029_reviewer_ready_flag.py \
  backend/tests/integration/test_extraction_reviewer_ready.py \
  docs/reference/extraction-hitl-architecture.md
git commit -m "feat(extraction): add per-reviewer ready table + repository (HITL Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Mark-ready service + `POST /runs/{id}/ready` + ready summary on the run-view

**Files:**
- Create: `backend/app/services/extraction_reviewer_ready_service.py`
- Modify: `backend/app/schemas/extraction_run.py` (add `MarkReadyRequest`, `RunReadyStateResponse`;
  add `ready_count`/`reviewer_count`/`reviewers_ready` to `RunViewResponse` ~L224-232)
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (new route after `create_decision` ~L284)
- Modify: `backend/app/services/extraction_run_read_service.py` (`build_run_view` ~L317-349)
- Test: `backend/tests/integration/test_extraction_runs_ready_api.py` (new)

**Interfaces:**
- Consumes: `ExtractionReviewerReadyRepository` (Task 1).
- Produces: `ExtractionReviewerReadyService.mark_ready(run_id, reviewer_id, is_ready) -> None`;
  `ready_summary_from(run_id, hitl_config_snapshot) -> {ready_count, reviewer_count, reviewers_ready}`
  (the single home of the D3 `M` rule).
- Produces: route `POST /api/v1/runs/{run_id}/ready` → `ApiResponse[RunReadyStateResponse]`
  (membership + reviewer-role gated; reviewer_id = caller; 200).
- Produces: `RunViewResponse` gains `ready_count: int`, `reviewer_count: int`,
  `reviewers_ready: list[UUID]`.

- [ ] **Step 1: Schemas**

In `backend/app/schemas/extraction_run.py` add (near `AdvanceStageRequest`):

```python
class MarkReadyRequest(BaseModel):
    ready: bool = True


class RunReadyStateResponse(BaseModel):
    ready_count: int
    reviewer_count: int
    reviewers_ready: list[UUID]
```

And extend `RunViewResponse` with the three ready fields (default-safe):

```python
    ready_count: int = 0
    reviewer_count: int = 0
    reviewers_ready: list[UUID] = Field(default_factory=list)
```

- [ ] **Step 2: Service**

Create `backend/app/services/extraction_reviewer_ready_service.py`. `ready_summary_from`
takes the run's `hitl_config_snapshot` (read off the `RunSummaryResponse` the endpoint
already has — no ORM in the endpoint) and is the SINGLE place the `M` rule lives (D3):

```python
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_reviewer_ready_repository import (
    ExtractionReviewerReadyRepository,
)


class ExtractionReviewerReadyService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._repo = ExtractionReviewerReadyRepository(db)

    async def mark_ready(self, *, run_id: UUID, reviewer_id: UUID, is_ready: bool) -> None:
        await self._repo.upsert(run_id=run_id, reviewer_id=reviewer_id, is_ready=is_ready)

    async def ready_summary_from(
        self, *, run_id: UUID, hitl_config_snapshot: dict[str, Any] | None
    ) -> dict[str, Any]:
        ready = await self._repo.ready_reviewer_ids(run_id)
        reviewer_count = int((hitl_config_snapshot or {}).get("reviewer_count") or 1)
        return {
            "ready_count": len(ready),
            # D3: max() keeps N <= M even when more reviewers are ready than the
            # (inert, often default-1) configured count. Single source of this rule.
            "reviewer_count": max(reviewer_count, len(ready)),
            "reviewers_ready": ready,
        }
```

- [ ] **Step 3: Endpoint**

In `backend/app/api/v1/endpoints/extraction_runs.py`, after `create_decision` (~L284), add
the route (200 — a state toggle, not a created sub-resource). `_load_run_and_check_member`
returns a `RunSummaryResponse` (not ORM) that already carries `hitl_config_snapshot`, so the
endpoint stays layering-clean (schemas only). Add a **reviewer-role gate** (D9): a read-only
viewer must not mark ready, and RLS is bypassed by the service-role connection, so the gate
lives at the API layer — mirror `ensure_project_member` using the `is_project_reviewer` SQL
helper:

```python
@router.post("/{run_id}/ready")
async def mark_run_ready(
    run_id: UUID,
    body: MarkReadyRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunReadyStateResponse]:
    run = await _load_run_and_check_member(db, run_id, current_user_sub)
    is_reviewer = (
        await db.execute(
            text("SELECT public.is_project_reviewer(:pid, :uid) AS ok"),
            {"pid": str(run.project_id), "uid": str(current_user_sub)},
        )
    ).scalar_one()
    if not is_reviewer:
        raise HTTPException(status_code=403, detail="Only reviewers can mark ready")
    service = ExtractionReviewerReadyService(db)
    await service.mark_ready(
        run_id=run_id, reviewer_id=current_user_sub, is_ready=body.ready
    )
    summary = await service.ready_summary_from(
        run_id=run_id, hitl_config_snapshot=run.hitl_config_snapshot
    )
    await db.commit()
    return ApiResponse.success(RunReadyStateResponse(**summary), trace_id=_trace(request))
```

Update imports atomically (`MarkReadyRequest`, `RunReadyStateResponse`,
`ExtractionReviewerReadyService`; `text` from sqlalchemy is already imported by the module
for `ensure_project_member`-style usage — verify).

- [ ] **Step 4: Surface the summary on the run-view**

`build_run_view` (~L317-349) constructs `RunViewResponse` in a single constructor call and
holds `detail.run` (a `RunSummaryResponse` carrying `hitl_config_snapshot`). Compute the
ready summary FIRST via the SAME service method (no duplicated `max()` rule) and pass the
three fields as constructor kwargs (do NOT mutate after construction):

```python
    ready = await ExtractionReviewerReadyService(db).ready_summary_from(
        run_id=run_id, hitl_config_snapshot=detail.run.hitl_config_snapshot
    )
    view = RunViewResponse(
        ...existing kwargs...,
        ready_count=ready["ready_count"],
        reviewer_count=ready["reviewer_count"],
        reviewers_ready=ready["reviewers_ready"],
        # peers_revealed is inherited from `detail` (set in get_run_with_workflow_history, Task 3)
        peers_revealed=detail.peers_revealed,
    )
```

(`detail` is the `RunDetailResponse` from `get_run_with_workflow_history`. The exact existing
kwargs are read at edit time; the four new ones are exact.)

- [ ] **Step 5: Failing tests**

Create `backend/tests/integration/test_extraction_runs_ready_api.py` driving the FastAPI
app via the existing async test client (follow `test_extraction_runs_*` API tests already
in the suite for the client fixture + auth header pattern). Assert:
1. `POST /runs/{id}/ready {ready:true}` as a member → 200, `ready_count == 1`.
2. Re-POST → still `ready_count == 1` (idempotent).
3. `POST {ready:false}` → `ready_count == 0`.
4. A non-member caller → 403.
5. `GET /runs/{id}/view` reflects `ready_count`/`reviewer_count`/`reviewers_ready`.

- [ ] **Step 6: Run + commit**

Run: `make test-backend PYTEST_ARGS="-k (reviewer_ready or runs_ready) -v"`. Expected: PASS.

```bash
git add backend/app/services/extraction_reviewer_ready_service.py \
  backend/app/schemas/extraction_run.py backend/app/api/v1/endpoints/extraction_runs.py \
  backend/app/services/extraction_run_read_service.py backend/tests/integration/
git commit -m "feat(extraction): mark-ready endpoint + N/M ready hint on run-view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Auto-reveal a blind manager on entering consensus (run-scoped) + `peers_revealed`

**Files:**
- Modify: `backend/app/services/extraction_run_read_service.py` (`get_run_with_workflow_history`
  ~L79-144 incl. L126; `build_run_view` ~L317-349; thread `caller_is_arbitrator`)
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (`get_run` ~L145-162,
  `get_run_view` ~L165-179 — compute `is_run_arbitrator`)
- Modify: `backend/app/api/v1/endpoints/hitl_sessions.py` (~L83-91 — same)
- Modify: `backend/app/schemas/extraction_run.py` (add `peers_revealed: bool = False` to
  `RunDetailResponse`)
- Test: `backend/tests/integration/test_run_consensus_reveal.py` (new)

**Interfaces:**
- Consumes: `is_run_arbitrator(db, project_id, user_id)` (existing, ~L352-363).
- Produces: in consensus stage, an arbitrator (manager/consensus) sees peer
  proposals+decisions; plain reviewers stay blind. `RunViewResponse.peers_revealed` reflects
  the effective unblind (`can_see_peers OR finalized OR (consensus AND arbitrator)`).

- [ ] **Step 1: Failing test**

Create `backend/tests/integration/test_run_consensus_reveal.py`. Seed a run with two
reviewers' decisions for the same coord (use `SEED.primary_profile` as a manager and
`SEED.reviewer_profile` as a reviewer; record each one's decision via
`ExtractionReviewService`). Then:
1. In `extract` stage, with the project's `managers_see_reviewers[extraction]=false`,
   `get_run_with_workflow_history(..., can_see_peers=False, caller_is_arbitrator=True)` for
   the manager returns ONLY the manager's own decisions (blind).
2. Advance to `consensus`. Same call now returns BOTH reviewers' decisions (revealed).
3. For a plain reviewer (`caller_is_arbitrator=False`, `can_see_peers=False`) in
   `consensus`, only their own decisions are visible (still blind).
4. `build_run_view` sets `peers_revealed=True` for the manager in consensus, `False` for the
   reviewer.

- [ ] **Step 2: Run it (fails)**

Run: `make test-backend PYTEST_ARGS="-k consensus_reveal -v"`. Expected: FAIL — current
predicate only unblinds on `FINALIZED`.

- [ ] **Step 3: Extend the blind predicate**

Add a `caller_is_arbitrator: bool` parameter to `get_run_with_workflow_history` (default
`False`) and change L126:

```python
    unblinded = (
        can_see_peers
        or run.stage == ExtractionRunStage.FINALIZED.value
        or (run.stage == ExtractionRunStage.CONSENSUS.value and caller_is_arbitrator)
    )
```

**Set `peers_revealed` on the `RunDetailResponse` this function returns, from the same
`unblinded` local** — so the flag can never drift from the data filter (the single-blind-
filter invariant the docstring guards). `build_run_view` then just copies
`detail.peers_revealed` (Task 2 Step 4); do NOT recompute the predicate there. `get_run`
(which returns `RunDetailResponse`) carries the flag for free. Thread `caller_is_arbitrator`
through `build_run_view(..., caller_is_arbitrator=...)`.

Do NOT touch `resolve_caller_current_values` (own-value resolution; peer reveal is
irrelevant there) and do NOT change RLS 0025 (arbitrators may already SELECT peer rows; this
only relaxes the API path for managers in consensus, consistent with the documented "API
stricter-than-RLS" split — the reviewer↔reviewer boundary is unchanged).

- [ ] **Step 4: Update the three call sites**

In `extraction_runs.py` `get_run` and `get_run_view`, and `hitl_sessions.py` session-open,
compute the arbitrator flag alongside `can_see_peers` and pass it down:

```python
    can_see_peers = await caller_can_see_peers(
        db, project_id=run.project_id, user_id=current_user_sub, kind=run.kind
    )
    is_arbitrator = await is_run_arbitrator(db, run.project_id, current_user_sub)
    view = await build_run_view(
        db, run_id, caller_id=current_user_sub,
        can_see_peers=can_see_peers, caller_is_arbitrator=is_arbitrator,
    )
```

For `get_run` (returns `RunDetailResponse`), likewise compute `is_arbitrator` and pass it to
`get_run_with_workflow_history` so `RunDetailResponse.peers_revealed` is populated there too.
Add `peers_revealed: bool = False` to **`RunDetailResponse`** in the schema (so both `get_run`
and `/view` carry it; `RunViewResponse` inherits it).

- [ ] **Step 5: Run + full read-service suite**

Run: `make test-backend PYTEST_ARGS="-k (consensus_reveal or run_read or run_view) -v"`.
Expected: PASS. Fix any call site the signature change broke.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/extraction_run_read_service.py \
  backend/app/api/v1/endpoints/extraction_runs.py backend/app/api/v1/endpoints/hitl_sessions.py \
  backend/app/schemas/extraction_run.py backend/tests/integration/test_run_consensus_reveal.py
git commit -m "feat(extraction): auto-reveal arbitrator peers on consensus entry (run-scoped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `approve_and_finalize` — atomic publish-everything + finalize (the dead-end fix)

**Files:**
- Modify: `backend/app/services/run_lifecycle_service.py` (new method `approve_and_finalize`
  + a coord-value resolver; reuse `_filled_coords`/`_find_unfilled_required_coords` ~L252-358)
- Modify: `backend/app/schemas/extraction_run.py` (`ApproveFinalizeResponse`)
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (new route ~after `advance_run` L402)
- Test: `backend/tests/integration/test_run_lifecycle_service.py` (add cases),
  `backend/tests/integration/test_extraction_runs_ready_api.py` or a new API test for the route

**Interfaces:**
- Consumes: `ExtractionConsensusService.record_consensus` (`extraction_consensus_service.py`),
  `advance_stage`, `_filled_coords`/value resolution.
- Produces: `RunLifecycleService.approve_and_finalize(run_id, user_id) -> ExtractionRun`
  (publishes each agreed-unpublished coord, then advances to FINALIZED, one transaction).
- Produces: route `POST /api/v1/runs/{run_id}/approve-finalize` →
  `ApiResponse[ApproveFinalizeResponse]`.

- [ ] **Step 1: Failing test — the no-divergence finalize that currently dead-ends**

Add to `backend/tests/integration/test_run_lifecycle_service.py`:

```python
@pytest.mark.asyncio
async def test_approve_and_finalize_publishes_agreed_and_finalizes(
    db_session: AsyncSession,
) -> None:
    """A single-reviewer (no-divergence) run with required fields filled by a
    reviewer decision — but ZERO consensus decisions — currently dead-ends on
    EmptyFinalizeError. approve_and_finalize must publish the agreed value(s)
    and finalize in one call."""
    from app.services.extraction_review_service import ExtractionReviewService

    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id=:p AND article_id=:a AND template_id=:t"
        ),
        {"p": str(project_id), "a": str(article_id), "t": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id, article_id=article_id,
        project_template_id=template_id, user_id=profile_id,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=profile_id)
    # Reviewer fills the (only) field via a decision — no consensus yet.
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id, instance_id=SEED.primary_instance, field_id=SEED.primary_field,
        reviewer_id=profile_id, decision="edit", value={"value": "42"},
    )
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=profile_id)

    finalized = await svc.approve_and_finalize(run_id=run.id, user_id=profile_id)
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    # A published value now exists for the agreed coord.
    published = (
        await db_session.execute(
            text("SELECT value FROM public.extraction_published_states WHERE run_id=:r"),
            {"r": str(run.id)},
        )
    ).scalars().all()
    assert len(published) == 1
    await db_session.rollback()
```

Also add `test_approve_and_finalize_requires_consensus_stage` (calling it in `extract`
raises). For `test_approve_and_finalize_blocks_unfilled_required` (proving the completeness
gate is still a real invariant), the SEED template marks **nothing required** and its frozen
snapshot is `{"entity_types": []}` — so the gate would never fire and the test would pass for
the wrong reason. Mirror the existing `test_finalize_blocked_until_required_fields_filled`
(`test_run_lifecycle_service.py:244-359`): insert a real `is_required` field AND rewrite the
run's `version.schema_` so the snapshot declares ≥1 `is_required: True` field on the existing
instance's entity type, leave that coord with no reviewer value, then assert
`approve_and_finalize` raises `IncompleteFinalizeError`; fill it and assert it then succeeds.

- [ ] **Step 2: Run it (fails)**

Run: `make test-backend PYTEST_ARGS="-k approve_and_finalize -v"`. Expected: FAIL
(`approve_and_finalize` undefined).

- [ ] **Step 3: Implement the coord-value resolver**

In `run_lifecycle_service.py`, add a helper that returns, per *existing-instance ×
snapshot-field* coord with no `PublishedState`, the single resolved non-empty reviewer
value (or flags an unresolved divergence). Reuse the exact resolution `_filled_coords`
uses (envelope unwrap via `_unwrap_value`, `accept_proposal` resolving through the
referenced proposal, `reject` skipped):

```python
async def _agreed_unpublished_values(
    self, run: ExtractionRun
) -> tuple[dict[tuple[UUID, UUID], dict], list[tuple[UUID, UUID]]]:
    """Return ({(instance,field): envelope_to_publish}, [unresolved_divergent_coords]).

    A coord is publishable here iff it has no PublishedState yet and every current
    reviewer decision for it resolves to the SAME non-empty value (agreement or a
    single reviewer). Coords with >=2 distinct non-empty values are unresolved
    divergences the arbitrator must resolve via /consensus first.

    ENVELOPE vs SCALAR (critical): compare distinctness on the UNWRAPPED scalar
    (`_unwrap_value`, peeling one {"value": X}); but publish the ORIGINAL envelope
    dict (`decision.value`, or the referenced proposal's `proposed_value` for an
    accept_proposal decision) — record_consensus(MANUAL_OVERRIDE, value=...) writes
    `value` straight into PublishedState.value (JSONB), so the publish payload must be
    the envelope, not the unwrapped scalar (or it double-wraps / publishes the wrong shape).
    """
    # Build {coord: {unwrapped_scalar: original_envelope}} from reviewer_states
    # JOIN reviewer_decisions on current_decision_id (mirror _filled_coords ~329-356):
    #   - skip 'reject' decisions; resolve accept_proposal via a
    #     {proposal_record_id -> proposed_value} map; unwrap with _unwrap_value;
    #     drop empty (_is_value_filled).
    # Subtract coords already present in extraction_published_states for the run.
    # Group by coord: 1 distinct unwrapped value -> publish map (envelope);
    #                 >=2 distinct -> unresolved-divergence list.
```

(Implement by adapting the `_filled_coords` query — same joins and the same
`_unwrap_value`/`_is_value_filled` helpers already in the module — but key each coord's map
by the unwrapped scalar while keeping the original envelope as the value to publish.)

- [ ] **Step 4: Implement `approve_and_finalize`**

Use the **module-level** `load_run_for_update(db, run_id)` from
`app.services._extraction_run_lock` (the helper `record_consensus`/`record_decision` use —
there is NO `self._load_run_for_update` method; `advance_stage` inlines its own
`with_for_update`). Import `ExtractionConsensusService` + `ExtractionConsensusMode` at module
top: verified there is **no** circular import (`extraction_consensus_service` does not import
`run_lifecycle_service`; `ExtractionConsensusMode` lives in `app.models.extraction_workflow`,
already imported). Guard `kind == extraction` (D9 — QA uses its own publish-then-advance):

```python
from app.services._extraction_run_lock import load_run_for_update
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.models.extraction_workflow import ExtractionConsensusMode  # if not already imported

async def approve_and_finalize(self, *, run_id: UUID, user_id: UUID) -> ExtractionRun:
    run = await load_run_for_update(self.db, run_id)
    if run is None:
        raise ValueError(f"Run {run_id} not found")
    if run.kind != TemplateKind.EXTRACTION.value:
        raise InvalidStageTransitionError(
            "approve_and_finalize applies to extraction runs only; "
            "quality-assessment runs publish via their own flow."
        )
    if run.stage != ExtractionRunStage.CONSENSUS.value:
        raise InvalidStageTransitionError(
            f"approve_and_finalize requires stage 'consensus', got '{run.stage}'."
        )
    to_publish, unresolved = await self._agreed_unpublished_values(run)
    if unresolved:
        raise InvalidStageTransitionError(
            f"Cannot approve: {len(unresolved)} field(s) still diverge. "
            "Resolve each diverging field before finalizing."
        )
    consensus = ExtractionConsensusService(self.db)
    for (instance_id, field_id), envelope in to_publish.items():
        await consensus.record_consensus(
            run_id=run_id, instance_id=instance_id, field_id=field_id,
            consensus_user_id=user_id, mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value=envelope, rationale="Approved: reviewers agree (Phase 2 approve-all).",
        )
    return await self.advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.FINALIZED, user_id=user_id
    )
```

`record_consensus` re-locks via `load_run_for_update` and guards `stage == consensus`;
re-entrant FOR UPDATE within one tx is safe. `advance_stage` then re-runs both gates against
the just-written `PublishedState`/`ConsensusDecision` rows (same tx), so
`EmptyFinalizeError`/`IncompleteFinalizeError` are now satisfied for a complete run.

- [ ] **Step 5: Endpoint + schema**

`ApproveFinalizeResponse` in `extraction_run.py`:

```python
class ApproveFinalizeResponse(BaseModel):
    run: RunSummaryResponse
    published_count: int
```

Route in `extraction_runs.py` (copy `advance_run`'s error mapping — both finalize errors
subclass `InvalidStageTransitionError` → 400; `OptimisticConcurrencyError` → 409; one
`db.commit()`):

```python
@router.post("/{run_id}/approve-finalize")
async def approve_and_finalize_run(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ApproveFinalizeResponse]:
    await _load_run_and_check_member(db, run_id, current_user_sub)
    service = RunLifecycleService(db)
    trace_id = _trace(request)
    try:
        run = await service.approve_and_finalize(run_id=run_id, user_id=current_user_sub)
    except InvalidStageTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OptimisticConcurrencyError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        ApproveFinalizeResponse(run=RunSummaryResponse.model_validate(run), published_count=0),
        trace_id=trace_id,
    )
```

(Have `approve_and_finalize` also return the publish count if you want `published_count`
populated; otherwise drop the field. Keep the response typed.)

- [ ] **Step 6: Run lifecycle + consensus + QA regression**

Run: `make test-backend PYTEST_ARGS="-k (approve_and_finalize or run_lifecycle or consensus) -v"`.
Then a full `make test-backend` (catch QA finalize regressions — QA is consensus-only, must
stay green). Expected: green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/run_lifecycle_service.py backend/app/schemas/extraction_run.py \
  backend/app/api/v1/endpoints/extraction_runs.py backend/tests/integration/
git commit -m "feat(extraction): atomic approve-and-finalize (publish-all then finalize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Regenerate API types + frontend hooks (`useMarkReady`, `useApproveFinalize`)

**Files:**
- Regenerate: `frontend/types/api/{openapi.json,schema.d.ts}`
- Modify: `frontend/hooks/runs/types.ts` — **hand-mirrored** (`useRun` is typed by it, NOT
  by generated `schema.d.ts`), so add by hand: `peers_revealed: boolean` to
  `RunDetailResponse`; `ready_count: number` / `reviewer_count: number` /
  `reviewers_ready: string[]` to `RunViewResponse`; plus `RunReadyStateResponse`,
  `MarkReadyRequest`, `ApproveFinalizeResponse`. Regenerating `schema.d.ts` does NOT change
  the `useRun` data shape — these MUST be hand-added or `runDetail.peers_revealed`/
  `.ready_count` are `undefined`/type errors.
- Create: `frontend/hooks/runs/useMarkReady.ts`, `frontend/hooks/runs/useApproveFinalize.ts`
- Test: `frontend/test/useMarkReady.test.ts(x)` (or co-located), `frontend/test/useApproveFinalize.test.tsx`

**Interfaces:**
- Consumes: backend routes from Tasks 2 & 4.
- Produces: `useMarkReady(runId)` mutation (`{ ready: boolean }` → `RunReadyStateResponse`),
  invalidates `runsKeys.detail(runId)`; `useApproveFinalize(runId)` mutation (no body →
  `ApproveFinalizeResponse`), invalidates `runsKeys.detail(runId)`, `onError` toasts
  `error.message`.

- [ ] **Step 1: Regenerate generated types + hand-mirror the run types**

Run: `npm run generate:api-types` (keeps `schema.d.ts` in sync for the CI `api-contract`
gate). Then **hand-add** to `frontend/hooks/runs/types.ts` (it is hand-mirrored and backs
`useRun`): `peers_revealed: boolean` on `RunDetailResponse`; `ready_count: number`,
`reviewer_count: number`, `reviewers_ready: string[]` on `RunViewResponse`; and the request/
response types `MarkReadyRequest { ready: boolean }`, `RunReadyStateResponse`,
`ApproveFinalizeResponse`. (Type-only edit; `useReviewerSummary`'s param is widened to
`RunViewResponse` in Task 8.)

- [ ] **Step 2: Failing hook tests**

Mirror an existing hook test (e.g. the test backing `useAdvanceRun`) with MSW v2: assert
`useMarkReady` POSTs `/api/v1/runs/{id}/ready` with `{ready:true}` and invalidates
`runsKeys.detail(id)`; assert `useApproveFinalize` POSTs `/api/v1/runs/{id}/approve-finalize`
and surfaces a 400 `error.message` via toast on failure.

- [ ] **Step 3: Implement the hooks**

`frontend/hooks/runs/useMarkReady.ts` (mirror `useAdvanceRun.ts` structure exactly):

```typescript
export function useMarkReady(runId: string) {
  const queryClient = useQueryClient();
  return useMutation<RunReadyStateResponse, Error, { ready: boolean }>({
    mutationFn: (body) =>
      apiClient<RunReadyStateResponse>(`/api/v1/runs/${runId}/ready`, { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
    onError: (error) => {
      toast.error(error.message || t("extraction", "errors_advanceFailed"));
    },
  });
}
```

`useApproveFinalize.ts` similarly (POST `/approve-finalize`, no body, invalidate
`runsKeys.detail(runId)`).

- [ ] **Step 4: Run + typecheck**

Run: `npm run typecheck && npm run test:run -- frontend/test/useMarkReady frontend/test/useApproveFinalize`.
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/types/api/ frontend/hooks/runs/
git commit -m "feat(extraction): FE hooks for mark-ready + approve-finalize; regen api types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Phase-aware header action in `buildExtractionTransition`

**Files:**
- Modify: `frontend/lib/extraction/stageTransition.ts` (`BuildTransitionArgs` L5-15,
  `buildExtractionTransition` L43-77)
- Modify: `frontend/test/stageTransition.test.ts`
- Modify: `frontend/lib/copy/extraction.ts` (new keys ~L555-559)

**Interfaces:**
- `BuildTransitionArgs` gains `onOpenConsensus`, `onApproveFinalize`, `divergencesResolved`,
  `isReady` and drops `onFinalize`.
- Produces: three branches —
  - `extract && !canResolveConflicts` (reviewer) → label `runHeaderMarkedReady` when `isReady`
    else `runHeaderMarkReady`; `onAdvance=onMarkReady`; gated on `isComplete` (the gate
    redirects to `onGuide`).
  - `extract && canResolveConflicts` (manager/consensus) → label `runHeaderOpenConsensus`,
    `onAdvance=onOpenConsensus`, `gate:{ok:true}` (manager opens consensus at will; the N/M
    hint guides timing).
  - `consensus && canResolveConflicts` → label `runHeaderApproveFinalize`,
    `gate.ok = isComplete && divergencesResolved` (spec §4.3 "enabled only when every
    diverging field is resolved and all required fields are filled"); `onAdvance` =
    `onApproveFinalize` when ok, else `onGuide`. NOT a dead-end: a complete no-divergence run
    has `divergencesResolved=true` so the button is enabled.
  - else → `null`.

- [ ] **Step 1: Copy keys**

In `frontend/lib/copy/extraction.ts`, add near the existing run-header keys:

```typescript
  runHeaderMarkedReady: 'Marked ready',
  runHeaderOpenConsensus: 'Open consensus',
  runHeaderOpenConsensusTooltip: 'Move this article into consensus for review and publishing.',
  runHeaderApproveFinalize: 'Approve & finalize',
  runHeaderApproveFinalizeTooltip: 'Publish every agreed value and finalize this article.',
  runHeaderApproveBlocked: 'Resolve every diverging field and fill all required fields first.',
```

(English-only; keep `runHeaderMarkReady`/`runHeaderMarkReadyTooltip` for the reviewer action;
reuse `runHeaderGateBlocked` for the Mark-ready completeness gate.)

- [ ] **Step 2: Update the failing tests**

The real `frontend/test/stageTransition.test.ts` has **9 cases** (not two) and a `makeArgs`
helper that hardcodes `onFinalize`. Update `makeArgs`: drop `onFinalize`, add
`onOpenConsensus`, `onApproveFinalize`, `divergencesResolved`, `isReady` (default
`divergencesResolved: true`, `isReady: false`). Re-map every case:
- extract + `!canResolveConflicts` (reviewer): label `runHeaderMarkReady`,
  `onAdvance === onMarkReady`; complete → `gate.ok === true`; incomplete → `gate.ok === false`
  + `onAdvance === onGuide`. Add a case: `isReady: true` → label `runHeaderMarkedReady`.
- **FLIP** the existing "manager in extract gets Mark ready" case → manager in extract now
  gets `runHeaderOpenConsensus`, `gate.ok === true`, `onAdvance === onOpenConsensus`.
- consensus + `canResolveConflicts`: label `runHeaderApproveFinalize`; with
  `isComplete && divergencesResolved` → `gate.ok === true`, `onAdvance === onApproveFinalize`;
  with a diverging-unresolved or incomplete case → `gate.ok === false`,
  `onAdvance === onGuide`.
- consensus + `!canResolveConflicts` → `null`; finalized / pending / cancelled / null → `null`.
Run them to confirm failure.

- [ ] **Step 3: Update the builder**

Extend `BuildTransitionArgs` (drop `onFinalize`; add the four new inputs):

```typescript
export interface BuildTransitionArgs {
  stage: ExtractionRunStage | null;
  canResolveConflicts: boolean;
  isComplete: boolean;
  completed: number;
  total: number;
  /** Every diverging coord has a consensus decision (reviewerSummary-derived). */
  divergencesResolved: boolean;
  /** The caller is in reviewers_ready (reflects the Mark-ready button label). */
  isReady: boolean;
  onMarkReady: () => void | Promise<void>;
  onOpenConsensus: () => void | Promise<void>;
  onApproveFinalize: () => void | Promise<void>;
  onGuide: () => void;
}
```

Rewrite `buildExtractionTransition`:

```typescript
export function buildExtractionTransition(args: BuildTransitionArgs): StageTransition | null {
  const { stage, canResolveConflicts, isComplete, completed, total, divergencesResolved,
          isReady, onMarkReady, onOpenConsensus, onApproveFinalize, onGuide } = args;

  if (stage === 'extract') {
    if (canResolveConflicts) {
      // Manager/consensus: open consensus at will (advisory N/M-ready hint guides timing).
      return {
        to: 'consensus',
        label: t('extraction', 'runHeaderOpenConsensus'),
        tooltip: t('extraction', 'runHeaderOpenConsensusTooltip'),
        gate: { ok: true },
        onAdvance: onOpenConsensus,
      };
    }
    // Reviewer: per-reviewer ready signal (no stage move); gated on own completeness.
    return makeTransition(
      'consensus', // display target node; onMarkReady does NOT advance the run
      isReady ? t('extraction', 'runHeaderMarkedReady') : t('extraction', 'runHeaderMarkReady'),
      t('extraction', 'runHeaderMarkReadyTooltip'),
      isComplete, completed, total, onMarkReady, onGuide,
    );
  }

  if (stage === 'consensus' && canResolveConflicts) {
    // Spec §4.3: enabled only when every diverging field is resolved AND all required
    // fields are filled. A complete no-divergence run is enabled (divergencesResolved=true),
    // so this is not the I2 dead-end; an incomplete run is correctly disabled (reopen to fill).
    const ok = isComplete && divergencesResolved;
    return {
      to: 'finalized',
      label: t('extraction', 'runHeaderApproveFinalize'),
      tooltip: t('extraction', 'runHeaderApproveFinalizeTooltip'),
      gate: ok
        ? { ok: true }
        : { ok: false, reason: t('extraction', 'runHeaderApproveBlocked'),
            remaining: Math.max(0, total - completed) },
      onAdvance: ok ? onApproveFinalize : onGuide,
    };
  }

  return null;
}
```

(`StageTransition` has no `variant` field — no styling change. The bare `{to,label,tooltip,
gate:{ok:true},onAdvance}` object is assignable to the union's `ok:true` member, confirmed
against `RunHeaderContext.tsx:7-15`.)

- [ ] **Step 4: Run FE tests + typecheck**

Run: `npm run typecheck && npm run test:run -- frontend/test/stageTransition.test.ts`.
Expected: PASS (typecheck will flag the call site in `ExtractionFullScreen.tsx` — fixed in
Task 7; if running standalone, expect that one type error until Task 7).

- [ ] **Step 5: Commit (with Task 7, since the call site must compile)**

Defer the commit to the end of Task 7 so the tree typechecks.

---

### Task 7: Rewire `ExtractionFullScreen` — ready / open-consensus / approve-finalize, auto-reveal, drop legacy finalize

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (onMarkReady L377-395; handleFinalize
  L813-939 DELETE; markInstancesCompleted import L21 REMOVE; buildExtractionTransition call
  L1137-1146; ExtractionHeader props L1154-1215; ConsensusPanel render L1253-1269; canReveal/
  onReveal L414-419; hardcoded toasts L298/L316)

**Interfaces:**
- Consumes: `useMarkReady`, `useApproveFinalize` (Task 5); `buildExtractionTransition` (Task 6);
  `runDetail.peers_revealed` (Task 3).
- Produces: `onMarkReady` (ready flag, no advance, navigate next), `onOpenConsensus` (advance
  to consensus + auto-reveal effect fires), `handleApproveFinalize` (calls approve-finalize
  endpoint, refetch, toast).

- [ ] **Step 1: Rewrite `onMarkReady` (no stage advance)**

```typescript
  const markReady = useMarkReady(activeRunId ?? '');
  const onMarkReady = async () => {
    if (!activeRunId) return;
    const saved = await saveNow().then(() => true).catch(() => false);
    if (!saved) return;
    const ok = await markReady.mutateAsync({ ready: true }).then(() => true).catch(() => false);
    if (!ok) return;
    const nextId = nextArticleTarget(articles, articleId ?? '');
    navigate(nextId
      ? `/projects/${projectId}/extraction/${nextId}`
      : `/projects/${projectId}?tab=extraction`);
  };
```

**Deliberate UX decisions (documented per the FE review):** (1) marking ready does NOT advance
the run (it stays in `extract`); the manager opens consensus separately. (2) Navigating to the
next article is kept — a reviewer marking "I'm done with this one" moving to their next
worklist item matches the existing flow. (3) The run stays in `extract`, so autosave remains
live (`useAutoSaveProposals` enabled gate, L364-366) — a reviewer can keep editing after
marking ready; the flag is **advisory** and is not auto-cleared on re-edit (un-marking via the
header `isReady` label/`{ready:false}` is available but not auto-triggered). The header button
reflects state via the `isReady` label (Task 6).

- [ ] **Step 2: Add `onOpenConsensus` (the advance removed from onMarkReady)**

```typescript
  const onOpenConsensus = async () => {
    if (!activeRunId) return;
    const saved = await saveNow().then(() => true).catch(() => false);
    if (!saved) return;
    await advanceMutation.mutateAsync({ target_stage: 'consensus' })
      .then(() => true).catch(() => false);
    // Auto-reveal is handled server-side (run-scoped, Task 3) and surfaced via
    // runDetail.peers_revealed after the run-view refetch below.
    await refetchRun().catch(() => {});
  };
```

- [ ] **Step 3: Replace `handleFinalizeFromConsensus` with `handleApproveFinalize`**

There is ALREADY a consensus-finalize handler — `handleFinalizeFromConsensus` (L286-299,
bound to `ConsensusPanel.onFinalize` at L1263) — but it only `advance`s (no publish), so it
does NOT fix the dead-end. **Replace its body** to call the approve-finalize endpoint (and
rename to `handleApproveFinalize` so there is one handler). After the edit, grep
`ExtractionFullScreen.tsx` for `handleFinalizeFromConsensus` → zero hits (an orphaned const
fails react-compiler/eslint, the same dead-symbol class as `handleFinalize`):

```typescript
  const approveFinalize = useApproveFinalize(activeRunId ?? '');
  const handleApproveFinalize = async () => {
    if (!activeRunId) return;
    const ok = await approveFinalize.mutateAsync(undefined as never)
      .then(() => true).catch(() => false);
    if (!ok) return;
    await Promise.all([refetchRun(), refreshValues(), refreshFinalizedRun()]);
    toast.success(t('pages', 'extractionScreenFinalizeSuccess'));
  };
```

Bind `handleApproveFinalize` to BOTH the header transition (`onApproveFinalize`, Step 4) and
`ConsensusPanel.onFinalize` (L1263) — one handler, one source of truth (I6). (The extraction
panel hides its own finalize button via `showFinalize={false}`, Task 8, but keeping
`onFinalize` wired to the same handler avoids an orphan and is harmless.)

**Move all hardcoded toast strings to copy** (frontend hard rule). Three exist in this file:
L298 `'Extraction finalized.'` (now `t('pages','extractionScreenFinalizeSuccess')` — the key
already exists, `pages.ts:59`, reuse it; do NOT invent `extraction.finalizeSuccess`), and the
reopen handler's L316 success + L319 error strings → reuse/extend existing keys (check
`pages.ts` / `qa.ts` for `reopenSuccess`/`reopenError` equivalents; add to the `pages`
namespace if absent). After this step, no `toast.*('...')` string literal remains in the file.

- [ ] **Step 4: Update the `buildExtractionTransition` call site**

Compute the two new inputs from data the page already has: `divergencesResolved` =
every `reviewerSummary.divergentCoords` has a matching `runDetail.consensus_decisions` entry
(the same `resolvedByCoord` logic `ConsensusPanel` uses at L335-339; for a no-divergence run
this is trivially `true`); `isReady` = the current user's id is in `runDetail.reviewers_ready`.

```typescript
  const transition = buildExtractionTransition({
    stage,
    canResolveConflicts: permissions.canResolveConflicts,
    isComplete,
    completed: completedFields,
    total: totalFields,
    divergencesResolved,
    isReady: (runDetail?.reviewers_ready ?? []).includes(currentUserId),
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize: handleApproveFinalize,
    onGuide,
  });
```

- [ ] **Step 5: Delete the legacy finalize path**

- Delete the local `handleFinalize` function (L813-939).
- Remove `markInstancesCompleted` from the import on L21 (leave `extractionInstanceService`
  if still used elsewhere — grep first). Do NOT delete `markInstancesCompleted` from
  `extractionInstanceService.ts` (Phase 3).
- Remove the `onFinalize={handleFinalize}` prop on `ExtractionHeader` (L1179) and any
  remaining `onFinalize` reference in the header props.
- **Inspect `ExtractionHeader.tsx`'s prop interface:** if `onFinalize` (and `isComplete`/
  `submitting` if only used for a finalize button) is a REQUIRED prop, either make it optional
  or remove it; and confirm `ExtractionHeader` does NOT itself render a finalize button
  (a `HeaderFinalizeButton`/legacy finalize affordance) — if it does, remove it. That second
  in-header finalize button is exactly the I6 "two Finalize buttons" the phase-aware
  `PrimaryAction` replaces.
- Grep `ExtractionFullScreen.tsx` for `handleFinalize` / `handleFinalizeFromConsensus` /
  `markInstancesCompleted` → zero hits.

- [ ] **Step 6: Auto-reveal consumption (no toggle write)**

The real compare gate is `canCompare = permissions.canSeeOthers && reviewerSummary.decisionsByCoord.size > 0`
(L408-409). OR-in the run-scoped reveal but KEEP the `size > 0` guard (don't show an empty
compare grid), and use `||` not `??` (a manager who toggled `canSeeOthers` in extract must
keep it even when `peers_revealed` is `false`):

```typescript
  const canCompare =
    (runDetail?.peers_revealed || permissions.canSeeOthers) &&
    reviewerSummary.decisionsByCoord.size > 0;
```

Keep `permissions.*` for role/permission decisions (`canResolveConflicts`, `canExport`). Do
NOT auto-flip the project toggle on consensus entry (the run-scoped reveal covers this run).

**Hide the manual "Reveal reviewers" affordance once revealed/in consensus** (C4): change
`canReveal` (L414) so the persistent-toggle button is offered only during extract while still
blind, e.g. `canReveal = permissions.userRole === 'manager' && permissions.isBlindMode &&
stage === 'extract' && !runDetail?.peers_revealed`. This prevents a manager in consensus
(already auto-revealed, run-scoped) from needlessly mutating the project-wide setting.

- [ ] **Step 7: Typecheck + render tests**

Run: `npm run typecheck && npm run test:run -- frontend/test/extractionReveal.test.tsx frontend/test/stageTransition.test.ts`.
Expected: clean + PASS.

- [ ] **Step 8: Commit (Tasks 6 + 7 together)**

```bash
git add frontend/lib/extraction/stageTransition.ts frontend/test/stageTransition.test.ts \
  frontend/lib/copy/extraction.ts frontend/pages/ExtractionFullScreen.tsx
git commit -m "feat(extraction): phase-aware header (mark ready / open consensus / approve & finalize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `ConsensusPanel` evaluate-all rendering + N/M ready hint (QA preserved)

**Files:**
- Modify: `frontend/components/runs/ConsensusPanel.tsx` (`ConsensusPanelProps` L42-77;
  coord source L335-341/L421-424; finalize buttons L343-419)
- Modify: `frontend/hooks/runs/useReviewerSummary.ts` (param → `RunViewResponse`; surface
  `readyCount`/`reviewerCount`)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (full coord list + label map,
  `evaluateAllCoords`, `showFinalize={false}`, ready-hint plumbing)
- Modify: `frontend/components/runs/header/RunHeaderContext.tsx` (`reviewers.ready?`/`readyTotal?`),
  `frontend/components/runs/header/Reviewers.tsx` (render the hint), `ExtractionHeader.tsx`
  (populate), and verify `QualityAssessmentFullScreen.tsx` header-value still typechecks
- Modify: `frontend/lib/copy/consensus.ts` + `frontend/lib/copy/extraction.ts` (evaluate-all +
  ready-hint keys)
- Test: `frontend/test/ConsensusPanel.test.tsx`, `frontend/test/useReviewerSummary.test.ts`,
  a `Reviewers` hint test

**Interfaces:**
- Produces: `ConsensusPanel` renders ALL coords when `evaluateAllCoords` is supplied
  (extraction), agreed coords pre-selected/collapsed, diverging expanded; QA (no prop) keeps
  divergent-only. `showFinalize` (default `true`) hides the in-panel finalize button for
  extraction (header owns "Approve & finalize").
- Produces: `ReviewerSummary` gains `readyCount`/`reviewerCount` (from
  `runDetail.ready_count`/`reviewer_count`).

- [ ] **Step 1: Widen the hook param + add ReviewerSummary ready fields (failing test first)**

`useReviewerSummary`'s param is typed `RunDetailResponse` (L105) but the ready fields live on
`RunViewResponse`. The hook is only ever called with the `/view` payload (`useRun` returns
`RunViewResponse`), so **widen the param type to `RunViewResponse`** — then `ready_count`/
`reviewer_count` are visible. In `frontend/test/useReviewerSummary.test.ts`, assert
`readyCount`/`reviewerCount` echo `runDetail.ready_count`/`reviewer_count`. Then add to the
returned `ReviewerSummary` (extend its interface):

```typescript
    readyCount: runDetail.ready_count ?? 0,
    reviewerCount: runDetail.reviewer_count ?? requiredReviewerCount,
```

(If any caller passes a bare `RunDetailResponse`, typecheck will flag it — there should be
none; fix by passing the `/view` payload.)

- [ ] **Step 2: ConsensusPanel props**

Add to `ConsensusPanelProps`:

```typescript
  /** When provided (extraction), render every coord (evaluate-all). QA omits it → divergent-only. */
  evaluateAllCoords?: string[];
  /** Render the in-panel finalize button. Extraction sets false (header owns it); QA defaults true. */
  showFinalize?: boolean;
```

- [ ] **Step 3: Evaluate-all rendering**

In `ConsensusPanel`, choose the iterated list by **presence of the prop** (not `??`, which
would fall back when extraction legitimately passes an empty array):

```typescript
const coordList = evaluateAllCoords != null ? evaluateAllCoords : [...summary.divergentCoords];
```

Render each coord via `CoordRow`; for an agreed coord (not in `summary.divergentCoords`)
render it collapsed/checkmarked, pre-selected to `unwrap(summary.decisionsByCoord.get(coord)?.[0]?.value)`.
Keep the existing per-coord `onSelectExisting`/`onManualOverride` for diverging coords.
Guard both finalize buttons (fast-path L343-383 and divergent L402-416) behind
`showFinalize !== false`. QA passes neither prop → falls back to divergent-only with its
finalize button intact (unchanged).

- [ ] **Step 4: Copy keys**

In `frontend/lib/copy/consensus.ts` add: `panelAgreedBadge: 'Agreed'`,
`panelEvaluateAllTitle: 'Review every field'`, and a ready-hint string used in the header,
e.g. in `frontend/lib/copy/extraction.ts`: `runHeaderReadyHint: '{{ready}} of {{total}} ready'`.

- [ ] **Step 5: Wire extraction call site + ready hint**

Build the full coord list explicitly (not from decision-touched coords only): for each
`runDetail.instances`, look up `runDetail.entity_types.find(et => et.id === instance.entity_type_id)`
and emit `` `${instance.id}::${field.id}` `` for **every** `field` in that entity type. Build a
real label map from the same source (`entityType.label · field.label`) — do NOT reuse the
decision-derived `fieldLabelByCoord` (it only covers decided coords and uses an id slice).
Pass `evaluateAllCoords={allCoords}`, `fieldLabelByCoord={fullLabelMap}`, `showFinalize={false}`
to `ConsensusPanel`.

For the **N/M ready hint** in the header: `RunHeaderValue.reviewers` is typed
`{count, required, divergent}` (`RunHeaderContext.tsx:26`) with no ready slot, and
`Reviewers.tsx` renders only avatars/divergence. So: (a) extend `RunHeaderValue.reviewers`
with optional `ready?: number` + `readyTotal?: number`; (b) render the hint in `Reviewers.tsx`
only when present **and** `stage === 'extract'`; (c) populate it from
`reviewerSummary.readyCount`/`reviewerCount` where `ExtractionHeader` builds the header value
(L249-262); (d) confirm QA's header-value construction
(`QualityAssessmentFullScreen.tsx` ~L553-557) still typechecks (the new fields are optional,
so QA may omit them). Add a `Reviewers.test` case asserting the hint renders only in extract
with the fields present.

- [ ] **Step 6: Tests (extraction evaluate-all + QA regression)**

Update `frontend/test/ConsensusPanel.test.tsx`: (a) with `evaluateAllCoords` an agreed coord
renders pre-selected and no in-panel finalize button (extraction); (b) without the prop,
QA's divergent-only + finalize button still render. Run:
`npm run test:run -- frontend/test/ConsensusPanel.test.tsx frontend/test/useReviewerSummary.test.ts`.
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`. Then:

```bash
git add frontend/components/runs/ConsensusPanel.tsx frontend/hooks/runs/useReviewerSummary.ts \
  frontend/pages/ExtractionFullScreen.tsx frontend/lib/copy/ frontend/test/
git commit -m "feat(extraction): evaluate-all consensus surface + N/M ready hint (QA unchanged)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: ADR-0015 + architecture doc + markdownlintignore + full gate

**Files:**
- Create: `docs/adr/0015-finalize-via-approve-publish.md`
- Modify: `docs/adr/0009-extraction-finalize-completeness-gate.md` (frontmatter)
- Modify: `docs/reference/extraction-hitl-architecture.md`
- Modify: `.markdownlintignore`

**Interfaces:** docs only; closes spec §9.

- [ ] **Step 1: ADR-0015**

Create `docs/adr/0015-finalize-via-approve-publish.md` with frontmatter
(`status: accepted`, `last_reviewed: 2026-06-21`, `owner: '@raphaelfh'`,
`adr_number: '0015'`). Body (MADR shape): finalize is now reached via an atomic
approve-and-finalize that publishes every agreed coord and then advances, so
`EmptyFinalizeError` + `IncompleteFinalizeError` (ADR-0009) remain as **invariants** but are
always satisfiable — the no-divergence dead-end is retired. Record the per-reviewer ready
flag (advisory, no quorum gate), and the run-scoped consensus auto-reveal for arbitrators.
State it **supersedes ADR-0009** (the no-divergence dead-end), keeping the completeness gate.

- [ ] **Step 2: Supersede ADR-0009**

Set ADR-0009 frontmatter `status: superseded` and add `superseded_by: '0015'`.

- [ ] **Step 3: Architecture doc**

In `docs/reference/extraction-hitl-architecture.md`:
- §2.2 — rewrite the "primary action" paragraph: **Mark ready** (per-reviewer, no advance) /
  **Open consensus** (manager, advances) / **Approve & finalize** (manager, consensus).
- §"Stage advance (extraction)" (~L442-453) — the user advances `EXTRACT → CONSENSUS` via
  **Open consensus** (manager); "Mark ready" is the advisory per-reviewer signal; finalize is
  the atomic approve-and-finalize.
- Finalize-gates glossary (ConsensusRule entry ~L416-420) — note finalize is reached via
  approve-publish; gates unchanged as invariants.
- Add the auto-reveal note: a manager (arbitrator) is auto-revealed run-scoped on consensus
  entry (mirrors the finalized reveal); `RunViewResponse.peers_revealed` carries the effective
  unblind.
- Migration-head line — already `0029_reviewer_ready_flag` (Task 1).

- [ ] **Step 4: markdownlintignore**

Append `docs/superpowers/plans/2026-06-21-hitl-phase2-consensus-finalize.md` to
`.markdownlintignore` (in-flight plan snapshot, matching how Phase-1's plan is listed).

- [ ] **Step 5: Full gate**

Run: `make test-backend` (once; never concurrent) and `make quality-scan` (lint + typecheck
+ frontend tests + fitness + docs-ci). Fix any straggler. Verify
`bash scripts/docs/check-frontmatter.sh` passes for the new ADR + plan.

- [ ] **Step 6: Commit + open PR**

```bash
git add docs/ .markdownlintignore
git commit -m "docs(extraction): ADR-0015 finalize-via-approve-publish + arch doc (HITL Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Open a PR targeting `dev` (squash-merge), body summarizing the four deliverables + the
resolved design decisions D1–D8.

---

## Self-Review

**Spec coverage (§ → task):**
- §4.2 Mark ready / consensus entry → Tasks 1, 2 (ready flag + endpoint + hint), 6, 7
  (header Mark ready / Open consensus).
- §4.3 Finalize = one action → Tasks 4 (`approve_and_finalize`), 6, 7 (Approve & finalize).
- §6 data model (ready marker) → Task 1 (dedicated table, D1).
- §7 backend touch points → Tasks 2, 3, 4.
- §8 frontend touch points → Tasks 5, 6, 7, 8.
- §9 docs/ADRs → Task 9.
- Spec I2 (clean-run dead-end) → Task 4 (test
  `test_approve_and_finalize_publishes_agreed_and_finalizes`).
- Spec I3 (blind manager in consensus) → Task 3.
- Spec I6 (two finalize buttons) → Tasks 6, 7 (single `buildExtractionTransition` action) +
  Task 8 (`showFinalize=false` for extraction).
- Brief "stop writing instance.status" → Task 7 (D7).
- Brief "QA must keep publish-then-advance" → Tasks 4 (QA consensus-only path untouched), 8
  (QA omits `evaluateAllCoords`/`showFinalize`, D8).

**Placeholder scan:** the coord-value resolver (Task 4 Step 3) is described as an adaptation
of the named `_filled_coords` query (lines cited) — not a placeholder; the join + grouping
rule is specified. The `build_run_view` ready-field wiring (Task 2 Step 4) is "adjust to the
constructor shape" — flagged because the exact constructor form must be read at edit time;
the values to set are exact.

**Type consistency:** `ExtractionReviewerReady` (model) ↔ `extraction_reviewer_ready` (table)
↔ `ExtractionReviewerReadyRepository` ↔ `ExtractionReviewerReadyService`. `MarkReadyRequest
{ready}` ↔ FE `useMarkReady({ready})`. `RunReadyStateResponse {ready_count, reviewer_count,
reviewers_ready}` ↔ `RunViewResponse` same three; `peers_revealed` on **`RunDetailResponse`**
(inherited by `RunViewResponse`). `approve_and_finalize` (service) ↔ `POST /approve-finalize`
↔ `useApproveFinalize`. `buildExtractionTransition` args `{onMarkReady, onOpenConsensus,
onApproveFinalize, divergencesResolved, isReady}` ↔ the handlers + computed inputs in
`ExtractionFullScreen`. Migration revision `0029_reviewer_ready_flag` (24 chars ≤ 32),
`down_revision = "0028_run_stage_extract"`. The hand-mirrored `frontend/hooks/runs/types.ts`
carries all four new fields (not just generated `schema.d.ts`).

**Adversarial review incorporated (2026-06-21):** a 3-lens review (spec fidelity / backend /
frontend) against the real code fixed, in this plan: the inert completeness-gate test (now
uses the frozen-snapshot setup), the missing `updated_at` column (schema drift), the
nonexistent `self._load_run_for_update` (→ module-level `load_run_for_update`), `peers_revealed`
drift (→ set from the single `unblinded` local on `RunDetailResponse`), hand-mirrored type
gaps in `types.ts`, the orphaned `handleFinalizeFromConsensus` (→ replaced by
`handleApproveFinalize`), the 9-case `stageTransition.test.ts` churn + manager-in-extract flip,
the duplicated `max()` M-rule (→ single `ready_summary_from`), the viewer-can-mark-ready gap
(→ reviewer-role gate), the QA `/approve-finalize` exposure (→ kind guard), the compare-gate
`size>0`/`||` fix, and the manual-reveal-in-consensus suppression.

**Open risks (verify at edit time — line numbers/shapes only):**
1. The `build_run_view` constructor (Task 2 Step 4) — read its exact existing kwargs before
   adding the four new ones; the new kwargs are exact, the surrounding call is not.
2. `ExtractionHeader.tsx`'s prop interface (Task 7 Step 5) — confirm `onFinalize` is not a
   required prop and that no legacy in-header finalize button remains after unwiring.
3. The reopen handler's copy keys (Task 7 Step 3) — confirm whether `pages`/`qa` already have
   reopen success/error keys to reuse before adding new ones.

---

## Execution sequencing

Backend first (Tasks 1→4: each ships green independently — model, ready endpoint, auto-reveal,
approve-finalize), then the FE (Task 5 regen+hooks, Task 6+7 header/page together so the tree
typechecks, Task 8 panel), then docs + the full gate (Task 9). Run the backend suite **once**
per checkpoint (never concurrent). Land FE typecheck-green before requesting merge.
