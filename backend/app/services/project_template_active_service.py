"""Service: toggle the `is_active` flag on a project template, with the
single-active-extraction-template invariant baked in.

Owns the multi-row read + update transaction that the
`PATCH /projects/{id}/templates/{tid}` endpoint used to do inline,
so the endpoint module stops importing from `app.models.*`.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ProjectExtractionTemplate, TemplateKind
from app.schemas.hitl_session import UpdateTemplateActiveResponse


class ProjectTemplateNotFoundError(Exception):
    """Raised when the template_id does not resolve to a row in the project."""


class LastActiveExtractionTemplateError(Exception):
    """Raised when disabling an extraction template would leave the project with
    zero active extraction templates. The extraction workflow assumes at least
    one active template at all times; QA has no such constraint."""


async def set_template_active(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    is_active: bool,
) -> UpdateTemplateActiveResponse:
    """Flip the `is_active` flag on a project template.

    Enforces: an extraction template cannot be deactivated if it is the
    project's only active extraction template (the extraction workflow
    requires exactly one). QA templates are independent — disabling the
    last QA template just means the project chose not to run any QA tool.
    """
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Project template {template_id} not found")

    if tpl.kind == TemplateKind.EXTRACTION.value and is_active is False:
        siblings_stmt = select(ProjectExtractionTemplate).where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.kind == TemplateKind.EXTRACTION.value,
            ProjectExtractionTemplate.is_active.is_(True),
            ProjectExtractionTemplate.id != template_id,
        )
        other_active = (await db.execute(siblings_stmt)).scalars().first()
        if other_active is None:
            raise LastActiveExtractionTemplateError(
                "Cannot disable the only active extraction template for "
                "this project; import another extraction template first."
            )

    tpl.is_active = is_active
    await db.flush()
    await db.commit()
    return UpdateTemplateActiveResponse(
        project_template_id=tpl.id,
        is_active=tpl.is_active,
    )
