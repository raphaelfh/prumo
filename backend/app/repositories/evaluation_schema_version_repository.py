"""Repository for evaluation schema version lifecycle."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_schema import EvaluationSchemaVersion, EvaluationSchemaVersionStatus
from app.repositories.evaluation_repository_base import EvaluationRepositoryBase


class EvaluationSchemaVersionRepository(EvaluationRepositoryBase):
    """Persistence operations for schema versions."""

    def __init__(self, db: AsyncSession):
        super().__init__(db=db, model=EvaluationSchemaVersion)

    async def next_version_number(self, schema_id: UUID) -> int:
        result = await self.db.execute(
            select(func.coalesce(func.max(EvaluationSchemaVersion.version_number), 0)).where(
                EvaluationSchemaVersion.schema_id == schema_id
            )
        )
        return int(result.scalar_one()) + 1

    async def create_draft(self, *, schema_id: UUID) -> EvaluationSchemaVersion:
        version = EvaluationSchemaVersion(
            schema_id=schema_id,
            version_number=await self.next_version_number(schema_id),
            status=EvaluationSchemaVersionStatus.DRAFT.value,
        )
        self.db.add(version)
        await self.db.flush()
        await self.db.refresh(version)
        return version

    async def get_by_id(self, version_id: UUID) -> EvaluationSchemaVersion | None:  # type: ignore[override]
        result = await self.db.execute(
            select(EvaluationSchemaVersion).where(EvaluationSchemaVersion.id == version_id)
        )
        return result.scalar_one_or_none()

    async def publish(self, version: EvaluationSchemaVersion, user_id: UUID) -> EvaluationSchemaVersion:
        version.status = EvaluationSchemaVersionStatus.PUBLISHED.value
        version.published_by = user_id
        version.published_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.refresh(version)
        return version
