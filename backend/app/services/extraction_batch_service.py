"""AI batch runs: the ownership guard, reads, and (Task 7) create/cancel."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction_batch import ExtractionBatch
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.common import ApiErrorCode
from app.schemas.extraction_batch import (
    CreateExtractionBatchRequest,
    ExtractionBatchDetail,
    ExtractionBatchSummary,
    ItemRow,
)
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.article_read_service import ArticleNotFoundError, owned_articles
from app.services.extraction_batch_view import derive_batch
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)

LIST_WINDOW = timedelta(days=7)


class BatchNotFoundError(Exception):
    """Missing, foreign, or no longer visible to its owner — one error for all."""


class BatchScopeError(Exception):
    """The template or an article is missing or outside the project (one error, G2/G3)."""


class BatchAlreadyActiveError(AppError):
    """The caller already runs a batch for this tool (G5b)."""

    def __init__(self, batch_id: UUID) -> None:
        super().__init__(
            code=ApiErrorCode.AI_BATCH_ALREADY_ACTIVE.value,
            message="An AI batch is already running for this tool",
            status_code=409,
            details={"batch_id": str(batch_id)},
        )


async def owned_batch(db: AsyncSession, *, owner_id: UUID, batch_id: UUID) -> ExtractionBatch:
    """THE batch guard: owned by ``owner_id``, who is still a project member.

    Owner and membership live in the WHERE clause, so a foreign batch and a
    missing one raise the same error with the same message.
    """
    batch = await ExtractionBatchRepository(db).get_owned(batch_id, owner_id)
    if batch is None:
        raise BatchNotFoundError("Batch not found")
    return batch


class ExtractionBatchService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.batches = ExtractionBatchRepository(db)

    async def detail(
        self, owner_id: UUID, batch_id: UUID, *, now: datetime
    ) -> ExtractionBatchDetail:
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        rows = (await self.batches.item_rows([batch.id]))[batch.id]
        summary = await self._summary(batch, rows, now)
        items = derive_batch(
            cancelled_at=batch.cancelled_at,
            stop_code=batch.stop_code,
            created_at=batch.created_at,
            rows=rows,
            now=now,
        ).items
        return ExtractionBatchDetail(**summary.model_dump(), items=items)

    async def list_for_owner(
        self, owner_id: UUID, *, project_id: UUID | None, active_only: bool, now: datetime
    ) -> list[ExtractionBatchSummary]:
        batches = await self.batches.list_owned(
            owner_id, since=now - LIST_WINDOW, project_id=project_id
        )
        rows = await self.batches.item_rows([b.id for b in batches])
        summaries = [await self._summary(b, rows[b.id], now) for b in batches]
        return [s for s in summaries if s.state == "active"] if active_only else summaries

    async def _summary(
        self, batch: ExtractionBatch, rows: list[ItemRow], now: datetime
    ) -> ExtractionBatchSummary:
        view = derive_batch(
            cancelled_at=batch.cancelled_at,
            stop_code=batch.stop_code,
            created_at=batch.created_at,
            rows=rows,
            now=now,
        )
        project_name, template_name, kind = await self.batches.labels(batch)
        return ExtractionBatchSummary(
            id=batch.id,
            project_id=batch.project_id,
            project_name=project_name,
            template_id=batch.template_id,
            template_name=template_name,
            kind=kind,
            created_at=batch.created_at,
            finished_at=view.finished_at,
            state=view.state,
            stalled=view.stalled,
            stop_code=batch.stop_code,
            stop_message=batch.stop_message,
            counts=view.counts,
        )

    async def create(self, owner_id: UUID, request: CreateExtractionBatchRequest) -> UUID:
        """G2, G3, G5b, then the rows. The caller checked G1 and G5 and enqueues after."""
        try:
            await owned_template(
                self.db, project_id=request.project_id, template_id=request.template_id
            )
            article_ids = await owned_articles(
                self.db, project_id=request.project_id, article_ids=request.article_ids
            )
        except (ProjectTemplateNotFoundError, ArticleNotFoundError) as exc:
            raise BatchScopeError("template_id or article_ids do not belong to project_id") from exc

        await take_advisory_xact_lock(self.db, owner_id, request.template_id)
        active = await self.batches.active_batch_id(owner_id, request.template_id)
        if active is not None:
            raise BatchAlreadyActiveError(active)

        batch = ExtractionBatch(
            owner_id=owner_id,
            project_id=request.project_id,
            template_id=request.template_id,
            skip_articles_with_ai_suggestions=request.skip_articles_with_ai_suggestions,
        )
        await self.batches.add(batch, article_ids)
        await self.db.commit()
        return batch.id

    async def cancel(self, owner_id: UUID, batch_id: UUID, *, now: datetime) -> None:
        """Queued articles become not-run; in-flight ones finish (spec §7.1)."""
        batch = await owned_batch(self.db, owner_id=owner_id, batch_id=batch_id)
        if batch.cancelled_at is None:
            batch.cancelled_at = now
        await self.batches.cancel_queued(batch.id, "CANCELLED")
        await self.db.commit()
