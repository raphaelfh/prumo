"""The one audit flow for MCP write tools (spec §6.1): read tools and access
refusals write no row; a missing/expired/revoked PAT never reaches a tool."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import create_token, revoke_token
from tests.integration.conftest import SEED
from tests.integration.mcp.rpc import rpc
from tests.integration.mcp.tool_calls import call_tool


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
