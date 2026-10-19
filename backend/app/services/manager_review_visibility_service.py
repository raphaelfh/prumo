"""Service for the per-kind manager-review-visibility project setting.

Owns the ``managers_see_reviewers`` sub-dict inside ``projects.settings``,
written through ``ProjectRepository.update_settings_key`` (row-locked, this
key only).
"""

from typing import Any
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
        self._projects = ProjectRepository(db)

    async def set_for_project(self, *, project_id: UUID, kind: str, value: bool) -> dict[str, bool]:
        merged: dict[str, bool] | None = None

        def merge(old: Any) -> dict[str, bool]:
            # Runs on the row-locked value: the other kind keeps what the
            # last committed save left, not what this request first read.
            nonlocal merged
            current = dict(old or {})
            merged = {k: bool(current.get(k, False)) for k in _KEYS}
            merged[kind] = value
            return merged

        if (
            await self._projects.update_settings_key(project_id, "managers_see_reviewers", merge)
            is None
        ):
            raise ProjectNotFoundError(f"Project {project_id} not found")
        assert merged is not None  # the project exists, so ``merge`` ran
        return merged
