"""list_template_catalogue tool-logic tests: the in-memory SDK client, so
handler lines register coverage (the ASGI blind spot)."""

from __future__ import annotations

from app.api.mcp.tools import catalogue as catalogue_tool
from app.core.config import settings
from app.schemas.mcp_catalogue import McpTemplateCatalogue
from app.seed import (
    _CHARMS_TEMPLATE_ID,
    _MM_TEMPLATE_ID,
    _PROBAST_TEMPLATE_ID,
    _QUADAS2_TEMPLATE_ID,
)
from app.seed_probast_ai import _PROBAST_AI_TEMPLATE_ID
from app.services.template_catalogue_service import list_catalogue_for_project
from app.utils.compact_json import RESULT_CAP, compact_json
from tests.integration.conftest import SEED, clean_project_clones, clone_charms
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

P = SEED.secondary_project


async def _catalogue(mcp_client, pat, kind: str) -> dict:
    body = structured(
        await call_tool(
            mcp_client, pat, "list_template_catalogue", {"project_id": str(P), "kind": kind}
        )
    )
    McpTemplateCatalogue.model_validate(body)
    assert len(compact_json(body)) <= RESULT_CAP
    return body


def _codes(body: dict) -> dict[str, str]:
    return {row["global_template_id"]: row["instrument"] for row in body["rows"]}


async def test_extraction_catalogue_lists_charms_and_multimodal(
    mcp_client, pat_primary_read, db_session
):
    await clean_project_clones(db_session, P)
    body = await _catalogue(mcp_client, pat_primary_read, "extraction")

    codes = _codes(body)
    assert codes[str(_CHARMS_TEMPLATE_ID)] == "charms"
    assert codes[str(_MM_TEMPLATE_ID)] == "charms_mm"
    assert str(_PROBAST_TEMPLATE_ID) not in codes
    assert all(row["already_in_project"] is False for row in body["rows"])
    assert all(row["entity_types_count"] > 0 for row in body["rows"])
    assert body["kind"] == "extraction"
    assert body["project_id"] == str(P)
    assert body["project_name"]
    assert body["note"] is None
    assert body["next_step"] == (
        "A manager imports a template in prumo at "
        f"{settings.PUBLIC_APP_URL.rstrip('/')}/projects/{P}"
        "?tab=extraction&extractionTab=configuration. Importing publishes version 1 and, "
        "for extraction, replaces the active template."
    )


async def test_quality_catalogue_lists_the_assessment_tools(
    mcp_client, pat_primary_read, db_session
):
    await clean_project_clones(db_session, P)
    body = await _catalogue(mcp_client, pat_primary_read, "quality_assessment")

    codes = _codes(body)
    assert codes[str(_PROBAST_TEMPLATE_ID)] == "probast"
    assert codes[str(_QUADAS2_TEMPLATE_ID)] == "quadas2"
    assert codes[str(_PROBAST_AI_TEMPLATE_ID)] == "probast_ai"
    assert str(_CHARMS_TEMPLATE_ID) not in codes
    assert "tab=quality&qaTab=configuration" in body["next_step"]


async def test_an_imported_global_is_marked_already_in_project(
    mcp_client, pat_primary_read, db_session
):
    await clean_project_clones(db_session, P)
    await clone_charms(db_session, P, SEED.primary_profile)
    await db_session.flush()

    body = await _catalogue(mcp_client, pat_primary_read, "extraction")

    flags = {row["global_template_id"]: row["already_in_project"] for row in body["rows"]}
    assert flags[str(_CHARMS_TEMPLATE_ID)] is True
    assert flags[str(_MM_TEMPLATE_ID)] is False


async def test_the_import_flag_is_scoped_to_the_project(db_session):
    await clean_project_clones(db_session, P)
    await clean_project_clones(db_session, SEED.primary_project)
    await clone_charms(db_session, P, SEED.primary_profile)
    await db_session.flush()

    mine = await list_catalogue_for_project(db_session, project_id=P, kind="extraction")
    other = await list_catalogue_for_project(
        db_session, project_id=SEED.primary_project, kind="extraction"
    )

    assert next(flag for row, flag in mine if row.id == _CHARMS_TEMPLATE_ID) is True
    assert next(flag for row, flag in other if row.id == _CHARMS_TEMPLATE_ID) is False


async def test_an_empty_catalogue_says_so(mcp_client, pat_primary_read, monkeypatch):
    async def _none(*_args, **_kwargs):
        return []

    monkeypatch.setattr(catalogue_tool, "list_catalogue_for_project", _none)
    body = await _catalogue(mcp_client, pat_primary_read, "extraction")

    assert body["rows"] == []
    assert body["note"] == "No global templates of this kind."


async def test_an_unknown_kind_is_an_invalid_argument(mcp_client, pat_primary_read):
    result = await call_tool(
        mcp_client,
        pat_primary_read,
        "list_template_catalogue",
        {"project_id": str(P), "kind": "bogus"},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "kind"


async def test_catalogue_metadata(mcp_client, pat_primary_read):
    async with mcp_client(pat_primary_read) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    t = tools["list_template_catalogue"]
    assert t.title and t.output_schema
    assert "no clone or import tool" in t.description
    a = t.annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        True,
        False,
        True,
        False,
    )
