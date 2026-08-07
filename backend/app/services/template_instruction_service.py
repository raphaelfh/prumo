"""Read/update a project template's general AI instruction (spec Phase A).

The column write happens INSIDE ``TemplateVersionService.republish``'s
locked section (advisory locks → row FOR UPDATE → write → snapshot), so
the live column and the active snapshot can never desync the way the
PostgREST-write + fire-and-forget-republish path could — and the write
cannot invert the republish lock order (ABBA deadlock).
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionTemplateGlobal, ProjectExtractionTemplate
from app.schemas.hitl_session import (
    TemplateInstructionRead,
    UpdateTemplateInstructionResponse,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_service import TemplateVersionService


async def _owned_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    """BOLA guard: 404 (not 403) so foreign ids don't leak existence.

    Read-only — callers must not mutate the returned row directly (an
    autoflushed UPDATE before republish's locks would re-introduce the
    lock-order inversion).
    """
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
    user_id: UUID,
) -> UpdateTemplateInstructionResponse:
    """Normalize and write the column inside republish (caller commits).

    Whitespace-only input normalizes to NULL — the snapshot then omits
    the key and prompts inject nothing.
    """
    await _owned_template(db, project_id=project_id, template_id=template_id)
    normalized = (llm_template_instruction or "").strip() or None
    republished = await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=user_id,
        llm_template_instruction=normalized,
    )
    return UpdateTemplateInstructionResponse(
        project_template_id=template_id,
        llm_template_instruction=normalized,
        version_id=republished.version_id,
        version=republished.version,
        changed=republished.changed,
        repinned_run_count=republished.repinned_run_count,
    )
