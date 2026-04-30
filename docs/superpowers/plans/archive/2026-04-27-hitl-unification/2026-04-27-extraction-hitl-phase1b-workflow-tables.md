# Extraction HITL — Phase 1B: Workflow Tables + Evidence Evolution + Stage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five HITL workflow tables (`extraction_proposal_records`, `extraction_reviewer_decisions`, `extraction_reviewer_states`, `extraction_consensus_decisions`, `extraction_published_states`), evolve `extraction_evidence` with workflow FKs, and migrate the `extraction_run_stage` enum to the new lifecycle values. After this plan, the schema is fully ready for Phase 1C's services and endpoints.

**Architecture:** Five new tables join the foundation laid by Phase 1A. Append-only audit pattern for proposal/decision/consensus records; materialized current-state on `extraction_reviewer_states`; optimistic-concurrency `version` int on `extraction_published_states`. New extraction-flavored enums avoid coupling to the 008 stack (which Plan 1D will drop). Evidence becomes polymorphic via nullable FKs to the workflow records. Stage enum is rebuilt with mapping from legacy values.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 async, Alembic raw-SQL migrations, pytest with `pytest-asyncio` integration tests against a real PostgreSQL DB.

---

## Plans roadmap (this is Plan 1B of 5)

| # | Plan | Status |
|---|---|---|
| 1A | Database Foundation | ✅ |
| 1B | **Workflow tables + Evidence evolution + Stage enum migration** (this plan) | in this plan |
| 1C | Backend Services + Endpoints `/v1/runs/...` | pending |
| 1D | Data Migration (synthetic Runs) + Drop 008 stack | pending |
| 1E | Frontend Shell + ExtractionFullScreen rewire + PDF collapsed | pending |
| 2 | QA — PROBAST + QUADAS-2 seed + page | pending |

---

## Spec reference

`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` sections 4.4–4.10 (workflow tables + evidence evolution + run lifecycle) and §5 migrations 3–5.

---

## File structure

### Files to create

| File | Responsibility |
|---|---|
| `backend/app/models/extraction_workflow.py` | All five workflow models + their enums (`ExtractionProposalSource`, `ExtractionReviewerDecisionType`, `ExtractionConsensusMode`). Single file because the models are tightly coupled (each row chains run_id → instance_id → field_id with the same coordinates). |
| `backend/alembic/versions/20260427_0012_workflow_tables.py` | Creates the 5 tables, 3 enums, RLS/triggers/indexes mirroring 0010. |
| `backend/alembic/versions/20260427_0013_evidence_evolution.py` | Adds `run_id`, `proposal_record_id`, `reviewer_decision_id`, `consensus_decision_id` to `extraction_evidence`. CHECK constraint allowing legacy `target_type`/`target_id` during transition. |
| `backend/alembic/versions/20260427_0014_run_stage_enum_migration.py` | Rebuilds `extraction_run_stage` with the new lifecycle values, mapping legacy values via `USING` expression. |
| `backend/tests/unit/test_extraction_workflow_models.py` | Unit tests for the 5 models + enum values. |
| `backend/tests/integration/test_workflow_tables.py` | Integration tests: table existence, append-only inserts, ReviewerState upsert behavior, optimistic-concurrency on PublishedState. |
| `backend/tests/integration/test_evidence_evolution.py` | Integration tests: new columns exist, CHECK constraint logic. |
| `backend/tests/integration/test_run_stage_enum_migration.py` | Integration tests: enum has new values, legacy rows correctly remapped, can insert new values. |

### Files to modify

| File | Change |
|---|---|
| `backend/app/models/extraction.py` | (a) `ExtractionEvidence`: add the four new columns (nullable initially); (b) `ExtractionRun.stage` enum migration → values match the new `extraction_run_stage` (`pending`, `proposal`, `review`, `consensus`, `finalized`, `cancelled`); update `ExtractionRunStage` Python enum class. |
| `backend/app/models/__init__.py` | Export the 5 new workflow models + the 3 new enums. |
| `backend/app/models/base.py` | Register `extraction_proposal_source`, `extraction_reviewer_decision`, `extraction_consensus_mode` in `POSTGRESQL_ENUM_VALUES`; update `extraction_run_stage` values to the new set. |
| `backend/tests/unit/test_enum_types.py` | Add new enum names to `expected_enums` whitelist. |

---

## Task 1: Workflow models in `extraction_workflow.py` (with enums + base.py registration)

**Files:**
- Create: `backend/app/models/extraction_workflow.py`
- Modify: `backend/app/models/base.py`
- Test: `backend/tests/unit/test_extraction_workflow_models.py`

- [ ] **Step 1: Register the three new enum names in `backend/app/models/base.py:POSTGRESQL_ENUM_VALUES`**

Append in the same "Extraction versioning + HITL config enums" section:

