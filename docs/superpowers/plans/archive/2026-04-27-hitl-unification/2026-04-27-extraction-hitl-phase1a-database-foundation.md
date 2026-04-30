# Extraction HITL — Phase 1A: Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the foundational database schema (`extraction_template_versions`, `extraction_hitl_configs`, `kind` discriminator with composite-FK coherence) that enables every subsequent phase of the extraction-centric HITL unification.

**Architecture:** Two new tables (`extraction_template_versions`, `extraction_hitl_configs`) plus a `template_kind` enum and `kind` columns on `extraction_templates_global`, `project_extraction_templates`, `extraction_runs`. Coherence between Run and Template kinds is enforced declaratively via composite FK and unique index on `(id, kind)`. No business logic touched in this plan; pure schema groundwork.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 async, Alembic raw-SQL migrations (`op.execute`), pytest with `pytest-asyncio` integration tests against a real PostgreSQL DB.

---

## Plans roadmap (this is Plan 1 of 5)

| # | Plan | Status |
|---|---|---|
| 1A | **Database Foundation** (this plan) — TemplateVersion + HitlConfig + kind discriminator | in this plan |
| 1B | HITL Workflow Tables — Proposal/Reviewer/Consensus/Published/Evidence evolution | pending |
| 1C | Backend Services + Endpoints — `/v1/runs/...` + lifecycle service | pending |
| 1D | Data Migration + Drop 008 — synthetic Runs + drop evaluation_* | pending |
| 1E | Frontend Shell + Refactor — `AssessmentShell`, PDF collapsed, `ExtractionFullScreen` rewire | pending |
| 2 | Quality Assessment — PROBAST + QUADAS-2 seed + QA page | pending |

Each plan is self-contained: it produces working, tested software on its own. Plans 1B–2 will be written one at a time as Plan 1A completes.

---

## Spec reference

`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` sections 4.1, 4.2, 4.3, and parts of 5 (migrations 1 and 2 of the seven-revision sequence).

---

## File structure

### Files to create

| File | Responsibility |
|---|---|
| `backend/app/models/extraction_versioning.py` | New SQLAlchemy models: `ExtractionTemplateVersion`, `ExtractionHitlConfig`, plus `TemplateKind`, `HitlConfigScopeKind`, `ConsensusRule` enums. |
| `backend/alembic/versions/20260427_0010_template_versions_and_hitl_configs.py` | Creates `extraction_template_versions`, `extraction_hitl_configs`, supporting enums; backfills `version=1` snapshot for each existing `project_extraction_template`; adds nullable `version_id` to `extraction_runs` and backfills, then sets NOT NULL. |
| `backend/alembic/versions/20260427_0011_kind_discriminator.py` | Creates `template_kind` enum; adds `kind` columns to `extraction_templates_global`, `project_extraction_templates`, `extraction_runs`; adds unique indexes `(id, kind)` on both template tables; adds composite FK from `extraction_runs (project_template_id, kind)` → `project_extraction_templates (id, kind)`. (Note: existing FK on `template_id` is renamed to `project_template_id` for clarity? No — keep as `template_id` to avoid breaking changes; composite FK references existing column.) |
| `backend/tests/unit/test_extraction_versioning_models.py` | Unit tests (no DB) verifying model class shape, defaults, repr. |
| `backend/tests/integration/test_template_versions_lifecycle.py` | Integration tests against real DB: TemplateVersion CRUD, unique `(project_template_id, version)` constraint, FK cascade. |
| `backend/tests/integration/test_hitl_configs_lifecycle.py` | Integration tests: HitlConfig CRUD per scope, `arbitrator_id` required when `consensus_rule=arbitrator`. |
| `backend/tests/integration/test_kind_discriminator.py` | Integration tests: `kind` defaults to `extraction` on existing rows, composite-FK coherence (insert Run with mismatched kind → fails), unique `(id, kind)` on templates. |

### Files to modify

| File | Change |
|---|---|
| `backend/app/models/extraction.py` | Add `kind` column (TemplateKind enum) to `ExtractionTemplateGlobal` and `ProjectExtractionTemplate`. Add `kind`, `version_id`, `hitl_config_snapshot` columns to `ExtractionRun`. Add new unique constraint metadata `UniqueConstraint("id", "kind")` to both template tables (declarative form for SQLAlchemy reflection; the actual unique index is created by the migration). |
| `backend/app/models/__init__.py` | Export `ExtractionTemplateVersion`, `ExtractionHitlConfig`, `TemplateKind`, `HitlConfigScopeKind`, `ConsensusRule`. |

---

## Test strategy

