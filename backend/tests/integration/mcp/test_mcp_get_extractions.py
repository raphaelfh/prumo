"""get_extractions tool-logic tests (task 8b): the in-memory SDK client, so
handler lines register coverage (the ASGI blind spot)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text

from app.schemas.mcp_extractions import McpExtractionsPage
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured
from tests.integration.test_blind_review_isolation import _build_two_reviewer_review_run


async def _built_review_run_template_id(db_session):
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built
    template_id = (
        await db_session.execute(
            text("SELECT template_id FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
    ).scalar_one()
    return template_id, reviewer_a, reviewer_b


async def test_get_extractions_concise_shape(mcp_client, pat_reviewer_rw, db_session):
    template_id, _reviewer_a, _reviewer_b = await _built_review_run_template_id(db_session)

    body = structured(
        await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "get_extractions",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(template_id),
                "article_id": str(SEED.primary_article),
                "response_format": "concise",
            },
        )
    )
    McpExtractionsPage.model_validate(body)
    assert body["response_format"] == "concise"
    assert body["questions"]

    article = next(a for a in body["articles"] if a["article_id"] == str(SEED.primary_article))
    assert article["peer_values_hidden"] is True
    assert "REVIEWER-B-SECRET" not in json.dumps(body)


async def test_get_extractions_detailed_default_with_article(
    mcp_client, pat_reviewer_rw, db_session
):
    template_id, _reviewer_a, _reviewer_b = await _built_review_run_template_id(db_session)

    body = structured(
        await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "get_extractions",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(template_id),
                "article_id": str(SEED.primary_article),
            },
        )
    )
    assert body["response_format"] == "detailed"
    article = body["articles"][0]
    assert article["rows"]
    for row in article["rows"]:
        assert row["decider"] in {"human", "ai", "consensus"}


async def test_response_size_cap_get_extractions(mcp_client, pat_primary_rw, db_session):
    for i in range(12):
        await insert_article(db_session, SEED.primary_project, title=f"cap-article-{i}")

    seen_ids: set[str] = set()
    cursor = None
    page_count = 0
    first_page_len = None
    while True:
        args = {
            "project_id": str(SEED.primary_project),
            "template_id": str(SEED.primary_template),
        }
        if cursor is not None:
            args["cursor"] = cursor
        result = await call_tool(mcp_client, pat_primary_rw, "get_extractions", args)
        body = structured(result)
        assert len(json.dumps(body)) <= 32_000
        if first_page_len is None:
            first_page_len = len(body["articles"])
            assert first_page_len <= 10
        for a in body["articles"]:
            assert a["article_id"] not in seen_ids
            seen_ids.add(a["article_id"])
        page_count += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert page_count > 1
    assert first_page_len is not None and first_page_len <= 10


async def test_get_extractions_bad_arguments(mcp_client, pat_primary_rw):
    args = {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)}

    result = await call_tool(
        mcp_client, pat_primary_rw, "get_extractions", {**args, "response_format": "full"}
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "response_format"

    result = await call_tool(mcp_client, pat_primary_rw, "get_extractions", {**args, "limit": 11})
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "limit"

    result = await call_tool(
        mcp_client, pat_primary_rw, "get_extractions", {**args, "cursor": "!!"}
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "cursor"


async def test_get_extractions_metadata(mcp_client, pat_primary_rw):
    async with mcp_client(pat_primary_rw) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    t = tools["get_extractions"]
    assert t.title and t.output_schema
    a = t.annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        True,
        False,
        True,
        False,
    )
