# Screening Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the database schema, SQLAlchemy models, and repositories for the screening + imports module so subsequent phases can build services and APIs on top.

**Architecture:** Greenfield, modular. 8 new tables + cross-cutting `ai_usage_log` + one column on `articles` maintained by trigger. Mirrors the existing extraction HITL/consensus pattern (separate rows, same shapes). Optimistic concurrency via `version` columns. AI/AL seams present (columns exist, defaults off) but no AI code in this phase.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, asyncpg, PostgreSQL via Supabase, pytest + pytest-asyncio.

**Spec:** [`docs/superpowers/specs/2026-05-03-screening-and-imports-design.md`](../specs/2026-05-03-screening-and-imports-design.md)
**Design system:** [`docs/superpowers/design-system/sidebar-and-panels.md`](../design-system/sidebar-and-panels.md)

---

## Phase Roadmap (overall)

This is **Phase 0 of 7**. Each subsequent phase gets its own plan, written when the previous one lands.

| Phase | Scope | Plan |
|---|---|---|
| **0 (this plan)** | Schema + SQLAlchemy models + repositories | foundation |
| 1 | Backend services (config, workflow, analytics, notes, prefs) + endpoints | future |
| 2 | Imports module (CSV, PubMed, RIS, PDF-manual, Unpaywall) — backend + frontend | future |
| 3 | Frontend foundation (routing, hooks, types, design-system bindings, layout shell) | future |
| 4 | Frontend screening loop (3-col, queue, card, decision flow, optimistic UX) | future |
| 5 | Frontend conflicts/arbitration + dashboard (kappa, PRISMA, smart filters) | future |
| 6 | Frontend settings + ⌘K command palette + custom-shortcut UI + polish | future |
| 7 | E2E tests + feature-flag rollout | future |

---

## Conventions

- **Branch / worktree:** Work in a dedicated worktree (e.g. `screening-phase0`) on branch `feat/screening-phase0`. Use the `superpowers:using-git-worktrees` skill.
- **Language:** All identifiers, comments, commit messages, and copy in **English** per `CLAUDE.md`.
- **TDD where it matters:** Repositories and trigger behaviour get proper TDD with pytest + real Postgres. Models get smoke tests (registration + basic relationships). Migrations get up/down tests. SQL is verified by applying it; no test-first for migration DDL.
- **Test commands:**
  - Run all backend tests: `cd backend && pytest -xvs`
  - Run a single test file: `cd backend && pytest tests/integration/test_screening_repositories.py -xvs`
  - Run a single test: `cd backend && pytest tests/integration/test_screening_repositories.py::TestX::test_y -xvs`
- **Migrations:**
  - Apply Alembic: `cd backend && alembic upgrade head`
  - Apply Supabase: `make supabase-migrate` (the actual Make target). To start the local Supabase database first: `make supabase-start`.
  - Roll back one Alembic step: `cd backend && alembic downgrade -1`
- **Repository pattern:** Use `flush()` not `commit()`. Commit happens in services via `UnitOfWork` or in tests directly.
- **Conventional Commits, frequent.** Commit after every passing test or coherent unit of work.

---

## Files Created / Modified

### Created
- `supabase/migrations/0004_screening_enums.sql`
- `backend/alembic/versions/0011_add_screening.py`
- `backend/app/models/screening.py` — 6 core screening models
- `backend/app/models/screening_note.py`
- `backend/app/models/screening_user_preference.py`
- `backend/app/models/ai_usage_log.py`
- `backend/app/repositories/screening_phase_config_repository.py`
- `backend/app/repositories/screening_criterion_repository.py`
- `backend/app/repositories/screening_assignment_repository.py`
- `backend/app/repositories/screening_decision_repository.py`
- `backend/app/repositories/screening_outcome_repository.py`
- `backend/app/repositories/screening_run_repository.py`
- `backend/app/repositories/screening_note_repository.py`
- `backend/app/repositories/screening_user_preference_repository.py`
- `backend/app/repositories/ai_usage_log_repository.py`
- `backend/tests/integration/test_screening_migration.py`
- `backend/tests/integration/test_screening_models.py`
- `backend/tests/integration/test_screening_triggers.py`
- `backend/tests/integration/test_screening_repositories.py`

### Modified
- `backend/app/models/base.py` — register 7 new enum types in `POSTGRESQL_ENUM_VALUES`
- `backend/app/models/article.py` — add `screening_status` column + index registration + back-populates relationship
- `backend/app/models/__init__.py` — export new models

---

## Phase A — Database migration

### Task A1: Create Supabase enum migration

**Files:**
- Create: `supabase/migrations/0004_screening_enums.sql`

- [ ] **Step 1: Write the SQL**

Create the file with these 7 enum types (matches spec §4.1 exactly):

```sql
-- Screening + imports module enums (Phase α)
-- Source of truth for enum names: backend/app/models/base.py:POSTGRESQL_ENUM_VALUES

CREATE TYPE screening_phase AS ENUM (
  'title_abstract',
  'full_text'
);

CREATE TYPE screening_decision AS ENUM (
  'include',
  'exclude',
  'maybe'
);

CREATE TYPE screening_status AS ENUM (
  'pre_included',
  'ta_pending', 'ta_included', 'ta_excluded', 'ta_maybe',
  'ft_pending', 'ft_included', 'ft_excluded', 'ft_maybe',
  'final_included', 'final_excluded'
);

CREATE TYPE screening_consensus_rule AS ENUM (
  'unanimous',
  'majority',
  'arbitrated'
);

CREATE TYPE screening_outcome_source AS ENUM (
  'solo',
  'consensus_unanimous',
  'consensus_majority',
  'arbitrated'
);

CREATE TYPE screening_arbitration_mode AS ENUM (
  'select_existing',
  'manual_override'
);

CREATE TYPE screening_run_kind AS ENUM (
  'import_csv',
  'import_ris',
  'import_pubmed',
  'import_pdf',
  'unpaywall_fetch',
  'smart_filter_refresh',
  'ai_screen_single',
  'ai_screen_batch',
  'priority_retrain'
);

CREATE TYPE screening_run_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
);
```

Note: `screening_run_kind` includes the AI/AL kinds even though Phase 0 won't use them — saves a future migration.

- [ ] **Step 2: Apply locally**

```bash
make supabase-migrate
```

Expected: migration applies without error. Verify in psql:
```bash
psql "$DATABASE_URL" -c "\dT screening_*"
```
Expected: shows the 7 new enum types (`screening_phase`, `screening_decision`, `screening_status`, `screening_consensus_rule`, `screening_outcome_source`, `screening_arbitration_mode`, `screening_run_kind`) plus `screening_run_status`. So 8 rows total (7 enums starting with `screening_` + the run_status one).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_screening_enums.sql
git commit -m "feat(db): add screening + imports module enums"
```

---

### Task A2: Register enums in `models/base.py`

**Files:**
- Modify: `backend/app/models/base.py` — add to `POSTGRESQL_ENUM_VALUES` dict

- [ ] **Step 1: Read the existing dict**

```bash
grep -n "POSTGRESQL_ENUM_VALUES" backend/app/models/base.py
```

You'll find the dict around line 27. New entries go inside the closing `}` before the class definition.

- [ ] **Step 2: Add the 7 new entries**

In `backend/app/models/base.py`, inside `POSTGRESQL_ENUM_VALUES`, add after the existing entries:

```python
    # Screening enums (added 2026-05-03)
    "screening_phase": ["title_abstract", "full_text"],
    "screening_decision": ["include", "exclude", "maybe"],
    "screening_status": [
        "pre_included",
        "ta_pending", "ta_included", "ta_excluded", "ta_maybe",
        "ft_pending", "ft_included", "ft_excluded", "ft_maybe",
        "final_included", "final_excluded",
    ],
    "screening_consensus_rule": ["unanimous", "majority", "arbitrated"],
    "screening_outcome_source": [
        "solo", "consensus_unanimous", "consensus_majority", "arbitrated",
    ],
    "screening_arbitration_mode": ["select_existing", "manual_override"],
    "screening_run_kind": [
        "import_csv", "import_ris", "import_pubmed", "import_pdf",
        "unpaywall_fetch", "smart_filter_refresh",
        "ai_screen_single", "ai_screen_batch", "priority_retrain",
    ],
    "screening_run_status": ["pending", "running", "completed", "failed", "cancelled"],
```

- [ ] **Step 3: Verify nothing else broke**

```bash
cd backend && python -c "from app.models.base import POSTGRESQL_ENUM_VALUES; print(len(POSTGRESQL_ENUM_VALUES), 'enums registered')"
```

Expected: a count higher than before (count was 17 before this addition, should be 25 after).

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/base.py
git commit -m "feat(db): register screening enums in POSTGRESQL_ENUM_VALUES"
```

---

### Task A3: Scaffold the Alembic migration

**Files:**
- Create: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Write the file scaffold**

