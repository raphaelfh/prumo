"""Acceptance: off-contract reviewer and consensus values are refused with 422.

Human writes (``POST /runs/{id}/decisions`` and a consensus manual override)
are canonicalized against the field as pinned in the run's template version;
system paths (approve-and-finalize, QA materialization, entry key prefill)
are never refused.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs

from app.main import app
from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.entry_hierarchy_service import EntryHierarchyService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED, land_ai_proposal
from tests.integration.helpers.engine_setup import client_as, run_in_extract
from tests.integration.helpers.value_contract_setup import ContractRun, contract_run


@pytest_asyncio.fixture
async def manager_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with client_as(str(SEED.primary_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def _count(db: AsyncSession, table: str, cr: ContractRun, field_id: UUID) -> int:
    return int(
        (
            await db.execute(
                text(
                    f"SELECT count(*) FROM public.{table} "  # noqa: S608 - fixed table names
                    "WHERE run_id = :r AND instance_id = :i AND field_id = :f"
                ),
                {"r": cr.run_id, "i": cr.instance_id, "f": field_id},
            )
        ).scalar_one()
    )


async def _decide(client: AsyncClient, cr: ContractRun, field_id: UUID, value: dict) -> Response:
    return await client.post(
        f"/api/v1/runs/{cr.run_id}/decisions",
        json={
            "instance_id": str(cr.instance_id),
            "field_id": str(field_id),
            "decision": "edit",
            "value": value,
        },
    )


def _assert_refused(resp: Response, reason: str, field_id: UUID) -> None:
    assert resp.status_code == 422, resp.text
    error = resp.json()["error"]
    assert error["code"] == "VALUE_CONTRACT_VIOLATION"
    assert error["details"] == {"field_id": str(field_id), "reason": reason}


async def test_off_vocabulary_select_is_refused_on_decisions(
    db_session: AsyncSession, manager_client: AsyncClient
) -> None:
    cr = await contract_run(db_session)
    before = await _count(db_session, "extraction_reviewer_decisions", cr, cr.select_id)
    resp = await _decide(manager_client, cr, cr.select_id, {"value": "nope"})
    _assert_refused(resp, "NOT_AN_OPTION", cr.select_id)
    assert await _count(db_session, "extraction_reviewer_decisions", cr, cr.select_id) == before


async def test_off_vocabulary_select_is_refused_on_consensus_override(
    db_session: AsyncSession, manager_client: AsyncClient
) -> None:
    cr = await contract_run(db_session)
    await RunLifecycleService(db_session).advance_stage(
        run_id=cr.run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )
    resp = await manager_client.post(
        f"/api/v1/runs/{cr.run_id}/consensus",
        json={
            "instance_id": str(cr.instance_id),
            "field_id": str(cr.select_id),
            "mode": "manual_override",
            "value": {"value": "nope"},
        },
    )
    _assert_refused(resp, "NOT_AN_OPTION", cr.select_id)
    assert await _count(db_session, "extraction_consensus_decisions", cr, cr.select_id) == 0
    assert await _count(db_session, "extraction_published_states", cr, cr.select_id) == 0


async def test_numeric_string_is_stored_as_number(
    db_session: AsyncSession, manager_client: AsyncClient
) -> None:
    cr = await contract_run(db_session)
    resp = await _decide(manager_client, cr, cr.number_id, {"value": "22"})
    assert resp.status_code == 201, resp.text
    stored = (
        await db_session.execute(
            text("SELECT value FROM public.extraction_reviewer_decisions WHERE id = :id"),
            {"id": resp.json()["data"]["id"]},
        )
    ).scalar_one()
    assert stored == {"value": 22}


async def test_unit_outside_allowed_units_is_refused(
    db_session: AsyncSession, manager_client: AsyncClient
) -> None:
    cr = await contract_run(db_session)
    resp = await _decide(manager_client, cr, cr.number_id, {"value": {"value": "5", "unit": "kg"}})
    _assert_refused(resp, "UNIT_NOT_ALLOWED", cr.number_id)


async def test_na_marker_refused_when_field_disallows(
    db_session: AsyncSession, manager_client: AsyncClient
) -> None:
    cr = await contract_run(db_session)
    resp = await _decide(
        manager_client, cr, cr.number_id, {"value": None, "absent_reason": "not_applicable"}
    )
    _assert_refused(resp, "MARKER_NOT_ALLOWED", cr.number_id)


async def test_option_only_in_draft_is_refused_and_pinned_option_accepted(
    db_session: AsyncSession, manager_client: AsyncClient
) -> None:
    cr = await contract_run(db_session)
    refused = await _decide(manager_client, cr, cr.select_id, {"value": "draft_only"})
    _assert_refused(refused, "NOT_AN_OPTION", cr.select_id)
    accepted = await _decide(manager_client, cr, cr.select_id, {"value": "dev"})
    assert accepted.status_code == 201, accepted.text


async def test_entry_with_label_as_key_is_created_without_decision(
    db_session: AsyncSession,
) -> None:
    """A select key typed as its LABEL is not an option code: the entry is
    still created, the prefill decision is skipped and logged without the value."""
    entity_type_id, key_id = uuid4(), uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, sort_order, entry_label) "
            "VALUES (:id, :tpl, :name, 'Models', 'many', 90, 'model')"
        ),
        {"id": entity_type_id, "tpl": SEED.primary_template, "name": f"m_{key_id.hex[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, is_entity_key, "
            " allowed_values) "
            "VALUES (:id, :et, 'model_type', 'Model type', 'select', 0, true, "
            " CAST(:av AS jsonb))"
        ),
        {
            "id": key_id,
            "et": entity_type_id,
            "av": json.dumps([{"value": "dev", "label": "Development"}]),
        },
    )
    run = await run_in_extract(db_session)

    with capture_logs() as logs:
        result = await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            template_id=SEED.primary_template,
            entity_type_id=entity_type_id,
            parent_instance_id=None,
            label="Development",
            entity_key="Development",
            user_id=SEED.primary_profile,
        )

    assert result.instance_id is not None
    decisions = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND field_id = :f"
            ),
            {"r": run.id, "f": key_id},
        )
    ).scalar_one()
    assert decisions == 0
    skipped = [entry for entry in logs if entry["event"] == "entry_key_prefill_skipped"]
    assert len(skipped) == 1
    assert skipped[0]["reason"] == "NOT_AN_OPTION"
    assert "Development" not in json.dumps(skipped[0], default=str)


async def test_approve_and_finalize_publishes_off_vocabulary_ai_value(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    proposal = await land_ai_proposal(
        db_session,
        run_id=cr.run_id,
        instance_id=cr.instance_id,
        field_id=cr.select_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "nope"},
    )
    await ExtractionReviewService(db_session).record_decision(
        run_id=cr.run_id,
        instance_id=cr.instance_id,
        field_id=cr.select_id,
        reviewer_id=SEED.primary_profile,
        decision="accept_proposal",
        proposal_record_id=proposal.id,
    )
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=cr.run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )

    finalized, published_count = await lifecycle.approve_and_finalize(
        run_id=cr.run_id, user_id=SEED.primary_profile
    )

    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    assert published_count == 1
    published = (
        await db_session.execute(
            text(
                "SELECT value FROM public.extraction_published_states "
                "WHERE run_id = :r AND field_id = :f"
            ),
            {"r": cr.run_id, "f": cr.select_id},
        )
    ).scalar_one()
    assert published == {"value": "nope"}


async def test_qa_materialization_carries_off_contract_proposal(
    db_session: AsyncSession,
) -> None:
    from tests.integration.test_proposal_landing import _setup_qa_run_with_instance_field
    from tests.integration.test_run_lifecycle_service import _insert_legacy_human_proposal

    built = await _setup_qa_run_with_instance_field(db_session)
    assert built is not None, "PRECONDITION: the seed graph builds a QA run"
    run_id, instance_id, field_id, profile_id = built
    await _insert_legacy_human_proposal(
        db_session,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        profile_id=profile_id,
        value="legacy text",
    )

    advanced = await RunLifecycleService(db_session).advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=profile_id
    )

    assert advanced.stage == ExtractionRunStage.CONSENSUS.value
    value = (
        await db_session.execute(
            text(
                "SELECT value FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND instance_id = :i AND field_id = :f"
            ),
            {"r": run_id, "i": instance_id, "f": field_id},
        )
    ).scalar_one()
    assert value == {"value": "legacy text"}
