"""Archive / restore a project — the one write behind ``PATCH …/archive``.

``is_active`` is presentation state, not access control: no RLS policy on
``projects`` references it, and no service filters on it, so an archived
project stays fully reachable and mutable. The column exists so the hub can
hide finished reviews; do not build authorization on it.

Ownership is NOT checked here. The endpoint's ``require_project_manager``
dependency evaluates ``public.is_project_manager`` — the same SQL function the
``project_update`` RLS policy calls — before this coroutine runs, which is why
this module never touches ``project_members``. The ``WHERE id`` below is the
row scope; a caller who reached it has already been bound to the project.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project


class ProjectNotFoundError(Exception):
    """No ``projects`` row with that id."""


async def set_project_archived(
    db: AsyncSession, project_id: UUID, *, archived: bool
) -> dict[str, Any]:
    """Write ``is_active`` and return the row as stored.

    ``RETURNING`` rather than a read-back: one statement, and a zero-row result
    is the ONLY signal that the id matched nothing — the same reason the
    PostgREST writes in this repo carry ``.select()``.

    NOTE: ``trg_projects_updated_at`` fires on this UPDATE, so archiving or
    restoring also bumps ``updated_at`` and therefore reorders the hub's
    default "Updated" sort. That is accepted, not accidental (see the plan's
    "Accepted" section).
    """
    row = (
        await db.execute(
            update(Project)
            .where(Project.id == project_id)
            .values(is_active=not archived)
            .returning(Project.id, Project.is_active)
        )
    ).one_or_none()

    if row is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")

    await db.flush()
    return {"id": row.id, "is_active": row.is_active}
