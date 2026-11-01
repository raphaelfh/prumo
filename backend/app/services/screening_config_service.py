"""Screening setup: reviewers per record, enrollment, and the caller's roles.

``projects.settings.screening`` holds ``{"reviewer_count": n}``. The writer
merges into the old value so a later sibling key needs no migration. Decisions
read the count under ``FOR SHARE``, so the project row lock taken here
serializes a change with any decision in flight.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository
from app.repositories.screening_repository import ScreeningRepository
from app.schemas.common import ApiErrorCode
from app.schemas.screening import ScreeningConfigRead, ScreeningEnrollResult
from app.services.article_read_service import owned_articles
from app.services.project_ai_context import load_exclusion_reasons
from app.services.screening_errors import ScreeningStateError

SCREENING_SETTINGS_KEY = "screening"
_MIN_REVIEWERS, _MAX_REVIEWERS = 1, 3


class ProjectNotFoundError(Exception):
    pass


def reviewer_count_of(settings: Mapping[str, Any] | None) -> int | None:
    """The configured reviewers per record when it is 1..3, else ``None``."""
    value = ((settings or {}).get(SCREENING_SETTINGS_KEY) or {}).get("reviewer_count")
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


class ScreeningConfigService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.projects = ProjectRepository(db)
        self.members = ProjectMemberRepository(db)
        self.screening = ScreeningRepository(db)

    async def read(self, project_id: UUID, viewer_id: UUID) -> ScreeningConfigRead:
        project = await self.projects.get_by_id(project_id)
        enrolled = await self.screening.count_enrolled(project_id=project_id)
        total = await self.screening.count_project_articles(project_id=project_id)
        roles = await screening_roles(self.db, project_id, viewer_id)
        return ScreeningConfigRead(
            reviewer_count=reviewer_count_of(project.settings if project else None),
            reviewer_count_locked=await self.screening.project_has_decision(project_id=project_id),
            reviewer_capable=await self.members.count_reviewer_capable(project_id),
            enrolled=enrolled,
            not_enrolled=total - enrolled,
            can_manage=roles.can_manage,
            can_review=roles.can_review,
            can_arbitrate=roles.can_arbitrate,
            exclusion_reasons=await load_exclusion_reasons(self.db, project_id),
        )

    async def set_reviewer_count(
        self, project_id: UUID, viewer_id: UUID, reviewer_count: int
    ) -> ScreeningConfigRead:
        project = await self.projects.lock_for_update(project_id)
        if project is None:
            raise ProjectNotFoundError
        current = reviewer_count_of(project.settings)
        if (
            current is not None
            and current != reviewer_count
            and await self.screening.project_has_decision(project_id=project_id)
        ):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_CONFIG_FROZEN,
                "Reviewers per record cannot change after the first decision.",
            )
        if reviewer_count > await self.members.count_reviewer_capable(project_id):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_TOO_FEW_REVIEWERS,
                "The project has fewer reviewers than that.",
            )
        await self.projects.update_settings_key(
            project_id,
            SCREENING_SETTINGS_KEY,
            lambda old: {**(old or {}), "reviewer_count": reviewer_count},
        )
        return await self.read(project_id, viewer_id)

    async def enroll(
        self, project_id: UUID, enrolled_by: UUID, article_ids: list[UUID] | None
    ) -> ScreeningEnrollResult:
        """Enroll the given articles (or every article of the project); repeats are skipped."""
        if article_ids is not None:
            article_ids = await owned_articles(
                self.db, project_id=project_id, article_ids=article_ids
            )
            candidates = len(article_ids)
        else:
            candidates = await self.screening.count_project_articles(project_id=project_id)
        enrolled = await self.screening.enroll(
            project_id=project_id, enrolled_by=enrolled_by, article_ids=article_ids
        )
        return ScreeningEnrollResult(enrolled=enrolled, already_enrolled=candidates - enrolled)
