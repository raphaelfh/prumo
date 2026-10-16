"""Direct service-level tests of the write-time value contract wiring.

The HTTP suite (``test_value_contract_writes.py``) proves the 422 envelope;
lines reached only through the ASGI transport record no coverage, so every
new service branch is driven here on ``db_session``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
)
from app.services.extraction_consensus_service import (
    ExtractionConsensusService,
    InvalidConsensusError,
)
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.extraction_snapshot import pinned_field
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.value_contract import ValueContractError
from tests.integration.conftest import SEED
from tests.integration.helpers.value_contract_setup import ContractRun, contract_run


async def _to_consensus(db: AsyncSession, cr: ContractRun) -> None:
    await RunLifecycleService(db).advance_stage(
        run_id=cr.run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )


async def _override(
    db: AsyncSession, cr: ContractRun, value: dict, *, field_id: UUID | None = None, **kw: Any
) -> tuple[ExtractionConsensusDecision, ExtractionPublishedState]:
    return await ExtractionConsensusService(db).record_consensus(
        run_id=cr.run_id,
        instance_id=cr.instance_id,
        field_id=field_id or cr.select_id,
        consensus_user_id=SEED.primary_profile,
        mode="manual_override",
        value=value,
        **kw,
    )


async def _edit(
    db: AsyncSession, cr: ContractRun, field_id: UUID, value: dict, **kw: Any
) -> ExtractionReviewerDecision:
    return await ExtractionReviewService(db).record_decision(
        run_id=cr.run_id,
        instance_id=cr.instance_id,
        field_id=field_id,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value=value,
        **kw,
    )


# --- pinned_field -------------------------------------------------------------


async def test_pinned_field_reads_the_pinned_options(db_session: AsyncSession) -> None:
    cr = await contract_run(db_session)
    field = await pinned_field(
        db_session, version_id=cr.version_id, template_id=cr.template_id, field_id=cr.select_id
    )
    assert field is not None
    assert [o.value for o in field.allowed_values or []] == ["dev", "val"]


async def test_pinned_field_falls_back_to_live_on_a_narrow_snapshot(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    narrow_v1 = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND version = 1"
            ),
            {"tid": cr.template_id},
        )
    ).scalar_one()
    field = await pinned_field(
        db_session, version_id=narrow_v1, template_id=cr.template_id, field_id=cr.select_id
    )
    assert field is not None
    assert [o.value for o in field.allowed_values or []] == ["dev", "val", "draft_only"]


async def test_pinned_field_is_none_for_a_field_outside_the_pinned_tree(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    field = await pinned_field(
        db_session,
        version_id=cr.version_id,
        template_id=cr.template_id,
        field_id=SEED.primary_field,
    )
    assert field is None


# --- record_decision ----------------------------------------------------------


async def test_decision_on_a_field_outside_the_pinned_tree_is_refused(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    with pytest.raises(InvalidDecisionError, match="not part of this run's template version"):
        await _edit(db_session, cr, SEED.primary_field, {"value": 5})


async def test_decision_off_vocabulary_select_raises_contract_error(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    with pytest.raises(ValueContractError) as raised:
        await _edit(db_session, cr, cr.select_id, {"value": "draft_only"})
    assert raised.value.details == {"field_id": str(cr.select_id), "reason": "NOT_AN_OPTION"}


async def test_decision_value_is_stored_canonical(db_session: AsyncSession) -> None:
    cr = await contract_run(db_session)
    record = await _edit(db_session, cr, cr.number_id, {"value": {"value": "5", "unit": "g"}})
    assert record.value == {"value": 5, "unit": "g"}


async def test_canonical_replay_dedupes(db_session: AsyncSession) -> None:
    cr = await contract_run(db_session)
    first = await _edit(db_session, cr, cr.number_id, {"value": "22"})
    again = await _edit(db_session, cr, cr.number_id, {"value": 22})
    assert again.id == first.id


async def test_system_carry_over_keeps_an_off_contract_value(db_session: AsyncSession) -> None:
    cr = await contract_run(db_session)
    record = await _edit(
        db_session, cr, cr.select_id, {"value": "legacy text"}, enforce_contract=False
    )
    assert record.value == {"value": "legacy text"}


# --- record_consensus ---------------------------------------------------------


async def test_override_off_vocabulary_raises_and_system_override_stores_it(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    await _to_consensus(db_session, cr)
    with pytest.raises(ValueContractError) as raised:
        await _override(db_session, cr, {"value": "nope"})
    assert raised.value.details == {"field_id": str(cr.select_id), "reason": "NOT_AN_OPTION"}

    consensus, published = await _override(
        db_session, cr, {"value": "nope"}, enforce_contract=False
    )
    assert consensus.value == {"value": "nope"}
    assert published.value == {"value": "nope"}


async def test_override_is_published_canonical(db_session: AsyncSession) -> None:
    cr = await contract_run(db_session)
    await _to_consensus(db_session, cr)
    consensus, published = await _override(
        db_session, cr, {"value": {"value": "5", "unit": "mg"}}, field_id=cr.number_id
    )
    assert consensus.value == {"value": 5, "unit": "mg"}
    assert published.value == {"value": 5, "unit": "mg"}


async def test_override_on_a_field_outside_the_pinned_tree_is_refused(
    db_session: AsyncSession,
) -> None:
    cr = await contract_run(db_session)
    await _to_consensus(db_session, cr)
    with pytest.raises(InvalidConsensusError, match="not part of this run's template version"):
        await _override(db_session, cr, {"value": 5}, field_id=SEED.primary_field)
