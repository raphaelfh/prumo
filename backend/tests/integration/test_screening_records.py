"""The blind-safe title/abstract records read over HTTP, on real Postgres."""

from __future__ import annotations

import hashlib
from collections import Counter
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from httpx import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article import ArticleFile
from app.models.screening import FULL_TEXT
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    add_ruling,
    enroll_articles,
    make_screening_article,
    move_article,
    set_reviewer_count,
)
from tests.integration.helpers.shared_fixtures import make_project

MANAGER = SEED.primary_profile
JAN_1 = datetime(2026, 1, 1, tzinfo=UTC)
JAN_2 = datetime(2026, 1, 2, tzinfo=UTC)
_ELIGIBILITY = '{"inclusion": ["Adults"], "exclusion": ["Wrong population", "Not ML"]}'

_WIRE_FIELDS = {
    "article_id",
    "assignment_id",
    "queue_rank",
    "title",
    "first_author",
    "publication_year",
    "journal_title",
    "pmid",
    "doi",
    "ingestion_source",
    "has_pdf",
    "status",
    "my_decision",
    "my_exclusion_reason",
    "outcome",
    "outcome_exclusion_reason",
    "outcome_kind",
    "ta_outcome",
    "ta_outcome_kind",
    "ta_reviewer_count",
}


def _path(project_id: UUID, query: str = "?phase=title_abstract") -> str:
    return f"/api/v1/projects/{project_id}/screening/records{query}"


async def _get(db: AsyncSession, user: UUID, path: str) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.get(path)
    finally:
        app.dependency_overrides.clear()


async def _records(db: AsyncSession, user: UUID, project_id: UUID) -> dict[str, Any]:
    response = await _get(db, user, _path(project_id))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _by_article(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["article_id"]: row for row in data["rows"]}


async def _set_eligibility(db: AsyncSession, project_id: UUID, eligibility: str) -> None:
    await db.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": eligibility, "p": str(project_id)},
    )


def _md5_order(ids: list[UUID]) -> list[str]:
    return [str(i) for i in sorted(ids, key=lambda i: hashlib.md5(str(i).encode()).hexdigest())]


