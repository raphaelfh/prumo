"""Repository for ExtractionHitlConfig."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)


class HitlConfigRepository:
    """Read access for ExtractionHitlConfig records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_scope(
        self,
        scope_kind: HitlConfigScopeKind | str,
        scope_id: UUID,
    ) -> ExtractionHitlConfig | None:
        kind_value = scope_kind.value if isinstance(scope_kind, HitlConfigScopeKind) else scope_kind
        stmt = select(ExtractionHitlConfig).where(
            ExtractionHitlConfig.scope_kind == kind_value,
            ExtractionHitlConfig.scope_id == scope_id,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
