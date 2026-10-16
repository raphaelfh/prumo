"""get_extractions tool-logic tests (task 8b): the in-memory SDK client, so
handler lines register coverage (the ASGI blind spot)."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.models.extraction import ExtractionEvidence
from app.models.extraction_workflow import ExtractionReviewerDecisionType
from app.schemas.mcp_extractions import McpExtractionsPage
from app.services.extraction_review_service import ExtractionReviewService
from app.utils.compact_json import RESULT_CAP, compact_json
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import run_in_extract
from tests.integration.helpers.template_fixtures import add_field, add_section
from tests.integration.helpers.value_contract_setup import (
    ContractRun,
    as_text_field,
    contract_run,
)
from tests.integration.mcp.article_seed import insert_article
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured
from tests.integration.test_blind_review_isolation import _build_two_reviewer_review_run


async def _built_review_run_template_id(db_session):
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built
    template_id = (
        await db_session.execute(
            text("SELECT template_id FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
    ).scalar_one()
    return template_id, reviewer_a, reviewer_b


async def test_get_extractions_concise_shape(mcp_client, pat_reviewer_rw, db_session):
    template_id, _reviewer_a, _reviewer_b = await _built_review_run_template_id(db_session)

    body = structured(
        await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "get_extractions",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(template_id),
                "article_id": str(SEED.primary_article),
                "response_format": "concise",
            },
        )
    )
    McpExtractionsPage.model_validate(body)
    assert body["response_format"] == "concise"
    assert body["questions"]
    assert (
        body["template_name"]
        == (
            await db_session.execute(
                text("SELECT name FROM public.project_extraction_templates WHERE id = :id"),
                {"id": str(template_id)},
            )
        ).scalar_one()
    )

    article = next(a for a in body["articles"] if a["article_id"] == str(SEED.primary_article))
    assert article["peer_values_hidden"] is True
    assert article["values"]
    for cell in article["values"].values():
        assert isinstance(cell["values"], list) and cell["values"]
        assert all("value" in v for v in cell["values"])
        assert cell["values_truncated"] is False
    assert "REVIEWER-B-SECRET" not in json.dumps(body)


async def test_get_extractions_detailed_default_with_article(
    mcp_client, pat_reviewer_rw, db_session
):
    template_id, _reviewer_a, _reviewer_b = await _built_review_run_template_id(db_session)

    body = structured(
        await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "get_extractions",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(template_id),
                "article_id": str(SEED.primary_article),
            },
        )
    )
    assert body["response_format"] == "detailed"
    article = body["articles"][0]
    assert article["rows"]
    for row in article["rows"]:
        assert row["decider"] in {"human", "ai", "consensus"}


async def test_response_size_cap_get_extractions(mcp_client, pat_primary_rw, db_session):
    for i in range(12):
        await insert_article(db_session, SEED.primary_project, title=f"cap-article-{i}")

    seen_ids: set[str] = set()
    cursor = None
    page_count = 0
    first_page_len = None
    while True:
        args = {
            "project_id": str(SEED.primary_project),
            "template_id": str(SEED.primary_template),
        }
        if cursor is not None:
            args["cursor"] = cursor
        result = await call_tool(mcp_client, pat_primary_rw, "get_extractions", args)
        body = structured(result)
        assert len(json.dumps(body)) <= 32_000
        if first_page_len is None:
            first_page_len = len(body["articles"])
            assert first_page_len <= 10
        for a in body["articles"]:
            assert a["article_id"] not in seen_ids
            seen_ids.add(a["article_id"])
        page_count += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert page_count > 1
    assert first_page_len is not None and first_page_len <= 10


async def test_get_extractions_bad_arguments(mcp_client, pat_primary_rw):
    args = {"project_id": str(SEED.primary_project), "template_id": str(SEED.primary_template)}

    result = await call_tool(
        mcp_client, pat_primary_rw, "get_extractions", {**args, "response_format": "full"}
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "response_format"

    result = await call_tool(mcp_client, pat_primary_rw, "get_extractions", {**args, "limit": 11})
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "limit"

    result = await call_tool(
        mcp_client, pat_primary_rw, "get_extractions", {**args, "cursor": "!!"}
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "cursor"


async def test_get_extractions_metadata(mcp_client, pat_primary_rw):
    async with mcp_client(pat_primary_rw) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    t = tools["get_extractions"]
    assert t.title and t.output_schema
    a = t.annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        True,
        False,
        True,
        False,
    )


async def _plant_typed_values(db_session) -> tuple[ContractRun, dict[UUID, UUID]]:
    """A null text, a `"22"` + mg number and a coded select, as the reviewer;
    returns the run and each field's decision id."""
    contract = await contract_run(db_session)
    await as_text_field(db_session, SEED.primary_field)
    review = ExtractionReviewService(db_session)
    planted = {
        SEED.primary_field: {"value": None},
        contract.number_id: {"value": "22", "unit": "mg"},
        contract.select_id: {"value": "dev"},
    }
    decisions: dict[UUID, UUID] = {}
    for field_id, value in planted.items():
        # The stored shapes predate the write-time contract; plant them as is.
        decision = await review.record_decision(
            run_id=contract.run_id,
            instance_id=contract.instance_id,
            field_id=field_id,
            reviewer_id=SEED.reviewer_profile,
            decision=ExtractionReviewerDecisionType.EDIT,
            value=value,
            enforce_contract=False,
        )
        decisions[field_id] = decision.id
    await db_session.flush()
    return contract, decisions


