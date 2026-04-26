"""Shared repository helpers for unified evaluation domain."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.base import BaseRepository


class EvaluationRepositoryBase(BaseRepository):
    """Base repository with project-scope and optimistic lock helpers."""

    def __init__(self, db: AsyncSession, model: type):
        super().__init__(db=db, model=model)

    async def assert_project_scope(self, project_id: UUID, user_id: UUID) -> bool:
        """Return whether a user belongs to a project."""
        query = text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM public.project_members pm
                WHERE pm.project_id = :project_id
                  AND pm.user_id = :user_id
            ) AS is_member
            """
        )
        result = await self.db.execute(query, {"project_id": str(project_id), "user_id": str(user_id)})
        return bool(result.scalar_one())

    async def assert_optimistic_lock(
        self,
        table_name: str,
        row_id: UUID,
        expected_updated_at: str,
    ) -> bool:
        """Check optimistic lock by comparing the current `updated_at` timestamp."""
        allowed_tables = {
            "published_states",
            "reviewer_states",
            "evaluation_runs",
            "evaluation_schema_versions",
        }
        if table_name not in allowed_tables:
            raise ValueError(f"Unsupported optimistic lock table: {table_name}")

        query = text(
            f"""
            SELECT EXISTS (
                SELECT 1
                FROM public.{table_name}
                WHERE id = :row_id
                  AND updated_at::text = :expected_updated_at
            ) AS lock_ok
            """
        )
        result = await self.db.execute(
            query,
            {"row_id": str(row_id), "expected_updated_at": expected_updated_at},
        )
        return bool(result.scalar_one())
