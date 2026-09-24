"""app.services.project_read_service: the counts/templates a read tool needs
that no existing repository computes (task 6a)."""

from __future__ import annotations

from typing import get_args
from uuid import uuid4

from sqlalchemy import event, text

from app.models.base import POSTGRESQL_ENUM_VALUES
from app.schemas.mcp_projects import ProjectRoleValue
from app.schemas.project_details import ProjectDetailsValues
from app.services.project_read_service import (
    get_project_overview,
    list_projects_for_user,
    template_summaries,
)
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import force_narrow_baseline, fresh_charms


async def test_list_projects_for_user_roles(db_session):
    rows = await list_projects_for_user(db_session, user_id=SEED.primary_profile)
    by_id = {r.project_id: r for r in rows}
    assert by_id[SEED.primary_project].role == "manager"
    assert by_id[SEED.secondary_project].role == "manager"
    assert [r.project_id for r in rows] == sorted(by_id, key=lambda p: (by_id[p].name, str(p)))


async def test_list_projects_reviewer_sees_only_membership(db_session):
    rows = {
        r.project_id: r
        for r in await list_projects_for_user(db_session, user_id=SEED.reviewer_profile)
    }
    assert rows[SEED.primary_project].role == "reviewer"
    assert SEED.secondary_project not in rows


async def test_list_projects_outsider_empty(db_session):
    assert await list_projects_for_user(db_session, user_id=SEED.outsider_profile) == []


def test_project_role_values_match_the_postgres_enum():
    assert set(get_args(ProjectRoleValue)) == set(POSTGRESQL_ENUM_VALUES["project_member_role"])


async def test_list_projects_is_one_statement(db_session):
    statements: list[str] = []

    def listener(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement)

    # Warm the connection first (test_article_progress_read.py's `_statements`
    # precedent): a fresh db_session's first-ever query is preceded by a
    # lazily-flushed SAVEPOINT from session.begin_nested() in the fixture,
    # which would otherwise be miscounted as a second statement here.
    conn = (await db_session.connection()).sync_connection
    event.listen(conn, "before_cursor_execute", listener)
    try:
        await list_projects_for_user(db_session, user_id=SEED.primary_profile)
    finally:
        event.remove(conn, "before_cursor_execute", listener)
    assert (
        len(statements) == 1 and "is_project_member" not in statements[0]
    )  # one predicate, no double check


async def test_project_overview_counts_and_details(db_session):
    ov = await get_project_overview(
        db_session, project_id=SEED.primary_project, user_id=SEED.primary_profile
    )
    assert ov is not None and ov.role == "manager"
    assert isinstance(ov.details, ProjectDetailsValues)
    assert set(ov.details.model_dump()) == {
        "name",
        "description",
        "review_type",
        "review_title",
        "condition_studied",
        "review_rationale",
        "search_strategy",
        "eligibility_criteria",
        "study_design",
        "review_keywords",
        "review_context",
    }
    assert (
        await get_project_overview(db_session, project_id=uuid4(), user_id=SEED.primary_profile)
        is None
    )
    assert ov.counts.articles >= 1
    assert 0 <= ov.counts.articles_with_text <= ov.counts.articles
    assert SEED.primary_template in {t.template_id for t in ov.templates}


async def test_template_summaries_narrow_flag(db_session):
    project_id, template_id, _ = await fresh_charms(db_session)  # published, wide
    by_id = {t.template_id: t for t in await template_summaries(db_session, project_id=project_id)}
    assert by_id[template_id].narrow is False and by_id[template_id].published_version is not None

    await force_narrow_baseline(db_session, template_id, uuid4())
    by_id = {t.template_id: t for t in await template_summaries(db_session, project_id=project_id)}
    assert by_id[template_id].narrow is True

    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    by_id = {t.template_id: t for t in await template_summaries(db_session, project_id=project_id)}
    assert (by_id[template_id].published_version, by_id[template_id].narrow) == (None, None)
