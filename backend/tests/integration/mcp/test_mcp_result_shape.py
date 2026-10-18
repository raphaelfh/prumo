"""Task 2c: every structured tool result's text copy is the compact JSON of
``structuredContent`` (spec §5.0), not the SDK's default ``indent=2`` dump.

Covers a plain structured tool (``list_projects``) and a tool that already
builds its own ``CallToolResult`` with an extra content block
(``get_article_pdf``): the extra block survives, and its text copy points at
the signed URL instead of repeating it (task 1.9b).
"""

from __future__ import annotations

import json

from sqlalchemy import text

from app.utils.compact_json import compact_json
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf
from tests.integration.mcp.tool_calls import call_tool, structured


async def test_list_projects_text_copy_is_compact_json(mcp_client, pat_primary_read):
    result = await call_tool(mcp_client, pat_primary_read, "list_projects", {})

    assert result.is_error is False
    assert len(result.content) == 1
    block = result.content[0]
    assert block.type == "text"
    assert json.loads(block.text) == result.structured_content
    assert block.text == compact_json(result.structured_content)


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
    url = result.structured_content["pdf"]["url"]
    text_copy = json.loads(block.text)
    assert url not in block.text
    assert "resource_link" in text_copy["pdf"]["url"]
    assert {**text_copy, "pdf": {**text_copy["pdf"], "url": url}} == result.structured_content
    assert block.text == compact_json(text_copy)
    assert resource_links[0].uri == url
    # sanity: the compact copy has no SDK-style indentation
    assert "\n" not in block.text
    assert len(fake_storage.calls) == 1


# --- untrusted_fields (task 1.9a-2) -----------------------------------------
#
# Every string leaf of every tool's outputSchema is either server-generated
# (listed here) or carries article-derived / user-entered text, and then must
# be declared in that result's `untrusted_fields` default. Leaves whose schema
# pins the value (`const`, `enum`, `format: uuid|date-time`) cannot carry free
# text and are skipped by the walker itself.
_TRUSTED_PATHS: dict[str, frozenset[str]] = {
    "list_projects": frozenset({"note"}),
    "get_project": frozenset({"templates[].kind"}),
    "list_articles": frozenset({"articles[].text_status", "next_cursor"}),
    "get_article": frozenset(
        {
            "files[].role",
            "files[].extraction_status",
            "extraction_status[].kind",
            "extraction_status[].stage",
        }
    ),
    "search_project_text": frozenset(
        {
            "articles[].hits[].block_type",
            "articles[].hits[].locator",
            "articles[].locators[].block_type",
            "articles[].locators[].locator",
            "next_cursor",
            "note",
        }
    ),
    "get_article_pdf": frozenset({"pdf.url", "next_step"}),
    "get_extractions": frozenset(
        {
            "response_format",
            "questions[].type",
            "next_step",
            "articles[].run.stage",
            "articles[].rows[].evidence[].locator",
            "articles[].rows[].run_stage",
            "articles[].rows[].provenance.model",
            "articles[].rows[].provenance.schema_sha256",
            "articles[].rows[].provenance.text_sha256",
            "articles[].rows[].provenance.prompt_version",
            "next_cursor",
        }
    ),
    "get_template": frozenset(
        {
            "kind",
            "sections[].cardinality",
            "sections[].questions[].type",
            "sections[].questions[].flags[]",
            "draft_diff.status",
            "draft_diff.changes[].tier",
            "draft_diff.changes[].variant",
            "draft_diff.changes[].attribute",
            "draft_diff.fingerprint",
            "fingerprint",
            "status",
            "changes[].tier",
            "changes[].variant",
            "changes[].attribute",
            "note",
            "next_cursor",
        }
    ),
    "edit_template_draft": frozenset(
        {
            "diff.status",
            "diff.changes[].tier",
            "diff.changes[].variant",
            "diff.changes[].attribute",
            "diff.fingerprint",
            "draft_fingerprint",
            "editor_url",
            "next_step",
        }
    ),
    "update_project_details": frozenset({"note"}),
    "get_review_question": frozenset({"review_type", "slots{}.label", "note"}),
    "set_review_question": frozenset({"review_type", "slots{}.label", "note"}),
    "list_template_catalogue": frozenset({"next_step", "note"}),
    "get_setup_readiness": frozenset({"items[].next_step"}),
}
_FLAG_FIELDS = frozenset({"untrusted_content", "untrusted_fields"})
_PINNED_FORMATS = frozenset({"uuid", "date-time"})


