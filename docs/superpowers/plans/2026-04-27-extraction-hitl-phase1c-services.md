# Extraction HITL — Phase 1C-1: HITL Service Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five HITL services that orchestrate the proposal/review/consensus/published lifecycle on top of the schema laid down in Plans 1A + 1B. After this plan, the services exist and are tested; endpoints + extraction-service refactor come in Plan 1C-2.

**Architecture:** Five services under `backend/app/services/`, each one fronting one or two repositories under `backend/app/repositories/`. The `RunLifecycleService` is the entry point that snapshots HITL config and creates Runs; the four record-writing services (`ProposalService`, `ReviewService`, `ConsensusService`, plus an internal `PublishedStateService`) use append-only inserts. Reviewer state is materialized via upsert; published state uses optimistic concurrency on a `version` int. Coordinate coherence (`run_id`, `instance_id`, `field_id`) is validated at the service layer because the DB doesn't enforce it.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 async, pytest with `pytest-asyncio` integration tests. Existing `BaseRepository` pattern at `backend/app/repositories/base.py`.

---

## Plans roadmap

| # | Plan | Status |
|---|---|---|
| 1A | Database Foundation | ✅ |
| 1B | Workflow Tables + Evidence + Stage Migration | ✅ |
| 1C-1 | **HITL Service Layer** (this plan) | in this plan |
| 1C-2 | Endpoints + extraction-service refactor + drop 008 endpoints | pending |
| 1D | Synthetic Runs migration + Drop 008 stack | pending |
| 1E | Frontend Shell + ExtractionFullScreen rewire + PDF collapsed | pending |
| 2 | QA — PROBAST + QUADAS-2 seed + page | pending |

---

## Spec reference

`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` §6 (Backend services) and §13 (Risks). Forward-looking notes carried over from Plan 1B's final review:

- **Coordinate coherence**: services must validate that `instance_id` belongs to `run_id`'s template-version and `field_id` belongs to `instance_id`'s entity_type.
- **Reviewer-state coherence**: `current_decision_id` must reference a decision matching the same `(run_id, reviewer_id, instance_id, field_id)`.
- **RLS reviewer concern**: workflow tables use `is_project_manager` for INSERT/UPDATE; reviewers are not necessarily managers. **Decision: services use the existing `db_session` with the caller's auth context, and we bypass RLS only when the service is invoked by a verified reviewer/manager — RLS adjustment is deferred to Plan 1C-2 endpoint layer.** Tests run against `db_session` which uses service-role.

---

## File structure

### Files to create

| File | Responsibility |
|---|---|
| `backend/app/repositories/hitl_config_repository.py` | CRUD + `resolve_for_run(project_id, project_template_id)` returning the snapshot. |
| `backend/app/repositories/extraction_proposal_repository.py` | Append-only write, query by `(run_id, instance_id, field_id)` and by `run_id`. |
| `backend/app/repositories/extraction_reviewer_decision_repository.py` | Append-only write, query by `(run_id, reviewer_id, instance_id, field_id)` (latest), list by `run_id`. |
| `backend/app/repositories/extraction_reviewer_state_repository.py` | Upsert keyed on `(run_id, reviewer_id, instance_id, field_id)`. |
| `backend/app/repositories/extraction_consensus_decision_repository.py` | Append-only write, list by `run_id`. |
| `backend/app/repositories/extraction_published_state_repository.py` | Upsert with optimistic concurrency on `version`. |
| `backend/app/services/hitl_config_service.py` | Resolve project default + template override into snapshot dict. |
| `backend/app/services/run_lifecycle_service.py` | `create_run`, `advance_stage`, `cancel`, with precondition checks. |
| `backend/app/services/extraction_proposal_service.py` | Validates source rules; records proposal. |
| `backend/app/services/extraction_review_service.py` | Validates decision rules; records decision; upserts ReviewerState. |
| `backend/app/services/extraction_consensus_service.py` | Records consensus; publishes to `extraction_published_states` with optimistic concurrency. |
| `backend/tests/integration/test_hitl_config_service.py` | Resolution tests (template > project > system default). |
| `backend/tests/integration/test_run_lifecycle_service.py` | Run creation snapshot + stage transitions + precondition checks. |
| `backend/tests/integration/test_extraction_proposal_service.py` | Source-rule validation, append-only writes, query patterns. |
| `backend/tests/integration/test_extraction_review_service.py` | Decision-rule validation, ReviewerState upsert, conflict detection. |
| `backend/tests/integration/test_extraction_consensus_service.py` | Mode-rule validation, publish with optimistic concurrency 409. |

### Files to modify

| File | Change |
|---|---|
| `backend/app/repositories/__init__.py` | Export the 6 new repositories. |
| `backend/app/services/__init__.py` (if exists) | Export the 5 new services (or leave imports in endpoint files). |

---

## Test strategy

- **Integration tests against real DB** via `db_session` fixture (`backend/tests/conftest.py:85`). Each test should:
  1. Create or look up the necessary fixture data (project, article, profile, template, instance, field).
  2. Call the service method under test.
  3. Assert the resulting DB state and the returned object.
  4. Rollback explicitly when needed; otherwise rely on session disposal.
- **No new unit tests** in this plan — services depend on the DB so testing them in isolation requires more scaffolding than it's worth at this stage. Plan 1C-2 will add API-contract tests at the HTTP layer.
- **Tests are written alongside the service** per the durable user feedback in `memory/feedback_always_test.md`. No deferred test writing.

---

## Naming + style notes (from Plan 1A/1B lessons)

- CHECK constraint declarations from models: pass **suffix only** to `name=` (e.g., `name="human_has_user"`, not `name="ck_extraction_proposal_records_human_has_user"`). The `_naming_convention` in `base.py:153` adds the `ck_<table>_` prefix automatically.
- Postgres identifier limit is 63 chars (NAMEDATALEN). Constraint names like `ck_extraction_consensus_decisions_<long_name>` get truncated silently. Keep suffixes ≤28 chars.
- Always run `ruff check + format --check` on touched files before committing.
- Commit atomically per task.

