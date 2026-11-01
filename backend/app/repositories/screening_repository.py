"""Screening persistence: assignments, decisions and rulings.

Every read takes ``project_id`` as a required keyword (an id list only narrows
it), and every assignment-to-article join goes through
:data:`ARTICLE_STILL_IN_PROJECT`. The two id-keyed calls, ``get_assignment``
and ``lock_assignment``, belong to the by-id guard and run behind it;
``decisions_in_assignment`` is keyed by a guard-bound assignment and runs only
behind ``screening_review_service.owned_decisions``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, TypeVar
from uuid import UUID

from sqlalchemy import ColumnElement, Select, Text, and_, cast, exists, func, literal, select
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import QueryableAttribute
from sqlalchemy.orm.util import AliasedClass

from app.models.article import Article, ArticleFile
from app.models.screening import (
    FULL_TEXT,
    TITLE_ABSTRACT,
    ScreeningArbitration,
    ScreeningAssignment,
    ScreeningDecision,
)
from app.repositories.duplicate_predicates import removed_duplicate
from app.schemas.screening import ScreeningPhase

# THE assignment-to-article join condition. Members can move an article to
# another project through PostgREST and nothing binds an assignment's
# project_id to the article's current project, so a moved article must read as
# missing. Use it as a ``.join(Article, ...)`` onclause, or as the WHERE of an
# EXISTS / scalar subquery correlated to an outer ``Article`` (duplicate_repository);
# never in a top-level ``.where``.
ARTICLE_STILL_IN_PROJECT = and_(
    Article.id == ScreeningAssignment.article_id,
    Article.project_id == ScreeningAssignment.project_id,
)


def live_assignments(project_id: UUID, phase: ScreeningPhase) -> Select[tuple[ScreeningAssignment]]:
    """The project's ``phase`` assignments whose article is still in the project
    and is not a removed duplicate."""
    return (
        select(ScreeningAssignment)
        .join(Article, ARTICLE_STILL_IN_PROJECT)
        .where(
            ScreeningAssignment.project_id == project_id,
            ScreeningAssignment.phase == phase,
            ~removed_duplicate(Article),
        )
    )


def has_main_pdf(article: type[Article] | AliasedClass[Article]) -> ColumnElement[bool]:
    """The article has a ``MAIN`` file (its PDF)."""
    return exists().where(ArticleFile.article_id == article.id, ArticleFile.file_role == "MAIN")


# Queue order: oldest enrollment first, then md5(assignment id) — a stable
# shuffle within an enrollment that is the same for every reviewer.
_QUEUE_ORDER = (ScreeningAssignment.enrolled_at, func.md5(cast(ScreeningAssignment.id, Text)))


_S = TypeVar("_S", bound=Select[Any])


def _narrowed(stmt: _S, column: QueryableAttribute[UUID], ids: Sequence[UUID] | None) -> _S:
    """Narrow a project-scoped read to ``ids``; ``None`` keeps the whole project."""
    return stmt if ids is None else stmt.where(column.in_(ids))


@dataclass(frozen=True, slots=True)
class RecordSource:
    """One project article with its title/abstract assignment, if any (never the abstract)."""

    article_id: UUID
    assignment_id: UUID | None
    title: str
    authors: list[str] | None
    publication_year: int | None
    journal_title: str | None
    pmid: str | None
    doi: str | None
    ingestion_source: str | None
    has_pdf: bool


class ScreeningRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def enroll(
        self,
        *,
        project_id: UUID,
        enrolled_by: UUID,
        article_ids: Sequence[UUID] | None,
        phase: ScreeningPhase,
    ) -> int:
        """Insert one assignment per article, skipping the enrolled and removed duplicates
        (explicit ``article_ids`` included); returns the rows inserted.

        The id is generated per row by ``gen_random_uuid()``: the model's Python
        default would render one id for every row of the INSERT ... SELECT.
        """
        source = select(
            func.gen_random_uuid(),
            Article.project_id,
            Article.id,
            literal(phase),
            literal(enrolled_by, type_=PG_UUID(as_uuid=True)),
        ).where(Article.project_id == project_id, ~removed_duplicate(Article))
        if article_ids is not None:
            source = source.where(Article.id.in_(article_ids))
        stmt = (
            insert(ScreeningAssignment)
            .from_select(
                ["id", "project_id", "article_id", "phase", "enrolled_by"],
                source,
                include_defaults=False,
            )
            .on_conflict_do_nothing(index_elements=["project_id", "article_id", "phase"])
        )
        result = await self.db.execute(stmt)
        return int(result.rowcount)  # type: ignore[attr-defined]

    async def count_enrolled(self, *, project_id: UUID, phase: ScreeningPhase) -> int:
        live = live_assignments(project_id, phase).subquery()
        return int((await self.db.execute(select(func.count()).select_from(live))).scalar_one())

    async def count_project_articles(self, *, project_id: UUID) -> int:
        stmt = select(func.count()).select_from(Article).where(Article.project_id == project_id)
        return int((await self.db.execute(stmt)).scalar_one())

    async def count_removed(self, *, project_id: UUID) -> int:
        """The project's articles that are removed duplicates."""
        stmt = (
            select(func.count())
            .select_from(Article)
            .where(Article.project_id == project_id, removed_duplicate(Article))
        )
        return int((await self.db.execute(stmt)).scalar_one())

    async def removed_among(self, *, project_id: UUID, article_ids: Sequence[UUID]) -> set[UUID]:
        """The given project articles that are removed duplicates."""
        stmt = select(Article.id).where(
            Article.project_id == project_id,
            Article.id.in_(article_ids),
            removed_duplicate(Article),
        )
        return set((await self.db.execute(stmt)).scalars().all())

    async def removed_duplicate_ids(self, *, project_id: UUID) -> list[UUID]:
        """The project's removed-duplicate article ids, by id."""
        stmt = (
            select(Article.id)
            .where(Article.project_id == project_id, removed_duplicate(Article))
            .order_by(Article.id)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def project_has_decision(self, *, project_id: UUID) -> bool:
        """Any title/abstract decision ever recorded in the project, moved articles included."""
        stmt = select(
            exists()
            .where(ScreeningDecision.assignment_id == ScreeningAssignment.id)
            .where(ScreeningAssignment.project_id == project_id)
            .where(ScreeningAssignment.phase == TITLE_ABSTRACT)
        )
        return bool((await self.db.execute(stmt)).scalar_one())

    async def has_assignment(
        self, *, project_id: UUID, phase: ScreeningPhase, article_id: UUID | None = None
    ) -> bool:
        """Any ``phase`` assignment in the project (of ``article_id`` when given), moved articles included."""
        stmt = select(
            exists().where(
                ScreeningAssignment.project_id == project_id,
                ScreeningAssignment.phase == phase,
                *([] if article_id is None else [ScreeningAssignment.article_id == article_id]),
            )
        )
        return bool((await self.db.execute(stmt)).scalar_one())

    async def assigned_article_ids(self, *, project_id: UUID, phase: ScreeningPhase) -> set[UUID]:
        stmt = select(ScreeningAssignment.article_id).where(
            ScreeningAssignment.project_id == project_id, ScreeningAssignment.phase == phase
        )
        return set((await self.db.execute(stmt)).scalars().all())

    async def live_assignment_ids_by_article(
        self, *, project_id: UUID, phase: ScreeningPhase
    ) -> dict[UUID, UUID]:
        """Article id to the id of its live ``phase`` assignment."""
        stmt = live_assignments(project_id, phase).with_only_columns(
            ScreeningAssignment.article_id, ScreeningAssignment.id
        )
        return dict((await self.db.execute(stmt)).tuples().all())

    async def get_assignment(self, assignment_id: UUID) -> ScreeningAssignment | None:
        """The by-id guard's lookup; nothing else resolves an assignment by id alone."""
        stmt = select(ScreeningAssignment).where(ScreeningAssignment.id == assignment_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def lock_assignment(self, assignment_id: UUID) -> None:
        """``FOR NO KEY UPDATE`` on a guard-bound assignment: serializes its decisions
        without blocking the KEY SHARE a decision's FK insert takes."""
        stmt = (
            select(ScreeningAssignment.id)
            .where(ScreeningAssignment.id == assignment_id)
            .with_for_update(key_share=True)
        )
        await self.db.execute(stmt)

    async def live_assignment_ids(
        self,
        *,
        project_id: UUID,
        phase: ScreeningPhase,
        assignment_ids: Sequence[UUID] | None = None,
    ) -> list[UUID]:
        stmt = live_assignments(project_id, phase).with_only_columns(ScreeningAssignment.id)
        stmt = _narrowed(stmt, ScreeningAssignment.id, assignment_ids)
        return list((await self.db.execute(stmt)).scalars().all())

    async def current_decisions(
        self, *, project_id: UUID, assignment_ids: Sequence[UUID] | None = None
    ) -> list[ScreeningDecision]:
        """Each reviewer's latest decision per assignment of the project."""
        stmt = (
            select(ScreeningDecision)
            .join(ScreeningAssignment, ScreeningAssignment.id == ScreeningDecision.assignment_id)
            .where(ScreeningAssignment.project_id == project_id)
            .distinct(ScreeningDecision.assignment_id, ScreeningDecision.reviewer_id)
            .order_by(
                ScreeningDecision.assignment_id,
                ScreeningDecision.reviewer_id,
                ScreeningDecision.created_at.desc(),
                ScreeningDecision.id.desc(),
            )
        )
        stmt = _narrowed(stmt, ScreeningDecision.assignment_id, assignment_ids)
        return list((await self.db.execute(stmt)).scalars().all())

    async def latest_rulings(
        self, *, project_id: UUID, assignment_ids: Sequence[UUID] | None = None
    ) -> dict[UUID, ScreeningArbitration]:
        """The latest ruling per assignment of the project."""
        stmt = (
            select(ScreeningArbitration)
            .join(ScreeningAssignment, ScreeningAssignment.id == ScreeningArbitration.assignment_id)
            .where(ScreeningAssignment.project_id == project_id)
            .distinct(ScreeningArbitration.assignment_id)
            .order_by(
                ScreeningArbitration.assignment_id,
                ScreeningArbitration.created_at.desc(),
                ScreeningArbitration.id.desc(),
            )
        )
        stmt = _narrowed(stmt, ScreeningArbitration.assignment_id, assignment_ids)
        rows = (await self.db.execute(stmt)).scalars().all()
        return {row.assignment_id: row for row in rows}

    async def assignments_with_articles(
        self, *, project_id: UUID, phase: ScreeningPhase, assignment_ids: Sequence[UUID]
    ) -> list[tuple[UUID, Article]]:
        """The given live assignments with their articles, in queue order."""
        stmt = (
            live_assignments(project_id, phase)
            .with_only_columns(ScreeningAssignment.id, Article)
            .where(ScreeningAssignment.id.in_(assignment_ids))
            .order_by(*_QUEUE_ORDER)
        )
        return [(row[0], row[1]) for row in (await self.db.execute(stmt)).all()]

    async def record_rows(self, *, project_id: UUID, phase: ScreeningPhase) -> list[RecordSource]:
        """The project's articles for ``phase`` in queue order, removed duplicates aside.

        Title/abstract lists every article, enrolled first, then by creation;
        full text lists only the articles with a live full-text assignment.
        """
        phase_assignment = and_(ARTICLE_STILL_IN_PROJECT, ScreeningAssignment.phase == phase)
        base = select(
            Article.id,
            ScreeningAssignment.id,
            Article.title,
            Article.authors,
            Article.publication_year,
            Article.journal_title,
            Article.pmid,
            Article.doi,
            Article.ingestion_source,
            has_main_pdf(Article),
        ).select_from(Article)
        joined = (
            base.join(ScreeningAssignment, phase_assignment)
            if phase == FULL_TEXT
            else base.outerjoin(ScreeningAssignment, phase_assignment)
        )
        stmt = joined.where(Article.project_id == project_id, ~removed_duplicate(Article)).order_by(
            ScreeningAssignment.id.is_(None), *_QUEUE_ORDER, Article.created_at, Article.id
        )
        return [RecordSource(*row) for row in (await self.db.execute(stmt)).all()]

    async def add_decision(
        self,
        assignment_id: UUID,
        reviewer_id: UUID,
        decision: str,
        exclusion_reason: str | None,
        rationale: str | None,
    ) -> ScreeningDecision:
        """One INSERT: a decision row is never updated, a change is a new row."""
        row = ScreeningDecision(
            assignment_id=assignment_id,
            reviewer_id=reviewer_id,
            decision=decision,
            exclusion_reason=exclusion_reason,
            rationale=rationale,
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def decisions_in_assignment(
        self, assignment_id: UUID, decision_ids: Sequence[UUID]
    ) -> list[ScreeningDecision]:
        """The given decisions that belong to ``assignment_id`` (the scope, in the WHERE clause)."""
        stmt = select(ScreeningDecision).where(
            ScreeningDecision.assignment_id == assignment_id,
            ScreeningDecision.id.in_(decision_ids),
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def add_arbitration(
        self,
        assignment_id: UUID,
        decision: str,
        exclusion_reason: str | None,
        selected_decision_id: UUID | None,
        rationale: str | None,
        decided_by: UUID,
    ) -> ScreeningArbitration:
        """One INSERT: a ruling is never updated, a re-ruling is a new row."""
        row = ScreeningArbitration(
            assignment_id=assignment_id,
            decision=decision,
            exclusion_reason=exclusion_reason,
            selected_decision_id=selected_decision_id,
            rationale=rationale,
            decided_by=decided_by,
        )
        self.db.add(row)
        await self.db.flush()
        return row
