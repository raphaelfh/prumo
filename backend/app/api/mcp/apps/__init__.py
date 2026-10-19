"""MCP Apps (`io.modelcontextprotocol/ui`): static, read-only cards a host may
render inline next to a tool result.

Every App is registered here at import, before ``server.py`` builds the
server with ``extensions=[apps]`` (the SDK applies extensions at
construction). This module imports only the SDK and the standard library,
never ``app.api.mcp.server``. Each card is static HTML with an inline
postMessage bridge and a CSP that allows no outside domain.
"""

from __future__ import annotations

from pathlib import Path

from mcp.server.apps import Apps, ResourceCsp

DRAFT_REVIEW_URI = "ui://prumo/draft-review.html"

_STRICT_CSP = ResourceCsp(
    connect_domains=[], resource_domains=[], frame_domains=[], base_uri_domains=[]
)

apps = Apps()
apps.add_html_resource(
    DRAFT_REVIEW_URI,
    Path(__file__).with_name("draft_review.html").read_text(encoding="utf-8"),
    name="draft-review",
    title="Questionnaire draft review",
    description="A read-only view of a questionnaire's unpublished changes and lint.",
    csp=_STRICT_CSP,
)
