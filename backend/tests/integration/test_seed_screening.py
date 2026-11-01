"""The local screening seed on real Postgres: a project the manager can triage and rule."""

from __future__ import annotations

from collections import Counter
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article import Article
from app.models.project import Project
from app.models.screening import ScreeningAssignment, ScreeningDecision
from app.models.user import Profile
from app.seed_screening import _ARTICLES, build, resolve_profiles
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.screening_fixtures import add_member
from tests.integration.helpers.shared_fixtures import make_project


async def _rows(
    db: AsyncSession, user: UUID, project_id: UUID, phase: str = "title_abstract"
) -> list[dict[str, Any]]:
    try:
        async with client_as(str(user), db) as client:
            response = await client.get(
                f"/api/v1/projects/{project_id}/screening/records?phase={phase}"
            )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    return response.json()["data"]["rows"]


async def test_seed_builds_a_conflict_the_manager_can_rule(db_session: AsyncSession) -> None:
    manager = SEED.primary_profile
    scratch = await make_project(db_session)
    r1 = await add_member(db_session, scratch, "reviewer")
    r2 = await add_member(db_session, scratch, "reviewer")

    await build(db_session, manager_id=manager, reviewer_ids=(r1, r2))
    project_id = await build(db_session, manager_id=manager, reviewer_ids=(r1, r2))

    copies = (
        await db_session.execute(
            select(func.count()).select_from(Project).where(Project.id == project_id)
        )
    ).scalar_one()
    assert copies == 1
    manager_rows = await _rows(db_session, manager, project_id)
    counts = Counter(row["status"] for row in manager_rows)
    assert len(manager_rows) == 17  # #18 is a removed duplicate
    assert counts["conflict"] >= 1
    assert counts["to_screen"] >= 1
    assert counts["included"] >= 1
    assert counts["not_enrolled"] == 5  # #13-#17
    (conflict,) = [row for row in manager_rows if row["status"] == "conflict"]
    by_article = {row["article_id"]: row for row in await _rows(db_session, r1, project_id)}
    assert by_article[conflict["article_id"]]["status"] == "waiting"

    full_text = await _rows(db_session, manager, project_id, "full_text")
    assert len(full_text) == 3
    assert sum(row["has_pdf"] for row in full_text) == 1
    assert [row["status"] for row in full_text] == ["to_screen"] * 3
    ft_by_r1 = {
        row["article_id"]: row for row in await _rows(db_session, r1, project_id, "full_text")
    }
    (waiting,) = [row for row in ft_by_r1.values() if row["status"] == "waiting"]
    assert waiting["my_exclusion_reason"] == "Wrong outcome"
    assert await _enrolled_full_text(db_session, manager, project_id) == 3


async def _enrolled_full_text(db: AsyncSession, user: UUID, project_id: UUID) -> int:
    try:
        async with client_as(str(user), db) as client:
            response = await client.get(f"/api/v1/projects/{project_id}/screening/config")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    return int(response.json()["data"]["full_text_enrolled"])


async def test_seed_carries_the_reading_states(db_session: AsyncSession) -> None:
    scratch = await make_project(db_session)
    r1 = await add_member(db_session, scratch, "reviewer")
    r2 = await add_member(db_session, scratch, "reviewer")
    project_id = await build(db_session, manager_id=SEED.primary_profile, reviewer_ids=(r1, r2))

    rows = (
        await db_session.execute(select(Article).where(Article.project_id == project_id))
    ).scalars()
    by_title = {article.title: article for article in rows}
    structured = by_title[_ARTICLES[1][0]]
    assert structured.abstract is not None
    assert structured.abstract.startswith("BACKGROUND:")
    assert structured.mesh_terms == ["Sepsis", "Humans", "Adult"]
    assert by_title[_ARTICLES[3][0]].language == "spa"

    notes = (
        await db_session.execute(
            select(ScreeningDecision.reviewer_id, ScreeningDecision.rationale)
            .join(ScreeningAssignment, ScreeningAssignment.id == ScreeningDecision.assignment_id)
            .where(
                ScreeningAssignment.project_id == project_id,
                ScreeningAssignment.article_id == by_title[_ARTICLES[0][0]].id,
            )
        )
    ).tuples()
    assert dict(notes.all()) == {
        r1: "Adults with sepsis, meets inclusion",
        r2: "Paediatric cohort",
    }


async def _created_at(db: AsyncSession, profile_id: UUID) -> Any:
    return (
        await db.execute(select(Profile.created_at).where(Profile.id == profile_id))
    ).scalar_one()


async def test_resolve_profiles_by_email_and_by_age(db_session: AsyncSession) -> None:
    email = (
        await db_session.execute(select(Profile.email).where(Profile.id == SEED.primary_profile))
    ).scalar_one()
    assert email is not None

    manager, (a, b) = await resolve_profiles(db_session, email)
    assert manager == SEED.primary_profile
    assert len({manager, a, b}) == 3

    oldest, (c, d) = await resolve_profiles(db_session, None)
    assert len({oldest, c, d}) == 3
    oldest_at = await _created_at(db_session, oldest)
    every_at = (await db_session.execute(select(Profile.created_at))).scalars().all()
    assert all(oldest_at <= at for at in every_at)

    with pytest.raises(SystemExit):
        await resolve_profiles(db_session, "nobody@nowhere.invalid")


async def test_seed_has_an_open_and_a_resolved_duplicate_pair(db_session: AsyncSession) -> None:
    manager = SEED.primary_profile
    scratch = await make_project(db_session)
    r1 = await add_member(db_session, scratch, "reviewer")
    r2 = await add_member(db_session, scratch, "reviewer")
    project_id = await build(db_session, manager_id=manager, reviewer_ids=(r1, r2))

    try:
        async with client_as(str(manager), db_session) as client:
            response = await client.get(f"/api/v1/projects/{project_id}/duplicates")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    data = response.json()["data"]

    (open_pair,) = data["open"]
    (resolved,) = data["resolved"]
    assert (open_pair["tier"], open_pair["basis"]) == ("exact", "pmid")
    assert (resolved["verdict"], resolved["basis"]) == ("duplicate", "doi")
    rows = {row["article_id"] for row in await _rows(db_session, manager, project_id)}
    assert resolved["article_id"] not in rows
    assert resolved["kept_article_id"] in rows
