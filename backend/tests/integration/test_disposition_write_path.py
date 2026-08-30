"""ADR-0016 Phase 2 write-path normalization + consensus agreement on markers.

Three properties are load-bearing and pinned here:

1. ``ExtractionReviewService.record_decision`` normalizes a picked in-band
   disposition string into the coded ``absent_reason`` marker, scoped by the
   field's domain (a coincidental free-text match is left untouched).
2. The marker is persisted **verbatim** into ``ExtractionReviewerDecision.value``
   so the consensus agreement key distinguishes two different codes (same code
   agrees + publishes; different codes diverge) — the precondition the spec
   calls out for "distinct answers fall out for free".
3. An ALREADY-CODED ``no_information`` marker sent by a client is REFUSED on a
   field that opts out of it (``allows_no_information``, migration 0062), while
   a server carry-over of an already-stored marker still passes — the
   ``/decisions`` door is the one a client controls, and history must survive a
   template that later flipped the flag.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionRunStage
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)
from tests.integration.conftest import SEED

_NO_INFO = {"value": None, "absent_reason": "no_information"}
_NOT_APPLICABLE = {"value": None, "absent_reason": "not_applicable"}


async def _seed_ok(db: AsyncSession) -> bool:
    return (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is not None


async def _fresh_run(db: AsyncSession) -> object:
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :p "
            "AND article_id = :a AND template_id = :t"
        ),
        {
            "p": str(SEED.primary_project),
            "a": str(SEED.primary_article),
            "t": str(SEED.primary_template),
        },
    )
    svc = RunLifecycleService(db)
    run = await svc.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    await svc.advance_stage(run_id=run.id, target_stage="extract", user_id=SEED.primary_profile)
    return run


async def _set_field_domain(db: AsyncSession, allowed: list[str] | None) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET allowed_values = :v WHERE id = :id"),
        {"v": json.dumps(allowed) if allowed is not None else None, "id": str(SEED.primary_field)},
    )


async def _set_no_information_optin(db: AsyncSession, allowed: bool) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET allows_no_information = :v WHERE id = :id"),
        {"v": allowed, "id": str(SEED.primary_field)},
    )


async def _decision_value(db: AsyncSession, run_id) -> dict | None:
    return (
        await db.execute(
            text(
                "SELECT value FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :r AND field_id = :f ORDER BY created_at DESC LIMIT 1"
            ),
            {"r": str(run_id), "f": str(SEED.primary_field)},
        )
    ).scalar()


@pytest.mark.asyncio
async def test_record_decision_normalizes_picked_disposition_to_marker(
    db_session: AsyncSession,
) -> None:
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    # The field's domain offers "No information" (transitional dropdown option).
    await _set_field_domain(db_session, ["Yes", "No", "No information"])

    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value={"value": "No information"},
    )
    assert await _decision_value(db_session, run.id) == _NO_INFO
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_decision_leaves_free_text_disposition_untouched(
    db_session: AsyncSession,
) -> None:
    """A free-text field (no allowed_values) that legitimately holds "NA" must NOT
    be rewritten — the domain-scoped guard protects a coincidental match."""
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    await _set_field_domain(db_session, None)

    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value={"value": "NA"},
    )
    assert await _decision_value(db_session, run.id) == {"value": "NA"}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_two_reviewers_same_disposition_code_agree_and_publish(
    db_session: AsyncSession,
) -> None:
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    review = ExtractionReviewService(db_session)
    for reviewer in (SEED.primary_profile, SEED.reviewer_profile):
        await review.record_decision(
            run_id=run.id,
            instance_id=SEED.primary_instance,
            field_id=SEED.primary_field,
            reviewer_id=reviewer,
            decision="edit",
            value=dict(_NO_INFO),
        )
    svc = RunLifecycleService(db_session)
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=SEED.primary_profile)

    finalized, published_count = await svc.approve_and_finalize(
        run_id=run.id, user_id=SEED.primary_profile
    )
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    assert published_count == 1
    published = (
        await db_session.execute(
            text("SELECT value FROM public.extraction_published_states WHERE run_id = :r"),
            {"r": str(run.id)},
        )
    ).scalar()
    assert published == _NO_INFO, "the agreed marker must publish verbatim (not collapsed to null)"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_two_reviewers_different_disposition_codes_diverge(
    db_session: AsyncSession,
) -> None:
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    review = ExtractionReviewService(db_session)
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value=dict(_NO_INFO),
    )
    await review.record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.reviewer_profile,
        decision="edit",
        value=dict(_NOT_APPLICABLE),
    )
    svc = RunLifecycleService(db_session)
    await svc.advance_stage(run_id=run.id, target_stage="consensus", user_id=SEED.primary_profile)

    with pytest.raises(InvalidStageTransitionError, match="diverge"):
        await svc.approve_and_finalize(run_id=run.id, user_id=SEED.primary_profile)
    await db_session.rollback()


# =============== the coded-marker opt-in gate (migration 0062) ===============


@pytest_asyncio.fixture
async def auth_as_primary(
    db_client: AsyncClient,  # noqa: ARG001 - ordering: our override must win
) -> AsyncGenerator[UUID, None]:
    """Re-point ``get_current_user`` at the seed profile so the endpoint's
    membership + reviewer gates resolve against a real project member."""

    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(SEED.primary_profile),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = _override
    yield SEED.primary_profile


@pytest.mark.asyncio
async def test_record_decision_rejects_coded_marker_when_field_opts_out(
    db_session: AsyncSession,
) -> None:
    """A client that sends the marker ALREADY CODED must be refused, not obeyed.

    ``is_disposition_candidate`` is False for ``{"value": None,
    "absent_reason": ...}`` (the peeled value is null, not a string), so the
    in-band normalizer never sees this payload and its ``allows_no_information``
    scoping never fired. Stored, the marker renders neither as a value nor as a
    clearable reason on an opted-out field, while ``is_value_filled`` still
    counts the coordinate as filled.
    """
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    await _set_no_information_optin(db_session, False)

    with pytest.raises(InvalidDecisionError, match="no_information"):
        await ExtractionReviewService(db_session).record_decision(
            run_id=run.id,
            instance_id=SEED.primary_instance,
            field_id=SEED.primary_field,
            reviewer_id=SEED.primary_profile,
            decision="edit",
            value=dict(_NO_INFO),
        )
    assert await _decision_value(db_session, run.id) is None, "nothing may be persisted"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_decision_keeps_sibling_markers_on_a_no_information_optout(
    db_session: AsyncSession,
) -> None:
    """The opt-in is scoped to ``no_information`` alone — ``not_applicable`` on
    the same field is a different flag and still writes."""
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    await _set_no_information_optin(db_session, False)

    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value=dict(_NOT_APPLICABLE),
    )
    assert await _decision_value(db_session, run.id) == _NOT_APPLICABLE
    await db_session.rollback()


@pytest.mark.asyncio
async def test_create_decision_endpoint_refuses_the_marker_with_the_error_envelope(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_primary: UUID,  # noqa: ARG001 - installs the auth override
) -> None:
    """The one client-controlled door answers 4xx through the ``ApiResponse``
    error envelope (``error.message``), not FastAPI's bare ``detail``."""
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    await _set_no_information_optin(db_session, False)

    response = await db_client.post(
        f"/api/v1/runs/{run.id}/decisions",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "decision": "edit",
            "value": dict(_NO_INFO),
        },
    )
    assert response.status_code == 400, response.text
    payload = response.json()
    assert payload["ok"] is False
    assert "no_information" in payload["error"]["message"]
    assert "detail" not in payload
    assert await _decision_value(db_session, run.id) is None
    await db_session.rollback()


