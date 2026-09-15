"""AI batch runs: the ownership guard, reads, and (Task 7) create/cancel."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_batch import ExtractionBatch
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.extraction_batch import ExtractionBatchDetail, ExtractionBatchSummary, ItemRow
from app.services.extraction_batch_view import derive_batch

LIST_WINDOW = timedelta(days=7)


class BatchNotFoundError(Exception):
    """Missing, foreign, or no longer visible to its owner — one error for all."""


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