```python
"""add screening + imports module: 8 tables, articles.screening_status, triggers

Revision ID: 0011_add_screening
Revises: 0010_lock_handle_new_user
Create Date: 2026-05-03

Greenfield screening module + cross-cutting ai_usage_log table.
Adds articles.screening_status (single source of truth for screening verdict)
maintained atomically by AFTER triggers on screening_outcome and screening_assignment.

Enum types are created in supabase/migrations/0004_screening_enums.sql.
This migration uses ENUM types via PostgreSQLEnumType (create_type=False).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0011_add_screening"
down_revision = "0010_lock_handle_new_user"
branch_labels = None
depends_on = None


def upgrade() -> None:
    _create_tables()
    _add_articles_column()
    _create_triggers()


def downgrade() -> None:
    _drop_triggers()
    _drop_articles_column()
    _drop_tables()


# Helper functions defined below — populated in subsequent tasks.

def _create_tables() -> None:
    pass  # Filled in tasks A4–A12

def _add_articles_column() -> None:
    pass  # Filled in task A13

def _create_triggers() -> None:
    pass  # Filled in tasks A14–A15

def _drop_tables() -> None:
    pass  # Filled in tasks A4–A12 (mirror order, reversed)

def _drop_articles_column() -> None:
    pass  # Filled in task A13

def _drop_triggers() -> None:
    pass  # Filled in tasks A14–A15
```

- [ ] **Step 2: Verify Alembic discovers it**

```bash
cd backend && alembic history --verbose | head -8
```

Expected: shows `0011_add_screening` at the top with `Revises: 0010_lock_handle_new_user`.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): scaffold alembic 0011 for screening tables"
```

---

### Task A4: Add `screening_phase_config` to migration

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py:_create_tables`

- [ ] **Step 1: Implement the table inside `_create_tables`**

Add inside `_create_tables`:

```python
    op.create_table(
        "screening_phase_config",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("phase", postgresql.ENUM("title_abstract", "full_text",
                                           name="screening_phase", create_type=False),
                  nullable=False),
        sa.Column("reviewer_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("consensus_rule", postgresql.ENUM("unanimous", "majority", "arbitrated",
                                                     name="screening_consensus_rule",
                                                     create_type=False),
                  nullable=False, server_default="unanimous"),
        sa.Column("arbitrator_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("blind_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("require_exclusion_reason", sa.Boolean(), nullable=False),
        sa.Column("ai_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ai_model", sa.String(64), nullable=True),
        sa.Column("ai_system_instruction", sa.Text(), nullable=True),
        sa.Column("active_learning_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("highlight_terms", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("pico_summary", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.CheckConstraint("reviewer_count BETWEEN 1 AND 5", name="ck_phase_config_reviewer_count"),
        sa.UniqueConstraint("project_id", "phase", name="uq_phase_config_project_phase"),
    )
```

- [ ] **Step 2: Add the matching drop in `_drop_tables`**

```python
    op.drop_table("screening_phase_config")
```

- [ ] **Step 3: Verify the migration applies**

```bash
cd backend && alembic upgrade head
psql "$DATABASE_URL" -c "\d screening_phase_config"
```

Expected: table exists with all columns and the unique constraint.

- [ ] **Step 4: Verify rollback**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
```

Expected: both succeed with no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_phase_config table"
```

---

### Task A5: Add `screening_criterion` to migration

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement inside `_create_tables`** (after `screening_phase_config`)

```python
    op.create_table(
        "screening_criterion",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("phase", postgresql.ENUM(name="screening_phase", create_type=False),
                  nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.CheckConstraint("kind IN ('inclusion','exclusion')", name="ck_criterion_kind"),
    )
    op.create_index(
        "idx_screening_criterion_project_phase",
        "screening_criterion",
        ["project_id", "phase", "ordinal"],
        postgresql_where=sa.text("is_active"),
    )
```

- [ ] **Step 2: Add drop (in reverse order in `_drop_tables`)**

```python
    op.drop_index("idx_screening_criterion_project_phase", table_name="screening_criterion")
    op.drop_table("screening_criterion")
```

- [ ] **Step 3: Verify**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
psql "$DATABASE_URL" -c "\d screening_criterion"
```

Expected: table + partial index visible.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_criterion table"
```

---

### Task A6: Add `screening_assignment`

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement** (after criterion in `_create_tables`)

```python
    op.create_table(
        "screening_assignment",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("article_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("phase", postgresql.ENUM(name="screening_phase", create_type=False),
                  nullable=False),
        sa.Column("current_priority", sa.Numeric(), nullable=True),
        sa.Column("priority_model_version", sa.String(64), nullable=True),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "article_id", "phase", name="uq_assignment_project_article_phase"),
    )
    op.create_index(
        "idx_screening_assignment_priority",
        "screening_assignment",
        ["project_id", "phase",
         sa.text("current_priority DESC NULLS LAST")],
    )
```

- [ ] **Step 2: Add drop**

```python
    op.drop_index("idx_screening_assignment_priority", table_name="screening_assignment")
    op.drop_table("screening_assignment")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_assignment table"
```

---

### Task A7: Add `screening_decision`

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement** (after assignment in `_create_tables`)

```python
    op.create_table(
        "screening_decision",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("screening_assignment.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("decision", postgresql.ENUM(name="screening_decision", create_type=False),
                  nullable=False),
        sa.Column("exclusion_reason_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("screening_criterion.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("criteria_responses", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("decision_labels", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("is_ai_assisted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ai_suggestion_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("ai_suggestions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("assignment_id", "reviewer_id", name="uq_decision_assignment_reviewer"),
    )
    op.create_index("idx_screening_decision_assignment",
                    "screening_decision", ["assignment_id", "created_at"])
    op.create_index("idx_screening_decision_reviewer",
                    "screening_decision", ["reviewer_id", "created_at"])
```

- [ ] **Step 2: Add drop**

```python
    op.drop_index("idx_screening_decision_reviewer", table_name="screening_decision")
    op.drop_index("idx_screening_decision_assignment", table_name="screening_decision")
    op.drop_table("screening_decision")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_decision table"
```

---

### Task A8: Add `screening_outcome`

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement**

```python
    op.create_table(
        "screening_outcome",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("screening_assignment.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("decision", postgresql.ENUM(name="screening_decision", create_type=False),
                  nullable=False),
        sa.Column("exclusion_reason_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("screening_criterion.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source", postgresql.ENUM(name="screening_outcome_source", create_type=False),
                  nullable=False),
        sa.Column("arbitrator_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("arbitration_mode", postgresql.ENUM(name="screening_arbitration_mode",
                                                       create_type=False), nullable=True),
        sa.Column("selected_decision_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("screening_decision.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
```

- [ ] **Step 2: Add drop**

```python
    op.drop_table("screening_outcome")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_outcome table"
```

---

### Task A9: Add `screening_run`

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement**

```python
    op.create_table(
        "screening_run",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("phase", postgresql.ENUM(name="screening_phase", create_type=False),
                  nullable=True),
        sa.Column("kind", postgresql.ENUM(name="screening_run_kind", create_type=False),
                  nullable=False),
        sa.Column("status", postgresql.ENUM(name="screening_run_status", create_type=False),
                  nullable=False, server_default="pending"),
        sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("results", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("idempotency_key", sa.String(64), nullable=True, unique=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_screening_run_project_kind",
                    "screening_run",
                    ["project_id", "kind", sa.text("created_at DESC")])
```

- [ ] **Step 2: Add drop**

```python
    op.drop_index("idx_screening_run_project_kind", table_name="screening_run")
    op.drop_table("screening_run")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_run table"
```

---

### Task A10: Add `screening_note`

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement**

```python
    op.create_table(
        "screening_note",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("article_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("screening_note.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False, server_default="screening"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_screening_note_article",
                    "screening_note", ["article_id", "created_at"])
```

- [ ] **Step 2: Add drop**

```python
    op.drop_index("idx_screening_note_article", table_name="screening_note")
    op.drop_table("screening_note")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_note table"
```

---

### Task A11: Add `screening_user_preference`

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement**

```python
    op.create_table(
        "screening_user_preference",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("label_shortcuts", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("reason_shortcuts", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("ui_preferences", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "project_id", name="uq_user_pref_user_project"),
    )
```

- [ ] **Step 2: Add drop**

```python
    op.drop_table("screening_user_preference")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add screening_user_preference table"
```

---

### Task A12: Add `ai_usage_log` (cross-cutting)

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py`

- [ ] **Step 1: Implement**

```python
    op.create_table(
        "ai_usage_log",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("service", sa.String(32), nullable=False),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd_micros", sa.BigInteger(), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_ai_usage_project_created",
                    "ai_usage_log", ["project_id", sa.text("created_at DESC")])
