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
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction import (
    ExtractionInstance,
    ExtractionRun,
    ProjectExtractionTemplate,
)
from app.models.extraction_versioning import ExtractionHitlConfig, HitlConfigScopeKind
from app.schemas.hitl_session import TemplateDeleteRefusalCode, TemplateDeleteResponse
from app.services.project_template_active_service import ProjectTemplateNotFoundError

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
            details={"runs": runs, "instances": instances},
        )


async def delete_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateDeleteResponse:
    tpl = (
        await db.execute(
            select(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == template_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Project template {template_id} not found")
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
    await db.execute(
        delete(ExtractionHitlConfig).where(
            ExtractionHitlConfig.scope_kind == HitlConfigScopeKind.TEMPLATE.value,
            ExtractionHitlConfig.scope_id == template_id,
        )
    )
    try:
        result = await db.execute(
            delete(ProjectExtractionTemplate).where(
                ProjectExtractionTemplate.id == template_id,
                ProjectExtractionTemplate.is_active.is_(False),
            )
        )
    except IntegrityError as exc:
        if any(name in str(getattr(exc, "orig", exc)) for name in _IN_USE_CONSTRAINTS):
            raise TemplateInUseError(runs=runs, instances=instances) from exc
        raise
    # ``execute(delete(...))`` is typed as the generic Result; at runtime it is
    # the CursorResult that carries the affected-row count.
    assert isinstance(result, CursorResult)
    if result.rowcount != 1:
        # A concurrent Switch activated it between our read and the DELETE.
        raise TemplateActiveError()
    db.expunge(tpl)
    return TemplateDeleteResponse(project_template_id=template_id, deleted=True)
