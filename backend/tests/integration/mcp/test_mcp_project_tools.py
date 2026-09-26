"""list_projects / get_project tool-logic tests (task 6a): the in-memory SDK
client, so handler lines register coverage (the ASGI blind spot)."""

from app.schemas.mcp_projects import McpProjectList, McpProjectOverview
from tests.integration.conftest import SEED
from tests.integration.mcp.tool_calls import call_tool, structured


async def test_list_projects_tool(mcp_client, pat_primary_read):
    body = structured(await call_tool(mcp_client, pat_primary_read, "list_projects", {}))
    McpProjectList.model_validate(body)
    assert body["token_scope"] == "read"
    assert {p["project_id"] for p in body["projects"]} >= {
        str(SEED.primary_project),
        str(SEED.secondary_project),
    }


async def test_list_projects_empty_state(mcp_client, pat_outsider_rw):
    body = structured(await call_tool(mcp_client, pat_outsider_rw, "list_projects", {}))
    assert body["projects"] == []
    assert body["note"] == "This token's user belongs to no project."


async def test_get_project_tool(mcp_client, pat_reviewer_rw):
    body = structured(
        await call_tool(
            mcp_client, pat_reviewer_rw, "get_project", {"project_id": str(SEED.primary_project)}
        )
    )
    McpProjectOverview.model_validate(body)
    assert body["role"] == "reviewer"


async def test_project_tools_metadata(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    for name in ("list_projects", "get_project"):
        t = tools[name]
        assert t.title and t.output_schema
        a = t.annotations
        assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
            True,
            False,
            True,
            False,
        )
