"""Repository for ExtractionHitlConfig."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
        # Atomic upsert: a plain SELECT-then-INSERT races two concurrent
        # first-time creates into a unique-violation IntegrityError (HTTP 500).
        # ON CONFLICT collapses both paths into one statement (#83).
        mutable = {
            "reviewer_count": reviewer_count,
            "consensus_rule": consensus_rule,
            "arbitrator_id": arbitrator_id,
        }
        stmt = (
            pg_insert(ExtractionHitlConfig)
            .values(
                scope_kind=_scope_value(scope_kind),
                scope_id=scope_id,
                **mutable,
            )
            .on_conflict_do_update(
                constraint="uq_extraction_hitl_configs_scope",
                set_=mutable,
            )
            .returning(ExtractionHitlConfig.id)
        )
        config_id = (await self.db.execute(stmt)).scalar_one()
        await self.db.flush()
        # populate_existing refreshes any stale identity-map copy, since the
        # Core upsert bypassed the ORM.
        config = await self.db.get(ExtractionHitlConfig, config_id, populate_existing=True)
        assert config is not None  # just upserted
        return config

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
