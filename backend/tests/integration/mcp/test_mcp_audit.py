"""The one audit flow for MCP write tools (spec §6.1): read tools and access
refusals write no row; a missing/expired/revoked PAT never reaches a tool."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient
from mcp.types import CallToolResult
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.errors import AUDITED_CODES, McpErrorCode
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services import agent_template_draft_service, template_field_service
from app.services.pat_service import create_token, revoke_token
from app.services.template_field_service import DuplicateFieldNameError
from app.utils.rate_limiter import limiter
from tests.integration.conftest import SEED, get_config_draft_marker, set_config_draft_marker
from tests.integration.helpers.template_fixtures import fresh_charms
from tests.integration.mcp.rpc import rpc
from tests.integration.mcp.tool_calls import call_tool, error_payload

_AUDITED = {
    "INVALID_ARGUMENT",
    "DRAFT_LOCK_HELD",
    "NARROW_BASELINE",
    "NO_PUBLISHED_VERSION",
    "OP_NOT_ALLOWED_VIA_AGENT",
    "TOO_MANY_OPS",
    "FIELD_NOT_EDITABLE",
    "STALE_VALUE",
    "DUPLICATE_NAME",
    "RETRY",
}


class _Pg(Exception):
    sqlstate = "40P01"


def _section_id(schema: dict[str, Any]) -> str:
    return next(et for et in schema["entity_types"] if et.get("fields"))["id"]


async def _audit_count(
    db: AsyncSession, *, outcome: str, error_code: str | None = None, tool: str | None = None
) -> int:
    sql = "SELECT count(*) FROM public.agent_actions WHERE outcome = :o"
    params: dict[str, str] = {"o": outcome}
    if error_code is not None:
        sql += " AND error_code = :c"
        params["c"] = error_code
    if tool is not None:
        sql += " AND tool = :t"
        params["t"] = tool
    return (await db.execute(text(sql), params)).scalar_one()


async def test_read_tool_writes_no_row(mcp_client, pat_primary_rw, db_session: AsyncSession):
    before = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()

    await call_tool(mcp_client, pat_primary_rw, "list_projects", {})
    await call_tool(
        mcp_client, pat_primary_rw, "get_project", {"project_id": str(SEED.primary_project)}
    )

    after = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after == before


async def test_http_401_writes_no_row(mcp_http_client: AsyncClient, db_session: AsyncSession):
    current_description = (
        await db_session.execute(
            text("SELECT description FROM public.projects WHERE id = :id"),
            {"id": str(SEED.primary_project)},
        )
    ).scalar_one()

    created = await create_token(
        db_session,
        user_id=SEED.primary_profile,
        payload=PersonalAccessTokenCreateRequest(
            name="pytest-401", scope="read_write", expires_in_days=30
        ),
    )
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
            "WHERE id = :id"
        ),
        {"id": str(created.token.id)},
    )

    revoked = await create_token(
        db_session,
        user_id=SEED.primary_profile,
        payload=PersonalAccessTokenCreateRequest(
            name="pytest-401-revoked", scope="read_write", expires_in_days=30
        ),
    )
    await revoke_token(db_session, user_id=SEED.primary_profile, token_id=revoked.token.id)

    before = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()

    arguments = {
        "name": "update_project_details",
        "arguments": {
            "project_id": str(SEED.primary_project),
            "fields": {"description": "x"},
            "expected": {"description": current_description},
        },
    }
    for headers in (
        {},
        {"Authorization": f"Bearer {created.secret}"},
        {"Authorization": f"Bearer {revoked.secret}"},
    ):
        r = await rpc(mcp_http_client, "tools/call", arguments, headers=headers)
        assert r.status_code == 401

    after = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after == before

    unchanged_description = (
        await db_session.execute(
            text("SELECT description FROM public.projects WHERE id = :id"),
            {"id": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert unchanged_description == current_description


async def _build_drivers(
    mcp_client,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    pat_primary_rw,
    pat_reviewer_rw,
    pat_primary_read,
) -> dict[McpErrorCode, Callable[[], Awaitable[CallToolResult]]]:
    """One driver per :class:`McpErrorCode`; a missing entry fails
    ``test_audit_row_matrix`` outright, so a new enum member needs a case here."""

    # NOT_FOUND and RATE_LIMITED are driven through the WRITE tool (write
    # bucket): an unaudited code must write no row even where rows are written.
    async def not_found() -> CallToolResult:
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(uuid4()),
                "ops": [{"op": "add_question", "section_id": str(uuid4()), "label": "Q"}],
            },
        )

    async def manager_required() -> CallToolResult:
        return await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "update_project_details",
            {
                "project_id": str(SEED.primary_project),
                "fields": {"description": "x"},
                "expected": {"description": None},
            },
        )

    async def scope_insufficient() -> CallToolResult:
        return await call_tool(
            mcp_client,
            pat_primary_read,
            "update_project_details",
            {
                "project_id": str(SEED.primary_project),
                "fields": {"description": "x"},
                "expected": {"description": None},
            },
        )

    async def invalid_argument() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)
        return await call_tool(
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
                        "label": "x" * 101,
                        "type": "text",
                    }
                ],
            },
        )

    async def draft_lock_held() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)
        await db_session.execute(
            text(
                "UPDATE public.project_extraction_templates SET config_draft_by = :r WHERE id = :t"
            ),
            {"r": str(SEED.reviewer_profile), "t": str(template_id)},
        )
        await db_session.flush()
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [
                    {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}
                ],
            },
        )

    async def narrow_baseline() -> CallToolResult:
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(SEED.primary_template),
                "ops": [
                    {
                        "op": "add_question",
                        "section_id": str(SEED.primary_entity_type),
                        "label": "Q",
                        "type": "text",
                    }
                ],
            },
        )

    async def no_published_version() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)
        await db_session.execute(
            text(
                "UPDATE public.extraction_template_versions SET is_active = false "
                "WHERE project_template_id = :t"
            ),
            {"t": str(template_id)},
        )
        await db_session.flush()
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [
                    {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}
                ],
            },
        )

    async def op_not_allowed_via_agent() -> CallToolResult:
        project_id, template_id, _schema = await fresh_charms(db_session)
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [{"op": "delete_question"}],
            },
        )

    async def too_many_ops() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)
        ops = [
            {"op": "add_question", "section_id": section_id, "label": f"Q{i}", "type": "text"}
            for i in range(26)
        ]
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
        )

    async def field_not_editable() -> CallToolResult:
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "update_project_details",
            {
                "project_id": str(SEED.primary_project),
                "fields": {"settings": {}},
                "expected": {"settings": {}},
            },
        )

    async def stale_value() -> CallToolResult:
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "update_project_details",
            {
                "project_id": str(SEED.primary_project),
                "fields": {"description": "x"},
                "expected": {"description": "definitely-not-the-current-value"},
            },
        )

    async def duplicate_name() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)

        async def _raise(*_a: Any, **_k: Any) -> None:
            raise DuplicateFieldNameError("dup")

        monkeypatch.setattr(template_field_service, "create_field", _raise)
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [
                    {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}
                ],
            },
        )

    async def retry() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)

        async def _raise(*_a: Any, **_k: Any) -> None:
            raise DBAPIError("INSERT", {}, _Pg())

        monkeypatch.setattr(template_field_service, "create_field", _raise)
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [
                    {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}
                ],
            },
        )

    async def rate_limited() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)
        monkeypatch.setattr(limiter.limiter, "hit", lambda *_a, **_k: False)
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [
                    {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}
                ],
            },
        )

    async def internal_error() -> CallToolResult:
        project_id, template_id, schema = await fresh_charms(db_session)
        section_id = _section_id(schema)

        async def _raise(*_a: Any, **_k: Any) -> None:
            raise RuntimeError("boom")

        monkeypatch.setattr(agent_template_draft_service, "apply_draft_ops", _raise)
        return await call_tool(
            mcp_client,
            pat_primary_rw,
            "edit_template_draft",
            {
                "project_id": str(project_id),
                "template_id": str(template_id),
                "ops": [
                    {"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}
                ],
            },
        )

    return {
        McpErrorCode.NOT_FOUND: not_found,
        McpErrorCode.MANAGER_REQUIRED: manager_required,
        McpErrorCode.SCOPE_INSUFFICIENT: scope_insufficient,
        McpErrorCode.INVALID_ARGUMENT: invalid_argument,
        McpErrorCode.DRAFT_LOCK_HELD: draft_lock_held,
        McpErrorCode.NARROW_BASELINE: narrow_baseline,
        McpErrorCode.NO_PUBLISHED_VERSION: no_published_version,
        McpErrorCode.OP_NOT_ALLOWED_VIA_AGENT: op_not_allowed_via_agent,
        McpErrorCode.TOO_MANY_OPS: too_many_ops,
        McpErrorCode.FIELD_NOT_EDITABLE: field_not_editable,
        McpErrorCode.STALE_VALUE: stale_value,
        McpErrorCode.DUPLICATE_NAME: duplicate_name,
        McpErrorCode.RETRY: retry,
        McpErrorCode.RATE_LIMITED: rate_limited,
        McpErrorCode.INTERNAL_ERROR: internal_error,
    }


@pytest.mark.parametrize("code", list(McpErrorCode))
async def test_audit_row_matrix(
    mcp_client,
    pat_primary_rw,
    pat_reviewer_rw,
    pat_primary_read,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    code: McpErrorCode,
) -> None:
    drivers = await _build_drivers(
        mcp_client, db_session, monkeypatch, pat_primary_rw, pat_reviewer_rw, pat_primary_read
    )
    result = await drivers[code]()
    assert error_payload(result)["code"] == code.value
    assert await _audit_count(db_session, outcome="refused", error_code=code.value) == (
        1 if code.value in _AUDITED else 0
    )


def test_audited_codes_pinned_to_spec_table() -> None:
    assert {c.value for c in AUDITED_CODES} == _AUDITED


async def test_applied_draft_row_matches_draft_marker(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id = _section_id(schema)
    await set_config_draft_marker(db_session, template_id, None)

    await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(project_id),
            "template_id": str(template_id),
            "ops": [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}],
        },
    )

    applied_created_at = (
        await db_session.execute(
            text(
                "SELECT created_at FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).scalar_one()  # exactly one applied row
    marker = await get_config_draft_marker(db_session, template_id)
    assert applied_created_at == marker