```python
    "extraction_proposal_source": ["ai", "human", "system"],
    "extraction_reviewer_decision": ["accept_proposal", "reject", "edit"],
    "extraction_consensus_mode": ["select_existing", "manual_override"],
```

- [ ] **Step 2: Write the failing unit test**

Create `backend/tests/unit/test_extraction_workflow_models.py`:

```python
"""Unit tests for extraction_workflow models (no DB)."""

from uuid import uuid4

from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)


def test_extraction_proposal_source_enum_values() -> None:
    assert ExtractionProposalSource.AI.value == "ai"
    assert ExtractionProposalSource.HUMAN.value == "human"
    assert ExtractionProposalSource.SYSTEM.value == "system"


def test_extraction_reviewer_decision_type_enum_values() -> None:
    assert ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value == "accept_proposal"
    assert ExtractionReviewerDecisionType.REJECT.value == "reject"
    assert ExtractionReviewerDecisionType.EDIT.value == "edit"


def test_extraction_consensus_mode_enum_values() -> None:
    assert ExtractionConsensusMode.SELECT_EXISTING.value == "select_existing"
    assert ExtractionConsensusMode.MANUAL_OVERRIDE.value == "manual_override"


def test_extraction_proposal_record_instantiation() -> None:
    record = ExtractionProposalRecord(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        source=ExtractionProposalSource.AI.value,
        proposed_value={"text": "candidate"},
        confidence_score=0.91,
        rationale="LLM extracted from page 4",
    )
    assert record.source == "ai"
    assert record.proposed_value == {"text": "candidate"}


def test_extraction_reviewer_decision_instantiation_accept() -> None:
    decision = ExtractionReviewerDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        reviewer_id=uuid4(),
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
        proposal_record_id=uuid4(),
    )
    assert decision.decision == "accept_proposal"
    assert decision.value is None


def test_extraction_reviewer_decision_instantiation_edit() -> None:
    decision = ExtractionReviewerDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        reviewer_id=uuid4(),
        decision=ExtractionReviewerDecisionType.EDIT.value,
        value={"text": "human-edited"},
        rationale="page 5 confirms different value",
    )
    assert decision.decision == "edit"
    assert decision.value == {"text": "human-edited"}


def test_extraction_reviewer_state_instantiation() -> None:
    state = ExtractionReviewerState(
        run_id=uuid4(),
        reviewer_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        current_decision_id=uuid4(),
    )
    assert state.run_id is not None
    assert state.current_decision_id is not None


def test_extraction_consensus_decision_instantiation_select_existing() -> None:
    decision = ExtractionConsensusDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        consensus_user_id=uuid4(),
        mode=ExtractionConsensusMode.SELECT_EXISTING.value,
        selected_decision_id=uuid4(),
    )
    assert decision.mode == "select_existing"


def test_extraction_consensus_decision_instantiation_manual_override() -> None:
    decision = ExtractionConsensusDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        consensus_user_id=uuid4(),
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE.value,
        value={"text": "arbitrator decision"},
        rationale="reviewers diverged; arbitrator decided X",
    )
    assert decision.mode == "manual_override"
    assert decision.value == {"text": "arbitrator decision"}


def test_extraction_published_state_instantiation() -> None:
    state = ExtractionPublishedState(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        value={"text": "final"},
        published_by=uuid4(),
        version=1,
    )
    assert state.version == 1
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/unit/test_extraction_workflow_models.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.models.extraction_workflow'`.

- [ ] **Step 4: Create `extraction_workflow.py` with all 3 enums and 5 model classes**

Create `backend/app/models/extraction_workflow.py`:

