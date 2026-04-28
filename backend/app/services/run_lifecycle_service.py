"""Run lifecycle service: create + advance stage with precondition checks."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
    ExtractionRunStatus,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.hitl_config_service import HitlConfigService


class InvalidStageTransitionError(Exception):
    """Raised when a stage transition is not permitted from the current stage."""


class TemplateVersionNotFoundError(Exception):
    """Raised when no active TemplateVersion exists for a template."""


class TemplateNotFoundError(Exception):
    """Raised when no ProjectExtractionTemplate exists for the supplied id."""


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
        # Resolve template (for kind) — must exist
        template = await self.db.get(ProjectExtractionTemplate, project_template_id)
        if template is None:
            raise TemplateNotFoundError(f"Template {project_template_id} not found")

        # Resolve active TemplateVersion. Templates created directly through
        # the frontend (Supabase client) skip the backend backfill from
        # alembic 0010, so lazily snapshot v=1 on first Run.
        version_stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        version = (await self.db.execute(version_stmt)).scalar_one_or_none()
        if version is None:
            version = await self._snapshot_initial_version(
                project_template_id=project_template_id,
                user_id=user_id,
            )

        snapshot = await self._hitl.resolve_snapshot(project_id, project_template_id)

        run = ExtractionRun(
            project_id=project_id,
            article_id=article_id,
            template_id=project_template_id,
            kind=template.kind,
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
            target_stage.value if isinstance(target_stage, ExtractionRunStage) else target_stage
        )
        run = await self.db.get(ExtractionRun, run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found")
        allowed = _ALLOWED_TRANSITIONS.get(run.stage, set())
        if target not in allowed:
            raise InvalidStageTransitionError(f"Cannot transition from {run.stage} to {target}")
        run.stage = target
        if target == ExtractionRunStage.CANCELLED.value:
            run.status = ExtractionRunStatus.FAILED.value
        elif target == ExtractionRunStage.FINALIZED.value:
            run.status = ExtractionRunStatus.COMPLETED.value
        await self.db.flush()
        await self.db.refresh(run)
        return run

    async def _snapshot_initial_version(
        self,
        *,
        project_template_id: UUID,
        user_id: UUID,
    ) -> ExtractionTemplateVersion:
        """Mirror alembic 0010's backfill query for a single template.

        Captures the current entity_types + fields tree as the v=1 snapshot.
        Marked active so subsequent runs reuse it via the ``is_active`` index.
        """
        snapshot_row = await self.db.execute(
            text(
                """
                SELECT jsonb_build_object(
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
                            WHERE et.project_template_id = :tid
                        ),
                        '[]'::jsonb
                    )
                )
                """
            ),
            {"tid": str(project_template_id)},
        )
        snapshot = snapshot_row.scalar_one()

        version = ExtractionTemplateVersion(
            project_template_id=project_template_id,
            version=1,
            schema_=snapshot,
            published_at=datetime.now(UTC),
            published_by=user_id,
            is_active=True,
        )
        self.db.add(version)
        await self.db.flush()
        await self.db.refresh(version)
        return version
