"""edit_template_draft (spec §5.2, §7): check order, lock, audit, race tests.

Every negative case asserts three things together: the error code, "no
structure rows" (field count + label set under the template unchanged), and
"lock not claimed" (``draft_lock_holder`` unchanged) — the tool's transaction
must roll back atomically on every refusal.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import session as mcp_session
from app.api.mcp.draft_diff import DIFF_ROW_CAP
from app.api.mcp.tools import template_draft as template_draft_tool
from app.core.config import settings
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services import template_field_naming, template_field_service
from app.services.pat_service import create_token, resolve_principal
from app.utils.compact_json import RESULT_CAP, compact_json
from tests.integration.conftest import SEED, clean_project_clones, make_proposal, open_session
from tests.integration.helpers.engine_setup import run_in_extract
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    add_field,
    add_section,
    draft_lock_holder,
    entity_id,
    force_narrow_baseline,
    fresh_charms,
)
from tests.integration.helpers.template_fixtures import field_id as fixture_field_id
from tests.integration.mcp.conftest import SeededPat
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

_ALLOWED = [
    "add_question",
    "delete_question",
    "move_question",
    "reorder_questions",
    "update_question",
]


class _Pg(Exception):
    sqlstate = "40P01"


def _section_and_field(schema: dict[str, Any]) -> tuple[str, str]:
    section = next(et for et in schema["entity_types"] if et.get("fields"))
    return section["id"], section["fields"][0]["id"]


def _label_of(schema: dict[str, Any], section_id: str, field_id: str) -> str:
    section = next(et for et in schema["entity_types"] if et["id"] == section_id)
    return next(f["label"] for f in section["fields"] if f["id"] == field_id)


async def _label_set(db: AsyncSession, template_id: UUID) -> frozenset[str]:
    rows = (
        await db.execute(
            text(
                "SELECT f.id, f.label FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).all()
    return frozenset(f"{row.id}:{row.label}" for row in rows)


async def _names(db: AsyncSession, project_id: UUID, template_id: UUID) -> dict[str, str]:
    row = (
        await db.execute(
            text(
                "SELECT p.name AS project_name, t.name AS template_name "
                "FROM public.project_extraction_templates t "
                "JOIN public.projects p ON p.id = t.project_id WHERE t.id = :tid AND p.id = :pid"
            ),
            {"tid": str(template_id), "pid": str(project_id)},
        )
    ).one()
    assert row.project_name and row.template_name
    return {"project_name": row.project_name, "template_name": row.template_name}


def _assert_named(payload: dict[str, Any], names: dict[str, str]) -> None:
    assert payload["project_name"] == names["project_name"]
    assert payload["template_name"] == names["template_name"]
    assert payload["untrusted_content"] is True
    assert {"project_name", "template_name"} <= set(payload["untrusted_fields"])


async def _audit_count(db: AsyncSession, *, outcome: str) -> int:
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM public.agent_actions WHERE outcome = :o "
                "AND tool = 'edit_template_draft'"
            ),
            {"o": outcome},
        )
    ).scalar_one()


async def test_success_returns_unpublished_draft(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "PUBLIC_APP_URL", "https://example.test/")
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    old_label = _label_of(schema, section_id, field_id)

    ops = [
        {
            "op": "add_question",
            "section_id": section_id,
            "label": "Follow-up (months)",
            "type": "select",
            "options": [{"label": "6"}, {"label": "12"}],
        },
        {"op": "update_question", "field_id": field_id, "label": "Reworded"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    assert body["status"] == "draft_saved_unpublished"
    assert body["visible_to_reviewers_and_ai"] is False
    assert len(body["applied"]) == 2
    assert [a["op_index"] for a in body["applied"]] == [0, 1]
    assert body["applied"][0]["name"] == "follow_up_months"
    assert body["diff"]["status"] == "available"
    assert body["editor_url"] == (
        f"https://example.test/projects/{project_id}?tab=extraction&extractionTab=configuration"
    )
    assert "editor_path" not in body
    assert body["draft_fingerprint"]
    assert body["diff"]["changes_truncated"] is False
    assert "Publish" in body["next_step"]
    names = await _names(db_session, project_id, template_id)
    assert body["project_name"] == names["project_name"]
    assert body["template_name"] == names["template_name"]
    section_label = next(et["label"] for et in schema["entity_types"] if et["id"] == section_id)
    assert [a["section_label"] for a in body["applied"]] == [section_label, section_label]
    assert body["untrusted_content"] is True
    assert set(body["untrusted_fields"]) == {
        "project_name",
        "template_name",
        "applied[].section_label",
        "applied[].name",
        "applied[].label",
        "diff.changes[].label_path[]",
        "diff.changes[].before",
        "diff.changes[].after",
        "diff.changes[].id",
    }
    assert body["diff"]["fingerprint"] == body["draft_fingerprint"]
    assert all(change["id"] for change in body["diff"]["changes"])

    row = (
        await db_session.execute(
            text(
                "SELECT before, after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()  # exactly one applied row
    assert len(row.after["ops"]) == 2
    assert row.before["ops"] == [None, {"label": old_label}]


async def test_add_question_mapping(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    max_sort_order = (
        await db_session.execute(
            text(
                "SELECT COALESCE(MAX(sort_order), -1) FROM public.extraction_fields "
                "WHERE entity_type_id = :sid"
            ),
            {"sid": section_id},
        )
    ).scalar_one()

    ops = [
        {
            "op": "add_question",
            "section_id": section_id,
            "label": "Mapped Q",
            "type": "select",
            "options": [{"label": "Yes"}, {"value": "n", "label": "No"}],
            "instructions": "Some hint",
        }
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    field_id = body["applied"][0]["field_id"]
    row = (
        await db_session.execute(
            text(
                "SELECT entity_type_id, allowed_values, llm_description, sort_order "
                "FROM public.extraction_fields WHERE id = :id"
            ),
            {"id": field_id},
        )
    ).one()
    assert str(row.entity_type_id) == section_id
    assert row.allowed_values == [{"value": "Yes", "label": "Yes"}, {"value": "n", "label": "No"}]
    assert row.llm_description == "Some hint"
    assert row.sort_order == max_sort_order + 1


async def test_add_question_duplicate_option_value_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    refused_before = await _audit_count(db_session, outcome="refused")

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(project_id),
            "template_id": str(template_id),
            "ops": [
                {
                    "op": "add_question",
                    "section_id": section_id,
                    "label": "Dup options",
                    "type": "select",
                    "options": [{"label": "Yes"}, {"value": "Yes", "label": "Again"}],
                }
            ],
        },
    )

    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "options"
    assert payload["message"] == "option values must be unique"
    assert await _label_set(db_session, template_id) == before
    assert await _audit_count(db_session, outcome="refused") == refused_before + 1


async def test_derived_name_collision_suffixes(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    await add_field(db_session, UUID(section_id), "age")
    await db_session.commit()

    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Age", "type": "text"},
        {"op": "add_question", "section_id": section_id, "label": "Age", "type": "text"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    assert [a["name"] for a in body["applied"]] == ["age_2", "age_3"]


async def test_lock_retained_after_success(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    assert await draft_lock_holder(db_session, template_id) == SEED.primary_profile


async def test_draft_lock_held(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET config_draft_by = :r WHERE id = :t"),
        {"r": str(SEED.reviewer_profile), "t": str(template_id)},
    )
    await db_session.flush()

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "DRAFT_LOCK_HELD"
    assert payload["holder_name"] == "Integration Reviewer"
    assert payload["untrusted_content"] is True
    assert payload["untrusted_fields"] == ["holder_name", "project_name", "template_name"]
    _assert_named(payload, await _names(db_session, project_id, template_id))
    assert await draft_lock_holder(db_session, template_id) == SEED.reviewer_profile
    assert await _label_set(db_session, template_id) == before
    assert await _audit_count(db_session, outcome="refused") == 1


async def _deactivate_version(db: AsyncSession, template_id: UUID, _section_id: str) -> None:
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :t"
        ),
        {"t": str(template_id)},
    )
    await db.flush()


async def _legacy_baseline(db: AsyncSession, template_id: UUID, section_id: str) -> None:
    await force_narrow_baseline(db, template_id, UUID(section_id))


@pytest.mark.parametrize(
    "break_baseline",
    [_legacy_baseline, _deactivate_version],
    ids=["narrow_baseline", "no_published_version"],
)
async def test_draft_lock_held_precedes_baseline_refusals(
    mcp_client, pat_primary_rw, db_session: AsyncSession, break_baseline: Any
) -> None:
    # The claim runs before the baseline check, so a held lock answers first.
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    await break_baseline(db_session, template_id, section_id)
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET config_draft_by = :r WHERE id = :t"),
        {"r": str(SEED.reviewer_profile), "t": str(template_id)},
    )
    await db_session.flush()

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    payload = error_payload(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
        )
    )
    assert payload["code"] == "DRAFT_LOCK_HELD"
    _assert_named(payload, await _names(db_session, project_id, template_id))
    assert await draft_lock_holder(db_session, template_id) == SEED.reviewer_profile
    assert await _audit_count(db_session, outcome="refused") == 1


@pytest.mark.parametrize(
    "extra_op",
    [
        {"op": "publish"},
        {"op": "clone_template"},
        {"op": "add_section"},
        {"op": "update_question", "type": "number"},
        {"op": "update_question", "options": ["a"]},
        {"op": "update_question", "name": "renamed"},
    ],
    ids=[
        "publish",
        "clone_template",
        "add_section",
        "update_type",
        "update_options",
        "update_name",
    ],
)
async def test_disallowed_op_refused(
    mcp_client, pat_primary_rw, db_session: AsyncSession, extra_op: dict[str, Any]
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)

    bad = dict(extra_op)
    if bad["op"] == "update_question":
        bad["field_id"] = field_id
    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Q0", "type": "text"},
        bad,
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "OP_NOT_ALLOWED_VIA_AGENT"
    assert payload["op_index"] == 1
    assert payload["allowed_ops"] == _ALLOWED
    blocked_key = {"name", "type", "options"} & bad.keys()
    if blocked_key:
        assert payload["field"] == blocked_key.pop()
        assert payload["editable_fields"] == ["description", "instructions", "label"]
        assert "update_question" in payload["next_step"]
        assert "prumo UI" in payload["next_step"]
    else:
        assert payload["next_step"] == "do this in the prumo UI"
        assert "field" not in payload
        assert "editable_fields" not in payload
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_ops_cap_25(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    ops = [
        {"op": "add_question", "section_id": section_id, "label": f"Q{i}", "type": "text"}
        for i in range(26)
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "TOO_MANY_OPS"
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


@pytest.mark.parametrize(
    "use_random_template",
    [False, True],
    ids=["foreign-template", "random-template"],
)
async def test_foreign_template_with_too_many_ops_is_not_found(
    mcp_client,
    pat_primary_rw,
    db_session: AsyncSession,
    use_random_template: bool,
) -> None:
    _secondary_project_id, template_id, _schema = await fresh_charms(db_session)
    if use_random_template:
        template_id = uuid4()
    before = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    ops = [
        {"op": "add_question", "section_id": str(uuid4()), "label": f"Q{i}", "type": "text"}
        for i in range(30)
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(SEED.primary_project),
            "template_id": str(template_id),
            "ops": ops,
        },
    )
    payload = error_payload(result)
    assert payload["code"] == "NOT_FOUND"
    assert "project_name" not in payload
    assert "template_name" not in payload
    after = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after == before


@pytest.mark.parametrize(
    ("op_builder", "field"),
    [
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "x" * 101,
                "type": "text",
            },
            "label",
        ),
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "Q",
                "type": "text",
                "options": [{"label": "a"}],
            },
            "options",
        ),
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "Q",
                "type": "select",
            },
            "options",
        ),
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "Q",
                "type": "rating",
            },
            "type",
        ),
        (
            lambda _section_id, field_id: {
                "op": "update_question",
                "field_id": field_id,
                "label": None,
            },
            "label",
        ),
    ],
    ids=["label_too_long", "options_not_allowed", "options_missing", "bad_type", "null_label"],
)
async def test_invalid_argument_carries_op_index(
    mcp_client, pat_primary_rw, db_session: AsyncSession, op_builder: Any, field: str
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    filler = [
        {"op": "add_question", "section_id": section_id, "label": f"Filler{i}", "type": "text"}
        for i in range(2)
    ]
    bad_op = op_builder(section_id, field_id)
    ops = [
        *filler,
        bad_op,
        {"op": "add_question", "section_id": section_id, "label": "After", "type": "text"},
    ]

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["retryable"] is False
    assert payload["op_index"] == 2
    assert payload["field"] == field
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_empty_ops_invalid(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": []},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "ops"
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_no_published_version_refused(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :t"
        ),
        {"t": str(template_id)},
    )
    await db_session.flush()

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "NO_PUBLISHED_VERSION"
    assert payload["retryable"] is False
    _assert_named(payload, await _names(db_session, project_id, template_id))
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def _legacy_snapshot(db: AsyncSession) -> tuple[UUID, UUID, list[dict[str, Any]]]:
    project_id, template_id, schema = await fresh_charms(db)
    section_id, field_id = _section_and_field(schema)
    await force_narrow_baseline(db, template_id, UUID(section_id))
    return project_id, template_id, _baseline_ops(section_id, field_id)


async def _pinned_empty_version(db: AsyncSession) -> tuple[UUID, UUID, list[dict[str, Any]]]:
    # The seeded template publishes an empty v1; a run now pins it.
    await run_in_extract(db)
    return (
        SEED.primary_project,
        SEED.primary_template,
        _baseline_ops(str(SEED.primary_entity_type), str(SEED.primary_field)),
    )


def _baseline_ops(section_id: str, field_id: str) -> list[dict[str, Any]]:
    return [
        {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"},
        {"op": "update_question", "field_id": field_id, "label": "New label"},
    ]


@pytest.mark.parametrize(
    ("setup", "message", "next_step"),
    [
        (
            _legacy_snapshot,
            "The published version of this template uses an older format.",
            "publish once in prumo to refresh the published version, then retry",
        ),
        (
            _pinned_empty_version,
            "The published version of this template is empty and a run is pinned to it.",
            "publish the current draft in prumo so runs move to a version with questions, "
            "then retry",
        ),
    ],
    ids=["legacy_snapshot", "pinned_empty_version"],
)
async def test_narrow_baseline_refused(
    mcp_client,
    pat_primary_rw,
    db_session: AsyncSession,
    setup: Any,
    message: str,
    next_step: str,
) -> None:
    project_id, template_id, ops = await setup(db_session)
    before = await _label_set(db_session, template_id)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "NARROW_BASELINE"
    assert payload["message"] == message
    assert payload["next_step"] == next_step
    _assert_named(payload, await _names(db_session, project_id, template_id))
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.agent_actions WHERE outcome = 'refused' "
                "AND tool = 'edit_template_draft' AND template_id = :t"
            ),
            {"t": str(template_id)},
        )
    ).scalar_one() == 1


async def test_blank_template_edit_applies(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    # The seeded template publishes an empty v1 and no run is pinned to it.
    section_id = await add_section(db_session, SEED.primary_template, "blank_section")
    ops = [{"op": "add_question", "section_id": str(section_id), "label": "Q", "type": "text"}]
    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(SEED.primary_template),
                "ops": ops,
            },
        )
    )
    assert body["status"] == "draft_saved_unpublished"
    assert [a["section_id"] for a in body["applied"]] == [str(section_id)]


async def test_row_guard_not_found_has_op_index_and_no_row(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before_fields = await _label_set(db_session, template_id)
    before_count = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()

    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Ok Q", "type": "text"},
        {
            "op": "update_question",
            "field_id": str(SEED.primary_field),
            "label": "Hijack",
        },
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "NOT_FOUND"
    assert payload["op_index"] == 1
    assert "project_name" not in payload
    assert "template_name" not in payload
    assert await _label_set(db_session, template_id) == before_fields
    assert await draft_lock_holder(db_session, template_id) is None
    after_count = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after_count == before_count


async def test_deadlock_maps_to_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)

    original_create_field = template_field_service.create_field
    calls = {"n": 0}

    async def _flaky_create_field(db, *, project_id, template_id, payload):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        if calls["n"] == 2:
            raise DBAPIError("INSERT", {}, _Pg())
        return await original_create_field(
            db, project_id=project_id, template_id=template_id, payload=payload
        )

    monkeypatch.setattr(template_field_service, "create_field", _flaky_create_field)

    ops = [
        {"op": "add_question", "section_id": section_id, "label": "First", "type": "text"},
        {"op": "add_question", "section_id": section_id, "label": "Second", "type": "text"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "RETRY"
    assert payload["retryable"] is True
    _assert_named(payload, await _names(db_session, project_id, template_id))
    row = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid AND f.label = 'First'"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert row == 0
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_deadlock_at_record_applied_write_maps_to_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)

    async def _boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise DBAPIError("INSERT", {}, _Pg())

    monkeypatch.setattr(template_draft_tool, "record_applied_write", _boom)

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "RETRY"
    assert payload["retryable"] is True
    applied_rows = (
        await db_session.execute(
            text("SELECT count(*) FROM public.agent_actions WHERE outcome = 'applied'")
        )
    ).scalar_one()
    assert applied_rows == 0
    assert await _audit_count(db_session, outcome="refused") == 1


@pytest.mark.mcp_real_sessions
async def test_claim_draft_lock_race(mcp_client) -> None:
    from app.services.template_draft_lock_service import claim_draft_lock

    async with mcp_session.session_factory() as setup:
        project_id, template_id, schema = await fresh_charms(setup)
        created = await create_token(
            setup,
            user_id=SEED.primary_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="race", scope="read_write", expires_in_days=1
            ),
        )
        principal = await resolve_principal(setup, created.secret)
        await setup.commit()
    assert principal is not None
    pat = SeededPat(created.secret, principal)
    section_id, _field_id = _section_and_field(schema)

    try:
        async with mcp_session.session_factory() as holder_session:
            await claim_draft_lock(
                holder_session,
                project_id=project_id,
                template_id=template_id,
                user_id=SEED.reviewer_profile,
            )

            ops = [
                {"op": "add_question", "section_id": section_id, "label": "Race Q", "type": "text"}
            ]
            task = asyncio.create_task(
                call_tool(
                    mcp_client,
                    pat,
                    "edit_template_draft",
                    {
                        "project_id": str(project_id),
                        "template_id": str(template_id),
                        "ops": ops,
                    },
                )
            )
            await asyncio.sleep(0.3)
            assert not task.done()

            await holder_session.commit()
            result = await task

        payload = error_payload(result)
        assert payload["code"] == "DRAFT_LOCK_HELD"
        assert payload["holder_name"] == "Integration Reviewer"

        async with mcp_session.session_factory() as verify:
            holder = await draft_lock_holder(verify, template_id)
            assert holder == SEED.reviewer_profile
            count = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM public.extraction_fields f "
                        "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                        "WHERE et.project_template_id = :tid AND f.label = 'Race Q'"
                    ),
                    {"tid": str(template_id)},
                )
            ).scalar_one()
            assert count == 0
    finally:
        async with mcp_session.session_factory() as teardown:
            await teardown.execute(
                text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
                {"id": str(created.token.id)},
            )
            await teardown.execute(
                text("DELETE FROM public.agent_actions WHERE project_id = :p"),
                {"p": str(SEED.secondary_project)},
            )
            await clean_project_clones(teardown, SEED.secondary_project)
            await teardown.execute(
                text("DELETE FROM public.articles WHERE id = :a"), {"a": str(ARTICLE_ID)}
            )
            await teardown.commit()


@pytest.mark.mcp_real_sessions
async def test_duplicate_name_race_maps_to_retryable(
    mcp_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A name that slips past both app-level checks (a writer's commit landed
    between the ``taken`` snapshot ``derive_field_name`` used and this call's
    own INSERT) is caught only by the 0050 unique index.

    The colliding row is inserted and committed by a genuinely separate
    session/connection BEFORE this test's tool call claims the draft lock,
    rather than mid-flight: the 0048 trigger (``0048_config_draft_marker``)
    unconditionally row-locks ``project_extraction_templates`` on every
    ``extraction_fields`` write, and ``claim_draft_lock`` + ``apply_draft_ops``
    share one open transaction that holds that same row locked for the whole
    call — so a second writer to the SAME template can only block until this
    call ends, never land inside it. In production that second writer just
    waits for this call's commit. The indefinite hang seen while prototyping
    a literal mid-flight writer was the test harness: a ``thread.join()``
    blocked the event loop that had to commit, not the server.
    Sequencing the commit first, and forcing ``derive_field_name`` to ignore
    the (now correctly populated) ``taken`` set, reproduces the same
    observable contract — a name that both app-level guards miss, caught only
    by the DB backstop — deterministically and without blocking.
    """

    async def _never_taken(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return False

    monkeypatch.setattr(template_field_service, "_name_taken", _never_taken)

    def _racing_derive(_label: str, _taken):  # type: ignore[no-untyped-def]
        return "race"

    monkeypatch.setattr(template_field_naming, "derive_field_name", _racing_derive)

    async with mcp_session.session_factory() as setup:
        project_id, template_id, schema = await fresh_charms(setup)
        section_id, _field_id = _section_and_field(schema)
        # The colliding writer: fully committed before this call even starts.
        await add_field(setup, UUID(section_id), "race")
        created = await create_token(
            setup,
            user_id=SEED.primary_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="race-dup", scope="read_write", expires_in_days=1
            ),
        )
        principal = await resolve_principal(setup, created.secret)
        await setup.commit()
    assert principal is not None
    pat = SeededPat(created.secret, principal)

    try:
        ops = [{"op": "add_question", "section_id": section_id, "label": "Race", "type": "text"}]
        result = await call_tool(
            mcp_client,
            pat,
            "edit_template_draft",
            {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
        )
        payload = error_payload(result)
        assert payload["code"] == "DUPLICATE_NAME"
        assert payload["retryable"] is True

        async with mcp_session.session_factory() as verify:
            rows = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM public.extraction_fields WHERE entity_type_id = :s "
                        "AND name = 'race'"
                    ),
                    {"s": section_id},
                )
            ).scalar_one()
            assert rows == 1
            holder = await draft_lock_holder(verify, template_id)
            assert holder is None
            refused = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM public.agent_actions WHERE outcome = 'refused' "
                        "AND tool = 'edit_template_draft' AND project_id = :p"
                    ),
                    {"p": str(project_id)},
                )
            ).scalar_one()
            assert refused == 1
    finally:
        async with mcp_session.session_factory() as teardown:
            await teardown.execute(
                text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
                {"id": str(created.token.id)},
            )
            await teardown.execute(
                text("DELETE FROM public.agent_actions WHERE project_id = :p"),
                {"p": str(SEED.secondary_project)},
            )
            await clean_project_clones(teardown, SEED.secondary_project)
            await teardown.execute(
                text("DELETE FROM public.articles WHERE id = :a"), {"a": str(ARTICLE_ID)}
            )
            await teardown.commit()


