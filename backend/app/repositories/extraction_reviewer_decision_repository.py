"""Repository for ExtractionReviewerDecision."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionReviewerDecision


class ExtractionReviewerDecisionRepository:
    """Append-only access for reviewer decisions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def add(self, record: ExtractionReviewerDecision) -> ExtractionReviewerDecision:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def list_by_run(self, run_id: UUID) -> list[ExtractionReviewerDecision]:
        stmt = (
            select(ExtractionReviewerDecision)
            .where(ExtractionReviewerDecision.run_id == run_id)
            .order_by(ExtractionReviewerDecision.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_by_reviewer_item(
        self,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> list[ExtractionReviewerDecision]:
        stmt = (
            select(ExtractionReviewerDecision)
            .where(
                ExtractionReviewerDecision.run_id == run_id,
                ExtractionReviewerDecision.reviewer_id == reviewer_id,
                ExtractionReviewerDecision.instance_id == instance_id,
                ExtractionReviewerDecision.field_id == field_id,
            )
            .order_by(ExtractionReviewerDecision.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_latest_for_coord(
        self,
        run_id: UUID,
        reviewer_id: UUID,
        instance_id: UUID,
        field_id: UUID,
    ) -> ExtractionReviewerDecision | None:
        """Newest decision a reviewer made for a coord, for the idempotency
        check. ``id`` is the tiebreaker on equal ``created_at``."""
        stmt = (
            select(ExtractionReviewerDecision)
            .where(
                ExtractionReviewerDecision.run_id == run_id,
                ExtractionReviewerDecision.reviewer_id == reviewer_id,
                ExtractionReviewerDecision.instance_id == instance_id,
                ExtractionReviewerDecision.field_id == field_id,
            )
            .order_by(
                ExtractionReviewerDecision.created_at.desc(),
                ExtractionReviewerDecision.id.desc(),
            )
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
