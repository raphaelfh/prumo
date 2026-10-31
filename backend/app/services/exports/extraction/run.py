"""Export request, its authorization gate and the one build entry point, shared by the sync and async paths."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError, NotFoundError, ValidationError
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.exports.extraction.workbook import (
    _SHAPE_BUILDERS,
    ExportShape,
    build_workbook,
    matrix_fits,
    shape_needs_articles,
)
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


@dataclass(frozen=True, slots=True)
class ExportFile:
    content: bytes
    filename: str
    media_type: str = XLSX_MIME


class EmptyExportError(AppError):
    """No eligible articles for an article-reading shape.

    Takes one positional ``message`` so Celery's JSON backend can rebuild it
    with ``cls(*args)``; the stable code prefix rides in the message.
    """

    def __init__(
        self,
        message: str = (
            "EMPTY_ELIGIBLE_ARTICLES: No eligible articles for the selected mode + scope. "
            "Finalize at least one Run, then retry."
        ),
    ) -> None:
        super().__init__(code="EMPTY_ELIGIBLE_ARTICLES", message=message, status_code=422)


async def build_export(
    db: AsyncSession, req: ExportRequest, *, user_id: str, trace_id: str | None = None
) -> ExportFile:
    """Resolve the layout and render the workbook for an authorized request."""
    layout = await ExtractionExportService(
        db=db, user_id=user_id, trace_id=trace_id
    ).resolve_layout(
        project_id=req.project_id,
        template_id=req.template_id,
        mode=req.mode,
        article_ids=list(req.article_ids),
        include_ai_metadata=req.include_ai_metadata,
        anonymize_reviewer_names=req.anonymize_reviewer_names,
        reviewer_id=req.reviewer_id,
    )
    if not layout.articles and shape_needs_articles(req.shape):
        raise EmptyExportError()
    include_matrix = "matrix" in _SHAPE_BUILDERS[req.shape] and matrix_fits(layout)
    content = await asyncio.to_thread(
        build_workbook, layout, req.shape, include_matrix=include_matrix
    )
    filename = ExtractionExportService.format_filename(
        project_name=layout.project_name,
        template_name=layout.template_name,
        mode=req.mode,
        generated_at=layout.notes.generated_at,
    )
    return ExportFile(content=content, filename=filename)