```python
"""Extraction HITL workflow models.

Five tables back the proposal → review → consensus → published lifecycle:
- ExtractionProposalRecord: append-only AI/human/system proposals.
- ExtractionReviewerDecision: append-only per-reviewer accept/reject/edit.
- ExtractionReviewerState: materialized current state per (reviewer, run, item).
- ExtractionConsensusDecision: append-only consensus events.
- ExtractionPublishedState: canonical value with optimistic concurrency.

All five share the (run_id, instance_id, field_id) coordinate system that
identifies a single field on a single instance under a single Run.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class ExtractionProposalSource(str, PyEnum):
    """Source of a proposal."""

    AI = "ai"
    HUMAN = "human"
    SYSTEM = "system"


class ExtractionReviewerDecisionType(str, PyEnum):
    """Reviewer decision type."""

    ACCEPT_PROPOSAL = "accept_proposal"
    REJECT = "reject"
    EDIT = "edit"


class ExtractionConsensusMode(str, PyEnum):
    """Consensus resolution mode."""

    SELECT_EXISTING = "select_existing"
    MANUAL_OVERRIDE = "manual_override"


class ExtractionProposalRecord(BaseModel):
    """Append-only proposal: AI/system/human proposes a value for an item."""

    __tablename__ = "extraction_proposal_records"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_proposal_source"),
        nullable=False,
    )
    source_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "idx_extraction_proposal_records_run_item",
            "run_id",
            "instance_id",
            "field_id",
        ),
        CheckConstraint(
            "source <> 'human' OR source_user_id IS NOT NULL",
            name="ck_extraction_proposal_records_human_has_user",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionProposalRecord run={self.run_id} source={self.source}>"


class ExtractionReviewerDecision(BaseModel):
    """Append-only reviewer decision: accept_proposal / reject / edit."""

    __tablename__ = "extraction_reviewer_decisions"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_reviewer_decision"),
        nullable=False,
    )
    proposal_record_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_proposal_records.id", ondelete="SET NULL"),
        nullable=True,
    )
    value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "idx_extraction_reviewer_decisions_run_reviewer_item",
            "run_id",
            "reviewer_id",
            "instance_id",
            "field_id",
            "created_at",
        ),
        CheckConstraint(
            "decision <> 'accept_proposal' OR proposal_record_id IS NOT NULL",
            name="ck_extraction_reviewer_decisions_accept_has_proposal",
        ),
        CheckConstraint(
            "decision <> 'edit' OR value IS NOT NULL",
            name="ck_extraction_reviewer_decisions_edit_has_value",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionReviewerDecision run={self.run_id} reviewer={self.reviewer_id} decision={self.decision}>"


class ExtractionReviewerState(BaseModel):
    """Materialized current decision per (reviewer, run, item) — upsert-maintained."""

    __tablename__ = "extraction_reviewer_states"

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
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    current_decision_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_reviewer_decisions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "reviewer_id",
            "instance_id",
            "field_id",
            name="uq_extraction_reviewer_states_run_reviewer_item",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionReviewerState run={self.run_id} reviewer={self.reviewer_id}>"


class ExtractionConsensusDecision(BaseModel):
    """Append-only consensus event: select_existing or manual_override."""

    __tablename__ = "extraction_consensus_decisions"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    consensus_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    mode: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_consensus_mode"),
        nullable=False,
    )
    selected_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_reviewer_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )
    value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "idx_extraction_consensus_decisions_run_item",
            "run_id",
            "instance_id",
            "field_id",
        ),
        CheckConstraint(
            "mode <> 'select_existing' OR selected_decision_id IS NOT NULL",
            name="ck_extraction_consensus_decisions_select_existing_has_decision",
        ),
        CheckConstraint(
            "mode <> 'manual_override' OR (value IS NOT NULL AND rationale IS NOT NULL)",
            name="ck_extraction_consensus_decisions_manual_override_has_value_rationale",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionConsensusDecision run={self.run_id} mode={self.mode}>"


class ExtractionPublishedState(BaseModel):
    """Canonical value per (run, instance, field) with optimistic concurrency."""

    __tablename__ = "extraction_published_states"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    published_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "instance_id",
            "field_id",
            name="uq_extraction_published_states_run_item",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionPublishedState run={self.run_id} v={self.version}>"
```

- [ ] **Step 5: Run the unit tests to verify they pass**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/unit/test_extraction_workflow_models.py -v
```

Expected: 10 tests PASS.

- [ ] **Step 6: Run ruff**

```bash
cd backend && uv run ruff check app/models/extraction_workflow.py app/models/base.py tests/unit/test_extraction_workflow_models.py
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/extraction_workflow.py backend/app/models/base.py backend/tests/unit/test_extraction_workflow_models.py
git commit -m "feat(extraction): add 5 HITL workflow models + 3 enums (proposal/reviewer/consensus/published)"
```

---

## Task 2: Export workflow models from `app.models.__init__` + update enum whitelist

**Files:**
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/tests/unit/test_enum_types.py`

- [ ] **Step 1: Add the workflow imports to `__init__.py`**

In `backend/app/models/__init__.py`, after the existing `from app.models.extraction_versioning import (...)` block, add:

```python
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
```

Append the same eight names to `__all__` under a new `# Extraction workflow` section comment (alphabetized within the section).

- [ ] **Step 2: Update enum registry whitelist**

In `backend/tests/unit/test_enum_types.py`, in the `expected_enums` set inside `test_all_enums_are_registered`, add:

```python
            "extraction_proposal_source",
            "extraction_reviewer_decision",
            "extraction_consensus_mode",
```

- [ ] **Step 3: Run the unit tests + import smoke test**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/unit/test_extraction_workflow_models.py tests/unit/test_enum_types.py -v
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run python -c "from app.models import ExtractionProposalRecord, ExtractionReviewerDecision, ExtractionReviewerState, ExtractionConsensusDecision, ExtractionPublishedState, ExtractionProposalSource, ExtractionReviewerDecisionType, ExtractionConsensusMode; print('ok')"
```

Expected: tests PASS, smoke test prints `ok`.

- [ ] **Step 4: Run ruff**

```bash
cd backend && uv run ruff check app/models/__init__.py tests/unit/test_enum_types.py
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/__init__.py backend/tests/unit/test_enum_types.py
git commit -m "feat(extraction): export workflow models from app.models package + update enum whitelist"
```

---

## Task 3: Migration `0012` — workflow tables with RLS, triggers, and integration tests

**Files:**
- Create: `backend/alembic/versions/20260427_0012_workflow_tables.py`
- Create: `backend/tests/integration/test_workflow_tables.py`

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/integration/test_workflow_tables.py`:

