"""PRISMA identification and screening counts, computed on read.

Nothing here is stored: every figure comes from articles, sync events,
assignments, decisions and rulings. Outcomes come from ``assignment_states``,
never a second derivation. The payload goes to every member, reviewers
included, so a pending record and one in conflict must count identically.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.article_author import ArticleSyncEvent, ArticleSyncRun
from app.models.screening import FULL_TEXT, TITLE_ABSTRACT
from app.repositories.project_repository import ProjectRepository
from app.repositories.screening_repository import ScreeningRepository, live_assignments
from app.schemas.prisma import PrismaCountsRead, PrismaReasonCount, PrismaSourceCount
from app.services.screening_outcome import AssignmentState
from app.services.screening_review_service import assignment_states, full_text_candidates
from app.services.screening_settings import reviewer_count_of

PUBMED = "pubmed"
_MANUAL = "manual"
# Events that mean the PMID was found: a repeat inside one request still names a
# record, and ``unchanged`` matched an article it had nothing to fill on.
_IDENTIFIED_STATUSES = ("inserted", "updated", "unchanged", "duplicate_in_request")
_FOUND_STATUSES = ("inserted", "updated", "unchanged")


@dataclass(frozen=True)
class ScreeningBox:
    screened: int
    excluded: int
    excluded_by_reason: dict[str, int]
    excluded_reasons_differ: int
    excluded_without_reason: int
    sought_for_retrieval: int


def screening_box(states: Sequence[AssignmentState]) -> ScreeningBox:
    """Count the screening box; only a state WITH an outcome counts beyond ``screened``.

    A pending and a conflict state have no outcome, so they contribute
    identically (to ``screened`` only).
    """
    by_reason: Counter[str] = Counter()
    excluded = differ = without_reason = sought = 0
    for state in states:
        outcome = state.outcome
        if outcome is None:
            continue
        if outcome.decision == "exclude":
            excluded += 1
            if outcome.reasons_differ:
                differ += 1
            elif outcome.exclusion_reason:
                by_reason[outcome.exclusion_reason] += 1
            else:
                without_reason += 1
        else:
            sought += 1
    return ScreeningBox(
        screened=len(states),
        excluded=excluded,
        excluded_by_reason=dict(by_reason),
        excluded_reasons_differ=differ,
        excluded_without_reason=without_reason,
        sought_for_retrieval=sought,
    )


@dataclass(frozen=True)
class ReportsBox:
    not_retrieved: int
    assessed: int
    excluded_by_reason: dict[str, int]
    included: int
    without_outcome: int


def reports_box(states: Sequence[AssignmentState]) -> ReportsBox:
    """Count the full-text reports box; ``assessed`` is the include and exclude outcomes.

    A pending and a conflict state have no outcome and count identically, as
    ``without_outcome``.
    """
    by_reason: Counter[str] = Counter()
    not_retrieved = included = without_outcome = 0
    for state in states:
        outcome = state.outcome
        if outcome is None:
            without_outcome += 1
        elif outcome.decision == "not_retrieved":
            not_retrieved += 1
        elif outcome.decision == "include":
            included += 1
        elif outcome.exclusion_reason:
            by_reason[outcome.exclusion_reason] += 1
    return ReportsBox(
        not_retrieved=not_retrieved,
        assessed=included + sum(by_reason.values()),
        excluded_by_reason=dict(by_reason),
        included=included,
        without_outcome=without_outcome,
    )


def _reason_counts(by_reason: dict[str, int]) -> list[PrismaReasonCount]:
    return [
        PrismaReasonCount(reason=reason, count=count)
        for reason, count in sorted(by_reason.items(), key=lambda i: (-i[1], i[0]))
    ]


async def _pubmed_identified(db: AsyncSession, project_id: UUID) -> int:
    """Distinct PMIDs the project's PubMed imports found AND whose article is enrolled here."""
    enrolled = live_assignments(project_id, TITLE_ABSTRACT).subquery()
    stmt = (
        select(func.count(func.distinct(ArticleSyncEvent.event_payload["pmid"].astext)))
        .select_from(ArticleSyncEvent)
        .join(ArticleSyncRun, ArticleSyncRun.id == ArticleSyncEvent.sync_run_id)
        .where(
            ArticleSyncRun.project_id == project_id,
            ArticleSyncRun.source == PUBMED,
            ArticleSyncEvent.status.in_(_IDENTIFIED_STATUSES),
            ArticleSyncEvent.article_id.in_(select(enrolled.c.article_id)),
        )
    )
    return int((await db.execute(stmt)).scalar_one())