```

- [ ] **Step 2: Add drop**

```python
    op.drop_index("idx_ai_usage_project_created", table_name="ai_usage_log")
    op.drop_table("ai_usage_log")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add ai_usage_log table (cross-cutting)"
```

---

### Task A13: Add `articles.screening_status` column + index

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py:_add_articles_column` and `_drop_articles_column`

- [ ] **Step 1: Implement `_add_articles_column`**

```python
def _add_articles_column() -> None:
    op.add_column(
        "articles",
        sa.Column(
            "screening_status",
            postgresql.ENUM(name="screening_status", create_type=False),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_articles_screening_status",
        "articles",
        ["project_id", "screening_status"],
    )
```

- [ ] **Step 2: Implement `_drop_articles_column`**

```python
def _drop_articles_column() -> None:
    op.drop_index("idx_articles_screening_status", table_name="articles")
    op.drop_column("articles", "screening_status")
```

- [ ] **Step 3: Verify**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
psql "$DATABASE_URL" -c "\d articles" | grep screening_status
```

Expected: shows `screening_status | screening_status |  | nullable`.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add articles.screening_status column + index"
```

---

### Task A14: Add status sync trigger (on `screening_outcome`)

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py:_create_triggers` and `_drop_triggers`

- [ ] **Step 1: Implement the function + trigger inside `_create_triggers`**

```python
def _create_triggers() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_article_screening_status() RETURNS trigger AS $$
        DECLARE
          v_phase screening_phase;
          v_article_id UUID;
        BEGIN
          SELECT a.phase, a.article_id
            INTO v_phase, v_article_id
            FROM screening_assignment a
           WHERE a.id = NEW.assignment_id;

          IF v_phase = 'full_text' THEN
            IF NEW.decision = 'include' THEN
              UPDATE articles SET screening_status = 'final_included' WHERE id = v_article_id;
            ELSIF NEW.decision = 'exclude' THEN
              UPDATE articles SET screening_status = 'ft_excluded' WHERE id = v_article_id;
            ELSE
              UPDATE articles SET screening_status = 'ft_maybe' WHERE id = v_article_id;
            END IF;
          ELSE
            IF NEW.decision = 'include' THEN
              UPDATE articles SET screening_status = 'ta_included' WHERE id = v_article_id;
            ELSIF NEW.decision = 'exclude' THEN
              UPDATE articles SET screening_status = 'ta_excluded' WHERE id = v_article_id;
            ELSE
              UPDATE articles SET screening_status = 'ta_maybe' WHERE id = v_article_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_screening_outcome_status
        AFTER INSERT OR UPDATE ON screening_outcome
        FOR EACH ROW EXECUTE FUNCTION sync_article_screening_status();
    """)
```

- [ ] **Step 2: Implement the drop in `_drop_triggers`** (drop trigger first, then function)

```python
def _drop_triggers() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_screening_outcome_status ON screening_outcome;")
    op.execute("DROP FUNCTION IF EXISTS sync_article_screening_status();")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
psql "$DATABASE_URL" -c "\df sync_article_screening_status"
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add status sync trigger on screening_outcome"
```

---

### Task A15: Add enrollment status trigger (on `screening_assignment`)

**Files:**
- Modify: `backend/alembic/versions/0011_add_screening.py:_create_triggers` and `_drop_triggers`

- [ ] **Step 1: Append to `_create_triggers`**

```python
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_article_enrollment_status() RETURNS trigger AS $$
        BEGIN
          UPDATE articles
             SET screening_status = (NEW.phase || '_pending')::screening_status
           WHERE id = NEW.article_id
             AND screening_status IS NULL;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_screening_assignment_enrollment
        AFTER INSERT ON screening_assignment
        FOR EACH ROW EXECUTE FUNCTION sync_article_enrollment_status();
    """)
```

- [ ] **Step 2: Prepend matching drops to `_drop_triggers`** (so all triggers drop before any function):

```python
def _drop_triggers() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_screening_assignment_enrollment ON screening_assignment;")
    op.execute("DROP TRIGGER IF EXISTS trg_screening_outcome_status ON screening_outcome;")
    op.execute("DROP FUNCTION IF EXISTS sync_article_enrollment_status();")
    op.execute("DROP FUNCTION IF EXISTS sync_article_screening_status();")
```

- [ ] **Step 3: Verify + commit**

```bash
cd backend && alembic downgrade -1 && alembic upgrade head
git add backend/alembic/versions/0011_add_screening.py
git commit -m "feat(db): add enrollment status trigger on screening_assignment"
```

---

### Task A16: Test migration applies and rolls back cleanly

**Files:**
- Create: `backend/tests/integration/test_screening_migration.py`

- [ ] **Step 1: Write the test**

```python
"""Migration smoke test for 0011_add_screening.

Validates that the migration creates the expected schema objects and
that downgrade restores the previous state.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


SCREENING_TABLES = {
    "screening_phase_config",
    "screening_criterion",
    "screening_assignment",
    "screening_decision",
    "screening_outcome",
    "screening_run",
    "screening_note",
    "screening_user_preference",
    "ai_usage_log",
}


@pytest.mark.asyncio
async def test_screening_tables_present(async_db_session: AsyncSession) -> None:
    """All 9 new tables exist after `alembic upgrade head`."""
    result = await async_db_session.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = ANY(:names)"
        ),
        {"names": list(SCREENING_TABLES)},
    )
    found = {row[0] for row in result.all()}
    assert found == SCREENING_TABLES, f"Missing: {SCREENING_TABLES - found}"


@pytest.mark.asyncio
async def test_articles_has_screening_status(async_db_session: AsyncSession) -> None:
    """The `articles.screening_status` column exists with the correct ENUM type."""
    result = await async_db_session.execute(
        text(
            "SELECT data_type, udt_name FROM information_schema.columns "
            "WHERE table_name = 'articles' AND column_name = 'screening_status'"
        )
    )
    row = result.first()
    assert row is not None, "articles.screening_status missing"
    assert row[1] == "screening_status", f"Wrong type: {row[1]}"


@pytest.mark.asyncio
async def test_status_sync_trigger_present(async_db_session: AsyncSession) -> None:
    """Both triggers exist on the right tables."""
    result = await async_db_session.execute(
        text(
            "SELECT trigger_name, event_object_table FROM information_schema.triggers "
            "WHERE trigger_name IN "
            "('trg_screening_outcome_status', 'trg_screening_assignment_enrollment')"
        )
    )
    triggers = {(r[0], r[1]) for r in result.all()}
    assert triggers == {
        ("trg_screening_outcome_status", "screening_outcome"),
        ("trg_screening_assignment_enrollment", "screening_assignment"),
    }


@pytest.mark.asyncio
async def test_screening_run_idempotency_key_unique(async_db_session: AsyncSession) -> None:
    """`screening_run.idempotency_key` has a unique index."""
    result = await async_db_session.execute(
        text(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'screening_run' AND indexdef LIKE '%idempotency_key%'"
        )
    )
    rows = result.all()
    assert len(rows) >= 1, "idempotency_key unique index missing"
```

- [ ] **Step 2: Add the `async_db_session` fixture if not present**

Check `backend/tests/conftest.py`. If `async_db_session` doesn't exist, add it (after the `event_loop` fixture):

```python
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

@pytest_asyncio.fixture
async def async_db_session() -> "AsyncGenerator[AsyncSession, None]":
    """Real-Postgres async session bound to settings.DATABASE_URL.

    Each test gets a fresh transaction that is rolled back at the end so
    tests don't pollute the database. Requires `alembic upgrade head` to
    have been run beforehand (handled by the integration test runner).
    """
    engine = create_async_engine(settings.DATABASE_URL, future=True)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
        await session.rollback()
    await engine.dispose()
```

- [ ] **Step 3: Run the tests**

```bash
cd backend && pytest tests/integration/test_screening_migration.py -xvs
```

Expected: 4 passes.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/integration/test_screening_migration.py backend/tests/conftest.py
git commit -m "test(db): smoke tests for 0011 screening migration"
```

---

## Phase B — SQLAlchemy models

### Task B1: Create `screening.py` with `ScreeningPhaseConfig`

**Files:**
- Create: `backend/app/models/screening.py`

- [ ] **Step 1: Write the file**

```python
"""Screening models — config, criteria, assignment, decision, outcome, run.

Greenfield module. Mirrors the extraction HITL/consensus pattern (separate
rows, same shapes). Optimistic concurrency on screening_decision and
screening_outcome via the `version` column.

