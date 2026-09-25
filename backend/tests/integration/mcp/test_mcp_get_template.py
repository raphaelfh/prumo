"""get_template tool-logic tests (task 8a): the in-memory SDK client, so
handler lines register coverage (the ASGI blind spot).

Draft state (``draft_open``/``draft_diff``) mirrors the REST
config-status/diff endpoints, which are ``require_project_manager``: a
manager gets both, any other role gets ``null`` for both (spec §5.1)."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

from sqlalchemy import event, text

from app.api.mcp.tools import templates as templates_tool
from app.schemas.mcp_templates import McpTemplateView
from app.services.extraction_snapshot import live_entity_types
from app.services.template_version_read_service import (
    get_active_version_tree,
    get_template_config_diff,
)
from app.utils.opaque_cursor import encode_cursor
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import (
    add_field,
    add_section,
    force_narrow_baseline,
    fresh_charms,
    set_label,
)
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured


def _all_field_ids(body: dict) -> set[str]:
    return {q["field_id"] for s in body["sections"] for q in s["questions"]}


async def test_get_template_published_tree(mcp_client, pat_primary_read, db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)
    active = await get_active_version_tree(
        db_session, project_id=project_id, template_id=template_id
    )
    expected_field_ids = {str(f.id) for et in active.entity_types for f in et.fields}

    field_ids: set[str] = set()
    cursor: str | None = None
    first_page = True
    saw_diff = False
    while True:
        args = {"project_id": str(project_id), "template_id": str(template_id)}
        if cursor is not None:
            args["cursor"] = cursor
        body = structured(await call_tool(mcp_client, pat_primary_read, "get_template", args))
        McpTemplateView.model_validate(body)
        assert len(json.dumps(body)) <= 32_000
        field_ids |= _all_field_ids(body)
        if first_page:
            assert body["published_version"] is not None
            assert body["narrow"] is False
            assert body["draft_diff"] is not None
            saw_diff = True
        else:
            assert body["draft_diff"] is None
        first_page = False
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert field_ids == expected_field_ids
    assert saw_diff


async def test_get_template_live_tree_matches_fallback(mcp_client, pat_primary_read, db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db_session.flush()

    field_ids: set[str] = set()
    cursor: str | None = None
    first_page = True
    published_version = narrow = draft_diff_status = None
    while True:
        args = {"project_id": str(project_id), "template_id": str(template_id)}
        if cursor is not None:
            args["cursor"] = cursor
        body = structured(await call_tool(mcp_client, pat_primary_read, "get_template", args))
        McpTemplateView.model_validate(body)
        field_ids |= _all_field_ids(body)
        if first_page:
            published_version = body["published_version"]
            narrow = body["narrow"]
            draft_diff_status = body["draft_diff"]["status"]
        first_page = False
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert published_version is None
    assert narrow is None

    expected_diff = await get_template_config_diff(
        db_session, project_id=project_id, template_id=template_id
    )
    assert draft_diff_status == expected_diff.status.value

    live = await live_entity_types(db_session, template_id=template_id)
    expected_field_ids = {str(f.id) for et in live for f in et.fields}
    assert field_ids == expected_field_ids

    foreign = await call_tool(
        mcp_client,
        pat_primary_read,
        "get_template",
        {"project_id": str(SEED.primary_project), "template_id": str(template_id)},
    )
    assert error_payload(foreign)["code"] == "NOT_FOUND"


async def test_get_template_narrow_flag(mcp_client, pat_primary_read, db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)
    await force_narrow_baseline(db_session, template_id, uuid4())

    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_read,
            "get_template",
            {"project_id": str(project_id), "template_id": str(template_id)},
        )
    )
    assert body["narrow"] is True


async def test_get_template_draft_open(mcp_client, pat_primary_read, db_session):
    project_id, template_id, schema = await fresh_charms(db_session)
    await set_label(
        db_session,
        "extraction_fields",
        UUID(schema["entity_types"][0]["fields"][0]["id"]),
        "Relabeled",
    )

    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_read,
            "get_template",
            {"project_id": str(project_id), "template_id": str(template_id)},
        )
    )
    assert body["draft_open"] is True
    assert sum(body["draft_diff"]["counts"].values()) >= 1


async def test_get_template_draft_state_is_manager_only(
    mcp_client, pat_primary_read, pat_reviewer_rw, monkeypatch
) -> None:
    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_read,
            "get_template",
            {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)},
        )
    )
    assert isinstance(body["draft_open"], bool)
    assert body["draft_diff"] is not None

    def _boom(*_args, **_kwargs):
        raise AssertionError("get_template_config_diff must not run for a non-manager")

    monkeypatch.setattr(templates_tool, "get_template_config_diff", _boom)

    reviewer_body = structured(
        await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "get_template",
            {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)},
        )
    )
    assert reviewer_body["draft_open"] is None
    assert reviewer_body["draft_diff"] is None
    assert reviewer_body["sections"] is not None


async def test_get_template_query_count_bounded(mcp_client, pat_primary_read, db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)

    async def call_once() -> int:
        queries: list[str] = []

        def record(_conn, _cursor, statement, _parameters, _context, _many):
            queries.append(statement)

        event.listen(db_session.bind.sync_engine, "before_cursor_execute", record)
        try:
            result = await call_tool(
                mcp_client,
                pat_primary_read,
                "get_template",
                {"project_id": str(project_id), "template_id": str(template_id)},
            )
        finally:
            event.remove(db_session.bind.sync_engine, "before_cursor_execute", record)
        assert result.is_error is False
        return len(queries)

    c1 = await call_once()

    first_section: UUID | None = None
    for i in range(3):
        section_id = await add_section(db_session, template_id, f"extra-section-{i}")
        if first_section is None:
            first_section = section_id
        for j in range(3):
            await add_field(db_session, section_id, f"extra-field-{i}-{j}")

    c2 = await call_once()
    assert c1 == c2

    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    c3 = await call_once()

    assert first_section is not None
    for j in range(3):
        await add_field(db_session, first_section, f"post-deactivate-field-{j}")

    c4 = await call_once()
    assert c3 == c4


async def test_get_template_bad_cursor(mcp_client, pat_primary_read):
    result = await call_tool(
        mcp_client,
        pat_primary_read,
        "get_template",
        {
            "project_id": str(SEED.primary_project),
            "template_id": str(SEED.primary_template),
            "cursor": "!!",
        },
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "cursor"


async def test_get_template_cursor_out_of_range(mcp_client, pat_primary_read):
    # A1: a well-formed opaque cursor whose decoded positions are
    # non-numeric, negative, or past the tree's actual bounds must answer
    # INVALID_ARGUMENT -- never an uncaught exception (INTERNAL_ERROR) or a
    # silent Python negative-index wrap-around.
    for bad_cursor in (
        encode_cursor(["not-a-number", 0]),
        encode_cursor([-1, 0]),
        encode_cursor([0, -1]),
        encode_cursor([9_999, 0]),
        encode_cursor([0, 9_999]),
    ):
        result = await call_tool(
            mcp_client,
            pat_primary_read,
            "get_template",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(SEED.primary_template),
                "cursor": bad_cursor,
            },
        )
        payload = error_payload(result)
        assert payload["code"] == "INVALID_ARGUMENT", bad_cursor
        assert payload["field"] == "cursor", bad_cursor


async def test_get_template_metadata(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    t = tools["get_template"]
    assert t.title and t.output_schema
    a = t.annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        True,
        False,
        True,
        False,
    )


async def _walk_all_pages(mcp_client, pat, project_id, template_id) -> list[dict]:
    pages: list[dict] = []
    cursor: str | None = None
    while True:
        args = {"project_id": str(project_id), "template_id": str(template_id)}
        if cursor is not None:
            args["cursor"] = cursor
        body = structured(await call_tool(mcp_client, pat, "get_template", args))
        pages.append(body)
        cursor = body["next_cursor"]
        if cursor is None:
            break
    return pages


async def test_response_size_cap_get_template(mcp_client, pat_primary_read, db_session):
    # B1, diff-heavy shape: 45 new sections with long labels open a draft
    # with 45 ADDITIVE rows (capped at 40 by _DIFF_ROW_CAP, still filling
    # page 1's diff close to its max size), plus a few fields with long
    # `llm_description` ("instructions") text on page 1's questions too.
    project_id, template_id, schema = await fresh_charms(db_session)
    for i in range(45):
        await add_section(db_session, template_id, f"Diff-heavy-section-{i}-" + ("X" * 150))
    first_entity_id = UUID(schema["entity_types"][0]["id"])
    for i in range(5):
        field_id = await add_field(db_session, first_entity_id, f"long-instructions-field-{i}")
        await db_session.execute(
            text("UPDATE public.extraction_fields SET llm_description = :d WHERE id = :id"),
            {"d": "y" * 600, "id": str(field_id)},
        )
    await db_session.flush()

    pages = await _walk_all_pages(mcp_client, pat_primary_read, project_id, template_id)
    for page in pages:
        assert len(json.dumps(page)) <= 32_000

    # B1, many-sections shape: 400 one-question sections.
    project_id2, template_id2, _schema2 = await fresh_charms(db_session)
    for i in range(400):
        section_id = await add_section(db_session, template_id2, f"Many-section-{i}")
        await add_field(db_session, section_id, f"field-{i}")
    # The published snapshot is frozen at fresh_charms's republish and does
    # not see these live-only additions; deactivate the version so
    # get_template falls back to the live tree (same fallback exercised by
    # test_get_template_live_tree_matches_fallback), which does.
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id2)},
    )
    await db_session.flush()
    live = await live_entity_types(db_session, template_id=template_id2)
    expected_covered = sum(len(et.fields) for et in live)

    pages2 = await _walk_all_pages(mcp_client, pat_primary_read, project_id2, template_id2)
    assert len(pages2) > 1
    covered = 0
    for page in pages2:
        assert len(json.dumps(page)) <= 32_000
        for section in page["sections"]:
            assert section["questions"], f"section emitted with zero questions: {section}"
            covered += len(section["questions"])
    assert covered == expected_covered
