"""Repository helpers for append-only proposal records."""

from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_run import ProposalRecord
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationProposalRepository(EvaluationRepositoryBase):
    """Persistence operations for proposal records."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=ProposalRecord)

    async def append_proposal(self, record: ProposalRecord) -> ProposalRecord:
        self.db.add(record)
        await self.db.flush()
        await self.db.refresh(record)
        return record

    async def list_latest_by_run(self, run_id: UUID, limit: int = 200) -> list[ProposalRecord]:
        result = await self.db.execute(
            select(ProposalRecord)
            .where(ProposalRecord.run_id == run_id)
            .order_by(desc(ProposalRecord.created_at))
            .limit(limit)
        )
        return list(result.scalars().all())
