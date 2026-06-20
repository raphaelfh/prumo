"""Service for the per-project parser-backend setting.

Owns the ``parsing`` sub-dict inside ``projects.settings``:
``{"type": "standard" | "llamaparse"}``. Mirrors
ManagerReviewVisibilityService (plain JSONB, reassign-to-track).
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectRepository

_VALID_TYPES = ("standard", "llamaparse")
_DEFAULT_TYPE = "standard"


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


class ParserSettingsService:
    """Owns the ``parsing`` map inside projects.settings."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._projects = ProjectRepository(db)

    async def get_for_project(self, project_id: UUID) -> str:
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        parsing = dict((project.settings or {}).get("parsing") or {})
        ptype = parsing.get("type", _DEFAULT_TYPE)
        return ptype if ptype in _VALID_TYPES else _DEFAULT_TYPE

    async def set_for_project(self, *, project_id: UUID, parser_type: str) -> dict[str, str]:
        if parser_type not in _VALID_TYPES:
            raise ValueError(f"parser_type must be one of {_VALID_TYPES}, got {parser_type!r}")
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        # projects.settings is plain JSONB (NOT MutableDict): build a new dict
        # and REASSIGN, or the change is not tracked and never persists.
        settings = dict(project.settings or {})
        settings["parsing"] = {"type": parser_type}
        project.settings = settings  # reassignment -> dirty-tracked
        await self.db.flush()
        return {"type": parser_type}