Source of truth for enum names: backend/app/models/base.py:POSTGRESQL_ENUM_VALUES
Source of truth for schema: backend/alembic/versions/0011_add_screening.py
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class ScreeningPhaseConfig(BaseModel):
    """Per-phase configuration. Presence of a row enables that phase."""

    __tablename__ = "screening_phase_config"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    phase: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_phase"), nullable=False
    )
    reviewer_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    consensus_rule: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_consensus_rule"),
        nullable=False,
        default="unanimous",
        server_default="unanimous",
    )
    arbitrator_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    blind_mode: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    require_exclusion_reason: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ai_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    ai_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ai_system_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_learning_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    highlight_terms: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    pico_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("project_id", "phase", name="uq_phase_config_project_phase"),
        CheckConstraint(
            "reviewer_count BETWEEN 1 AND 5", name="ck_phase_config_reviewer_count"
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ScreeningPhaseConfig project={self.project_id} phase={self.phase}>"
        )
```

Note: `BaseModel` (from `models/base.py`) already provides `id`, `created_at`, `updated_at`. Verify this by running `grep -n "class BaseModel" backend/app/models/base.py` before continuing.

- [ ] **Step 2: Smoke test the import**

```bash
cd backend && python -c "from app.models.screening import ScreeningPhaseConfig; print(ScreeningPhaseConfig.__tablename__)"
```

Expected: `screening_phase_config`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/screening.py
git commit -m "feat(models): add ScreeningPhaseConfig"
```

---

### Task B2: Add `ScreeningCriterion`

**Files:**
- Modify: `backend/app/models/screening.py`

- [ ] **Step 1: Append to `screening.py`**

```python
class ScreeningCriterion(BaseModel):
    """Inclusion/exclusion criterion for a phase."""

    __tablename__ = "screening_criterion"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    phase: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_phase"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("kind IN ('inclusion','exclusion')", name="ck_criterion_kind"),
        Index(
            "idx_screening_criterion_project_phase",
            "project_id", "phase", "ordinal",
            postgresql_where="is_active",
        ),
    )

    def __repr__(self) -> str:
        return f"<ScreeningCriterion {self.kind}:{self.label[:30]}>"
```

- [ ] **Step 2: Smoke test + commit**

```bash
cd backend && python -c "from app.models.screening import ScreeningCriterion; print(ScreeningCriterion.__tablename__)"
git add backend/app/models/screening.py
git commit -m "feat(models): add ScreeningCriterion"
```

---

### Task B3: Add `ScreeningAssignment`

**Files:**
- Modify: `backend/app/models/screening.py`

- [ ] **Step 1: Append**

```python
class ScreeningAssignment(BaseModel):
    """Enrollment of an article into a phase. Status derived; not stored."""

    __tablename__ = "screening_assignment"

    # BaseModel provides id, created_at, updated_at; we override created_at
    # alias to enrolled_at by including both.
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
    )
    phase: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_phase"), nullable=False
    )
    current_priority: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    priority_model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id", "article_id", "phase",
            name="uq_assignment_project_article_phase",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ScreeningAssignment project={self.project_id} "
            f"article={self.article_id} phase={self.phase}>"
        )
```

If `BaseModel` already defines `created_at`/`updated_at`, both will be present alongside `enrolled_at`. That's intentional — `enrolled_at` is the domain-meaningful timestamp; `created_at` is the row-creation audit timestamp.

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.screening import ScreeningAssignment; print(ScreeningAssignment.__tablename__)"
git add backend/app/models/screening.py
git commit -m "feat(models): add ScreeningAssignment"
```

---

### Task B4: Add `ScreeningDecision` (with optimistic concurrency)

**Files:**
- Modify: `backend/app/models/screening.py`

- [ ] **Step 1: Append**

```python
class ScreeningDecision(BaseModel):
    """One reviewer's decision on an assignment. UNIQUE(assignment, reviewer)."""

    __tablename__ = "screening_decision"

    assignment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("screening_assignment.id", ondelete="CASCADE"),
        nullable=False,
    )
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_decision"), nullable=False
    )
    exclusion_reason_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("screening_criterion.id", ondelete="SET NULL"),
        nullable=True,
    )
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    criteria_responses: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    decision_labels: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    is_ai_assisted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    ai_suggestion_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("ai_suggestions.id", ondelete="SET NULL"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )

    __table_args__ = (
        UniqueConstraint(
            "assignment_id", "reviewer_id",
            name="uq_decision_assignment_reviewer",
        ),
        Index("idx_screening_decision_assignment", "assignment_id", "created_at"),
        Index("idx_screening_decision_reviewer", "reviewer_id", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<ScreeningDecision assignment={self.assignment_id} "
            f"reviewer={self.reviewer_id} decision={self.decision} v={self.version}>"
        )
```

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.screening import ScreeningDecision; print(ScreeningDecision.__tablename__)"
git add backend/app/models/screening.py
git commit -m "feat(models): add ScreeningDecision with optimistic concurrency"
```

---

### Task B5: Add `ScreeningOutcome`

**Files:**
- Modify: `backend/app/models/screening.py`

- [ ] **Step 1: Append**

```python
class ScreeningOutcome(BaseModel):
    """Canonical screening verdict for an assignment. UNIQUE(assignment_id)."""

    __tablename__ = "screening_outcome"

    assignment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("screening_assignment.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    decision: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_decision"), nullable=False
    )
    exclusion_reason_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("screening_criterion.id", ondelete="SET NULL"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_outcome_source"), nullable=False
    )
    arbitrator_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    arbitration_mode: Mapped[str | None] = mapped_column(
        PostgreSQLEnumType("screening_arbitration_mode"), nullable=True
    )
    selected_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("screening_decision.id", ondelete="SET NULL"),
        nullable=True,
    )
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )

    def __repr__(self) -> str:
        return (
            f"<ScreeningOutcome assignment={self.assignment_id} "
            f"decision={self.decision} source={self.source}>"
        )
```

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.screening import ScreeningOutcome; print(ScreeningOutcome.__tablename__)"
git add backend/app/models/screening.py
git commit -m "feat(models): add ScreeningOutcome"
```

---

### Task B6: Add `ScreeningRun`

**Files:**
- Modify: `backend/app/models/screening.py`

- [ ] **Step 1: Append**

```python
class ScreeningRun(BaseModel):
    """Audit row for batch operations (imports, future AI runs)."""

    __tablename__ = "screening_run"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    phase: Mapped[str | None] = mapped_column(
        PostgreSQLEnumType("screening_phase"), nullable=True
    )
    kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_run_kind"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        PostgreSQLEnumType("screening_run_status"),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    parameters: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    results: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        Index(
            "idx_screening_run_project_kind",
            "project_id", "kind", "created_at",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ScreeningRun project={self.project_id} kind={self.kind} "
            f"status={self.status}>"
        )
```

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.screening import ScreeningRun; print(ScreeningRun.__tablename__)"
git add backend/app/models/screening.py
git commit -m "feat(models): add ScreeningRun"
```

---

### Task B7: Create `screening_note.py`

**Files:**
- Create: `backend/app/models/screening_note.py`

- [ ] **Step 1: Write the file**

```python
"""ScreeningNote — threaded per-article comments scoped to screening."""

from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ScreeningNote(BaseModel):
    """Threaded note on an article in the screening flow.

    Self-referential `parent_id` enables threading. `scope` indicates
    whether the note pertains to a particular phase or all of screening.
    """

    __tablename__ = "screening_note"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("screening_note.id", ondelete="CASCADE"),
        nullable=True,
    )
    author_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str] = mapped_column(
        String(32), nullable=False, default="screening", server_default="screening"
    )

    __table_args__ = (
        Index("idx_screening_note_article", "article_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<ScreeningNote article={self.article_id} author={self.author_id}>"
```

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.screening_note import ScreeningNote; print(ScreeningNote.__tablename__)"
git add backend/app/models/screening_note.py
git commit -m "feat(models): add ScreeningNote"
```

---

### Task B8: Create `screening_user_preference.py`

**Files:**
- Create: `backend/app/models/screening_user_preference.py`

- [ ] **Step 1: Write the file**

```python
"""Per-user (per-project) screening preferences: shortcuts + UI settings."""

from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ScreeningUserPreference(BaseModel):
    """User preferences for screening. NULL project_id = global default."""

    __tablename__ = "screening_user_preference"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
    )
    label_shortcuts: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    reason_shortcuts: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    ui_preferences: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "project_id", name="uq_user_pref_user_project"),
    )

    def __repr__(self) -> str:
        return (
            f"<ScreeningUserPreference user={self.user_id} project={self.project_id}>"
        )
```

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.screening_user_preference import ScreeningUserPreference; print(ScreeningUserPreference.__tablename__)"
git add backend/app/models/screening_user_preference.py
git commit -m "feat(models): add ScreeningUserPreference"
```

---

### Task B9: Create `ai_usage_log.py`

**Files:**
- Create: `backend/app/models/ai_usage_log.py`

- [ ] **Step 1: Write the file**

