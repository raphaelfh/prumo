"""MCP Apps: the read-only draft-review card bound to ``get_template``.

The App is a static HTML resource with a strict CSP; only ``get_template``
carries ``ui`` meta; the tool result is the same whether or not the client
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
_UI_MAP = {"get_template": _DRAFT_REVIEW}
_STRICT_CSP = {
    "connectDomains": [],
    "resourceDomains": [],
    "frameDomains": [],
    "baseUriDomains": [],
}


def _html() -> str:
    return Path(mcp_apps.__file__).with_name("draft_review.html").read_text(encoding="utf-8")


async def test_only_the_draft_review_app_is_listed(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        listed = await client.list_resources()
        read = await client.read_resource(_DRAFT_REVIEW)

    assert {str(r.uri) for r in listed.resources} == {_DRAFT_REVIEW}
    assert len(read.contents) == 1
    content = read.contents[0]
    assert content.mime_type == APP_MIME_TYPE
    assert content.text == _html()
    assert content.meta == {"ui": {"csp": _STRICT_CSP}}


def test_card_html_is_inert():
    html = _html()
    for banned in ("tools/call", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"):
        assert banned not in html, banned
    assert "eval(" not in html
    assert "Function(" not in html
    assert re.search(r"\b(src|href)\s*=", html) is None
    assert re.search(r"https?://", html) is None
    assert "url(" not in html
    assert "@import" not in html
    # "publish" only in the link label, the no-draft state text and the
    # result field the summary reads: no publish control, no "is live" claim.
    rest = html.lower()
    for allowed in ("review and publish in prumo", "no unpublished changes", "published_version"):
        rest = rest.replace(allowed, "")
    assert "publish" not in rest
    for needed in ("ui/initialize", "ui/notifications/tool-result", "ui/open-link", "textContent"):
        assert needed in html, needed
    assert html.count("<script") == 1


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
