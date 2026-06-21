---
status: draft
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

# HITL Phase 1 — Collapse `proposal`+`review` into `extract` (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two DB stages `proposal` + `review` with a single `extract`
stage, so the run lifecycle is `pending → extract → consensus → finalized`, with
human writes going straight to `ReviewerDecision`s in `extract` (as they already
do in `review`).

**Architecture:** The `proposal→review` split + `useAutoAdvanceToReview` +
boundary materialization existed only to let the form write per-user decisions
*immediately* after a transient `proposal` window. We delete that machinery and
start runs in `extract`, where `record_decision` is allowed — decisions exist
live, so the counter/progress stay correct. No consensus/finalize behaviour
changes (that is Phase 2). No per-reviewer "ready" flag yet (Phase 2).

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2.0 async / Alembic / pytest
(backend); TypeScript / React 19 / Vitest (frontend). Spec:
`docs/superpowers/specs/2026-06-21-hitl-lifecycle-alignment-design.md`.

## Global Constraints

- **English only** for code, comments, commits, docs.
- **SQLAlchemy model change ⇒ Alembic migration.** Revision id **≤ 32 chars**
  (`alembic_version.version_num` is varchar(32)). Run from `backend/`.
- Migration touching `extraction_*` ⇒ bump the migration-head line + `last_reviewed`
  in `docs/reference/extraction-hitl-architecture.md`.
- Layering: `api → services → repositories → models`. Endpoints never touch the DB.
- Frontend: backend calls go through `frontend/integrations/api/client.ts`; no new
  `supabase.from(...)`. Generated types (`frontend/types/api/schema.d.ts`,
  `frontend/integrations/supabase/types.ts`) are **never hand-edited** — regenerate.
- Run backend tests with `make test-backend`; frontend with `npm run test:run`
  (from repo root). Typecheck: `npm run typecheck`. Backend lint: `make lint-backend`.
- Commit per task (conventional commits). End commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Add the `extract` enum value + Alembic migration

**Files:**
- Modify: `backend/app/models/extraction.py:89-97` (the `ExtractionRunStage` enum)
- Create: `backend/alembic/versions/0028_run_stage_extract.py`
- Test: `backend/tests/integration/test_run_lifecycle_service.py` (new test)

**Interfaces:**
- Produces: `ExtractionRunStage.EXTRACT = "extract"`; the Postgres
  `extraction_run_stage` type now has values
  `pending, extract, consensus, finalized, cancelled` (no `proposal`/`review`).

- [ ] **Step 1: Edit the SQLAlchemy enum**

In `backend/app/models/extraction.py`, replace lines 89-97:

```python
class ExtractionRunStage(str, PyEnum):
    """Stage of the extraction execution (HITL lifecycle)."""

    PENDING = "pending"
    EXTRACT = "extract"
    CONSENSUS = "consensus"
    FINALIZED = "finalized"
    CANCELLED = "cancelled"
```

- [ ] **Step 2: Write the migration**

Create `backend/alembic/versions/0028_run_stage_extract.py` (revision id is 25
chars, ≤32). It follows the established rename→create→CASE-convert→drop pattern
(see archived `20260427_0014_run_stage_enum_migration.py`):

```python
"""Collapse extraction_run_stage proposal+review into extract

Revision ID: 0028_run_stage_extract
Revises: 0027_api_key_llama_cloud
Create Date: 2026-06-21

HITL lifecycle alignment Phase 1 (spec 2026-06-21): the run lifecycle becomes
pending -> extract -> consensus -> finalized. `proposal` and `review` collapse
into a single `extract` value (existing rows in either map to `extract`). No DB
CHECK/trigger/RLS references proposal/review (only the `finalized` literal), so
this is an enum-only change.
"""

from alembic import op

revision = "0028_run_stage_extract"
down_revision = "0027_api_key_llama_cloud"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_old;")
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'pending', 'extract', 'consensus', 'finalized', 'cancelled'
        );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage DROP DEFAULT;")
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ALTER COLUMN stage TYPE public.extraction_run_stage
            USING (
                CASE stage::text
                    WHEN 'proposal' THEN 'extract'
                    WHEN 'review' THEN 'extract'
                    WHEN 'consensus' THEN 'consensus'
                    WHEN 'finalized' THEN 'finalized'
                    WHEN 'cancelled' THEN 'cancelled'
                    ELSE 'pending'
                END::public.extraction_run_stage
            );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'pending';")
    op.execute("DROP TYPE public.extraction_run_stage_old;")


def downgrade() -> None:
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_new;")
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled'
        );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage DROP DEFAULT;")
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ALTER COLUMN stage TYPE public.extraction_run_stage
            USING (
                CASE stage::text
                    WHEN 'extract' THEN 'review'
                    ELSE stage::text
                END::public.extraction_run_stage
            );
        """
    )
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'pending';")
    op.execute("DROP TYPE public.extraction_run_stage_new;")
```

