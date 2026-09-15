"""Batch persistence shared by the batch service and the dispatcher."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem
from app.models.project import Project
from app.schemas.extraction_batch import ATTEMPT_LIVE, ENGINE_STOP_CODES, ItemRow


def _member(owner_id: UUID) -> ColumnElement[bool]:
    return func.public.is_project_member(ExtractionBatch.project_id, owner_id)


class ExtractionBatchRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_owned(self, batch_id: UUID, owner_id: UUID) -> ExtractionBatch | None:
        return (
            await self.db.execute(
                select(ExtractionBatch).where(
                    ExtractionBatch.id == batch_id,
                    ExtractionBatch.owner_id == owner_id,
                    _member(owner_id),
                )
            )
        ).scalar_one_or_none()

    async def list_owned(
        self, owner_id: UUID, *, since: datetime, project_id: UUID | None
    ) -> list[ExtractionBatch]:
        stmt = select(ExtractionBatch).where(
            ExtractionBatch.owner_id == owner_id,
            ExtractionBatch.created_at >= since,
            _member(owner_id),
        )
        if project_id is not None:
            stmt = stmt.where(ExtractionBatch.project_id == project_id)
        stmt = stmt.order_by(ExtractionBatch.created_at.desc(), ExtractionBatch.id)
        return list((await self.db.execute(stmt)).scalars())

    async def item_rows(self, batch_ids: list[UUID]) -> dict[UUID, list[ItemRow]]:
        rows: dict[UUID, list[ItemRow]] = {batch_id: [] for batch_id in batch_ids}
        if not batch_ids:
            return rows
        stmt = (
            select(ExtractionBatchItem, Article.title, ExtractionAttempt)
            .join(Article, Article.id == ExtractionBatchItem.article_id)
            .outerjoin(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
            .where(ExtractionBatchItem.batch_id.in_(batch_ids))
            .order_by(ExtractionBatchItem.created_at, ExtractionBatchItem.id)
        )
        for item, title, attempt in (await self.db.execute(stmt)).all():
            rows[item.batch_id].append(
                ItemRow(
                    article_id=item.article_id,
                    title=title,
                    status=item.status,
                    reason_code=item.reason_code,
                    updated_at=item.updated_at,
                    attempt_id=item.attempt_id,
                    attempt_status=attempt.status if attempt else None,
                    attempt_result=attempt.result if attempt else None,
                    attempt_error_code=attempt.error_code if attempt else None,
                    attempt_error=attempt.error if attempt else None,
                    attempt_updated_at=attempt.updated_at if attempt else None,
                )
            )
        return rows

    async def labels(self, batch: ExtractionBatch) -> tuple[str, str, str]:
        project_name, template_name, kind = (
            await self.db.execute(
                select(Project.name, ProjectExtractionTemplate.name, ProjectExtractionTemplate.kind)
                .join(ProjectExtractionTemplate, ProjectExtractionTemplate.project_id == Project.id)
                .where(
                    Project.id == batch.project_id,
                    ProjectExtractionTemplate.id == batch.template_id,
                )
            )
        ).one()
        return project_name, template_name, str(kind)

    async def add(self, batch: ExtractionBatch, article_ids: list[UUID]) -> None:
        self.db.add(batch)
        await self.db.flush()
        self.db.add_all(
            ExtractionBatchItem(batch_id=batch.id, article_id=article_id)
            for article_id in article_ids
        )
        await self.db.flush()

    async def active_batch_id(self, owner_id: UUID, template_id: UUID) -> UUID | None:
        queued = (
            select(ExtractionBatchItem.id)
            .where(
                ExtractionBatchItem.batch_id == ExtractionBatch.id,
                ExtractionBatchItem.status == "queued",
            )
            .exists()
        )
        running = (
            select(ExtractionBatchItem.id)
            .join(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
            .where(
                ExtractionBatchItem.batch_id == ExtractionBatch.id,
                ExtractionBatchItem.status == "dispatched",
                ExtractionAttempt.status.in_(ATTEMPT_LIVE),
            )
            .exists()
        )
        halted = ExtractionBatch.cancelled_at.is_not(None) | ExtractionBatch.stop_code.is_not(None)
        return (
            await self.db.execute(
                select(ExtractionBatch.id)
                .where(
                    ExtractionBatch.owner_id == owner_id,
                    ExtractionBatch.template_id == template_id,
                    running | (queued & ~halted),
                )
                .order_by(ExtractionBatch.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def cancel_queued(self, batch_id: UUID, reason_code: str) -> None:
        await self.db.execute(
            update(ExtractionBatchItem)
            .where(ExtractionBatchItem.batch_id == batch_id, ExtractionBatchItem.status == "queued")
            .values(status="cancelled", reason_code=reason_code)
        )

    async def count_in_flight(self, batch_id: UUID, *, since: datetime) -> int:
        return (
            await self.db.execute(
                select(func.count())
                .select_from(ExtractionBatchItem)
                .join(ExtractionAttempt, ExtractionAttempt.id == ExtractionBatchItem.attempt_id)
                .where(
                    ExtractionBatchItem.batch_id == batch_id,
                    ExtractionBatchItem.status == "dispatched",
                    ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                    ExtractionAttempt.updated_at >= since,
                )
            )
        ).scalar_one()

    async def claim_queued(self, batch_id: UUID, limit: int) -> list[ExtractionBatchItem]:
        return list(
            (
                await self.db.execute(
                    select(ExtractionBatchItem)
                    .where(
                        ExtractionBatchItem.batch_id == batch_id,
                        ExtractionBatchItem.status == "queued",
                    )
                    .order_by(ExtractionBatchItem.created_at, ExtractionBatchItem.id)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )

    async def engine_stop_failure(self, batch_id: UUID) -> tuple[str, str | None] | None:
        row = (
            await self.db.execute(
                select(ExtractionAttempt.error_code, ExtractionAttempt.error)
                .join(ExtractionBatchItem, ExtractionBatchItem.attempt_id == ExtractionAttempt.id)
                .where(
                    ExtractionBatchItem.batch_id == batch_id,
                    ExtractionAttempt.status == "failed",
                    ExtractionAttempt.error_code.in_(ENGINE_STOP_CODES),
                )
                .order_by(ExtractionAttempt.updated_at.desc())
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def stale_dispatched_attempts(
        self, batch_id: UUID, *, before: datetime
    ) -> list[ExtractionAttempt]:
        return list(
            (
                await self.db.execute(
                    select(ExtractionAttempt)
                    .join(
                        ExtractionBatchItem, ExtractionBatchItem.attempt_id == ExtractionAttempt.id
                    )
                    .where(
                        ExtractionBatchItem.batch_id == batch_id,
                        ExtractionBatchItem.status == "dispatched",
                        ExtractionAttempt.status.in_(ATTEMPT_LIVE),
                        ExtractionAttempt.updated_at < before,
                    )
                )
            ).scalars()
        )
