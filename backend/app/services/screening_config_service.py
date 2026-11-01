"""Screening setup: reviewers per record, enrollment, and the caller's roles.

``projects.settings.screening`` holds ``{"reviewer_count": n}``. The writer
merges into the old value so a later sibling key needs no migration. Decisions
read the count under ``FOR SHARE``, so the project row lock taken here
serializes a change with any decision in flight.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import FULL_TEXT, TITLE_ABSTRACT
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository
from app.repositories.screening_repository import ScreeningRepository
from app.schemas.common import ApiErrorCode
from app.schemas.screening import (
    ScreeningConfigRead,
    ScreeningConfigUpdate,
    ScreeningEnrollResult,
    ScreeningPhase,
)
from app.services.article_read_service import owned_articles
from app.services.project_ai_context import load_exclusion_reasons
from app.services.screening_errors import ScreeningStateError
from app.services.screening_review_service import full_text_candidates
from app.services.screening_settings import (
    SCREENING_SETTINGS_KEY,
    reviewer_count_of,
    screening_roles,
)


class ProjectNotFoundError(Exception):
    pass


class ScreeningConfigService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.projects = ProjectRepository(db)
        self.members = ProjectMemberRepository(db)
        self.screening = ScreeningRepository(db)

    async def read(self, project_id: UUID, viewer_id: UUID) -> ScreeningConfigRead:
        project = await self.projects.get_by_id(project_id)
        settings = project.settings if project else None
        ta_count = reviewer_count_of(settings, TITLE_ABSTRACT)
        enrolled = await self.screening.count_enrolled(project_id=project_id, phase=TITLE_ABSTRACT)
        total = await self.screening.count_project_articles(project_id=project_id)
        removed = await self.screening.count_removed(project_id=project_id)
        roles = await screening_roles(self.db, project_id, viewer_id)
        ready = await full_text_candidates(
            self.db, project_id=project_id, ta_reviewer_count=ta_count
        )
        return ScreeningConfigRead(
            reviewer_count=ta_count,
            reviewer_count_locked=await self.screening.project_has_decision(project_id=project_id),
            full_text_reviewer_count=reviewer_count_of(settings, FULL_TEXT),
            full_text_count_locked=await self.screening.has_assignment(
                project_id=project_id, phase=FULL_TEXT
            ),
            full_text_ready=len(ready),
            full_text_enrolled=await self.screening.count_enrolled(
                project_id=project_id, phase=FULL_TEXT
            ),
            reviewer_capable=await self.members.count_reviewer_capable(project_id),
            enrolled=enrolled,
            not_enrolled=total - enrolled - removed,
            can_manage=roles.can_manage,
            can_review=roles.can_review,
            can_arbitrate=roles.can_arbitrate,
            exclusion_reasons=await load_exclusion_reasons(self.db, project_id),
        )

    async def set_config(
        self, project_id: UUID, viewer_id: UUID, body: ScreeningConfigUpdate
    ) -> ScreeningConfigRead:
        project = await self.projects.lock_for_update(project_id)
        if project is None:
            raise ProjectNotFoundError
        capable = await self.members.count_reviewer_capable(project_id)
        current = reviewer_count_of(project.settings, TITLE_ABSTRACT)
        if (
            current is not None
            and current != body.reviewer_count
            and await self.screening.project_has_decision(project_id=project_id)
        ):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_CONFIG_FROZEN,
                "Reviewers per record cannot change after the first decision.",
            )
        if body.reviewer_count > capable:
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_TOO_FEW_REVIEWERS,
                "The project has fewer reviewers than that.",
            )
        sets_full_text = "full_text_reviewer_count" in body.model_fields_set
        full_text = body.full_text_reviewer_count
        if sets_full_text:
            if full_text != reviewer_count_of(
                project.settings, FULL_TEXT
            ) and await self.screening.has_assignment(project_id=project_id, phase=FULL_TEXT):
                raise ScreeningStateError(
                    ApiErrorCode.SCREENING_CONFIG_FROZEN,
                    "Full-text reviewers cannot change once a record was sent to full text.",
                )
            if full_text is not None and full_text > capable:
                raise ScreeningStateError(
                    ApiErrorCode.SCREENING_TOO_FEW_REVIEWERS,
                    "The project has fewer reviewers than that.",
                )

        def merge(old: dict[str, int] | None) -> dict[str, int]:
            merged = {**(old or {}), "reviewer_count": body.reviewer_count}
            if sets_full_text and full_text is None:
                merged.pop("full_text_reviewer_count", None)
            elif sets_full_text and full_text is not None:
                merged["full_text_reviewer_count"] = full_text
            return merged

        await self.projects.update_settings_key(project_id, SCREENING_SETTINGS_KEY, merge)
        return await self.read(project_id, viewer_id)

    async def enroll(
        self,
        project_id: UUID,
        enrolled_by: UUID,
        article_ids: list[UUID] | None,
        phase: ScreeningPhase = TITLE_ABSTRACT,
    ) -> ScreeningEnrollResult:
        """Enroll the given articles (or every article of the project); repeats are skipped.

        Removed duplicates are never candidates, so ``already_enrolled`` never
        counts one. ``full_text`` sends the title/abstract include/maybe outcomes
        instead. Both take the project row lock (the verdict writer's), so a
        concurrent merge or config change cannot interleave with the count and
        the insert.
        """
        if phase == FULL_TEXT:
            return await self._enroll_full_text(project_id, enrolled_by)
        await self.projects.lock_for_update(project_id)
        if article_ids is not None:
            owned = await owned_articles(self.db, project_id=project_id, article_ids=article_ids)
            removed = await self.screening.removed_among(project_id=project_id, article_ids=owned)
            article_ids = [article_id for article_id in owned if article_id not in removed]
            candidates = len(article_ids)
        else:
            candidates = await self.screening.count_project_articles(
                project_id=project_id
            ) - await self.screening.count_removed(project_id=project_id)
        enrolled = await self.screening.enroll(
            project_id=project_id,
            enrolled_by=enrolled_by,
            article_ids=article_ids,
            phase=TITLE_ABSTRACT,
        )
        return ScreeningEnrollResult(enrolled=enrolled, already_enrolled=candidates - enrolled)

    async def _enroll_full_text(self, project_id: UUID, enrolled_by: UUID) -> ScreeningEnrollResult:
        project = await self.projects.lock_for_update(project_id)
        if project is None:
            raise ProjectNotFoundError
        if reviewer_count_of(project.settings, FULL_TEXT) is None:
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_NOT_CONFIGURED, "Full-text screening is not set up."
            )
        if not await load_exclusion_reasons(self.db, project_id):
            raise ScreeningStateError(
                ApiErrorCode.SCREENING_REASON_REQUIRED,
                "Add exclusion reasons to the protocol before sending records to full text.",
            )
        candidates = await full_text_candidates(
            self.db,
            project_id=project_id,
            ta_reviewer_count=reviewer_count_of(project.settings, TITLE_ABSTRACT),
        )
        if not candidates:
            return ScreeningEnrollResult(enrolled=0, already_enrolled=0)
        enrolled = await self.screening.enroll(
            project_id=project_id, enrolled_by=enrolled_by, article_ids=candidates, phase=FULL_TEXT
        )
        return ScreeningEnrollResult(enrolled=enrolled, already_enrolled=len(candidates) - enrolled)