async def _other_sources(db: AsyncSession, project_id: UUID) -> list[PrismaSourceCount]:
    """Enrolled articles not ingested from PubMed, by lower-cased ingestion source."""
    source = func.lower(func.coalesce(Article.ingestion_source, _MANUAL))
    enrolled = live_assignments(project_id, TITLE_ABSTRACT).subquery()
    stmt = (
        select(source.label("source"), func.count().label("n"))
        .select_from(Article)
        .join(enrolled, enrolled.c.article_id == Article.id)
        .where(Article.project_id == project_id, source != PUBMED)
        .group_by(source)
        .order_by(source)
    )
    rows = (await db.execute(stmt)).all()
    return [PrismaSourceCount(source=row.source, count=row.n) for row in rows]


async def _records_not_found(db: AsyncSession, project_id: UUID) -> int:
    """Distinct PMIDs of the project's PubMed imports that never found an article.

    Status-based: deleting an article later does not turn its PMID into one.
    """
    pmid = ArticleSyncEvent.event_payload["pmid"].astext
    per_pmid = (
        select(pmid.label("pmid"))
        .select_from(ArticleSyncEvent)
        .join(ArticleSyncRun, ArticleSyncRun.id == ArticleSyncEvent.sync_run_id)
        .where(
            ArticleSyncRun.project_id == project_id,
            ArticleSyncRun.source == PUBMED,
            pmid.is_not(None),
        )
        .group_by(pmid)
        .having(func.bool_and(ArticleSyncEvent.status.not_in(_FOUND_STATUSES)))
        .subquery()
    )
    return int((await db.execute(select(func.count()).select_from(per_pmid))).scalar_one())


async def _reports_fields(
    db: AsyncSession,
    project_id: UUID,
    project_settings: Mapping[str, Any] | None,
    ta_reviewer_count: int | None,
) -> dict[str, Any]:
    """The ``reports_*`` payload fields and the in-progress flag; all ``None`` with full text off."""
    ft_reviewer_count = reviewer_count_of(project_settings, FULL_TEXT)
    if ft_reviewer_count is None:
        return {
            "reports_not_retrieved": None,
            "reports_assessed": None,
            "reports_excluded_by_reason": None,
            "reports_included": None,
            "full_text_in_progress": None,
        }
    snapshots = await assignment_states(
        db, project_id=project_id, phase=FULL_TEXT, reviewer_count=ft_reviewer_count
    )
    box = reports_box([snapshot.state for snapshot in snapshots.values()])
    ready = await full_text_candidates(
        db, project_id=project_id, ta_reviewer_count=ta_reviewer_count
    )
    return {
        "reports_not_retrieved": box.not_retrieved,
        "reports_assessed": box.assessed,
        "reports_excluded_by_reason": _reason_counts(box.excluded_by_reason),
        "reports_included": box.included,
        "full_text_in_progress": box.without_outcome > 0 or len(ready) > 0,
    }


async def prisma_counts(db: AsyncSession, project_id: UUID) -> PrismaCountsRead:
    """The project's PRISMA identification and screening counts.

    Invariant: every enrolled article is counted at least once under
    ``identified``, so ``duplicates_removed`` (identified minus enrolled) is
    never negative; it is not clamped, so a break of the invariant shows.
    """
    screening = ScreeningRepository(db)
    enrolled = await screening.count_enrolled(project_id=project_id, phase=TITLE_ABSTRACT)
    total_articles = await screening.count_project_articles(project_id=project_id)

    identified = await _other_sources(db, project_id)
    pubmed = await _pubmed_identified(db, project_id)
    if pubmed:
        identified.insert(0, PrismaSourceCount(source=PUBMED, count=pubmed))
    identified_total = sum(item.count for item in identified)

    project = await ProjectRepository(db).get_by_id(project_id)
    project_settings = project.settings if project else None
    ta_reviewer_count = reviewer_count_of(project_settings, TITLE_ABSTRACT)
    snapshots = await assignment_states(
        db, project_id=project_id, phase=TITLE_ABSTRACT, reviewer_count=ta_reviewer_count
    )
    ta_states = [snapshot.state for snapshot in snapshots.values()]
    box = screening_box(ta_states)
    ta_decisions = Counter(state.outcome.decision for state in ta_states if state.outcome)
    reports = await _reports_fields(db, project_id, project_settings, ta_reviewer_count)

    return PrismaCountsRead(
        identified=identified,
        identified_total=identified_total,
        duplicates_removed=identified_total - enrolled,
        records_not_found=await _records_not_found(db, project_id),
        imported_not_enrolled=total_articles - enrolled,
        screened=box.screened,
        excluded=box.excluded,
        excluded_by_reason=_reason_counts(box.excluded_by_reason),
        excluded_reasons_differ=box.excluded_reasons_differ,
        excluded_without_reason=box.excluded_without_reason,
        sought_for_retrieval=box.sought_for_retrieval,
        ta_included=ta_decisions["include"],
        ta_maybe=ta_decisions["maybe"],
        **reports,
    )
