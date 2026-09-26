"""The one writer of a project's descriptive columns.

REST (``PATCH /projects/{id}/details``) and the researcher MCP tool call
:func:`update_details`; the browser no longer writes ``public.projects``
through PostgREST (migration 0077 revokes the grant). The row is locked, every
changed key is compared against the caller's ``expected`` value by canonical
JSON equality, and nothing is written when any of them moved. Flushes only:
the caller commits.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError, NotFoundError
from app.models.project import Project
from app.schemas.project_details import (
    ProjectDetailsFields,
    ProjectDetailsRead,
    ProjectDetailsRefusalCode,
)


class StaleProjectValueError(AppError):
    """A column changed since the caller read it (possibly by the other writer)."""

    def __init__(self, *, current: dict[str, Any]) -> None:
        super().__init__(
            code=ProjectDetailsRefusalCode.STALE_VALUE,
            message="These fields changed since you read them.",
            status_code=status.HTTP_409_CONFLICT,
            details={"current": current},
        )


@dataclass(frozen=True, slots=True)
class ProjectDetailsChange:
    before: dict[str, Any]
    after: dict[str, Any]
    details: ProjectDetailsRead


def _values(project: Project, keys: Iterable[str]) -> dict[str, Any]:
    # JSONB loads as plain dict/list and review_type as its str value: already JSON values.
    return {key: getattr(project, key) for key in keys}


async def update_details(
    db: AsyncSession,
    *,
    project_id: UUID,
    fields: ProjectDetailsFields,
    expected: ProjectDetailsFields,
) -> ProjectDetailsChange:
    """Write ``fields`` if every one of their ``expected`` values is still current."""
    project = (
        await db.execute(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", str(project_id))
    changes = fields.model_dump(mode="json", exclude_unset=True)
    prior = expected.model_dump(mode="json", exclude_unset=True)
    before = _values(project, changes)
    contested = {
        key: value for key, value in before.items() if key not in prior or prior[key] != value
    }
    if contested:
        raise StaleProjectValueError(current=contested)
    for key, value in changes.items():
        # A new object per JSONB column: plain JSONB tracks reassignment only.
        setattr(project, key, value)
    await db.flush()
    await db.refresh(project)
    details = ProjectDetailsRead.model_validate(
        {**_values(project, ProjectDetailsFields.model_fields), "updated_at": project.updated_at}
    )
    return ProjectDetailsChange(before=before, after=_values(project, changes), details=details)
