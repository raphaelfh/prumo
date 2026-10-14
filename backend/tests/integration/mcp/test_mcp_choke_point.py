"""The scope/role choke point every MCP tool call passes through (spec §3, §7)."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from uuid import uuid4

import pytest
from limits import parse
from mcp import Client
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import server
from app.core.config import API_VERSION
from tests.integration.conftest import SEED
from tests.integration.mcp.conftest import SeededPat


async def test_tools_list_is_scope_filtered(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_primary_read) as client:
        names = [t.name for t in (await client.list_tools()).tools]
    assert "probe_read" in names
    assert "probe_write" not in names
    assert names == sorted(names)

    async with mcp_client(pat_primary_rw) as client:
        names_rw = [t.name for t in (await client.list_tools()).tools]
    assert "probe_write" in names_rw


async def test_read_token_calling_write_tool_is_scope_insufficient(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_primary_read) as client:
        r = await client.call_tool("probe_write", {"project_id": str(SEED.primary_project)})
    assert r.is_error is True
    assert r.structured_content is not None
    assert r.structured_content["code"] == "SCOPE_INSUFFICIENT"
    assert r.structured_content["retryable"] is False


async def test_outsider_gets_identical_not_found_for_missing_and_foreign(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_outsider_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_outsider_rw) as client:
        r_foreign = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        r_missing = await client.call_tool("probe_read", {"project_id": str(uuid4())})

    assert r_foreign.structured_content is not None
    assert r_missing.structured_content is not None
    assert r_foreign.structured_content["code"] == "NOT_FOUND"
    assert r_missing.structured_content["code"] == "NOT_FOUND"
    assert r_foreign.structured_content["message"] == r_missing.structured_content["message"]


async def test_reviewer_is_manager_required_for_write(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_reviewer_rw: SeededPat,
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_reviewer_rw) as client:
        r = await client.call_tool("probe_write", {"project_id": str(SEED.primary_project)})
        assert r.structured_content is not None
        assert r.structured_content["code"] == "MANAGER_REQUIRED"

        r_read = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        assert r_read.is_error is False

        r_article = await client.call_tool(
            "probe_article", {"article_id": str(SEED.primary_article)}
        )
        assert r_article.is_error is False

        r_missing_article = await client.call_tool("probe_article", {"article_id": str(uuid4())})
        assert r_missing_article.structured_content is not None
        assert r_missing_article.structured_content["code"] == "NOT_FOUND"

    async with mcp_client(pat_primary_rw) as client:
        r_ok = await client.call_tool("probe_write", {"project_id": str(SEED.primary_project)})
        assert r_ok.is_error is False
        assert r_ok.structured_content == {"ok": True, "user_sub": None}


async def test_member_removed_while_token_live(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_reviewer_rw: SeededPat,
    db_session: AsyncSession,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_reviewer_rw) as client:
        r_ok = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        assert r_ok.is_error is False

        await db_session.execute(
            text("DELETE FROM public.project_members WHERE project_id = :p AND user_id = :u"),
            {"p": str(SEED.primary_project), "u": str(SEED.reviewer_profile)},
        )

        r_gone = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        assert r_gone.structured_content is not None
        assert r_gone.structured_content["code"] == "NOT_FOUND"


async def test_rate_limit_per_token(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(server, "_READ_LIMIT", parse("2/minute"))

    async with mcp_client(pat_primary_read) as client:
        r1 = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        r2 = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        r3 = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
    assert r1.is_error is False
    assert r2.is_error is False
    assert r3.structured_content is not None
    assert r3.structured_content["code"] == "RATE_LIMITED"
    assert r3.structured_content["retryable"] is True
    assert r3.structured_content["retry_after_seconds"] >= 1

    async with mcp_client(pat_primary_rw) as client:
        r_other = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
    assert r_other.is_error is False


async def test_write_tools_use_the_write_bucket(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(server, "_WRITE_LIMIT", parse("1/minute"))

    async with mcp_client(pat_primary_rw) as client:
        r1 = await client.call_tool("probe_write", {"project_id": str(SEED.primary_project)})
        r2 = await client.call_tool("probe_write", {"project_id": str(SEED.primary_project)})
        r_read = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})

    assert r1.is_error is False
    assert r2.structured_content is not None
    assert r2.structured_content["code"] == "RATE_LIMITED"
    assert r_read.is_error is False


async def test_unexpected_validation_error_is_internal_and_logged(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Recorder:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict]] = []

        def exception(self, event: str, **kw: object) -> None:
            self.calls.append((event, kw))

    recorder = _Recorder()
    monkeypatch.setattr(server, "logger", recorder)

    async with mcp_client(pat_primary_rw) as client:
        r = await client.call_tool("probe_boom", {})

    assert r.structured_content is not None
    assert r.structured_content["code"] == "INTERNAL_ERROR"
    assert r.structured_content["retryable"] is False
    matching = [c for c in recorder.calls if c[0] == "mcp_tool_internal_error"]
    assert len(matching) == 1
    assert matching[0][1]["tool"] == "probe_boom"


async def test_structured_output_switch(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_primary_rw) as client:
        tools = (await client.list_tools()).tools
        text_tool = next(t for t in tools if t.name == "probe_text")
        assert text_tool.output_schema is None
        read_tool = next(t for t in tools if t.name == "probe_read")
        assert read_tool.output_schema is not None

        r = await client.call_tool("probe_text", {})
    assert r.is_error is False
    assert r.structured_content is None
    assert len(r.content) == 1
    assert r.content[0].type == "text"
    assert r.content[0].text == "plain"


async def test_server_info_instructions_and_cache_hints(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_rw: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_primary_rw) as client:
        assert client.server_info is not None
        assert client.server_info.name == "prumo"
        assert client.server_info.version == API_VERSION
        assert client.instructions is not None
        assert len(client.instructions) <= 2048
        assert "list_projects" in client.instructions
        assert "untrusted" in client.instructions
        assert "Publish" in client.instructions

        result = await client.list_tools()
        assert result.ttl_ms == 3_600_000
        assert result.cache_scope == "private"
        for tool in result.tools:
            assert tool.title
            assert tool.annotations is not None
            assert tool.annotations.open_world_hint is False


async def test_tool_call_span_carries_no_secret(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    probe_tools: None,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Span:
        def __init__(self, name: str, **attrs: object) -> None:
            self.name = name
            self.attrs = dict(attrs)

        def __enter__(self) -> _Span:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

        def set_attribute(self, key: str, value: object) -> None:
            self.attrs[key] = value

    spans: list[_Span] = []

    def _span(name: str, **attrs: object) -> _Span:
        span = _Span(name, **attrs)
        spans.append(span)
        return span

    class _Logfire:
        span = staticmethod(_span)

    monkeypatch.setattr(server, "logfire", _Logfire())

    async with mcp_client(pat_primary_read) as client:
        result = await client.call_tool("probe_read", {"project_id": str(SEED.primary_project)})
        refused = await client.call_tool("probe_read", {"project_id": str(uuid4())})

    assert len(spans) == 2
    # spec §6.3: the span carries the result's size -- its compact text copy.
    assert spans[0].attrs["response_size"] == len(result.content[0].text)
    assert spans[1].attrs["response_size"] == len(refused.content[0].text)
    span = spans[0]
    assert span.name == "mcp.tool_call"
    assert span.attrs["tool"] == "probe_read"
    assert "token_id" in span.attrs
    assert "project_id" in span.attrs
    assert span.attrs["outcome"] == "ok"
    for value in span.attrs.values():
        assert "prumo_pat_" not in str(value)


# --- argument validation inside the envelope (PRU-80 / PRU-81) ---------------


async def test_malformed_argument_is_invalid_argument_naming_the_field(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
) -> None:
    async with mcp_client(pat_primary_read) as client:
        r = await client.call_tool("get_project", {"project_id": "abc"})
    assert r.is_error is True
    assert r.structured_content is not None
    assert r.structured_content["code"] == "INVALID_ARGUMENT"
    assert r.structured_content["field"] == "project_id"
    assert r.structured_content["retryable"] is False
    assert "pydantic" not in r.content[0].text
    assert "Error executing tool" not in r.content[0].text


async def test_read_token_with_bad_arguments_to_write_tool_is_scope_insufficient(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    probe_tools: None,  # noqa: ARG001
) -> None:
    async with mcp_client(pat_primary_read) as client:
        r = await client.call_tool("probe_write", {"project_id": "abc"})
    assert r.structured_content is not None
    assert r.structured_content["code"] == "SCOPE_INSUFFICIENT"


async def test_bad_arguments_are_charged_to_the_rate_tier(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    probe_tools: None,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(server, "_READ_LIMIT", parse("1/minute"))
    async with mcp_client(pat_primary_read) as client:
        r1 = await client.call_tool("probe_read", {"project_id": "abc"})
        r2 = await client.call_tool("probe_read", {"project_id": "abc"})
    assert r1.structured_content is not None
    assert r1.structured_content["code"] == "INVALID_ARGUMENT"
    assert r2.structured_content is not None
    assert r2.structured_content["code"] == "RATE_LIMITED"
    assert r2.structured_content["retry_after_seconds"] >= 1


@pytest.mark.parametrize("limit", [0, -1, 51, 2**31], ids=["zero", "negative", "over", "int4"])
async def test_list_articles_limit_out_of_range_is_invalid_argument(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    limit: int,
) -> None:
    async with mcp_client(pat_primary_read) as client:
        r = await client.call_tool(
            "list_articles", {"project_id": str(SEED.primary_project), "limit": limit}
        )
    assert r.structured_content is not None
    assert (r.structured_content["code"], r.structured_content["field"]) == (
        "INVALID_ARGUMENT",
        "limit",
    )


def _branches(schema: dict) -> list[dict]:
    """A property's schema, or each branch of its ``anyOf`` (an optional arg)."""
    return schema.get("anyOf", [schema])


