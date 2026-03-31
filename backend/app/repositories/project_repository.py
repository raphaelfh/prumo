"""
Project Repository.

Project and membership persistence layer.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project, ProjectMember, ProjectMemberRole
from app.repositories.base import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    """
    Repository for project operations.

    Encapsulates project and relationship queries.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, Project)

    async def get_by_org(
        self,
        org_id: UUID | str,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Project]:
        """
        List projects for an organization.

        Args:
            org_id: Organization ID.
            skip: Pagination offset.
            limit: Maximum number of results.

        Returns:
            Project list.
        """
        if isinstance(org_id, str):
            org_id = UUID(org_id)

        result = await self.db.execute(
            select(Project).where(Project.org_id == org_id).offset(skip).limit(limit)
        )
        return list(result.scalars().all())

    async def get_by_user(
        self,
        user_id: UUID | str,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Project]:
        """
        List projects a user can access.

        Args:
            user_id: User ID.
            skip: Pagination offset.
            limit: Maximum number of results.

        Returns:
            Project list.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        # Projects where the user is a member.
        result = await self.db.execute(
            select(Project)
            .join(ProjectMember)
            .where(ProjectMember.user_id == user_id)
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_with_members(self, project_id: UUID | str) -> Project | None:
        """
        Fetch a project with members loaded.

        Args:
            project_id: Project ID.

        Returns:
            Project with members or None.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        result = await self.db.execute(
            select(Project).options(selectinload(Project.members)).where(Project.id == project_id)
        )
        return result.scalar_one_or_none()

    async def get_summary(self, project_id: UUID | str) -> dict:
        """
        Fetch project summary data for AI context.

        Args:
            project_id: Project ID.

        Returns:
            Dict with project context fields.
        """
        project = await self.get_by_id(project_id)

        if not project:
            raise ValueError(f"Project not found: {project_id}")

        return {
            "review_title": project.review_title,
            "description": project.description,
            "condition_studied": project.condition_studied,
            "eligibility_criteria": project.eligibility_criteria,
            "study_design": project.study_design,
        }


class ProjectMemberRepository(BaseRepository[ProjectMember]):
    """
    Repository for project membership.

    Manages user-project associations.
    """

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectMember)

    async def get_by_project(
        self,
        project_id: UUID | str,
    ) -> list[ProjectMember]:
        """
        List members of a project.

        Args:
            project_id: Project ID.

        Returns:
            Member list.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        result = await self.db.execute(
            select(ProjectMember).where(ProjectMember.project_id == project_id)
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
