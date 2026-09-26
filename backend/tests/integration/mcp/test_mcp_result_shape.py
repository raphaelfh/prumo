"""Task 2c: every structured tool result's text copy is the compact JSON of
``structuredContent`` (spec §5.0), not the SDK's default ``indent=2`` dump.

Covers a plain structured tool (``list_projects``) and a tool that already
builds its own ``CallToolResult`` with an extra content block
(``get_article_pdf``): the extra block survives, only the text copy changes.
"""

from __future__ import annotations

import json

from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_pdf
from tests.integration.mcp.tool_calls import call_tool


async def test_list_projects_text_copy_is_compact_json(mcp_client, pat_primary_read):
    result = await call_tool(mcp_client, pat_primary_read, "list_projects", {})

    assert result.is_error is False
    assert len(result.content) == 1
    block = result.content[0]
    assert block.type == "text"
    assert json.loads(block.text) == result.structured_content
    assert block.text == json.dumps(result.structured_content)


async def test_get_article_pdf_text_copy_is_compact_and_keeps_resource_link(
    mcp_client, pat_primary_rw, db_session, fake_storage
):
    article = await insert_article(db_session, SEED.primary_project, title="Compact text copy")
    await insert_pdf(db_session, SEED.primary_project, article)

    result = await call_tool(
        mcp_client, pat_primary_rw, "get_article_pdf", {"article_id": str(article)}
    )

    assert result.is_error is False
    text_blocks = [c for c in result.content if c.type == "text"]
    resource_links = [c for c in result.content if c.type == "resource_link"]
    assert len(text_blocks) == 1
    assert len(resource_links) == 1

    block = text_blocks[0]
    assert json.loads(block.text) == result.structured_content
    assert block.text == json.dumps(result.structured_content)
    # sanity: the compact copy has no SDK-style indentation
    assert "\n" not in block.text
    assert len(fake_storage.calls) == 1
