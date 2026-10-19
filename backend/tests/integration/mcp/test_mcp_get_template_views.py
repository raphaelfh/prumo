"""get_template's manager-only `draft` and `changes` views, the draft lint,
and the fingerprint + row ids on the published view's capped diff.

In-memory SDK client, so the tool lines register coverage."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import template_changes
from app.domain.template_change import DiffStatus
from app.schemas.hitl_session import TemplateConfigDiffRead
from app.services.extraction_snapshot import live_entity_types
from app.services.template_instruction_service import get_template_instruction
from app.services.template_lint import lint_tree
from app.services.template_versioning import get_template_config_diff
from app.utils.compact_json import RESULT_CAP, compact_json
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

_PAGING_OPS = 100  # 4 calls of 25: enough weight for more than one changes page


def _args(project_id: UUID, template_id: UUID, **extra: Any) -> dict[str, Any]:
    return {"project_id": str(project_id), "template_id": str(template_id), **extra}


async def _get(mcp_client, pat, project_id, template_id, **extra) -> dict[str, Any]:
    return structured(
        await call_tool(mcp_client, pat, "get_template", _args(project_id, template_id, **extra))
    )


async def _pages(mcp_client, pat, project_id, template_id, view: str) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        extra: dict[str, Any] = {"view": view}
        if cursor is not None:
            extra["cursor"] = cursor
        page = await _get(mcp_client, pat, project_id, template_id, **extra)
        assert len(compact_json(page)) <= RESULT_CAP
        pages.append(page)
        cursor = page["next_cursor"]
        if cursor is None:
            return pages


async def _edit(mcp_client, pat, project_id, template_id, ops: list[dict]) -> None:
    structured(
        await call_tool(
            mcp_client, pat, "edit_template_draft", _args(project_id, template_id, ops=ops)
        )
    )


def _first_section(schema: dict[str, Any]) -> dict[str, Any]:
    return next(et for et in schema["entity_types"] if et.get("fields"))


async def _heavy_draft(mcp_client, pat, db_session: AsyncSession) -> tuple[UUID, UUID, str]:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id = _first_section(schema)["id"]
    for start in range(0, _PAGING_OPS, 25):
        ops = [
            {
                "op": "add_question",
                "section_id": section_id,
                "label": f"Paging question {i:03d} " + "x" * 75,
                "type": "text",
            }
            for i in range(start, start + 25)
        ]
        await _edit(mcp_client, pat, project_id, template_id, ops)
    return project_id, template_id, section_id


def _question_labels(pages: list[dict[str, Any]], section_id: str) -> list[str]:
    return [
        q["label"]
        for page in pages
        for s in page["sections"]
        if s["section_id"] == section_id
        for q in s["questions"]
    ]


async def test_draft_view_shows_unpublished_question(mcp_client, pat_primary_rw, db_session):
    project_id, template_id, schema = await fresh_charms(db_session)
    section = _first_section(schema)
    assert section["label"]  # precondition: a labelled section
    await _edit(
        mcp_client,
        pat_primary_rw,
        project_id,
        template_id,
        [
            {
                "op": "add_question",
                "section_id": section["id"],
                "label": "Unpublished follow-up",
                "type": "text",
                "instructions": "Months of follow-up.",
            }
        ],
    )

    draft = await _pages(mcp_client, pat_primary_rw, project_id, template_id, "draft")
    published = await _pages(mcp_client, pat_primary_rw, project_id, template_id, "published")

    assert draft[0]["view"] == "draft"
    assert draft[0]["draft_open"] is True
    assert draft[0]["draft_diff"] is None
    assert "Unpublished follow-up" in _question_labels(draft, section["id"])
    assert published[0]["view"] == "published"
    assert "Unpublished follow-up" not in _question_labels(published, section["id"])


async def test_draft_view_carries_lint(mcp_client, pat_primary_rw, db_session):
    project_id, template_id, schema = await fresh_charms(db_session)

    def guidance_count(page: dict[str, Any]) -> int:
        hits = [f for f in page["lint"] if f["code"] == "QUESTION_WITHOUT_AI_GUIDANCE"]
        return hits[0]["count"] if hits else 0

    before = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="draft")
    await _edit(
        mcp_client,
        pat_primary_rw,
        project_id,
        template_id,
        [
            {
                "op": "add_question",
                "section_id": _first_section(schema)["id"],
                "label": "Bare question",
                "type": "text",
            }
        ],
    )
    after = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="draft")

    assert guidance_count(after) == guidance_count(before) + 1
    expected = await get_template_config_diff(
        db_session, project_id=project_id, template_id=template_id
    )
    assert after["fingerprint"] == expected.fingerprint
    assert after["note"] is None


async def test_seeded_charms_clone_has_no_blocking_lint(db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)
    tree = await live_entity_types(db_session, template_id=template_id)
    instruction = (
        await get_template_instruction(db_session, project_id=project_id, template_id=template_id)
    ).llm_template_instruction
    assert tree  # precondition: the clone has sections

    assert [f.code for f in lint_tree(tree, instruction) if f.status == "block"] == []


async def test_changes_view_pages_every_row(mcp_client, pat_primary_rw, db_session):
    project_id, template_id, _section = await _heavy_draft(mcp_client, pat_primary_rw, db_session)
    diff = await get_template_config_diff(
        db_session, project_id=project_id, template_id=template_id
    )
    expected_ids = [
        row.id
        for rows in (
            diff.changes.destructive,
            diff.changes.semantic,
            diff.changes.additive,
            diff.changes.cosmetic,
        )
        for row in rows
    ]
    assert len(expected_ids) >= _PAGING_OPS

    pages = await _pages(mcp_client, pat_primary_rw, project_id, template_id, "changes")

    assert len(pages) > 1
    ids = [row["id"] for page in pages for row in page["changes"]]
    assert ids == expected_ids
    for page in pages:
        assert page["view"] == "changes"
        assert page["sections"] == []
        assert page["fingerprint"] == diff.fingerprint
        assert page["status"] == "available"
        assert page["counts"]["additive"] == len(diff.changes.additive)
    row = pages[0]["changes"][0]
    assert row["affects_ai"] is True
    assert row["affects_recorded_data"] is False


async def test_mcp_fingerprint_equals_rest(
    mcp_client, pat_primary_rw, db_session, db_client: AsyncClient, auth_as_profile: UUID
):
    # After db_client, so its manager override wins over the client's fake user.
    assert auth_as_profile == SEED.primary_profile
    project_id, template_id, schema = await fresh_charms(db_session)
    await _edit(
        mcp_client,
        pat_primary_rw,
        project_id,
        template_id,
        [
            {
                "op": "add_question",
                "section_id": _first_section(schema)["id"],
                "label": "Fingerprinted",
                "type": "text",
            }
        ],
    )

    body = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="changes")
    res = await db_client.get(f"/api/v1/projects/{project_id}/templates/{template_id}/config-diff")

    assert res.status_code == 200, res.text
    assert body["fingerprint"]
    assert body["fingerprint"] == res.json()["data"]["fingerprint"]


@pytest.mark.parametrize("view", ["draft", "changes"])
async def test_reviewer_gets_manager_required(mcp_client, pat_reviewer_rw, view):
    result = await call_tool(
        mcp_client,
        pat_reviewer_rw,
        "get_template",
        _args(SEED.primary_project, SEED.primary_template, view=view),
    )
    payload = error_payload(result)
    assert payload["code"] == "MANAGER_REQUIRED"
    assert payload["message"] == "Only a project manager can read the draft."


async def test_edit_between_pages_invalidates_cursor(mcp_client, pat_primary_rw, db_session):
    project_id, template_id, section_id = await _heavy_draft(mcp_client, pat_primary_rw, db_session)
    first = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="changes")
    assert first["next_cursor"]  # precondition: more than one page
    await _edit(
        mcp_client,
        pat_primary_rw,
        project_id,
        template_id,
        [{"op": "add_question", "section_id": section_id, "label": "Late", "type": "text"}],
    )

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_template",
        _args(project_id, template_id, view="changes", cursor=first["next_cursor"]),
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "cursor"
    assert "draft changed" in payload["message"]


async def test_no_draft_states(mcp_client, pat_primary_rw, db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)

    draft = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="draft")
    changes = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="changes")

    assert draft["draft_open"] is False
    assert draft["note"] == "No draft is open; this is the published questionnaire."
    assert draft["sections"]
    assert changes["changes"] == []
    assert changes["fingerprint"]
    assert changes["status"] == "available"
    assert changes["next_cursor"] is None


@pytest.mark.parametrize("status", [DiffStatus.INITIAL_VERSION, DiffStatus.BASELINE_TOO_OLD])
async def test_changes_view_without_comparable_baseline(
    mcp_client, pat_primary_rw, db_session, monkeypatch, status
):
    project_id, template_id, _schema = await fresh_charms(db_session)

    async def _uncomparable(_db, *, project_id: UUID, template_id: UUID) -> TemplateConfigDiffRead:
        del project_id
        return TemplateConfigDiffRead(project_template_id=template_id, status=status)

    monkeypatch.setattr(template_changes, "get_template_config_diff", _uncomparable)

    body = await _get(mcp_client, pat_primary_rw, project_id, template_id, view="changes")

    assert body["changes"] == []
    assert body["fingerprint"] is None
    assert body["status"] == status.value
    assert status.value in body["note"]


async def test_malformed_changes_cursor_is_invalid_argument(mcp_client, pat_primary_rw):
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "get_template",
        _args(SEED.primary_project, SEED.primary_template, view="changes", cursor="not-a-cursor"),
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "cursor"


async def test_published_draft_diff_carries_fingerprint_and_ids(
    mcp_client, pat_primary_rw, db_session
):
    project_id, template_id, schema = await fresh_charms(db_session)
    await _edit(
        mcp_client,
        pat_primary_rw,
        project_id,
        template_id,
        [
            {
                "op": "add_question",
                "section_id": _first_section(schema)["id"],
                "label": "Diffed",
                "type": "text",
            }
        ],
    )
    diff = await get_template_config_diff(
        db_session, project_id=project_id, template_id=template_id
    )

    body = await _get(mcp_client, pat_primary_rw, project_id, template_id)

    assert body["draft_diff"]["fingerprint"] == diff.fingerprint
    assert body["draft_diff"]["changes"]  # precondition: the draft has rows
    assert [c["id"] for c in body["draft_diff"]["changes"]] == [
        row.id
        for rows in (
            diff.changes.additive,
            diff.changes.cosmetic,
            diff.changes.semantic,
            diff.changes.destructive,
        )
        for row in rows
    ]
