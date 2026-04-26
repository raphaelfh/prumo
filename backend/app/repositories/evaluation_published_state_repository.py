"""Repository for authoritative published states with optimistic lock checks."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_decision import PublishedState
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationPublishedStateRepository(EvaluationRepositoryBase):
    """Read and upsert published states."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=PublishedState)

    async def get_by_key(
        self,
        *,
        project_id: UUID,
        target_id: UUID,
        item_id: UUID,
        schema_version_id: UUID,
    ) -> PublishedState | None:
        result = await self.db.execute(
            select(PublishedState).where(
                PublishedState.project_id == project_id,
                PublishedState.target_id == target_id,
                PublishedState.item_id == item_id,
                PublishedState.schema_version_id == schema_version_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(
        self,
        *,
        project_id: UUID,
        target_id: UUID,
        item_id: UUID,
        schema_version_id: UUID,
        latest_consensus_decision_id: UUID,
        published_value_json: dict,
    ) -> PublishedState:
        state = await self.get_by_key(
            project_id=project_id,
            target_id=target_id,
            item_id=item_id,
            schema_version_id=schema_version_id,
        )
        if state is None:
            state = PublishedState(
                project_id=project_id,
                target_id=target_id,
                item_id=item_id,
                schema_version_id=schema_version_id,
                latest_consensus_decision_id=latest_consensus_decision_id,
                published_value_json=published_value_json,
            )
            self.db.add(state)
        else:
            state.latest_consensus_decision_id = latest_consensus_decision_id
            state.published_value_json = published_value_json
        await self.db.flush()
        await self.db.refresh(state)
        return state