async def test_nul_in_an_op_string_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    """F10 (final review): a U+0000 inside an op string is INVALID_ARGUMENT
    naming the op and field, audited, with nothing written."""
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Fine", "type": "text"},
        {"op": "add_question", "section_id": section_id, "label": "Bad\u0000", "type": "text"},
    ]

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["op_index"] == 1
    assert payload["field"] == "label"
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_edit_template_draft_hints_are_pinned(mcp_client, pat_primary_rw) -> None:
    """A repeated call adds the question twice, so the tool is NOT idempotent;
    it only edits an unpublished draft, so it is non-destructive and closed-world."""
    async with mcp_client(pat_primary_rw) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    a = tools["edit_template_draft"].annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        False,
        False,
        False,
        False,
    )


async def test_large_draft_diff_is_capped_within_the_result_cap(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    for i in range(DIFF_ROW_CAP + 20):
        await add_section(db_session, template_id, f"Pending-section-{i}-" + ("X" * 400))
    await db_session.flush()

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(project_id),
            "template_id": str(template_id),
            "ops": [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}],
        },
    )
    body = structured(result)
    assert body["diff"]["counts"]["additive"] > DIFF_ROW_CAP
    assert len(body["diff"]["changes"]) == DIFF_ROW_CAP
    assert body["diff"]["changes_truncated"] is True
    assert body["draft_fingerprint"]
    assert len(json.dumps(body)) <= 32_000