async def test_tools_list_advertises_argument_bounds(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_rw: SeededPat,
) -> None:
    async with mcp_client(pat_primary_rw) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}

    bounded = 0
    for tool in tools.values():
        for name, prop in tool.input_schema.get("properties", {}).items():
            if name in {"limit", "page_from", "page_to"}:
                ints = [b for b in _branches(prop) if b.get("type") == "integer"]
                assert ints, (tool.name, name)
                for branch in ints:
                    assert "minimum" in branch and "maximum" in branch, (tool.name, name)
                    bounded += 1
            if name == "response_format":
                enums = [b for b in _branches(prop) if "enum" in b]
                assert enums and set(enums[0]["enum"]) == {"concise", "detailed"}, tool.name
    assert bounded == 4  # list_articles.limit, get_extractions.limit, page_from, page_to

    ops = tools["edit_template_draft"].input_schema["properties"]["ops"]
    assert ops["maxItems"] == 25
    op_names: set[str] = set()
    for branch in ops["items"]["oneOf"]:
        op_names |= set(
            branch["properties"]["op"].get("enum", [branch["properties"]["op"].get("const")])
        )
    assert op_names == {"add_question", "update_question"}

    details = tools["update_project_details"].input_schema["properties"]
    for key in ("fields", "expected"):
        assert details[key]["additionalProperties"] is False
        assert len(details[key]["properties"]) == 11