@pytest.mark.asyncio
async def test_materialize_carries_a_stored_marker_on_an_opted_out_field(
    db_session: AsyncSession,
) -> None:
    """Server carry-over is NOT gated: ``materialize_qa_decisions`` copies a
    human proposal stored BEFORE the field opted out, and that history must
    still reach consensus. Gating it would strand such a run in ``extract``
    (``advance_stage`` calls the materializer inside its FOR UPDATE
    transaction), which is the same reason reopen carry-over stays ungated.
    Pre-D8 rows are the only source of these proposals — ``record_proposal``
    has refused ``source='human'`` since the QA write path unified on
    ``/decisions``, so they are inserted here the way the DB still holds them.
    """
    if not await _seed_ok(db_session):
        pytest.skip("seed not present")
    run = await _fresh_run(db_session)
    await _set_no_information_optin(db_session, False)
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, source_user_id, proposed_value) "
            "VALUES (:id, :r, :i, :f, 'human', :u, CAST(:v AS jsonb))"
        ),
        {
            "id": str(uuid4()),
            "r": str(run.id),
            "i": str(SEED.primary_instance),
            "f": str(SEED.primary_field),
            "u": str(SEED.primary_profile),
            "v": json.dumps(_NO_INFO),
        },
    )

    inserted = await ExtractionReviewService(db_session).materialize_qa_decisions(run)

    assert inserted == 1
    assert await _decision_value(db_session, run.id) == _NO_INFO
    await db_session.rollback()