async def test_non_ascii_draft_diff_stays_within_the_result_cap(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    # pt-BR text, rendered raw: 25 long added questions on top of long labels
    # and descriptions overflow the diff's char budget before its row cap.
    pt_br = "Descrição da intervenção: ação, avaliação e comparação. "
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    await db_session.execute(
        text(
            "UPDATE public.extraction_entity_types SET label = :l WHERE project_template_id = :tid"
        ),
        {"l": ("Seção de intervenção " * 10)[:200], "tid": str(template_id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields f SET label = :l, llm_description = :d "
            "FROM public.extraction_entity_types et "
            "WHERE et.id = f.entity_type_id AND et.project_template_id = :tid"
        ),
        {"l": ("Pergunta sobre comparação " * 5)[:100], "d": pt_br * 17, "tid": str(template_id)},
    )
    await db_session.flush()

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(project_id),
            "template_id": str(template_id),
            "ops": [
                {
                    "op": "add_question",
                    "section_id": section_id,
                    "label": f"Questão {i} " + "ç" * 80,
                    "type": "text",
                }
                for i in range(25)
            ],
        },
    )
    body = structured(result)
    assert body["diff"]["changes_truncated"] is True
    assert body["diff"]["changes"]
    assert len(compact_json(body)) <= RESULT_CAP