class _Out(BaseModel):  # module level: agent_tool evaluates the annotations by name
    x: int


class _Wrong(BaseModel):
    x: str


async def test_output_schema_failure_is_not_the_callers_invalid_argument(
    mcp_client: Callable[[SeededPat], AbstractAsyncContextManager[Client]],
    pat_primary_read: SeededPat,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tool RESULT failing its output schema is a server bug the SDK raises
    as `UnexpectedToolError` (cause: a ValidationError) AFTER `_dispatch` ran:
    never re-answered as INVALID_ARGUMENT, never charged twice."""
    runs: list[int] = []

    async def probe_bad_output(db: AsyncSession) -> _Out:  # noqa: ARG001
        runs.append(1)
        return _Wrong(x="not-an-int")  # type: ignore[return-value]

    hits: list[str] = []
    real_hit = server.hit_shared

    def _counting_hit(*args: object, **kwargs: object) -> bool:
        hits.append(str(args[1:]))
        return real_hit(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(server, "hit_shared", _counting_hit)
    server.agent_tool(requires="read", project_arg=None, title="Probe out", description="test")(
        probe_bad_output
    )
    try:
        async with mcp_client(pat_primary_read) as client:
            r = await client.call_tool("probe_bad_output", {})
    finally:
        server.mcp.remove_tool("probe_bad_output")
        server._RULES.pop("probe_bad_output", None)

    assert r.is_error is True
    assert (r.structured_content or {}).get("code") != "INVALID_ARGUMENT"
    assert len(runs) == 1
    assert len(hits) == 1
