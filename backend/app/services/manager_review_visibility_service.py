"""Service for the per-kind manager-review-visibility project setting.

Owns the ``managers_see_reviewers`` sub-dict inside ``projects.settings``.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import TemplateKind
from app.repositories.project_repository import ProjectRepository

# The per-kind keys are exactly the HITL template kinds — derive them from the
# canonical enum so a new kind can never be silently dropped from the merge map.
_KEYS = tuple(k.value for k in TemplateKind)


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


class ManagerReviewVisibilityService:
    """Owns the per-kind ``managers_see_reviewers`` map inside projects.settings."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._projects = ProjectRepository(db)

    async def set_for_project(self, *, project_id: UUID, kind: str, value: bool) -> dict[str, bool]:
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")

        # projects.settings is plain JSONB (NOT MutableDict): build a brand-new
        # dict and REASSIGN, or the change is not tracked and never persists.
        settings = dict(project.settings or {})
        current = dict(settings.get("managers_see_reviewers") or {})
        merged = {k: bool(current.get(k, False)) for k in _KEYS}
        merged[kind] = value
        settings["managers_see_reviewers"] = merged
        settings.pop("blind_mode", None)  # retire the dead flag opportunistically
        project.settings = settings  # reassignment → dirty-tracked
        await self.db.flush()
        return merged