@pytest.mark.parametrize(
    ("op_builder", "code"),
    [
        (
            lambda section_id, _field_id: [
                {"op": "add_question", "section_id": section_id, "label": "Q", "type": "rating"}
            ],
            "INVALID_ARGUMENT",
        ),
        (lambda _section_id, _field_id: [{"op": "publish"}], "OP_NOT_ALLOWED_VIA_AGENT"),
        (
            lambda _section_id, field_id: [
                {"op": "update_question", "field_id": field_id, "type": "number"}
            ],
            "OP_NOT_ALLOWED_VIA_AGENT",
        ),
        (
            lambda section_id, _field_id: [
                {"op": "add_question", "section_id": section_id, "label": f"Q{i}", "type": "text"}
                for i in range(26)
            ],
            "TOO_MANY_OPS",
        ),
    ],
    ids=["invalid_argument", "op_not_allowed", "locked_key", "too_many_ops"],
)
async def test_post_membership_refusals_carry_names(
    mcp_client, pat_primary_rw, db_session: AsyncSession, op_builder: Any, code: str
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)

    payload = error_payload(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": op_builder(section_id, field_id),
            },
        )
    )
    assert payload["code"] == code
    _assert_named(payload, await _names(db_session, project_id, template_id))


# --------------------------------------------------------------------------
# delete / move / reorder questions and the fingerprint guard
# --------------------------------------------------------------------------