- **Unit tests** for model class shape (instantiation, default values, `__repr__`). No DB.
- **Integration tests** with real PostgreSQL using existing `db_session` fixture from `backend/tests/conftest.py:85`. Each integration test wraps in a transaction so rollback isolates state.
- **Migration sanity test**: a single integration test that runs `alembic downgrade -1` and `alembic upgrade head` on the test DB to verify reversibility (added at the end of this plan).

The user has a durable preference: tests are written **alongside** each layer, not deferred. Each task below interleaves test writing with implementation.

---

## Task 1: TemplateKind, HitlConfigScopeKind, ConsensusRule enums + ExtractionTemplateVersion model

**Files:**
- Create: `backend/app/models/extraction_versioning.py`
- Test: `backend/tests/unit/test_extraction_versioning_models.py`

- [ ] **Step 1: Write the failing unit test**

Create `backend/tests/unit/test_extraction_versioning_models.py`:

```python
"""Unit tests for extraction_versioning models (no DB)."""

from uuid import uuid4

import pytest

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionTemplateVersion,
    HitlConfigScopeKind,
    TemplateKind,
)


def test_template_kind_enum_values() -> None:
    assert TemplateKind.EXTRACTION.value == "extraction"
    assert TemplateKind.QUALITY_ASSESSMENT.value == "quality_assessment"


def test_hitl_config_scope_kind_enum_values() -> None:
    assert HitlConfigScopeKind.PROJECT.value == "project"
    assert HitlConfigScopeKind.TEMPLATE.value == "template"


def test_consensus_rule_enum_values() -> None:
    assert ConsensusRule.UNANIMOUS.value == "unanimous"
    assert ConsensusRule.MAJORITY.value == "majority"
    assert ConsensusRule.ARBITRATOR.value == "arbitrator"


def test_extraction_template_version_instantiation() -> None:
    project_template_id = uuid4()
    published_by = uuid4()
    version = ExtractionTemplateVersion(
        project_template_id=project_template_id,
        version=1,
        schema_={"entity_types": [], "fields": []},
        published_by=published_by,
        is_active=True,
    )
    assert version.project_template_id == project_template_id
    assert version.version == 1
    assert version.is_active is True
    assert version.schema_ == {"entity_types": [], "fields": []}


def test_extraction_template_version_repr() -> None:
    version = ExtractionTemplateVersion(
        project_template_id=uuid4(),
        version=2,
        schema_={},
        published_by=uuid4(),
    )
    assert "ExtractionTemplateVersion" in repr(version)
    assert "version=2" in repr(version)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_extraction_versioning_models.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.models.extraction_versioning'`.

- [ ] **Step 3: Create `extraction_versioning.py` with enums and TemplateVersion model**

Create `backend/app/models/extraction_versioning.py`:

```python
"""Extraction versioning models: TemplateVersion and HitlConfig.

These tables back the immutable-snapshot template versioning and the
HITL configuration resolution chain (project default + template override).
Both feed Run.hitl_config_snapshot at Run creation time.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class TemplateKind(str, PyEnum):
    """Kind of evaluation a template represents."""

    EXTRACTION = "extraction"
    QUALITY_ASSESSMENT = "quality_assessment"


class HitlConfigScopeKind(str, PyEnum):
    """Scope at which a HITL config applies."""

    PROJECT = "project"
    TEMPLATE = "template"


class ConsensusRule(str, PyEnum):
    """Rule for resolving multi-reviewer consensus."""

    UNANIMOUS = "unanimous"
    MAJORITY = "majority"
    ARBITRATOR = "arbitrator"


class ExtractionTemplateVersion(BaseModel):
    """Immutable snapshot of a project_extraction_template's structure.

    Run.version_id references this table so that altering a template
    in the future does not retroactively affect frozen Runs.
    """

    __tablename__ = "extraction_template_versions"

    project_template_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_: Mapped[dict] = mapped_column("schema", JSONB, nullable=False)
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
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "project_template_id",
            "version",
            name="uq_extraction_template_versions_template_version",
        ),
        Index(
            "idx_extraction_template_versions_active",
            "project_template_id",
            unique=True,
            postgresql_where="is_active",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return (
            f"<ExtractionTemplateVersion template={self.project_template_id} "
            f"version={self.version}>"
        )
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && uv run pytest tests/unit/test_extraction_versioning_models.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/extraction_versioning.py backend/tests/unit/test_extraction_versioning_models.py
git commit -m "feat(extraction): add TemplateKind/HitlConfigScopeKind/ConsensusRule enums and ExtractionTemplateVersion model"
```

---

## Task 2: ExtractionHitlConfig model

**Files:**
- Modify: `backend/app/models/extraction_versioning.py`
- Modify: `backend/tests/unit/test_extraction_versioning_models.py`

- [ ] **Step 1: Write the failing unit test**

