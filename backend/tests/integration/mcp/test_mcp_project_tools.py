"""list_projects / get_project tool-logic tests (task 6a): the in-memory SDK
client, so handler lines register coverage (the ASGI blind spot)."""

from sqlalchemy import text

from app.schemas.mcp_projects import McpProjectList, McpProjectOverview
from tests.integration.conftest import SEED, clone_charms
from tests.integration.mcp.tool_calls import call_tool, structured


async def test_list_projects_tool(mcp_client, pat_primary_read):
    body = structured(await call_tool(mcp_client, pat_primary_read, "list_projects", {}))
    McpProjectList.model_validate(body)
    assert body["token_scope"] == "read"
    assert {p["project_id"] for p in body["projects"]} >= {
        str(SEED.primary_project),
        str(SEED.secondary_project),
    }


async def test_list_projects_reports_token_ai_run(
    mcp_client, pat_primary_read, pat_primary_read_ai_run
):
    without = structured(await call_tool(mcp_client, pat_primary_read, "list_projects", {}))
    granted = structured(await call_tool(mcp_client, pat_primary_read_ai_run, "list_projects", {}))

    assert (without["token_ai_run"], granted["token_ai_run"]) == (False, True)
    assert (without["token_scope"], granted["token_scope"]) == ("read", "read")


async def test_list_projects_empty_state(mcp_client, pat_outsider_rw):
    body = structured(await call_tool(mcp_client, pat_outsider_rw, "list_projects", {}))
    assert body["projects"] == []
    assert body["note"] == "This token's user belongs to no project."


async def test_get_project_tool(mcp_client, pat_reviewer_rw, db_session):
    clone = await clone_charms(db_session, SEED.primary_project, SEED.primary_profile)
    body = structured(
        await call_tool(
            mcp_client, pat_reviewer_rw, "get_project", {"project_id": str(SEED.primary_project)}
        )
    )
    McpProjectOverview.model_validate(body)
    assert body["role"] == "reviewer"
    assert body["templates"], "the seeded project has templates"
    by_id = {t["template_id"]: t for t in body["templates"]}
    assert all("instrument" in t for t in body["templates"])
    assert by_id[str(SEED.primary_template)]["instrument"] == "custom"
    assert by_id[str(clone.project_template_id)]["instrument"] == "charms"
    revision = (
        await db_session.execute(
            text("SELECT protocol_revision FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert body["protocol_revision"] == revision


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


async def test_list_projects_with_restricted_token_lists_only_its_projects(
    mcp_client, pat_primary_rw_only_a
):
    body = structured(await call_tool(mcp_client, pat_primary_rw_only_a, "list_projects", {}))
    assert [p["project_id"] for p in body["projects"]] == [str(SEED.primary_project)]
    assert body["token_project_ids"] == [str(SEED.primary_project)]


async def test_list_projects_with_unrestricted_token_has_no_token_project_ids(
    mcp_client, pat_primary_read
):
    body = structured(await call_tool(mcp_client, pat_primary_read, "list_projects", {}))
    assert body["token_project_ids"] is None