```python
"""Integration tests for the 5 HITL workflow tables."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


WORKFLOW_TABLES = [
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_workflow_table_exists(db_session: AsyncSession, table_name: str) -> None:
    result = await db_session.execute(
        text(f"SELECT to_regclass('public.{table_name}') AS reg"),
    )
    assert result.scalar() is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_workflow_table_rls_enabled(db_session: AsyncSession, table_name: str) -> None:
    rls = await db_session.execute(
        text(
            f"SELECT relrowsecurity FROM pg_class WHERE oid = 'public.{table_name}'::regclass",
        )
    )
    assert rls.scalar() is True

    policies = await db_session.execute(
        text(f"SELECT count(*) FROM pg_policies WHERE tablename = '{table_name}'"),
    )
    assert policies.scalar() >= 4  # SELECT/INSERT/UPDATE/DELETE


@pytest.mark.asyncio
@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_workflow_table_updated_at_trigger(
    db_session: AsyncSession,
    table_name: str,
) -> None:
    result = await db_session.execute(
        text(
            f"SELECT count(*) FROM pg_trigger WHERE tgname = 'update_{table_name}_updated_at'",
        )
    )
    assert result.scalar() == 1


@pytest.mark.asyncio
async def test_proposal_record_human_requires_user_check(db_session: AsyncSession) -> None:
    # Pull arbitrary FK targets that exist
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_proposal_records
                    (run_id, instance_id, field_id, source, proposed_value)
                VALUES (:run_id, :instance_id, :field_id, 'human', '{}'::jsonb)
                """
            ),
            {"run_id": run_id, "instance_id": instance_id, "field_id": field_id},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reviewer_decision_accept_requires_proposal_check(
    db_session: AsyncSession,
) -> None:
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")
    reviewer_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if reviewer_id is None:
        pytest.skip("No profiles rows.")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_reviewer_decisions
                    (run_id, instance_id, field_id, reviewer_id, decision)
                VALUES (:run_id, :instance_id, :field_id, :reviewer_id, 'accept_proposal')
                """
            ),
            {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "reviewer_id": reviewer_id,
            },
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reviewer_decision_edit_requires_value_check(
    db_session: AsyncSession,
) -> None:
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")
    reviewer_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if reviewer_id is None:
        pytest.skip("No profiles rows.")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_reviewer_decisions
                    (run_id, instance_id, field_id, reviewer_id, decision)
                VALUES (:run_id, :instance_id, :field_id, :reviewer_id, 'edit')
                """
            ),
            {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "reviewer_id": reviewer_id,
            },
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_consensus_decision_select_existing_requires_decision_check(
    db_session: AsyncSession,
) -> None:
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")
    consensus_user_id = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if consensus_user_id is None:
        pytest.skip("No profiles rows.")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_consensus_decisions
                    (run_id, instance_id, field_id, consensus_user_id, mode)
                VALUES (:run_id, :instance_id, :field_id, :user_id, 'select_existing')
                """
            ),
            {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "user_id": consensus_user_id,
            },
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_published_states_unique_per_run_item(db_session: AsyncSession) -> None:
    # Verify the UNIQUE constraint name exists at the DB level.
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'uq_extraction_published_states_run_item'
            """
        )
    )
    assert result.scalar() == "uq_extraction_published_states_run_item"


@pytest.mark.asyncio
async def test_reviewer_states_unique_per_reviewer_item(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'uq_extraction_reviewer_states_run_reviewer_item'
            """
        )
    )
    assert result.scalar() == "uq_extraction_reviewer_states_run_reviewer_item"
```

- [ ] **Step 2: Run the integration tests to verify they fail (tables missing)**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_workflow_tables.py -v
```

Expected: tests FAIL because the workflow tables don't exist.

- [ ] **Step 3: Write the migration**

Create `backend/alembic/versions/20260427_0012_workflow_tables.py`. Follow the same idiom as `0010` (raw SQL via `op.execute`, idempotent enums in `DO $$` blocks, `CREATE TABLE IF NOT EXISTS`, RLS + triggers in dedicated loops).

The migration must:

1. Create three enums idempotently:
   - `extraction_proposal_source` (`ai`, `human`, `system`)
   - `extraction_reviewer_decision` (`accept_proposal`, `reject`, `edit`)
   - `extraction_consensus_mode` (`select_existing`, `manual_override`)

2. Create the five tables matching the model definitions in `extraction_workflow.py`. Each table:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`
   - All FKs on `(run_id, instance_id, field_id)` plus the per-table FKs (e.g. `proposal_record_id`, `reviewer_id`, etc.)
   - All CHECK constraints from the model
   - Indexes from the model
   - Unique constraints from the model

