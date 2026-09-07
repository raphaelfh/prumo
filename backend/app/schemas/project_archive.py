"""Wire shapes for archiving and restoring a project.

One route carries both directions because they are one state transition on one
column: a boolean body cannot get out of step with itself the way a
``/archive`` + ``/restore`` pair can.

Read model is deliberately the stored value, not an echo of the request: the
caller renders the row's new state from what the database actually holds.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class ProjectArchiveUpdate(BaseModel):
    """``true`` archives (``is_active = false``); ``false`` restores."""

    archived: bool


class ProjectArchiveRead(BaseModel):
    """The row as written."""

    id: UUID
    is_active: bool