Append to `backend/tests/unit/test_extraction_versioning_models.py`:

```python
from app.models.extraction_versioning import ExtractionHitlConfig


def test_extraction_hitl_config_instantiation_project_scope() -> None:
    scope_id = uuid4()
    config = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=scope_id,
        reviewer_count=2,
        consensus_rule=ConsensusRule.ARBITRATOR.value,
        arbitrator_id=uuid4(),
    )
    assert config.scope_kind == "project"
    assert config.scope_id == scope_id
    assert config.reviewer_count == 2
    assert config.consensus_rule == "arbitrator"
    assert config.arbitrator_id is not None


def test_extraction_hitl_config_instantiation_template_scope_unanimous() -> None:
    config = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.TEMPLATE.value,
        scope_id=uuid4(),
        reviewer_count=1,
        consensus_rule=ConsensusRule.UNANIMOUS.value,
        arbitrator_id=None,
    )
    assert config.arbitrator_id is None
    assert config.consensus_rule == "unanimous"


def test_extraction_hitl_config_repr() -> None:
    config = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=uuid4(),
        reviewer_count=2,
        consensus_rule=ConsensusRule.MAJORITY.value,
    )
    assert "ExtractionHitlConfig" in repr(config)
    assert "project" in repr(config)
    assert "majority" in repr(config)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && uv run pytest tests/unit/test_extraction_versioning_models.py -v
```

Expected: 3 new tests FAIL with `ImportError: cannot import name 'ExtractionHitlConfig'`.

- [ ] **Step 3: Add `ExtractionHitlConfig` model to `extraction_versioning.py`**

Append to `backend/app/models/extraction_versioning.py`:

```python
class ExtractionHitlConfig(BaseModel):
    """HITL configuration scoped to a project or a template.

    Resolution at Run creation: template-scoped overrides project-scoped;
    if neither exists, system default applies (1 reviewer, unanimous).
    The resolved config is snapshot-copied to Run.hitl_config_snapshot.
    """

    __tablename__ = "extraction_hitl_configs"

    scope_kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("hitl_config_scope_kind"),
        nullable=False,
    )
    scope_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    reviewer_count: Mapped[int] = mapped_column(Integer, nullable=False)
    consensus_rule: Mapped[str] = mapped_column(
        PostgreSQLEnumType("consensus_rule"),
        nullable=False,
    )
    arbitrator_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "scope_kind",
            "scope_id",
            name="uq_extraction_hitl_configs_scope",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return (
            f"<ExtractionHitlConfig scope={self.scope_kind} "
            f"rule={self.consensus_rule} reviewers={self.reviewer_count}>"
        )
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && uv run pytest tests/unit/test_extraction_versioning_models.py -v
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/extraction_versioning.py backend/tests/unit/test_extraction_versioning_models.py
git commit -m "feat(extraction): add ExtractionHitlConfig model with scope kind + consensus rule"
```

---

## Task 3: Export new models from `app.models.__init__`

**Files:**
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Read the file to find the right insertion point**

```bash
cd backend && grep -n "from app.models.extraction" app/models/__init__.py
```

- [ ] **Step 2: Add imports for the new module**

In `backend/app/models/__init__.py`, after the line `from app.models.extraction import (`, add a new import block immediately following the closing `)` of that import:

```python
from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    ExtractionTemplateVersion,
    HitlConfigScopeKind,
    TemplateKind,
)
```

- [ ] **Step 3: Add the new symbols to `__all__` if it exists**

Search for `__all__` in `backend/app/models/__init__.py`:

```bash
grep -n "__all__" backend/app/models/__init__.py
```

If present, append the five new names. If absent, skip this step.

- [ ] **Step 4: Run the unit tests via the package import to verify nothing broke**

```bash
cd backend && uv run pytest tests/unit/test_extraction_versioning_models.py -v
cd backend && uv run python -c "from app.models import ExtractionTemplateVersion, ExtractionHitlConfig, TemplateKind, HitlConfigScopeKind, ConsensusRule; print('ok')"
```

Expected: tests PASS and the python -c command prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/__init__.py
git commit -m "feat(extraction): export versioning models from app.models package"
```

---

## Task 4: Alembic migration `0010` — create `extraction_template_versions` and `extraction_hitl_configs` tables, backfill v1 for existing templates

**Files:**
- Create: `backend/alembic/versions/20260427_0010_template_versions_and_hitl_configs.py`
- Create: `backend/tests/integration/test_template_versions_lifecycle.py`
- Create: `backend/tests/integration/test_hitl_configs_lifecycle.py`

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/integration/test_template_versions_lifecycle.py`:

