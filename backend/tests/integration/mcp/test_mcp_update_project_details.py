"""update_project_details tool-logic tests (task 9): the in-memory SDK
client, so handler lines register coverage (the ASGI blind spot)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.tools import project_details as project_details_tool
from app.services import project_details_service
from tests.integration.conftest import SEED
from tests.integration.mcp.test_mcp_audit import _audit_count
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

P = SEED.primary_project

_EDITABLE = [
    "condition_studied",
    "description",
    "eligibility_criteria",
    "name",
    "review_context",
    "review_keywords",
    "review_rationale",
    "review_title",
    "review_type",
    "search_strategy",
    "study_design",
]


async def _current(db: AsyncSession, *columns: str) -> dict[str, object]:
    cols = ", ".join(columns)
    row = (
        (
            await db.execute(
                text(f"SELECT {cols} FROM public.projects WHERE id = :id"), {"id": str(P)}
            )
        )
        .mappings()
        .one()
    )
    return dict(row)


class _Pg(Exception):
    sqlstate = "40P01"


def _raise_deadlock(*_args: object, **_kwargs: object) -> None:
    raise DBAPIError("UPDATE", {}, _Pg())


async def test_applied_edit_returns_before_after_and_writes_one_row(
    mcp_client, pat_primary_rw, db_session: AsyncSession
):
    current = await _current(db_session, "description")

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"description": "New"},
            "expected": {"description": current["description"]},
        },
    )
    body = structured(result)
    assert body == {
        "project_id": str(P),
        "before": {"description": current["description"]},
        "after": {"description": "New"},
        "note": None,
    }

    after = await _current(db_session, "description")
    assert after["description"] == "New"

    assert (await _audit_count(db_session, outcome="applied", tool="update_project_details")) == 1
    row = (
        (
            await db_session.execute(
                text(
                    "SELECT before, after, user_id, template_id, error_code "
                    "FROM public.agent_actions WHERE outcome = 'applied' AND tool = 'update_project_details'"
                )
            )
        )
        .mappings()
        .one()
    )
    assert row["before"] == body["before"]
    assert row["after"] == body["after"]
    assert row["user_id"] == SEED.primary_profile
    assert row["template_id"] is None
    assert row["error_code"] is None


async def test_review_type_change_carries_the_prompt_note(
    mcp_client, pat_primary_rw, db_session: AsyncSession
):
    current = await _current(db_session, "review_type")
    new_type = "diagnostic" if current["review_type"] != "diagnostic" else "prognostic"

    body = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "update_project_details",
            {
                "project_id": str(P),
                "fields": {"review_type": new_type},
                "expected": {"review_type": current["review_type"]},
            },
        )
    )
    assert body["note"] == (
        "review_type feeds the AI review question; it affects only runs started after this edit"
    )


@pytest.mark.parametrize(
    "fields",
    [{"picots_config_ai_review": {}}, {"settings": {}}, {"is_active": False}],
    ids=["picots_config_ai_review", "settings", "is_active"],
)
async def test_field_not_editable_lists_the_whitelist(
    mcp_client, pat_primary_rw, db_session: AsyncSession, fields: dict
):
    before_row = await _current(db_session, *["name", "description"])

    field = next(iter(fields))
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {"project_id": str(P), "fields": fields, "expected": {field: None}},
    )
    error = error_payload(result)
    assert error["code"] == "FIELD_NOT_EDITABLE"
    assert error["editable_fields"] == _EDITABLE
    assert error["field"] == field

    after_row = await _current(db_session, "name", "description")
    assert after_row == before_row

    assert (await _audit_count(db_session, outcome="refused", error_code="FIELD_NOT_EDITABLE")) == 1


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"name": ""}, "name"),
        ({"review_type": "meta"}, "review_type"),
        ({"review_keywords": "x"}, "review_keywords"),
    ],
    ids=["name", "review_type", "review_keywords"],
)
async def test_invalid_argument_names_the_field(
    mcp_client, pat_primary_rw, db_session: AsyncSession, fields: dict, field: str
):
    key = next(iter(fields))
    current = await _current(db_session, key)
    expected = {key: current[key]}

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {"project_id": str(P), "fields": fields, "expected": expected},
    )
    error = error_payload(result)
    assert error["code"] == "INVALID_ARGUMENT"
    assert error["retryable"] is False
    assert error["field"] == field

    assert (await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT")) == 1


async def test_expected_must_name_every_changed_key(
    mcp_client, pat_primary_rw, db_session: AsyncSession
):
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {"project_id": str(P), "fields": {"name": "X"}, "expected": {}},
    )
    error = error_payload(result)
    assert error["code"] == "INVALID_ARGUMENT"
    assert error["field"] == "expected.name"

    assert (await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT")) == 1


async def test_empty_fields_is_invalid(mcp_client, pat_primary_rw):
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {"project_id": str(P), "fields": {}, "expected": {}},
    )
    error = error_payload(result)
    assert error["code"] == "INVALID_ARGUMENT"
    assert error["field"] == "fields"


async def test_stale_value_returns_current_and_writes_nothing(
    mcp_client, pat_primary_rw, db_session: AsyncSession
):
    current = await _current(db_session, "name")

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"name": "Agent name"},
            "expected": {"name": "not the current name"},
        },
    )
    error = error_payload(result)
    assert error["code"] == "STALE_VALUE"
    assert error["current"] == {"name": current["name"]}

    after = await _current(db_session, "name")
    assert after["name"] == current["name"]

    assert (await _audit_count(db_session, outcome="refused", error_code="STALE_VALUE")) == 1
    assert (await _audit_count(db_session, outcome="applied")) == 0


async def test_deadlock_maps_to_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    current = await _current(db_session, "description")
    monkeypatch.setattr(project_details_service, "update_details", _raise_deadlock)

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"description": "New"},
            "expected": {"description": current["description"]},
        },
    )
    error = error_payload(result)
    assert error["code"] == "RETRY"
    assert error["retryable"] is True

    assert (await _audit_count(db_session, outcome="refused", error_code="RETRY")) == 1


async def test_deadlock_at_the_audit_insert_is_audited_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    current = await _current(db_session, "description")

    async def _raise(*_args: object, **_kwargs: object) -> None:
        raise DBAPIError("INSERT", {}, _Pg())

    monkeypatch.setattr(project_details_tool, "record_applied_write", _raise)

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"description": "New"},
            "expected": {"description": current["description"]},
        },
    )
    error = error_payload(result)
    assert error["code"] == "RETRY"

    after = await _current(db_session, "description")
    assert after["description"] == current["description"]

    assert (await _audit_count(db_session, outcome="refused", error_code="RETRY")) == 1
    assert (await _audit_count(db_session, outcome="applied")) == 0


async def test_unexpected_error_is_internal_with_no_row(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    current = await _current(db_session, "description")

    def _raise(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(project_details_service, "update_details", _raise)

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"description": "New"},
            "expected": {"description": current["description"]},
        },
    )
    error = error_payload(result)
    assert error["code"] == "INTERNAL_ERROR"

    assert (await _audit_count(db_session, outcome="refused")) == 0


async def test_update_project_details_requires_user_interaction_meta(mcp_client, pat_primary_rw):
    async with mcp_client(pat_primary_rw) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    t = tools["update_project_details"]
    assert t.meta["anthropic/requiresUserInteraction"] is True
    # F12: confirmation is client-dependent; the audit is not.
    assert "Clients that support it (e.g. Claude Code) ask" in t.description
    assert "audited" in t.description
    a = t.annotations
    assert a.destructive_hint is True
    assert a.idempotent_hint is True
    assert a.read_only_hint is False
    assert a.open_world_hint is False
    assert t.title
    assert t.output_schema is not None
    assert set(t.output_schema["properties"]) == {"project_id", "before", "after", "note"}


async def test_nul_in_a_string_is_invalid_argument_before_any_write(
    mcp_client, pat_primary_rw, db_session: AsyncSession
):
    """F10 (final review): Postgres text cannot hold U+0000 -- refused as the
    caller's INVALID_ARGUMENT naming the field (and audited), never an
    INTERNAL_ERROR from the UPDATE."""
    current = await _current(db_session, "description")

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"description": "bad\u0000value"},
            "expected": {"description": current["description"]},
        },
    )
    error = error_payload(result)
    assert error["code"] == "INVALID_ARGUMENT"
    assert error["field"] == "fields.description"
    assert (await _current(db_session, "description")) == current
    assert (await _audit_count(db_session, outcome="refused", error_code="INVALID_ARGUMENT")) == 1
