"""The duplicates read over HTTP and the removal predicate, on real Postgres."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from httpx import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article import Article, ArticleFile
from app.models.article_duplicate import ArticleDuplicateVerdict
from app.repositories.duplicate_predicates import removed_duplicate
from app.repositories.duplicate_repository import refusing_work
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as, run_in_extract_at
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    enroll_articles,
    make_screening_article,
    move_article,
)
from tests.integration.helpers.shared_fixtures import make_project

JAN_1 = datetime(2026, 1, 1, tzinfo=UTC)
JAN_2 = datetime(2026, 1, 2, tzinfo=UTC)
JAN_3 = datetime(2026, 1, 3, tzinfo=UTC)
LONG_TITLE = "Machine learning for sepsis prediction in adults"


def _path(project_id: UUID) -> str:
    return f"/api/v1/projects/{project_id}/duplicates"


async def _get(db: AsyncSession, user: UUID, project_id: UUID) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.get(_path(project_id))
    finally:
        app.dependency_overrides.clear()


async def _read(db: AsyncSession, user: UUID, project_id: UUID) -> dict[str, Any]:
    response = await _get(db, user, project_id)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _pairs(pairs: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(p["article_id"], p["kept_article_id"]) for p in pairs]


async def _verdict(
    db: AsyncSession,
    project_id: UUID,
    article_id: UUID,
    kept_article_id: UUID,
    verdict: str,
    *,
    by: UUID,
    basis: str = "pmid",
    created_at: datetime | None = None,
) -> None:
    db.add(
        ArticleDuplicateVerdict(
            project_id=project_id,
            article_id=article_id,
            kept_article_id=kept_article_id,
            verdict=verdict,
            basis=basis,
            decided_by=by,
            **({} if created_at is None else {"created_at": created_at}),
        )
    )
    await db.flush()


async def _is_removed(db: AsyncSession, article_id: UUID) -> bool:
    stmt = select(removed_duplicate(Article)).where(Article.id == article_id)
    return bool((await db.execute(stmt)).scalar_one())


async def _start_extraction(db: AsyncSession, project_id: UUID, article_id: UUID) -> None:
    template_id = await TemplateFactory(db, project_id, SEED.primary_profile).create()
    await run_in_extract_at(
        db, project_id=project_id, article_id=article_id, template_id=template_id
    )


async def _triple(db: AsyncSession, project_id: UUID) -> tuple[UUID, UUID, UUID]:
    """A, B, C with one PMID, created in that order (A ranks first, then B)."""
    return (
        await make_screening_article(db, project_id, title="A", pmid="77", created_at=JAN_1),
        await make_screening_article(db, project_id, title="B", pmid="77", created_at=JAN_2),
        await make_screening_article(db, project_id, title="C", pmid="77", created_at=JAN_3),
    )


async def test_non_manager_is_403(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    reviewer = await add_member(db, project_id, "reviewer")
    viewer = await add_member(db, project_id, "viewer")
    outsider = await add_member(db, await make_project(db), "manager")

    for caller in (reviewer, viewer, outsider):
        assert (await _get(db, caller, project_id)).status_code == 403
    assert (await _get(db, SEED.primary_profile, project_id)).status_code == 200


async def test_each_tier_is_listed(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    reviewer_a = await add_member(db, project_id, "reviewer")
    reviewer_b = await add_member(db, project_id, "reviewer")
    screened = await make_screening_article(
        db,
        project_id,
        title="Exact one",
        pmid="1001",
        abstract="Abstract",
        authors=["Ada", "Bob"],
        created_at=JAN_2,
    )
    worked = await make_screening_article(db, project_id, title="Exact two", pmid="1001")
    likely_a = await make_screening_article(
        db, project_id, title=LONG_TITLE, publication_year=2020, created_at=JAN_1
    )
    likely_b = await make_screening_article(
        db, project_id, title=LONG_TITLE.upper(), publication_year=2020, created_at=JAN_2
    )
    possible_a = await make_screening_article(
        db, project_id, title="Possible alpha", doi="10.5/p", created_at=JAN_1
    )
    possible_b = await make_screening_article(
        db, project_id, title="Possible beta", doi="https://doi.org/10.5/P", created_at=JAN_2
    )
    for article_id, role in ((screened, "MAIN"), (worked, "SUPPLEMENT")):
        db.add(
            ArticleFile(
                project_id=project_id,
                article_id=article_id,
                file_type="pdf",
                storage_key=f"{project_id}/{article_id}.pdf",
                file_role=role,
            )
        )
    (assignment,) = await enroll_articles(db, project_id, [screened], by=SEED.primary_profile)
    await add_decision(db, assignment, reviewer_a, "include")
    await add_decision(db, assignment, reviewer_b, "exclude", reason="Not ML")
    await add_decision(db, assignment, reviewer_b, "include")
    await _start_extraction(db, project_id, worked)

    data = await _read(db, SEED.primary_profile, project_id)

    assert [p["tier"] for p in data["open"]] == ["exact", "likely", "possible"]
    assert [p["match_label"] for p in data["open"]] == ["pmid", "title", "doi_only"]
    assert [p["basis"] for p in data["open"]] == ["pmid", "title", "doi"]
    assert _pairs(data["open"]) == [
        (str(worked), str(screened)),
        (str(likely_b), str(likely_a)),
        (str(possible_b), str(possible_a)),
    ]
    assert data["resolved"] == []
    exact = data["open"][0]
    assert exact["kept"] == {
        "article_id": str(screened),
        "title": "Exact one",
        "authors": ["Ada", "Bob"],
        "publication_year": None,
        "journal_title": None,
        "doi": None,
        "pmid": "1001",
        "ingestion_source": None,
        "has_pdf": True,
        "has_abstract": True,
        "screening_decisions": 2,
        "has_review_work": True,
        "has_refusing_work": False,
    }
    removed = exact["removed"]
    assert (
        removed["has_pdf"],
        removed["has_abstract"],
        removed["has_review_work"],
        removed["has_refusing_work"],
    ) == (False, False, True, True)
    assert removed["screening_decisions"] == 0
    assert removed["authors"] == []
    assert data["open"][2]["removed"]["doi"] == "https://doi.org/10.5/P"


async def test_vetoes(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)

    async def article(**fields: Any) -> UUID:
        fields.setdefault("title", LONG_TITLE)
        fields.setdefault("publication_year", 2021)
        return await make_screening_article(db, project_id, **fields)

    await article(doi="10.1/one")
    await article(doi="10.1/two")
    await article(article_type="Congress")
    await article(source_payload={"data": {"itemType": "conferencePaper"}})
    conf_pmid = await article(title="Congress abstract", pmid="55", article_type="Congress")
    journal_pmid = await article(title="Journal article", pmid="55", created_at=JAN_1)
    conf_doi = await article(title="Shared title of both", doi="10.9/c", article_type="CONF")
    journal_doi = await article(title="Shared title of both", doi="10.9/c", created_at=JAN_1)

    data = await _read(db, SEED.primary_profile, project_id)

    assert [(p["tier"], p["match_label"]) for p in data["open"]] == [
        ("exact", "pmid"),
        ("possible", "doi_title"),
    ]
    assert {frozenset(pair) for pair in _pairs(data["open"])} == {
        frozenset({str(conf_pmid), str(journal_pmid)}),
        frozenset({str(conf_doi), str(journal_doi)}),
    }


async def test_distinct_suppresses_and_cleared_reopens(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    boss = await add_member(db, project_id, "manager")
    a = await make_screening_article(db, project_id, pmid="9", created_at=JAN_1)
    b = await make_screening_article(db, project_id, pmid="9", created_at=JAN_2)
    await _verdict(db, project_id, b, a, "distinct", by=boss, created_at=JAN_2)

    data = await _read(db, SEED.primary_profile, project_id)

    assert data["open"] == []
    (resolved,) = data["resolved"]
    assert (resolved["article_id"], resolved["kept_article_id"]) == (str(b), str(a))
    assert resolved["verdict"] == "distinct"
    assert resolved["decided_by_name"] == "Screening Test User"
    assert resolved["created_at"].startswith("2026-01-02")
    assert (resolved["tier"], resolved["match_label"], resolved["basis"]) == (
        "exact",
        "pmid",
        "pmid",
    )

    await _verdict(db, project_id, a, b, "cleared", by=boss, created_at=JAN_3)
    data = await _read(db, SEED.primary_profile, project_id)

    assert _pairs(data["open"]) == [(str(b), str(a))]
    assert data["resolved"] == []


async def test_removed_record_never_pairs_again(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _triple(db, project_id)
    await _verdict(db, project_id, b, a, "duplicate", by=SEED.primary_profile)

    data = await _read(db, SEED.primary_profile, project_id)

    assert _pairs(data["open"]) == [(str(c), str(a))]
    assert _pairs(data["resolved"]) == [(str(b), str(a))]
    assert data["resolved"][0]["verdict"] == "duplicate"
    assert await _is_removed(db, b)
    assert not await _is_removed(db, a)


async def test_moved_article_is_ignored(db_session: AsyncSession) -> None:
    db = db_session
    project_id, other = await make_project(db), await make_project(db)
    a, b, c = await _triple(db, project_id)
    await _verdict(db, project_id, b, a, "duplicate", by=SEED.primary_profile)
    await move_article(db, b, other)
    db.expire_all()

    assert not await _is_removed(db, b)
    assert (await _read(db, SEED.primary_profile, other)) == {"open": [], "resolved": []}
    data = await _read(db, SEED.primary_profile, project_id)
    assert _pairs(data["open"]) == [(str(c), str(a))]
    assert data["resolved"] == []


async def test_kept_article_moved_revives_and_unlists(db_session: AsyncSession) -> None:
    db = db_session
    project_id, other = await make_project(db), await make_project(db)
    a = await make_screening_article(db, project_id, pmid="3", created_at=JAN_1)
    b = await make_screening_article(db, project_id, pmid="3", created_at=JAN_2)
    await _verdict(db, project_id, b, a, "duplicate", by=SEED.primary_profile)
    assert await _is_removed(db, b)

    await move_article(db, a, other)
    db.expire_all()

    assert not await _is_removed(db, b)
    data = await _read(db, SEED.primary_profile, project_id)
    assert data == {"open": [], "resolved": []}


async def test_later_duplicate_on_the_reversed_pair_wins(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a = await make_screening_article(db, project_id, pmid="4", created_at=JAN_1)
    b = await make_screening_article(db, project_id, pmid="4", created_at=JAN_2)
    await _verdict(db, project_id, b, a, "duplicate", by=SEED.primary_profile, created_at=JAN_1)
    await _verdict(db, project_id, a, b, "duplicate", by=SEED.primary_profile, created_at=JAN_2)

    assert await _is_removed(db, a)
    assert not await _is_removed(db, b)
    data = await _read(db, SEED.primary_profile, project_id)
    assert _pairs(data["resolved"]) == [(str(a), str(b))]


async def test_foreign_project_articles_never_pair(db_session: AsyncSession) -> None:
    db = db_session
    project_id, other = await make_project(db), await make_project(db)
    await make_screening_article(db, project_id, pmid="12")
    await make_screening_article(db, other, pmid="12")

    assert await _read(db, SEED.primary_profile, project_id) == {"open": [], "resolved": []}


async def test_refusing_work_is_extraction_bound_to_the_project(
    db_session: AsyncSession,
) -> None:
    db = db_session
    project_id, other = await make_project(db), await make_project(db)
    worked, screened, moved = [await make_screening_article(db, project_id) for _ in range(3)]
    (assignment,) = await enroll_articles(db, project_id, [screened], by=SEED.primary_profile)
    await add_decision(db, assignment, SEED.primary_profile, "include")
    await _start_extraction(db, project_id, worked)
    await _start_extraction(db, project_id, moved)
    await move_article(db, moved, other)

    stmt = select(Article.id).where(
        Article.id.in_([worked, screened, moved]), refusing_work(Article)
    )
    assert set((await db.execute(stmt)).scalars().all()) == {worked}
