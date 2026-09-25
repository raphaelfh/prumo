"""F3 (final review): a well-formed cursor carrying a malformed VALUE (a bad
uuid, a non-int, negative or past-int4 position, a rank outside Postgres
`real`, a NUL or lone surrogate in a text slot) is the caller's
INVALID_ARGUMENT on `cursor`, never an INTERNAL_ERROR from a Python cast or
a Postgres CAST, and never a negative-index wrap-around."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.utils.opaque_cursor import encode_cursor
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf
from tests.integration.mcp.tool_calls import call_tool, error_payload

_PROJECT = {"project_id": str(SEED.primary_project)}


@pytest.mark.parametrize(
    "values",
    [
        ["title", "not-a-uuid"],
        ["ti\x00tle", str(uuid4())],
        ["\ud800", str(uuid4())],
        [7, str(uuid4())],
    ],
    ids=["bad-uuid", "nul-title", "surrogate-title", "int-title"],
)
async def test_list_articles_rejects_bad_cursor_values(
    mcp_client: Any, pat_primary_read: Any, values: list[str | int]
) -> None:
    result = await call_tool(
        mcp_client, pat_primary_read, "list_articles", {**_PROJECT, "cursor": encode_cursor(values)}
    )
    payload = error_payload(result)
    assert (payload["code"], payload["field"]) == ("INVALID_ARGUMENT", "cursor")


@pytest.mark.parametrize(
    "values",
    [
        ["0.5", "not-a-uuid"],
        ["not-a-rank", str(uuid4())],
        ["1e300", str(uuid4())],
        ["1e-300", str(uuid4())],
        [10**400, str(uuid4())],
    ],
    ids=["bad-uuid", "bad-rank", "rank-overflow", "rank-underflow", "rank-huge-int"],
)
async def test_search_rejects_bad_cursor_values(
    mcp_client: Any, pat_primary_read: Any, values: list[str | int]
) -> None:
    result = await call_tool(
        mcp_client,
        pat_primary_read,
        "search_project_text",
        {**_PROJECT, "query": "anything", "cursor": encode_cursor(values)},
    )
    payload = error_payload(result)
    assert (payload["code"], payload["field"]) == ("INVALID_ARGUMENT", "cursor")


@pytest.mark.parametrize(
    "values",
    [
        ["not-a-uuid", 0, "concise", ""],
        [str(uuid4()), "x", "concise", ""],
        [str(uuid4()), -1, "concise", ""],
        [str(uuid4()), 10**20, "concise", ""],
    ],
    ids=["bad-uuid", "non-int", "negative", "past-int4"],
)
async def test_get_extractions_rejects_bad_cursor_values(
    mcp_client: Any, pat_primary_read: Any, values: list[str | int]
) -> None:
    result = await call_tool(
        mcp_client,
        pat_primary_read,
        "get_extractions",
        {
            **_PROJECT,
            "template_id": str(SEED.primary_template),
            "response_format": "concise",
            "cursor": encode_cursor(values),
        },
    )
    payload = error_payload(result)
    assert (payload["code"], payload["field"]) == ("INVALID_ARGUMENT", "cursor")


@pytest.mark.parametrize(
    "values",
    [["x", 0, 0], [1, 0, -5], [-1, 0, 0], [10**20, 0, 0], [1, 10**20, 0], [1, 0, 2**31]],
    ids=[
        "non-int",
        "negative-offset",
        "negative-page",
        "past-int4-page",
        "past-int4-index",
        "past-int4-offset",
    ],
)
async def test_get_article_text_rejects_bad_cursor_values(
    mcp_client: Any, pat_primary_read: Any, db_session: Any, values: list[str | int]
) -> None:
    article_id = await insert_article(db_session, SEED.primary_project, title="Cursor values")
    file_id = await insert_pdf(db_session, SEED.primary_project, article_id)
    await insert_blocks(db_session, file_id, [(1, 0, "Some body text.", "paragraph")])

    result = await call_tool(
        mcp_client,
        pat_primary_read,
        "get_article_text",
        {"article_id": str(article_id), "cursor": encode_cursor(values)},
    )
    payload = error_payload(result)
    assert (payload["code"], payload["field"]) == ("INVALID_ARGUMENT", "cursor")
