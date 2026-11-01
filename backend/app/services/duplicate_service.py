"""The duplicates read (spec §8.3): open candidate pairs and resolved pairs."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.duplicate_repository import DuplicateRepository
from app.schemas.duplicates import DuplicatePair, DuplicatesRead
from app.services.duplicate_candidates import candidate_pairs, match
from app.services.profile_names import profile_names

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
