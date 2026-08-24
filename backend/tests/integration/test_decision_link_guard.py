"""Guards on caller-supplied ``proposal_record_id`` for non-accept decisions,
plus the reviewer-role gate on the run write endpoints (PR1 of the 2026-07-04
consensus-AI-trace spec).

An ``edit`` decision may carry ``proposal_record_id`` (the AI basis the value
originated from — D0). The link lands in the append-only audit trail the
consensus trace renders, so the service must reject links that do not
reference an AI proposal on the same (instance, field). Run equality is
intentionally NOT required: select-version legitimately pins proposals from
older runs of the same article.
"""

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED, make_ai_proposal

API_PREFIX = "/api/v1/runs"


def _auth_as(profile_id: UUID) -> None:
    async def override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override


@pytest_asyncio.fixture
async def auth_as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    del db_session  # ordering: the seed runs first
    _auth_as(SEED.primary_profile)
    yield SEED.primary_profile


async def _seeded(db: AsyncSession) -> bool:
    return (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is not None


async def _create_run_in_extract(client: AsyncClient) -> UUID:
    res = await client.post(
        API_PREFIX,
        json={
            "project_id": str(SEED.primary_project),
            "article_id": str(SEED.primary_article),
            "project_template_id": str(SEED.primary_template),
        },
    )
    assert res.status_code == 201, res.text
    run_id = UUID(res.json()["data"]["id"])
    adv = await client.post(f"{API_PREFIX}/{run_id}/advance", json={"target_stage": "extract"})
    assert adv.status_code == 200, adv.text
    return run_id


async def _seed_ai_proposal(db: AsyncSession, run_id: UUID) -> UUID:
    """Seed the AI basis a link can point at.

    The API rejects source='ai' (server-generated), so this goes straight to
    the table. ``db_client`` overrides ``get_db`` with this very session, so
    the row is visible over HTTP.
    """
    record = await make_ai_proposal(
        db,
        run_id=run_id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        confidence_score=0.9,
    )
    return record.id


def _edit_body(field_id: UUID, proposal_id: UUID) -> dict[str, object]:
    return {
        "instance_id": str(SEED.primary_instance),
        "field_id": str(field_id),
        "decision": "edit",
        "value": {"value": "typed"},
        "proposal_record_id": str(proposal_id),
    }


@pytest.mark.asyncio
async def test_edit_decision_with_valid_same_coord_link_persists(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """Positive control: a same-run, same-coord AI link is accepted and echoed."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)
    proposal_id = await _seed_ai_proposal(db_session, run_id)

    res = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json=_edit_body(SEED.primary_field, proposal_id),
    )
    assert res.status_code == 201, res.text
    assert res.json()["data"]["proposal_record_id"] == str(proposal_id)


@pytest.mark.asyncio
async def test_edit_decision_link_must_match_coord(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """A link to an AI proposal on a DIFFERENT field of the same instance is
    rejected — otherwise the trace would attribute a foreign field's AI output."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)
    proposal_id = await _seed_ai_proposal(db_session, run_id)

    # A second, coherent field on the seed entity type (raw insert: Python-side
    # column defaults don't apply, so supply them explicitly).
    other_field = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order,"
            " allow_other, created_at, updated_at) "
            "VALUES (:id, :et, 'link_guard_probe', 'Link guard probe', 'text', false,"
            " 999, false, now(), now())"
        ),
        {"id": str(other_field), "et": str(SEED.primary_entity_type)},
    )
    await db_session.flush()

    res = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json=_edit_body(other_field, proposal_id),
    )
    assert res.status_code == 400, res.text
    assert "proposal" in res.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_edit_decision_link_rejects_human_proposal(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """A human-source proposal is not an AI basis — linking it must 400."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)

    human_proposal = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, source_user_id,"
            " proposed_value, created_at, updated_at) "
            "VALUES (:id, :run, :inst, :field, 'human', :uid, :val, now(), now())"
        ),
        {
            "id": str(human_proposal),
            "run": str(run_id),
            "inst": str(SEED.primary_instance),
            "field": str(SEED.primary_field),
            "uid": str(SEED.primary_profile),
            "val": '{"value": "typed by a person"}',
        },
    )
    await db_session.flush()

    res = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json=_edit_body(SEED.primary_field, human_proposal),
    )
    assert res.status_code == 400, res.text
    assert "ai proposal" in res.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_edit_decision_link_same_coord_older_run_ok(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """Select-version pins proposals from older runs of the same article —
    the guard must accept a cross-run link when the coord matches."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    older_run = await _create_run_in_extract(db_client)
    older_proposal = await _seed_ai_proposal(db_session, older_run)

    # uq_one_live_extraction_run_per_coord (0045): only one live run per
    # coordinate — finalize the older run before creating its successor.
    await db_session.execute(
        text(
            "UPDATE public.extraction_runs "
            "SET stage = 'finalized', status = 'completed' WHERE id = :rid"
        ),
        {"rid": str(older_run)},
    )
    await db_session.flush()

    newer_run = await _create_run_in_extract(db_client)
    res = await db_client.post(
        f"{API_PREFIX}/{newer_run}/decisions",
        json=_edit_body(SEED.primary_field, older_proposal),
    )
    assert res.status_code == 201, res.text
    assert res.json()["data"]["proposal_record_id"] == str(older_proposal)


@pytest.mark.asyncio
async def test_link_guard_service_direct(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """Same guard exercised by direct service calls.

    The API-level cases above run inside the ASGI transport, whose executed
    lines do not register on coverage (the diff-cover blind spot); these
    direct calls cover the guard body itself.
    """
    from app.services.extraction_review_service import (
        ExtractionReviewService,
        InvalidDecisionError,
    )

    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)
    proposal_id = await _seed_ai_proposal(db_session, run_id)

    other_field = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order,"
            " allow_other, created_at, updated_at) "
            "VALUES (:id, :et, 'link_guard_probe_svc', 'Link guard probe svc', 'text',"
            " false, 998, false, now(), now())"
        ),
        {"id": str(other_field), "et": str(SEED.primary_entity_type)},
    )
    await db_session.flush()

    service = ExtractionReviewService(db_session)

    # Wrong coord → rejected by the guard.
    with pytest.raises(InvalidDecisionError, match="AI proposal"):
        await service.record_decision(
            run_id=run_id,
            instance_id=SEED.primary_instance,
            field_id=other_field,
            reviewer_id=SEED.primary_profile,
            decision="edit",
            proposal_record_id=proposal_id,
            value={"value": "typed"},
        )

    # Nonexistent proposal id → rejected (proposal is None branch).
    with pytest.raises(InvalidDecisionError, match="AI proposal"):
        await service.record_decision(
            run_id=run_id,
            instance_id=SEED.primary_instance,
            field_id=SEED.primary_field,
            reviewer_id=SEED.primary_profile,
            decision="edit",
            proposal_record_id=uuid4(),
            value={"value": "typed"},
        )

    # Same-coord AI link → accepted and persisted with the link.
    record = await service.record_decision(
        run_id=run_id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        proposal_record_id=proposal_id,
        value={"value": "typed"},
    )
    assert record.proposal_record_id == proposal_id