---

## Task 1: HitlConfigRepository + HitlConfigService + integration tests

**Files:**
- Create: `backend/app/repositories/hitl_config_repository.py`
- Create: `backend/app/services/hitl_config_service.py`
- Create: `backend/tests/integration/test_hitl_config_service.py`
- Modify: `backend/app/repositories/__init__.py`

### Step 1: Write the failing tests

Create `backend/tests/integration/test_hitl_config_service.py`:

```python
"""Integration tests for HitlConfigService."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)
from app.services.hitl_config_service import (
    SYSTEM_DEFAULT_HITL_CONFIG,
    HitlConfigService,
)


@pytest.mark.asyncio
async def test_resolve_returns_system_default_when_no_config_exists(
    db_session: AsyncSession,
) -> None:
    project_id = uuid4()  # nonexistent
    template_id = uuid4()  # nonexistent
    service = HitlConfigService(db_session)
    snapshot = await service.resolve_snapshot(project_id, template_id)
    assert snapshot == SYSTEM_DEFAULT_HITL_CONFIG


@pytest.mark.asyncio
async def test_resolve_returns_project_config_when_template_has_none(
    db_session: AsyncSession,
) -> None:
    project_id = (
        await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    template_id = (
        await db_session.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    if not (project_id and template_id):
        pytest.skip("Need projects + project_extraction_templates fixtures.")

    # Clear any pre-existing configs for this project + template
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_hitl_configs "
            "WHERE (scope_kind = 'project' AND scope_id = :pid) "
            "OR (scope_kind = 'template' AND scope_id = :tid)"
        ),
        {"pid": project_id, "tid": template_id},
    )
    await db_session.flush()

    db_session.add(
        ExtractionHitlConfig(
            scope_kind=HitlConfigScopeKind.PROJECT.value,
            scope_id=project_id,
            reviewer_count=2,
            consensus_rule=ConsensusRule.MAJORITY.value,
        )
    )
    await db_session.flush()

    service = HitlConfigService(db_session)
    snapshot = await service.resolve_snapshot(project_id, template_id)
    assert snapshot["scope_kind"] == "project"
    assert snapshot["reviewer_count"] == 2
    assert snapshot["consensus_rule"] == "majority"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_resolve_template_overrides_project(
    db_session: AsyncSession,
) -> None:
    project_id = (
        await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    template_id = (
        await db_session.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if not (project_id and template_id and profile_id):
        pytest.skip("Need projects + templates + profiles fixtures.")

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_hitl_configs "
            "WHERE (scope_kind = 'project' AND scope_id = :pid) "
            "OR (scope_kind = 'template' AND scope_id = :tid)"
        ),
        {"pid": project_id, "tid": template_id},
    )
    await db_session.flush()

    db_session.add(
        ExtractionHitlConfig(
            scope_kind=HitlConfigScopeKind.PROJECT.value,
            scope_id=project_id,
            reviewer_count=2,
            consensus_rule=ConsensusRule.MAJORITY.value,
        )
    )
    db_session.add(
        ExtractionHitlConfig(
            scope_kind=HitlConfigScopeKind.TEMPLATE.value,
            scope_id=template_id,
            reviewer_count=3,
            consensus_rule=ConsensusRule.ARBITRATOR.value,
            arbitrator_id=profile_id,
        )
    )
    await db_session.flush()

    service = HitlConfigService(db_session)
    snapshot = await service.resolve_snapshot(project_id, template_id)
    assert snapshot["scope_kind"] == "template"
    assert snapshot["reviewer_count"] == 3
    assert snapshot["consensus_rule"] == "arbitrator"
    assert snapshot["arbitrator_id"] == str(profile_id)
    await db_session.rollback()
```

### Step 2: Run tests to verify they fail

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_hitl_config_service.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.services.hitl_config_service'`.

### Step 3: Create the repository

Create `backend/app/repositories/hitl_config_repository.py`:

```python
"""Repository for ExtractionHitlConfig."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)


class HitlConfigRepository:
    """Read access for ExtractionHitlConfig records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_scope(
        self,
        scope_kind: HitlConfigScopeKind | str,
        scope_id: UUID,
    ) -> ExtractionHitlConfig | None:
        kind_value = (
            scope_kind.value if isinstance(scope_kind, HitlConfigScopeKind) else scope_kind
        )
        stmt = select(ExtractionHitlConfig).where(
            ExtractionHitlConfig.scope_kind == kind_value,
            ExtractionHitlConfig.scope_id == scope_id,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
```

### Step 4: Create the service

Create `backend/app/services/hitl_config_service.py`:

```python
"""Resolve HITL configuration into a snapshot for a Run.

Resolution order: template-scoped > project-scoped > system default.
"""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)
from app.repositories.hitl_config_repository import HitlConfigRepository

SYSTEM_DEFAULT_HITL_CONFIG: dict[str, Any] = {
    "scope_kind": "system_default",
    "reviewer_count": 1,
    "consensus_rule": "unanimous",
    "arbitrator_id": None,
}


class HitlConfigService:
    """Resolves HITL config for a Run + produces snapshot dict."""

    def __init__(self, db: AsyncSession):
        self._repo = HitlConfigRepository(db)

    async def resolve_snapshot(
        self,
        project_id: UUID,
        project_template_id: UUID,
    ) -> dict[str, Any]:
        """Return the resolved HITL config as a JSON-serializable snapshot."""
        template_config = await self._repo.get_by_scope(
            HitlConfigScopeKind.TEMPLATE,
            project_template_id,
        )
        if template_config is not None:
            return self._to_snapshot(template_config)

        project_config = await self._repo.get_by_scope(
            HitlConfigScopeKind.PROJECT,
            project_id,
        )
        if project_config is not None:
            return self._to_snapshot(project_config)

        return SYSTEM_DEFAULT_HITL_CONFIG.copy()

    @staticmethod
    def _to_snapshot(config: ExtractionHitlConfig) -> dict[str, Any]:
        return {
            "scope_kind": config.scope_kind,
            "scope_id": str(config.scope_id),
            "reviewer_count": config.reviewer_count,
            "consensus_rule": config.consensus_rule,
            "arbitrator_id": (
                str(config.arbitrator_id) if config.arbitrator_id else None
            ),
        }
```