```python
"""Integration tests for ExtractionTemplateVersion against a real DB."""

from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import ExtractionTemplateVersion


@pytest.mark.asyncio
async def test_template_version_table_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            "SELECT to_regclass('public.extraction_template_versions') AS reg",
        )
    )
    assert result.scalar() is not None


@pytest.mark.asyncio
async def test_template_version_unique_template_version_constraint(
    db_session: AsyncSession,
) -> None:
    # Pick a real existing project_template_id from backfill (v1 was seeded for each)
    row = await db_session.execute(
        text(
            "SELECT id FROM public.project_extraction_templates LIMIT 1",
        )
    )
    template_id = row.scalar()
    if template_id is None:
        pytest.skip("No project_extraction_templates rows; backfill skipped this test.")

    profile_row = await db_session.execute(
        text("SELECT id FROM public.profiles LIMIT 1"),
    )
    profile_id = profile_row.scalar()
    assert profile_id is not None

    duplicate = ExtractionTemplateVersion(
        project_template_id=template_id,
        version=1,
        schema_={},
        published_by=profile_id,
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_template_version_only_one_active_per_template(
    db_session: AsyncSession,
) -> None:
    row = await db_session.execute(
        text(
            "SELECT id FROM public.project_extraction_templates LIMIT 1",
        )
    )
    template_id = row.scalar()
    if template_id is None:
        pytest.skip("No project_extraction_templates rows.")

    profile_row = await db_session.execute(
        text("SELECT id FROM public.profiles LIMIT 1"),
    )
    profile_id = profile_row.scalar()
    assert profile_id is not None

    # Insert a second active version → must fail unique partial index
    second_active = ExtractionTemplateVersion(
        project_template_id=template_id,
        version=2,
        schema_={"changed": True},
        published_by=profile_id,
        is_active=True,
    )
    db_session.add(second_active)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_template_version_backfill_created_v1_for_each_existing_template(
    db_session: AsyncSession,
) -> None:
    # Every existing project_extraction_template should have at least one version row
    result = await db_session.execute(
        text(
            """
            SELECT t.id
            FROM public.project_extraction_templates t
            LEFT JOIN public.extraction_template_versions v
              ON v.project_template_id = t.id AND v.version = 1
            WHERE v.id IS NULL
            """
        )
    )
    missing = result.fetchall()
    assert missing == []
```

Create `backend/tests/integration/test_hitl_configs_lifecycle.py`:

```python
"""Integration tests for ExtractionHitlConfig."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)


@pytest.mark.asyncio
async def test_hitl_configs_table_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text("SELECT to_regclass('public.extraction_hitl_configs') AS reg"),
    )
    assert result.scalar() is not None


@pytest.mark.asyncio
async def test_hitl_config_insert_project_scope_and_unique_per_scope(
    db_session: AsyncSession,
) -> None:
    project_row = await db_session.execute(
        text("SELECT id FROM public.projects LIMIT 1"),
    )
    project_id = project_row.scalar()
    if project_id is None:
        pytest.skip("No projects rows.")

    a = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=project_id,
        reviewer_count=2,
        consensus_rule=ConsensusRule.MAJORITY.value,
    )
    db_session.add(a)
    await db_session.flush()

    b = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=project_id,
        reviewer_count=3,
        consensus_rule=ConsensusRule.UNANIMOUS.value,
    )
    db_session.add(b)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
```

- [ ] **Step 2: Run the integration tests to verify they fail (table missing)**

```bash
cd backend && uv run pytest tests/integration/test_template_versions_lifecycle.py tests/integration/test_hitl_configs_lifecycle.py -v
```

Expected: all FAIL with `relation "public.extraction_template_versions" does not exist` (and similar for hitl_configs).

- [ ] **Step 3: Write the Alembic migration `0010`**

Create `backend/alembic/versions/20260427_0010_template_versions_and_hitl_configs.py`:

```python
"""extraction template versions and HITL configs

Revision ID: 20260427_0010
Revises: 20260426_0009
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0010"
down_revision: str | None = "20260426_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enums (idempotent)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hitl_config_scope_kind') THEN
                CREATE TYPE hitl_config_scope_kind AS ENUM ('project', 'template');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consensus_rule') THEN
                CREATE TYPE consensus_rule AS ENUM ('unanimous', 'majority', 'arbitrator');
            END IF;
        END
        $$;
        """
    )

    # extraction_template_versions
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_template_versions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_template_id uuid NOT NULL
                REFERENCES public.project_extraction_templates(id) ON DELETE CASCADE,
            version integer NOT NULL,
            schema jsonb NOT NULL,
            published_at timestamptz NOT NULL DEFAULT now(),
            published_by uuid NOT NULL
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            is_active boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_template_versions_template_version
                UNIQUE (project_template_id, version)
        );
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_template_versions_active
            ON public.extraction_template_versions (project_template_id)
            WHERE is_active;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_template_versions_template
            ON public.extraction_template_versions (project_template_id);
        """
    )

    # Backfill: one version=1 per existing project_extraction_template, marked active.
    # schema column captures a snapshot of the current entity_types + fields tree.
    op.execute(
        """
        INSERT INTO public.extraction_template_versions (
            project_template_id, version, schema, published_at, published_by, is_active
        )
        SELECT
            t.id,
            1,
            jsonb_build_object(
                'entity_types', COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', et.id,
                                'name', et.name,
                                'label', et.label,
                                'parent_entity_type_id', et.parent_entity_type_id,
                                'cardinality', et.cardinality,
                                'sort_order', et.sort_order,
                                'is_required', et.is_required,
                                'fields', COALESCE(
                                    (
                                        SELECT jsonb_agg(jsonb_build_object(
                                            'id', f.id,
                                            'name', f.name,
                                            'label', f.label,
                                            'field_type', f.field_type,
                                            'is_required', f.is_required,
                                            'allowed_values', f.allowed_values,
                                            'sort_order', f.sort_order
                                        ) ORDER BY f.sort_order)
                                        FROM public.extraction_fields f
                                        WHERE f.entity_type_id = et.id
                                    ),
                                    '[]'::jsonb
                                )
                            ) ORDER BY et.sort_order
                        )
                        FROM public.extraction_entity_types et
                        WHERE et.project_template_id = t.id
                    ),
                    '[]'::jsonb
                )
            ),
            now(),
            t.created_by,
            true
        FROM public.project_extraction_templates t
        WHERE NOT EXISTS (
            SELECT 1 FROM public.extraction_template_versions v
            WHERE v.project_template_id = t.id
        );
        """
    )

    # extraction_hitl_configs
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_hitl_configs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            scope_kind hitl_config_scope_kind NOT NULL,
            scope_id uuid NOT NULL,
            reviewer_count integer NOT NULL CHECK (reviewer_count >= 1),
            consensus_rule consensus_rule NOT NULL,
            arbitrator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_hitl_configs_scope UNIQUE (scope_kind, scope_id),
            CONSTRAINT ck_extraction_hitl_configs_arbitrator_required
                CHECK (consensus_rule <> 'arbitrator' OR arbitrator_id IS NOT NULL)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_hitl_configs_scope
            ON public.extraction_hitl_configs (scope_kind, scope_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.extraction_hitl_configs CASCADE;")
    op.execute("DROP TABLE IF EXISTS public.extraction_template_versions CASCADE;")
    op.execute("DROP TYPE IF EXISTS consensus_rule;")
    op.execute("DROP TYPE IF EXISTS hitl_config_scope_kind;")
```

- [ ] **Step 4: Apply the migration**

```bash
cd backend && uv run alembic upgrade head
```

Expected output ends with `INFO  [alembic.runtime.migration] Running upgrade 20260426_0009 -> 20260427_0010, extraction template versions and HITL configs`.

- [ ] **Step 5: Run the integration tests to verify they pass**

```bash
cd backend && uv run pytest tests/integration/test_template_versions_lifecycle.py tests/integration/test_hitl_configs_lifecycle.py -v
```

Expected: all PASS.

- [ ] **Step 6: Verify migration is reversible**

```bash
cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
```

Expected: both commands complete without error; final state is the same as before.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/20260427_0010_template_versions_and_hitl_configs.py \
        backend/tests/integration/test_template_versions_lifecycle.py \
        backend/tests/integration/test_hitl_configs_lifecycle.py
git commit -m "feat(extraction): migration 0010 — template versions + HITL configs tables with v1 backfill"
```

---

## Task 5: Add `kind` discriminator to ExtractionTemplateGlobal and ProjectExtractionTemplate models

**Files:**
- Modify: `backend/app/models/extraction.py`

- [ ] **Step 1: Read current state of the two model classes**

```bash
cd backend && grep -n "class ExtractionTemplateGlobal\|class ProjectExtractionTemplate" app/models/extraction.py
```

Expected lines: `108` and `146` (per spec reference).

- [ ] **Step 2: Add `kind` import and column to `ExtractionTemplateGlobal`**

In `backend/app/models/extraction.py`:

1. Add `UniqueConstraint` to the existing `from sqlalchemy import (...)` block (find the `import (` block near line 13–23 and append `UniqueConstraint`).

2. Below the existing `ExtractionInstanceStatus` class (around line 105), confirm enums are present. Don't add a new TemplateKind enum here — it already lives in `extraction_versioning.py`. Import it:

```python
from app.models.extraction_versioning import TemplateKind  # noqa: F401  (re-exported via __init__)
```

Add this import near the other `from app.models...` imports.

3. In `ExtractionTemplateGlobal` (around line 108), after the `version` column, add the `kind` column:

```python
    kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("template_kind"),
        nullable=False,
        default=TemplateKind.EXTRACTION.value,
        server_default=TemplateKind.EXTRACTION.value,
    )