def _sections_with_fields(schema: dict[str, Any], minimum: int = 1) -> list[dict[str, Any]]:
    return [et for et in schema["entity_types"] if len(et.get("fields") or []) >= minimum]


async def _ordered_field_ids(db: AsyncSession, section_id: str) -> list[str]:
    rows = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_fields WHERE entity_type_id = :sid "
                "ORDER BY sort_order, id"
            ),
            {"sid": section_id},
        )
    ).scalars()
    return [str(row) for row in rows]


async def _sort_orders(db: AsyncSession, section_id: str) -> list[int]:
    rows = (
        await db.execute(
            text(
                "SELECT sort_order FROM public.extraction_fields WHERE entity_type_id = :sid "
                "ORDER BY sort_order, id"
            ),
            {"sid": section_id},
        )
    ).scalars()
    return list(rows)


async def _fingerprint(mcp_client, pat, project_id: UUID, template_id: UUID) -> str:
    body = structured(
        await call_tool(
            mcp_client,
            pat,
            "get_template",
            {"project_id": str(project_id), "template_id": str(template_id), "view": "changes"},
        )
    )
    assert body["fingerprint"]
    return body["fingerprint"]


async def _edit(mcp_client, pat, project_id: UUID, template_id: UUID, ops, **extra: Any):
    return await call_tool(
        mcp_client,
        pat,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops, **extra},
    )


