"""The one path that deletes a project.

Every foreign key into ``public.projects`` cascades (or, for the feedback
outbox, sets null), so one ``DELETE`` removes the project's graph. The
browser no longer deletes through PostgREST (migration 0077 revokes the
grant). Flushes only: the caller commits.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError
from app.models.project import Project


async def delete_project_row(db: AsyncSession, project_id: UUID) -> None:
    """Delete the project; ``NotFoundError`` when no row matched."""
    deleted = (
        await db.execute(delete(Project).where(Project.id == project_id).returning(Project.id))
    ).scalar_one_or_none()
    if deleted is None:
        raise NotFoundError("Project", str(project_id))
    await db.flush()
