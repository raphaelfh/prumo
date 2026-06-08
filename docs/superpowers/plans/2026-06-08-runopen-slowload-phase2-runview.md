---
status: in_progress
last_reviewed: 2026-06-08
owner: '@raphaelfh'
---

# Run-open slow-load — Phase 2 (RunView server-side collapse) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the serial waves that fire when `ExtractionFullScreen` opens a saved run (session → `useRun` → values) into a single server-composed `RunViewResponse`, embedded in the `POST /hitl/sessions` open response and served by a new read-only `GET /api/v1/runs/{id}/view`, so the run + values render from one round-trip. (The view also serves the frozen entity_types tree; folding the still-parallel entity_types/instances Supabase reads into it is the deferred Task 12.)

**Architecture:** Add a server read-side composer `build_run_view()` that **composes** (never re-queries) `get_run_with_workflow_history` (the item-3 blind filter stays the single source) plus two new pieces: the frozen template **entity_types tree** (read from the run's version snapshot, with a live-read fallback for legacy "narrow" snapshots) and the caller-scoped **current_values** (review/consensus/finalized only). (Seeded **instances** are part of the same read-model but are deferred to Task 12 — see the Task 3 scope note — because their only consumer needs a wider shape than Phase 2 would ship.) Two prerequisites guard correctness: the template-version snapshot is **lossy** today (omits `role`, `description`, and 8 field columns), so we first unify both snapshot builders behind one widened SQL fragment and backfill old snapshots; and the new `current_values` resolver becomes a 4th lockstep copy of the blind predicate, so it must reuse the exact `reviewer_id == caller` / `source_user_id == caller` scope. `POST /hitl/sessions` stays the **only** mutating entry point — no GET ever seeds.

**Tech Stack:** Backend: FastAPI, SQLAlchemy 2.0 async, Alembic (raw-SQL migrations), Pydantic v2, pytest integration tests against local Supabase. Frontend: React 18 + TS strict, TanStack Query, vitest. Branch `feat/runopen-slowload-phase2-runview` (based on `fix/extraction-stale-blind-progress`, which carries RLS `0025` + the item-3 blind filter). Verify with `cd backend && uv run pytest`, `make lint-backend`, `npm run typecheck`, `npx vitest run`, `npx eslint`.

---

## Background: invariants this plan must preserve

These are non-negotiable. Violating any one re-opens a documented incident class.

1. **Single mutating entry point.** `POST /hitl/sessions` (`HITLSessionService.open_or_resume`) is the only path that seeds instances + advances the run. **No GET ever seeds.** `build_run_view` and `GET /runs/{id}/view` are pure reads (`db.flush()`/no writes; no `db.commit()`).
2. **Blind filter in lockstep.** The predicate "a human row is visible iff the caller authored it, unless the run is `finalized` or the caller is an arbitrator (manager/consensus)" lives in 3 places today and **gains a 4th** with this plan:
   - `extraction_run_read_service.get_run_with_workflow_history` (service path) — `build_run_view` **composes** this, never re-queries the workflow tables.
   - `0025_reviewer_scoped_select_rls` RLS policies (PostgREST path) — unchanged.
   - `frontend/services/extractionValueService.loadValuesForUser` (current_values, review+) — this plan **replaces** it with…
   - …the new `resolve_caller_current_values` (server). It MUST use the same caller scope (`reviewer_id == caller_id`, `source_user_id == caller_id`).
3. **current_values only for `{review, consensus, finalized}`.** In `proposal`, values come from `proposals[]` via `pickLatestProposalPerCoord` (client). The server returns `current_values = []` for `proposal`/`pending`/`cancelled` — do **not** duplicate proposal resolution on the server.
4. **`computeRowProgress` stays pure/client.** No progress field on the server (`frontend/lib/extraction/progress.ts` is pure; a server field would fork the metric).
5. **Reviewer scoping on the embed.** The embedded `RunViewResponse` MUST be built with the **same** `current_user_sub` that opened the session, and `is_arbitrator` MUST be computed via `is_run_arbitrator(db, project_id, caller)` — never hardcoded `True`, or the embed leaks peers' human proposals.
6. **Behavior parity, not behavior change.** `resolve_caller_current_values` must be value-for-value identical to the `loadValuesForUser` it replaces (human-proposal base layer, reviewer-decision override, `reject` sentinel preserved). If a discrepancy surfaces (e.g. `accept_proposal` value sourcing), match the **current production** behavior; do not "fix" it here.

---

## File Structure

**Backend — new files**

- `backend/app/services/extraction_snapshot.py` — single source of truth for the template-version snapshot SQL (`build_template_version_snapshot`). Both snapshot builders import it so they can never drift again.
- `backend/alembic/versions/0026_widen_template_version_snapshot.py` — backfills legacy "narrow" snapshots to the widened shape.

**Backend — modified files**

- `backend/app/services/run_lifecycle_service.py` — `_snapshot_initial_version` (lines 465–557) delegates to `build_template_version_snapshot`.
- `backend/app/services/template_clone_service.py` — `_snapshot` (lines 477–524) delegates to `build_template_version_snapshot`.
- `backend/app/schemas/extraction_run.py` — add `RunViewField`, `RunViewEntityType`, `RunViewCurrentValue`, `RunViewResponse` (after `RunDetailResponse`, ~line 142). (`RunViewInstance` lands in Task 12.)
- `backend/app/services/extraction_run_read_service.py` — add `resolve_caller_current_values`, `_entity_types_for_run` (snapshot + live fallback), and `build_run_view` (composes `get_run_with_workflow_history`). (`_instances_for_run` lands in Task 12.)
- `backend/app/api/v1/endpoints/extraction_runs.py` — add `GET /{run_id}/view`.
- `backend/app/schemas/hitl_session.py` — add `run_view: RunViewResponse | None` to `OpenHITLSessionResponse`.
- `backend/app/api/v1/endpoints/hitl_sessions.py` — build + embed the run view (extraction only) between `open_or_resume` and `commit`.
- `backend/tests/integration/test_migration_roundtrip.py` — bump the head-pin assertion `0025_…` → `0026_…`.

**Frontend — modified files**

- `frontend/hooks/runs/types.ts` — add `RunViewFieldResponse`, `RunViewEntityType`, `RunViewCurrentValue`, `RunViewResponse` (extends `RunDetailResponse`). (`RunViewInstance` lands in Task 12.)
- `frontend/hooks/runs/useRun.ts` — re-point GET to `/api/v1/runs/${runId}/view`; return `RunViewResponse`.
- `frontend/hooks/extraction/useExtractionSession.ts` — add `run_detail` to `OpenResponse`; inject `useQueryClient`; seed `runsKeys.detail(run_id)` inside the generation guard.
- `frontend/hooks/qa/useQAAssessmentSession.ts` — mirror the optional `run_detail` field (QA ignores it).
- `frontend/services/extractionValueService.ts` — export `unwrapValue` (now consumed by the hook).
- `frontend/hooks/extraction/useExtractedValues.ts` — review/consensus/finalized branch consumes a `currentValues` prop (from the view) instead of calling `loadValuesForUser`; drop the now-unused `ExtractionValueService` import.
- `frontend/pages/ExtractionFullScreen.tsx` — pass `currentValues={runDetail?.current_values}` into `useExtractedValues` (Task 11). (Sourcing `entityTypes`/`instances` from the view is the deferred sub-phase — Task 12.)

**Frontend — deferred sub-phase (Task 12, not executed in Phase 2)**

- `frontend/hooks/extraction/useExtractionData.ts` — remove the direct Supabase reads of `extraction_entity_types` + `extraction_instances`. **Deferred** (off the critical serial path; carries a read-after-write hazard — see Task 12).
- `frontend/lib/extraction/runViewAdapters.ts` (new) — map the view's `entity_types`/`instances` onto the form's types. **Deferred** (Task 12).

---

## Phase A — Backend: widen the lossy snapshot (prerequisite)

Without this, reopening a run against an edited template renders wrong: the snapshot the view reads omits `role` (so `partitionEntityTypes` can't split study/model regions), `validation_schema`, `unit`, `allowed_units`, `allow_other`/`other_label`/`other_placeholder`, `llm_description`, and `description`.

### Task 1: One widened snapshot builder, shared by both services

There are **two** snapshot builders with drifted key sets (the clone builder already emits `role`; the lifecycle builder does not). Unify them behind one SQL fragment and widen it to the full column set.

**Files:**
- Create: `backend/app/services/extraction_snapshot.py`
- Modify: `backend/app/services/run_lifecycle_service.py` (`_snapshot_initial_version`, lines 465–557)
- Modify: `backend/app/services/template_clone_service.py` (`_snapshot`, lines 477–524)
- Test: `backend/tests/integration/test_template_version_snapshot_shape.py` (new)

- [ ] **Step 1: Write the failing test.** Create `backend/tests/integration/test_template_version_snapshot_shape.py`:

```python
"""The frozen template-version snapshot must carry every column the run-open
form renders from — role (study/model partition), plus the field columns that
drive units, validation, and the 'other' option. Both builders share one SQL
fragment so they can never drift again (role was once added to clone but not
lifecycle)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_snapshot import build_template_version_snapshot

_ENTITY_KEYS = {
    "id", "name", "label", "description", "parent_entity_type_id",
    "cardinality", "role", "sort_order", "is_required", "fields",
}
_FIELD_KEYS = {
    "id", "name", "label", "description", "field_type", "is_required",
    "validation_schema", "allowed_values", "unit", "allowed_units",
    "sort_order", "llm_description", "allow_other", "other_label",
    "other_placeholder",
}


@pytest.mark.asyncio
async def test_snapshot_carries_role_and_all_field_columns(
    db_session: AsyncSession,
) -> None:
    template_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    if template_id is None:
        pytest.skip("Seed graph incomplete")

    snapshot = await build_template_version_snapshot(db_session, template_id)
    entity_types = snapshot["entity_types"]
    assert entity_types, "expected a non-empty entity_types tree for a seeded template"

    for et in entity_types:
        assert _ENTITY_KEYS <= set(et.keys()), (
            f"entity_type missing keys: {_ENTITY_KEYS - set(et.keys())}"
        )
        assert et["role"] in ("study_section", "model_container", "model_section")
        for f in et["fields"]:
            assert _FIELD_KEYS <= set(f.keys()), (
                f"field missing keys: {_FIELD_KEYS - set(f.keys())}"
            )
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd backend && uv run pytest tests/integration/test_template_version_snapshot_shape.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.extraction_snapshot'`.

- [ ] **Step 3: Create the shared snapshot module.** Write `backend/app/services/extraction_snapshot.py`:

```python
"""Single source of truth for the template-version snapshot shape.

``RunLifecycleService._snapshot_initial_version`` and
``TemplateCloneService._snapshot`` both freeze the entity_types + fields tree
into ``extraction_template_versions.schema_``. They used to embed two copies of
the ``jsonb_build_object`` SQL that drifted — ``role`` was added to the clone
builder but not the lifecycle one (forcing migration 0017 to retro-patch).
This module owns the single, widened query so the two builders cannot diverge
again, and so migration 0026 can backfill old snapshots to the same shape.

The key set mirrors the data columns of ``ExtractionEntityType`` and
``ExtractionField`` that the run-open form renders from (FK/audit columns are
intentionally excluded — the form does not read them).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# WARNING: migration 0026_widen_template_version_snapshot embeds a copy of this
# key set for its one-time backfill. If you add a key here, update that
# migration's SQL too (migrations must stay self-contained; they cannot import
# app code that may change after they are committed).
SNAPSHOT_SQL = text(
    """
    SELECT jsonb_build_object(
        'entity_types', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', et.id,
                        'name', et.name,
                        'label', et.label,
                        'description', et.description,
                        'parent_entity_type_id', et.parent_entity_type_id,
                        'cardinality', et.cardinality,
                        'role', et.role,
                        'sort_order', et.sort_order,
                        'is_required', et.is_required,
                        'fields', COALESCE(
                            (
                                SELECT jsonb_agg(jsonb_build_object(
                                    'id', f.id,
                                    'name', f.name,
                                    'label', f.label,
                                    'description', f.description,
                                    'field_type', f.field_type,
                                    'is_required', f.is_required,
                                    'validation_schema', f.validation_schema,
                                    'allowed_values', f.allowed_values,
                                    'unit', f.unit,
                                    'allowed_units', f.allowed_units,
                                    'sort_order', f.sort_order,
                                    'llm_description', f.llm_description,
                                    'allow_other', f.allow_other,
                                    'other_label', f.other_label,
                                    'other_placeholder', f.other_placeholder
                                ) ORDER BY f.sort_order)
                                FROM public.extraction_fields f
                                WHERE f.entity_type_id = et.id
                            ),
                            '[]'::jsonb
                        )
                    ) ORDER BY et.sort_order
                )
                FROM public.extraction_entity_types et
                WHERE et.project_template_id = :tid
            ),
            '[]'::jsonb
        )
    )
    """
)


async def build_template_version_snapshot(
    db: AsyncSession, project_template_id: UUID
) -> dict[str, Any]:
    """Build the frozen ``{entity_types: [...]}`` snapshot for a project template."""
    row = await db.execute(SNAPSHOT_SQL, {"tid": str(project_template_id)})
    return row.scalar_one()
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd backend && uv run pytest tests/integration/test_template_version_snapshot_shape.py -v`
Expected: PASS.

- [ ] **Step 5: Delegate the lifecycle builder to the shared module.** In `backend/app/services/run_lifecycle_service.py`, replace the inline `text(""" SELECT jsonb_build_object( ... )""")` + `snapshot_row = await self.db.execute(...)` + `snapshot = snapshot_row.scalar_one()` block inside `_snapshot_initial_version` (lines ~474–501) with:

```python
        snapshot = await build_template_version_snapshot(
            self.db, project_template_id
        )
```

Add the import near the other service imports at the top of the file:

```python
from app.services.extraction_snapshot import build_template_version_snapshot
```

`text` was used **only** by the deleted snapshot block. Drop it from the lifecycle import line (`from sqlalchemy import func, select, text` → `from sqlalchemy import func, select`) or ruff F401 fails at Step 8.

- [ ] **Step 6: Delegate the clone builder to the shared module.** In `backend/app/services/template_clone_service.py`, replace the body of `_snapshot` (lines 477–524) with:

```python
    async def _snapshot(self, project_template_id: UUID) -> dict[str, Any]:
        return await build_template_version_snapshot(self.db, project_template_id)
```

Add the import near the top of the file (remove the now-unused local `from sqlalchemy import text` import inside `_snapshot` if it is no longer referenced elsewhere in the method):

```python
from app.services.extraction_snapshot import build_template_version_snapshot
```

- [ ] **Step 7: Verify the existing snapshot/lifecycle tests still pass.**

Run: `cd backend && uv run pytest tests/integration/test_template_versions_lifecycle.py tests/integration/test_run_lifecycle_concurrency.py tests/integration/test_template_version_snapshot_shape.py -v`
Expected: PASS (the upsert/race semantics in `_snapshot_initial_version` are untouched — only the snapshot-building SQL moved).

- [ ] **Step 8: Lint.**

Run: `cd backend && uv run ruff check app/services/extraction_snapshot.py app/services/run_lifecycle_service.py app/services/template_clone_service.py && uv run ruff format --check app/services/extraction_snapshot.py app/services/run_lifecycle_service.py app/services/template_clone_service.py`
Expected: clean (run `uv run ruff format` to fix formatting if needed).

- [ ] **Step 9: Commit.**

```bash
git add backend/app/services/extraction_snapshot.py \
        backend/app/services/run_lifecycle_service.py \
        backend/app/services/template_clone_service.py \
        backend/tests/integration/test_template_version_snapshot_shape.py
git commit -m "refactor(extraction): unify + widen template-version snapshot builder"
```

---

### Task 2: Migration 0026 — backfill legacy narrow snapshots

New snapshots are now wide (Task 1). Existing snapshots created before this change are still "narrow". Nothing reads `schema_` structurally **today** (every consumer reads live tables), so re-deriving a narrow snapshot from the current live template loses no previously-honored frozen data — it only makes old runs render against the (widened) frozen tree once the view starts reading it.

**Files:**
- Create: `backend/alembic/versions/0026_widen_template_version_snapshot.py`
- Modify: `backend/tests/integration/test_migration_roundtrip.py` (head-pin assertion, lines ~107–108)
- Test: reuse `test_migration_roundtrip.py` (head + continuous-chain assertions)

- [ ] **Step 1: Write the migration.** Create `backend/alembic/versions/0026_widen_template_version_snapshot.py`:

```python
"""Widen legacy template-version snapshots to the full entity_types/fields shape.

The frozen snapshot in ``extraction_template_versions.schema_`` historically
omitted ``role`` + ``description`` on entity_types and 8 field columns
(``validation_schema``, ``unit``, ``allowed_units``, ``llm_description``,
``allow_other``, ``other_label``, ``other_placeholder``, ``description``). The
run-open view (Phase 2) reads the snapshot structurally for the first time, so
narrow snapshots would render wrong.

Nothing read ``schema_`` structurally before this change — every consumer read
the live ``extraction_entity_types``/``extraction_fields`` tables — so
re-deriving a narrow snapshot from the current live template for that
``project_template_id`` loses no frozen behavior that was ever honored.

Idempotent: only snapshots whose first entity_type lacks the ``role`` key
(narrow) are rewritten; re-running is a no-op. Forward-only: the downgrade
cannot reliably reconstruct the prior narrow shape and is a documented no-op.

Revision ID: 0026_widen_template_version_snapshot
Revises: 0025_reviewer_scoped_select_rls
Create Date: 2026-06-08
"""

from alembic import op

revision = "0026_widen_template_version_snapshot"
down_revision = "0025_reviewer_scoped_select_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Re-derive the entity_types tree from the live template, but only for
    # snapshots detected as narrow (first entity_type missing the 'role' key).
    # Empty-tree snapshots fall under the same predicate and rebuild to an
    # empty tree (harmless). Keep this jsonb_build_object key list IN SYNC with
    # app/services/extraction_snapshot.SNAPSHOT_SQL.
    op.execute(
        """
        UPDATE public.extraction_template_versions v
        SET schema = jsonb_build_object(
            'entity_types', COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', et.id,
                            'name', et.name,
                            'label', et.label,
                            'description', et.description,
                            'parent_entity_type_id', et.parent_entity_type_id,
                            'cardinality', et.cardinality,
                            'role', et.role,
                            'sort_order', et.sort_order,
                            'is_required', et.is_required,
                            'fields', COALESCE(
                                (
                                    SELECT jsonb_agg(jsonb_build_object(
                                        'id', f.id,
                                        'name', f.name,
                                        'label', f.label,
                                        'description', f.description,
                                        'field_type', f.field_type,
                                        'is_required', f.is_required,
                                        'validation_schema', f.validation_schema,
                                        'allowed_values', f.allowed_values,
                                        'unit', f.unit,
                                        'allowed_units', f.allowed_units,
                                        'sort_order', f.sort_order,
                                        'llm_description', f.llm_description,
                                        'allow_other', f.allow_other,
                                        'other_label', f.other_label,
                                        'other_placeholder', f.other_placeholder
                                    ) ORDER BY f.sort_order)
                                    FROM public.extraction_fields f
                                    WHERE f.entity_type_id = et.id
                                ),
                                '[]'::jsonb
                            )
                        ) ORDER BY et.sort_order
                    )
                    FROM public.extraction_entity_types et
                    WHERE et.project_template_id = v.project_template_id
                ),
                '[]'::jsonb
            )
        )
        WHERE NOT ((v.schema -> 'entity_types' -> 0) ? 'role');
        """
    )


def downgrade() -> None:
    # Forward-only data widening. The prior narrow shape cannot be reconstructed
    # without re-dropping columns the read path now depends on, and no consumer
    # relies on the snapshot being narrow. Intentional no-op.
    pass
```

- [ ] **Step 2: Bump the head-pin assertion.** In `backend/tests/integration/test_migration_roundtrip.py`, update `test_alembic_head_is_expected_revision` (lines ~107–108):

```python
    assert "0026_widen_template_version_snapshot" in out, (
        f"Expected head revision '0026_widen_template_version_snapshot', got:\n{out}"
    )
```

- [ ] **Step 3: Apply the migration locally and verify the chain.**

Run: `cd backend && uv run alembic upgrade head && uv run pytest tests/integration/test_migration_roundtrip.py -v`
Expected: `alembic upgrade head` applies `0026_widen_template_version_snapshot`; both `test_alembic_head_is_expected_revision` and `test_alembic_history_chain_is_continuous` PASS.
(If the local DB is shared across worktrees and `alembic current` reports an unexpected head, verify offline with `uv run alembic upgrade head --sql` instead of resetting the DB — see the project memory on local integration tests.)

- [ ] **Step 4: Verify the backfill is idempotent (re-run is a no-op).**

Run: `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head && uv run pytest tests/integration/test_template_version_snapshot_shape.py -v`
Expected: downgrade is a no-op (snapshots stay wide), upgrade re-applies cleanly, snapshot-shape test PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/alembic/versions/0026_widen_template_version_snapshot.py \
        backend/tests/integration/test_migration_roundtrip.py
git commit -m "feat(migrations): 0026 backfill widened template-version snapshots"
```

---

## Phase B — Backend: the RunView composer + endpoint + embed

### Task 3: `RunViewResponse` schema + entity_types reader

`build_run_view` returns a superset of `RunDetailResponse`: the run + workflow rows (blind-filtered, composed from `get_run_with_workflow_history`) plus `entity_types` and `current_values`. This task adds the schema and the entity_types reader; current_values is Task 4; the composer is Task 5.

> **Scope note (from the `/simplify` pass):** Phase 2's frontend consumes only `current_values` (Task 11) and keeps reading `entity_types`/`instances` from `useExtractionData` (the deferred Task 12). `entity_types` is still built + returned server-side here because it is the *reason Phase A exists* — the snapshot-widening is only provably correct if the view serves the frozen tree, and the tests below exercise it. **`instances` is intentionally NOT included in Phase 2:** it has no Phase-2 consumer, and its only future consumer (Task 12) needs a wider shape (`project_id`/`created_by`/`created_at`/`updated_at`, which `RunViewInstance` would omit) — so it is added in the Task 12 PR where its required-field set is known, rather than shipped now in a shape that would be rewritten.

**Files:**
- Modify: `backend/app/schemas/extraction_run.py` (add after `RunDetailResponse`, ~line 142)
- Modify: `backend/app/services/extraction_run_read_service.py` (imports + `_entity_types_for_run`)
- Test: `backend/tests/integration/test_run_view_entity_types.py` (new)

- [ ] **Step 1: Add the response schemas.** In `backend/app/schemas/extraction_run.py`, after `RunDetailResponse` (line ~142), add. `RunViewField`/`RunViewEntityType` carry `from_attributes=True` so the live fallback can `model_validate` straight off ORM rows (matching the four sibling response models in this file):

```python
class RunViewField(BaseModel):
    """A field in the frozen template snapshot, widened to every column the
    run-open form renders from. Sourced from the version snapshot (or the live
    table when the snapshot is a pre-0026 narrow one)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    label: str
    description: str | None = None
    field_type: str
    is_required: bool
    validation_schema: Any | None = None
    allowed_values: Any | None = None
    unit: str | None = None
    allowed_units: Any | None = None
    sort_order: int
    llm_description: str | None = None
    allow_other: bool = False
    other_label: str | None = None
    other_placeholder: str | None = None


class RunViewEntityType(BaseModel):
    """An entity type in the frozen template snapshot, with its fields embedded.
    ``role`` drives the study/model partition; the tree hierarchy is conveyed by
    ``parent_entity_type_id`` (flat array, ordered by ``sort_order``)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    label: str
    description: str | None = None
    parent_entity_type_id: UUID | None = None
    cardinality: str
    role: str
    sort_order: int
    is_required: bool
    fields: list[RunViewField]


class RunViewCurrentValue(BaseModel):
    """The caller's current value for one (instance, field) coordinate, resolved
    server-side for review/consensus/finalized. ``value`` is the raw jsonb
    envelope (``{value, unit}`` or scalar) — the client unwraps it exactly as it
    did for ``loadValuesForUser``. Empty list for proposal/pending/cancelled."""

    instance_id: UUID
    field_id: UUID
    value: dict[str, Any] | None
    decision: str


class RunViewResponse(RunDetailResponse):
    """``RunDetailResponse`` (run + blind-filtered workflow rows) plus the two
    pieces the run-open form needs server-side: the frozen entity_types tree and
    the caller's current_values. (``instances`` is added in Task 12 — see the
    scope note above.)"""

    entity_types: list[RunViewEntityType]
    current_values: list[RunViewCurrentValue]
```

- [ ] **Step 2: Write the failing entity_types reader test.** Create `backend/tests/integration/test_run_view_entity_types.py`:

```python
"""The run view's entity_types tree must come from the run's frozen version
snapshot, and fall back to a live read when the snapshot is a pre-0026 narrow
one (first entity_type missing 'role')."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.extraction_run import RunSummaryResponse
from app.services.extraction_run_read_service import _entity_types_for_run
from app.services.run_lifecycle_service import RunLifecycleService


async def _new_run(db: AsyncSession):
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    if project_id is None:
        return None
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    user_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((article_id, template_id, user_id)):
        return None
    run = await RunLifecycleService(db).create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    return run


@pytest.mark.asyncio
async def test_entity_types_from_widened_snapshot(db_session: AsyncSession) -> None:
    run = await _new_run(db_session)
    if run is None:
        pytest.skip("Seed graph incomplete")

    entity_types = await _entity_types_for_run(
        db_session, RunSummaryResponse.model_validate(run)
    )
    assert entity_types, "expected a non-empty entity_types tree"
    roles = {et.role for et in entity_types}
    assert roles, "every entity type must carry a role from the widened snapshot"
    # role must be a real value (not a placeholder) so the study/model partition works
    assert roles <= {"study_section", "model_container", "model_section"}


@pytest.mark.asyncio
async def test_entity_types_live_fallback_for_narrow_snapshot(
    db_session: AsyncSession,
) -> None:
    run = await _new_run(db_session)
    if run is None:
        pytest.skip("Seed graph incomplete")

    # Force the snapshot back to a pre-0026 narrow shape (strip 'role').
    await db_session.execute(
        text(
            """
            UPDATE public.extraction_template_versions
            SET schema = jsonb_set(
                schema, '{entity_types}',
                (
                    SELECT COALESCE(jsonb_agg(elem - 'role'), '[]'::jsonb)
                    FROM jsonb_array_elements(schema -> 'entity_types') elem
                )
            )
            WHERE id = :vid
            """
        ),
        {"vid": str(run.version_id)},
    )
    db_session.expire_all()

    refetched = await db_session.get(type(run), run.id)
    entity_types = await _entity_types_for_run(
        db_session, RunSummaryResponse.model_validate(refetched)
    )
    assert entity_types, "live fallback must yield the entity_types tree"
    assert all(
        et.role in ("study_section", "model_container", "model_section")
        for et in entity_types
    ), "fallback reads role from the live table"
```

- [ ] **Step 3: Run it to verify it fails.**

Run: `cd backend && uv run pytest tests/integration/test_run_view_entity_types.py -v`
Expected: FAIL — `ImportError: cannot import name '_entity_types_for_run'`.

- [ ] **Step 4: Implement the entity_types reader.** In `backend/app/services/extraction_run_read_service.py`, extend the imports. The file already imports `from sqlalchemy import select` and `from app.models.extraction import ExtractionRun, ExtractionRunStage` — **merge** into those (do not add a second `select`/`ExtractionRun` import, or ruff/F811 fails). It already imports `RunSummaryResponse` in the schema block (reused below). Add only the new names:

```python
# extend `from sqlalchemy import select`  ->
from sqlalchemy import and_, select   # and_ is used by Task 4's resolver

# new import line (selectinload eager-loads the fields relationship in one go):
from sqlalchemy.orm import selectinload

# extend `from app.models.extraction import ExtractionRun, ExtractionRunStage`  ->
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionRun,
    ExtractionRunStage,
)

# new import lines:
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.models.extraction_workflow import ExtractionReviewerState  # add to the existing extraction_workflow import block

# extend the existing `from app.schemas.extraction_run import (...)` block with:
from app.schemas.extraction_run import (
    RunViewCurrentValue,
    RunViewEntityType,
    RunViewResponse,
)
```

Then add, after `get_run_with_workflow_history`. Note `_entity_types_for_run` takes the already-loaded `RunSummaryResponse` (`detail.run`) — it needs only `version_id`/`template_id`, both on that schema — so `build_run_view` does **not** re-fetch the ORM run:

```python
def _snapshot_is_narrow(entity_types: list[dict]) -> bool:
    """A pre-0026 snapshot is detected by its first entity_type lacking 'role'.
    Empty trees are treated as narrow so the live fallback repopulates them —
    a legitimately empty template just round-trips to an empty live read, which
    is the correct (if marginally wasteful) recovery, not a structural read to
    'optimize away'."""
    return not entity_types or "role" not in entity_types[0]


async def _entity_types_for_run(
    db: AsyncSession, run: RunSummaryResponse
) -> list[RunViewEntityType]:
    """Frozen entity_types tree from the run's version snapshot, with a live
    read fallback for pre-0026 narrow snapshots (belt-and-suspenders: migration
    0026 backfills these, but the fallback turns a 'silent broken study/model
    partition' into a correct live render if any narrow snapshot slips through).
    Both paths produce the same shape via ``model_validate``."""
    version = await db.get(ExtractionTemplateVersion, run.version_id)
    snapshot_types: list[dict] = (
        (version.schema_ or {}).get("entity_types", []) if version else []
    )
    if not _snapshot_is_narrow(snapshot_types):
        return [RunViewEntityType.model_validate(et) for et in snapshot_types]

    # Live fallback — one statement, fields eager-loaded (selectinload), then
    # model_validate straight off the ORM (RunViewEntityType/RunViewField carry
    # from_attributes=True). The relationship is not guaranteed field-ordered,
    # so sort the validated fields by sort_order to match the snapshot path.
    et_rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == run.template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order)
            )
        )
        .scalars()
        .all()
    )
    result: list[RunViewEntityType] = []
    for et in et_rows:
        view_et = RunViewEntityType.model_validate(et)
        view_et.fields.sort(key=lambda f: f.sort_order)
        result.append(view_et)
    return result
```

> `instances` is deliberately not read here — see the Task 3 scope note. It lands in Task 12 (with the widened `RunViewInstance` shape its consumer needs).

- [ ] **Step 5: Run the test to verify it passes.**

Run: `cd backend && uv run pytest tests/integration/test_run_view_entity_types.py -v`
Expected: PASS (both the snapshot and live-fallback tests).

- [ ] **Step 6: Lint + commit.**

```bash
cd backend && uv run ruff check app/schemas/extraction_run.py app/services/extraction_run_read_service.py && uv run ruff format app/schemas/extraction_run.py app/services/extraction_run_read_service.py
cd /Users/raphael/PycharmProjects/prumo
git add backend/app/schemas/extraction_run.py \
        backend/app/services/extraction_run_read_service.py \
        backend/tests/integration/test_run_view_entity_types.py
git commit -m "feat(extraction): RunView schema + frozen-snapshot entity_types reader"
```

---

### Task 4: Caller-scoped `current_values` resolver (4th blind copy)

Server-side equivalent of `loadValuesForUser`: human proposals as the base layer, the caller's current reviewer decision (via the materialized `reviewer_states` pointer) overriding. Caller-scoped — this is a 4th lockstep copy of the blind predicate.

**Files:**
- Modify: `backend/app/services/extraction_run_read_service.py` (`resolve_caller_current_values`)
- Test: `backend/tests/integration/test_run_view_current_values.py` (new)

- [ ] **Step 1: Write the failing test.** Create `backend/tests/integration/test_run_view_current_values.py`:

```python
"""resolve_caller_current_values must mirror the frontend loadValuesForUser it
replaces: human proposals are the base layer, the caller's current reviewer
decision (via the materialized reviewer_states pointer) overrides, and another
reviewer's rows are never returned (caller-scoped blind boundary)."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import resolve_caller_current_values
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)


@pytest.mark.asyncio
async def test_current_values_are_caller_scoped(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    a_values = await resolve_caller_current_values(
        db_session, run_id, caller_id=reviewer_a
    )
    b_values = await resolve_caller_current_values(
        db_session, run_id, caller_id=reviewer_b
    )
    # Each reviewer resolves only their own coordinates — no cross-leak.
    a_coords = {(v.instance_id, v.field_id) for v in a_values}
    b_coords = {(v.instance_id, v.field_id) for v in b_values}
    assert a_values, "reviewer A should resolve at least one current value"
    # A's resolved values must not surface B's secret edits and vice-versa.
    a_blob = " ".join(str(v.value) for v in a_values)
    assert "REVIEWER-B-SECRET" not in a_blob
    b_blob = " ".join(str(v.value) for v in b_values)
    assert "REVIEWER-A-SECRET" not in b_blob


@pytest.mark.asyncio
async def test_current_values_empty_for_non_review_stage(
    db_session: AsyncSession,
) -> None:
    # A run with no reviewer_states / human proposals resolves to an empty list,
    # not an error (the proposal stage path never calls this).
    from sqlalchemy import text

    project_id = (
        await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    if project_id is None:
        pytest.skip("Seed graph incomplete")
    fake_run = (
        await db_session.execute(
            text("SELECT id FROM public.extraction_runs LIMIT 1")
        )
    ).scalar()
    fake_user = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if not all((fake_run, fake_user)):
        pytest.skip("Seed graph incomplete")
    values = await resolve_caller_current_values(
        db_session, fake_run, caller_id=fake_user
    )
    assert isinstance(values, list)
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd backend && uv run pytest tests/integration/test_run_view_current_values.py -v`
Expected: FAIL — `ImportError: cannot import name 'resolve_caller_current_values'`.

- [ ] **Step 3: Implement the resolver.** In `backend/app/services/extraction_run_read_service.py`, add:

```python
async def resolve_caller_current_values(
    db: AsyncSession, run_id: UUID, *, caller_id: UUID
) -> list[RunViewCurrentValue]:
    """The caller's current value per (instance, field) coordinate.

    Mirrors the frontend ``loadValuesForUser`` it replaces, value-for-value:
      Layer 1 (base): the caller's own human proposals, newest-per-coord;
      Layer 2 (override): the caller's current reviewer decision per coord,
        resolved through the materialized ``extraction_reviewer_states`` pointer
        (``current_decision_id`` -> the live ``extraction_reviewer_decisions`` row).
    ``reject`` decisions are kept (the client clears the coord but the audit row
    stays). Caller-scoped: only ``reviewer_id == caller_id`` /
    ``source_user_id == caller_id`` rows — this is the 4th lockstep copy of the
    blind predicate and MUST stay identical to migration 0025 + the service
    filter in get_run_with_workflow_history.

    NOTE: ``ExtractionExportService._build_single_user_value_map`` looks similar
    but encodes a DIFFERENT contract (it sources ``accept_proposal`` from the
    accepted proposal and drops ``reject``, with no human-proposal base layer).
    This resolver mirrors the FRONTEND ``loadValuesForUser`` it replaces, not the
    export contract — do NOT DRY them together, or run-open values diverge from
    the form's current behavior (Invariant 6). The two reads below are
    independent but run sequentially on the shared AsyncSession (a single
    asyncpg connection cannot multiplex, so ``asyncio.gather`` here is unsafe);
    this matches the sequential read pattern of the composed
    get_run_with_workflow_history. Merging them into one CTE is a possible future
    optimization, deliberately not taken here to keep this security-sensitive
    resolver simple.
    """
    merged: dict[tuple[UUID, UUID], RunViewCurrentValue] = {}

    # Layer 1 — caller's own human proposals, newest-first so first-per-coord wins.
    proposal_rows = (
        (
            await db.execute(
                select(ExtractionProposalRecord)
                .where(
                    ExtractionProposalRecord.run_id == run_id,
                    ExtractionProposalRecord.source
                    == ExtractionProposalSource.HUMAN.value,
                    ExtractionProposalRecord.source_user_id == caller_id,
                )
                .order_by(ExtractionProposalRecord.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    for p in proposal_rows:
        key = (p.instance_id, p.field_id)
        if key in merged:
            continue
        merged[key] = RunViewCurrentValue(
            instance_id=p.instance_id,
            field_id=p.field_id,
            value=p.proposed_value,
            decision="human_proposal",
        )

    # Layer 2 — caller's current reviewer decision per coord (overrides Layer 1).
    state_rows = (
        await db.execute(
            select(ExtractionReviewerState, ExtractionReviewerDecision)
            .join(
                ExtractionReviewerDecision,
                and_(
                    ExtractionReviewerDecision.run_id
                    == ExtractionReviewerState.run_id,
                    ExtractionReviewerDecision.id
                    == ExtractionReviewerState.current_decision_id,
                ),
            )
            .where(
                ExtractionReviewerState.run_id == run_id,
                ExtractionReviewerState.reviewer_id == caller_id,
            )
        )
    ).all()
    for state, decision in state_rows:
        merged[(state.instance_id, state.field_id)] = RunViewCurrentValue(
            instance_id=state.instance_id,
            field_id=state.field_id,
            value=decision.value,
            decision=decision.decision,
        )

    return list(merged.values())
```

Add `ExtractionReviewerDecision` to the existing `from app.models.extraction_workflow import (...)` block if it is not already imported (it is imported today for `get_run_with_workflow_history`'s repository; verify the name is in scope).

- [ ] **Step 4: Add an automated parity test** (this resolver is the 4th copy of a security-critical predicate — a one-time by-hand check is the weak link). Append to `test_run_view_current_values.py` a test that pins the contract `resolve_caller_current_values` shares with the production `loadValuesForUser`:

```python
@pytest.mark.asyncio
async def test_current_values_match_loadvaluesforuser_contract(
    db_session: AsyncSession,
) -> None:
    """Layer precedence + value sourcing must match the frontend loadValuesForUser:
      - a coord with ONLY a human proposal -> decision='human_proposal', proposal value
      - a coord with an 'edit' reviewer decision -> decision='edit', the decision's
        own `value` column (reviewer decision overrides the human-proposal layer)
      - a 'reject' decision is RETAINED in the output (decision='reject'); the client
        drops it, the server does not.
    Build the decisions with the SAME reviewer-decision service the rest of the
    suite uses (see _build_two_reviewer_review_run in test_blind_review_isolation
    for the exact record-decision + reviewer_state upsert helper)."""
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, _reviewer_b = built

    values = await resolve_caller_current_values(
        db_session, run_id, caller_id=reviewer_a
    )
    by_decision = {v.decision for v in values}
    # The builder records reviewer A's REVIEW-stage decision(s); reviewer A must
    # see them resolved as their current value, sourced from the decision's own
    # `value` column (parity with loadValuesForUser, NOT the export contract).
    assert values, "reviewer A must resolve at least their own current value"
    assert by_decision <= {"human_proposal", "edit", "accept_proposal", "reject"}
    # If the builder records a 'reject', it must survive (server keeps it; client drops).
    # (Assert the specific decision/value pairs your builder produces — pin them
    # against the documented loadValuesForUser output, not the export helper's.)
```

> The frontend reads `reviewer_decision.value` (the decision row's own column), so this resolver does too. If `accept_proposal` surfaces a `null` value in production today, preserve that — do not source the value from the accepted proposal here (that would be a behavior change, out of scope). Tighten the final assertion to the exact `(decision, value)` pairs your chosen builder records.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `cd backend && uv run pytest tests/integration/test_run_view_current_values.py -v`
Expected: PASS (caller-scope + parity).

- [ ] **Step 6: Lint + commit.**

```bash
cd backend && uv run ruff check app/services/extraction_run_read_service.py && uv run ruff format app/services/extraction_run_read_service.py
cd /Users/raphael/PycharmProjects/prumo
git add backend/app/services/extraction_run_read_service.py \
        backend/tests/integration/test_run_view_current_values.py
git commit -m "feat(extraction): server-side caller-scoped current_values resolver"
```

---

### Task 5: `build_run_view` — compose, don't duplicate

**Files:**
- Modify: `backend/app/services/extraction_run_read_service.py` (`build_run_view`)
- Test: `backend/tests/integration/test_build_run_view.py` (new)

- [ ] **Step 1: Write the failing test.** Create `backend/tests/integration/test_build_run_view.py`:

```python
"""build_run_view composes get_run_with_workflow_history (the single blind
filter) and adds entity_types + current_values. It must NOT re-introduce a
blind leak, and current_values must be empty in proposal stage."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import build_run_view
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)
from tests.integration.test_run_proposals_latest_wins import _proposal_stage_coord


@pytest.mark.asyncio
async def test_build_run_view_blinds_peer_in_review(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    view = await build_run_view(
        db_session, run_id, caller_id=reviewer_b, is_arbitrator=False
    )
    reviewer_ids = {d.reviewer_id for d in view.decisions}
    assert reviewer_b in reviewer_ids
    assert reviewer_a not in reviewer_ids, "build_run_view leaked a peer decision"
    # The aggregate pieces are present.
    assert view.entity_types, "entity_types tree must be populated"
    # In review stage, current_values resolve for the caller.
    assert isinstance(view.current_values, list)


@pytest.mark.asyncio
async def test_build_run_view_current_values_empty_in_proposal(
    db_session: AsyncSession,
) -> None:
    fx = await _proposal_stage_coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    run_id, _instance_id, _field_id, user_id = fx

    view = await build_run_view(
        db_session, run_id, caller_id=user_id, is_arbitrator=False
    )
    assert view.run.stage == "proposal"
    assert view.current_values == [], (
        "proposal stage must use proposals[] on the client, not server current_values"
    )
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd backend && uv run pytest tests/integration/test_build_run_view.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_run_view'`.

- [ ] **Step 3: Implement `build_run_view`.** In `backend/app/services/extraction_run_read_service.py`, add:

```python
# Stages whose form hydrates from the materialized reviewer_states + decisions
# (current_values). In 'proposal' the client uses proposals[]; pending/cancelled
# show nothing.
_CURRENT_VALUE_STAGES = frozenset(
    {
        ExtractionRunStage.REVIEW.value,
        ExtractionRunStage.CONSENSUS.value,
        ExtractionRunStage.FINALIZED.value,
    }
)


async def build_run_view(
    db: AsyncSession, run_id: UUID, *, caller_id: UUID, is_arbitrator: bool
) -> RunViewResponse:
    """The one-round-trip run-open view: the blind-filtered run detail plus the
    frozen entity_types tree and the caller's current_values. COMPOSES
    get_run_with_workflow_history (the single blind filter) — it never re-queries
    the workflow tables, so the blind boundary cannot drift. The composed
    ``detail.run`` (a RunSummaryResponse) already carries ``version_id`` /
    ``template_id`` / ``stage`` / ``article_id``, so there is no second ORM
    fetch of the run here."""
    detail = await get_run_with_workflow_history(
        db, run_id, caller_id=caller_id, is_arbitrator=is_arbitrator
    )

    entity_types = await _entity_types_for_run(db, detail.run)
    current_values = (
        await resolve_caller_current_values(db, run_id, caller_id=caller_id)
        if detail.run.stage in _CURRENT_VALUE_STAGES
        else []
    )

    return RunViewResponse(
        run=detail.run,
        proposals=detail.proposals,
        decisions=detail.decisions,
        consensus_decisions=detail.consensus_decisions,
        published_states=detail.published_states,
        entity_types=entity_types,
        current_values=current_values,
    )
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd backend && uv run pytest tests/integration/test_build_run_view.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full read-service regression to confirm nothing drifted.**

Run: `cd backend && uv run pytest tests/integration/test_run_read_blind_filter.py tests/integration/test_run_proposals_latest_wins.py tests/integration/test_blind_review_isolation.py -v`
Expected: PASS (composition did not change `get_run_with_workflow_history`).

- [ ] **Step 6: Lint + commit.**

```bash
cd backend && uv run ruff check app/services/extraction_run_read_service.py && uv run ruff format app/services/extraction_run_read_service.py
cd /Users/raphael/PycharmProjects/prumo
git add backend/app/services/extraction_run_read_service.py \
        backend/tests/integration/test_build_run_view.py
git commit -m "feat(extraction): build_run_view composes detail + entity_types + current_values"
```

---

### Task 6: `GET /api/v1/runs/{run_id}/view`

Mirror `get_run` exactly: `_load_run_and_check_member` (BOLA gate) → `is_run_arbitrator` → `build_run_view` → `ApiResponse.success`. Read-only (no commit).

**Files:**
- Modify: `backend/app/api/v1/endpoints/extraction_runs.py` (add handler + import)
- Test: `backend/tests/integration/test_run_view_endpoint.py` (new)

- [ ] **Step 1: Write the failing endpoint test.** Create `backend/tests/integration/test_run_view_endpoint.py`:

```python
"""GET /api/v1/runs/{id}/view returns the composed RunViewResponse, gated by
project membership (BOLA)."""

from __future__ import annotations

import pytest

# Reuse the integration client fixture + a seeded run helper from the existing
# run-endpoint test module. Match its fixture names (e.g. `client`, auth headers,
# and the seeded extraction run) — see tests/integration/test_extraction_runs_*.py
# for the exact pattern used in this repo.
from tests.integration.conftest import (  # type: ignore  # adjust to real fixture module
    seeded_extraction_run,
)


@pytest.mark.asyncio
async def test_get_run_view_returns_aggregate(client, seeded_extraction_run) -> None:
    run_id = seeded_extraction_run.run_id
    resp = await client.get(f"/api/v1/runs/{run_id}/view")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    data = body["data"]
    assert "run" in data and "proposals" in data
    assert "entity_types" in data and "current_values" in data


@pytest.mark.asyncio
async def test_get_run_view_rejects_non_member(
    client_other_project, seeded_extraction_run
) -> None:
    run_id = seeded_extraction_run.run_id
    resp = await client_other_project.get(f"/api/v1/runs/{run_id}/view")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_run_view_works_for_qa_run(client, seeded_qa_run) -> None:
    # /view is kind-agnostic: QA runs also have a version snapshot and (in
    # review+) current_values. useRun routes BOTH surfaces here, so
    # build_run_view must not assume kind=extraction.
    resp = await client.get(f"/api/v1/runs/{seeded_qa_run.run_id}/view")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "entity_types" in data and "current_values" in data
```

> The exact fixture names (`client`, `client_other_project`, `seeded_extraction_run`, `seeded_qa_run`) differ by repo convention — open `backend/tests/integration/` for the existing run-endpoint test that calls `GET /api/v1/runs/{id}` and the QA-session tests, and copy their fixtures verbatim. The assertions above (envelope `ok`/`data`, the two new keys `entity_types`/`current_values`, the 403 BOLA gate, and **QA parity** — `/view` works for `kind=quality_assessment` runs) are what this task pins.

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd backend && uv run pytest tests/integration/test_run_view_endpoint.py -v`
Expected: FAIL — 404 (route does not exist yet).

- [ ] **Step 3: Add the handler.** In `backend/app/api/v1/endpoints/extraction_runs.py`, add `build_run_view` + `RunViewResponse` to the imports:

```python
from app.schemas.extraction_run import (
    # ... existing imports ...
    RunViewResponse,
)
from app.services.extraction_run_read_service import (
    # ... existing imports ...
    build_run_view,
)
```

Add the handler immediately after `get_run` (line ~158):

```python
@router.get("/{run_id}/view")
async def get_run_view(
    run_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunViewResponse]:
    """One-round-trip run-open view: blind-filtered run detail + the frozen
    entity_types tree + the caller's current_values."""
    run = await _load_run_and_check_member(db, run_id, current_user_sub)
    is_arbitrator = await is_run_arbitrator(db, run.project_id, current_user_sub)
    view = await build_run_view(
        db, run_id, caller_id=current_user_sub, is_arbitrator=is_arbitrator
    )
    return ApiResponse.success(view, trace_id=_trace(request))
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd backend && uv run pytest tests/integration/test_run_view_endpoint.py -v`
Expected: PASS (aggregate shape + 403 BOLA gate).

- [ ] **Step 5: Confirm the layered-architecture fitness check still passes** (the endpoint must import only from `app.services`/`app.schemas`/`app.core`/`app.api.deps`).

Run: `cd backend && uv run pytest tests/ -k layered_arch -v`
Expected: PASS.

- [ ] **Step 6: Lint + commit.**

```bash
cd backend && uv run ruff check app/api/v1/endpoints/extraction_runs.py && uv run ruff format app/api/v1/endpoints/extraction_runs.py
cd /Users/raphael/PycharmProjects/prumo
git add backend/app/api/v1/endpoints/extraction_runs.py \
        backend/tests/integration/test_run_view_endpoint.py
git commit -m "feat(api): GET /runs/{id}/view returns the composed RunViewResponse"
```

---

### Task 7: Embed `RunViewResponse` in `POST /hitl/sessions` (extraction only)

The open response carries the run view so the first paint needs no extra GET. Built **after** `open_or_resume` (seeding + advance already flushed) and **before** `commit`, with the same caller + computed `is_arbitrator`. Extraction only (QA gets `null`).

**Files:**
- Modify: `backend/app/schemas/hitl_session.py` (`OpenHITLSessionResponse`, lines 28–33)
- Modify: `backend/app/api/v1/endpoints/hitl_sessions.py` (lines 59–92)
- Test: `backend/tests/integration/test_hitl_session_embeds_run_view.py` (new)

- [ ] **Step 1: Write the failing test.** Create `backend/tests/integration/test_hitl_session_embeds_run_view.py`:

```python
"""POST /hitl/sessions (kind=extraction) embeds the run view so the client
renders from one round-trip. The embed is reviewer-scoped to the opener."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_open_extraction_session_embeds_run_view(
    client, seeded_project_article_template
) -> None:
    fx = seeded_project_article_template
    resp = await client.post(
        "/api/v1/hitl/sessions",
        json={
            "kind": "extraction",
            "project_id": str(fx.project_id),
            "article_id": str(fx.article_id),
            "project_template_id": str(fx.template_id),
        },
    )
    assert resp.status_code in (200, 201)
    data = resp.json()["data"]
    assert data["run_id"]
    assert data["run_view"] is not None, "extraction open must embed the run view"
    view = data["run_view"]
    assert view["run"]["id"] == data["run_id"]
    assert "entity_types" in view and "current_values" in view
    # Freshly opened run is in proposal stage -> current_values empty.
    assert view["run"]["stage"] == "proposal"
    assert view["current_values"] == []


@pytest.mark.asyncio
async def test_embedded_run_view_is_reviewer_scoped(
    client_as_reviewer_b, two_reviewer_review_run
) -> None:
    """The embed must be blind-scoped to the OPENER. The endpoint computes
    is_arbitrator from body.project_id (not run.project_id) — this pins that the
    embedded run_view never leaks a peer's decisions when a plain reviewer opens
    a review-stage run. (build_run_view's blind filter is unit-tested in
    test_build_run_view; this covers the endpoint's own caller_id/is_arbitrator
    wiring on the mutating path.)"""
    fx = two_reviewer_review_run  # (project_id, article_id, template_id, reviewer_a)
    resp = await client_as_reviewer_b.post(
        "/api/v1/hitl/sessions",
        json={
            "kind": "extraction",
            "project_id": str(fx.project_id),
            "article_id": str(fx.article_id),
            "project_template_id": str(fx.template_id),
        },
    )
    assert resp.status_code in (200, 201)
    view = resp.json()["data"]["run_view"]
    reviewer_ids = {d["reviewer_id"] for d in view["decisions"]}
    assert str(fx.reviewer_a) not in reviewer_ids, (
        "embed leaked reviewer A's decision to reviewer B"
    )
```

> Match `client` / `seeded_project_article_template` to the existing `hitl_sessions` integration test fixtures (`backend/tests/integration/test_hitl_session*.py`). For the second test, `two_reviewer_review_run` builds a review-stage run on a shared (article × template) with reviewer A having recorded a decision — base it on `_build_two_reviewer_review_run` (from `test_blind_review_isolation.py`) but expose the project/article/template ids so the endpoint can resume it; `client_as_reviewer_b` is the integration client authenticated as reviewer B. If wiring a reviewer-B-authenticated client is impractical, keep the first test and rely on `test_build_run_view_blinds_peer_in_review` (Task 5) — but note the endpoint's `body.project_id`-sourced `is_arbitrator` then stays unpinned.

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd backend && uv run pytest tests/integration/test_hitl_session_embeds_run_view.py -v`
Expected: FAIL — `KeyError: 'run_view'` (field not on the response yet).

- [ ] **Step 3: Extend the response schema.** In `backend/app/schemas/hitl_session.py`, import `RunViewResponse` and add the field:

```python
from app.schemas.extraction_run import RunViewResponse


class OpenHITLSessionResponse(BaseModel):
    run_id: UUID
    kind: Literal["extraction", "quality_assessment"]
    project_template_id: UUID
    instances_by_entity_type: dict[str, str]
    # Embedded run-open view (extraction only). Lets the client render from a
    # single round-trip instead of session -> GET /runs/{id} -> values. Null for
    # quality_assessment (its surface does not consume this).
    run_view: RunViewResponse | None = None
```

- [ ] **Step 4: Build + embed the view in the endpoint.** In `backend/app/api/v1/endpoints/hitl_sessions.py`, add imports:

```python
from app.schemas.extraction_run import RunViewResponse  # noqa: F401 (used in response model)
from app.services.extraction_run_read_service import build_run_view, is_run_arbitrator
from app.services.hitl_session_service import TemplateKind  # if not already imported
```

Between the `try/except` (after `session = await service.open_or_resume(...)`) and `await db.commit()`, add:

```python
    run_view: RunViewResponse | None = None
    if session.kind == TemplateKind.EXTRACTION:
        is_arbitrator = await is_run_arbitrator(db, body.project_id, current_user_sub)
        run_view = await build_run_view(
            db, session.run_id, caller_id=current_user_sub, is_arbitrator=is_arbitrator
        )

    await db.commit()
```

Then pass it into the response:

```python
    return ApiResponse.success(
        OpenHITLSessionResponse(
            run_id=session.run_id,
            kind=session.kind.value,
            project_template_id=session.project_template_id,
            instances_by_entity_type=session.instances_by_entity_type,
            run_view=run_view,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )
```

> `build_run_view` is a pure read (no writes); building it before `commit` reads the just-seeded/advanced state under the same advisory lock. If `session.kind` is `quality_assessment`, `run_view` stays `None`. Verify `TemplateKind.EXTRACTION` is the correct enum member name (it backs `kind.value == "extraction"`).

- [ ] **Step 5: Run the test to verify it passes.**

Run: `cd backend && uv run pytest tests/integration/test_hitl_session_embeds_run_view.py -v`
Expected: PASS.

- [ ] **Step 6: Confirm the existing session tests still pass** (resume → 200, create → 201, QA path unaffected).

Run: `cd backend && uv run pytest tests/integration/test_hitl_session_service.py -v`
Expected: PASS (adjust the module name to the repo's actual hitl-session integration test file).

- [ ] **Step 7: Lint + commit.**

```bash
cd backend && uv run ruff check app/schemas/hitl_session.py app/api/v1/endpoints/hitl_sessions.py && uv run ruff format app/schemas/hitl_session.py app/api/v1/endpoints/hitl_sessions.py
cd /Users/raphael/PycharmProjects/prumo
git add backend/app/schemas/hitl_session.py \
        backend/app/api/v1/endpoints/hitl_sessions.py \
        backend/tests/integration/test_hitl_session_embeds_run_view.py
git commit -m "feat(api): embed RunViewResponse in extraction session-open response"
```

---

## Phase C — Frontend: consume the view, drop the direct reads

### Task 8: TS types for the view

**Files:**
- Modify: `frontend/hooks/runs/types.ts`
- Modify: `frontend/hooks/runs/index.ts` (re-export the new types if the barrel enumerates them)

- [ ] **Step 1: Add the response types.** In `frontend/hooks/runs/types.ts`, after `RunDetailResponse`, add (snake_case to match the backend JSON):

```typescript
export interface RunViewFieldResponse {
  id: string;
  name: string;
  label: string;
  description: string | null;
  field_type: string;
  is_required: boolean;
  validation_schema: unknown | null;
  allowed_values: unknown | null;
  unit: string | null;
  allowed_units: unknown | null;
  sort_order: number;
  llm_description: string | null;
  allow_other: boolean;
  other_label: string | null;
  other_placeholder: string | null;
}

export interface RunViewEntityType {
  id: string;
  name: string;
  label: string;
  description: string | null;
  parent_entity_type_id: string | null;
  cardinality: string;
  role: string;
  sort_order: number;
  is_required: boolean;
  fields: RunViewFieldResponse[];
}

export interface RunViewCurrentValue {
  instance_id: string;
  field_id: string;
  value: Record<string, unknown> | null;
  decision: string;
}

// `instances` is added here in Task 12 (deferred), alongside its backend field
// and the frontend adapter that consumes it.
export interface RunViewResponse extends RunDetailResponse {
  entity_types: RunViewEntityType[];
  current_values: RunViewCurrentValue[];
}
```

- [ ] **Step 2: Typecheck.**

Run (from repo root): `npm run typecheck`
Expected: clean (types only; no consumer references yet).

- [ ] **Step 3: Commit.**

```bash
git add frontend/hooks/runs/types.ts frontend/hooks/runs/index.ts
git commit -m "feat(runs): RunViewResponse TS types (superset of RunDetailResponse)"
```

---

### Task 9: `useRun` reads `/view`

`RunViewResponse extends RunDetailResponse`, so every existing `useRun` consumer (reading `.run`/`.proposals`/`.decisions`) keeps compiling; the two new fields (`entity_types`, `current_values`) become available. The query key stays `runsKeys.detail(runId)`, so all mutation invalidation is unchanged.

> **QA surface note:** `useRun` is consumed by **both** `ExtractionFullScreen.tsx` and `QualityAssessmentFullScreen.tsx`. Re-pointing it to `/view` routes QA runs through `build_run_view` too. This is safe — `/view` is kind-agnostic (Task 6 pins QA parity), QA templates are cloned and carry version snapshots, and the QA page reads only `.run`/`.proposals`/`.decisions`/`.consensus_decisions` (verified: `useReviewerSummary` reads `.decisions`, `ConsensusPanel` reads `.consensus_decisions`) — it ignores the two new fields. QA's session hook (`useQAAssessmentSession`) gets `run_view: null` and does not seed, so QA still does one real `GET /view`; that is acceptable (QA is not the slow-load target). Do not gate `useRun` by kind.

**Files:**
- Modify: `frontend/hooks/runs/useRun.ts`
- Modify: `frontend/test/hooks-runs.test.tsx` (re-point expectation `/api/v1/runs/{id}` → `/view`)

- [ ] **Step 1: Update the failing test first.** In `frontend/test/hooks-runs.test.tsx`, find the assertion that `useRun` fetches `/api/v1/runs/${runId}` and change the expected path to `/api/v1/runs/${runId}/view`. (If the test mocks `apiClient`, assert it was called with the `/view` suffix.)

- [ ] **Step 2: Run it to verify it fails.**

Run (from repo root): `npx vitest run frontend/test/hooks-runs.test.tsx`
Expected: FAIL (still calls the old path).

- [ ] **Step 3: Re-point the hook.** In `frontend/hooks/runs/useRun.ts`, change the import + return type + queryFn:

```typescript
import { runsKeys, type RunViewResponse } from "./types";

export interface UseRunOptions {
  enabled?: boolean;
}

export function useRun(runId: string | null | undefined, options: UseRunOptions = {}) {
  const { enabled = true } = options;

  return useQuery<RunViewResponse>({
    queryKey: runId ? runsKeys.detail(runId) : ["runs", "disabled"],
    queryFn: async () => {
      if (!runId) {
        throw new Error("Missing run ID");
      }
      return apiClient<RunViewResponse>(`/api/v1/runs/${runId}/view`);
    },
    enabled: enabled && Boolean(runId),
    staleTime: 30_000,
    retry: 1,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run (from repo root): `npx vitest run frontend/test/hooks-runs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck.**

Run (from repo root): `npm run typecheck`
Expected: clean (`RunViewResponse` is a superset; no consumer breaks).

- [ ] **Step 6: Lint + commit.**

```bash
npx eslint frontend/hooks/runs/useRun.ts
git add frontend/hooks/runs/useRun.ts frontend/test/hooks-runs.test.tsx
git commit -m "feat(runs): useRun reads GET /runs/{id}/view (RunViewResponse)"
```

---

### Task 10: `useExtractionSession` consumes the embed + seeds the cache

The session response now carries `run_view`; seed `runsKeys.detail(run_id)` so `useRun` reads from cache on first paint (no extra GET). Must happen inside the stale-generation guard.

**Files:**
- Modify: `frontend/hooks/extraction/useExtractionSession.ts`
- Modify: `frontend/hooks/qa/useQAAssessmentSession.ts` (mirror the optional field, ignore it)
- Test: `frontend/test/hooks/useExtractionSession.test.tsx` (extend)

- [ ] **Step 1: Write the failing test.** In `frontend/test/hooks/useExtractionSession.test.tsx`, add a case: mock `apiClient` to resolve `{ run_id, kind, project_template_id, instances_by_entity_type, run_view: <RunViewResponse fixture> }`, render `useExtractionSession` inside a `QueryClientProvider`, and assert after settle that `queryClient.getQueryData(["runs", run_id])` deep-equals the embedded `run_view`. Add a second case where `run_view` is `null` (QA-style) and assert no cache write happens and the hook still resolves `session`.

- [ ] **Step 2: Run it to verify it fails.**

Run (from repo root): `npx vitest run frontend/test/hooks/useExtractionSession.test.tsx`
Expected: FAIL (no cache write yet).

- [ ] **Step 3: Consume + seed.** In `frontend/hooks/extraction/useExtractionSession.ts`:

Add imports and the `run_view` field:

```typescript
import { useQueryClient } from "@tanstack/react-query";

import { runsKeys, type RunViewResponse } from "@/hooks/runs/types";

interface OpenResponse {
  run_id: string;
  kind: "extraction" | "quality_assessment";
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
  run_view: RunViewResponse | null;
}
```

Inside the hook, get the query client:

```typescript
  const queryClient = useQueryClient();
```

In `open()`, right after the generation guard `if (myGeneration !== generationRef.current) return;` and before `setSession(...)`, seed the cache:

```typescript
      if (myGeneration !== generationRef.current) return;
      // Pre-seed the run-detail cache from the embedded view so useRun reads
      // from cache on first paint — collapsing the session -> GET /runs/{id} ->
      // values serial waterfall. Inside the generation guard so a stale
      // article's view can never poison the new article's run cache.
      if (data.run_view) {
        queryClient.setQueryData(runsKeys.detail(data.run_id), data.run_view);
      }
      setSession({
        runId: data.run_id,
        projectTemplateId: data.project_template_id,
        instancesByEntityType: data.instances_by_entity_type,
      });
```

Add `queryClient` to the `open` `useCallback` dependency array.

- [ ] **Step 4: Mirror the QA twin.** In `frontend/hooks/qa/useQAAssessmentSession.ts`, add `run_view: RunViewResponse | null` to its local `OpenResponse` interface (import the type) so the shared backend response type-checks. QA does **not** seed the cache (its `run_view` is always `null`); leave its body otherwise unchanged.

- [ ] **Step 5: Run the test to verify it passes.**

Run (from repo root): `npx vitest run frontend/test/hooks/useExtractionSession.test.tsx`
Expected: PASS (cache seeded when `run_view` present; no write when `null`).

- [ ] **Step 6: Typecheck + lint + commit.**

```bash
npm run typecheck
npx eslint frontend/hooks/extraction/useExtractionSession.ts frontend/hooks/qa/useQAAssessmentSession.ts
git add frontend/hooks/extraction/useExtractionSession.ts \
        frontend/hooks/qa/useQAAssessmentSession.ts \
        frontend/test/hooks/useExtractionSession.test.tsx
git commit -m "feat(extraction): seed run-detail cache from embedded session run_view"
```

---

### Task 11: `useExtractedValues` consumes `current_values` from the view

Replace the only network read left in the hook (`loadValuesForUser`) with the `currentValues` already present in `runDetail`. The hook becomes pure given its props.

**Files:**
- Modify: `frontend/services/extractionValueService.ts` (export `unwrapValue`)
- Modify: `frontend/hooks/extraction/useExtractedValues.ts`
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (pass `currentValues={runDetail?.current_values}`)
- Test: `frontend/test/hooks/useExtractedValues.test.tsx` (extend)

- [ ] **Step 1: Export `unwrapValue`.** In `frontend/services/extractionValueService.ts`, change `function unwrapValue(...)` (line 65) to `export function unwrapValue(...)` so the hook reuses the identical envelope-stripping logic.

- [ ] **Step 2: Write the failing test.** In `frontend/test/hooks/useExtractedValues.test.tsx`, add a review-stage case: render the hook with `stage="review"`, `currentValues=[{ instance_id, field_id, value: { value: "X", unit: null }, decision: "edit" }, { instance_id, field_id: f2, value: {...}, decision: "reject" }]`, and assert the produced `values` map contains the `edit` coord and **omits** the `reject` coord — and that `ExtractionValueService.loadValuesForUser` is NOT called.

- [ ] **Step 3: Run it to verify it fails.**

Run (from repo root): `npx vitest run frontend/test/hooks/useExtractedValues.test.tsx`
Expected: FAIL (hook still calls `loadValuesForUser`).

- [ ] **Step 4: Consume `currentValues`.** In `frontend/hooks/extraction/useExtractedValues.ts`:

Add to `UseExtractedValuesProps` and the destructure:

```typescript
import { unwrapValue } from "@/services/extractionValueService";
import type { RunViewCurrentValue } from "@/hooks/runs/types";

// in UseExtractedValuesProps:
  currentValues?: RunViewCurrentValue[];

// in the destructure:
  const { runId, stage, proposals, currentValues, currentUserId, enabled = true } = props;
```

Replace the `REVIEWER_STATE_STAGES` branch body (the `await ExtractionValueService.loadValuesForUser(...)` block) with a pure read of `currentValues` — identical value-shaping to the old path (`unwrapValue` then unit extraction then `extractValueFromDb`, skipping `reject`):

```typescript
        if (REVIEWER_STATE_STAGES.has(stage)) {
          if (!currentUserId) {
            hydratedRunIdRef.current = runId;
            resetValuesIfNeeded(setValues);
            return;
          }

          const valuesMap: Record<string, any> = {};
          for (const cv of currentValues ?? []) {
            if (cv.decision === 'reject') continue;
            const key = `${cv.instance_id}_${cv.field_id}`;
            const unwrapped = unwrapValue(cv.value);
            const unit =
              typeof unwrapped === 'object' &&
              unwrapped !== null &&
              'unit' in (unwrapped as Record<string, unknown>)
                ? ((unwrapped as { unit: string | null }).unit ?? null)
                : null;
            valuesMap[key] = extractValueFromDb({ value: unwrapped, unit });
          }
          applyLoadedValues(valuesMap);
          setInitialized(true);
          return;
        }
```

Add `currentValues` to the `loadValues` `useCallback` dependency array (replacing the data dependency that `loadValuesForUser` implied). The branch is now synchronous, but keep `loadValues` async (the proposal branch and the function signature are unchanged).

`loadValuesForUser` was the only `ExtractionValueService.*` call in this hook — remove the now-unused `ExtractionValueService` import. (The hook still imports the named `unwrapValue` from the same `extractionValueService` module — keep that one.) Otherwise eslint `no-unused-vars` fails at Step 7.

> This preserves parity exactly: the old service did `value: unwrapValue(proposed_value | reviewer_decision.value)` then the hook read `unit` off that and called `extractValueFromDb`. Here the server sends the **raw** envelope and the hook applies the same `unwrapValue` + unit + `extractValueFromDb`, so `unwrapped` equals the old `row.value`. The `reject`-skip and `currentUserId`-null reset are unchanged.

- [ ] **Step 5: Wire the prop in the page.** In `frontend/pages/ExtractionFullScreen.tsx`, in the `useExtractedValues({ ... })` call, add `currentValues: runDetail?.current_values`:

```typescript
  const {
    values, loadedValues, updateValue,
    loading: valuesLoading, initialized: valuesInitialized, refresh: refreshValues,
  } = useExtractedValues({
    runId: activeRunId,
    stage,
    proposals,
    currentValues: runDetail?.current_values,
    currentUserId,
    enabled: !!activeRunId,
  });
```

- [ ] **Step 6: Run the tests to verify they pass.**

Run (from repo root): `npx vitest run frontend/test/hooks/useExtractedValues.test.tsx`
Expected: PASS (review branch reads `currentValues`; `reject` omitted; `loadValuesForUser` not called).

- [ ] **Step 7: Typecheck + lint + commit.**

```bash
npm run typecheck
npx eslint frontend/hooks/extraction/useExtractedValues.ts frontend/pages/ExtractionFullScreen.tsx frontend/services/extractionValueService.ts
git add frontend/services/extractionValueService.ts \
        frontend/hooks/extraction/useExtractedValues.ts \
        frontend/pages/ExtractionFullScreen.tsx \
        frontend/test/hooks/useExtractedValues.test.tsx
git commit -m "feat(extraction): review-stage values come from the view's current_values"
```

---

### Task 12 (deferred sub-phase): source entity_types + instances from the view in `useExtractionData`

> **Status: deferred — design + hazards only, not a bite-sized TDD task.** This is the "remove the direct Supabase reads of `extraction_entity_types` + `extraction_instances`" step from the brief. It is **intentionally sequenced after** Tasks 1–11 and **not** broken into executable steps here, because an adversarial review found two hazards that need a dedicated investigation pass with the page open. The structural slow-load win does **not** depend on this task — see "Why deferral costs nothing structural" below — so Phase 2 ships correct without it, and this sub-phase lands as its own PR (it overlaps the brief's item C "single API read path").

**Why deferral costs nothing structural.** The serial waterfall the brief targets is `session → useRun → values`. Tasks 7/9/10/11 collapse exactly that (embed seeds the cache; `useRun` reads `/view`; values come from `current_values`). The `extraction_entity_types` + `extraction_instances` reads in `useExtractionData.loadData` already run in a **parallel** `Promise.all` gated only on `template.id` (`useExtractionData.ts:262-273`) — they are off the critical serial path. Moving them server-side removes 2 parallel requests (a request-count win, not a depth win), so it is pure cleanup, not the structural fix.

**Hazard 1 — read-after-write on instances (the blocker).** `refreshInstances()` is called from ~11 sites in `ExtractionFullScreen.tsx` (model create/delete, finalize, reopen, extraction-complete), and several `await refreshInstances()` then **immediately read the refreshed `instances` array** (e.g. `handleFinalize` does `instances.map(i => i.id)` right after a direct `extraction_instances` write + refresh). Today `refreshInstances` does a direct Supabase read and `setInstances`, so the next render sees fresh data. If `instances` instead derives from `runDetail` (the cached view), `await queryClient.invalidateQueries(...)` does **not** return the fresh data and the derived `instances` memo only updates after the refetch resolves and the component re-renders — so the code reading `instances` right after reads **stale** data. This is a real correctness regression in the finalize/model flows.

**Hazard 2 — the view's shapes do not satisfy the frontend types.** Verified against `frontend/types/extraction.ts`:
- `ExtractionEntityTypeWithFields.template_id` is required `string` (inherited from `ExtractionEntityType`, `types/extraction.ts:89`) — the snapshot tree carries no `template_id`, so an adapter cannot set `null`. (A child interface cannot relax an inherited required field to `string | null` in TS.)
- `ExtractionInstance` requires `project_id`, `template_id`, `created_by`, `created_at`, `updated_at` (`types/extraction.ts:137-151`) — none are in `RunViewInstance`. An `instancesFromRunView` adapter would have to `as unknown as` past 5 missing required fields (a type lie that strands future consumers).

**Design for when this is picked up** (resolve both hazards explicitly):

0. **Add `instances` to the view server-side** (net-new here, since Phase 2 deliberately omitted it): a `RunViewInstance` schema carrying the **full** field set the frontend `ExtractionInstance` needs — `id`, `entity_type_id`, `parent_instance_id`, `label`, `sort_order`, `status`, `metadata` (via the `metadata_`→`metadata` `serialization_alias`), **plus** `project_id`, `created_by`, `created_at`, `updated_at` (all on the ORM row) — so the adapter is lossless rather than casting past missing fields; a `_instances_for_run(db, run)` reader (keyed by `article_id`+`template_id`, not run-scoped — cross-reference `ExtractionExportService._load_instances_for_runs` as the canonical scoping rule, do not import it); `instances: list[RunViewInstance]` on `RunViewResponse` (backend + the frontend `RunViewInstance` interface). Extend the Task 5 `build_run_view` + the Task 6 endpoint test to cover it (incl. the `metadata` wire-key assertion).
1. **Adapters** in a new `frontend/lib/extraction/runViewAdapters.ts`:
   - `entityTypesFromRunView(view)`: map `view.entity_types` → `ExtractionEntityTypeWithFields[]`, setting `template_id: view.run.template_id` (a real string — the project template the run belongs to; the form never reads it, and `partitionEntityTypes` reads only `role`). Keep `allowed_values`/`allowed_units` as arrays and `validation_schema` as-is.
   - `instancesFromRunView(view, run)`: with the widened `RunViewInstance` from step 0, this is a straight map (set `article_id: run.article_id` if `RunViewInstance` omits it). No `as unknown as` casts past missing fields.
2. **Source from the view in `ExtractionFullScreen.tsx`** via `useMemo(() => entityTypesFromRunView(runDetail), [runDetail])` and the instances analog.
3. **Resolve Hazard 1** by converting every `await refreshInstances()`-then-read site to **refetch-and-derive**: `const { data } = await refetchRun(); const fresh = instancesFromRunView(data, run);` and use `fresh` for the immediate read — never read the memo-derived `instances` in the same tick as the refetch. Audit all sites first: `grep -n "refreshInstances" frontend/pages/ExtractionFullScreen.tsx`. Sites that do **not** read instances immediately may use `queryClient.invalidateQueries({ queryKey: runsKeys.detail(activeRunId) })`.
4. **Strip the direct reads** from `useExtractionData` (remove `entityTypes`/`instances`/`refreshInstances`/`loadInstances`/`mergeInstancesById` + the `extraction_entity_types`/`extraction_instances` queries; keep article/project/template/articles). Re-point any other `useExtractionData.entityTypes`/`.instances` consumer (`grep -rn "useExtractionData" frontend/`).
5. **Behavior to preserve:** the frozen-snapshot entity_types now drive rendering (was live) — confirm a run opened against a since-edited template renders its frozen structure (the whole point of the Phase-A widening). Keep `mergeInstancesById`'s structural-sharing intent (avoid form remount/scroll-reset) — derive `instances` with a stable-identity memo, or keep a small by-id merge in the adapter.

When this sub-phase lands, the backend `instances` field added in step 0 becomes the single source for the form's instances, closing the last direct Supabase read on the open path.

---

## Phase D — Docs/CI + end-to-end verification

### Task 13: Register the plan doc + full verification sweep

**Files:**
- Modify: `.markdownlintignore` (add this plan doc if the `2026-06-08-*` glob is not already covered)
- Verify: `.github/workflows/docs-ci.yml` (the `docs/superpowers/plans/2026-06-08-*.md` ignore glob already covers this doc — confirm, don't duplicate)

- [ ] **Step 1: Confirm docs-ci already ignores this doc.** `.github/workflows/docs-ci.yml`'s markdownlint step already lists `"!docs/superpowers/plans/2026-06-08-*.md"`, which matches this file. No change needed there. If `.markdownlintignore` is used by a local `make lint-docs` target and lacks a `2026-06-08` entry, add:

```text
docs/superpowers/plans/2026-06-08-runopen-slowload-phase2-runview.md
```

- [ ] **Step 2: Backend full suite (touched areas).**

Run: `cd backend && uv run pytest tests/integration/test_template_version_snapshot_shape.py tests/integration/test_run_view_entity_types.py tests/integration/test_run_view_current_values.py tests/integration/test_build_run_view.py tests/integration/test_run_view_endpoint.py tests/integration/test_hitl_session_embeds_run_view.py tests/integration/test_run_read_blind_filter.py tests/integration/test_migration_roundtrip.py -v`
Expected: all PASS.

- [ ] **Step 3: Backend lint.**

Run: `make lint-backend`
Expected: clean.

- [ ] **Step 4: Frontend full verification.**

Run (from repo root): `npm run typecheck && npx vitest run frontend/ && npx eslint frontend/hooks frontend/pages frontend/lib/extraction frontend/services`
Expected: typecheck clean, vitest green for the touched suites, eslint clean.

- [ ] **Step 5 (manual, on the PR preview): re-measure the fan-out.** Open a saved run for `teste@prumo.local`, and via Resource Timing confirm: exactly one `POST /api/v1/hitl/sessions`, **zero** follow-up `GET /api/v1/runs/{id}/view` on first paint (served from the seeded cache), and **zero** direct PostgREST reads of `extraction_reviewer_states` on the open path (the review-stage `loadValuesForUser` read is gone — values come from the embedded `current_values`). The `extraction_entity_types` + `extraction_instances` parallel reads **still fire** in Phase 2 (their removal is the deferred Task 12) — that is expected. Confirm the form renders study + per-model sections, progress, and blinding correctly across `proposal` and `review` stages.

- [ ] **Step 6: Multi-reviewer blind E2E.** With two reviewers on the same (article × template) in `review` stage, confirm reviewer B's form never shows reviewer A's in-flight human values — now enforced server-side by `resolve_caller_current_values` (caller scope) + the composed `get_run_with_workflow_history` blind filter in the embed.

- [ ] **Step 7: Commit the doc registration (if `.markdownlintignore` changed).**

```bash
git add .markdownlintignore docs/superpowers/plans/2026-06-08-runopen-slowload-phase2-runview.md
git commit -m "docs(plans): Phase 2 RunView server-collapse implementation plan"
```

---

## Self-Review

**Spec coverage (against the blueprint §Phase 2 + the task brief item A):**

- Snapshot widening migration (lossy `_snapshot_initial_version`): Tasks 1 (unify + widen both builders) + 2 (0026 backfill + head-pin bump). Covers `role`, `description`, `validation_schema`, `unit`, `allowed_units`, `allow_other`/`other_label`/`other_placeholder`, `llm_description` — verified against the actual ORM columns. Live-read fallback for narrow legacy snapshots: Task 3 (`_snapshot_is_narrow` + `_entity_types_for_run`). ✓
- `build_run_view` composes (not duplicates) `get_run_with_workflow_history` + entity_types (snapshot/live) + current_values: Task 5. (Instances deferred to Task 12 — see scope note.) ✓
- Read-only `GET /runs/{id}/view` + embed in `POST /hitl/sessions`: Tasks 6 + 7. ✓
- Frontend: `useExtractionSession` consumes the embed (Task 10); `useRun` reads `/view` (Task 9); `useExtractedValues` reads current_values (Task 11). Removing the direct entity_types+instances Supabase reads from `useExtractionData` is **deferred to Task 12** (a documented sub-phase, not executed in Phase 2) — those reads are parallel/off the critical serial path and carry a read-after-write hazard. The structural slow-load collapse (the brief's intent) is fully delivered by Tasks 7/9/10/11. ⚠️ partial-by-design

**Invariants preserved:**

- Single mutating entry point — embed built between `open_or_resume` and `commit`; `/view` is read-only (no `commit`). No GET seeds. ✓ (Invariant 1)
- Blind filter in lockstep — `build_run_view` composes `get_run_with_workflow_history`; `resolve_caller_current_values` uses `reviewer_id == caller` / `source_user_id == caller` (4th copy, predicate-identical to 0025). Test `test_build_run_view_blinds_peer_in_review` + `test_current_values_are_caller_scoped` pin it. ✓ (Invariant 2, 5)
- current_values only for `{review, consensus, finalized}` — `_CURRENT_VALUE_STAGES` gate; proposal returns `[]` (test `test_build_run_view_current_values_empty_in_proposal`); the proposal-stage client path (`pickLatestProposalPerCoord`) is untouched. ✓ (Invariant 3)
- `computeRowProgress` stays pure/client — no server progress field; it keeps receiving `instances`/`values`/`entityTypes` on the client (from `useExtractionData` in Phase 2, from the view after Task 12). ✓ (Invariant 4)
- Behavior parity for current_values — Task 4 mirrors `loadValuesForUser` (human base layer + reviewer-decision override via the materialized pointer, `reject` preserved); the client applies the identical `unwrapValue` + `extractValueFromDb`. ✓ (Invariant 6)

**Type consistency:** `RunViewResponse` (backend `extends RunDetailResponse` via subclass; frontend `extends RunDetailResponse` via interface) carries the same two Phase-2 fields `entity_types`/`current_values` (`instances` added in Task 12). `RunViewField`/`RunViewEntityType`/`RunViewCurrentValue` names match across `backend/app/schemas/extraction_run.py` and `frontend/hooks/runs/types.ts`. `RunViewCurrentValue` (the only view field consumed in Phase 2) flows server → `useRun` → `runDetail.current_values` → `useExtractedValues` prop with matching `instance_id`/`field_id`/`value`/`decision`. `build_run_view(db, run_id, *, caller_id, is_arbitrator)` signature is identical in the endpoint (Task 6) and the embed (Task 7). `runsKeys.detail(runId)` is the single cache key seeded (Task 10) and read (Task 9) — all five mutation hooks already invalidate it, so no invalidation change is needed.

**Known reconciliation points flagged for the implementer (not placeholders — explicit verify-then-adjust):**

- Integration-test fixture names (`client`, `seeded_extraction_run`, `seeded_project_article_template`) differ by repo convention — copy them from the existing `tests/integration/test_extraction_runs*.py` / `test_hitl_session*.py` modules (Tasks 6, 7).
- `resolve_caller_current_values` `accept_proposal` value sourcing — match current production `loadValuesForUser` behavior exactly; do not "fix" (Task 4 automated parity test).
- Frontend type reconciliation for the view's `entity_types`/`instances` (`template_id` non-null; `ExtractionInstance` missing 5 required fields) — owned by the deferred Task 12, which proposes widening `RunViewInstance` rather than casting past missing fields.