- [ ] **Step 3: Apply + verify the migration offline**

Run (from `backend/`):
```bash
uv run alembic upgrade head --sql | grep -A2 extraction_run_stage | head
uv run alembic upgrade head
```
Expected: the SQL contains the new `CREATE TYPE ... 'extract'`; `upgrade head`
completes with no error and `alembic current` shows `0028_run_stage_extract`.

- [ ] **Step 4: Write the failing test**

Add to `backend/tests/integration/test_run_lifecycle_service.py`:

```python
async def test_enum_has_extract_not_proposal_review(db_session_real):
    rows = (
        await db_session_real.execute(
            sa.text(
                "SELECT unnest(enum_range(NULL::public.extraction_run_stage))::text AS v"
            )
        )
    ).scalars().all()
    assert "extract" in rows
    assert "proposal" not in rows
    assert "review" not in rows
```

- [ ] **Step 5: Run the test**

Run: `make test-backend PYTEST_ARGS="-k test_enum_has_extract_not_proposal_review -v"`
Expected: PASS (migration applied by the autouse fixture).

- [ ] **Step 6: Bump the doc head + commit**

In `docs/reference/extraction-hitl-architecture.md` update the "Migration head:"
line (§3) to `0028_run_stage_extract` and `last_reviewed` to `2026-06-21`.

```bash
git add backend/app/models/extraction.py backend/alembic/versions/0028_run_stage_extract.py \
  backend/tests/integration/test_run_lifecycle_service.py docs/reference/extraction-hitl-architecture.md
git commit -m "feat(extraction): collapse run-stage enum proposal+review into extract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Lifecycle transitions + create/reopen/park land in `extract`

**Files:**
- Modify: `backend/app/services/run_lifecycle_service.py` (`_ALLOWED_TRANSITIONS`
  80-99; `create_run` initial stage; `reopen_run` 593)
- Modify: `backend/app/services/hitl_session_service.py:433` (park PENDING→EXTRACT)
- Test: `backend/tests/integration/test_run_lifecycle_service.py`

**Interfaces:**
- Consumes: `ExtractionRunStage.EXTRACT` (Task 1).
- Produces: transitions `PENDING→{EXTRACT,CANCELLED}`, `EXTRACT→{CONSENSUS,CANCELLED}`,
  `CONSENSUS→{FINALIZED,CANCELLED}`; reopen lands a child run in `EXTRACT`.

- [ ] **Step 1: Write the failing test**

```python
async def test_pending_extract_consensus_finalized_path(db_session_real, seed_run_pending):
    svc = RunLifecycleService(db_session_real)
    run = await svc.advance_stage(run_id=seed_run_pending.id, target_stage="extract", user_id=USER)
    assert run.stage == ExtractionRunStage.EXTRACT.value
    # extract cannot skip to finalized
    with pytest.raises(InvalidStageTransitionError):
        await svc.advance_stage(run_id=run.id, target_stage="finalized", user_id=USER)
