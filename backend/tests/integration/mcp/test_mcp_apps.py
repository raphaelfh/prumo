"""MCP Apps: the read-only draft-review card bound to ``get_template`` and the
AI-run card bound to ``plan_ai_run`` and ``get_ai_runs``.

Each App is a static HTML resource with a strict CSP; only those three tools
carry ``ui`` meta; the tool result is the same whether or not the client
advertises Apps support; ``editor_url`` is manager-only."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from mcp.server.apps import APP_MIME_TYPE
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import apps as mcp_apps
from app.api.mcp import server
from app.utils import app_urls
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import add_section, fresh_charms
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

_DRAFT_REVIEW = "ui://prumo/draft-review.html"
_AI_RUN = "ui://prumo/ai-run.html"
_FILES = {_DRAFT_REVIEW: "draft_review.html", _AI_RUN: "ai_run.html"}
_UI_MAP = {"get_template": _DRAFT_REVIEW, "plan_ai_run": _AI_RUN, "get_ai_runs": _AI_RUN}
_STRICT_CSP = {
    "connectDomains": [],
    "resourceDomains": [],
    "frameDomains": [],
    "baseUriDomains": [],
}


def _html(file: str = "draft_review.html") -> str:
    return Path(mcp_apps.__file__).with_name(file).read_text(encoding="utf-8")


async def test_only_the_two_apps_are_listed(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        listed = await client.list_resources()

    assert {str(r.uri) for r in listed.resources} == {_DRAFT_REVIEW, _AI_RUN}


@pytest.mark.parametrize("uri", [_DRAFT_REVIEW, _AI_RUN])
async def test_app_is_served_with_a_strict_csp(mcp_client, pat_primary_read, uri):
    async with mcp_client(pat_primary_read) as client:
        read = await client.read_resource(uri)

    assert len(read.contents) == 1
    content = read.contents[0]
    assert content.mime_type == APP_MIME_TYPE
    assert content.text == _html(_FILES[uri])
    assert content.meta == {"ui": {"csp": _STRICT_CSP}}


@pytest.mark.parametrize("file", ["draft_review.html", "ai_run.html"])
def test_card_html_is_static(file):
    html = _html(file)
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"):
        assert banned not in html, banned
    assert "eval(" not in html
    assert "Function(" not in html
    assert re.search(r"\b(src|href)\s*=", html) is None
    assert re.search(r"https?://", html) is None
    assert "url(" not in html
    assert "@import" not in html
    for needed in ("ui/initialize", "ui/notifications/tool-result", "textContent"):
        assert needed in html, needed
    assert html.count("<script") == 1


def test_draft_card_calls_no_tool():
    html = _html()
    assert "tools/call" not in html
    assert "ui/open-link" in html
    # "publish" only in the link label, the no-draft state text and the
    # result field the summary reads: no publish control, no "is live" claim.
    rest = html.lower()
    for allowed in ("review and publish in prumo", "no unpublished changes", "published_version"):
        rest = rest.replace(allowed, "")
    assert "publish" not in rest


def test_ai_run_card_calls_only_get_ai_runs():
    html = _html("ai_run.html")
    assert html.count("tools/call") == 1
    for needed in ("get_ai_runs", "30000", "visibilityState", "Load more"):
        assert needed in html, needed
    for banned in ("start_ai_run", "cancel_ai_run", "plan_ai_run", "<button", "ui/open-link"):
        assert banned not in html, banned
    names = re.findall(r"\b(?:get|set|edit|update|start|cancel|plan|list)_[a-z_]+\b", html)
    assert names and set(names) == {"get_ai_runs"}


async def test_ui_meta_map_is_pinned(mcp_client, pat_primary_rw_ai_run):
    async with mcp_client(pat_primary_rw_ai_run) as client:
        tools = (await client.list_tools()).tools
    assert {t.name: t.meta["ui"]["resourceUri"] for t in tools if t.meta and "ui" in t.meta} == (
        _UI_MAP
    )


def test_unregistered_ui_resource_is_refused_at_registration():
    before = set(server._RULES)
    with pytest.raises(TypeError, match="nope.html"):
        server.agent_tool(
            requires="read",
            project_arg="project_id",
            title="x",
            description="x",
            destructive=False,
            ui_resource="ui://prumo/nope.html",
        )
    assert set(server._RULES) == before


async def test_ui_meta_merges_with_requires_user_interaction(mcp_client, pat_primary_rw_ai_run):
    async def probe_prompted_ui(db: AsyncSession, project_id: Any) -> dict:  # noqa: ARG001
        return {}

    server.agent_tool(
        requires="ai_run",
        role="reviewer",
        tier="ai_start",
        read_only=False,
        open_world=True,
        requires_user_interaction=True,
        project_arg="project_id",
        title="Probe prompted ui",
        description="test",
        destructive=True,
        idempotent=False,
        ui_resource=mcp_apps.DRAFT_REVIEW_URI,
    )(probe_prompted_ui)
    try:
        async with mcp_client(pat_primary_rw_ai_run) as client:
            tools = {t.name: t for t in (await client.list_tools()).tools}
    finally:
        server.mcp.remove_tool("probe_prompted_ui")
        server._RULES.pop("probe_prompted_ui", None)
    assert tools["probe_prompted_ui"].meta == {
        "anthropic/requiresUserInteraction": True,
        "ui": {"resourceUri": _DRAFT_REVIEW},
    }


async def _open_draft(db: AsyncSession) -> tuple[UUID, UUID, str]:
    project_id, template_id, _schema = await fresh_charms(db)
    await add_section(db, template_id, "Apps card section")
    kind = (
        await db.execute(
            text("SELECT kind FROM public.project_extraction_templates WHERE id = :t"),
            {"t": str(template_id)},
        )
    ).scalar_one()
    return project_id, template_id, str(getattr(kind, "value", kind))


@pytest.mark.parametrize("view", ["published", "draft", "changes"])
async def test_result_is_identical_with_and_without_apps(
    mcp_client, pat_primary_rw, db_session, view
):
    project_id, template_id, _kind = await _open_draft(db_session)
    args = {"project_id": str(project_id), "template_id": str(template_id), "view": view}
    async with mcp_client(pat_primary_rw) as client:
        plain = await client.call_tool("get_template", args)
    async with mcp_client(pat_primary_rw, apps=True) as client:
        with_apps = await client.call_tool("get_template", args)

    assert not plain.is_error
    assert plain.structured_content == with_apps.structured_content
    assert plain.content[0].text == with_apps.content[0].text


@pytest.mark.parametrize("view", ["published", "draft", "changes"])
async def test_manager_gets_the_editor_url(mcp_client, pat_primary_rw, db_session, view):
    project_id, template_id, kind = await _open_draft(db_session)
    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "get_template",
            {"project_id": str(project_id), "template_id": str(template_id), "view": view},
        )
    )
    assert body["editor_url"] == app_urls.editor_url(project_id, kind)


async def test_reviewer_gets_no_editor_url(mcp_client, pat_reviewer_rw):
    args = {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)}
    body = structured(await call_tool(mcp_client, pat_reviewer_rw, "get_template", args))
    assert body["draft_open"] is None  # precondition: not a manager
    assert body["editor_url"] is None

    refused = await call_tool(
        mcp_client, pat_reviewer_rw, "get_template", {**args, "view": "draft"}
    )
    assert error_payload(refused)["code"] == "MANAGER_REQUIRED"