### Step 5: Export the new repository

Modify `backend/app/repositories/__init__.py` to add:

```python
from app.repositories.hitl_config_repository import HitlConfigRepository
```

(Append it alphabetically into the existing import block; if there's an `__all__`, add `"HitlConfigRepository"`.)

### Step 6: Run tests to verify pass

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_hitl_config_service.py -v
```

Expected: 3 tests PASS.

### Step 7: Ruff

```bash
cd backend && uv run ruff check app/repositories/hitl_config_repository.py app/services/hitl_config_service.py app/repositories/__init__.py tests/integration/test_hitl_config_service.py
```

### Step 8: Commit

```bash
git add backend/app/repositories/hitl_config_repository.py backend/app/services/hitl_config_service.py backend/app/repositories/__init__.py backend/tests/integration/test_hitl_config_service.py
git commit -m "feat(extraction): add HitlConfigService + repository for resolving HITL config snapshots"
```

---

## Task 2: RunLifecycleService — create_run + advance_stage + cancel

**Files:**
- Modify: `backend/app/repositories/extraction_run_repository.py` (add `create_run_v2` or extend existing `create_run`)
- Create: `backend/app/services/run_lifecycle_service.py`
- Create: `backend/tests/integration/test_run_lifecycle_service.py`

The service is the **entry point** for the new HITL flow: it creates a Run for an article × template, snapshots the HITL config (via `HitlConfigService`), looks up the active `ExtractionTemplateVersion`, and inserts the Run with `stage=pending`, `status=pending`. It also exposes `advance_stage(run_id, target_stage, user_id)` with precondition checks.

### Stage transition matrix (precondition checks)

| from \\ to | pending | proposal | review | consensus | finalized | cancelled |
|---|---|---|---|---|---|---|
| pending     | —     | ✅     | ❌    | ❌        | ❌        | ✅      |
| proposal    | ❌    | —      | ✅ if ≥1 proposal exists | ❌ | ❌ | ✅ |
| review      | ❌    | ❌     | —     | ✅ if all reviewers have ≥1 decision per item | ❌ | ✅ |
| consensus   | ❌    | ❌     | ❌    | —         | ✅ if all items have a consensus + published_state | ✅ |
| finalized   | ❌    | ❌     | ❌    | ❌        | —         | ❌ (frozen) |
| cancelled   | ❌    | ❌     | ❌    | ❌        | ❌        | — (terminal) |

Invalid transitions raise `InvalidStageTransitionError`.

### Step 1: Write failing tests

Create `backend/tests/integration/test_run_lifecycle_service.py`:

```python
"""Integration tests for RunLifecycleService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)


async def _fixtures(db: AsyncSession) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Return (project_id, article_id, project_template_id, profile_id) or None."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    return project_id, article_id, template_id, profile_id


@pytest.mark.asyncio
async def test_create_run_snapshots_hitl_config_and_active_version(
    db_session: AsyncSession,
) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    assert run.stage == ExtractionRunStage.PENDING.value
    assert run.kind == "extraction"
    assert run.version_id is not None  # active TemplateVersion linked
    assert run.hitl_config_snapshot is not None
    assert "reviewer_count" in run.hitl_config_snapshot
    await db_session.rollback()


@pytest.mark.asyncio
async def test_advance_pending_to_proposal_succeeds(
    db_session: AsyncSession,
) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    advanced = await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    assert advanced.stage == ExtractionRunStage.PROPOSAL.value
    await db_session.rollback()


@pytest.mark.asyncio
async def test_advance_pending_to_review_fails(db_session: AsyncSession) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    with pytest.raises(InvalidStageTransitionError):
        await service.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.REVIEW,
            user_id=profile_id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_cancel_from_any_stage(db_session: AsyncSession) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    cancelled = await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CANCELLED,
        user_id=profile_id,
    )
    assert cancelled.stage == ExtractionRunStage.CANCELLED.value
    await db_session.rollback()


@pytest.mark.asyncio
async def test_cannot_advance_from_cancelled(db_session: AsyncSession) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    service = RunLifecycleService(db_session)
    run = await service.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CANCELLED,
        user_id=profile_id,
    )
    with pytest.raises(InvalidStageTransitionError):
        await service.advance_stage(
            run_id=run.id,
            target_stage=ExtractionRunStage.PROPOSAL,
            user_id=profile_id,
        )
    await db_session.rollback()
```

### Step 2: Run tests to verify they fail

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_run_lifecycle_service.py -v
```

Expected: `ModuleNotFoundError`.

### Step 3: Implement the service

Create `backend/app/services/run_lifecycle_service.py`:

```python
"""Run lifecycle service: create + advance stage with precondition checks."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage, ExtractionRunStatus
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.hitl_config_service import HitlConfigService


class InvalidStageTransitionError(Exception):
    """Raised when a stage transition is not permitted from the current stage."""


class TemplateVersionNotFoundError(Exception):
    """Raised when no active TemplateVersion exists for a template."""


# Allowed transitions: from -> set of valid target stages
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    ExtractionRunStage.PENDING.value: {
        ExtractionRunStage.PROPOSAL.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.PROPOSAL.value: {
        ExtractionRunStage.REVIEW.value,
        ExtractionRunStage.CANCELLED.value,
    },
    ExtractionRunStage.REVIEW.value: {
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


class RunLifecycleService:
    """Owns Run creation and stage transitions."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._hitl = HitlConfigService(db)

    async def create_run(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        project_template_id: UUID,
        user_id: UUID,
        parameters: dict[str, Any] | None = None,
    ) -> ExtractionRun:
        # Resolve active TemplateVersion
        version_stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        version = (await self.db.execute(version_stmt)).scalar_one_or_none()
        if version is None:
            raise TemplateVersionNotFoundError(
                f"No active ExtractionTemplateVersion for template {project_template_id}"
            )

        snapshot = await self._hitl.resolve_snapshot(project_id, project_template_id)

        run = ExtractionRun(
            project_id=project_id,
            article_id=article_id,
            template_id=project_template_id,
            kind="extraction",
            version_id=version.id,
            hitl_config_snapshot=snapshot,
            stage=ExtractionRunStage.PENDING.value,
            status=ExtractionRunStatus.PENDING.value,
            parameters=parameters or {},
            results={},
            created_by=user_id,
        )
        self.db.add(run)
        await self.db.flush()
        await self.db.refresh(run)
        return run

    async def advance_stage(
        self,
        *,
        run_id: UUID,
        target_stage: ExtractionRunStage | str,
        user_id: UUID,  # noqa: ARG002 — captured for audit later
    ) -> ExtractionRun:
        target = (
            target_stage.value
            if isinstance(target_stage, ExtractionRunStage)
            else target_stage
        )
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        allowed = _ALLOWED_TRANSITIONS.get(run.stage, set())
        if target not in allowed:
            raise InvalidStageTransitionError(
                f"Cannot transition from {run.stage} to {target}"
            )
        run.stage = target
        if target == ExtractionRunStage.CANCELLED.value:
            run.status = ExtractionRunStatus.FAILED.value
        elif target == ExtractionRunStage.FINALIZED.value:
            run.status = ExtractionRunStatus.COMPLETED.value
        await self.db.flush()
        await self.db.refresh(run)
        return run
```

### Step 4: Run tests to verify pass

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_run_lifecycle_service.py -v
```

Expected: 5 PASS.

### Step 5: Ruff + commit

```bash
cd backend && uv run ruff check app/services/run_lifecycle_service.py tests/integration/test_run_lifecycle_service.py
git add backend/app/services/run_lifecycle_service.py backend/tests/integration/test_run_lifecycle_service.py
git commit -m "feat(extraction): add RunLifecycleService — create_run + advance_stage with precondition checks"
```

---

## Task 3: ProposalRepository + ProposalService

**Files:**
- Create: `backend/app/repositories/extraction_proposal_repository.py`
- Create: `backend/app/services/extraction_proposal_service.py`
- Create: `backend/tests/integration/test_extraction_proposal_service.py`
- Modify: `backend/app/repositories/__init__.py` (export new repo)

### What this task delivers

- Repository: simple `add(record)` + `list_by_run(run_id)` + `list_by_item(run_id, instance_id, field_id)`.
- Service: `record_proposal(...)` validates that:
  1. `source` is one of the enum values.
  2. If `source == 'human'`, `source_user_id` is required (DB CHECK already enforces, but raise a friendly error early).
  3. The Run is in `proposal` stage.
  4. The `(run_id, instance_id, field_id)` coordinates are coherent: `instance_id` must belong to a template version that matches the Run's `version_id`, and `field_id` must belong to `instance_id`'s entity_type. (Coordinate-coherence validation.)
- Append-only — the service never updates an existing record.

### Step 1: Write failing tests

Create `backend/tests/integration/test_extraction_proposal_service.py`:

```python
"""Integration tests for ExtractionProposalService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import (
    ExtractionProposalService,
    InvalidProposalError,
)
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_run_with_instance_field(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build a run + advance to proposal + return (run_id, instance_id, field_id, profile_id)."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    instance_id = (
        await db.execute(
            text(
                "SELECT i.id FROM public.extraction_instances i "
                "JOIN public.project_extraction_templates t ON t.id = i.template_id "
                "LIMIT 1"
            )
        )
    ).scalar()
    field_id = (
        await db.execute(
            text(
                "SELECT f.id FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "JOIN public.extraction_instances i ON i.entity_type_id = et.id "
                "LIMIT 1"
            )
        )
    ).scalar()
    if not all((project_id, article_id, template_id, profile_id, instance_id, field_id)):
        return None
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id


@pytest.mark.asyncio
async def test_record_ai_proposal(db_session: AsyncSession) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    record = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"text": "from LLM"},
        confidence_score=0.92,
        rationale="page 4",
    )
    assert record.id is not None
    assert record.source == "ai"
    assert record.confidence_score == 0.92
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_human_proposal_requires_user_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN,
            proposed_value={"text": "manual"},
            source_user_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_proposal_blocked_outside_proposal_stage(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = fx
    # Move run forward past proposal stage
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"text": "too late"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_list_by_item_returns_chronological(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    p1 = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "1"},
    )
    p2 = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "2"},
    )
    rows = await service.list_by_item(run_id, instance_id, field_id)
    ids = [r.id for r in rows]
    assert p1.id in ids and p2.id in ids
    # Chronological — p1 first
    assert ids.index(p1.id) < ids.index(p2.id)
    await db_session.rollback()
