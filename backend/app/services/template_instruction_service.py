"""Read/update a project template's general AI instruction.

Since slice B-4 an instruction edit is a DRAFT edit: the column is
written and ``config_draft_since`` stamped (COALESCE keeps the first
edit's timestamp), but nothing republishes — the text reaches snapshots
and prompts only when the manager presses Publish
(``TemplateVersionService.republish``, which also clears the marker).
"""

from uuid import UUID

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionTemplateGlobal, ProjectExtractionTemplate
from app.schemas.hitl_session import (
    TemplateInstructionRead,
    UpdateTemplateInstructionResponse,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError


async def _owned_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    """BOLA guard: 404 (not 403) so foreign ids don't leak existence."""
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    return tpl


async def get_template_instruction(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateInstructionRead:
    tpl = await _owned_template(db, project_id=project_id, template_id=template_id)
    default_instruction: str | None = None
    if tpl.global_template_id is not None:
        origin = await db.get(ExtractionTemplateGlobal, tpl.global_template_id)
        if origin is not None:
            default_instruction = origin.llm_template_instruction
    return TemplateInstructionRead(
        project_template_id=tpl.id,
        llm_template_instruction=tpl.llm_template_instruction,
        default_instruction=default_instruction,
    )


async def set_template_instruction(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    llm_template_instruction: str | None,
) -> UpdateTemplateInstructionResponse:
    """Normalize and stage the instruction as a draft edit (slice B-4).

    No republish: the text reaches prompts/snapshots only at Publish.
    Whitespace-only input normalizes to NULL — the snapshot then omits
    the key and prompts inject nothing. A no-op write (same value) does
    not stamp the draft marker. The compare-then-write is an unlocked
    read: two racing PUTs can make one a silent no-op — millisecond
    window, self-correcting on retry, accepted.
    """
    tpl = await _owned_template(db, project_id=project_id, template_id=template_id)
    normalized = (llm_template_instruction or "").strip() or None
    if normalized != tpl.llm_template_instruction:
        await db.execute(
            update(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == template_id)
            .values(
                llm_template_instruction=normalized,
                config_draft_since=func.coalesce(
                    ProjectExtractionTemplate.config_draft_since, func.now()
                ),
            )
        )
    return UpdateTemplateInstructionResponse(
        project_template_id=template_id,
        llm_template_instruction=normalized,
    )
