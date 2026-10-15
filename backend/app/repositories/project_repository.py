"""
Project Repository.

Project and membership persistence layer.
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager

from app.models.project import Project, ProjectMember, ProjectMemberRole
from app.repositories.base import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    """
    Repository for project operations.

    Encapsulates project and relationship queries.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, Project)

    async def lock_for_update(self, project_id: UUID) -> Project | None:
        """Row-locked read; populate_existing so a stale identity-map copy is never served.

        The refresh also discards unflushed edits on that ``Project`` (app
        sessions run ``autoflush=False``): flush them before calling this.
        """
        return (
            await self.db.execute(
                select(Project)
                .where(Project.id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()

    async def update_settings_key(
        self, project_id: UUID, key: str, update: Callable[[Any], Any]
    ) -> Project | None:
        """THE projects.settings writer: lock, update(old) -> new, reassign, flush.

        Plain JSONB (not MutableDict): a new dict is reassigned so the change is
        tracked; only ``key`` changes, sibling keys survive. Re-locking a row this
        transaction already holds is a no-op.
        """
        project = await self.lock_for_update(project_id)
        if project is None:
            return None
        settings = dict(project.settings or {})
        settings[key] = update(settings.get(key))
        project.settings = settings
        await self.db.flush()
        return project


class ProjectMemberRepository(BaseRepository[ProjectMember]):
    """
    Repository for project membership.

    Manages user-project associations.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectMember)

    async def list_for_user(
        self, user_id: UUID | str, *, project_ids: frozenset[UUID] | None = None
    ) -> list[ProjectMember]:
        """The caller's own membership rows, each with `.project` loaded.

        The ONE membership predicate of a `list_projects` read: `user_id` is
        the verified principal, never a client-supplied id, so there is
        nothing to bind against a second party — unlike `get_member`, which
        checks a specific project a caller names. `project_ids` (a token's
        restriction, server-stored) narrows the rows in the same WHERE clause.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        stmt = (
            select(ProjectMember)
            .join(ProjectMember.project)
            .options(contains_eager(ProjectMember.project))
            .where(ProjectMember.user_id == user_id)
        )
        if project_ids is not None:
            stmt = stmt.where(ProjectMember.project_id.in_(project_ids))
        result = await self.db.execute(stmt.order_by(Project.name, Project.id))
        return list(result.scalars().all())

    async def get_member(
        self,
        project_id: UUID | str,
        user_id: UUID | str,
    ) -> ProjectMember | None:
        """
        Fetch a specific project member.

        Args:
            project_id: Project ID.
            user_id: User ID.

        Returns:
            Member record or None.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        result = await self.db.execute(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .where(ProjectMember.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def is_member(
        self,
        project_id: UUID | str,
        user_id: UUID | str,
    ) -> bool:
        """
        Check whether user is a project member.

        Args:
            project_id: Project ID.
            user_id: User ID.

        Returns:
            True if member.
        """
        member = await self.get_member(project_id, user_id)
        return member is not None

    async def has_role(
        self,
        project_id: UUID | str,
        user_id: UUID | str,
        role: ProjectMemberRole,
    ) -> bool:
        """
        Check whether user has a specific role.

        Args:
            project_id: Project ID.
            user_id: User ID.
            role: Role to check.

        Returns:
            True if role matches.
        """
        member = await self.get_member(project_id, user_id)
        return member is not None and member.role == role
