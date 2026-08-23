# backend/app/services/template_delete_service.py
"""Delete a project template — guarded under a row lock, then let the DB cascade.

Two refusals keep it boring (spec §3.6 / §5.7): the ACTIVE template cannot be
deleted (switch first — keeps the at-least-one-active extraction rule intact),
and a template any run or instance references cannot be deleted.

The guards run under ``SELECT … FOR UPDATE`` on the template row, and the
DELETE is conditional on ``is_active = false``: ``extraction_runs`` has a
second, composite FK to the template that is ON DELETE CASCADE, so "RESTRICT
refuses first" is only an accident of RI-trigger creation order — the locked
pre-check is what guarantees no run is ever cascaded away, and the
conditional DELETE is what stops a concurrent Switch from leaving the
project with zero active templates. The delete is a Core statement, not
``session.delete``: the ORM would try to NULL the children's
``project_template_id`` (breaking the template XOR CHECK) where the DB
``ON DELETE CASCADE`` just works.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.core.integrity import violates_constraint
from app.models.extraction import (
    ExtractionInstance,
    ExtractionRun,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import HitlConfigScopeKind
from app.repositories.hitl_config_repository import HitlConfigRepository
from app.schemas.hitl_session import (
    TemplateDeleteRefusalCode,
    TemplateDeleteRefusalDetails,
    TemplateDeleteResponse,
)
from app.services.project_template_active_service import owned_template

# The two RESTRICT FKs the pre-check mirrors; mapped if a race still trips them.
_IN_USE_CONSTRAINTS = ("extraction_runs_template_id_fkey", "extraction_instances_template_id_fkey")


class TemplateActiveError(AppError):
    def __init__(self) -> None:
        super().__init__(
            code=TemplateDeleteRefusalCode.TEMPLATE_ACTIVE,
            message="This template is active. Switch to another template before deleting it.",
            status_code=status.HTTP_409_CONFLICT,
        )


class TemplateInUseError(AppError):
    def __init__(self, *, runs: int, instances: int) -> None:
        super().__init__(
            code=TemplateDeleteRefusalCode.TEMPLATE_IN_USE,
            message=(
                "This template cannot be deleted: extractions already reference it "
                f"({runs} assessment(s), {instances} entry/entries)."
            ),
            status_code=status.HTTP_409_CONFLICT,
            details=TemplateDeleteRefusalDetails(runs=runs, instances=instances).model_dump(
                mode="json"
            ),
        )


async def delete_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateDeleteResponse:
    tpl = await owned_template(db, project_id=project_id, template_id=template_id, for_update=True)
    if tpl.is_active:
        raise TemplateActiveError()

    runs, instances = (
        await db.execute(
            select(
                select(func.count())
                .select_from(ExtractionRun)
                .where(ExtractionRun.template_id == template_id)
                .scalar_subquery(),
                select(func.count())
                .select_from(ExtractionInstance)
                .where(ExtractionInstance.template_id == template_id)
                .scalar_subquery(),
            )
        )
    ).one()
    if runs or instances:
        raise TemplateInUseError(runs=runs, instances=instances)

    # ``scope_id`` has no FK — the template-scoped HITL override would be
    # orphaned by the cascade, so it goes in the same transaction.
    await HitlConfigRepository(db).delete_by_scope(HitlConfigScopeKind.TEMPLATE, template_id)
    try:
        deleted_id = (
            await db.execute(
                delete(ProjectExtractionTemplate)
                .where(
                    ProjectExtractionTemplate.id == template_id,
                    ProjectExtractionTemplate.is_active.is_(False),
                )
                .returning(ProjectExtractionTemplate.id)
            )
        ).scalar_one_or_none()
    except IntegrityError as exc:
        if violates_constraint(exc, *_IN_USE_CONSTRAINTS):
            raise TemplateInUseError(runs=runs, instances=instances) from exc
        raise
    if deleted_id is None:
        # A concurrent Switch activated it between our locked read and the
        # DELETE (the row lock makes this a narrow window, not a wide one).
        raise TemplateActiveError()
    db.expunge(tpl)
    return TemplateDeleteResponse(project_template_id=template_id, deleted=True)
