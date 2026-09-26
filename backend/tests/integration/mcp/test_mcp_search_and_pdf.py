"""search_project_text / get_article_pdf tool-logic tests (task 7b): the
in-memory SDK client, so handler lines register coverage (the ASGI blind
spot)."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import text
from structlog.testing import capture_logs

from app.api.mcp import server
from app.schemas.mcp_articles import McpArticleDetail
from app.schemas.mcp_search import McpArticlePdfResult, McpSearchResult
from app.utils.untrusted import UNTRUSTED_CLOSE, UNTRUSTED_OPEN
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured


async def test_search_project_text_tool(mcp_client, pat_primary_rw, db_session):
    article = await insert_article(db_session, SEED.primary_project, title="Search Tool Article")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    await insert_blocks(db_session, file_id, [(1, 0, "toolsearchmarker occurs here.", "paragraph")])

    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "search_project_text",
            {"project_id": str(SEED.primary_project), "query": "toolsearchmarker"},
        )
    )
    McpSearchResult.model_validate(body)
    assert body["untrusted_content"] is True
    assert len(body["hits"]) == 1

    empty_body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "search_project_text",
            {"project_id": str(SEED.primary_project), "query": "zz-no-match-marker-zz"},
        )
    )
    assert empty_body["hits"] == []
    assert "variant spellings" in empty_body["note"]


async def test_search_query_length_cap(mcp_client, pat_primary_rw):
    too_long = await call_tool(
        mcp_client,
        pat_primary_rw,
        "search_project_text",
        {"project_id": str(SEED.primary_project), "query": "x" * 201},
    )
    assert error_payload(too_long)["field"] == "query"

    bad_cursor = await call_tool(
        mcp_client,
        pat_primary_rw,
        "search_project_text",
        {"project_id": str(SEED.primary_project), "query": "x", "cursor": "!!"},
    )
    assert error_payload(bad_cursor)["field"] == "cursor"


async def test_signed_url_ttl(mcp_client, pat_primary_rw, db_session, fake_storage):
    article = await insert_article(db_session, SEED.primary_project, title="PDF TTL Article")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    storage_key = (
        await db_session.execute(
            text("SELECT storage_key FROM public.article_files WHERE id = :id"),
            {"id": str(file_id)},
        )
    ).scalar_one()

    before = datetime.now(UTC)
    result = await call_tool(
        mcp_client, pat_primary_rw, "get_article_pdf", {"article_id": str(article)}
    )
    after = datetime.now(UTC)

    assert result.is_error is False
    body = result.structured_content
    McpArticlePdfResult.model_validate(body)
    expires_at = datetime.fromisoformat(body["pdf"]["expires_at"])
    delta_low = (expires_at - before).total_seconds()
    delta_high = (expires_at - after).total_seconds()
    assert 595 <= delta_low <= 605
    assert 595 <= delta_high <= 605

    assert fake_storage.calls == [("articles", storage_key, 600)]

    resource_links = [c for c in result.content if c.type == "resource_link"]
    assert len(resource_links) == 1
    assert resource_links[0].uri == body["pdf"]["url"]
    assert resource_links[0].mime_type == "application/pdf"


async def test_signed_url_never_in_span_or_logs(
    mcp_client, pat_primary_rw, db_session, monkeypatch, fake_storage, caplog
):
    article = await insert_article(db_session, SEED.primary_project, title="PDF Secrecy Article")
    await insert_pdf(db_session, SEED.primary_project, article)

    recorded: list[tuple[str, dict]] = []
    attr_calls: list[tuple[str, object]] = []

    class _Span:
        def set_attribute(self, k: str, v: object) -> None:
            attr_calls.append((k, v))

    @contextmanager
    def recorder(name: str, **attrs: object):
        recorded.append((name, attrs))
        yield _Span()

    monkeypatch.setattr(server.logfire, "span", recorder)
    caplog.set_level(logging.DEBUG)

    with capture_logs() as entries:
        result = await call_tool(
            mcp_client, pat_primary_rw, "get_article_pdf", {"article_id": str(article)}
        )

    assert result.is_error is False
    body = result.structured_content
    url = body["pdf"]["url"]
    assert url.startswith("https://storage.test/signed/")

    assert url not in repr(recorded)
    assert url not in repr(entries)
    assert url not in caplog.text
    assert len(fake_storage.calls) == 1  # the signed URL really came from the fake adapter

    span_kwargs_keys = set(recorded[0][1].keys())
    set_attribute_keys = {k for k, _ in attr_calls}
    assert span_kwargs_keys | set_attribute_keys == {
        "tool",
        "token_id",
        "project_id",
        "outcome",
        "response_size",
    }


async def test_no_pdf_marker(mcp_client, pat_primary_rw, db_session, fake_storage):
    article = await insert_article(db_session, SEED.primary_project, title="No PDF Article")
    result = await call_tool(
        mcp_client, pat_primary_rw, "get_article_pdf", {"article_id": str(article)}
    )
    assert result.is_error is False
    body = structured(result)
    assert body["pdf"] is None
    assert body["reason"] == "no_pdf"
    assert body["next_step"] == "this article has no PDF; use get_article for metadata"
    assert not any(c.type == "resource_link" for c in result.content)
    assert fake_storage.calls == []

    other_article = await insert_article(db_session, SEED.primary_project, title="Other Article")
    other_file = await insert_pdf(db_session, SEED.primary_project, other_article)
    foreign_file_result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_article_pdf",
        {"article_id": str(article), "file_id": str(other_file)},
    )
    assert error_payload(foreign_file_result)["code"] == "NOT_FOUND"
    assert fake_storage.calls == []


async def test_untrusted_content_flag(mcp_client, pat_primary_rw, db_session):
    article = await insert_article(db_session, SEED.primary_project, title="Untrusted Article")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    await insert_blocks(
        db_session, file_id, [(1, 0, "untrustedflagmarker occurs here.", "paragraph")]
    )

    article_body = structured(
        await call_tool(mcp_client, pat_primary_rw, "get_article", {"article_id": str(article)})
    )
    McpArticleDetail.model_validate(article_body)
    assert article_body["untrusted_content"] is True

    search_body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "search_project_text",
            {"project_id": str(SEED.primary_project), "query": "untrustedflagmarker"},
        )
    )
    assert search_body["untrusted_content"] is True
    for hit in search_body["hits"]:
        assert hit["snippet"].startswith(UNTRUSTED_OPEN)
        assert hit["snippet"].endswith(UNTRUSTED_CLOSE)

    list_body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "list_articles",
            {"project_id": str(SEED.primary_project)},
        )
    )
    assert list_body["untrusted_content"] is True


async def test_search_and_pdf_metadata(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    for name in ("search_project_text", "get_article_pdf"):
        t = tools[name]
        assert t.title and t.output_schema
        a = t.annotations
        assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
            True,
            False,
            True,
            False,
        )


async def test_response_size_cap_search_project_text(mcp_client, pat_primary_rw, db_session):
    file_ids = []
    for i in range(20):
        article = await insert_article(
            db_session, SEED.primary_project, title="Cap Article " + ("T" * 480)
        )
        file_id = await insert_pdf(db_session, SEED.primary_project, article)
        file_ids.append(file_id)
        await insert_blocks(
            db_session,
            file_id,
            [(1, i, "responsizecapmarker " + ("filler word " * 400), "paragraph")],
        )

    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "search_project_text",
            {"project_id": str(SEED.primary_project), "query": "responsizecapmarker"},
        )
    )
    assert len(body["hits"]) == 20
    assert len(json.dumps(body)) <= 32_000


async def test_search_nul_in_query_is_invalid_argument(mcp_client, pat_primary_read) -> None:
    """F10 (final review): the dispatcher refuses U+0000 in any read tool's
    string argument, naming it, before Postgres sees it."""
    result = await call_tool(
        mcp_client,
        pat_primary_read,
        "search_project_text",
        {"project_id": str(SEED.primary_project), "query": "a\u0000b"},
    )
    payload = error_payload(result)
    assert (payload["code"], payload["field"]) == ("INVALID_ARGUMENT", "query")