```

4. Update `ExtractionTemplateGlobal.__table_args__` (around line 137) to include the new unique index:

```python
    __table_args__ = (
        Index("idx_extraction_templates_global_schema_gin", "schema", postgresql_using="gin"),
        UniqueConstraint("id", "kind", name="uq_extraction_templates_global_id_kind"),
        {"schema": "public"},
    )
```

- [ ] **Step 3: Add `kind` column and unique constraint to `ProjectExtractionTemplate`**

In the same file, find `ProjectExtractionTemplate` (line 146). After the `version` column, add the same `kind` column (identical block as Step 2.3).

Update its `__table_args__` (around line 200):

```python
    __table_args__ = (
        Index("idx_project_extraction_templates_schema_gin", "schema", postgresql_using="gin"),
        UniqueConstraint("id", "kind", name="uq_project_extraction_templates_id_kind"),
        {"schema": "public"},
    )
```

- [ ] **Step 4: Verify the file compiles**

```bash
cd backend && uv run python -c "from app.models.extraction import ExtractionTemplateGlobal, ProjectExtractionTemplate; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/extraction.py
git commit -m "feat(extraction): add kind column to ExtractionTemplateGlobal and ProjectExtractionTemplate models"
```

---

## Task 6: Add `kind`, `version_id`, `hitl_config_snapshot` to ExtractionRun model

**Files:**
- Modify: `backend/app/models/extraction.py`

- [ ] **Step 1: Locate the `ExtractionRun` class**

```bash
cd backend && grep -n "class ExtractionRun" app/models/extraction.py
```

Expected line: `553`.

- [ ] **Step 2: Add the three columns and the composite-FK declaration**

In `backend/app/models/extraction.py`, in `ExtractionRun` (around line 553), after the existing `template_id` mapped_column block (around line 583), add:

```python
    kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("template_kind"),
        nullable=False,
        default=TemplateKind.EXTRACTION.value,
        server_default=TemplateKind.EXTRACTION.value,
    )

    version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_template_versions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    hitl_config_snapshot: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
    )
```

- [ ] **Step 3: Document the composite-FK constraint in `__table_args__`**

In `ExtractionRun.__table_args__` (around line 629), add a `ForeignKeyConstraint` (import it at the top of the file alongside `ForeignKey`):

```python
    __table_args__ = (
        Index("idx_extraction_runs_status_stage", "status", "stage"),
        Index("idx_extraction_runs_parameters_gin", "parameters", postgresql_using="gin"),
        Index("idx_extraction_runs_results_gin", "results", postgresql_using="gin"),
        ForeignKeyConstraint(
            ["template_id", "kind"],
            [
                "public.project_extraction_templates.id",
                "public.project_extraction_templates.kind",
            ],
            name="fk_extraction_runs_template_kind_coherence",
        ),
        {"schema": "public"},
    )
```

Add `ForeignKeyConstraint` to the SQLAlchemy import block at the top of the file.

- [ ] **Step 4: Verify the file compiles**

```bash
cd backend && uv run python -c "from app.models.extraction import ExtractionRun; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/extraction.py
git commit -m "feat(extraction): add kind, version_id, hitl_config_snapshot, and composite FK to ExtractionRun model"
```

---

## Task 7: Alembic migration `0011` — `template_kind` enum, `kind` columns on three tables, composite FK + unique indexes

**Files:**
- Create: `backend/alembic/versions/20260427_0011_kind_discriminator.py`
- Create: `backend/tests/integration/test_kind_discriminator.py`

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/integration/test_kind_discriminator.py`:

```python
"""Integration tests for the kind discriminator and composite-FK coherence."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_kind_column_exists_on_global_template(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_templates_global'
              AND column_name = 'kind'
            """
        )
    )
    assert result.scalar() == "kind"


@pytest.mark.asyncio
async def test_kind_column_exists_on_project_template(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'project_extraction_templates'
              AND column_name = 'kind'
            """
        )
    )
    assert result.scalar() == "kind"


@pytest.mark.asyncio
async def test_kind_column_exists_on_run(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_runs'
              AND column_name IN ('kind', 'version_id', 'hitl_config_snapshot')
            ORDER BY column_name
            """
        )
    )
    cols = [row[0] for row in result.fetchall()]
    assert cols == ["hitl_config_snapshot", "kind", "version_id"]


@pytest.mark.asyncio
async def test_existing_templates_backfilled_to_extraction_kind(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM public.project_extraction_templates WHERE kind <> 'extraction'",
        )
    )
    assert result.scalar() == 0

    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM public.extraction_templates_global WHERE kind <> 'extraction'",
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_existing_runs_backfilled_to_extraction_kind(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM public.extraction_runs WHERE kind <> 'extraction'",
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_unique_id_kind_index_on_project_templates(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'uq_project_extraction_templates_id_kind'
            """
        )
    )
    assert result.scalar() == "uq_project_extraction_templates_id_kind"


@pytest.mark.asyncio
async def test_composite_fk_blocks_kind_mismatch(
    db_session: AsyncSession,
) -> None:
    # Composite FK on (template_id, kind) must reject a Run.kind that doesn't
    # match its Template.kind. PostgreSQL enforces FKs at statement time when
    # NOT DEFERRABLE (the default), so the UPDATE itself raises.
    row_count = await db_session.execute(
        text("SELECT COUNT(*) FROM public.extraction_runs"),
    )
    if row_count.scalar() == 0:
        pytest.skip("No extraction_runs rows to test FK coherence.")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                UPDATE public.extraction_runs
                SET kind = 'quality_assessment'
                WHERE id = (SELECT id FROM public.extraction_runs LIMIT 1)
                """
            )
        )
    await db_session.rollback()
```

- [ ] **Step 2: Run the integration tests to verify they fail (kind column missing)**

```bash
cd backend && uv run pytest tests/integration/test_kind_discriminator.py -v
```

Expected: tests FAIL because `kind` columns don't exist yet.

- [ ] **Step 3: Write the Alembic migration `0011`**

Create `backend/alembic/versions/20260427_0011_kind_discriminator.py`:

```python
"""kind discriminator on templates and runs

Revision ID: 20260427_0011
Revises: 20260427_0010
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0011"
down_revision: str | None = "20260427_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # template_kind enum
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_kind') THEN
                CREATE TYPE template_kind AS ENUM ('extraction', 'quality_assessment');
            END IF;
        END
        $$;
        """
    )

    # Add kind to extraction_templates_global (nullable, default extraction; backfill; NOT NULL)
    op.execute(
        """
        ALTER TABLE public.extraction_templates_global
            ADD COLUMN IF NOT EXISTS kind template_kind;
        UPDATE public.extraction_templates_global SET kind = 'extraction' WHERE kind IS NULL;
        ALTER TABLE public.extraction_templates_global
            ALTER COLUMN kind SET NOT NULL,
            ALTER COLUMN kind SET DEFAULT 'extraction';
        ALTER TABLE public.extraction_templates_global
            ADD CONSTRAINT uq_extraction_templates_global_id_kind UNIQUE (id, kind);
        """
    )

    # Add kind to project_extraction_templates
    op.execute(
        """
        ALTER TABLE public.project_extraction_templates
            ADD COLUMN IF NOT EXISTS kind template_kind;
        UPDATE public.project_extraction_templates SET kind = 'extraction' WHERE kind IS NULL;
        ALTER TABLE public.project_extraction_templates
            ALTER COLUMN kind SET NOT NULL,
            ALTER COLUMN kind SET DEFAULT 'extraction';
        ALTER TABLE public.project_extraction_templates
            ADD CONSTRAINT uq_project_extraction_templates_id_kind UNIQUE (id, kind);
        """
    )

    # Add kind, version_id, hitl_config_snapshot to extraction_runs.
    # version_id is nullable initially so we can backfill from extraction_template_versions.
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ADD COLUMN IF NOT EXISTS kind template_kind,
            ADD COLUMN IF NOT EXISTS version_id uuid,
            ADD COLUMN IF NOT EXISTS hitl_config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

        UPDATE public.extraction_runs SET kind = 'extraction' WHERE kind IS NULL;

        UPDATE public.extraction_runs r
        SET version_id = v.id
        FROM public.extraction_template_versions v
        WHERE v.project_template_id = r.template_id
          AND v.version = 1
          AND r.version_id IS NULL;

        ALTER TABLE public.extraction_runs
            ALTER COLUMN kind SET NOT NULL,
            ALTER COLUMN kind SET DEFAULT 'extraction',
            ALTER COLUMN version_id SET NOT NULL;

        ALTER TABLE public.extraction_runs
            ADD CONSTRAINT fk_extraction_runs_version_id
                FOREIGN KEY (version_id)
                REFERENCES public.extraction_template_versions (id)
                ON DELETE RESTRICT;

        ALTER TABLE public.extraction_runs
            ADD CONSTRAINT fk_extraction_runs_template_kind_coherence
                FOREIGN KEY (template_id, kind)
                REFERENCES public.project_extraction_templates (id, kind)
                ON DELETE CASCADE;

        CREATE INDEX IF NOT EXISTS idx_extraction_runs_kind
            ON public.extraction_runs (kind);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            DROP CONSTRAINT IF EXISTS fk_extraction_runs_template_kind_coherence,
            DROP CONSTRAINT IF EXISTS fk_extraction_runs_version_id,
            DROP COLUMN IF EXISTS hitl_config_snapshot,
            DROP COLUMN IF EXISTS version_id,
            DROP COLUMN IF EXISTS kind;
        DROP INDEX IF EXISTS public.idx_extraction_runs_kind;

        ALTER TABLE public.project_extraction_templates
            DROP CONSTRAINT IF EXISTS uq_project_extraction_templates_id_kind,
            DROP COLUMN IF EXISTS kind;

        ALTER TABLE public.extraction_templates_global
            DROP CONSTRAINT IF EXISTS uq_extraction_templates_global_id_kind,
            DROP COLUMN IF EXISTS kind;

        DROP TYPE IF EXISTS template_kind;
        """
    )
```