3. RLS — enable on all five tables. Each table derives membership via `extraction_runs` → `project_extraction_templates.project_id`. Use the same pattern as `extraction_template_versions` policies in `0010` but with `extraction_runs` as the join intermediate. Example for select:

   ```sql
   CREATE POLICY extraction_proposal_records_select
     ON public.extraction_proposal_records FOR SELECT
     USING (
         EXISTS (
             SELECT 1
             FROM public.extraction_runs r
             JOIN public.project_extraction_templates t ON t.id = r.template_id
             WHERE r.id = extraction_proposal_records.run_id
               AND public.is_project_member(t.project_id, auth.uid())
         )
     );
   ```

   Use `is_project_member` for SELECT and DELETE; use `is_project_manager` for INSERT and UPDATE. Apply the same four policies (SELECT/INSERT/UPDATE/DELETE) to all five tables, varying only the table name in the policy name and the parent table check.

4. Triggers: `update_<table>_updated_at` on all five tables, calling `public.update_updated_at_column()`. Use the same loop pattern as `0010`.

5. `downgrade()`: drop triggers, then policies (CASCADE handles them via DROP TABLE), then tables in dependency order (states first since they FK to decisions, then decisions, then consensus, then proposals, then published — actually all tables are independent of each other except `reviewer_states.current_decision_id → reviewer_decisions.id`, so drop reviewer_states before reviewer_decisions). Then drop the three enums.

Revision id: `20260427_0012`. Down revision: `20260427_0011`.

- [ ] **Step 4: Apply the migration**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic upgrade head && uv run alembic current
```

Expected: ends at `20260427_0012 (head)`.

- [ ] **Step 5: Run the integration tests**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_workflow_tables.py -v
```

Expected: all PASS (some may skip if the dev DB lacks fixture data for the CHECK-constraint inserts).

- [ ] **Step 6: Verify reversibility**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic downgrade -1 && uv run alembic upgrade head
```

Expected: both clean.

- [ ] **Step 7: Run ruff**

```bash
cd backend && uv run ruff check alembic/versions/20260427_0012_workflow_tables.py tests/integration/test_workflow_tables.py
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/20260427_0012_workflow_tables.py backend/tests/integration/test_workflow_tables.py
git commit -m "feat(extraction): migration 0012 — HITL workflow tables (proposal/reviewer/consensus/published)"
```

---

## Task 4: Add evidence-evolution columns to `ExtractionEvidence` model

**Files:**
- Modify: `backend/app/models/extraction.py`

- [ ] **Step 1: Locate `ExtractionEvidence`**

```bash
grep -n "class ExtractionEvidence" backend/app/models/extraction.py
```

Expected line: ~498.

- [ ] **Step 2: Add `CheckConstraint` to the SQLAlchemy import block**

Find the existing `from sqlalchemy import (...)` block and add `CheckConstraint`.

- [ ] **Step 3: Add four nullable FK columns to `ExtractionEvidence`**

In the class around line 498, after the existing `article_file_id` column (around line 530), add:

```python
    run_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    proposal_record_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_proposal_records.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewer_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_reviewer_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )
    consensus_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_consensus_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )
```

- [ ] **Step 4: Add CHECK constraint to `__table_args__`**

In `ExtractionEvidence.__table_args__` (around line 543), add the CHECK constraint:

```python
    __table_args__ = (
        Index("idx_extraction_evidence_position_gin", "position", postgresql_using="gin"),
        CheckConstraint(
            """
            (run_id IS NOT NULL
             AND (proposal_record_id IS NOT NULL
                  OR reviewer_decision_id IS NOT NULL
                  OR consensus_decision_id IS NOT NULL))
            OR (target_type IS NOT NULL AND target_id IS NOT NULL)
            """,
            name="ck_extraction_evidence_workflow_or_legacy_target",
        ),
        {"schema": "public"},
    )
```

- [ ] **Step 5: Verify the file compiles**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run python -c "
from app.models.extraction import ExtractionEvidence
cols = ExtractionEvidence.__table__.columns
for c in ('run_id', 'proposal_record_id', 'reviewer_decision_id', 'consensus_decision_id'):
    print(c, ':', cols[c].nullable)
ck = [c.name for c in ExtractionEvidence.__table__.constraints if c.name and 'workflow_or_legacy' in c.name]
print('check:', ck)
"
```

Expected: prints all four columns as `True` (nullable) and `check: ['ck_extraction_evidence_workflow_or_legacy_target']`.

