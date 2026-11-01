"""Screening settings and the caller's roles: shared by the config and review services.

``projects.settings.screening`` holds ``{"reviewer_count": n}`` for the
title/abstract phase and ``{"full_text_reviewer_count": n}`` for the full-text
phase.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.screening import AssignmentPhase

SCREENING_SETTINGS_KEY = "screening"
_MIN_REVIEWERS, _MAX_REVIEWERS = 1, 3
_COUNT_KEY: dict[AssignmentPhase, str] = {
    "title_abstract": "reviewer_count",
    "full_text": "full_text_reviewer_count",
}


def reviewer_count_of(settings: Mapping[str, Any] | None, phase: AssignmentPhase) -> int | None:
    """The reviewers per record configured for ``phase`` when it is 1..3, else ``None``."""
    value = ((settings or {}).get(SCREENING_SETTINGS_KEY) or {}).get(_COUNT_KEY[phase])
    in_range = isinstance(value, int) and _MIN_REVIEWERS <= value <= _MAX_REVIEWERS
    return value if in_range and not isinstance(value, bool) else None


@dataclass(frozen=True)
class ScreeningRoles:
    can_manage: bool
    can_review: bool
    can_arbitrate: bool


async def screening_roles(db: AsyncSession, project_id: UUID, user_id: UUID) -> ScreeningRoles:
    """The caller's roles, from the same SQL functions the RLS policies call."""
    row = (
        await db.execute(
            text(
                "SELECT public.is_project_manager(:pid, :uid) AS manage, "
                "public.is_project_reviewer(:pid, :uid) AS review, "
                "public.is_project_arbitrator(:pid, :uid) AS arbitrate"
            ),
            {"pid": str(project_id), "uid": str(user_id)},
        )
    ).one()
    return ScreeningRoles(
        can_manage=bool(row.manage), can_review=bool(row.review), can_arbitrate=bool(row.arbitrate)
    )