async def _get(mcp_client, pat, template_id, response_format: str) -> dict:
    body = structured(
        await call_tool(
            mcp_client,
            pat,
            "get_extractions",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(template_id),
                "article_id": str(SEED.primary_article),
                "response_format": response_format,
            },
        )
    )
    McpExtractionsPage.model_validate(body)
    assert len(compact_json(body)) <= RESULT_CAP
    return body


async def test_detailed_values_are_typed(mcp_client, pat_reviewer_rw, db_session):
    """Detailed rows carry typed values: a null stays null, a numeric string
    on a number field reads as a number with its unit, and a select code
    carries its option label."""
    contract, _decisions = await _plant_typed_values(db_session)

    body = structured(
        await call_tool(
            mcp_client,
            pat_reviewer_rw,
            "get_extractions",
            {
                "project_id": str(SEED.primary_project),
                "template_id": str(contract.template_id),
                "article_id": str(SEED.primary_article),
                "response_format": "detailed",
            },
        )
    )
    McpExtractionsPage.model_validate(body)
    rows = {
        row["field_id"]: row["value"]
        for row in body["articles"][0]["rows"]
        if row["reviewer"] == "self"
    }
    assert rows[str(SEED.primary_field)] == {"value": None}
    assert rows[str(contract.number_id)] == {"value": 22, "unit": "mg"}
    assert rows[str(contract.select_id)] == {"value": "dev", "label": "Development"}
    dumped = json.dumps(body)
    assert "None" not in dumped
    assert "22.0" not in dumped


async def test_concise_values_are_typed(mcp_client, pat_reviewer_rw, db_session):
    """Concise cells carry the same typed values as detailed rows, one per
    instance, never a joined string."""
    contract, _decisions = await _plant_typed_values(db_session)

    body = await _get(mcp_client, pat_reviewer_rw, contract.template_id, "concise")
    cells = body["articles"][0]["values"]
    assert cells[str(SEED.primary_field)]["values"] == [{"value": None}]
    assert cells[str(contract.number_id)]["values"] == [{"value": 22, "unit": "mg"}]
    assert cells[str(contract.select_id)]["values"] == [{"value": "dev", "label": "Development"}]
    for field_id in (SEED.primary_field, contract.number_id, contract.select_id):
        assert cells[str(field_id)]["values_truncated"] is False
    assert "None" not in json.dumps(body)


async def test_detailed_evidence_quote_flags_its_cut(mcp_client, pat_reviewer_rw, db_session):
    contract, decisions = await _plant_typed_values(db_session)
    db_session.add(
        ExtractionEvidence(
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            run_id=contract.run_id,
            reviewer_decision_id=decisions[contract.number_id],
            text_content="q" * 400,
            created_by=SEED.reviewer_profile,
        )
    )
    db_session.add(
        ExtractionEvidence(
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            run_id=contract.run_id,
            reviewer_decision_id=decisions[contract.select_id],
            text_content="short quote",
            created_by=SEED.reviewer_profile,
        )
    )
    await db_session.flush()

    body = await _get(mcp_client, pat_reviewer_rw, contract.template_id, "detailed")
    evidence = {
        row["field_id"]: row["evidence"]
        for row in body["articles"][0]["rows"]
        if row["reviewer"] == "self"
    }
    [long_quote] = evidence[str(contract.number_id)]
    assert long_quote["quote"] == "q" * 300
    assert long_quote["quote_truncated"] is True
    [short_quote] = evidence[str(contract.select_id)]
    assert short_quote["quote"] == "short quote"
    assert short_quote["quote_truncated"] is False


async def test_concise_values_truncate_on_many_instances(mcp_client, pat_primary_rw, db_session):
    """A repeating section with many long answers on one field: the cell keeps
    the instances whose compact JSON fits 1,000 characters, in instance order,
    and says it stopped."""
    section_id = await add_section(
        db_session, SEED.primary_template, "arms", cardinality="many", entry_label="Arm"
    )
    field_id = await add_field(db_session, section_id, "arm_note")
    instance_ids = [uuid4() for _ in range(15)]
    for position, instance_id in enumerate(instance_ids):
        await db_session.execute(
            text(
                "INSERT INTO public.extraction_instances "
                "(id, project_id, article_id, template_id, entity_type_id, label, sort_order, "
                " created_by) "
                "VALUES (:id, :pid, :aid, :tid, :et, 'arm', :o, :uid)"
            ),
            {
                "id": str(instance_id),
                "pid": str(SEED.primary_project),
                "aid": str(SEED.primary_article),
                "tid": str(SEED.primary_template),
                "et": str(section_id),
                "o": position,
                "uid": str(SEED.primary_profile),
            },
        )
    run = await run_in_extract(db_session)
    review = ExtractionReviewService(db_session)
    for position, instance_id in enumerate(instance_ids):
        await review.record_decision(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            reviewer_id=SEED.primary_profile,
            decision=ExtractionReviewerDecisionType.EDIT,
            value={"value": f"{position:02d}" + "x" * 78},
        )
    await db_session.flush()

    body = await _get(mcp_client, pat_primary_rw, SEED.primary_template, "concise")
    cell = body["articles"][0]["values"][str(field_id)]
    assert cell["values_truncated"] is True
    assert 0 < len(cell["values"]) < len(instance_ids)
    assert len(compact_json(cell["values"])) <= 1_000
    assert [v["value"][:2] for v in cell["values"]] == [
        f"{position:02d}" for position in range(len(cell["values"]))
    ]