- [ ] **Step 6: Run existing tests as smoke check**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/unit/test_extraction_versioning_models.py tests/unit/test_extraction_workflow_models.py tests/unit/test_enum_types.py -q
```

Expected: all PASS.

- [ ] **Step 7: Run ruff**

```bash
cd backend && uv run ruff check app/models/extraction.py
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/extraction.py
git commit -m "feat(extraction): add workflow-FK columns + CHECK constraint to ExtractionEvidence model"
```

---

## Task 5: Migration `0013` — evidence evolution at the DB level

**Files:**
- Create: `backend/alembic/versions/20260427_0013_evidence_evolution.py`
- Create: `backend/tests/integration/test_evidence_evolution.py`

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/integration/test_evidence_evolution.py`:

```python
"""Integration tests for the evidence_evolution migration."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "column",
    ["run_id", "proposal_record_id", "reviewer_decision_id", "consensus_decision_id"],
)
async def test_evidence_column_added(db_session: AsyncSession, column: str) -> None:
    result = await db_session.execute(
        text(
            f"""
            SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_evidence'
              AND column_name = '{column}'
            """
        )
    )
    row = result.first()
    assert row is not None
    assert row[1] == "YES"  # nullable


@pytest.mark.asyncio
async def test_evidence_check_constraint_present(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'ck_extraction_evidence_workflow_or_legacy_target'
            """
        )
    )
    assert result.scalar() == "ck_extraction_evidence_workflow_or_legacy_target"


@pytest.mark.asyncio
async def test_evidence_check_blocks_empty_insert(db_session: AsyncSession) -> None:
    project_id = (await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db_session.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, profile_id)):
        pytest.skip("Need projects/articles/profiles fixtures.")

    # Insert with neither workflow FKs nor legacy target → must fail.
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_evidence (project_id, article_id, created_by)
                VALUES (:project_id, :article_id, :profile_id)
                """
            ),
            {"project_id": project_id, "article_id": article_id, "profile_id": profile_id},
        )
    await db_session.rollback()
```

- [ ] **Step 2: Run the tests to verify they fail (columns missing)**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_evidence_evolution.py -v
```

Expected: tests FAIL because the columns don't exist yet.

- [ ] **Step 3: Write the migration**

Create `backend/alembic/versions/20260427_0013_evidence_evolution.py`:

```python
"""extraction evidence evolution: add workflow FKs and check constraint

Revision ID: 20260427_0013
Revises: 20260427_0012
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0013"
down_revision: str | None = "20260427_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS proposal_record_id uuid REFERENCES public.extraction_proposal_records(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS reviewer_decision_id uuid REFERENCES public.extraction_reviewer_decisions(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS consensus_decision_id uuid REFERENCES public.extraction_consensus_decisions(id) ON DELETE SET NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_evidence_run_id
            ON public.extraction_evidence (run_id);
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            ADD CONSTRAINT ck_extraction_evidence_workflow_or_legacy_target
            CHECK (
                (run_id IS NOT NULL
                 AND (proposal_record_id IS NOT NULL
                      OR reviewer_decision_id IS NOT NULL
                      OR consensus_decision_id IS NOT NULL))
                OR (target_type IS NOT NULL AND target_id IS NOT NULL)
            );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            DROP CONSTRAINT IF EXISTS ck_extraction_evidence_workflow_or_legacy_target;
        """
    )
    op.execute("DROP INDEX IF EXISTS public.idx_extraction_evidence_run_id;")
    op.execute(
        """
        ALTER TABLE public.extraction_evidence
            DROP COLUMN IF EXISTS consensus_decision_id,
            DROP COLUMN IF EXISTS reviewer_decision_id,
            DROP COLUMN IF EXISTS proposal_record_id,
            DROP COLUMN IF EXISTS run_id;
        """
    )
```

- [ ] **Step 4: Apply the migration**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic upgrade head && uv run alembic current
```

Expected: `20260427_0013 (head)`.

- [ ] **Step 5: Run the tests + reversibility**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_evidence_evolution.py -v
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic downgrade -1 && uv run alembic upgrade head
```

Expected: tests pass, reversibility clean.

- [ ] **Step 6: Run ruff**

```bash
cd backend && uv run ruff check alembic/versions/20260427_0013_evidence_evolution.py tests/integration/test_evidence_evolution.py
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/20260427_0013_evidence_evolution.py backend/tests/integration/test_evidence_evolution.py
git commit -m "feat(extraction): migration 0013 — evidence evolution with workflow FKs + CHECK constraint"
```

---

## Task 6: Update `ExtractionRunStage` Python enum + `extraction_run_stage` registry

**Files:**
- Modify: `backend/app/models/extraction.py`
- Modify: `backend/app/models/base.py`

- [ ] **Step 1: Update `ExtractionRunStage` Python enum**

In `backend/app/models/extraction.py`, find the `ExtractionRunStage` class (around line 68) and replace its members with the new lifecycle:

```python
class ExtractionRunStage(str, PyEnum):
    """Estagio da execucao de extraction (HITL lifecycle)."""

    PENDING = "pending"
    PROPOSAL = "proposal"
    REVIEW = "review"
    CONSENSUS = "consensus"
    FINALIZED = "finalized"
    CANCELLED = "cancelled"
