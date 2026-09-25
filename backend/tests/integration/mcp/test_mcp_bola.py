"""Per-tool BOLA cases (spec §3 choke point already proves membership; this
file proves each real tool actually answers NOT_FOUND, not just the probes
in test_mcp_choke_point.py). Task 6a starts the table; each later tool task
adds its own rows."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms
from tests.integration.mcp.article_seed import insert_article, insert_pdf
from tests.integration.mcp.tool_calls import call_tool, error_payload

BOLA_CASES = [
    pytest.param(
        "pat_outsider_rw",
        "get_project",
        {"project_id": str(SEED.primary_project)},
        "NOT_FOUND",
        id="get_project-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_primary_rw",
        "get_project",
        {"project_id": str(uuid4())},
        "NOT_FOUND",
        id="get_project-random-uuid",
    ),
    pytest.param(
        "pat_outsider_rw",
        "list_articles",
        {"project_id": str(SEED.primary_project)},
        "NOT_FOUND",
        id="list_articles-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_outsider_rw",
        "get_article",
        {"article_id": str(SEED.primary_article)},
        "NOT_FOUND",
        id="get_article-outsider-on-foreign-article",
    ),
    pytest.param(
        "pat_primary_rw",
        "get_article",
        {"article_id": str(uuid4())},
        "NOT_FOUND",
        id="get_article-random-uuid",
    ),
    pytest.param(
        "pat_outsider_rw",
        "get_article_text",
        {"article_id": str(SEED.primary_article)},
        "NOT_FOUND",
        id="get_article_text-outsider-on-foreign-article",
    ),
    pytest.param(
        "pat_outsider_rw",
        "search_project_text",
        {"project_id": str(SEED.primary_project), "query": "x"},
        "NOT_FOUND",
        id="search_project_text-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_outsider_rw",
        "get_article_pdf",
        {"article_id": str(SEED.primary_article)},
        "NOT_FOUND",
        id="get_article_pdf-outsider-on-foreign-article",
    ),
    pytest.param(
        "pat_outsider_rw",
        "get_template",
        {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)},
        "NOT_FOUND",
        id="get_template-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_primary_rw",
        "get_template",
        {"project_id": str(SEED.primary_project), "template_id": str(uuid4())},
        "NOT_FOUND",
        id="get_template-random-uuid",
    ),
    pytest.param(
        "pat_outsider_rw",
        "get_extractions",
        {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)},
        "NOT_FOUND",
        id="get_extractions-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_primary_rw",
        "get_extractions",
        {"project_id": str(SEED.primary_project), "template_id": str(uuid4())},
        "NOT_FOUND",
        id="get_extractions-random-template-uuid",
    ),
    pytest.param(
        "pat_primary_rw",
        "get_extractions",
        {
            "project_id": str(SEED.primary_project),
            "template_id": str(SEED.primary_template),
            "article_id": str(uuid4()),
        },
        "NOT_FOUND",
        id="get_extractions-random-article-uuid",
    ),
    pytest.param(
        "pat_outsider_rw",
        "update_project_details",
        {
            "project_id": str(SEED.primary_project),
            "fields": {"description": "x"},
            "expected": {"description": None},
        },
        "NOT_FOUND",
        id="update_project_details-outsider-on-foreign-project",
    ),
    pytest.param(
        "pat_reviewer_rw",
        "update_project_details",
        {
            "project_id": str(SEED.primary_project),
            "fields": {"description": "x"},
            "expected": {"description": None},
        },
        "MANAGER_REQUIRED",
        id="update_project_details-reviewer-not-manager",
    ),
    pytest.param(
        "pat_primary_read",
        "update_project_details",
        {
            "project_id": str(SEED.primary_project),
            "fields": {"description": "x"},
            "expected": {"description": None},
        },
        "SCOPE_INSUFFICIENT",
        id="update_project_details-read-token",
    ),
]


@pytest.mark.parametrize(("pat_fixture", "tool", "arguments", "expected_code"), BOLA_CASES)
async def test_bola_returns_expected_code(
    mcp_client,
    pat_outsider_rw,
    pat_primary_rw,
    pat_reviewer_rw,
    pat_primary_read,
    pat_fixture: str,
    tool: str,
    arguments: dict,
    expected_code: str,
) -> None:
    # Not request.getfixturevalue: resolving an async (pytest_asyncio) fixture
    # that way from inside an already-running async test raises "Runner.run()
    # cannot be called from a running event loop" in this repo's pytest-asyncio
    # setup. The PATs the table's rows name are requested as ordinary fixture
    # args instead, and selected here by name.
    pats = {
        "pat_outsider_rw": pat_outsider_rw,
        "pat_primary_rw": pat_primary_rw,
        "pat_reviewer_rw": pat_reviewer_rw,
        "pat_primary_read": pat_primary_read,
    }
    result = await call_tool(mcp_client, pats[pat_fixture], tool, arguments)
    assert error_payload(result)["code"] == expected_code


async def test_update_project_details_absent_from_tools_list_for_read_token(
    mcp_client, pat_primary_read
) -> None:
    async with mcp_client(pat_primary_read) as client:
        names = {t.name for t in (await client.list_tools()).tools}
    assert "update_project_details" not in names


async def test_update_project_details_bola_writes_no_row(
    mcp_client,
    pat_outsider_rw,
    pat_reviewer_rw,
    pat_primary_read,
    db_session: AsyncSession,
) -> None:
    arguments = {
        "project_id": str(SEED.primary_project),
        "fields": {"description": "x"},
        "expected": {"description": None},
    }
    before = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    for pat in (pat_outsider_rw, pat_reviewer_rw, pat_primary_read):
        result = await call_tool(mcp_client, pat, "update_project_details", arguments)
        assert result.is_error
    after = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after == before


async def test_get_project_not_found_after_membership_removed(
    mcp_client, pat_reviewer_rw, db_session: AsyncSession
) -> None:
    await db_session.execute(
        text("DELETE FROM public.project_members WHERE project_id = :p AND user_id = :u"),
        {"p": str(SEED.primary_project), "u": str(SEED.reviewer_profile)},
    )
    result = await call_tool(
        mcp_client, pat_reviewer_rw, "get_project", {"project_id": str(SEED.primary_project)}
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_article_file_id_of_another_article_in_same_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    other_article = await insert_article(db_session, SEED.primary_project, title="Sibling")
    other_file = await insert_pdf(db_session, SEED.primary_project, other_article)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article",
        {"article_id": str(SEED.primary_article), "file_id": str(other_file)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_article_file_id_of_an_article_in_another_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    foreign_article = await insert_article(db_session, SEED.secondary_project, title="Foreign")
    foreign_file = await insert_pdf(db_session, SEED.secondary_project, foreign_article)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article",
        {"article_id": str(SEED.primary_article), "file_id": str(foreign_file)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_article_text_file_id_of_another_article_in_same_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    other_article = await insert_article(db_session, SEED.primary_project, title="Sibling")
    other_file = await insert_pdf(db_session, SEED.primary_project, other_article)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article_text",
        {"article_id": str(SEED.primary_article), "file_id": str(other_file)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_article_text_file_id_of_an_article_in_another_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    foreign_article = await insert_article(db_session, SEED.secondary_project, title="Foreign")
    foreign_file = await insert_pdf(db_session, SEED.secondary_project, foreign_article)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article_text",
        {"article_id": str(SEED.primary_article), "file_id": str(foreign_file)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_search_project_text_article_id_of_another_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    foreign_article = await insert_article(db_session, SEED.secondary_project, title="Foreign")
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "search_project_text",
        {"project_id": str(SEED.primary_project), "query": "x", "article_id": str(foreign_article)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_article_pdf_file_id_of_another_article_in_same_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    other_article = await insert_article(db_session, SEED.primary_project, title="Sibling")
    other_file = await insert_pdf(db_session, SEED.primary_project, other_article)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article_pdf",
        {"article_id": str(SEED.primary_article), "file_id": str(other_file)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_article_pdf_file_id_of_an_article_in_another_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    foreign_article = await insert_article(db_session, SEED.secondary_project, title="Foreign")
    foreign_file = await insert_pdf(db_session, SEED.secondary_project, foreign_article)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article_pdf",
        {"article_id": str(SEED.primary_article), "file_id": str(foreign_file)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_template_of_another_project_is_not_found(
    mcp_client, pat_reviewer_rw, db_session: AsyncSession
) -> None:
    # pat_reviewer_rw is a member of SEED.primary_project only; the
    # template `fresh_charms` clones lives in SEED.secondary_project.
    _project_id, foreign_template_id, _schema = await fresh_charms(db_session)
    result = await call_tool(
        mcp_client,
        pat_reviewer_rw,
        "get_template",
        {"project_id": str(SEED.primary_project), "template_id": str(foreign_template_id)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_extractions_template_id_of_another_project_is_not_found(
    mcp_client, pat_reviewer_rw, db_session: AsyncSession
) -> None:
    _project_id, foreign_template_id, _schema = await fresh_charms(db_session)
    result = await call_tool(
        mcp_client,
        pat_reviewer_rw,
        "get_extractions",
        {"project_id": str(SEED.primary_project), "template_id": str(foreign_template_id)},
    )
    assert error_payload(result)["code"] == "NOT_FOUND"


async def test_get_extractions_article_id_of_another_project_is_not_found(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    foreign_article = await insert_article(db_session, SEED.secondary_project, title="Foreign")
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_extractions",
        {
            "project_id": str(SEED.primary_project),
            "template_id": str(SEED.primary_template),
            "article_id": str(foreign_article),
        },
    )
    assert error_payload(result)["code"] == "NOT_FOUND"