- [ ] **Step 4: Apply the migration**

```bash
cd backend && uv run alembic upgrade head
```

Expected output ends with `Running upgrade 20260427_0010 -> 20260427_0011, kind discriminator on templates and runs`.

- [ ] **Step 5: Run the integration tests**

```bash
cd backend && uv run pytest tests/integration/test_kind_discriminator.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 6: Verify migration is reversible**

```bash
cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
```

Expected: both commands complete without error.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/20260427_0011_kind_discriminator.py \
        backend/tests/integration/test_kind_discriminator.py
git commit -m "feat(extraction): migration 0011 — kind discriminator on templates/runs with composite-FK coherence"
```

---

## Task 8: Run the full backend test suite to catch regressions

**Files:** none (verification only)

- [ ] **Step 1: Run full backend pytest**

```bash
cd backend && uv run pytest -q
```

Expected: zero failures. Existing 008-related tests may still pass since 008 tables remain untouched in this plan; they will be removed in Plan 1D. If any test fails because of unexpected coupling, fix it inline (most likely a model `repr` test that mentions a column we haven't added).

- [ ] **Step 2: Run the lint suite**

```bash
cd backend && uv run ruff check . && uv run ruff format --check .
```

Expected: no errors. If ruff reports import-order issues from the new files, run `uv run ruff format .` and re-commit.

- [ ] **Step 3: If lint required formatting changes, commit them**

```bash
git add -p
git commit -m "chore(extraction): apply ruff formatting after schema additions"
```

(Skip if no changes were needed.)

---

## Self-review checklist (run before declaring plan done)

After all 8 tasks, verify:

- **Spec coverage** for sections 4.1, 4.2, 4.3:
  - ✅ `kind` enum on Template + Run (Tasks 5, 6, 7)
  - ✅ Composite FK + unique index `(id, kind)` (Tasks 5, 6, 7)
  - ✅ `extraction_template_versions` table with v1 backfill (Tasks 1, 4)
  - ✅ `extraction_hitl_configs` table with scope/consensus rule (Tasks 2, 4)
  - ✅ `extraction_runs.version_id`, `extraction_runs.hitl_config_snapshot` columns (Tasks 6, 7)
- **No placeholders, TBDs, or "implement later" steps.**
- **Type consistency:** `TemplateKind.EXTRACTION.value` is the literal `"extraction"` and matches the SQL enum value. `ConsensusRule` and `HitlConfigScopeKind` likewise.
- **Migration reversibility verified** in Tasks 4 and 7.
- **Integration tests use real DB** (`db_session` fixture from `backend/tests/conftest.py:85`).
- **Unit tests stand alone** (no DB needed).

---

## What this plan does NOT do (deferred to later plans)

- Workflow tables (`extraction_proposal_records`, `extraction_reviewer_decisions`, `extraction_reviewer_states`, `extraction_consensus_decisions`, `extraction_published_states`). → Plan 1B.
- Evidence evolution. → Plan 1B.
- Run stage enum migration to (`pending`, `proposal`, `review`, `consensus`, `finalized`, `cancelled`). → Plan 1B.
- Backend services (`hitl_config_service`, `run_lifecycle_service`, `proposal_service`, `review_service`, `consensus_service`). → Plan 1C.
- Backend endpoints `/v1/runs/...`. → Plan 1C.
- Refactor of `model_extraction_service` and `section_extraction_service` to write through new lifecycle. → Plan 1C.
- Synthetic-Run migration for existing `extracted_values`. → Plan 1D.
- Drop 008 tables, endpoints, frontend stubs. → Plan 1D.
- Frontend `AssessmentShell`, PDF collapsed default, `ExtractionFullScreen` rewire. → Plan 1E.
- Quality Assessment templates and page. → Plan 2.
