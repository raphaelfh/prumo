"""Service: read the template catalogue — the global templates offered for
import, and a project's own templates.

Membership is the endpoint's job (``require_project_scope``); these reads take
the already-authorised scope and keep it in the WHERE clause.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from app.schemas.template_catalogue import (
    GlobalTemplateSummaryRead,
    ProjectTemplateRead,
    TemplateKindLiteral,
)


async def list_global_templates(
    db: AsyncSession, *, kind: TemplateKindLiteral
) -> list[GlobalTemplateSummaryRead]:
    """The global templates of one kind still offered for import, by name.

    ``kind`` is required: the table is ONE catalogue for both lineages, so an
    unfiltered listing puts quality-assessment tools in the extraction picker.
    ``is_global = false`` retires a template from the catalogue.
    """
    stmt = (
        select(
            ExtractionTemplateGlobal.id,
            ExtractionTemplateGlobal.name,
            ExtractionTemplateGlobal.description,
            ExtractionTemplateGlobal.framework,
            ExtractionTemplateGlobal.version,
            ExtractionTemplateGlobal.kind,
            func.count(ExtractionEntityType.id).label("entity_types_count"),
        )
        .outerjoin(
            ExtractionEntityType,
            ExtractionEntityType.template_id == ExtractionTemplateGlobal.id,
        )
        .where(
            ExtractionTemplateGlobal.kind == kind,
            ExtractionTemplateGlobal.is_global.is_(True),
        )
        .group_by(ExtractionTemplateGlobal.id)
        .order_by(ExtractionTemplateGlobal.name)
    )
    rows = (await db.execute(stmt)).all()
    return [GlobalTemplateSummaryRead.model_validate(row, from_attributes=True) for row in rows]


async def list_project_templates(
    db: AsyncSession, *, project_id: UUID, kind: TemplateKindLiteral
) -> list[ProjectTemplateRead]:
    """A project's templates of one kind, active and inactive, newest first."""
    stmt = (
        select(ProjectExtractionTemplate)
        .where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.kind == kind,
        )
        .order_by(ProjectExtractionTemplate.created_at.desc())
    )
    templates = (await db.execute(stmt)).scalars().all()
    return [ProjectTemplateRead.model_validate(tpl, from_attributes=True) for tpl in templates]