async def test_delete_question_applies_with_fingerprint(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    label = _label_of(schema, section_id, field_id)
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)

    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_question", "field_id": field_id}],
            expected_fingerprint=fp,
        )
    )
    assert body["applied"] == [{"op_index": 0, "op": "delete_question", "field_id": field_id}]
    assert field_id not in await _ordered_field_ids(db_session, section_id)
    assert body["draft_fingerprint"] != fp
    row = (
        await db_session.execute(
            text(
                "SELECT before, after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()
    assert row.before["ops"][0]["label"] == label
    assert row.before["ops"][0]["section_id"] == section_id
    assert row.after["ops"][0] == {
        "op_index": 0,
        "op": "delete_question",
        "field_id": field_id,
    }


async def test_delete_without_fingerprint_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)

    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_question", "field_id": field_id}],
        )
    )
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "expected_fingerprint"
    assert payload["message"] == "required when a batch deletes or moves"
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_stale_fingerprint_is_stale_value(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    current = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    before = await _label_set(db_session, template_id)

    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_question", "field_id": field_id}],
            expected_fingerprint="stale",
        )
    )
    assert payload["code"] == "STALE_VALUE"
    assert payload["current_fingerprint"] == current
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1
    assert await _audit_count(db_session, outcome="applied") == 0


