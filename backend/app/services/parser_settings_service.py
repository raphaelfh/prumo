"""Service for the per-project parser-backend setting.

Owns the ``parsing`` sub-dict inside ``projects.settings``:
``{"type": "auto" | "llamaparse" | "docling"}``. Mirrors
ManagerReviewVisibilityService (plain JSONB, reassign-to-track).

Default is ``"auto"``: the worker uses the cloud LlamaParse parser when a
``llama_cloud`` key is configured, falling back to the self-hosted Docling
parser otherwise. The legacy value ``"standard"`` (the old self-hosted
opt-out) is still accepted on write and normalises to ``"docling"`` on read.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectRepository

# Values the worker resolves against (see parsing_tasks._run_parse).
_RESOLVED_TYPES = ("auto", "llamaparse", "docling")
# Values a manager may persist. "standard" is the legacy self-hosted opt-out
# kept for back-compat; it normalises to "docling" on read.
_SETTABLE_TYPES = ("auto", "standard", "llamaparse", "docling")
_DEFAULT_TYPE = "auto"


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
        raw_parsing = (project.settings or {}).get("parsing")
        parsing = dict(raw_parsing) if isinstance(raw_parsing, dict) else {}
        ptype = parsing.get("type", _DEFAULT_TYPE)
        if ptype == "standard":  # legacy alias for the self-hosted parser
            return "docling"
        return ptype if ptype in _RESOLVED_TYPES else _DEFAULT_TYPE

    async def set_for_project(self, *, project_id: UUID, parser_type: str) -> dict[str, str]:
        if parser_type not in _SETTABLE_TYPES:
            raise ValueError(f"parser_type must be one of {_SETTABLE_TYPES}, got {parser_type!r}")
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