```python
"""AI usage log — cross-cutting cost/token tracking for any AI service.

Populated by OpenAIService on every billable call. Used by
extraction (today) and screening (Phase β onward).
"""

from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class AIUsageLog(BaseModel):
    """One row per AI call: project, user, service, operation, model, tokens, cost."""

    __tablename__ = "ai_usage_log"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    service: Mapped[str] = mapped_column(String(32), nullable=False)
    operation: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("idx_ai_usage_project_created", "project_id", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<AIUsageLog project={self.project_id} service={self.service} "
            f"op={self.operation} cost_usd={self.cost_usd_micros / 1_000_000:.4f}>"
        )
```

- [ ] **Step 2: Smoke + commit**

```bash
cd backend && python -c "from app.models.ai_usage_log import AIUsageLog; print(AIUsageLog.__tablename__)"
git add backend/app/models/ai_usage_log.py
git commit -m "feat(models): add AIUsageLog (cross-cutting)"
```

---

### Task B10: Update `articles.py` with `screening_status`

**Files:**
- Modify: `backend/app/models/article.py`

- [ ] **Step 1: Locate the Article class**

```bash
grep -n "class Article" backend/app/models/article.py
```

You'll find a `class Article(BaseModel):` definition. Find a sensible spot (near other status-like fields).

- [ ] **Step 2: Add the column inside `Article`**

```python
    # Screening status — single source of truth, maintained by triggers
    # on screening_outcome and screening_assignment. NULL = not enrolled
    # (screening disabled for project, or article not yet enrolled).
    # Possible values: see POSTGRESQL_ENUM_VALUES["screening_status"].
    screening_status: Mapped[str | None] = mapped_column(
        PostgreSQLEnumType("screening_status"), nullable=True
    )
```

If `PostgreSQLEnumType` is not already imported in this file, add to the imports:

```python
from app.models.base import BaseModel, PostgreSQLEnumType
```

- [ ] **Step 3: Smoke**

```bash
cd backend && python -c "from app.models.article import Article; print('screening_status' in {c.name for c in Article.__table__.columns})"
```

Expected: `True`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/article.py
git commit -m "feat(models): add Article.screening_status (trigger-maintained)"
```

---

### Task B11: Register new models in `__init__.py`

**Files:**
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Append imports + `__all__` entries**

Find the end of imports + `__all__` list. Add:

```python
from app.models.ai_usage_log import AIUsageLog
from app.models.screening import (
    ScreeningAssignment,
    ScreeningCriterion,
    ScreeningDecision,
    ScreeningOutcome,
    ScreeningPhaseConfig,
    ScreeningRun,
)
from app.models.screening_note import ScreeningNote
from app.models.screening_user_preference import ScreeningUserPreference
```

And in `__all__`:

```python
    # Screening
    "ScreeningPhaseConfig",
    "ScreeningCriterion",
    "ScreeningAssignment",
    "ScreeningDecision",
    "ScreeningOutcome",
    "ScreeningRun",
    "ScreeningNote",
    "ScreeningUserPreference",
    # Cross-cutting
    "AIUsageLog",
```

- [ ] **Step 2: Verify all models register**

```bash
cd backend && python -c "from app.models import (
    ScreeningPhaseConfig, ScreeningCriterion, ScreeningAssignment,
    ScreeningDecision, ScreeningOutcome, ScreeningRun,
    ScreeningNote, ScreeningUserPreference, AIUsageLog,
); print('all importable')"
```

Expected: `all importable`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/__init__.py
git commit -m "feat(models): register screening + ai_usage_log models"
```

---

### Task B12: Smoke test all models bind to live tables

**Files:**
- Create: `backend/tests/integration/test_screening_models.py`

- [ ] **Step 1: Write the tests**

```python
"""Smoke tests for screening models — registration + basic CRUD."""

from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AIUsageLog,
    ScreeningAssignment,
    ScreeningCriterion,
    ScreeningDecision,
    ScreeningNote,
    ScreeningOutcome,
    ScreeningPhaseConfig,
    ScreeningRun,
    ScreeningUserPreference,
)


@pytest_asyncio.fixture
async def fixture_project_and_user(async_db_session: AsyncSession) -> tuple[str, str]:
    """Create a minimal project + profile for FK satisfaction."""
    user_id = uuid4()
    project_id = uuid4()
    await async_db_session.execute(
        text("INSERT INTO profiles (id, email) VALUES (:uid, :email)"),
        {"uid": user_id, "email": f"test-{user_id}@example.com"},
    )
    await async_db_session.execute(
        text(
            "INSERT INTO projects (id, owner_id, title, review_type) "
            "VALUES (:pid, :uid, 'Test', 'interventional')"
        ),
        {"pid": project_id, "uid": user_id},
    )
    await async_db_session.commit()
    return str(project_id), str(user_id)


@pytest.mark.asyncio
async def test_phase_config_roundtrip(
    async_db_session: AsyncSession, fixture_project_and_user: tuple[str, str]
) -> None:
    project_id, user_id = fixture_project_and_user
    cfg = ScreeningPhaseConfig(
        project_id=project_id,
        phase="title_abstract",
        require_exclusion_reason=False,
        created_by=user_id,
    )
    async_db_session.add(cfg)
    await async_db_session.commit()
    await async_db_session.refresh(cfg)
    assert cfg.id is not None
    assert cfg.reviewer_count == 1  # server default
    assert cfg.consensus_rule == "unanimous"
    assert cfg.ai_enabled is False


@pytest.mark.asyncio
async def test_criterion_check_constraint(
    async_db_session: AsyncSession, fixture_project_and_user: tuple[str, str]
) -> None:
    """Inserting an invalid kind raises an integrity error."""
    from sqlalchemy.exc import IntegrityError

    project_id, user_id = fixture_project_and_user
    bad = ScreeningCriterion(
        project_id=project_id,
        phase="title_abstract",
        kind="invalid",
        label="bad",
        created_by=user_id,
    )
    async_db_session.add(bad)
    with pytest.raises(IntegrityError):
        await async_db_session.commit()
    await async_db_session.rollback()


@pytest.mark.asyncio
async def test_decision_unique_constraint(
    async_db_session: AsyncSession, fixture_project_and_user: tuple[str, str]
) -> None:
    """Two decisions for the same (assignment, reviewer) violate uniqueness."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    project_id, user_id = fixture_project_and_user
    # Need an article + assignment first.
    article_id = uuid4()
    await async_db_session.execute(
        text(
            "INSERT INTO articles (id, project_id, title) VALUES (:aid, :pid, 'X')"
        ),
        {"aid": article_id, "pid": project_id},
    )
    assignment = ScreeningAssignment(
        project_id=project_id, article_id=article_id, phase="title_abstract"
    )
    async_db_session.add(assignment)
    await async_db_session.commit()
    await async_db_session.refresh(assignment)

    d1 = ScreeningDecision(
        assignment_id=assignment.id, reviewer_id=user_id, decision="include"
    )
    async_db_session.add(d1)
    await async_db_session.commit()

    d2 = ScreeningDecision(
        assignment_id=assignment.id, reviewer_id=user_id, decision="exclude"
    )
    async_db_session.add(d2)
    with pytest.raises(IntegrityError):
        await async_db_session.commit()
    await async_db_session.rollback()
```

- [ ] **Step 2: Run**

```bash
cd backend && pytest tests/integration/test_screening_models.py -xvs
```