async def test_delete_question_with_recorded_values_is_in_use(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    owner = await entity_id(db_session, template_id, "sample_size")
    target = await fixture_field_id(
        db_session, template_id, "sample_size", "number_of_participants"
    )
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    before = await _label_set(db_session, template_id)

    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_question", "field_id": str(target)}],
            expected_fingerprint=fp,
        )
    )
    assert payload["code"] == "IN_USE"
    assert payload["op_index"] == 0
    assert payload["retryable"] is False
    assert await _label_set(db_session, template_id) == before
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_move_question_renumbers_destination(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    source, destination = _sections_with_fields(schema)[:2]
    moved = source["fields"][0]["id"]
    existing = await _ordered_field_ids(db_session, destination["id"])
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)

    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "move_question",
                    "field_id": moved,
                    "section_id": destination["id"],
                    "position": 0,
                }
            ],
            expected_fingerprint=fp,
        )
    )
    assert await _ordered_field_ids(db_session, destination["id"]) == [moved, *existing]
    assert await _sort_orders(db_session, destination["id"]) == list(range(len(existing) + 1))
    applied = body["applied"][0]
    assert applied["op"] == "move_question"
    assert applied["field_id"] == moved
    assert applied["section_id"] == destination["id"]
    assert applied["section_label"] == destination["label"]


async def test_move_question_past_the_end_appends(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    source, destination = _sections_with_fields(schema)[:2]
    moved = source["fields"][0]["id"]
    existing = await _ordered_field_ids(db_session, destination["id"])
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)

    structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "move_question",
                    "field_id": moved,
                    "section_id": destination["id"],
                    "position": 999,
                }
            ],
            expected_fingerprint=fp,
        )
    )
    assert await _ordered_field_ids(db_session, destination["id"]) == [*existing, moved]
    assert await _sort_orders(db_session, destination["id"]) == list(range(len(existing) + 1))


async def test_reorder_questions_sets_order(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section = _sections_with_fields(schema, minimum=2)[0]
    reversed_ids = list(reversed(await _ordered_field_ids(db_session, section["id"])))

    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "reorder_questions", "section_id": section["id"], "field_ids": reversed_ids}],
        )
    )
    assert await _ordered_field_ids(db_session, section["id"]) == reversed_ids
    assert await _sort_orders(db_session, section["id"]) == list(range(len(reversed_ids)))
    assert body["applied"] == [
        {
            "op_index": 0,
            "op": "reorder_questions",
            "section_id": section["id"],
            "section_label": section["label"],
            "count": len(reversed_ids),
        }
    ]