@pytest.mark.asyncio
async def test_human_proposal_forged_source_user_id_rejected(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """``CreateProposalRequest`` carries no attribution field (extra='forbid'):
    a client-supplied ``source_user_id`` is an unknown field and dies at body
    validation. Human proposals are attributed server-side to the
    authenticated caller, so forged attribution is unrepresentable at the
    API boundary — not merely guarded."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)

    res = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "source": "human",
            "proposed_value": {"value": "typed"},
            "source_user_id": str(SEED.outsider_profile),
        },
    )
    assert res.status_code == 422, res.text
    assert "source_user_id" in res.text


@pytest.mark.asyncio
async def test_viewer_cannot_write_decisions_or_proposals(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """The write endpoints are reviewer-role-gated, not just membership-gated
    (mirrors mark_ready; a read-only viewer's writes must 403)."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)

    await db_session.execute(
        text(
            "INSERT INTO public.project_members (project_id, user_id, role) "
            "VALUES (:pid, :uid, 'viewer')"
        ),
        {"pid": str(SEED.primary_project), "uid": str(SEED.outsider_profile)},
    )
    await db_session.flush()

    _auth_as(SEED.outsider_profile)
    dec = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "decision": "edit",
            "value": {"value": "viewer typed"},
        },
    )
    assert dec.status_code == 403, dec.text
    assert "reviewer role required" in dec.json()["error"]["message"].lower()

    prop = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "source": "human",
            "proposed_value": {"value": "viewer proposal"},
        },
    )
    assert prop.status_code == 403, prop.text


@pytest.mark.asyncio
async def test_viewer_cannot_advance_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """/advance is reviewer-role-gated (D8-c: advancing a QA run now WRITES
    decision rows via materialization — a read-only viewer must not trigger
    that, or any stage transition)."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)

    await db_session.execute(
        text(
            "INSERT INTO public.project_members (project_id, user_id, role) "
            "VALUES (:pid, :uid, 'viewer') ON CONFLICT DO NOTHING"
        ),
        {"pid": str(SEED.primary_project), "uid": str(SEED.outsider_profile)},
    )
    await db_session.flush()

    _auth_as(SEED.outsider_profile)
    res = await db_client.post(f"{API_PREFIX}/{run_id}/advance", json={"target_stage": "consensus"})
    assert res.status_code == 403, res.text
    stage = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :r"),
            {"r": str(run_id)},
        )
    ).scalar()
    assert stage == "extract", "a viewer's advance must not transition the run"


@pytest.mark.asyncio
async def test_system_proposal_rejected_via_api(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """'system' proposals are server-generated (reopen seeding); for QA runs
    they hydrate into EVERY caller's baseline via current_values Layer-1, so
    an authenticated member must not be able to plant them."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)

    res = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "source": "system",
            "proposed_value": {"value": "planted"},
        },
    )
    assert res.status_code == 400, res.text
    assert "server-generated" in res.json()["error"]["message"]


@pytest.mark.asyncio
async def test_ai_proposal_rejected_via_api(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """'ai' proposals are server-generated too: the real writer is
    ``SectionExtractionService``, which calls ``record_proposal`` in-process
    and never crosses this endpoint. Accepting 'ai' here let any reviewer
    plant a forged suggestion that blind peers read as unattributed AI
    output (extraction_run_read_service strips attribution for them), and
    the rationale/confidence render as if a model produced them.
    """
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run_in_extract(db_client)

    res = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
            "source": "ai",
            "proposed_value": {"value": "forged-ai-suggestion"},
            "confidence_score": 0.99,
            "rationale": "looks authoritative",
        },
    )
    assert res.status_code == 400, res.text
    assert "server-generated" in res.json()["error"]["message"]

    planted = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_proposal_records "
                "WHERE run_id = :r AND source = 'ai'"
            ),
            {"r": str(run_id)},
        )
    ).scalar()
    assert planted == 0, "a rejected 'ai' proposal must leave no row behind"
