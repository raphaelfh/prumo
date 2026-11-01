"""PRISMA identification and screening counts, computed on read from real rows.

Imports run through ``PubmedImportService`` over ``fixture_client`` (the
three-record fixture, whatever ids were asked for), so the sync events the
counts read are the ones the importer really writes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from httpx import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article_author import ArticleSyncEvent
from app.models.article_duplicate import ArticleDuplicateVerdict
from app.repositories.article_repository import ArticleSyncRunRepository
from app.schemas.prisma import PrismaCountsRead
from app.services.prisma_service import prisma_counts
from app.services.pubmed_import_service import PubmedImportService
from app.services.screening_config_service import ScreeningConfigService
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    enroll_articles,
    make_screening_article,
    move_article,
    set_reviewer_count,
)
from tests.integration.helpers.shared_fixtures import fixture_client, make_project

MANAGER = SEED.primary_profile
FOUND = ["42908551", "42875467", "42706533"]


async def _import(db: AsyncSession, project_id: UUID, pmids: list[str]) -> None:
    run = await ArticleSyncRunRepository(db).create_run(
        project_id=project_id,
        requested_by_user_id=MANAGER,
        source="pubmed",
        source_collection_key=None,
    )
    await PubmedImportService(db).run_import(
        project_id=project_id, sync_run_id=run.id, pmids=pmids, client=fixture_client()
    )


async def _enroll_all(db: AsyncSession, project_id: UUID) -> None:
    await ScreeningConfigService(db).enroll(project_id, MANAGER, None)


def _identified(counts: PrismaCountsRead) -> list[dict[str, Any]]:
    return [item.model_dump() for item in counts.identified]


async def _get_prisma(db: AsyncSession, user: UUID, project_id: UUID) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.get(f"/api/v1/projects/{project_id}/prisma")
    finally:
        app.dependency_overrides.clear()


async def test_pubmed_only_import_identified_equals_screened(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await _import(db_session, project_id, FOUND)
    await _enroll_all(db_session, project_id)

    counts = await prisma_counts(db_session, project_id)

    assert _identified(counts) == [{"source": "pubmed", "count": 3}]
    assert counts.identified_total == 3
    assert counts.duplicates_removed == 0
    assert counts.screened == 3
    assert counts.not_retrieved == 0
    assert counts.other_removed == 0


async def test_pubmed_matching_a_ris_article_counts_one_duplicate(
    db_session: AsyncSession,
) -> None:
    project_id = await make_project(db_session)
    await make_screening_article(
        db_session,
        project_id,
        doi="https://doi.org/10.3389/FENDO.2026.1959304",
        ingestion_source="RIS",
    )
    await _import(db_session, project_id, ["42908551"])
    await _enroll_all(db_session, project_id)

    counts = await prisma_counts(db_session, project_id)

    assert _identified(counts) == [
        {"source": "pubmed", "count": 1},
        {"source": "ris", "count": 1},
    ]
    assert counts.identified_total == 2
    assert counts.duplicates_removed == 1
    assert counts.screened == 1


async def test_unchanged_pubmed_record_counts_like_a_resolved_one(
    db_session: AsyncSession,
) -> None:
    project_id = await make_project(db_session)
    await make_screening_article(
        db_session,
        project_id,
        pmid="42706533",
        ingestion_source="RIS",
        abstract="A",
        mesh_terms=["M"],
        pmcid="PMC1",
        keywords=["k"],
        article_type="Letter",
        language="eng",
        volume="1",
        issue="2",
        pages="3",
    )
    await _import(db_session, project_id, ["42706533"])  # complete: recorded unchanged
    await _enroll_all(db_session, project_id)

    counts = await prisma_counts(db_session, project_id)

    assert _identified(counts) == [
        {"source": "pubmed", "count": 1},
        {"source": "ris", "count": 1},
    ]
    assert counts.duplicates_removed == 1
    assert counts.not_retrieved == 0


async def test_reimporting_the_same_file_changes_nothing(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await _import(db_session, project_id, FOUND)
    await _enroll_all(db_session, project_id)
    first = await prisma_counts(db_session, project_id)

    await _import(db_session, project_id, FOUND)
    await _enroll_all(db_session, project_id)

    assert await prisma_counts(db_session, project_id) == first


async def test_not_found_pmids_are_not_duplicates(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await _import(db_session, project_id, ["42908551", "49999999", "49999999"])
    await _enroll_all(db_session, project_id)

    counts = await prisma_counts(db_session, project_id)

    assert counts.not_retrieved == 1
    assert counts.duplicates_removed == 0
    assert counts.identified_total == 1


async def test_imported_but_not_enrolled_is_identified_and_removed_for_other_reasons(
    db_session: AsyncSession,
) -> None:
    project_id = await make_project(db_session)
    await _import(db_session, project_id, FOUND)
    first = (
        await db_session.execute(
            text("SELECT id FROM public.articles WHERE project_id = :p ORDER BY id LIMIT 1"),
            {"p": str(project_id)},
        )
    ).scalar_one()
    await ScreeningConfigService(db_session).enroll(project_id, MANAGER, [first])

    counts = await prisma_counts(db_session, project_id)

    assert counts.identified_total == 3
    assert counts.duplicates_removed == 0
    assert counts.other_removed == 2
    assert counts.screened == 1


async def test_deleted_article_is_not_counted_as_not_retrieved(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await _import(db_session, project_id, FOUND)
    await db_session.execute(
        text(
            "DELETE FROM public.articles WHERE id = "
            "(SELECT id FROM public.articles WHERE project_id = :p LIMIT 1)"
        ),
        {"p": str(project_id)},
    )

    counts = await prisma_counts(db_session, project_id)

    assert counts.not_retrieved == 0


async def test_moved_article_is_not_counted(db_session: AsyncSession) -> None:
    p = await make_project(db_session)
    q = await make_project(db_session)
    kept = await make_screening_article(db_session, p)
    moved = await make_screening_article(db_session, p)
    await enroll_articles(db_session, p, [kept, moved], by=MANAGER)
    await set_reviewer_count(db_session, p, 1)
    await move_article(db_session, moved, to_project=q)

    in_p = await prisma_counts(db_session, p)
    in_q = await prisma_counts(db_session, q)

    assert (in_p.identified_total, in_p.screened, in_p.other_removed) == (1, 1, 0)
    assert (in_q.identified_total, in_q.screened, in_q.other_removed) == (1, 0, 1)


async def test_screening_box_from_rows(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    a = await add_member(db_session, project_id, "reviewer")
    b = await add_member(db_session, project_id, "reviewer")
    articles = [await make_screening_article(db_session, project_id) for _ in range(4)]
    included, excluded, conflict, pending = await enroll_articles(
        db_session, project_id, articles, by=MANAGER
    )
    await set_reviewer_count(db_session, project_id, 2)
    for reviewer in (a, b):
        await add_decision(db_session, included, reviewer, "include")
        await add_decision(db_session, excluded, reviewer, "exclude", reason="Not ML")
    await add_decision(db_session, conflict, a, "include")
    await add_decision(db_session, conflict, b, "exclude", reason="Not ML")
    await add_decision(db_session, pending, a, "include")

    counts = await prisma_counts(db_session, project_id)

    assert _identified(counts) == [{"source": "manual", "count": 4}]
    assert counts.screened == 4
    assert counts.sought_for_retrieval == 1
    assert counts.excluded == 1
    assert [r.model_dump() for r in counts.excluded_by_reason] == [{"reason": "Not ML", "count": 1}]
    assert counts.excluded_reasons_differ == 0
    assert counts.excluded_without_reason == 0


async def test_reviewer_prisma_is_blind_to_a_peer_decision(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": '{"exclusion": ["Not ML"]}', "p": str(project_id)},
    )
    a = await add_member(db_session, project_id, "reviewer")
    b = await add_member(db_session, project_id, "reviewer")
    articles = [await make_screening_article(db_session, project_id) for _ in range(2)]
    x, _y = await enroll_articles(db_session, project_id, articles, by=MANAGER)
    await set_reviewer_count(db_session, project_id, 2)

    async def decide(user: UUID, decision: str, reason: str | None = None) -> None:
        body: dict[str, Any] = {"decision": decision}
        if reason is not None:
            body["exclusion_reason"] = reason
        try:
            async with client_as(str(user), db_session) as client:
                response = await client.post(
                    f"/api/v1/screening/assignments/{x}/decisions", json=body
                )
        finally:
            app.dependency_overrides.clear()
        assert response.status_code == 200

    await decide(a, "include")
    snap1 = (await _get_prisma(db_session, a, project_id)).json()["data"]

    await decide(b, "exclude", "Not ML")  # X is now in conflict
    snap2 = (await _get_prisma(db_session, a, project_id)).json()["data"]

    assert snap1["screened"] == 2
    assert snap1 == snap2


async def test_prisma_route_guard(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await make_screening_article(db_session, project_id)
    outsider = await add_member(db_session, await make_project(db_session), "reviewer")

    member = await _get_prisma(db_session, MANAGER, project_id)
    refused = await _get_prisma(db_session, outsider, project_id)

    assert member.status_code == 200
    assert member.json()["data"]["other_removed"] == 1
    assert refused.status_code == 403


async def _pubmed_event(
    db: AsyncSession, project_id: UUID, article_id: UUID, pmid: str, status: str
) -> None:
    """One PubMed sync event linking ``pmid`` to ``article_id``, as the importer writes it."""
    run = await ArticleSyncRunRepository(db).create_run(
        project_id=project_id,
        requested_by_user_id=MANAGER,
        source="pubmed",
        source_collection_key=None,
    )
    db.add(
        ArticleSyncEvent(
            project_id=project_id,
            sync_run_id=run.id,
            article_id=article_id,
            status=status,
            event_payload={"pmid": pmid},
            processed_at=datetime.now(UTC),
        )
    )
    await db.flush()


async def test_cross_source_a_pubmed_match_of_a_ris_article(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    ris = await make_screening_article(db_session, project_id, pmid="11", ingestion_source="RIS")
    await _pubmed_event(db_session, project_id, ris, "11", "updated")

    counts = await prisma_counts(db_session, project_id)

    assert _identified(counts) == [
        {"source": "pubmed", "count": 1},
        {"source": "ris", "count": 1},
    ]
    assert counts.identified_total == 2
    assert counts.duplicates_removed == 1


async def test_cross_source_b_two_articles_same_pmid(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    ris = await make_screening_article(db_session, project_id, pmid="22", ingestion_source="RIS")
    pubmed = await make_screening_article(
        db_session, project_id, pmid="22", ingestion_source="PUBMED"
    )
    await _pubmed_event(db_session, project_id, pubmed, "22", "inserted")

    before = await prisma_counts(db_session, project_id)
    db_session.add(
        ArticleDuplicateVerdict(
            project_id=project_id,
            article_id=ris,
            kept_article_id=pubmed,
            verdict="duplicate",
            basis="pmid",
            decided_by=MANAGER,
        )
    )
    await db_session.flush()
    after = await prisma_counts(db_session, project_id)

    assert (before.identified_total, before.duplicates_removed) == (2, 0)
    assert (after.identified_total, after.duplicates_removed, after.other_removed) == (2, 1, 1)


async def test_cross_source_c_pubmed_article_without_event(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await make_screening_article(db_session, project_id, pmid="33", ingestion_source="PubMed")

    counts = await prisma_counts(db_session, project_id)

    assert _identified(counts) == [{"source": "pubmed", "count": 1}]
    assert counts.duplicates_removed == 0
    assert counts.other_removed == 1