@pytest.mark.parametrize("shape", ["missing_one", "duplicate"], ids=["wrong_ids", "duplicate_ids"])
async def test_reorder_with_mismatched_ids_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession, shape: str
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section = _sections_with_fields(schema, minimum=2)[0]
    ids = await _ordered_field_ids(db_session, section["id"])
    sent = ids[1:] if shape == "missing_one" else [*ids, ids[0]]

    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "reorder_questions", "section_id": section["id"], "field_ids": sent}],
        )
    )
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "field_ids"
    assert payload["op_index"] == 0
    assert payload["message"] == "field_ids must name exactly this section's questions"
    assert await _ordered_field_ids(db_session, section["id"]) == ids
    assert await _audit_count(db_session, outcome="refused") == 1


async def _bulk_section(
    db: AsyncSession, template_id: UUID, name: str, questions: int
) -> tuple[str, list[str]]:
    """A section labelled at the 200-char label cap with ``questions`` text fields."""
    section_id = await add_section(db, template_id, name)
    await db.execute(
        text("UPDATE public.extraction_entity_types SET label = :l WHERE id = :id"),
        {"l": ("Seção de intervenção " * 10)[:200], "id": str(section_id)},
    )
    ids = [uuid4() for _ in range(questions)]
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order, "
            " allow_other, allows_not_applicable, allows_not_evaluated) "
            "VALUES (:id, :et, :name, :name, 'text', false, :o, false, false, false)"
        ),
        [
            {"id": str(fid), "et": str(section_id), "name": f"{name}_q{i}", "o": i}
            for i, fid in enumerate(ids)
        ],
    )
    await db.flush()
    return str(section_id), [str(fid) for fid in ids]


@pytest.mark.parametrize(
    ("sections", "questions", "ops_per_section"),
    [(1, 32, 25), (2, 500, 1)],
    ids=["25x32", "2x500"],
)
async def test_reorder_reply_stays_under_result_cap(
    mcp_client,
    pat_primary_rw,
    db_session: AsyncSession,
    sections: int,
    questions: int,
    ops_per_section: int,
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    built = [
        await _bulk_section(db_session, template_id, f"bulk_{n}", questions)
        for n in range(sections)
    ]
    ops = [
        {
            "op": "reorder_questions",
            "section_id": section_id,
            "field_ids": ids if k % 2 else list(reversed(ids)),
        }
        for section_id, ids in built
        for k in range(ops_per_section)
    ]

    body = structured(await _edit(mcp_client, pat_primary_rw, project_id, template_id, ops))
    assert len(compact_json(body)) <= RESULT_CAP
    assert [a["count"] for a in body["applied"]] == [questions] * len(ops)
    assert all("field_ids" not in a for a in body["applied"])
    row = (
        await db_session.execute(
            text(
                "SELECT after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()
    assert [op["field_ids"] for op in row.after["ops"]] == [op["field_ids"] for op in ops]


async def test_failing_op_rolls_back_batch(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)

    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {"op": "add_question", "section_id": section_id, "label": "New Q", "type": "text"},
                {"op": "update_question", "field_id": field_id, "label": "Reworded"},
                {"op": "delete_question", "field_id": str(uuid4())},
            ],
            expected_fingerprint=fp,
        )
    )
    assert payload["code"] == "NOT_FOUND"
    assert payload["op_index"] == 2
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None


async def test_unknown_op_lists_allowed_ops(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    payload = error_payload(
        await _edit(mcp_client, pat_primary_rw, project_id, template_id, [{"op": "publish"}])
    )
    assert payload["code"] == "OP_NOT_ALLOWED_VIA_AGENT"
    assert payload["allowed_ops"] == _ALLOWED


async def test_one_applied_row_covers_each_op(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    shrinking = _sections_with_fields(schema, minimum=2)[0]
    others = [s for s in _sections_with_fields(schema) if s["id"] != shrinking["id"]]
    target, landing = others[:2]
    moved = (await _ordered_field_ids(db_session, shrinking["id"]))[0]
    remaining = (await _ordered_field_ids(db_session, shrinking["id"]))[1:]
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)

    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "add_question",
                    "section_id": target["id"],
                    "label": "Extra",
                    "type": "text",
                },
                {"op": "update_question", "field_id": target["fields"][0]["id"], "label": "New"},
                {
                    "op": "move_question",
                    "field_id": moved,
                    "section_id": landing["id"],
                    "position": 0,
                },
                {
                    "op": "reorder_questions",
                    "section_id": shrinking["id"],
                    "field_ids": list(reversed(remaining)),
                },
            ],
            expected_fingerprint=fp,
        )
    )
    expected = ["add_question", "update_question", "move_question", "reorder_questions"]
    assert [a["op"] for a in body["applied"]] == expected
    row = (
        await db_session.execute(
            text(
                "SELECT before, after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()
    assert [op["op"] for op in row.after["ops"]] == expected
    assert row.after["ops"][3]["field_ids"] == list(reversed(remaining))
    assert row.before["ops"][2]["section_id"] == shrinking["id"]
