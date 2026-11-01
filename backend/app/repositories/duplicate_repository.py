"""Duplicate candidates' sources, the latest verdict per pair, and the compare fields.

Every read takes ``project_id`` and binds each article to it in the WHERE
clause; a verdict is listed only while both of its articles are in the project.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.article import Article
from app.models.article_duplicate import ArticleDuplicateVerdict
from app.models.extraction import ExtractionRun
from app.models.extraction_instance import ExtractionInstance
from app.models.screening import TITLE_ABSTRACT, ScreeningAssignment, ScreeningDecision
from app.repositories.article_repository import doi_match_key
from app.repositories.duplicate_predicates import removed_duplicate
from app.repositories.screening_repository import (
    ARTICLE_STILL_IN_PROJECT,
    has_main_pdf,
    live_assignments,
)
from app.schemas.duplicates import DuplicateSide


def refusing_work(article: type[Article]) -> ColumnElement[bool]:
    """Work that refuses a ``duplicate`` verdict on the article (R11), in its current project.

    A non-title/abstract assignment, an extraction run (QA runs included) or an
    extraction instance. ``extraction_batch_items`` do not count.
    """
    later_phase = (
        exists()
        .where(ScreeningAssignment.phase != TITLE_ABSTRACT, ARTICLE_STILL_IN_PROJECT)
        .correlate(article)
    )
    run = exists().where(
        ExtractionRun.article_id == article.id, ExtractionRun.project_id == article.project_id
    )
    instance = exists().where(
        ExtractionInstance.article_id == article.id,
        ExtractionInstance.project_id == article.project_id,
    )
    return or_(later_phase, run, instance)


def review_work(article: type[Article]) -> ColumnElement[bool]:
    """Any title/abstract decision, or :func:`refusing_work`: the keep order's first level."""
    ta_decision = (
        exists()
        .where(
            ScreeningDecision.assignment_id == ScreeningAssignment.id,
            ScreeningAssignment.phase == TITLE_ABSTRACT,
            ARTICLE_STILL_IN_PROJECT,
        )
        .correlate(article)
    )
    return or_(ta_decision, refusing_work(article))


def _has_abstract(article: type[Article]) -> ColumnElement[bool]:
    return func.coalesce(func.btrim(article.abstract), "") != ""


@dataclass(frozen=True)
class CandidateSource:
    """One project article as the matcher and the keep order see it."""

    article_id: UUID
    title: str
    pmid: str | None
    doi_key: str | None
    publication_year: int | None
    journal_title: str | None
    article_type: str | None
    zotero_item_type: str | None
    has_review_work: bool
    has_pdf: bool
    has_abstract: bool
    created_at: datetime


@dataclass(frozen=True)
class LatestVerdict:
    article_id: UUID
    kept_article_id: UUID
    verdict: str
    basis: str
    decided_by: UUID
    created_at: datetime


def _sources_stmt(project_id: UUID) -> Select[Any]:
    return select(
        Article.id,
        Article.title,
        Article.pmid,
        doi_match_key(Article.doi),
        Article.publication_year,
        Article.journal_title,
        Article.article_type,
        Article.source_payload["data"]["itemType"].astext,
        review_work(Article),
        has_main_pdf(Article),
        _has_abstract(Article),
        Article.created_at,
    ).where(Article.project_id == project_id)


def _source(row: Any) -> CandidateSource:
    article_id, title, pmid, doi_key, *rest = row
    return CandidateSource(article_id, title, (pmid or "").strip() or None, doi_key or None, *rest)


_LOW = func.least(ArticleDuplicateVerdict.article_id, ArticleDuplicateVerdict.kept_article_id)
_HIGH = func.greatest(ArticleDuplicateVerdict.article_id, ArticleDuplicateVerdict.kept_article_id)


def _latest_stmt(project_id: UUID) -> Select[Any]:
    """One row per unordered pair, its latest verdict; both articles bound to the project."""
    verdict = ArticleDuplicateVerdict
    removed, kept = aliased(Article), aliased(Article)
    return (
        select(
            verdict.article_id,
            verdict.kept_article_id,
            verdict.verdict,
            verdict.basis,
            verdict.decided_by,
            verdict.created_at,
        )
        .join(removed, removed.id == verdict.article_id)
        .join(kept, kept.id == verdict.kept_article_id)
        .where(
            verdict.project_id == project_id,
            removed.project_id == project_id,
            kept.project_id == project_id,
        )
        .distinct(_LOW, _HIGH)
        .order_by(_LOW, _HIGH, verdict.created_at.desc(), verdict.id.desc())
    )


class DuplicateRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def candidate_sources(self, *, project_id: UUID) -> list[CandidateSource]:
        """Every non-removed article of the project."""
        stmt = _sources_stmt(project_id).where(~removed_duplicate(Article))
        return [_source(row) for row in (await self.db.execute(stmt)).all()]

    async def article_sources(
        self, *, project_id: UUID, article_ids: Sequence[UUID]
    ) -> list[CandidateSource]:
        """The given project articles, removed ones included (a resolved pair's tier)."""
        stmt = _sources_stmt(project_id).where(Article.id.in_(article_ids))
        return [_source(row) for row in (await self.db.execute(stmt)).all()]

    async def latest_verdicts(self, *, project_id: UUID) -> list[LatestVerdict]:
        """The latest verdict of each unordered pair whose two articles are in the project."""
        rows = (await self.db.execute(_latest_stmt(project_id))).all()
        return [LatestVerdict(*row) for row in rows]

    async def latest_pair_verdict(
        self, *, project_id: UUID, article_id: UUID, other_article_id: UUID
    ) -> LatestVerdict | None:
        """The latest verdict of one unordered pair of project articles, if any."""
        verdict = ArticleDuplicateVerdict
        stmt = _latest_stmt(project_id).where(
            verdict.article_id.in_([article_id, other_article_id]),
            verdict.kept_article_id.in_([article_id, other_article_id]),
        )
        row = (await self.db.execute(stmt)).first()
        return None if row is None else LatestVerdict(*row)

    async def has_refusing_work(self, *, project_id: UUID, article_ids: Sequence[UUID]) -> bool:
        """Any of the given project articles has :func:`refusing_work`."""
        stmt = select(
            exists().where(
                Article.project_id == project_id,
                Article.id.in_(article_ids),
                refusing_work(Article),
            )
        )
        return bool((await self.db.execute(stmt)).scalar_one())

    async def enrolled_among(self, *, project_id: UUID, article_ids: Sequence[UUID]) -> set[UUID]:
        """The given articles with a live title/abstract assignment in the project."""
        stmt = (
            live_assignments(project_id, TITLE_ABSTRACT)
            .where(ScreeningAssignment.article_id.in_(article_ids))
            .with_only_columns(ScreeningAssignment.article_id)
        )
        return set((await self.db.execute(stmt)).scalars())

    async def add_verdict(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        kept_article_id: UUID,
        verdict: str,
        basis: str,
        decided_by: UUID,
    ) -> None:
        """Append one verdict row (flushed, so the next read in the batch sees it)."""
        self.db.add(
            ArticleDuplicateVerdict(
                project_id=project_id,
                article_id=article_id,
                kept_article_id=kept_article_id,
                verdict=verdict,
                basis=basis,
                decided_by=decided_by,
            )
        )
        await self.db.flush()

    async def compare_fields(
        self, *, project_id: UUID, article_ids: Sequence[UUID]
    ) -> dict[UUID, DuplicateSide]:
        """The compare fields of the given project articles.

        ``screening_decisions`` counts the current title/abstract decisions (one
        per reviewer) on the article's assignment, joined by article and project
        but not by removal: a removed record still shows the decisions kept as audit.
        """
        decisions = (
            select(func.count(func.distinct(ScreeningDecision.reviewer_id)))
            .join(ScreeningAssignment, ScreeningAssignment.id == ScreeningDecision.assignment_id)
            .where(ScreeningAssignment.phase == TITLE_ABSTRACT, ARTICLE_STILL_IN_PROJECT)
            .correlate(Article)
            .scalar_subquery()
        )
        stmt = select(
            Article.id.label("article_id"),
            Article.title,
            Article.authors,
            Article.publication_year,
            Article.journal_title,
            Article.doi,
            Article.pmid,
            Article.ingestion_source,
            has_main_pdf(Article).label("has_pdf"),
            _has_abstract(Article).label("has_abstract"),
            decisions.label("screening_decisions"),
            review_work(Article).label("has_review_work"),
            refusing_work(Article).label("has_refusing_work"),
        ).where(Article.project_id == project_id, Article.id.in_(article_ids))
        sides: dict[UUID, DuplicateSide] = {}
        for row in (await self.db.execute(stmt)).mappings().all():
            sides[row["article_id"]] = DuplicateSide.model_validate(
                {**row, "authors": row["authors"] or []}
            )
        return sides