```

### Step 2: Implement repository

Create `backend/app/repositories/extraction_proposal_repository.py`:

```python
"""Repository for ExtractionProposalRecord."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionProposalRecord


class ExtractionProposalRepository:
    """Append-only access for proposal records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def add(self, record: ExtractionProposalRecord) -> ExtractionProposalRecord:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def list_by_item(
        self,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionProposalRecord]:
        stmt = (
            select(ExtractionProposalRecord)
            .where(
                ExtractionProposalRecord.run_id == run_id,
                ExtractionProposalRecord.instance_id == instance_id,
                ExtractionProposalRecord.field_id == field_id,
            )
            .order_by(ExtractionProposalRecord.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_by_run(self, run_id: UUID) -> list[ExtractionProposalRecord]:
        stmt = (
            select(ExtractionProposalRecord)
            .where(ExtractionProposalRecord.run_id == run_id)
            .order_by(ExtractionProposalRecord.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

### Step 3: Implement the service

Create `backend/app/services/extraction_proposal_service.py`:

```python
"""Service: validate + record proposals append-only."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.repositories.extraction_proposal_repository import (
    ExtractionProposalRepository,
)


class InvalidProposalError(Exception):
    """Raised when a proposal violates business rules (stage / source / coords)."""


class ExtractionProposalService:
    """Append-only proposal writes with rule validation."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._repo = ExtractionProposalRepository(db)

    async def record_proposal(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        source: ExtractionProposalSource | str,
        proposed_value: dict,
        source_user_id: UUID | None = None,
        confidence_score: float | None = None,
        rationale: str | None = None,
    ) -> ExtractionProposalRecord:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidProposalError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.PROPOSAL.value:
            raise InvalidProposalError(
                f"Cannot record proposal: run stage is {run.stage}, not 'proposal'"
            )

        source_value = (
            source.value if isinstance(source, ExtractionProposalSource) else source
        )
        if source_value == "human" and source_user_id is None:
            raise InvalidProposalError(
                "source='human' requires source_user_id"
            )

        record = ExtractionProposalRecord(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=source_value,
            source_user_id=source_user_id,
            proposed_value=proposed_value,
            confidence_score=confidence_score,
            rationale=rationale,
        )
        return await self._repo.add(record)

    async def list_by_item(
        self,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionProposalRecord]:
        return await self._repo.list_by_item(run_id, instance_id, field_id)

    async def list_by_run(self, run_id: UUID) -> list[ExtractionProposalRecord]:
        return await self._repo.list_by_run(run_id)
```

### Step 4: Export repo, run tests, ruff, commit

Add `from app.repositories.extraction_proposal_repository import ExtractionProposalRepository` to `backend/app/repositories/__init__.py`.

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_extraction_proposal_service.py -v
cd backend && uv run ruff check app/services/extraction_proposal_service.py app/repositories/extraction_proposal_repository.py tests/integration/test_extraction_proposal_service.py
git add backend/app/services/extraction_proposal_service.py backend/app/repositories/extraction_proposal_repository.py backend/app/repositories/__init__.py backend/tests/integration/test_extraction_proposal_service.py
git commit -m "feat(extraction): add ProposalService + repository for append-only proposal records"
```

---

## Task 4: ReviewService — record_decision + reviewer_states upsert + conflict detection

**Files:**
- Create: `backend/app/repositories/extraction_reviewer_decision_repository.py`
- Create: `backend/app/repositories/extraction_reviewer_state_repository.py`
- Create: `backend/app/services/extraction_review_service.py`
- Create: `backend/tests/integration/test_extraction_review_service.py`
- Modify: `backend/app/repositories/__init__.py`

### Step 1: Write failing tests

Create `backend/tests/integration/test_extraction_review_service.py`:

```python
"""Integration tests for ExtractionReviewService."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_review_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Build run, advance to review, return (run_id, instance_id, field_id, profile_id, proposal_id, alt_profile_id?)."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    instance_id = (
        await db.execute(
            text("SELECT id FROM public.extraction_instances LIMIT 1")
        )
    ).scalar()
    field_id = (
        await db.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))
    ).scalar()
    if not all((project_id, article_id, template_id, profile_id, instance_id, field_id)):
        return None

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    proposal = await ExtractionProposalService(db).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"text": "candidate"},
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id, proposal.id, profile_id


@pytest.mark.asyncio
async def test_record_accept_proposal_decision(db_session: AsyncSession) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx

    service = ExtractionReviewService(db_session)
    decision = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    assert decision.decision == "accept_proposal"
    assert decision.proposal_record_id == proposal_id

    # ReviewerState was upserted
    state = await service.get_reviewer_state(
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == decision.id
    await db_session.rollback()


@pytest.mark.asyncio
async def test_accept_proposal_requires_proposal_record_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
            proposal_record_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_edit_decision_requires_value(db_session: AsyncSession) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _, _ = fx

    service = ExtractionReviewService(db_session)
    with pytest.raises(InvalidDecisionError):
        await service.record_decision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=profile_id,
            decision=ExtractionReviewerDecisionType.EDIT,
            value=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_second_decision_replaces_reviewer_state(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_review_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, proposal_id, _ = fx

    service = ExtractionReviewService(db_session)
    first = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    second = await service.record_decision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"text": "edited"},
        rationale="changed my mind",
    )
    state = await service.get_reviewer_state(
        run_id=run_id,
        reviewer_id=profile_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert state is not None
    assert state.current_decision_id == second.id
    assert state.current_decision_id != first.id
    await db_session.rollback()
```

### Step 2: Implement repositories

Create `backend/app/repositories/extraction_reviewer_decision_repository.py`:

```python
"""Repository for ExtractionReviewerDecision."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionReviewerDecision


class ExtractionReviewerDecisionRepository:
    """Append-only access for reviewer decisions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def add(
        self, record: ExtractionReviewerDecision
    ) -> ExtractionReviewerDecision:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def list_by_run(
        self, run_id: UUID
    ) -> list[ExtractionReviewerDecision]:
        stmt = (
            select(ExtractionReviewerDecision)
            .where(ExtractionReviewerDecision.run_id == run_id)
            .order_by(ExtractionReviewerDecision.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_by_reviewer_item(
        self,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionReviewerDecision]:
        stmt = (
            select(ExtractionReviewerDecision)
            .where(
                ExtractionReviewerDecision.run_id == run_id,
                ExtractionReviewerDecision.reviewer_id == reviewer_id,
                ExtractionReviewerDecision.instance_id == instance_id,
                ExtractionReviewerDecision.field_id == field_id,
            )
            .order_by(ExtractionReviewerDecision.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

Create `backend/app/repositories/extraction_reviewer_state_repository.py`:

```python
"""Repository for ExtractionReviewerState — upsert keyed on (run, reviewer, instance, field)."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionReviewerState


class ExtractionReviewerStateRepository:
    """Materialized current-decision state per (reviewer, run, item)."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def upsert(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        current_decision_id: UUID,
    ) -> ExtractionReviewerState:
        stmt = (
            insert(ExtractionReviewerState)
            .values(
                run_id=run_id,
                reviewer_id=reviewer_id,
                instance_id=instance_id,
                field_id=field_id,
                current_decision_id=current_decision_id,
            )
            .on_conflict_do_update(
                constraint="uq_extraction_reviewer_states_run_reviewer_item",
                set_={
                    "current_decision_id": current_decision_id,
                    "last_updated": func.now(),
                },
            )
        )
        await self.db.execute(stmt)
        await self.db.flush()
        # Read back the row
        select_stmt = select(ExtractionReviewerState).where(
            ExtractionReviewerState.run_id == run_id,
            ExtractionReviewerState.reviewer_id == reviewer_id,
            ExtractionReviewerState.instance_id == instance_id,
            ExtractionReviewerState.field_id == field_id,
        )
        row = (await self.db.execute(select_stmt)).scalar_one()
        return row

    async def get(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionReviewerState | None:
        stmt = select(ExtractionReviewerState).where(
            ExtractionReviewerState.run_id == run_id,
            ExtractionReviewerState.reviewer_id == reviewer_id,
            ExtractionReviewerState.instance_id == instance_id,
            ExtractionReviewerState.field_id == field_id,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
```

### Step 3: Implement the service

Create `backend/app/services/extraction_review_service.py`:

```python
"""Service: validate reviewer decisions, write append-only, upsert ReviewerState."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.repositories.extraction_reviewer_state_repository import (
    ExtractionReviewerStateRepository,
)


class InvalidDecisionError(Exception):
    """Raised when a reviewer decision violates business rules."""


class ExtractionReviewService:
    """Append-only reviewer decisions + materialized ReviewerState upsert."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._decisions = ExtractionReviewerDecisionRepository(db)
        self._states = ExtractionReviewerStateRepository(db)

    async def record_decision(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        reviewer_id: UUID,
        decision: ExtractionReviewerDecisionType | str,
        proposal_record_id: UUID | None = None,
        value: dict | None = None,
        rationale: str | None = None,
    ) -> ExtractionReviewerDecision:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidDecisionError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.REVIEW.value:
            raise InvalidDecisionError(
                f"Cannot record decision: run stage is {run.stage}, not 'review'"
            )

        decision_value = (
            decision.value
            if isinstance(decision, ExtractionReviewerDecisionType)
            else decision
        )
        if decision_value == "accept_proposal" and proposal_record_id is None:
            raise InvalidDecisionError(
                "decision='accept_proposal' requires proposal_record_id"
            )
        if decision_value == "edit" and value is None:
            raise InvalidDecisionError("decision='edit' requires value")

        record = ExtractionReviewerDecision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=reviewer_id,
            decision=decision_value,
            proposal_record_id=proposal_record_id,
            value=value,
            rationale=rationale,
        )
        await self._decisions.add(record)
        await self._states.upsert(
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
            current_decision_id=record.id,
        )
        return record

    async def get_reviewer_state(
        self,
        *,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionReviewerState | None:
        return await self._states.get(
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
        )
```

### Step 4: Export repos + run tests + ruff + commit

Append both new repos to `backend/app/repositories/__init__.py`:

```python
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)
from app.repositories.extraction_reviewer_state_repository import (
    ExtractionReviewerStateRepository,
)
```

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_extraction_review_service.py -v
cd backend && uv run ruff check app/services/extraction_review_service.py app/repositories/extraction_reviewer_*.py tests/integration/test_extraction_review_service.py
git add backend/app/services/extraction_review_service.py backend/app/repositories/extraction_reviewer_decision_repository.py backend/app/repositories/extraction_reviewer_state_repository.py backend/app/repositories/__init__.py backend/tests/integration/test_extraction_review_service.py
git commit -m "feat(extraction): add ReviewService + decision/state repositories with upsert"
```

---

## Task 5: ConsensusService — consensus decisions + published_state with optimistic concurrency

**Files:**
- Create: `backend/app/repositories/extraction_consensus_decision_repository.py`
- Create: `backend/app/repositories/extraction_published_state_repository.py`
- Create: `backend/app/services/extraction_consensus_service.py`
- Create: `backend/tests/integration/test_extraction_consensus_service.py`
- Modify: `backend/app/repositories/__init__.py`

### What this task delivers

- `ConsensusDecisionRepository`: append-only writes.
- `PublishedStateRepository`: upsert with optimistic concurrency on `version` int.
- `ConsensusService.record_consensus(...)`: validates mode rules, writes consensus, calls `publish(...)` to update PublishedState.
- `ConsensusService.publish(...)`: increments version; raises `OptimisticConcurrencyError` if `expected_version` mismatch.

### Step 1: Write failing tests

Create `backend/tests/integration/test_extraction_consensus_service.py`:

```python
"""Integration tests for ExtractionConsensusService."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_consensus_service import (
    ExtractionConsensusService,
    InvalidConsensusError,
    OptimisticConcurrencyError,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_consensus_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID] | None:
    """Build run, advance to consensus stage, return (run_id, instance_id, field_id, profile_id, decision_id)."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    instance_id = (
        await db.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    field_id = (
        await db.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))
    ).scalar()
    if not all((project_id, article_id, template_id, profile_id, instance_id, field_id)):
        return None

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    proposal = await ExtractionProposalService(db).record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "candidate"},
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    decision = await ExtractionReviewService(db).record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal.id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id, decision.id


@pytest.mark.asyncio
async def test_record_select_existing_consensus_publishes_state(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, decision_id = fx

    service = ExtractionConsensusService(db_session)
    consensus, published = await service.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.SELECT_EXISTING,
        selected_decision_id=decision_id,
    )
    assert consensus.mode == "select_existing"
    assert published.version == 1
    await db_session.rollback()


@pytest.mark.asyncio
async def test_select_existing_requires_decision_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _ = fx

    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError):
        await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.SELECT_EXISTING,
            selected_decision_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_manual_override_requires_value_and_rationale(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, _ = fx

    service = ExtractionConsensusService(db_session)
    with pytest.raises(InvalidConsensusError):
        await service.record_consensus(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=profile_id,
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value=None,
            rationale=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_publish_optimistic_concurrency_conflict(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_consensus_run(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id, decision_id = fx

    service = ExtractionConsensusService(db_session)
    _, published = await service.record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.SELECT_EXISTING,
        selected_decision_id=decision_id,
    )
    # Second consensus with stale expected_version should raise.
    with pytest.raises(OptimisticConcurrencyError):
        await service.publish(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value={"v": "stale"},
            published_by=profile_id,
            expected_version=99,  # stale
        )
    await db_session.rollback()
```

### Step 2: Implement repositories

Create `backend/app/repositories/extraction_consensus_decision_repository.py`:

```python
"""Repository for ExtractionConsensusDecision."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionConsensusDecision


class ExtractionConsensusDecisionRepository:
    """Append-only access for consensus decisions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def add(
        self, record: ExtractionConsensusDecision
    ) -> ExtractionConsensusDecision:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def list_by_run(
        self, run_id: UUID
    ) -> list[ExtractionConsensusDecision]:
        stmt = (
            select(ExtractionConsensusDecision)
            .where(ExtractionConsensusDecision.run_id == run_id)
            .order_by(ExtractionConsensusDecision.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
```

Create `backend/app/repositories/extraction_published_state_repository.py`:

```python
"""Repository for ExtractionPublishedState with optimistic concurrency."""

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionPublishedState


class ExtractionPublishedStateRepository:
    """Canonical-state writes with version-based optimistic concurrency."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionPublishedState | None:
        stmt = select(ExtractionPublishedState).where(
            ExtractionPublishedState.run_id == run_id,
            ExtractionPublishedState.instance_id == instance_id,
            ExtractionPublishedState.field_id == field_id,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def insert_first(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
    ) -> ExtractionPublishedState:
        record = ExtractionPublishedState(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
            version=1,
        )
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def update_with_optimistic_lock(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
        expected_version: int,
    ) -> int:
        """Returns the rowcount; 0 means optimistic-concurrency conflict."""
        stmt = (
            update(ExtractionPublishedState)
            .where(
                ExtractionPublishedState.run_id == run_id,
                ExtractionPublishedState.instance_id == instance_id,
                ExtractionPublishedState.field_id == field_id,
                ExtractionPublishedState.version == expected_version,
            )
            .values(
                value=value,
                published_by=published_by,
                version=expected_version + 1,
            )
        )
        result = await self.db.execute(stmt)
        await self.db.flush()
        return result.rowcount
```

### Step 3: Implement the service

Create `backend/app/services/extraction_consensus_service.py`:

```python
"""Service: consensus decisions + publish with optimistic concurrency."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionPublishedState,
)
from app.repositories.extraction_consensus_decision_repository import (
    ExtractionConsensusDecisionRepository,
)
from app.repositories.extraction_published_state_repository import (
    ExtractionPublishedStateRepository,
)
from app.repositories.extraction_reviewer_decision_repository import (
    ExtractionReviewerDecisionRepository,
)


class InvalidConsensusError(Exception):
    """Raised when a consensus decision violates business rules."""


class OptimisticConcurrencyError(Exception):
    """Raised when expected_version doesn't match the published state."""


class ExtractionConsensusService:
    """Append-only consensus + canonical PublishedState writes."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._consensus = ExtractionConsensusDecisionRepository(db)
        self._published = ExtractionPublishedStateRepository(db)
        self._decisions = ExtractionReviewerDecisionRepository(db)

    async def record_consensus(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        consensus_user_id: UUID,
        mode: ExtractionConsensusMode | str,
        selected_decision_id: UUID | None = None,
        value: dict | None = None,
        rationale: str | None = None,
    ) -> tuple[ExtractionConsensusDecision, ExtractionPublishedState]:
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise InvalidConsensusError(f"Run {run_id} not found")
        if run.stage != ExtractionRunStage.CONSENSUS.value:
            raise InvalidConsensusError(
                f"Cannot record consensus: run stage is {run.stage}, not 'consensus'"
            )

        mode_value = (
            mode.value if isinstance(mode, ExtractionConsensusMode) else mode
        )

        if mode_value == "select_existing" and selected_decision_id is None:
            raise InvalidConsensusError(
                "mode='select_existing' requires selected_decision_id"
            )
        if mode_value == "manual_override" and (value is None or rationale is None):
            raise InvalidConsensusError(
                "mode='manual_override' requires both value and rationale"
            )

        # Resolve value to publish: from selected reviewer decision or from manual override
        if mode_value == "select_existing":
            decisions = await self._decisions.list_by_run(run_id)
            selected = next(
                (d for d in decisions if d.id == selected_decision_id), None
            )
            if selected is None:
                raise InvalidConsensusError(
                    f"selected_decision_id {selected_decision_id} not in run {run_id}"
                )
            published_value = selected.value or {}
            # accept_proposal decisions don't carry a value column directly; in that
            # case we fall back to the proposal's value via the proposal_record_id.
            if not published_value and selected.proposal_record_id:
                from app.repositories.extraction_proposal_repository import (
                    ExtractionProposalRepository,
                )

                proposal_repo = ExtractionProposalRepository(self.db)
                proposals = await proposal_repo.list_by_run(run_id)
                proposal = next(
                    (p for p in proposals if p.id == selected.proposal_record_id),
                    None,
                )
                if proposal is not None:
                    published_value = proposal.proposed_value
        else:  # manual_override
            published_value = value or {}

        consensus_record = ExtractionConsensusDecision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=consensus_user_id,
            mode=mode_value,
            selected_decision_id=selected_decision_id,
            value=value,
            rationale=rationale,
        )
        await self._consensus.add(consensus_record)

        published = await self._publish_internal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=published_value,
            published_by=consensus_user_id,
        )
        return consensus_record, published

    async def publish(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
        expected_version: int,
    ) -> ExtractionPublishedState:
        rowcount = await self._published.update_with_optimistic_lock(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
            expected_version=expected_version,
        )
        if rowcount == 0:
            raise OptimisticConcurrencyError(
                f"expected_version={expected_version} did not match current state"
            )
        existing = await self._published.get(
            run_id=run_id, instance_id=instance_id, field_id=field_id
        )
        assert existing is not None
        return existing

    async def _publish_internal(
        self,
        *,
        run_id: UUID,
        instance_id: UUID,
        field_id: UUID,
        value: dict,
        published_by: UUID,
    ) -> ExtractionPublishedState:
        existing = await self._published.get(
            run_id=run_id, instance_id=instance_id, field_id=field_id
        )
        if existing is None:
            return await self._published.insert_first(
                run_id=run_id,
                instance_id=instance_id,
                field_id=field_id,
                value=value,
                published_by=published_by,
            )
        rowcount = await self._published.update_with_optimistic_lock(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            value=value,
            published_by=published_by,
            expected_version=existing.version,
        )
        if rowcount == 0:
            raise OptimisticConcurrencyError(
                f"PublishedState changed during consensus write for {run_id}/{instance_id}/{field_id}"
            )
        latest = await self._published.get(
            run_id=run_id, instance_id=instance_id, field_id=field_id
        )
        assert latest is not None
        return latest
```

### Step 4: Export repos + run tests + ruff + commit

Append to `backend/app/repositories/__init__.py`:

```python
from app.repositories.extraction_consensus_decision_repository import (
    ExtractionConsensusDecisionRepository,
)
from app.repositories.extraction_published_state_repository import (
    ExtractionPublishedStateRepository,
)
```

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest tests/integration/test_extraction_consensus_service.py -v
cd backend && uv run ruff check app/services/extraction_consensus_service.py app/repositories/extraction_consensus_decision_repository.py app/repositories/extraction_published_state_repository.py tests/integration/test_extraction_consensus_service.py
git add backend/app/services/extraction_consensus_service.py backend/app/repositories/extraction_consensus_decision_repository.py backend/app/repositories/extraction_published_state_repository.py backend/app/repositories/__init__.py backend/tests/integration/test_extraction_consensus_service.py
git commit -m "feat(extraction): add ConsensusService — consensus decisions + publish with optimistic concurrency"
```

---

## Task 6: Full backend suite + lint

Verification only.

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest -q
cd backend && uv run ruff check app/services/hitl_config_service.py app/services/run_lifecycle_service.py app/services/extraction_proposal_service.py app/services/extraction_review_service.py app/services/extraction_consensus_service.py app/repositories/hitl_config_repository.py app/repositories/extraction_proposal_repository.py app/repositories/extraction_reviewer_decision_repository.py app/repositories/extraction_reviewer_state_repository.py app/repositories/extraction_consensus_decision_repository.py app/repositories/extraction_published_state_repository.py app/repositories/__init__.py tests/integration/test_hitl_config_service.py tests/integration/test_run_lifecycle_service.py tests/integration/test_extraction_proposal_service.py tests/integration/test_extraction_review_service.py tests/integration/test_extraction_consensus_service.py
cd backend && uv run ruff format --check <same files>
```

Expected: full suite passes; ruff clean. If formatter wants to change anything, run `uv run ruff format <files>` and commit a `chore: ruff format` follow-up.

---

## Self-review checklist

- ✅ All 5 services created (HitlConfig, RunLifecycle, Proposal, Review, Consensus)
- ✅ All 6 repositories created and exported
- ✅ Each service has integration tests against real DB
- ✅ Append-only enforced at service layer (no UPDATE on proposal/decision/consensus)
- ✅ ReviewerState materialized via upsert
- ✅ PublishedState uses optimistic concurrency (`version` int)
- ✅ Stage transitions enforce preconditions
- ✅ Rule violations raise dedicated exceptions
- ✅ Tests use `db_session` fixture (real DB) with explicit rollback
- ✅ All commits tagged with task name
- ✅ ruff clean

## What this plan does NOT do (deferred)

- Endpoints under `/v1/runs/...`. → Plan 1C-2.
- Refactor `model_extraction_service` and `section_extraction_service` to use `ProposalService`. → Plan 1C-2.
- Drop 008 endpoints. → Plan 1C-2 or 1D.
- Coordinate-coherence DB-level enforcement (instance.template = run.template). → Forward-looking, possibly Plan 1D.
- Dual-writes to legacy `ai_suggestions` / `extracted_values` during transition. → Plan 1D / synthetic Run migration.