Expected: 3 passes.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_screening_models.py
git commit -m "test(models): smoke + constraint tests for screening models"
```

---

## Phase C — Repositories

### Task C1: `screening_phase_config_repository.py`

**Files:**
- Create: `backend/app/repositories/screening_phase_config_repository.py`

- [ ] **Step 1: Write the repository**

```python
"""Repository for ScreeningPhaseConfig."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningPhaseConfig
from app.repositories.base import BaseRepository


class ScreeningPhaseConfigRepository(BaseRepository[ScreeningPhaseConfig]):
    """CRUD + lookups for screening phase configurations."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningPhaseConfig)

    async def get_by_project_and_phase(
        self, project_id: UUID, phase: str
    ) -> ScreeningPhaseConfig | None:
        """Return the config for (project, phase) or None.

        Only one config per (project, phase) per UNIQUE constraint.
        """
        stmt = (
            select(ScreeningPhaseConfig)
            .where(ScreeningPhaseConfig.project_id == project_id)
            .where(ScreeningPhaseConfig.phase == phase)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_for_project(
        self, project_id: UUID
    ) -> list[ScreeningPhaseConfig]:
        """Return all configured phases for a project, deterministically ordered."""
        stmt = (
            select(ScreeningPhaseConfig)
            .where(ScreeningPhaseConfig.project_id == project_id)
            .order_by(ScreeningPhaseConfig.phase, ScreeningPhaseConfig.id)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_phase_config_repository.py
git commit -m "feat(repos): ScreeningPhaseConfigRepository"
```

---

### Task C2: `screening_criterion_repository.py`

**Files:**
- Create: `backend/app/repositories/screening_criterion_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningCriterion."""

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningCriterion
from app.repositories.base import BaseRepository


class ScreeningCriterionRepository(BaseRepository[ScreeningCriterion]):
    """CRUD + ordered listing for inclusion/exclusion criteria."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningCriterion)

    async def list_for_phase(
        self,
        project_id: UUID,
        phase: str,
        *,
        only_active: bool = True,
    ) -> list[ScreeningCriterion]:
        """Return criteria for a phase, ordered by (ordinal, id) deterministically."""
        conds = [
            ScreeningCriterion.project_id == project_id,
            ScreeningCriterion.phase == phase,
        ]
        if only_active:
            conds.append(ScreeningCriterion.is_active.is_(True))
        stmt = (
            select(ScreeningCriterion)
            .where(and_(*conds))
            .order_by(ScreeningCriterion.ordinal, ScreeningCriterion.id)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_criterion_repository.py
git commit -m "feat(repos): ScreeningCriterionRepository"
```

---

### Task C3: `screening_assignment_repository.py`

**Files:**
- Create: `backend/app/repositories/screening_assignment_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningAssignment."""

from uuid import UUID

from sqlalchemy import and_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import (
    ScreeningAssignment,
    ScreeningDecision,
    ScreeningOutcome,
)
from app.repositories.base import BaseRepository


class ScreeningAssignmentRepository(BaseRepository[ScreeningAssignment]):
    """Enrollment + queue lookups."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningAssignment)

    async def get_for_article_and_phase(
        self, project_id: UUID, article_id: UUID, phase: str
    ) -> ScreeningAssignment | None:
        stmt = (
            select(ScreeningAssignment)
            .where(ScreeningAssignment.project_id == project_id)
            .where(ScreeningAssignment.article_id == article_id)
            .where(ScreeningAssignment.phase == phase)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_pending_for_user(
        self,
        project_id: UUID,
        phase: str,
        user_id: UUID,
        *,
        limit: int = 20,
        cursor: tuple[float | None, UUID] | None = None,
    ) -> list[ScreeningAssignment]:
        """Return pending assignments for a user, ordered by current_priority then id.

        "Pending for user" = no decision by `user_id` AND no published outcome.
        Cursor is `(priority, id)` of the last item from the previous page.
        """
        # Subquery: assignments where user has already decided.
        decided_subq = select(ScreeningDecision.assignment_id).where(
            ScreeningDecision.reviewer_id == user_id
        )
        # Subquery: assignments where outcome already published.
        published_subq = select(ScreeningOutcome.assignment_id)

        conds = [
            ScreeningAssignment.project_id == project_id,
            ScreeningAssignment.phase == phase,
            ~ScreeningAssignment.id.in_(decided_subq),
            ~ScreeningAssignment.id.in_(published_subq),
        ]
        if cursor is not None:
            cursor_priority, cursor_id = cursor
            # Keyset pagination on (current_priority DESC NULLS LAST, id ASC)
            if cursor_priority is None:
                conds.append(
                    and_(
                        ScreeningAssignment.current_priority.is_(None),
                        ScreeningAssignment.id > cursor_id,
                    )
                )
            else:
                conds.append(
                    (ScreeningAssignment.current_priority < cursor_priority)
                    | and_(
                        ScreeningAssignment.current_priority == cursor_priority,
                        ScreeningAssignment.id > cursor_id,
                    )
                )

        stmt = (
            select(ScreeningAssignment)
            .where(and_(*conds))
            .order_by(
                ScreeningAssignment.current_priority.desc().nullslast(),
                ScreeningAssignment.id,
            )
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def count_pending_for_phase(
        self, project_id: UUID, phase: str
    ) -> int:
        """Count assignments with no published outcome."""
        from sqlalchemy import func

        stmt = (
            select(func.count(ScreeningAssignment.id))
            .where(ScreeningAssignment.project_id == project_id)
            .where(ScreeningAssignment.phase == phase)
            .where(
                ~exists(
                    select(1).where(
                        ScreeningOutcome.assignment_id == ScreeningAssignment.id
                    )
                )
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_assignment_repository.py
git commit -m "feat(repos): ScreeningAssignmentRepository (queue + count)"
```

---

### Task C4: `screening_decision_repository.py` (with optimistic concurrency)

**Files:**
- Create: `backend/app/repositories/screening_decision_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningDecision (with optimistic concurrency)."""

from uuid import UUID

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningDecision
from app.repositories.base import BaseRepository


class OptimisticConcurrencyError(Exception):
    """Raised when an update's expected version doesn't match the row's version."""


class ScreeningDecisionRepository(BaseRepository[ScreeningDecision]):
    """CRUD + version-checked update for screening decisions."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningDecision)

    async def list_for_assignment(
        self, assignment_id: UUID
    ) -> list[ScreeningDecision]:
        """Return all decisions for an assignment, deterministically ordered.

        Order is (created_at ASC, id ASC) — fixes PR #7 conflict pairing bug.
        """
        stmt = (
            select(ScreeningDecision)
            .where(ScreeningDecision.assignment_id == assignment_id)
            .order_by(ScreeningDecision.created_at, ScreeningDecision.id)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_by_assignment_and_reviewer(
        self, assignment_id: UUID, reviewer_id: UUID
    ) -> ScreeningDecision | None:
        stmt = (
            select(ScreeningDecision)
            .where(ScreeningDecision.assignment_id == assignment_id)
            .where(ScreeningDecision.reviewer_id == reviewer_id)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def update_with_version(
        self,
        decision_id: UUID,
        expected_version: int,
        patch: dict,
    ) -> ScreeningDecision:
        """Update a decision iff `version == expected_version`.

        On match: increments version by 1, applies the patch, returns the row.
        On mismatch (concurrent edit): raises OptimisticConcurrencyError.
        """
        # Build a single UPDATE ... WHERE id=$1 AND version=$2 RETURNING *
        new_version = expected_version + 1
        values = {**patch, "version": new_version}
        stmt = (
            update(ScreeningDecision)
            .where(
                and_(
                    ScreeningDecision.id == decision_id,
                    ScreeningDecision.version == expected_version,
                )
            )
            .values(**values)
            .returning(ScreeningDecision)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            raise OptimisticConcurrencyError(
                f"version mismatch on decision {decision_id} (expected {expected_version})"
            )
        await self.db.flush()
        return row
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_decision_repository.py
git commit -m "feat(repos): ScreeningDecisionRepository with optimistic concurrency"
```

---

### Task C5: `screening_outcome_repository.py`

**Files:**
- Create: `backend/app/repositories/screening_outcome_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningOutcome (one row per assignment)."""

from uuid import UUID

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningOutcome
from app.repositories.base import BaseRepository
from app.repositories.screening_decision_repository import OptimisticConcurrencyError


class ScreeningOutcomeRepository(BaseRepository[ScreeningOutcome]):
    """CRUD + version-checked update for screening outcomes."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningOutcome)

    async def get_for_assignment(
        self, assignment_id: UUID
    ) -> ScreeningOutcome | None:
        stmt = select(ScreeningOutcome).where(
            ScreeningOutcome.assignment_id == assignment_id
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def update_with_version(
        self,
        outcome_id: UUID,
        expected_version: int,
        patch: dict,
    ) -> ScreeningOutcome:
        """Same semantics as ScreeningDecisionRepository.update_with_version."""
        new_version = expected_version + 1
        values = {**patch, "version": new_version}
        stmt = (
            update(ScreeningOutcome)
            .where(
                and_(
                    ScreeningOutcome.id == outcome_id,
                    ScreeningOutcome.version == expected_version,
                )
            )
            .values(**values)
            .returning(ScreeningOutcome)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            raise OptimisticConcurrencyError(
                f"version mismatch on outcome {outcome_id} (expected {expected_version})"
            )
        await self.db.flush()
        return row
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_outcome_repository.py
git commit -m "feat(repos): ScreeningOutcomeRepository with optimistic concurrency"
```

---

### Task C6: `screening_run_repository.py` (with idempotency lookup)

**Files:**
- Create: `backend/app/repositories/screening_run_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningRun (with idempotency-key reuse)."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningRun
from app.repositories.base import BaseRepository

IDEMPOTENCY_TTL = timedelta(hours=24)


class ScreeningRunRepository(BaseRepository[ScreeningRun]):
    """Audit row repository + idempotency-key lookup."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningRun)

    async def get_by_idempotency_key(
        self, key: str, *, ttl: timedelta = IDEMPOTENCY_TTL
    ) -> ScreeningRun | None:
        """Return a recent run matching `key` (within TTL), else None."""
        cutoff = datetime.now(timezone.utc) - ttl
        stmt = (
            select(ScreeningRun)
            .where(
                and_(
                    ScreeningRun.idempotency_key == key,
                    ScreeningRun.created_at >= cutoff,
                )
            )
            .order_by(ScreeningRun.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_for_project(
        self,
        project_id: UUID,
        *,
        kinds: list[str] | None = None,
        limit: int = 50,
    ) -> list[ScreeningRun]:
        """List runs for audit display, newest first."""
        conds = [ScreeningRun.project_id == project_id]
        if kinds:
            conds.append(ScreeningRun.kind.in_(kinds))
        stmt = (
            select(ScreeningRun)
            .where(and_(*conds))
            .order_by(ScreeningRun.created_at.desc(), ScreeningRun.id.desc())
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_run_repository.py
git commit -m "feat(repos): ScreeningRunRepository with idempotency-key lookup"
```

---

### Task C7: `screening_note_repository.py`

**Files:**
- Create: `backend/app/repositories/screening_note_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningNote (threaded comments)."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening_note import ScreeningNote
from app.repositories.base import BaseRepository


class ScreeningNoteRepository(BaseRepository[ScreeningNote]):
    """Threaded notes per article."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningNote)

    async def list_thread_for_article(
        self, article_id: UUID
    ) -> list[ScreeningNote]:
        """Return all notes for an article, deterministically ordered for threading.

        Order: (created_at ASC, id ASC). Frontend nests by parent_id.
        """
        stmt = (
            select(ScreeningNote)
            .where(ScreeningNote.article_id == article_id)
            .order_by(ScreeningNote.created_at, ScreeningNote.id)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_note_repository.py
git commit -m "feat(repos): ScreeningNoteRepository"
```

---

### Task C8: `screening_user_preference_repository.py`

**Files:**
- Create: `backend/app/repositories/screening_user_preference_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for ScreeningUserPreference."""

from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening_user_preference import ScreeningUserPreference
from app.repositories.base import BaseRepository


class ScreeningUserPreferenceRepository(BaseRepository[ScreeningUserPreference]):
    """Per-user preferences with project-override resolution."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ScreeningUserPreference)

    async def get_for_user(
        self, user_id: UUID, project_id: UUID | None = None
    ) -> ScreeningUserPreference | None:
        """Return the project-scoped row if present, else the user's global default.

        Resolution: prefer (user_id, project_id) over (user_id, NULL).
        """
        if project_id is not None:
            stmt_project = (
                select(ScreeningUserPreference)
                .where(ScreeningUserPreference.user_id == user_id)
                .where(ScreeningUserPreference.project_id == project_id)
            )
            result = await self.db.execute(stmt_project)
            row = result.scalar_one_or_none()
            if row is not None:
                return row

        stmt_global = (
            select(ScreeningUserPreference)
            .where(ScreeningUserPreference.user_id == user_id)
            .where(ScreeningUserPreference.project_id.is_(None))
        )
        result = await self.db.execute(stmt_global)
        return result.scalar_one_or_none()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/screening_user_preference_repository.py
git commit -m "feat(repos): ScreeningUserPreferenceRepository"
```

---

### Task C9: `ai_usage_log_repository.py`

**Files:**
- Create: `backend/app/repositories/ai_usage_log_repository.py`

- [ ] **Step 1: Write**

```python
"""Repository for AIUsageLog (cross-cutting cost/token tracking)."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_usage_log import AIUsageLog
from app.repositories.base import BaseRepository


class AIUsageLogRepository(BaseRepository[AIUsageLog]):
    """Insert AI usage rows + sum costs per project/window."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, AIUsageLog)

    async def total_cost_micros(
        self,
        project_id: UUID,
        *,
        service: str | None = None,
        since: datetime | None = None,
    ) -> int:
        """Sum cost_usd_micros for a project, optionally filtered by service + time."""
        conds = [AIUsageLog.project_id == project_id]
        if service is not None:
            conds.append(AIUsageLog.service == service)
        if since is not None:
            conds.append(AIUsageLog.created_at >= since)
        stmt = select(func.coalesce(func.sum(AIUsageLog.cost_usd_micros), 0)).where(
            and_(*conds)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/repositories/ai_usage_log_repository.py
git commit -m "feat(repos): AIUsageLogRepository (cross-cutting)"
```

---

## Phase D — Integration tests for triggers and concurrency

### Task D1: Test status sync trigger fires on outcome insert

**Files:**
- Create: `backend/tests/integration/test_screening_triggers.py`

- [ ] **Step 1: Write the test**

```python
"""Trigger behaviour tests for the screening module.

Verifies the canonical articles.screening_status field is maintained
correctly by triggers on screening_outcome and screening_assignment.
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import (
    ScreeningAssignment,
    ScreeningOutcome,
)


@pytest_asyncio.fixture
async def fixture_minimal(async_db_session: AsyncSession):
    """Create a project + user + article and return their IDs."""
    user_id = uuid4()
    project_id = uuid4()
    article_id = uuid4()
    await async_db_session.execute(
        text("INSERT INTO profiles (id, email) VALUES (:uid, :email)"),
        {"uid": user_id, "email": f"trig-{user_id}@example.com"},
    )
    await async_db_session.execute(
        text(
            "INSERT INTO projects (id, owner_id, title, review_type) "
            "VALUES (:pid, :uid, 'T', 'interventional')"
        ),
        {"pid": project_id, "uid": user_id},
    )
    await async_db_session.execute(
        text(
            "INSERT INTO articles (id, project_id, title) "
            "VALUES (:aid, :pid, 'X')"
        ),
        {"aid": article_id, "pid": project_id},
    )
    await async_db_session.commit()
    yield {"project_id": project_id, "user_id": user_id, "article_id": article_id}


async def _read_status(db: AsyncSession, article_id) -> str | None:
    result = await db.execute(
        text("SELECT screening_status FROM articles WHERE id = :id"),
        {"id": article_id},
    )
    return result.scalar_one()


@pytest.mark.asyncio
async def test_enrollment_sets_pending(
    async_db_session: AsyncSession, fixture_minimal: dict
) -> None:
    """Inserting a screening_assignment sets articles.screening_status to <phase>_pending."""
    a = ScreeningAssignment(
        project_id=fixture_minimal["project_id"],
        article_id=fixture_minimal["article_id"],
        phase="title_abstract",
    )
    async_db_session.add(a)
    await async_db_session.commit()

    status = await _read_status(async_db_session, fixture_minimal["article_id"])
    assert status == "ta_pending"


@pytest.mark.asyncio
async def test_outcome_include_at_ta_sets_ta_included(
    async_db_session: AsyncSession, fixture_minimal: dict
) -> None:
    a = ScreeningAssignment(
        project_id=fixture_minimal["project_id"],
        article_id=fixture_minimal["article_id"],
        phase="title_abstract",
    )
    async_db_session.add(a)
    await async_db_session.commit()
    await async_db_session.refresh(a)

    o = ScreeningOutcome(assignment_id=a.id, decision="include", source="solo")
    async_db_session.add(o)
    await async_db_session.commit()

    status = await _read_status(async_db_session, fixture_minimal["article_id"])
    assert status == "ta_included"


@pytest.mark.asyncio
async def test_outcome_include_at_ft_sets_final_included(
    async_db_session: AsyncSession, fixture_minimal: dict
) -> None:
    a = ScreeningAssignment(
        project_id=fixture_minimal["project_id"],
        article_id=fixture_minimal["article_id"],
        phase="full_text",
    )
    async_db_session.add(a)
    await async_db_session.commit()
    await async_db_session.refresh(a)

    o = ScreeningOutcome(assignment_id=a.id, decision="include", source="solo")
    async_db_session.add(o)
    await async_db_session.commit()

    status = await _read_status(async_db_session, fixture_minimal["article_id"])
    assert status == "final_included"


@pytest.mark.asyncio
async def test_outcome_exclude_at_ft_sets_ft_excluded(
    async_db_session: AsyncSession, fixture_minimal: dict
) -> None:
    a = ScreeningAssignment(
        project_id=fixture_minimal["project_id"],
        article_id=fixture_minimal["article_id"],
        phase="full_text",
    )
    async_db_session.add(a)
    await async_db_session.commit()
    await async_db_session.refresh(a)

    o = ScreeningOutcome(
        assignment_id=a.id, decision="exclude", source="solo"
    )
    async_db_session.add(o)
    await async_db_session.commit()

    status = await _read_status(async_db_session, fixture_minimal["article_id"])
    assert status == "ft_excluded"


@pytest.mark.asyncio
async def test_enrollment_does_not_overwrite_existing_status(
    async_db_session: AsyncSession, fixture_minimal: dict
) -> None:
    """If status is already set (e.g. pre_included), enrollment must not overwrite."""
    await async_db_session.execute(
        text("UPDATE articles SET screening_status = 'pre_included' WHERE id = :id"),
        {"id": fixture_minimal["article_id"]},
    )
    await async_db_session.commit()

    a = ScreeningAssignment(
        project_id=fixture_minimal["project_id"],
        article_id=fixture_minimal["article_id"],
        phase="title_abstract",
    )
    async_db_session.add(a)
    await async_db_session.commit()

    status = await _read_status(async_db_session, fixture_minimal["article_id"])
    assert status == "pre_included"  # not overwritten
```

- [ ] **Step 2: Run**

```bash
cd backend && pytest tests/integration/test_screening_triggers.py -xvs
```

Expected: 5 passes.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_screening_triggers.py
git commit -m "test(triggers): screening_status sync via outcome + enrollment triggers"
```

---

### Task D2: Test optimistic concurrency on `ScreeningDecision`

**Files:**
- Create: `backend/tests/integration/test_screening_repositories.py`

- [ ] **Step 1: Write the test**

```python
"""Repository behaviour: optimistic concurrency, idempotency, ordering."""

import asyncio
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import (
    ScreeningAssignment,
    ScreeningDecision,
    ScreeningRun,
)
from app.repositories.screening_decision_repository import (
    OptimisticConcurrencyError,
    ScreeningDecisionRepository,
)
from app.repositories.screening_run_repository import ScreeningRunRepository


@pytest_asyncio.fixture
async def fixture_assignment_and_user(async_db_session: AsyncSession):
    user_id = uuid4()
    project_id = uuid4()
    article_id = uuid4()
    await async_db_session.execute(
        text("INSERT INTO profiles (id, email) VALUES (:uid, :email)"),
        {"uid": user_id, "email": f"co-{user_id}@example.com"},
    )
    await async_db_session.execute(
        text(
            "INSERT INTO projects (id, owner_id, title, review_type) "
            "VALUES (:pid, :uid, 'T', 'interventional')"
        ),
        {"pid": project_id, "uid": user_id},
    )
    await async_db_session.execute(
        text(
            "INSERT INTO articles (id, project_id, title) VALUES (:aid, :pid, 'X')"
        ),
        {"aid": article_id, "pid": project_id},
    )
    a = ScreeningAssignment(
        project_id=project_id, article_id=article_id, phase="title_abstract"
    )
    async_db_session.add(a)
    await async_db_session.commit()
    await async_db_session.refresh(a)
    return {"assignment_id": a.id, "user_id": user_id, "project_id": project_id}


@pytest.mark.asyncio
async def test_decision_optimistic_concurrency_succeeds(
    async_db_session: AsyncSession, fixture_assignment_and_user: dict
) -> None:
    repo = ScreeningDecisionRepository(async_db_session)
    d = ScreeningDecision(
        assignment_id=fixture_assignment_and_user["assignment_id"],
        reviewer_id=fixture_assignment_and_user["user_id"],
        decision="include",
    )
    async_db_session.add(d)
    await async_db_session.commit()
    await async_db_session.refresh(d)
    assert d.version == 1

    updated = await repo.update_with_version(
        d.id, expected_version=1, patch={"decision": "exclude"}
    )
    await async_db_session.commit()
    assert updated.version == 2
    assert updated.decision == "exclude"


@pytest.mark.asyncio
async def test_decision_optimistic_concurrency_rejects_stale_version(
    async_db_session: AsyncSession, fixture_assignment_and_user: dict
) -> None:
    repo = ScreeningDecisionRepository(async_db_session)
    d = ScreeningDecision(
        assignment_id=fixture_assignment_and_user["assignment_id"],
        reviewer_id=fixture_assignment_and_user["user_id"],
        decision="include",
    )
    async_db_session.add(d)
    await async_db_session.commit()
    await async_db_session.refresh(d)

    # Bump version (simulating concurrent update).
    await async_db_session.execute(
        text("UPDATE screening_decision SET version = 2 WHERE id = :id"),
        {"id": d.id},
    )
    await async_db_session.commit()

    with pytest.raises(OptimisticConcurrencyError):
        await repo.update_with_version(
            d.id, expected_version=1, patch={"decision": "exclude"}
        )


@pytest.mark.asyncio
async def test_decision_listing_deterministic(
    async_db_session: AsyncSession, fixture_assignment_and_user: dict
) -> None:
    """list_for_assignment returns rows ordered by (created_at, id)."""
    repo = ScreeningDecisionRepository(async_db_session)
    aid = fixture_assignment_and_user["assignment_id"]
    user1 = fixture_assignment_and_user["user_id"]
    user2 = uuid4()
    await async_db_session.execute(
        text("INSERT INTO profiles (id, email) VALUES (:uid, :email)"),
        {"uid": user2, "email": f"u2-{user2}@example.com"},
    )
    await async_db_session.commit()
    d1 = ScreeningDecision(assignment_id=aid, reviewer_id=user1, decision="include")
    d2 = ScreeningDecision(assignment_id=aid, reviewer_id=user2, decision="exclude")
    async_db_session.add_all([d1, d2])
    await async_db_session.commit()

    result1 = await repo.list_for_assignment(aid)
    result2 = await repo.list_for_assignment(aid)
    assert [r.id for r in result1] == [r.id for r in result2]  # deterministic


@pytest.mark.asyncio
async def test_run_idempotency_key_returns_existing(
    async_db_session: AsyncSession, fixture_assignment_and_user: dict
) -> None:
    repo = ScreeningRunRepository(async_db_session)
    key = "test-idempotency-key-123"
    run = ScreeningRun(
        project_id=fixture_assignment_and_user["project_id"],
        kind="import_csv",
        idempotency_key=key,
        created_by=fixture_assignment_and_user["user_id"],
    )
    async_db_session.add(run)
    await async_db_session.commit()
    await async_db_session.refresh(run)

    found = await repo.get_by_idempotency_key(key)
    assert found is not None
    assert found.id == run.id


@pytest.mark.asyncio
async def test_run_idempotency_key_misses_old_row(
    async_db_session: AsyncSession, fixture_assignment_and_user: dict
) -> None:
    """Rows older than the TTL are not returned."""
    from datetime import timedelta

    repo = ScreeningRunRepository(async_db_session)
    key = "test-idempotency-key-old"
    run = ScreeningRun(
        project_id=fixture_assignment_and_user["project_id"],
        kind="import_csv",
        idempotency_key=key,
        created_by=fixture_assignment_and_user["user_id"],
    )
    async_db_session.add(run)
    await async_db_session.commit()
    await async_db_session.refresh(run)

    # Backdate created_at past TTL.
    await async_db_session.execute(
        text(
            "UPDATE screening_run SET created_at = now() - INTERVAL '48 hours' "
            "WHERE id = :id"
        ),
        {"id": run.id},
    )
    await async_db_session.commit()

    found = await repo.get_by_idempotency_key(key, ttl=timedelta(hours=24))
    assert found is None
```

- [ ] **Step 2: Run**

```bash
cd backend && pytest tests/integration/test_screening_repositories.py -xvs
```

Expected: 5 passes.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_screening_repositories.py
git commit -m "test(repos): optimistic concurrency, idempotency TTL, deterministic ordering"
```

---

### Task D3: Phase 0 final integration sweep

- [ ] **Step 1: Run the full screening test suite**

```bash
cd backend && pytest tests/integration/test_screening_*.py -xvs
```

Expected: all green (4 + 3 + 5 + 5 = 17 tests).

- [ ] **Step 2: Run the existing test suite to verify no regressions**

```bash
cd backend && pytest -x --ignore=tests/integration/test_screening_*.py
```

Expected: existing tests still pass.

- [ ] **Step 3: Lint**

```bash
cd backend && ruff check app/models/screening.py app/models/screening_note.py \
  app/models/screening_user_preference.py app/models/ai_usage_log.py \
  app/repositories/screening_*.py app/repositories/ai_usage_log_repository.py
```

Expected: no errors.

- [ ] **Step 4: Final commit (no-op if nothing to commit, but checkpoint)**

```bash
git log --oneline | head -25
```

Verify all the Phase 0 commits are present in order.

---

## Self-review checklist (engineer runs before opening PR)

- [ ] All 9 tables exist in DB (`\dt screening_* ai_usage_log` shows 9)
- [ ] All 7 enum types exist (`\dT screening_*` shows the 7 + matching column types)
- [ ] `articles.screening_status` exists with the right enum type
- [ ] Both triggers fire as expected (test `test_enrollment_sets_pending` passes)
- [ ] `alembic downgrade base` works without error and `alembic upgrade head` succeeds again
- [ ] All 9 model classes are importable via `from app.models import ...`
- [ ] All 9 repositories are importable
- [ ] Optimistic concurrency works for `ScreeningDecision` and `ScreeningOutcome`
- [ ] Idempotency-key lookup respects the 24h TTL
- [ ] No raw SQL splitter (PR #7 footgun) — every DDL change uses `op.create_table` / `op.add_column` / `op.execute` for one statement at a time

---

## What ships at the end of Phase 0

- DB schema for the entire screening + imports module
- All SQLAlchemy models
- All repositories with CRUD + lookups + optimistic concurrency + idempotency
- 17 integration tests proving the foundation works

**No services, no endpoints, no UI yet.** Phase 1 (services + API) builds on this foundation.