```

- [ ] **Step 2: Run it to confirm failure**

Run: `make test-backend PYTEST_ARGS="-k test_pending_extract_consensus_finalized_path -v"`
Expected: FAIL — current matrix has no `pending→extract`.

- [ ] **Step 3: Update the transitions matrix**

In `run_lifecycle_service.py` replace `_ALLOWED_TRANSITIONS` (lines 80-99):

```python
# Allowed transitions: from -> set of valid target stages
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    ExtractionRunStage.PENDING.value: {
        ExtractionRunStage.EXTRACT.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.EXTRACT.value: {
        ExtractionRunStage.CONSENSUS.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.CONSENSUS.value: {
        ExtractionRunStage.FINALIZED.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.FINALIZED.value: set(),  # terminal
    ExtractionRunStage.CANCELLED.value: set(),  # terminal
}
```

- [ ] **Step 4: Update reopen + session-park stages**

In `run_lifecycle_service.py:593`, change the reopened run's stage:
```python
        # Land the child run in EXTRACT so the form can immediately record decisions.
        new_run.stage = ExtractionRunStage.EXTRACT.value
```
In `hitl_session_service.py:433`, change the park target:
```python
        if run.stage == ExtractionRunStage.PENDING.value:
            run = await self._lifecycle.advance_stage(
                run_id=run.id,
                target_stage=ExtractionRunStage.EXTRACT,
                user_id=user_id,
            )
```

- [ ] **Step 5: Run the test**

Run: `make test-backend PYTEST_ARGS="-k test_pending_extract_consensus_finalized_path -v"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/run_lifecycle_service.py backend/app/services/hitl_session_service.py \
  backend/tests/integration/test_run_lifecycle_service.py
git commit -m "feat(extraction): lifecycle pending->extract->consensus->finalized

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Allow `record_decision` in `extract`; delete the boundary materialization

**Files:**
- Modify: `backend/app/services/extraction_review_service.py:54` (stage gate)
- Modify: `backend/app/services/run_lifecycle_service.py:254-262` (delete the
  `target == REVIEW` materialization call) and remove the now-unused
  `_materialize_human_decisions` method (267-368)
- Test: `backend/tests/integration/test_extraction_review_service.py`

**Interfaces:**
- Consumes: `EXTRACT` stage (Task 1), transitions (Task 2).
- Produces: `record_decision` accepts runs in `extract`; no stage-edge
  materialization remains.

- [ ] **Step 1: Write the failing test**

```python
async def test_record_decision_allowed_in_extract(db_session_real, seed_run_extract):
    svc = ExtractionReviewService(db_session_real)
    d = await svc.record_decision(
        run_id=seed_run_extract.id, instance_id=INST, field_id=FLD, reviewer_id=USER,
        decision="edit", value={"value": "x"},
    )
    assert d.value == {"value": "x"}
```

- [ ] **Step 2: Run it to confirm failure**

Run: `make test-backend PYTEST_ARGS="-k test_record_decision_allowed_in_extract -v"`
Expected: FAIL — `InvalidDecisionError ... not 'review'`.

- [ ] **Step 3: Relax the stage gate**

In `extraction_review_service.py:54`, replace the check:
```python
        if run.stage != ExtractionRunStage.EXTRACT.value:
            raise InvalidDecisionError(
                f"Cannot record decision: run stage is {run.stage}, not 'extract'"
            )
```

- [ ] **Step 4: Delete the boundary materialization**

In `run_lifecycle_service.py`, delete lines 254-262 (the
`if target == ExtractionRunStage.REVIEW.value: await self._materialize_human_decisions(run_id)`
block and its comment), and delete the `_materialize_human_decisions` method
(267-368) entirely. Then remove now-unused imports it pulled in
(`ExtractionProposalRecord`, `ExtractionProposalSource`, `ExtractionReviewerState`,
`pg_insert`) **only if** no other code in the file references them — verify with
`grep -n "ExtractionReviewerState\|pg_insert\|ExtractionProposalSource" backend/app/services/run_lifecycle_service.py`
and drop the dead imports atomically with the deletion (per the ruff-hook rule).

- [ ] **Step 5: Run review + lifecycle tests**

Run: `make test-backend PYTEST_ARGS="-k (extraction_review or run_lifecycle) -v"`
Expected: PASS. Remove/repoint any test asserting REVIEW-boundary materialization
(grep `_materialize_human_decisions` in `backend/tests`); decisions are now
written directly, so such tests are obsolete — delete them.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/extraction_review_service.py backend/app/services/run_lifecycle_service.py backend/tests/
git commit -m "feat(extraction): write decisions directly in extract; drop boundary materialization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Allow AI/system proposals in `extract`

**Files:**
- Modify: `backend/app/services/extraction_proposal_service.py:66-79` (allowed stages)
- Modify: `backend/app/services/section_extraction_service.py:171-173, 356-357`
  ("AI extraction requires PROPOSAL")
- Test: `backend/tests/integration/test_section_extraction_service.py`,
  `test_extraction_proposal_service.py`

**Interfaces:**
- Consumes: `EXTRACT` stage (Task 1).
- Produces: AI/system proposals accepted in `extract`; human proposals for
  `kind='extraction'` remain rejected (the blind-review write gate is preserved —
  humans write decisions via `/decisions`, Task 3).

- [ ] **Step 1: Write the failing test**

```python
async def test_ai_extraction_runs_in_extract(db_session_real, seed_run_extract):
    svc = SectionExtractionService(db_session_real, llm=FakeLLM())
    out = await svc.extract_section(run_id=seed_run_extract.id, entity_type_id=ET, manage_lifecycle=False)
    assert out.proposals_created >= 0  # no stage error raised
```

- [ ] **Step 2: Run it to confirm failure**

Run: `make test-backend PYTEST_ARGS="-k test_ai_extraction_runs_in_extract -v"`
Expected: FAIL — `AI extraction requires PROPOSAL`.

- [ ] **Step 3: Relax the proposal-service gate**

In `extraction_proposal_service.py`, replace lines 66-67:
```python
        if source_value == "ai" or run.kind == "extraction":
            allowed_stages = {ExtractionRunStage.EXTRACT.value}
        else:
            allowed_stages = {ExtractionRunStage.EXTRACT.value}
```
(Both branches now allow only `extract`; the `human` + `extraction` rejection in
the error message below still holds — update the message text to say `extract`.)
Update the error message string `"For kind='extraction', writes at REVIEW ..."`
to `"... writes at EXTRACT must go through /decisions ..."`.

- [ ] **Step 4: Relax the section-extraction gates**

In `section_extraction_service.py:171` and `:356`, replace
`ExtractionRunStage.PROPOSAL.value` with `ExtractionRunStage.EXTRACT.value` and the
message `"requires PROPOSAL"` with `"requires EXTRACT"` (both sites).

- [ ] **Step 5: Run the tests**

Run: `make test-backend PYTEST_ARGS="-k (section_extraction or extraction_proposal) -v"`
Expected: PASS. Update any test asserting `requires PROPOSAL` to `requires EXTRACT`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/extraction_proposal_service.py backend/app/services/section_extraction_service.py backend/tests/
git commit -m "feat(extraction): accept AI/system proposals in extract stage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Collapse backend stage *lists* (read/export/active-set) to `extract`

**Files:**
- Modify: `backend/app/services/hitl_session_service.py:393-400` (active-set)
- Modify: `backend/app/services/extraction_run_read_service.py:305-314`
  (`_CURRENT_VALUE_STAGES`) and `:460-465` (`_ACTIVE_STAGES`)
- Modify: `backend/app/services/extraction_export_service.py:2074-2079`
  (`_ACTIVE_EXPORT_RUN_STAGES`) and `:1355-1362` (all-users omit filter)
- Test: `backend/tests/integration/test_extraction_run_read_service.py`

**Interfaces:**
- Consumes: `EXTRACT` (Task 1).
- Produces: every "active stages" set is `{PENDING, EXTRACT, CONSENSUS}`;
  `_CURRENT_VALUE_STAGES` is `{EXTRACT, CONSENSUS, FINALIZED}`.

- [ ] **Step 1: Write the failing test**

```python
async def test_active_run_resolution_finds_extract_run(db_session_real, seed_run_extract):
    svc = ExtractionRunReadService(db_session_real)
    found = await svc.find_active_run(article_id=ART, template_id=TPL, kind="extraction")
    assert found is not None and found.stage == ExtractionRunStage.EXTRACT.value
```

- [ ] **Step 2: Run it to confirm failure**

Run: `make test-backend PYTEST_ARGS="-k test_active_run_resolution_finds_extract_run -v"`
Expected: FAIL — `_ACTIVE_STAGES` still lists `proposal`/`review`, not `extract`.

- [ ] **Step 3: Edit the five stage lists**

`hitl_session_service.py:394-399` →
```python
                ExtractionRun.stage.in_(
                    [
                        ExtractionRunStage.PENDING.value,
                        ExtractionRunStage.EXTRACT.value,
                        ExtractionRunStage.CONSENSUS.value,
                    ]
                ),
```
`extraction_run_read_service.py:308-313` (`_CURRENT_VALUE_STAGES`) →
```python
_CURRENT_VALUE_STAGES = frozenset(
    {
        ExtractionRunStage.EXTRACT.value,
        ExtractionRunStage.CONSENSUS.value,
        ExtractionRunStage.FINALIZED.value,
    }
)
```
`extraction_run_read_service.py:460-465` (`_ACTIVE_STAGES`) →
```python
_ACTIVE_STAGES = (
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.EXTRACT.value,
    ExtractionRunStage.CONSENSUS.value,
)
```
`extraction_export_service.py:2074-2079` (`_ACTIVE_EXPORT_RUN_STAGES`) → same three
values (`PENDING, EXTRACT, CONSENSUS`).
`extraction_export_service.py:1358` (all-users omit filter) — replace
`ExtractionRunStage.PROPOSAL.value` with `ExtractionRunStage.EXTRACT.value` (the
all-users export now omits pre-consensus `extract` runs, which still have no
cross-reviewer activity worth exporting — correct).

- [ ] **Step 4: Run the tests**

Run: `make test-backend PYTEST_ARGS="-k (run_read or export) -v"`
Expected: PASS. Repoint any test enumerating `proposal`/`review` to `extract`.

- [ ] **Step 5: Full backend suite (catch stragglers)**

Run: `make test-backend`
Expected: green. Any residual failure naming `proposal`/`review` is a missed
stage reference — fix it in the failing service and re-run.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ backend/tests/
git commit -m "feat(extraction): collapse backend stage lists to extract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Frontend stage type + the stage-branching code

**Files:**
- Modify: `frontend/types/ai-extraction.ts:14-20` (union)
- Modify: `frontend/components/runs/header/stage.ts` (docstring/comments)
- Modify: `frontend/lib/extraction/stageTransition.ts:48` (`proposal||review`→`extract`)
- Modify: `frontend/lib/qa/qaTransition.ts:34` (`proposal||review`→`extract`)
- Modify: `frontend/components/runs/header/Reviewers.tsx:10` (`proposal`→`extract`)
- Modify: `frontend/hooks/extraction/useExtractedValues.ts` (`proposal`→`extract`)
- Modify: `frontend/hooks/runs/useAutoSaveProposals.ts:109-112` + the `'review'`
  branch (route `extract`+extraction → `/decisions`)
- Test: `frontend/test/stageTransition.test.ts`,
  `frontend/components/runs/header/__tests__/stage.test.ts`

**Interfaces:**
- Consumes: nothing (pure FE).
- Produces: `ExtractionRunStage = 'pending'|'extract'|'consensus'|'finalized'|'cancelled'`.

- [ ] **Step 1: Update the failing tests first (TDD)**

In `frontend/test/stageTransition.test.ts`, merge the two `proposal`/`review`
tests into one `extract` test, and change the gated test's `stage: 'review'` →
`'extract'` (full code in the spec's gather; the `to`/`label`/`gate` assertions
are unchanged). In `frontend/components/runs/header/__tests__/stage.test.ts`,
change the "maps proposal AND review" test to a single `stageNodeStates('extract')`
assertion expecting `[['extract','current'],['consensus','future'],['finalized','future']]`.

- [ ] **Step 2: Run them to confirm failure**

Run: `npm run test:run -- frontend/test/stageTransition.test.ts frontend/components/runs/header/__tests__/stage.test.ts`
Expected: FAIL — `'extract'` not yet a member of the union / not handled.

- [ ] **Step 3: Collapse the union**

`frontend/types/ai-extraction.ts:14-20`:
```typescript
export type ExtractionRunStage =
  | 'pending'
  | 'extract'
  | 'consensus'
  | 'finalized'
  | 'cancelled';
```

- [ ] **Step 4: Update the branching sites**

- `stageTransition.ts:48`: `if (stage === 'extract') {` (drop `'proposal' || 'review'`);
  update the comment to drop the proposal/review wording.
- `qaTransition.ts:34`: `if (stage === 'extract') {`.
- `Reviewers.tsx:10`: `if (stage === 'extract' || stage == null || reviewers.count === 0) return null;`.
- `stage.ts`: update the docstring + the `uiIndex` comment to reference `extract`
  (the `default → 0` branch already maps any non-consensus/finalized stage to the
  Extract node, so no logic change).
- `useExtractedValues.ts`: set `REVIEWER_STATE_STAGES = new Set(['extract', 'consensus', 'finalized'])`
  and remove the separate `stage === 'proposal'` branch (its logic merges into the
  reviewer-state path now that humans write decisions in `extract`). **Verify**
  this hook's tests still pass; if the `proposal` branch carried blind-leak
  handling, keep that handling under the `extract` reviewer-state path.
- `useAutoSaveProposals.ts:109-112`: `const WRITABLE_STAGES = new Set(['extract']);`
  and in the stage branch route `extract` (for `kind='extraction'`) to
  `/decisions` with `decision='edit'` (the path the `'review'` branch used);
  keep QA's `/proposals` path for `kind='quality_assessment'`.

- [ ] **Step 5: Run FE tests + typecheck**

Run: `npm run typecheck && npm run test:run -- frontend/test/stageTransition.test.ts frontend/components/runs/header/__tests__/stage.test.ts frontend/hooks`
Expected: PASS, typecheck clean. Grep for stragglers:
`grep -rn "'proposal'\|'review'" frontend --include=*.ts --include=*.tsx | grep -v "integrations/supabase/types\|test\|tabReview\|peerReview"` — fix any real stage reference.

- [ ] **Step 6: Commit**

```bash
git add frontend/types/ai-extraction.ts frontend/components/runs/header/ frontend/lib/ frontend/hooks/ frontend/test/
git commit -m "feat(extraction): collapse frontend run-stage to extract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Delete `useAutoAdvanceToReview` + its wiring

**Files:**
- Delete: `frontend/hooks/extraction/useAutoAdvanceToReview.ts`
- Delete: `frontend/test/hooks/useAutoAdvanceToReview.test.tsx`
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (import 46; call 396-401;
  autosave-enable gate 366; comment 204-205)

**Interfaces:**
- Consumes: the collapsed stage (Task 6).
- Produces: no auto-advance; the run sits in `extract` until the user advances.

- [ ] **Step 1: Delete the hook + its test**

```bash
git rm frontend/hooks/extraction/useAutoAdvanceToReview.ts frontend/test/hooks/useAutoAdvanceToReview.test.tsx
```

- [ ] **Step 2: Remove the wiring from ExtractionFullScreen**

- Delete the import at line 46.
- Delete the `useAutoAdvanceToReview({...})` call (lines 396-401) and, if
  `ensureReviewStage`/`hasProposals` become unused after this, delete them too
  (grep to confirm before deleting).
- Line 366 autosave gate: change `(stage === 'proposal' || stage === 'review')`
  to `(stage === 'extract')`.
- Update the reopen comment (204-205) to say "fresh EXTRACT-stage run".

- [ ] **Step 3: Typecheck + render test**

Run: `npm run typecheck && npm run test:run -- frontend/test/extractionReveal.test.tsx`
Expected: clean + PASS (no dangling references to the deleted hook).

- [ ] **Step 4: Commit**

```bash
git add frontend/pages/ExtractionFullScreen.tsx
git commit -m "feat(extraction): delete useAutoAdvanceToReview (no proposal->review edge)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Regenerate generated types + ADR + doc, full verification

**Files:**
- Regenerate: `frontend/types/api/{openapi.json,schema.d.ts}`,
  `frontend/integrations/supabase/types.ts`
- Create: `docs/adr/0013-collapse-extract-stage.md` (supersedes ADR-0010)
- Modify: `docs/reference/extraction-hitl-architecture.md` (§2.2 stage table,
  §"Stage advance", glossary), `docs/adr/0010-...md` frontmatter
  (`superseded_by`), `.markdownlintignore` (add the plan path)

**Interfaces:**
- Consumes: the backend enum change (Task 1) — the generated types must reflect it.

- [ ] **Step 1: Regenerate API + Supabase types**

Run: `npm run generate:api-types` (regenerates from the FastAPI app). For the
Supabase enum, regenerate `frontend/integrations/supabase/types.ts` via the
project's generator (`make` target or `supabase gen types`); confirm
`extraction_run_stage` now lists `extract` and not `proposal`/`review`.

- [ ] **Step 2: Write the ADR**

Create `docs/adr/0013-collapse-extract-stage.md` with frontmatter
(`status: accepted`, `last_reviewed: 2026-06-21`, `owner: '@raphaelfh'`,
`supersedes: '0010'`). Body: state that the `proposal/review` split was an
artifact of enabling immediate per-user decision writes; the unified `extract`
stage allows `record_decision` directly, so the auto-advance + materialization are
deleted; reference the spec. In `docs/adr/0010-...md` frontmatter, set
`superseded_by: '0013'` and `status: superseded`.

- [ ] **Step 3: Update the architecture doc**

In `docs/reference/extraction-hitl-architecture.md`: §2.2 stage table → three DB
stages mapping (`Extract → extract`, `Consensus → consensus`, `Finalized →
finalized`); update §"Stage advance (extraction)" to describe the single `extract`
stage (no auto-advance, decisions written directly); update the
`pending → proposal → review → consensus → finalized` lifecycle strings to
`pending → extract → consensus → finalized`.

- [ ] **Step 4: Add the plan to `.markdownlintignore`**

Append one line: `docs/superpowers/plans/2026-06-21-hitl-phase1-stage-collapse.md`
(docs-ci plan-doc requirement — single source).

- [ ] **Step 5: Full gate**

Run: `make quality-scan` (lint + typecheck + tests + fitness) and `make test-backend`.
Expected: green. Fix any straggler stage reference surfaced here.

- [ ] **Step 6: Commit**

```bash
git add frontend/types/api/ frontend/integrations/supabase/types.ts docs/ .markdownlintignore
git commit -m "docs(extraction): ADR-0013 + arch doc + regenerated types for extract-stage collapse

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§ of the design spec → task):**
- §3.1 lifecycle `extract` → Tasks 1, 2. §4.1 decisions-in-extract → Task 3.
  §5 delete review/auto-advance/materialization → Tasks 3, 7. §6 enum migration +
  relaxed gates → Tasks 1, 3, 4, 5. §7 backend touch points → Tasks 2–5. §8
  frontend touch points → Tasks 6, 7. §9 ADR + doc → Task 8. ✅ All Phase-1 spec
  items map to a task. (Per-reviewer ready flag, consensus/finalize rework, and
  legacy-finalize deletion are explicitly Phase 2/3 — not in this plan.)

**Placeholder scan:** no "TBD"/"add error handling"/"similar to". The two
"verify with grep then delete dead imports/helpers" steps (Task 3 Step 4, Task 6
Step 4) are explicit verification instructions, not placeholders — the deletion
target and grep command are named.

**Type consistency:** `ExtractionRunStage.EXTRACT.value === "extract"` (backend)
and the `'extract'` union member (frontend) match. `_CURRENT_VALUE_STAGES`
includes `EXTRACT`; `_ACTIVE_STAGES`/`_ACTIVE_EXPORT_RUN_STAGES` are the same
`{PENDING, EXTRACT, CONSENSUS}` triple across files. Migration revision id
`0028_run_stage_extract` is 25 chars (≤32).

**Open risk (carry to execution):** `useExtractedValues.ts` merges the old
`proposal` read branch into the `extract` reviewer-state path — confirm the
blind-leak handling that lived in the `proposal` branch is preserved (Task 6 Step
4 flags this); if it was load-bearing, keep it under `extract`.
