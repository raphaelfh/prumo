"""list_articles / get_article tool-logic tests (task 6b): the in-memory SDK
client, so handler lines register coverage (the ASGI blind spot)."""

import json

from sqlalchemy import text

from app.schemas.mcp_articles import McpArticleDetail, McpArticleList
from app.utils.opaque_cursor import decode_cursor, encode_cursor
from app.utils.untrusted import UNTRUSTED_CLOSE, UNTRUSTED_OPEN
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured


async def test_list_articles_tool(mcp_client, pat_primary_rw):
    body = structured(
        await call_tool(
            mcp_client, pat_primary_rw, "list_articles", {"project_id": str(SEED.primary_project)}
        )
    )
    McpArticleList.model_validate(body)
    assert body["untrusted_content"] is True


async def test_list_articles_empty(mcp_client, pat_primary_rw):
    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "list_articles",
            {"project_id": str(SEED.primary_project), "query": "zz-no-match-zz"},
        )
    )
    assert body["articles"] == []
    assert body["next_cursor"] is None


async def test_list_articles_bad_arguments(mcp_client, pat_primary_rw):
    too_high_limit = await call_tool(
        mcp_client,
        pat_primary_rw,
        "list_articles",
        {"project_id": str(SEED.primary_project), "limit": 51},
    )
    payload = error_payload(too_high_limit)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "limit"

    too_long_query = await call_tool(
        mcp_client,
        pat_primary_rw,
        "list_articles",
        {"project_id": str(SEED.primary_project), "query": "x" * 201},
    )
    assert error_payload(too_long_query)["field"] == "query"

    bad_cursor = await call_tool(
        mcp_client,
        pat_primary_rw,
        "list_articles",
        {"project_id": str(SEED.primary_project), "cursor": "!!"},
    )
    assert error_payload(bad_cursor)["field"] == "cursor"


async def test_cursor_tampering_stays_in_scope(mcp_client, pat_primary_rw, db_session):
    a1 = await insert_article(db_session, SEED.primary_project, title="ZQ-Cursor-1")
    a2 = await insert_article(db_session, SEED.primary_project, title="ZQ-Cursor-2")
    a3 = await insert_article(db_session, SEED.primary_project, title="ZQ-Cursor-3")
    secondary = await insert_article(
        db_session, SEED.secondary_project, title="ZQ-Secondary-Only-Article"
    )

    page1 = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "list_articles",
            {"project_id": str(SEED.primary_project), "query": "ZQ-Cursor", "limit": 1},
        )
    )
    assert page1["next_cursor"] is not None
    values = decode_cursor(page1["next_cursor"], arity=2)
    assert values is not None

    secondary_title = (
        await db_session.execute(
            text("SELECT title FROM public.articles WHERE id = :id"), {"id": str(secondary)}
        )
    ).scalar_one()
    tampered = encode_cursor([secondary_title, str(secondary)])

    replayed = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "list_articles",
            {"project_id": str(SEED.primary_project), "cursor": tampered},
        )
    )
    returned_ids = {row["article_id"] for row in replayed["articles"]}
    assert returned_ids <= {str(a1), str(a2), str(a3), str(SEED.primary_article)}
    assert secondary_title not in {row["title"] for row in replayed["articles"]}


async def test_get_article_tool(mcp_client, pat_primary_rw, db_session):
    article_id = await insert_article(db_session, SEED.primary_project, title="ZQ-Get-Article")
    await db_session.execute(
        text("UPDATE public.articles SET abstract = :abstract WHERE id = :id"),
        {"abstract": "The abstract body.", "id": str(article_id)},
    )
    old_pdf = await insert_pdf(db_session, SEED.primary_project, article_id)
    new_pdf = await insert_pdf(db_session, SEED.primary_project, article_id)
    await insert_blocks(db_session, new_pdf, [(1, 0, "Intro", "heading")])
    await insert_blocks(db_session, old_pdf, [(1, 0, "Old Intro", "heading")])

    body = structured(
        await call_tool(mcp_client, pat_primary_rw, "get_article", {"article_id": str(article_id)})
    )
    McpArticleDetail.model_validate(body)
    assert body["abstract"].startswith(UNTRUSTED_OPEN)
    assert body["abstract"].endswith(UNTRUSTED_CLOSE)
    assert body["outline"]["article_file_id"] == str(new_pdf)

    with_old_file = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "get_article",
            {"article_id": str(article_id), "file_id": str(old_pdf)},
        )
    )
    assert with_old_file["outline"]["article_file_id"] == str(old_pdf)


async def test_get_article_wraps_outline_headings(mcp_client, pat_primary_rw, db_session):
    # Outline headings are PDF-derived text (spec §5.0): wrapped like the
    # abstract, not just flagged by the top-level untrusted_content bit.
    article_id = await insert_article(db_session, SEED.primary_project, title="ZQ-Wrapped-Outline")
    file_id = await insert_pdf(db_session, SEED.primary_project, article_id)
    await insert_blocks(
        db_session,
        file_id,
        [(1, 0, "Intro", "heading"), (2, 0, "Methods", "heading")],
    )

    body = structured(
        await call_tool(mcp_client, pat_primary_rw, "get_article", {"article_id": str(article_id)})
    )
    McpArticleDetail.model_validate(body)
    assert body["untrusted_content"] is True
    headings = body["outline"]["headings"]
    assert len(headings) == 2
    for heading in headings:
        assert heading["text"].startswith(UNTRUSTED_OPEN)
        assert heading["text"].endswith(UNTRUSTED_CLOSE)
    assert "Intro" in headings[0]["text"]
    assert "Methods" in headings[1]["text"]


async def test_get_article_without_pdf(mcp_client, pat_primary_rw, db_session):
    article_id = await insert_article(db_session, SEED.primary_project, title="ZQ-No-Pdf")
    result = await call_tool(
        mcp_client, pat_primary_rw, "get_article", {"article_id": str(article_id)}
    )
    assert result.is_error is False
    body = structured(result)
    assert body["outline"] is None
    assert body["files"] == []


async def test_article_tools_metadata(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    for name in ("list_articles", "get_article"):
        t = tools[name]
        assert t.title and t.output_schema
        a = t.annotations
        assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
            True,
            False,
            True,
            False,
        )


async def test_response_size_cap_list_articles(mcp_client, pat_primary_rw, db_session):
    for i in range(50):
        await insert_article(
            db_session,
            SEED.primary_project,
            title=f"ZQ-Size-{i}-" + ("T" * 480),
            authors=[f"Author {a}" * 8 for a in range(10)],
        )
    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "list_articles",
            {"project_id": str(SEED.primary_project), "query": "ZQ-Size", "limit": 50},
        )
    )
    assert len(json.dumps(body)) <= 32_000

    article_id = await insert_article(db_session, SEED.primary_project, title="ZQ-Size-Detail")
    await db_session.execute(
        text("UPDATE public.articles SET abstract = :abstract WHERE id = :id"),
        {"abstract": "x" * 20_000, "id": str(article_id)},
    )
    file_id = await insert_pdf(db_session, SEED.primary_project, article_id)
    await insert_blocks(db_session, file_id, [(1, i, "H" * 300, "heading") for i in range(70)])
    detail_body = structured(
        await call_tool(mcp_client, pat_primary_rw, "get_article", {"article_id": str(article_id)})
    )
    assert len(json.dumps(detail_body)) <= 32_000
