"""POST /duplicates/verdicts over HTTP, on real Postgres (spec §8.3).

A refusal must leave no partial write. ``db_session`` keeps an endpoint's
flushed rows in its SAVEPOINT, so the rollback cases commit their setup first
and roll back after the request, as ``get_db`` closing the session does.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article import Article
from app.models.article_duplicate import ArticleDuplicateVerdict
from app.models.extraction_instance import ExtractionInstance
from app.models.screening import ScreeningAssignment, ScreeningDecision
from app.repositories.duplicate_predicates import removed_duplicate
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as, run_in_extract_at
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    enroll_articles,
    make_screening_article,
)
from tests.integration.helpers.shared_fixtures import make_project

MANAGER = SEED.primary_profile
JAN_1 = datetime(2026, 1, 1, tzinfo=UTC)
LONG_TITLE = "Machine learning for sepsis prediction in adults"


def _path(project_id: UUID) -> str:
    return f"/api/v1/projects/{project_id}/duplicates/verdicts"


def _item(article_id: UUID, kept_article_id: UUID, verdict: str) -> dict[str, str]:
    return {
        "article_id": str(article_id),
        "kept_article_id": str(kept_article_id),
        "verdict": verdict,
    }


async def _post(
    db: AsyncSession, project_id: UUID, items: list[dict[str, Any]], *, user: UUID = MANAGER
) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.post(_path(project_id), json={"items": items})
    finally:
        app.dependency_overrides.clear()


async def _write(db: AsyncSession, project_id: UUID, items: list[dict[str, Any]]) -> dict[str, int]:
    response = await _post(db, project_id, items)
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _rows(db: AsyncSession, project_id: UUID) -> list[ArticleDuplicateVerdict]:
    stmt = (
        select(ArticleDuplicateVerdict)
        .where(ArticleDuplicateVerdict.project_id == project_id)
        .order_by(ArticleDuplicateVerdict.created_at, ArticleDuplicateVerdict.id)
    )
    return list((await db.execute(stmt)).scalars())


async def _is_removed(db: AsyncSession, article_id: UUID) -> bool:
    stmt = select(removed_duplicate(Article)).where(Article.id == article_id)
    return bool((await db.execute(stmt)).scalar_one())


async def _pmid_triple(db: AsyncSession, project_id: UUID) -> tuple[UUID, UUID, UUID]:
    return (
        await make_screening_article(db, project_id, title="A", pmid="77"),
        await make_screening_article(db, project_id, title="B", pmid="77"),
        await make_screening_article(db, project_id, title="C", pmid="77"),
    )


async def _start_extraction(db: AsyncSession, project_id: UUID, article_id: UUID) -> None:
    template_id = await TemplateFactory(db, project_id, MANAGER).create()
    await run_in_extract_at(
        db, project_id=project_id, article_id=article_id, template_id=template_id
    )


async def _add_instance(db: AsyncSession, project_id: UUID, article_id: UUID) -> None:
    factory = TemplateFactory(db, project_id, MANAGER)
    template_id = await factory.create(name=f"t-{uuid4().hex[:8]}")
    entity_type_id = await factory.add_study_section(template_id, name="study")
    db.add(
        ExtractionInstance(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=entity_type_id,
            label="Study",
            created_by=MANAGER,
        )
    )
    await db.flush()


async def _assignment_of(db: AsyncSession, project_id: UUID, article_id: UUID) -> UUID | None:
    stmt = select(ScreeningAssignment.id).where(
        ScreeningAssignment.project_id == project_id, ScreeningAssignment.article_id == article_id
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def test_non_manager_is_403(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, _ = await _pmid_triple(db, project_id)
    reviewer = await add_member(db, project_id, "reviewer")
    outsider = await add_member(db, await make_project(db), "manager")

    for caller in (reviewer, outsider):
        response = await _post(db, project_id, [_item(b, a, "duplicate")], user=caller)
        assert response.status_code == 403
    assert await _rows(db, project_id) == []


async def test_batch_over_500_is_422(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    items = [_item(uuid4(), uuid4(), "distinct") for _ in range(501)]

    response = await _post(db_session, project_id, items)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_basis_field_is_refused_422(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, _ = await _pmid_triple(db, project_id)

    response = await _post(db, project_id, [{**_item(b, a, "duplicate"), "basis": "manual"}])

    assert response.status_code == 422
    assert await _rows(db, project_id) == []


async def test_same_article_on_both_sides_is_422(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, _, _ = await _pmid_triple(db, project_id)

    response = await _post(db, project_id, [_item(a, a, "distinct")])

    assert response.status_code == 422


@pytest.mark.parametrize("side", ["article_id", "kept_article_id"], ids=["removed", "kept"])
async def test_foreign_article_is_404(db_session: AsyncSession, side: str) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, _ = await _pmid_triple(db, project_id)
    foreign = await make_screening_article(db, await make_project(db), title="F", pmid="77")
    item = {**_item(b, a, "duplicate"), side: str(foreign)}

    response = await _post(db, project_id, [item])

    assert response.status_code == 404
    assert await _rows(db, project_id) == []


async def test_duplicate_records_the_recomputed_basis(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    pmid_a = await make_screening_article(db, project_id, title="One", pmid="5")
    pmid_b = await make_screening_article(db, project_id, title="Two", pmid="5")
    plain_a = await make_screening_article(db, project_id, title="Unrelated one")
    plain_b = await make_screening_article(db, project_id, title="Unrelated two")
    title_a = await make_screening_article(db, project_id, title=LONG_TITLE, publication_year=2020)
    title_b = await make_screening_article(
        db, project_id, title=LONG_TITLE.upper(), publication_year=2020
    )

    await _write(
        db,
        project_id,
        [
            _item(pmid_b, pmid_a, "duplicate"),
            _item(plain_b, plain_a, "duplicate"),
            _item(title_b, title_a, "duplicate"),
        ],
    )

    assert [(r.article_id, r.basis) for r in await _rows(db, project_id)] == [
        (pmid_b, "pmid"),
        (plain_b, "manual"),
        (title_b, "title"),
    ]


async def test_duplicate_on_already_removed_is_skipped(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)
    await _write(db, project_id, [_item(b, a, "duplicate")])

    result = await _write(db, project_id, [_item(b, c, "duplicate")])

    assert result == {"written": 0, "enrolled_kept": 0}
    rows = await _rows(db, project_id)
    assert [(r.article_id, r.kept_article_id, r.verdict) for r in rows] == [(b, a, "duplicate")]


async def test_chain_keeps_the_first_removed(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)

    await _write(db, project_id, [_item(b, a, "duplicate")])
    await _write(db, project_id, [_item(a, c, "duplicate")])
    assert (await _is_removed(db, a), await _is_removed(db, b)) == (True, True)

    await _write(db, project_id, [_item(a, c, "cleared")])
    assert (await _is_removed(db, a), await _is_removed(db, b)) == (False, True)


async def test_kept_is_removed_is_409(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)
    await _write(db, project_id, [_item(b, a, "duplicate")])

    response = await _post(db, project_id, [_item(c, b, "duplicate")])

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_KEPT_IS_REMOVED"


async def test_batch_with_kept_removed_earlier_rolls_back(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)
    await db.commit()

    response = await _post(db, project_id, [_item(b, a, "duplicate"), _item(c, b, "duplicate")])
    await db.rollback()

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_KEPT_IS_REMOVED"
    assert await _rows(db, project_id) == []


@pytest.mark.parametrize(
    "work", [_start_extraction, _add_instance], ids=["extraction_run", "extraction_instance"]
)
async def test_review_work_is_409_and_rolls_back(db_session: AsyncSession, work: Any) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)
    worked = await make_screening_article(db, project_id, title="W", pmid="77")
    await work(db, project_id, worked)
    await db.commit()

    response = await _post(
        db, project_id, [_item(b, a, "duplicate"), _item(worked, c, "duplicate")]
    )
    await db.rollback()

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_HAS_REVIEW_WORK"
    assert await _rows(db, project_id) == []


async def test_keep_the_other_enrolls_the_kept(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)
    r1 = await add_member(db, project_id, "reviewer")
    r2 = await add_member(db, project_id, "reviewer")
    (assignment_b,) = await enroll_articles(db, project_id, [b], by=MANAGER, enrolled_at=JAN_1)
    await add_decision(db, assignment_b, r1, "include")
    await add_decision(db, assignment_b, r2, "exclude", reason="population")

    result = await _write(db, project_id, [_item(b, a, "duplicate")])

    assert result == {"written": 1, "enrolled_kept": 1}
    assert await _assignment_of(db, project_id, a) is not None
    decisions = select(func.count()).where(ScreeningDecision.assignment_id == assignment_b)
    assert (await db.execute(decisions)).scalar_one() == 2

    await enroll_articles(db, project_id, [c], by=MANAGER)
    again = await _write(db, project_id, [_item(a, c, "duplicate")])
    assert again == {"written": 1, "enrolled_kept": 0}


async def test_cleared_only_after_a_verdict(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a = await make_screening_article(db, project_id, title=LONG_TITLE, publication_year=2020)
    b = await make_screening_article(db, project_id, title=LONG_TITLE, publication_year=2020)

    assert await _write(db, project_id, [_item(b, a, "cleared")]) == {
        "written": 0,
        "enrolled_kept": 0,
    }
    await _write(db, project_id, [_item(b, a, "distinct")])
    assert (await _write(db, project_id, [_item(b, a, "cleared")]))["written"] == 1

    rows = await _rows(db, project_id)
    assert [(r.verdict, r.basis) for r in rows] == [("distinct", "title"), ("cleared", "title")]


async def test_undo_allowed_after_extraction_started(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, _ = await _pmid_triple(db, project_id)
    await _write(db, project_id, [_item(b, a, "duplicate")])
    await _start_extraction(db, project_id, b)

    assert (await _write(db, project_id, [_item(b, a, "cleared")]))["written"] == 1
    assert not await _is_removed(db, b)

    response = await _post(db, project_id, [_item(b, a, "duplicate")])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_HAS_REVIEW_WORK"


async def test_written_counts_inserted_rows(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    a, b, c = await _pmid_triple(db, project_id)
    d = await make_screening_article(db, project_id, title="D")

    result = await _write(
        db,
        project_id,
        [
            _item(b, a, "duplicate"),
            _item(d, a, "distinct"),
            _item(b, c, "duplicate"),  # B already removed: skipped
            _item(d, a, "cleared"),
        ],
    )

    assert result == {"written": 3, "enrolled_kept": 0}