async def test_records_role_matrix(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    await _set_eligibility(db, project_id, _ELIGIBILITY)
    a, b, c = [await add_member(db, project_id, "reviewer") for _ in range(3)]
    k, k2 = [await add_member(db, project_id, "consensus") for _ in range(2)]
    v = await add_member(db, project_id, "viewer")
    await set_reviewer_count(db, project_id, 2)
    x, x2, y, w, z = [await make_screening_article(db, project_id) for _ in range(5)]
    ax, ax2, ay, aw = await enroll_articles(db, project_id, [x, x2, y, w], by=MANAGER)
    await add_decision(db, ax, a, "include")
    await add_decision(db, ax, b, "exclude", reason="Not ML")
    await add_decision(db, ax2, k2, "include")
    await add_decision(db, ax2, a, "exclude", reason="Not ML")
    await add_decision(db, ay, a, "include")
    await add_decision(db, aw, a, "include")
    await add_decision(db, aw, b, "include")

    expected = {
        a: ("waiting", "waiting", "waiting"),
        c: ("in_review", "in_review", "to_screen"),
        k: ("conflict", "conflict", "to_screen"),
        k2: ("conflict", "waiting", "to_screen"),
        MANAGER: ("conflict", "conflict", "to_screen"),
        v: ("in_review", "in_review", "in_review"),
    }
    member_ids = {str(m) for m in (a, b, c, k, k2, v)}
    for caller, (sx, sx2, sy) in expected.items():
        response = await _get(db, caller, _path(project_id))
        assert response.status_code == 200, response.text
        assert not any(m in response.text for m in member_ids - {str(caller)})
        assert "Screening Test User" not in response.text
        rows = _by_article(response.json()["data"])
        assert [rows[str(i)]["status"] for i in (x, x2, y, w, z)] == [
            sx,
            sx2,
            sy,
            "included",
            "not_enrolled",
        ], caller
        assert all(set(row) == _WIRE_FIELDS for row in rows.values())
        assert (rows[str(w)]["outcome"], rows[str(w)]["outcome_kind"]) == ("include", "consensus")
        assert rows[str(x)]["outcome"] is None
        assert rows[str(x)]["outcome_kind"] is None

    mine = _by_article(await _records(db, a, project_id))[str(x)]
    assert mine["my_decision"] == "include"
    assert mine["my_exclusion_reason"] is None
    assert _by_article(await _records(db, c, project_id))[str(x)]["my_decision"] is None


async def test_records_counts_and_anti_join(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = [await add_member(db, project_id, "reviewer") for _ in range(3)]
    await set_reviewer_count(db, project_id, 2)
    enrolled = [await make_screening_article(db, project_id) for _ in range(7)]
    r1, r2, r3, r4, r5, r6, r7 = await enroll_articles(db, project_id, enrolled, by=MANAGER)
    not_enrolled = {str(await make_screening_article(db, project_id)) for _ in range(2)}
    await add_decision(db, r3, a, "include")
    await add_decision(db, r4, b, "include")
    await add_decision(db, r4, c, "exclude", reason="Not ML")
    await add_decision(db, r5, b, "include")
    await add_decision(db, r5, c, "include")
    await add_decision(db, r6, b, "exclude", reason="Not ML")
    await add_decision(db, r6, c, "exclude", reason="Not ML")
    await add_decision(db, r7, b, "maybe")
    await add_decision(db, r7, c, "maybe")

    rows = (await _records(db, a, project_id))["rows"]

    assert Counter(row["status"] for row in rows) == {
        "to_screen": 2,
        "waiting": 1,
        "in_review": 1,
        "included": 1,
        "excluded": 1,
        "maybe": 1,
        "not_enrolled": 2,
    }
    assert {row["article_id"] for row in rows[7:]} == not_enrolled
    assert all(row["assignment_id"] is None for row in rows[7:])
    assert all(row["assignment_id"] is not None for row in rows[:7])
    assert [row["queue_rank"] for row in rows] == list(range(9))
    excluded = next(row for row in rows if row["status"] == "excluded")
    assert (excluded["outcome"], excluded["outcome_exclusion_reason"]) == ("exclude", "Not ML")


async def test_records_follow_queue_order(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    await set_reviewer_count(db, project_id, 1)
    first = [await make_screening_article(db, project_id) for _ in range(3)]
    second = [await make_screening_article(db, project_id) for _ in range(2)]
    second_ids = await enroll_articles(db, project_id, second, by=MANAGER, enrolled_at=JAN_2)
    first_ids = await enroll_articles(db, project_id, first, by=MANAGER, enrolled_at=JAN_1)

    rows = (await _records(db, MANAGER, project_id))["rows"]

    assert [row["assignment_id"] for row in rows] == _md5_order(first_ids) + _md5_order(second_ids)


async def test_records_carry_the_bibliographic_fields(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    await set_reviewer_count(db, project_id, 1)
    article = await make_screening_article(
        db,
        project_id,
        title="Deep learning for sepsis",
        authors=["Ada Lovelace", "Alan Turing"],
        publication_year=2024,
        journal_title="Lancet",
        pmid="123",
        doi="10.1/x",
        ingestion_source="RIS",
    )

    (row,) = (await _records(db, MANAGER, project_id))["rows"]

    assert row["article_id"] == str(article)
    assert (row["title"], row["first_author"], row["publication_year"]) == (
        "Deep learning for sepsis",
        "Ada Lovelace",
        2024,
    )
    assert (row["journal_title"], row["pmid"], row["doi"], row["ingestion_source"]) == (
        "Lancet",
        "123",
        "10.1/x",
        "RIS",
    )


async def test_records_unconfigured_is_409(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)

    response = await _get(db_session, MANAGER, _path(project_id))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SCREENING_NOT_CONFIGURED"


async def test_records_phase_is_required_and_closed(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await set_reviewer_count(db_session, project_id, 1)

    assert (await _get(db_session, MANAGER, _path(project_id, ""))).status_code == 422
    assert (await _get(db_session, MANAGER, _path(project_id, "?phase=other"))).status_code == 422
    off = await _get(db_session, MANAGER, _path(project_id, "?phase=full_text"))
    assert off.status_code == 409
    assert off.json()["error"]["code"] == "SCREENING_NOT_CONFIGURED"

    await set_reviewer_count(db_session, project_id, 2, key="full_text_reviewer_count")
    on = await _get(db_session, MANAGER, _path(project_id, "?phase=full_text"))
    assert on.status_code == 200
    assert on.json()["data"]["phase"] == "full_text"
    assert on.json()["data"]["reviewer_count"] == 2


async def test_records_non_member_is_403(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await set_reviewer_count(db_session, project_id, 1)
    outsider = await add_member(db_session, await make_project(db_session), "reviewer")

    assert (await _get(db_session, outsider, _path(project_id))).status_code == 403


async def test_has_pdf_only_with_a_main_file(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    await set_reviewer_count(db, project_id, 1)
    bare, supplement, main = [await make_screening_article(db, project_id) for _ in range(3)]
    for article_id, role in ((supplement, "SUPPLEMENT"), (main, "MAIN")):
        db.add(
            ArticleFile(
                project_id=project_id,
                article_id=article_id,
                file_type="pdf",
                storage_key=f"{project_id}/{article_id}.pdf",
                file_role=role,
            )
        )
    await db.flush()

    rows = _by_article(await _records(db, MANAGER, project_id))

    assert [rows[str(i)]["has_pdf"] for i in (bare, supplement, main)] == [False, False, True]


async def test_moved_article_drops_out(db_session: AsyncSession) -> None:
    db = db_session
    old, new = await make_project(db), await make_project(db)
    for project_id in (old, new):
        await set_reviewer_count(db, project_id, 1)
    moved, stays = [await make_screening_article(db, old) for _ in range(2)]
    await enroll_articles(db, old, [moved, stays], by=MANAGER)
    await move_article(db, moved, new)

    old_rows = _by_article(await _records(db, MANAGER, old))
    (new_row,) = (await _records(db, MANAGER, new))["rows"]

    assert set(old_rows) == {str(stays)}
    assert new_row["article_id"] == str(moved)
    assert new_row["status"] == "not_enrolled"
    assert new_row["assignment_id"] is None


async def test_records_carry_the_protocol_criteria(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await _set_eligibility(db_session, project_id, _ELIGIBILITY)
    await set_reviewer_count(db_session, project_id, 2)

    data = await _records(db_session, MANAGER, project_id)

    assert data["inclusion_criteria"] == ["Adults"]
    assert data["exclusion_reasons"] == ["Wrong population", "Not ML"]
    assert data["reviewer_count"] == 2
    assert data["phase"] == "title_abstract"
    assert data["rows"] == []


_FT = "?phase=full_text"


async def _ft_records(db: AsyncSession, user: UUID, project_id: UUID) -> dict[str, Any]:
    response = await _get(db, user, _path(project_id, _FT))
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _ft_project(db: AsyncSession, *, ta: int = 2, ft: int = 2) -> UUID:
    project_id = await make_project(db)
    await _set_eligibility(db, project_id, _ELIGIBILITY)
    await set_reviewer_count(db, project_id, ta)
    await set_reviewer_count(db, project_id, ft, key="full_text_reviewer_count")
    return project_id


async def _ft_enroll(db: AsyncSession, project_id: UUID, articles: list[UUID]) -> list[UUID]:
    """Full-text assignments in input order (explicit, distinct enrolment times)."""
    return [
        (
            await enroll_articles(
                db,
                project_id,
                [article],
                by=MANAGER,
                phase=FULL_TEXT,
                enrolled_at=datetime(2026, 1, 1 + n, tzinfo=UTC),
            )
        )[0]
        for n, article in enumerate(articles)
    ]


async def test_full_text_records_role_matrix(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await _ft_project(db)
    a, b, c = [await add_member(db, project_id, "reviewer") for _ in range(3)]
    k = await add_member(db, project_id, "consensus")
    v = await add_member(db, project_id, "viewer")
    articles = [await make_screening_article(db, project_id) for _ in range(4)]
    f1, f2, f3, _ = await _ft_enroll(db, project_id, articles)
    await add_decision(db, f1, a, "exclude", reason="Wrong population")
    await add_decision(db, f1, b, "exclude", reason="Wrong outcome")
    await add_decision(db, f2, a, "include")
    await add_decision(db, f3, a, "not_retrieved")
    await add_decision(db, f3, b, "not_retrieved")

    expected = {
        a: ["waiting", "waiting", "not_retrieved", "to_screen"],
        c: ["in_review", "to_screen", "not_retrieved", "to_screen"],
        k: ["conflict", "to_screen", "not_retrieved", "to_screen"],
        MANAGER: ["conflict", "to_screen", "not_retrieved", "to_screen"],
        v: ["in_review", "in_review", "not_retrieved", "in_review"],
    }
    for caller, statuses in expected.items():
        response = await _get(db, caller, _path(project_id, _FT))
        assert response.status_code == 200, response.text
        if caller in (a, c):
            assert "Wrong outcome" not in response.text, caller
        rows = _by_article(response.json()["data"])
        assert [rows[str(i)]["status"] for i in articles] == statuses, caller
        assert all(set(row) == _WIRE_FIELDS for row in rows.values())

    rows_a = _by_article(await _ft_records(db, a, project_id))
    assert rows_a[str(articles[0])]["my_exclusion_reason"] == "Wrong population"
    assert rows_a[str(articles[0])]["outcome_exclusion_reason"] is None
    assert rows_a[str(articles[2])]["outcome"] == "not_retrieved"


async def test_full_text_rows_are_full_text_assignments_only(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await _ft_project(db)
    sent, ta_only, bare = [await make_screening_article(db, project_id) for _ in range(3)]
    await enroll_articles(db, project_id, [sent, ta_only], by=MANAGER)
    later, earlier = [await make_screening_article(db, project_id) for _ in range(2)]
    await _ft_enroll(db, project_id, [later, earlier, sent])

    rows = (await _ft_records(db, MANAGER, project_id))["rows"]

    assert [r["article_id"] for r in rows] == [str(later), str(earlier), str(sent)]
    assert [r["queue_rank"] for r in rows] == [0, 1, 2]
    assert {str(ta_only), str(bare)}.isdisjoint(r["article_id"] for r in rows)


async def test_full_text_rows_carry_the_title_abstract_outcome(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await _ft_project(db)
    a, b = [await add_member(db, project_id, "reviewer") for _ in range(2)]
    k = await add_member(db, project_id, "consensus")
    agreed, split, pending = [await make_screening_article(db, project_id) for _ in range(3)]
    ta_agreed, ta_split, ta_pending = await enroll_articles(
        db, project_id, [agreed, split, pending], by=MANAGER
    )
    await add_decision(db, ta_agreed, a, "include")
    await add_decision(db, ta_agreed, b, "include")
    await add_decision(db, ta_split, a, "include")
    await add_decision(db, ta_split, b, "exclude", reason="Not ML")
    await add_ruling(db, ta_split, k, "maybe")
    await _ft_enroll(db, project_id, [agreed, split, pending])

    rows = _by_article(await _ft_records(db, MANAGER, project_id))

    assert [
        (r["ta_outcome"], r["ta_outcome_kind"], r["ta_reviewer_count"])
        for r in (rows[str(i)] for i in (agreed, split, pending))
    ] == [("include", "consensus", 2), ("maybe", "arbitrated", 2), (None, None, 2)]


async def test_title_abstract_rows_have_no_ta_fields(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await _ft_project(db)
    a = await add_member(db, project_id, "reviewer")
    article = await make_screening_article(db, project_id)
    (ta,) = await enroll_articles(db, project_id, [article], by=MANAGER)
    await add_decision(db, ta, a, "include")

    (row,) = (await _records(db, MANAGER, project_id))["rows"]

    assert (row["ta_outcome"], row["ta_outcome_kind"], row["ta_reviewer_count"]) == (
        None,
        None,
        None,
    )


async def test_full_text_has_pdf(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await _ft_project(db)
    bare, main = [await make_screening_article(db, project_id) for _ in range(2)]
    db.add(
        ArticleFile(
            project_id=project_id,
            article_id=main,
            file_type="pdf",
            storage_key=f"{project_id}/{main}.pdf",
            file_role="MAIN",
        )
    )
    await db.flush()
    await _ft_enroll(db, project_id, [bare, main])

    rows = _by_article(await _ft_records(db, MANAGER, project_id))

    assert [rows[str(i)]["has_pdf"] for i in (bare, main)] == [False, True]