def _text_paths(schema: dict, defs: dict, path: str) -> set[str]:
    """Dotted paths (list items as `[]`, map values as `{}`) of every leaf
    that may hold a free-form string."""
    if "$ref" in schema:
        return _text_paths(defs[schema["$ref"].rsplit("/", 1)[-1]], defs, path)
    branches = schema.get("anyOf") or schema.get("oneOf") or schema.get("allOf")
    if branches:
        return set().union(*(_text_paths(b, defs, path) for b in branches))
    if "const" in schema or "enum" in schema:
        return set()
    kind = schema.get("type")
    if kind == "object":
        found: set[str] = set()
        for name, sub in schema.get("properties", {}).items():
            if not path and name in _FLAG_FIELDS:
                continue
            found |= _text_paths(sub, defs, f"{path}.{name}" if path else name)
        extra = schema.get("additionalProperties", "properties" not in schema)
        if extra is True:
            found.add(f"{path}{{}}")
        elif isinstance(extra, dict):
            found |= _text_paths(extra, defs, f"{path}{{}}")
        return found
    if kind == "array":
        return _text_paths(schema.get("items", {}), defs, f"{path}[]")
    if kind == "string":
        return set() if schema.get("format") in _PINNED_FORMATS else {path}
    if kind is None:  # `Any`: may be a string
        return {path}
    return set()


async def test_untrusted_fields_declare_every_untrusted_string(mcp_client, pat_primary_rw):
    async with mcp_client(pat_primary_rw) as client:
        tools = [t for t in (await client.list_tools()).tools if t.output_schema is not None]

    assert {t.name for t in tools} == set(_TRUSTED_PATHS)
    for tool in tools:
        schema = tool.output_schema
        paths = _text_paths(schema, schema.get("$defs", {}), "")
        trusted = _TRUSTED_PATHS[tool.name]
        assert trusted <= paths, (tool.name, trusted - paths)
        untrusted = paths - trusted
        props = schema["properties"]
        if not untrusted:
            assert not _FLAG_FIELDS & props.keys(), tool.name
            continue
        assert props["untrusted_content"].get("const") is True, tool.name
        declared = props["untrusted_fields"]["default"]
        assert len(declared) == len(set(declared)), tool.name
        assert set(declared) == untrusted, (tool.name, set(declared) ^ untrusted)


async def test_read_results_carry_raw_text_and_the_untrusted_flag(
    mcp_client, pat_primary_rw, db_session, fake_storage
):
    article = await insert_article(db_session, SEED.primary_project, title="Flagged result")
    await db_session.execute(
        text("UPDATE public.articles SET abstract = 'Raw abstract.' WHERE id = :id"),
        {"id": str(article)},
    )
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    await insert_blocks(
        db_session,
        file_id,
        [(1, 0, "Raw heading", "heading"), (1, 1, "flaggedresultmarker body.", "paragraph")],
    )
    project = {"project_id": str(SEED.primary_project)}
    template = {**project, "template_id": str(SEED.primary_template)}
    calls = {
        "list_projects": {},
        "get_project": project,
        "list_articles": project,
        "get_article": {"article_id": str(article)},
        "search_project_text": {**project, "query": "flaggedresultmarker"},
        "get_article_pdf": {"article_id": str(article)},
        "get_extractions": template,
        "get_template": template,
        "get_review_question": project,
        "list_template_catalogue": {**project, "kind": "extraction"},
        "get_setup_readiness": project,
    }
    bodies = {}
    for name, args in calls.items():
        bodies[name] = body = structured(await call_tool(mcp_client, pat_primary_rw, name, args))
        assert body["untrusted_content"] is True, name
        assert body["untrusted_fields"], name

    detail = bodies["get_article"]
    assert detail["abstract"] == "Raw abstract."
    assert [h["text"] for h in detail["outline"]["headings"]] == ["Raw heading"]
    snippets = [
        hit["snippet"] for row in bodies["search_project_text"]["articles"] for hit in row["hits"]
    ]
    assert snippets
    assert all("ARTICLE_TEXT" not in s for s in snippets)
    assert bodies["get_article_pdf"]["pdf"]["filename"]
    assert len(fake_storage.calls) == 1


async def test_text_copy_carries_non_ascii_raw(mcp_client, pat_primary_rw, db_session):
    title = "Étude clinique 中文 trial"
    article = await insert_article(db_session, SEED.primary_project, title=title)

    result = await call_tool(
        mcp_client, pat_primary_rw, "get_article", {"article_id": str(article)}
    )

    text_copy = result.content[0].text
    assert title in text_copy
    assert "\\u" not in text_copy
    assert json.loads(text_copy) == result.structured_content
