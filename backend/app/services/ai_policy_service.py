"""The per-project AI agents policy: ``projects.settings['ai_policy']``.

Read by members, written by managers through REST only, via the single
settings writer ``ProjectRepository.update_settings_key`` (row-locked, this
key only, sibling keys kept). An absent, non-dict or invalid stored value
reads as ``AiPolicyStored()``: agent runs off.
"""

from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectRepository
from app.schemas.ai_policy import AiPolicyStored, AiPolicyUpdateRequest

_KEY = "ai_policy"


class ProjectNotFoundError(Exception):
    """Raised when the project row is missing. HTTP translation in the router."""


async def read(db: AsyncSession, project_id: UUID) -> AiPolicyStored:
    project = await ProjectRepository(db).get_by_id(project_id)
    if project is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")
    raw = (project.settings or {}).get(_KEY)
    if not isinstance(raw, dict):
        return AiPolicyStored()
    try:
        return AiPolicyStored.model_validate(raw)
    except ValidationError:
        return AiPolicyStored()


async def set_for_project(
    db: AsyncSession, *, project_id: UUID, update: AiPolicyUpdateRequest, user_id: UUID
) -> AiPolicyStored:
    stored = AiPolicyStored.model_validate(
        {**update.model_dump(), "updated_by": user_id, "updated_at": datetime.now(UTC)}
    )
    project = await ProjectRepository(db).update_settings_key(
        project_id, _KEY, lambda _old: stored.model_dump(mode="json")
    )
    if project is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")
    return stored
