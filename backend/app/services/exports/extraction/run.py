"""Export request value and its authorization gate, shared by the sync and async paths."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError, ValidationError
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.exports.extraction.workbook import ExportShape
from app.services.extraction_export_service import ExportMode, ExtractionExportService
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)

XLSX_MIME: Final[str] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@dataclass(frozen=True, slots=True)
class ExportRequest:
    project_id: UUID
    template_id: UUID
    mode: ExportMode
    article_ids: tuple[UUID, ...]
    reviewer_id: UUID | None
    include_ai_metadata: bool
    anonymize_reviewer_names: bool
    shape: ExportShape


async def authorize_export(db: AsyncSession, req: ExportRequest, *, user_id: str) -> None:
    """Validate, then check membership, then ownership (no existence oracle).

    Membership runs before any ownership lookup so a non-member sending a
    foreign id gets 403, never a 404 that reveals the id exists elsewhere.
    """
    if req.mode is ExportMode.SINGLE_USER and req.reviewer_id is None:
        raise ValidationError("reviewer_id is required when mode=single_user.")
    await ExtractionExportService(db=db, user_id=user_id).assert_can_export(
        req.project_id, req.mode, req.reviewer_id
    )
    if req.article_ids:
        try:
            await owned_articles(db, project_id=req.project_id, article_ids=req.article_ids)
        except ArticleNotFoundError as exc:
            raise NotFoundError("Article") from exc
    try:
        await owned_template(db, project_id=req.project_id, template_id=req.template_id)
    except ProjectTemplateNotFoundError as exc:
        raise NotFoundError("Project template") from exc
