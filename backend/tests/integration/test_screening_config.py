"""Screening config (reviewers per record) and enrollment over HTTP, on real Postgres."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.main import app
from app.models.project import Project
from app.models.screening import ScreeningAssignment
from app.repositories.screening_repository import ScreeningRepository
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


def _config_path(project_id: UUID) -> str:
    return f"/api/v1/projects/{project_id}/screening/config"


def _enroll_path(project_id: UUID) -> str:
    return f"/api/v1/projects/{project_id}/screening/enroll"


async def _project_with_articles(db: AsyncSession, count: int) -> tuple[UUID, list[UUID]]:
    project_id = await make_project(db)
    return project_id, [await make_screening_article(db, project_id) for _ in range(count)]


async def _get_as(db: AsyncSession, user: UUID, path: str):
    try:
        async with client_as(str(user), db) as client:
            return await client.get(path)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _call_as(db: AsyncSession, user: UUID, method: str, path: str, body: dict):
    try:
        async with client_as(str(user), db) as client:
            return await client.request(method, path, json=body)
    finally:
        app.dependency_overrides.clear()


async def test_config_read_unconfigured(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 2)
    reviewer = await add_member(db_session, project_id, "reviewer")
    viewer = await add_member(db_session, project_id, "viewer")
    outsider = await add_member(db_session, await make_project(db_session), "reviewer")

    as_manager = await _get_as(db_session, MANAGER, _config_path(project_id))
    assert as_manager.status_code == 200
    assert as_manager.json()["data"] == {
        "reviewer_count": None,
        "reviewer_count_locked": False,
        "full_text_reviewer_count": None,
        "full_text_count_locked": False,
        "full_text_ready": 0,
        "full_text_enrolled": 0,
        "reviewer_capable": 2,
        "enrolled": 0,
        "not_enrolled": 2,
        "can_manage": True,
        "can_review": True,
        "can_arbitrate": True,
        "exclusion_reasons": [],
    }

    roles = ("can_manage", "can_review", "can_arbitrate")
    as_reviewer = (await _get_as(db_session, reviewer, _config_path(project_id))).json()["data"]
    assert tuple(as_reviewer[k] for k in roles) == (False, True, False)
    as_viewer = (await _get_as(db_session, viewer, _config_path(project_id))).json()["data"]
    assert tuple(as_viewer[k] for k in roles) == (False, False, False)

    assert (await _get_as(db_session, outsider, _config_path(project_id))).status_code == 403


async def test_put_config_persists_and_keeps_sibling_settings(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 0)
    await add_member(db_session, project_id, "reviewer")
    await db_session.execute(
        text("UPDATE public.projects SET settings = CAST(:s AS jsonb) WHERE id = :pid"),
        {"s": '{"managers_see_reviewers": {"extraction": true}}', "pid": str(project_id)},
    )

    response = await _call_as(
        db_session, MANAGER, "PUT", _config_path(project_id), {"reviewer_count": 2}
    )

    assert response.status_code == 200
    assert response.json()["data"]["reviewer_count"] == 2
    settings = (
        await db_session.execute(
            select(Project.settings)
            .where(Project.id == project_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert settings == {
        "managers_see_reviewers": {"extraction": True},
        "screening": {"reviewer_count": 2},
    }


@pytest.mark.parametrize("role", ["reviewer", "viewer", "consensus"])
async def test_put_config_requires_manager(db_session: AsyncSession, role: str) -> None:
    project_id, _ = await _project_with_articles(db_session, 0)
    member = await add_member(db_session, project_id, role)

    response = await _call_as(
        db_session, member, "PUT", _config_path(project_id), {"reviewer_count": 1}
    )

    assert response.status_code == 403


@pytest.mark.parametrize("value", [0, 4])
async def test_put_config_out_of_range_is_422(db_session: AsyncSession, value: int) -> None:
    project_id, _ = await _project_with_articles(db_session, 0)

    response = await _call_as(
        db_session, MANAGER, "PUT", _config_path(project_id), {"reviewer_count": value}
    )

    assert response.status_code == 422


async def test_put_config_above_reviewer_capable(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 0)
    await add_member(db_session, project_id, "reviewer")

    response = await _call_as(
        db_session, MANAGER, "PUT", _config_path(project_id), {"reviewer_count": 3}
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SCREENING_TOO_FEW_REVIEWERS"


async def test_reviewer_count_frozen_after_first_decision(db_session: AsyncSession) -> None:
    project_id, articles = await _project_with_articles(db_session, 1)
    reviewer = await add_member(db_session, project_id, "reviewer")
    await set_reviewer_count(db_session, project_id, 2)
    [assignment] = await enroll_articles(db_session, project_id, articles, by=MANAGER)
    await add_decision(db_session, assignment, reviewer, "include")

    lowered = await _call_as(
        db_session, MANAGER, "PUT", _config_path(project_id), {"reviewer_count": 1}
    )
    assert lowered.status_code == 409
    assert lowered.json()["error"]["code"] == "SCREENING_CONFIG_FROZEN"

    same = await _call_as(
        db_session, MANAGER, "PUT", _config_path(project_id), {"reviewer_count": 2}
    )
    assert same.status_code == 200

    read = await _get_as(db_session, MANAGER, _config_path(project_id))
    assert read.json()["data"]["reviewer_count_locked"] is True


async def test_full_text_decisions_do_not_lock_the_title_abstract_count(
    db_session: AsyncSession,
) -> None:
    project_id, articles = await _project_with_articles(db_session, 1)
    reviewer = await add_member(db_session, project_id, "reviewer")
    await set_reviewer_count(db_session, project_id, 2)
    [assignment] = await enroll_articles(
        db_session, project_id, articles, by=MANAGER, phase="full_text"
    )
    await add_decision(db_session, assignment, reviewer, "include")

    read = await _get_as(db_session, MANAGER, _config_path(project_id))

    assert read.json()["data"]["reviewer_count_locked"] is False


async def test_enroll_all_is_idempotent(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 3)

    first = await _call_as(db_session, MANAGER, "POST", _enroll_path(project_id), {})
    assert first.status_code == 200
    assert first.json()["data"] == {"enrolled": 3, "already_enrolled": 0}

    again = await _call_as(db_session, MANAGER, "POST", _enroll_path(project_id), {})
    assert again.json()["data"] == {"enrolled": 0, "already_enrolled": 3}

    rows = (
        (
            await db_session.execute(
                select(ScreeningAssignment).where(ScreeningAssignment.project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    assert len({row.id for row in rows}) == 3
    assert len({row.enrolled_at for row in rows}) == 1
    assert {row.enrolled_by for row in rows} == {MANAGER}


async def test_enroll_selected(db_session: AsyncSession) -> None:
    project_id, articles = await _project_with_articles(db_session, 2)
    body = {"article_ids": [str(articles[0])]}

    first = await _call_as(db_session, MANAGER, "POST", _enroll_path(project_id), body)
    assert first.json()["data"] == {"enrolled": 1, "already_enrolled": 0}

    again = await _call_as(db_session, MANAGER, "POST", _enroll_path(project_id), body)
    assert again.json()["data"] == {"enrolled": 0, "already_enrolled": 1}


async def test_enroll_refuses_a_foreign_article(db_session: AsyncSession) -> None:
    project_id, articles = await _project_with_articles(db_session, 1)
    _, foreign = await _project_with_articles(db_session, 1)

    response = await _call_as(
        db_session,
        MANAGER,
        "POST",
        _enroll_path(project_id),
        {"article_ids": [str(articles[0]), str(foreign[0]), str(uuid4())]},
    )

    assert response.status_code == 404
    count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.screening_assignments WHERE project_id = :pid"),
            {"pid": str(project_id)},
        )
    ).scalar_one()
    assert count == 0


async def test_enroll_requires_manager(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 1)
    reviewer = await add_member(db_session, project_id, "reviewer")

    response = await _call_as(db_session, reviewer, "POST", _enroll_path(project_id), {})

    assert response.status_code == 403


async def test_enroll_all_includes_removed_at_source(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await make_screening_article(db_session, project_id, sync_state="removed_at_source")

    response = await _call_as(db_session, MANAGER, "POST", _enroll_path(project_id), {})

    assert response.json()["data"] == {"enrolled": 1, "already_enrolled": 0}


async def test_moved_article_reads_as_not_enrolled(db_session: AsyncSession) -> None:
    project_id, articles = await _project_with_articles(db_session, 2)
    other_project = await make_project(db_session)
    await enroll_articles(db_session, project_id, articles, by=MANAGER)
    await db_session.execute(
        text("UPDATE public.articles SET project_id = :other WHERE id = :aid"),
        {"other": str(other_project), "aid": str(articles[0])},
    )

    read = await _get_as(db_session, MANAGER, _config_path(project_id))

    data = read.json()["data"]
    assert (data["enrolled"], data["not_enrolled"]) == (1, 0)


async def test_config_carries_the_protocol_exclusion_reasons(db_session: AsyncSession) -> None:
    with_reasons, without = await make_project(db_session), await make_project(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {
            "e": '{"inclusion": ["Adults"], "exclusion": ["Wrong population", "Not ML"]}',
            "p": str(with_reasons),
        },
    )

    config = (await _get_as(db_session, MANAGER, _config_path(with_reasons))).json()["data"]
    empty = (await _get_as(db_session, MANAGER, _config_path(without))).json()["data"]

    assert config["exclusion_reasons"] == ["Wrong population", "Not ML"]
    assert empty["exclusion_reasons"] == []


_REASONS = '{"inclusion": ["Adults"], "exclusion": ["Wrong population"]}'


async def _set_reasons(db: AsyncSession, project_id: UUID) -> None:
    await db.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": _REASONS, "p": str(project_id)},
    )


async def _ft_project(
    db: AsyncSession, ft_count: int | None = 1
) -> tuple[UUID, list[UUID], list[UUID]]:
    """TA rc 2, five enrolled articles: r1 include/include, r2 maybe/maybe, r3 exclude/exclude,
    r4 pending, r5 include/exclude (conflict). Returns (project, articles, reviewers)."""
    project_id, articles = await _project_with_articles(db, 5)
    reviewers = [await add_member(db, project_id, "reviewer") for _ in range(2)]
    await set_reviewer_count(db, project_id, 2)
    if ft_count is not None:
        await set_reviewer_count(db, project_id, ft_count, key="full_text_reviewer_count")
    await _set_reasons(db, project_id)
    base = datetime(2024, 1, 1, tzinfo=UTC)
    assignments = [
        (
            await enroll_articles(
                db, project_id, [a], by=MANAGER, enrolled_at=base + timedelta(minutes=i)
            )
        )[0]
        for i, a in enumerate(articles)
    ]
    votes = [
        ("include", "include"),
        ("maybe", "maybe"),
        ("exclude", "exclude"),
        None,
        ("include", "exclude"),
    ]
    for assignment, pair in zip(assignments, votes, strict=True):
        if pair is None:
            continue
        for reviewer, value in zip(reviewers, pair, strict=True):
            await add_decision(
                db,
                assignment,
                reviewer,
                value,
                reason="Wrong population" if value == "exclude" else None,
            )
    return project_id, articles, reviewers


async def _ft_articles(db: AsyncSession, project_id: UUID) -> set[UUID]:
    return set(
        (
            await db.execute(
                select(ScreeningAssignment.article_id).where(
                    ScreeningAssignment.project_id == project_id,
                    ScreeningAssignment.phase == "full_text",
                )
            )
        ).scalars()
    )


async def test_put_full_text_count_absent_null_value(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 0)
    for _ in range(2):
        await add_member(db_session, project_id, "reviewer")

    async def put(body: dict):
        return await _call_as(db_session, MANAGER, "PUT", _config_path(project_id), body)

    async def stored() -> dict:
        return (
            await db_session.execute(
                select(Project.settings)
                .where(Project.id == project_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()["screening"]

    set_to_two = await put({"reviewer_count": 2, "full_text_reviewer_count": 2})
    assert set_to_two.json()["data"]["full_text_reviewer_count"] == 2

    absent = await put({"reviewer_count": 2})
    assert absent.json()["data"]["full_text_reviewer_count"] == 2
    assert (await stored())["full_text_reviewer_count"] == 2

    off = await put({"reviewer_count": 2, "full_text_reviewer_count": None})
    assert off.json()["data"]["full_text_reviewer_count"] is None
    assert "full_text_reviewer_count" not in await stored()


async def test_full_text_count_too_few_reviewers(db_session: AsyncSession) -> None:
    project_id, _ = await _project_with_articles(db_session, 0)
    await add_member(db_session, project_id, "reviewer")

    response = await _call_as(
        db_session,
        MANAGER,
        "PUT",
        _config_path(project_id),
        {"reviewer_count": 1, "full_text_reviewer_count": 3},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SCREENING_TOO_FEW_REVIEWERS"


async def test_full_text_count_locks_once_sent(db_session: AsyncSession) -> None:
    project_id, _, _ = await _ft_project(db_session, ft_count=2)
    sent = await _call_as(
        db_session, MANAGER, "POST", _enroll_path(project_id), {"phase": "full_text"}
    )
    assert sent.status_code == 200
    assert (await _get_as(db_session, MANAGER, _config_path(project_id))).json()["data"][
        "full_text_count_locked"
    ] is True

    for body in (
        {"reviewer_count": 2, "full_text_reviewer_count": 1},
        {"reviewer_count": 2, "full_text_reviewer_count": None},
    ):
        frozen = await _call_as(db_session, MANAGER, "PUT", _config_path(project_id), body)
        assert frozen.status_code == 409
        assert frozen.json()["error"]["code"] == "SCREENING_CONFIG_FROZEN"

    same = await _call_as(
        db_session,
        MANAGER,
        "PUT",
        _config_path(project_id),
        {"reviewer_count": 2, "full_text_reviewer_count": 2},
    )
    assert same.status_code == 200


async def test_ta_lock_ignores_full_text_decisions(db_session: AsyncSession) -> None:
    project_id, articles = await _project_with_articles(db_session, 1)
    reviewer = await add_member(db_session, project_id, "reviewer")
    await add_member(db_session, project_id, "reviewer")
    await set_reviewer_count(db_session, project_id, 2)
    [assignment] = await enroll_articles(
        db_session, project_id, articles, by=MANAGER, phase="full_text"
    )
    await add_decision(db_session, assignment, reviewer, "include")

    response = await _call_as(
        db_session, MANAGER, "PUT", _config_path(project_id), {"reviewer_count": 1}
    )

    assert response.status_code == 200
    assert response.json()["data"]["reviewer_count"] == 1


async def test_config_ready_and_enrolled(db_session: AsyncSession) -> None:
    project_id, _, _ = await _ft_project(db_session)

    before = (await _get_as(db_session, MANAGER, _config_path(project_id))).json()["data"]
    assert (before["full_text_ready"], before["full_text_enrolled"]) == (2, 0)

    await _call_as(db_session, MANAGER, "POST", _enroll_path(project_id), {"phase": "full_text"})

    after = (await _get_as(db_session, MANAGER, _config_path(project_id))).json()["data"]
    assert (after["full_text_ready"], after["full_text_enrolled"]) == (0, 2)


async def test_config_ready_is_zero_without_a_title_abstract_count(
    db_session: AsyncSession,
) -> None:
    project_id, _ = await _project_with_articles(db_session, 1)

    data = (await _get_as(db_session, MANAGER, _config_path(project_id))).json()["data"]

    assert data["full_text_ready"] == 0


async def test_full_text_enroll_derives_include_and_maybe(db_session: AsyncSession) -> None:
    project_id, articles, _ = await _ft_project(db_session)
    prisma_path = f"/api/v1/projects/{project_id}/prisma"
    prisma_before = (await _get_as(db_session, MANAGER, prisma_path)).json()["data"]

    first = await _call_as(
        db_session, MANAGER, "POST", _enroll_path(project_id), {"phase": "full_text"}
    )
    second = await _call_as(
        db_session, MANAGER, "POST", _enroll_path(project_id), {"phase": "full_text"}
    )

    assert first.json()["data"] == {"enrolled": 2, "already_enrolled": 0}
    assert second.json()["data"] == {"enrolled": 0, "already_enrolled": 0}
    assert await _ft_articles(db_session, project_id) == {articles[0], articles[1]}
    assert (await _get_as(db_session, MANAGER, prisma_path)).json()["data"] == prisma_before


async def test_full_text_enroll_refusals(db_session: AsyncSession) -> None:
    off_project, _, _ = await _ft_project(db_session, ft_count=None)
    no_reasons, _, _ = await _ft_project(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET eligibility_criteria = '{}'::jsonb WHERE id = :p"),
        {"p": str(no_reasons)},
    )
    ready, _, _ = await _ft_project(db_session)
    reviewer = await add_member(db_session, ready, "reviewer")
    body = {"phase": "full_text"}

    off = await _call_as(db_session, MANAGER, "POST", _enroll_path(off_project), body)
    assert (off.status_code, off.json()["error"]["code"]) == (409, "SCREENING_NOT_CONFIGURED")

    reasons = await _call_as(db_session, MANAGER, "POST", _enroll_path(no_reasons), body)
    assert (reasons.status_code, reasons.json()["error"]["code"]) == (
        409,
        "SCREENING_REASON_REQUIRED",
    )

    ids = await _call_as(
        db_session,
        MANAGER,
        "POST",
        _enroll_path(ready),
        {"phase": "full_text", "article_ids": [str(uuid4())]},
    )
    assert ids.status_code == 422
    assert ids.json()["error"]["code"] == "VALIDATION_ERROR"

    as_reviewer = await _call_as(db_session, reviewer, "POST", _enroll_path(ready), body)
    assert as_reviewer.status_code == 403
    assert await _ft_articles(db_session, ready) == set()


async def test_has_assignment_scopes_by_phase_and_article(db_session: AsyncSession) -> None:
    project_id, articles = await _project_with_articles(db_session, 2)
    other = await make_project(db_session)
    await enroll_articles(db_session, project_id, articles[:1], by=MANAGER, phase="full_text")
    repo = ScreeningRepository(db_session)

    assert await repo.has_assignment(project_id=project_id, phase="full_text") is True
    assert await repo.has_assignment(project_id=project_id, phase="title_abstract") is False
    assert await repo.has_assignment(project_id=other, phase="full_text") is False
    assert (
        await repo.has_assignment(project_id=project_id, phase="full_text", article_id=articles[0])
        is True
    )
    assert (
        await repo.has_assignment(project_id=project_id, phase="full_text", article_id=articles[1])
        is False
    )
