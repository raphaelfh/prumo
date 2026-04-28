"""Repository for ExtractionConsensusDecision."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import ExtractionConsensusDecision


class ExtractionConsensusDecisionRepository:
    """Append-only access for consensus decisions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def add(
        self, record: ExtractionConsensusDecision
    ) -> ExtractionConsensusDecision:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def list_by_run(
        self, run_id: UUID
    ) -> list[ExtractionConsensusDecision]:
        stmt = (
            select(ExtractionConsensusDecision)
            .where(ExtractionConsensusDecision.run_id == run_id)
            .order_by(ExtractionConsensusDecision.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
