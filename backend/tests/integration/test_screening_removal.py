"""A removed duplicate leaves screening and PRISMA screening (spec §8.3, §8.4), on real Postgres.

Removal is derived from ``article_duplicate_verdicts``; nothing is deleted, so
a later ``cleared`` verdict brings the record back with its decisions.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from httpx import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article_duplicate import ArticleDuplicateVerdict
from app.services.prisma_service import prisma_counts
from app.services.screening_config_service import ScreeningConfigService
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    enroll_articles,
    make_screening_article,
    set_reviewer_count,
)
from tests.integration.helpers.shared_fixtures import make_project

MANAGER = SEED.primary_profile
JAN_1 = datetime(2026, 1, 1, tzinfo=UTC)
JAN_2 = datetime(2026, 1, 2, tzinfo=UTC)


async def _request(
    db: AsyncSession, user: UUID, method: str, path: str, body: dict[str, Any] | None = None
) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.request(method, path, json=body)
    finally:
        app.dependency_overrides.clear()


async def _rows_by_article(db: AsyncSession, project_id: UUID) -> dict[str, dict[str, Any]]:
    response = await _request(
        db, MANAGER, "GET", f"/api/v1/projects/{project_id}/screening/records?phase=title_abstract"
    )
    assert response.status_code == 200, response.text
    return {row["article_id"]: row for row in response.json()["data"]["rows"]}


async def _verdict(
    db: AsyncSession,
    project_id: UUID,
    article_id: UUID,
    kept_article_id: UUID,
    verdict: str,
    *,
    created_at: datetime | None = None,
) -> None:
    db.add(
        ArticleDuplicateVerdict(
            project_id=project_id,
            article_id=article_id,
            kept_article_id=kept_article_id,
            verdict=verdict,
            basis="manual",
            decided_by=MANAGER,
            **({} if created_at is None else {"created_at": created_at}),
        )
    )
    await db.flush()


async def _abc(db: AsyncSession) -> tuple[UUID, UUID, UUID, UUID]:
    """A project with one reviewer per record and articles A, B, C; nothing enrolled."""
    project_id = await make_project(db)
    await set_reviewer_count(db, project_id, 1)
    a = await make_screening_article(db, project_id, title="A", ingestion_source="RIS")
    b = await make_screening_article(db, project_id, title="B", ingestion_source="RIS")
    c = await make_screening_article(db, project_id, title="C", ingestion_source="RIS")
    return project_id, a, b, c


async def test_removed_record_leaves_the_records_read(db_session: AsyncSession) -> None:
    project_id, a, b, c = await _abc(db_session)
    d = await make_screening_article(db_session, project_id, title="D")
    await enroll_articles(db_session, project_id, [a, b], by=MANAGER)
    before = await _rows_by_article(db_session, project_id)
    assert {str(a), str(b), str(c), str(d)} <= before.keys()

    await _verdict(db_session, project_id, b, a, "duplicate")
    await _verdict(db_session, project_id, c, a, "duplicate")

    after = await _rows_by_article(db_session, project_id)
    assert set(after) == {str(a), str(d)}
    assert after[str(d)]["status"] == "not_enrolled"


async def test_assignment_read_404_on_removed(db_session: AsyncSession) -> None:
    project_id, a, b, _c = await _abc(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": '{"exclusion": ["Not ML"]}', "p": str(project_id)},
    )
    r1 = await add_member(db_session, project_id, "reviewer")
    r2 = await add_member(db_session, project_id, "reviewer")
    _ka, kb = await enroll_articles(db_session, project_id, [a, b], by=MANAGER)
    await set_reviewer_count(db_session, project_id, 2)
    d1 = await add_decision(db_session, kb, r1, "include", created_at=JAN_1)
    d2 = await add_decision(db_session, kb, r2, "exclude", reason="Not ML", created_at=JAN_2)
    assert (
        await _request(db_session, MANAGER, "GET", f"/api/v1/screening/assignments/{kb}")
    ).status_code == 200

    await _verdict(db_session, project_id, b, a, "duplicate")

    read = await _request(db_session, MANAGER, "GET", f"/api/v1/screening/assignments/{kb}")
    decide = await _request(
        db_session,
        r1,
        "POST",
        f"/api/v1/screening/assignments/{kb}/decisions",
        {"decision": "include"},
    )
    arbitrate = await _request(
        db_session,
        MANAGER,
        "POST",
        f"/api/v1/screening/assignments/{kb}/arbitration",
        {"ruled_on_decision_ids": [str(d1), str(d2)], "selected_decision_id": str(d1)},
    )
    assert (read.status_code, decide.status_code, arbitrate.status_code) == (404, 404, 404)


async def test_enroll_skips_removed(db_session: AsyncSession) -> None:
    project_id, a, b, c = await _abc(db_session)
    await _verdict(db_session, project_id, b, a, "duplicate")
    service = ScreeningConfigService(db_session)

    explicit = await service.enroll(project_id, MANAGER, [b, a])
    assert (explicit.enrolled, explicit.already_enrolled) == (1, 0)

    every = await service.enroll(project_id, MANAGER, None)
    assert (every.enrolled, every.already_enrolled) == (1, 1)  # C new, A already
    rows = await _rows_by_article(db_session, project_id)
    assert set(rows) == {str(a), str(c)}
    assert all(row["assignment_id"] for row in rows.values())


async def test_restore_restores_the_assignment(db_session: AsyncSession) -> None:
    project_id, a, b, _c = await _abc(db_session)
    r1 = await add_member(db_session, project_id, "reviewer")
    _ka, kb = await enroll_articles(db_session, project_id, [a, b], by=MANAGER)
    await add_decision(db_session, kb, r1, "include")
    await _verdict(db_session, project_id, b, a, "duplicate", created_at=JAN_1)
    assert str(b) not in await _rows_by_article(db_session, project_id)

    await _verdict(db_session, project_id, b, a, "cleared", created_at=JAN_2)

    row = (await _rows_by_article(db_session, project_id))[str(b)]
    assert row["assignment_id"] == str(kb)
    assert row["status"] == "included"


async def test_config_not_enrolled_excludes_removed(db_session: AsyncSession) -> None:
    project_id, a, _b, c = await _abc(db_session)
    await enroll_articles(db_session, project_id, [a], by=MANAGER)
    await _verdict(db_session, project_id, c, a, "duplicate")

    config = await ScreeningConfigService(db_session).read(project_id, MANAGER)

    assert (config.enrolled, config.not_enrolled) == (1, 1)  # B only


async def test_prisma_before_and_after_a_merge(db_session: AsyncSession) -> None:
    project_id, a, b, _c = await _abc(db_session)
    await enroll_articles(db_session, project_id, [a, b], by=MANAGER)
    before = await prisma_counts(db_session, project_id)
    assert (before.identified_total, before.duplicates_removed, before.other_removed) == (3, 0, 1)
    assert before.screened == 2

    merged = await _request(
        db_session,
        MANAGER,
        "POST",
        f"/api/v1/projects/{project_id}/duplicates/verdicts",
        {"items": [{"article_id": str(b), "kept_article_id": str(a), "verdict": "duplicate"}]},
    )
    assert merged.status_code == 200, merged.text

    after = await prisma_counts(db_session, project_id)
    assert after.identified_total == 3
    assert after.duplicates_removed == 1
    assert after.other_removed == 1
    assert after.screened == 1
    assert after.identified_total == after.duplicates_removed + after.other_removed + after.screened
