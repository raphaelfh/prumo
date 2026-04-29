"""Repository for ExtractionHitlConfig."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)


def _scope_value(scope_kind: HitlConfigScopeKind | str) -> str:
    return scope_kind.value if isinstance(scope_kind, HitlConfigScopeKind) else scope_kind


class HitlConfigRepository:
    """CRUD access for ExtractionHitlConfig records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_scope(
        self,
        scope_kind: HitlConfigScopeKind | str,
        scope_id: UUID,
    ) -> ExtractionHitlConfig | None:
        stmt = select(ExtractionHitlConfig).where(
            ExtractionHitlConfig.scope_kind == _scope_value(scope_kind),
            ExtractionHitlConfig.scope_id == scope_id,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert(
        self,
        scope_kind: HitlConfigScopeKind | str,
        scope_id: UUID,
        reviewer_count: int,
        consensus_rule: str,
        arbitrator_id: UUID | None,
    ) -> ExtractionHitlConfig:
        existing = await self.get_by_scope(scope_kind, scope_id)
        if existing is None:
            config = ExtractionHitlConfig(
                scope_kind=_scope_value(scope_kind),
                scope_id=scope_id,
                reviewer_count=reviewer_count,
                consensus_rule=consensus_rule,
                arbitrator_id=arbitrator_id,
            )
            self.db.add(config)
            await self.db.flush()
            return config

        existing.reviewer_count = reviewer_count
        existing.consensus_rule = consensus_rule
        existing.arbitrator_id = arbitrator_id
        await self.db.flush()
        return existing

    async def delete_by_scope(
        self,
        scope_kind: HitlConfigScopeKind | str,
        scope_id: UUID,
    ) -> bool:
        stmt = delete(ExtractionHitlConfig).where(
            ExtractionHitlConfig.scope_kind == _scope_value(scope_kind),
            ExtractionHitlConfig.scope_id == scope_id,
        )
        result = await self.db.execute(stmt)
        await self.db.flush()
        return (result.rowcount or 0) > 0
