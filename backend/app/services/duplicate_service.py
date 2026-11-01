"""Duplicates (spec §8.3): the read (open and resolved pairs) and the verdicts write."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.duplicate_repository import CandidateSource, DuplicateRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.screening_repository import ScreeningRepository
from app.schemas.common import ApiErrorCode
from app.schemas.duplicates import (
    DuplicateBasis,
    DuplicatePair,
    DuplicatesRead,
    DuplicateVerdictCreate,
    DuplicateVerdictsResult,
)
from app.services.article_read_service import owned_articles
from app.services.duplicate_candidates import candidate_pairs, match
from app.services.profile_names import profile_names
from app.services.screening_config_service import ProjectNotFoundError
from app.services.screening_errors import ScreeningStateError

_CLOSING = ("duplicate", "distinct")


class DuplicateService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = DuplicateRepository(db)

    async def read(self, project_id: UUID) -> DuplicatesRead:
        sources = await self.repo.candidate_sources(project_id=project_id)
        latest = await self.repo.latest_verdicts(project_id=project_id)
        resolved = sorted(
            (v for v in latest if v.verdict in _CLOSING),
            key=lambda v: (v.created_at, str(v.article_id), str(v.kept_article_id)),
            reverse=True,
        )
        open_pairs = candidate_pairs(
            sources, closed={frozenset({v.article_id, v.kept_article_id}) for v in resolved}
        )
        resolved_ids = {i for v in resolved for i in (v.article_id, v.kept_article_id)}
        ids = resolved_ids | {i for p in open_pairs for i in (p.article_id, p.kept_article_id)}
        sides = await self.repo.compare_fields(project_id=project_id, article_ids=list(ids))
        resolved_sources = {
            s.article_id: s
            for s in await self.repo.article_sources(
                project_id=project_id, article_ids=list(resolved_ids)
            )
        }
        names = await profile_names(self.db, {v.decided_by for v in resolved}) if resolved else {}

        open_read = [
            DuplicatePair(
                article_id=p.article_id,
                kept_article_id=p.kept_article_id,
                tier=p.tier,
                basis=p.basis,
                match_label=p.match_label,
                removed=sides[p.article_id],
                kept=sides[p.kept_article_id],
            )
            for p in open_pairs
        ]
        resolved_read: list[DuplicatePair] = []
        for v in resolved:
            found = match(resolved_sources[v.article_id], resolved_sources[v.kept_article_id])
            tier, label = (found[0], found[1]) if found else (None, None)
            resolved_read.append(
                DuplicatePair.model_validate(
                    {
                        "article_id": v.article_id,
                        "kept_article_id": v.kept_article_id,
                        "tier": tier,
                        "basis": v.basis,
                        "match_label": label,
                        "removed": sides[v.article_id],
                        "kept": sides[v.kept_article_id],
                        "verdict": v.verdict,
                        "decided_by_name": names.get(v.decided_by),
                        "created_at": v.created_at,
                    }
                )
            )
        return DuplicatesRead(open=open_read, resolved=resolved_read)

    async def write_verdicts(
        self, project_id: UUID, user_id: UUID, items: Sequence[DuplicateVerdictCreate]
    ) -> DuplicateVerdictsResult:
        """Apply the rulings in order, under the project lock; any refusal raises (no partial write).

        Each item reads the state this batch's earlier rows left (every insert
        is flushed). A ``duplicate`` whose removed side is already removed and a
        ``cleared`` on a pair with no open ruling are skipped, not counted.
        """
        if await ProjectRepository(self.db).lock_for_update(project_id) is None:
            raise ProjectNotFoundError
        ids = await owned_articles(
            self.db,
            project_id=project_id,
            article_ids=[i for item in items for i in (item.article_id, item.kept_article_id)],
        )
        sources = {
            s.article_id: s
            for s in await self.repo.article_sources(project_id=project_id, article_ids=ids)
        }
        written = enrolled_kept = 0
        for item in items:
            if item.verdict == "cleared":
                latest = await self.repo.latest_pair_verdict(
                    project_id=project_id,
                    article_id=item.article_id,
                    other_article_id=item.kept_article_id,
                )
                if latest is None or latest.verdict not in _CLOSING:
                    continue
                basis = latest.basis
            else:
                basis = _basis(sources[item.article_id], sources[item.kept_article_id])
            if item.verdict == "duplicate":
                if not await self._may_remove(project_id, item):
                    continue
                enrolled_kept += await self._enroll_kept(project_id, user_id, item)
            await self.repo.add_verdict(
                project_id=project_id,
                article_id=item.article_id,
                kept_article_id=item.kept_article_id,
                verdict=item.verdict,
                basis=basis,
                decided_by=user_id,
            )
            written += 1
        return DuplicateVerdictsResult(written=written, enrolled_kept=enrolled_kept)

    async def _may_remove(self, project_id: UUID, item: DuplicateVerdictCreate) -> bool:
        """False when the removed side is already removed; raises on a refused removal."""
        removed = await self.repo.removed_among(
            project_id=project_id, article_ids=[item.article_id, item.kept_article_id]
        )
        if item.article_id in removed:
            return False
        if item.kept_article_id in removed:
            raise ScreeningStateError(
                ApiErrorCode.DUPLICATE_KEPT_IS_REMOVED,
                "The record to keep was already removed as a duplicate.",
            )
        if await self.repo.has_refusing_work(project_id=project_id, article_ids=[item.article_id]):
            raise ScreeningStateError(
                ApiErrorCode.DUPLICATE_HAS_REVIEW_WORK,
                "The record to remove has full-text or extraction work.",
            )
        return True

    async def _enroll_kept(
        self, project_id: UUID, user_id: UUID, item: DuplicateVerdictCreate
    ) -> int:
        """Enroll the kept record at title/abstract when only the removed one was enrolled."""
        enrolled = await self.repo.enrolled_among(
            project_id=project_id, article_ids=[item.article_id, item.kept_article_id]
        )
        if item.article_id not in enrolled or item.kept_article_id in enrolled:
            return 0
        return await ScreeningRepository(self.db).enroll(
            project_id=project_id, enrolled_by=user_id, article_ids=[item.kept_article_id]
        )


def _basis(removed: CandidateSource, kept: CandidateSource) -> DuplicateBasis:
    """The basis today's metadata supports, ``manual`` when the two no longer match."""
    found = match(removed, kept)
    return "manual" if found is None else found[2]
