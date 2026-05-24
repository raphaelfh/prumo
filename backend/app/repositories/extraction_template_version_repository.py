"""Extraction Template Version Repository.

Read-side helper for `extraction_template_versions`. Used by the
extraction export service to resolve the **currently active** version
of a project_extraction_template — the layout anchor for the exported
workbook (research.md §4).
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import ExtractionTemplateVersion
from app.repositories.base import BaseRepository


class ExtractionTemplateVersionRepository(BaseRepository[ExtractionTemplateVersion]):
    """Repository for `extraction_template_versions` rows."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionTemplateVersion)

    async def get_active(
        self,
        project_template_id: UUID,
    ) -> ExtractionTemplateVersion | None:
        """Return the active version for a project_extraction_template.

        Hits the partial unique index
        `idx_extraction_template_versions_active` (one active per template).

        Args:
            project_template_id: project_extraction_templates.id.

        Returns:
            The active ExtractionTemplateVersion row, or None when the
            template has no active version (a transient state right after
            template creation, or a heal-pending state).
        """
        stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_id(
        self,
        version_id: UUID,
    ) -> ExtractionTemplateVersion | None:
        """Return a version row by id (used to load Run.version_id snapshots)."""
        stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.id == version_id,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
