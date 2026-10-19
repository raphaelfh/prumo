"""The grant-gated ``run_ai_extraction`` prompt (ADR 0021 R11): listed and
rendered only for a credential holding ``ai_run``; an ungranted request is
refused exactly like an unknown prompt name, with no message text."""

from __future__ import annotations

from uuid import uuid4

import pytest
from mcp.server.mcpserver.prompts import Prompt
from mcp.shared.exceptions import MCPError

from app.api.mcp.server import mcp
from tests.integration.mcp.conftest import SeededPat

_NAME = "run_ai_extraction"
_ECHOES = ("expected_article_count", "expected_model", "expected_payer")


async def _refusal(mcp_client, pat: SeededPat, name: str, arguments=None) -> MCPError:
    async with mcp_client(pat) as client:
        with pytest.raises(MCPError) as caught:
            await client.get_prompt(name, arguments)
    return caught.value


async def _text(mcp_client, pat: SeededPat, arguments=None) -> str:
    async with mcp_client(pat) as client:
        result = await client.get_prompt(_NAME, arguments)
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
    return result.messages[0].content.text


async def test_prompt_is_not_listed_without_the_grant(mcp_client, pat_primary_rw):
    async with mcp_client(pat_primary_rw) as client:
        listed = await client.list_prompts()
    assert _NAME not in {p.name for p in listed.prompts}


async def test_prompt_is_listed_with_the_grant(mcp_client, pat_primary_read_ai_run):
    async with mcp_client(pat_primary_read_ai_run) as client:
        listed = await client.list_prompts()
    (prompt,) = [p for p in listed.prompts if p.name == _NAME]
    assert prompt.title
    assert prompt.description
    assert [(a.name, a.required) for a in prompt.arguments or []] == [("project", False)]


async def test_ungranted_get_is_refused_like_an_unknown_prompt(mcp_client, pat_primary_rw):
    ungranted = await _refusal(mcp_client, pat_primary_rw, _NAME)
    unknown = await _refusal(mcp_client, pat_primary_rw, "no_such_prompt")

    assert ungranted.code == unknown.code
    assert ungranted.message.replace(_NAME, "<name>") == unknown.message.replace(
        "no_such_prompt", "<name>"
    )
    assert ungranted.data == unknown.data
    assert "plan_ai_run" not in ungranted.message


async def test_granted_get_renders_the_approval_steps(mcp_client, pat_primary_read_ai_run):
    text = await _text(mcp_client, pat_primary_read_ai_run)

    for tool in ("plan_ai_run", "start_ai_run", "get_ai_runs"):
        assert tool in text
    assert "explicit" in text
    # The order the steps walk: plan, then the confirmation, then start.
    assert text.index("plan_ai_run") < text.index("start_ai_run") < text.index("get_ai_runs")


async def test_a_project_that_is_not_a_uuid_is_refused(mcp_client, pat_primary_read_ai_run):
    refusal = await _refusal(mcp_client, pat_primary_read_ai_run, _NAME, {"project": "not-a-uuid"})

    assert "INVALID_ARGUMENT" in refusal.message
    assert "not-a-uuid" not in refusal.message


async def test_a_valid_project_uuid_appears_in_the_text(mcp_client, pat_primary_read_ai_run):
    project = uuid4()

    text = await _text(mcp_client, pat_primary_read_ai_run, {"project": str(project).upper()})

    assert str(project) in text
    assert str(project).upper() not in text  # interpolated as a parsed UUID, not the raw input


async def test_the_steps_name_each_start_argument_and_its_plan_value(
    mcp_client, pat_primary_read_ai_run
):
    text = await _text(mcp_client, pat_primary_read_ai_run)

    for arg, source in zip(
        _ECHOES, ("confirm.article_count", "confirm.model", "confirm.payer"), strict=True
    ):
        assert f"{arg} = {source}" in text


async def test_start_ai_run_description_names_each_echo_argument(mcp_client, pat_primary_rw_ai_run):
    async with mcp_client(pat_primary_rw_ai_run) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}

    description = tools["start_ai_run"].description or ""
    for arg in _ECHOES:
        assert arg in description


async def test_a_prompt_without_a_recorded_scope_is_hidden_not_a_crash(
    mcp_client, pat_primary_read_ai_run
):
    """Registered past ``agent_prompt`` (no scope recorded): never listed."""

    def stray() -> str:
        return "stray"

    mcp.add_prompt(Prompt.from_function(stray, name="stray_prompt", description="test"))
    try:
        async with mcp_client(pat_primary_read_ai_run) as client:
            names = {p.name for p in (await client.list_prompts()).prompts}
    finally:
        mcp._prompt_manager._prompts.pop("stray_prompt")

    assert _NAME in names and "stray_prompt" not in names