```

- [ ] **Step 2: Update `extraction_run_stage` in `base.py:POSTGRESQL_ENUM_VALUES`**

Replace the existing entry:

```python
    "extraction_run_stage": ["pending", "proposal", "review", "consensus", "finalized", "cancelled"],
```

- [ ] **Step 3: Verify file compiles + existing tests pass**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run python -c "from app.models.extraction import ExtractionRunStage; print([s.value for s in ExtractionRunStage])"
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/unit/test_enum_types.py tests/unit/test_extraction_status_enum.py -v
```

Expected: prints `['pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled']`. Tests may need updating if `test_extraction_status_enum.py` hardcodes old values — read its content first:

```bash
grep -n "data_suggest\|parsing\|validation" backend/tests/unit/test_extraction_status_enum.py
```

If old values are referenced, update the test to match the new enum. Replace any reference to `data_suggest` with `proposal`, `parsing` with `proposal`, `validation` with `review`. Then re-run tests.

- [ ] **Step 4: Run ruff**

```bash
cd backend && uv run ruff check app/models/extraction.py app/models/base.py tests/unit/test_extraction_status_enum.py
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/extraction.py backend/app/models/base.py backend/tests/unit/test_extraction_status_enum.py
git commit -m "feat(extraction): migrate ExtractionRunStage Python enum to new lifecycle values"
```

---

## Task 7: Migration `0014` — rebuild `extraction_run_stage` enum with legacy mapping

**Files:**
- Create: `backend/alembic/versions/20260427_0014_run_stage_enum_migration.py`
- Create: `backend/tests/integration/test_run_stage_enum_migration.py`

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/integration/test_run_stage_enum_migration.py`:

```python
"""Integration tests for the extraction_run_stage enum migration."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_run_stage_enum_has_new_values(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT array_agg(enumlabel ORDER BY enumsortorder)
            FROM pg_enum
            WHERE enumtypid = 'extraction_run_stage'::regtype
            """
        )
    )
    labels = result.scalar()
    assert labels == ["pending", "proposal", "review", "consensus", "finalized", "cancelled"]


@pytest.mark.asyncio
async def test_existing_runs_remapped_to_new_stage_values(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT COUNT(*) FROM public.extraction_runs
            WHERE stage::text NOT IN ('pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled')
            """
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_no_legacy_data_suggest_or_parsing_or_validation_remains(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT COUNT(*) FROM public.extraction_runs
            WHERE stage::text IN ('data_suggest', 'parsing', 'validation')
            """
        )
    )
    assert result.scalar() == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_run_stage_enum_migration.py -v
