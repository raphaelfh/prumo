"""Service for creating and publishing evaluation schema versions."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation_schema import EvaluationSchemaVersion
from app.repositories.evaluation_schema_version_repository import EvaluationSchemaVersionRepository
from app.services.evaluation_observability_service import log_evaluation_event


class EvaluationSchemaVersionService:
    """Business logic for schema version lifecycle operations."""

    def __init__(self, db: AsyncSession, user_id: UUID, trace_id: str):
        self.db = db
        self.user_id = user_id
        self.trace_id = trace_id
        self._repo = EvaluationSchemaVersionRepository(db)

    async def create_draft(self, schema_id: UUID) -> EvaluationSchemaVersion:
        version = await self._repo.create_draft(schema_id=schema_id)
        await self.db.commit()
        log_evaluation_event(
            "evaluation_schema_version_created",
            trace_id=self.trace_id,
            project_id=None,
            extra={"schema_id": str(schema_id), "version_id": str(version.id)},
        )
        return version

    async def publish(self, version_id: UUID) -> EvaluationSchemaVersion:
        version = await self._repo.get_by_id(version_id)
        if version is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Evaluation schema version not found",
            )
        version = await self._repo.publish(version=version, user_id=self.user_id)
        await self.db.commit()
        log_evaluation_event(
            "evaluation_schema_version_published",
            trace_id=self.trace_id,
            project_id=None,
            extra={"version_id": str(version.id)},
        )
        return version
