"""
Project Repository.

Project and membership persistence layer.
"""

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


class ProjectMemberRepository(BaseRepository[ProjectMember]):
    """
    Repository for project membership.

    Manages user-project associations.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectMember)

    async def list_for_user(self, user_id: UUID | str) -> list[ProjectMember]:
        """The caller's own membership rows, each with `.project` loaded.

        The ONE membership predicate of a `list_projects` read: `user_id` is
        the verified principal, never a client-supplied id, so there is
        nothing to bind against a second party — unlike `get_member`, which
        checks a specific project a caller names.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        result = await self.db.execute(
            select(ProjectMember)
            .join(ProjectMember.project)
            .options(contains_eager(ProjectMember.project))
            .where(ProjectMember.user_id == user_id)
            .order_by(Project.name, Project.id)
        )
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