```

Expected: tests FAIL because the enum still has old values.

- [ ] **Step 3: Write the migration**

Create `backend/alembic/versions/20260427_0014_run_stage_enum_migration.py`:

```python
"""run stage enum migration: rebuild with new lifecycle values

Revision ID: 20260427_0014
Revises: 20260427_0013
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0014"
down_revision: str | None = "20260427_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename the existing enum so we can build a fresh one with new values.
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_old;")

    # Create the new enum with the lifecycle values.
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled'
        );
        """
    )

    # Drop default before changing the column type (PG requires no default during USING cast).
    op.execute("ALTER TABLE public.extraction_runs ALTER COLUMN stage DROP DEFAULT;")

    # Convert the column with explicit CASE-mapping from old labels to new ones.
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ALTER COLUMN stage TYPE public.extraction_run_stage
            USING (
                CASE stage::text
                    WHEN 'data_suggest' THEN 'proposal'
                    WHEN 'parsing' THEN 'proposal'
                    WHEN 'validation' THEN 'review'
                    WHEN 'consensus' THEN 'consensus'
                    ELSE 'pending'
                END::public.extraction_run_stage
            );
        """
    )

    # Restore a sensible default for new rows.
    op.execute(
        "ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'pending';"
    )

    # Drop the old enum now that nothing references it.
    op.execute("DROP TYPE public.extraction_run_stage_old;")


def downgrade() -> None:
    # Best-effort downgrade: rebuild the old enum and remap. Some new values
    # have no corresponding old value (`pending`, `finalized`, `cancelled`),
    # so we collapse them onto `data_suggest` to keep rows valid.
    op.execute("ALTER TYPE public.extraction_run_stage RENAME TO extraction_run_stage_new;")
    op.execute(
        """
        CREATE TYPE public.extraction_run_stage AS ENUM (
            'data_suggest', 'parsing', 'validation', 'consensus'
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
                    WHEN 'pending' THEN 'data_suggest'
                    WHEN 'proposal' THEN 'data_suggest'
                    WHEN 'review' THEN 'validation'
                    WHEN 'consensus' THEN 'consensus'
                    WHEN 'finalized' THEN 'consensus'
                    WHEN 'cancelled' THEN 'data_suggest'
                END::public.extraction_run_stage
            );
        """
    )
    op.execute(
        "ALTER TABLE public.extraction_runs ALTER COLUMN stage SET DEFAULT 'data_suggest';"
    )
    op.execute("DROP TYPE public.extraction_run_stage_new;")
```

- [ ] **Step 4: Apply the migration**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic upgrade head && uv run alembic current
```

Expected: `20260427_0014 (head)`.

- [ ] **Step 5: Run the tests**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_run_stage_enum_migration.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Verify reversibility**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run alembic downgrade -1 && uv run alembic upgrade head
```

Expected: both clean.

- [ ] **Step 7: Run ruff**

```bash
cd backend && uv run ruff check alembic/versions/20260427_0014_run_stage_enum_migration.py tests/integration/test_run_stage_enum_migration.py
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/20260427_0014_run_stage_enum_migration.py backend/tests/integration/test_run_stage_enum_migration.py
git commit -m "feat(extraction): migration 0014 — rebuild extraction_run_stage enum with new lifecycle values"
```

---

## Task 8: Run full backend test suite + lint to catch regressions

**Files:** none (verification only)

- [ ] **Step 1: Run full pytest**

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest -q
```

Expected: all tests pass. If any 008 stack test fails because of the stage enum change, fix the test inline (the 008 stack will be dropped in Plan 1D anyway, but we want the suite green now).

- [ ] **Step 2: Run ruff on Plan 1B files only**

```bash
cd backend && uv run ruff check \
  app/models/extraction_workflow.py app/models/base.py app/models/extraction.py app/models/__init__.py \
  alembic/versions/20260427_0012_workflow_tables.py \
  alembic/versions/20260427_0013_evidence_evolution.py \
  alembic/versions/20260427_0014_run_stage_enum_migration.py \
  tests/unit/test_extraction_workflow_models.py tests/unit/test_enum_types.py tests/unit/test_extraction_status_enum.py \
  tests/integration/test_workflow_tables.py \
  tests/integration/test_evidence_evolution.py \
  tests/integration/test_run_stage_enum_migration.py
```

Expected: clean.

- [ ] **Step 3: Run ruff format on Plan 1B files**

```bash
cd backend && uv run ruff format --check \
  app/models/extraction_workflow.py app/models/base.py app/models/extraction.py app/models/__init__.py \
  alembic/versions/20260427_0012_workflow_tables.py \
  alembic/versions/20260427_0013_evidence_evolution.py \
  alembic/versions/20260427_0014_run_stage_enum_migration.py \
  tests/unit/test_extraction_workflow_models.py tests/unit/test_enum_types.py tests/unit/test_extraction_status_enum.py \
  tests/integration/test_workflow_tables.py \
  tests/integration/test_evidence_evolution.py \
  tests/integration/test_run_stage_enum_migration.py
```

If any reformatting needed, run `uv run ruff format <files>` and commit as a follow-up.

---

## Self-review checklist (run before declaring plan done)

- **Spec coverage** for sections 4.4–4.10:
  - ✅ All 5 workflow tables created (Tasks 1, 3) with the right columns and CHECKs.
  - ✅ Evidence evolved to support polymorphic linking (Tasks 4, 5).
  - ✅ Stage enum migrated with legacy mapping (Tasks 6, 7).
  - ✅ Append-only audit pattern (no UPDATE on append-only tables enforced at DB level via CHECK on a `version` column? — NO, append-only is enforced by service layer in Plan 1C; tables themselves allow UPDATE).
  - ✅ Optimistic concurrency on `extraction_published_states` via `version` int column (incremented at app layer in Plan 1C).
- **No placeholders, TBDs, or "implement later" steps.**
- **Type consistency:** `ExtractionProposalSource.AI.value == "ai"` matches enum literal in DB. Same for all enum values.
- **Migration reversibility verified** in Tasks 3, 5, 7.
- **Integration tests use real DB** (`db_session` fixture).
- **Forward-looking concerns** (for Plan 1C):
  - Need to wire `proposal_service`, `review_service`, `consensus_service`, and `run_lifecycle_service`.
  - Need to add `_v2`-style endpoints under `/v1/runs/...` writing through these services.
  - `model_extraction_service` and `section_extraction_service` need to start writing to `extraction_proposal_records` instead of `extracted_values`.

---

## What this plan does NOT do (deferred to Plans 1C/1D/1E)

- Backend services and endpoints. → Plan 1C.
- Synthetic-Run migration that wraps existing `extracted_values` rows. → Plan 1D.
- Drop 008 tables and code. → Plan 1D.
- Frontend `AssessmentShell` + ExtractionFullScreen rewire + PDF collapsed. → Plan 1E.
