"""Integration tests for AI-suggestion read service + article endpoints.

Tests:
1. Service: load_suggestions returns AI proposals with status resolved from
   the CALLER's reviewer_state — and reviewer A's overlay never reflects
   reviewer B's decisions (blind boundary / Constraint 3).
2. Service: get_suggestion_history returns proposals newest-first, no status.
3. Service: get_article_instance_ids returns instance ids for an article.
4. Endpoint GET /{article_id}/instance-ids — 200 + 403 BOLA.
5. Endpoint GET /{article_id}/suggestions — 200 + 403 BOLA.
6. Endpoint GET /{article_id}/suggestions/history — 200 + 403 BOLA.
7. Service: evidence.block_ids is populated from position.anchor.blockIds.

Pattern: mirrors test_run_view_endpoint.py / test_run_resolution_endpoints.py
  - db_client (real-DB AsyncClient from backend/tests/conftest.py)
  - auth_as_profile pins JWT sub to SEED.primary_profile
  - outsider_user for BOLA tests
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionEvidence, ExtractionRunStage
from app.models.extraction_workflow import (
    ExtractionProposalSource,
    ExtractionReviewerDecisionType,
)
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_review_service import ExtractionReviewService
from app.services.extraction_suggestion_read_service import (
    get_article_instance_ids,
    get_suggestion_history,
    load_suggestions,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

_ARTICLES_URL = "/api/v1/articles"

# ---------------------------------------------------------------------------
# Helpers re-used across service + endpoint tests
# ---------------------------------------------------------------------------

SECOND_REVIEWER_ID = UUID("ffffffff-9999-0000-0000-0000000000bb")


async def _build_suggestion_review_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID] | None:
    """Create a run in REVIEW stage with an AI proposal + two reviewer decisions.

    Returns ``(run_id, instance_id, field_id, reviewer_a, reviewer_b)``
    or ``None`` if the seed graph is incomplete.

    reviewer_a = SEED.reviewer_profile (existing reviewer member)
    reviewer_b = SECOND_REVIEWER_ID (added here, rolled back with test)
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template

    # Resolve a reviewer from the seed
    reviewer_a = SEED.reviewer_profile

    # Ensure reviewer_a is actually a member
    row = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": str(project_id), "uid": str(reviewer_a)},
        )
    ).scalar()
    if row is None:
        return None

    instance_id = SEED.primary_instance
    field_id = SEED.primary_field

    # Add second reviewer (in-test row, rolled back with session savepoint)
    await db.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(SECOND_REVIEWER_ID), "email": "reviewer-b-suggest@integration-test.prumo.local"},
    )
    await db.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, 'Integration Reviewer B (Suggest)') "
            "ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email"
        ),
        {"id": str(SECOND_REVIEWER_ID), "email": "reviewer-b-suggest@integration-test.prumo.local"},
    )
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, 'reviewer') "
            "ON CONFLICT (project_id, user_id) DO NOTHING"
        ),
        {"pid": str(project_id), "uid": str(SECOND_REVIEWER_ID)},
    )

    manager_id = SEED.primary_profile
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db)
    await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "AI-PROPOSED"},
        confidence_score=0.85,
        rationale="AI rationale",
    )

    review = ExtractionReviewService(db)
    # reviewer_a accepts the proposal (EDIT decision)
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_a,
        decision=ExtractionReviewerDecisionType.EDIT,
        value={"value": "REVIEWER-A-VALUE"},
    )
    # reviewer_b rejects
    await review.record_decision(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=SECOND_REVIEWER_ID,
        decision=ExtractionReviewerDecisionType.REJECT,
        value=None,
    )
    await db.flush()

    return run.id, instance_id, field_id, reviewer_a, SECOND_REVIEWER_ID


# ---------------------------------------------------------------------------
# Auth fixtures (same pattern as test_run_view_endpoint.py)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Pin JWT sub to SEED.primary_profile (manager of primary_project)."""
    del db_session  # fixture ordering: seed runs first
    profile_id = SEED.primary_profile

    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = _override
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def auth_as_reviewer(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Pin JWT sub to SEED.reviewer_profile."""
    del db_session
    profile_id = SEED.reviewer_profile

    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="reviewer@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = _override
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def outsider_user(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """A profile with no project membership — for BOLA tests."""
    import uuid as _uuid_mod

    outsider_id = _uuid_mod.uuid4()
    email = f"outsider-suggest-{outsider_id}@test.local"

    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.commit()

    profile_id = (
        await db_session.execute(
            text("SELECT id FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
    ).scalar()
    if profile_id is None:
        await db_session.execute(
            text("INSERT INTO public.profiles (id, full_name) VALUES (:id, 'Outsider Suggest')"),
            {"id": str(outsider_id)},
        )
        await db_session.commit()

    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(outsider_id),
            email=email,
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = _override
    try:
        yield outsider_id
    finally:
        await db_session.execute(
            text("DELETE FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
        await db_session.execute(
            text("DELETE FROM auth.users WHERE id = :id"),
            {"id": str(outsider_id)},
        )
        await db_session.commit()
        app.dependency_overrides.pop(get_current_user, None)


# ---------------------------------------------------------------------------
# SERVICE TESTS
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_suggestions_returns_ai_proposals(
    db_session: AsyncSession,
) -> None:
    """load_suggestions returns AI proposals for the given instance_ids."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, field_id, reviewer_a, _reviewer_b = built

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_a,
        run_id=run_id,
    )

    assert result.count >= 1
    assert len(result.suggestions) == result.count
    suggestion = result.suggestions[0]
    assert suggestion.instance_id == instance_id
    assert suggestion.field_id == field_id
    # proposed_value is the raw JSONB envelope
    assert suggestion.proposed_value == {"value": "AI-PROPOSED"}
    assert suggestion.confidence_score == pytest.approx(0.85)
    assert suggestion.rationale == "AI rationale"


@pytest.mark.asyncio
async def test_load_suggestions_includes_run_provenance(
    db_session: AsyncSession,
) -> None:
    """A suggestion carries its run's provenance snapshot (how it was generated)."""
    import json

    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, field_id, reviewer_a, _reviewer_b = built

    prov = {
        "model": "gpt-4o-mini",
        "strategy": "section_extraction",
        "ran_by_user_id": str(SEED.primary_profile),
        "params": {"temperature": 0.1, "output_retries": 2},
        "tokens": {"total": 1240},
    }
    await db_session.execute(
        text(
            "UPDATE extraction_runs "
            "SET results = jsonb_set(coalesce(results, '{}'::jsonb), "
            "'{provenance}', cast(:p as jsonb)) WHERE id = :id"
        ),
        {"p": json.dumps(prov), "id": str(run_id)},
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_a,
        run_id=run_id,
    )
    # The hot load path returns the raw snapshot verbatim (no profiles join).
    assert result.suggestions[0].provenance == prov

    history = await get_suggestion_history(
        db_session, instance_id, field_id, article_id=SEED.primary_article
    )
    # The history (popover) path resolves the runner's display name on top of
    # the raw snapshot — assert every raw key survives unchanged.
    hist_prov = history[0].provenance
    assert hist_prov is not None
    for key, value in prov.items():
        assert hist_prov[key] == value


@pytest.mark.asyncio
async def test_get_suggestion_history_resolves_ran_by_name(
    db_session: AsyncSession,
) -> None:
    """The history path resolves ran_by_user_id → ran_by_name from the runner's
    profile; the hot load path leaves the raw snapshot untouched."""
    import json

    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, field_id, reviewer_a, reviewer_b = built

    # Pin the runner's profile name deterministically (the shared dev DB may
    # carry a pre-existing reviewer_b row whose full_name the builder's
    # ON CONFLICT DO UPDATE leaves untouched).
    await db_session.execute(
        text("UPDATE public.profiles SET full_name = :n WHERE id = :id"),
        {"n": "Integration Reviewer B (Suggest)", "id": str(reviewer_b)},
    )
    prov = {
        "model": "gpt-4o-mini",
        "ran_by_user_id": str(reviewer_b),
    }
    await db_session.execute(
        text(
            "UPDATE extraction_runs "
            "SET results = jsonb_set(coalesce(results, '{}'::jsonb), "
            "'{provenance}', cast(:p as jsonb)) WHERE id = :id"
        ),
        {"p": json.dumps(prov), "id": str(run_id)},
    )
    await db_session.flush()

    history = await get_suggestion_history(
        db_session, instance_id, field_id, article_id=SEED.primary_article
    )
    assert history[0].provenance is not None
    assert history[0].provenance["ran_by_name"] == "Integration Reviewer B (Suggest)"

    # Hot load path must NOT inject the name (stays a single query).
    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_a,
        run_id=run_id,
    )
    assert result.suggestions[0].provenance is not None
    assert "ran_by_name" not in result.suggestions[0].provenance


@pytest.mark.asyncio
async def test_load_suggestions_reviewer_a_status_is_accepted(
    db_session: AsyncSession,
) -> None:
    """reviewer_a's EDIT decision → status 'accepted' for caller=reviewer_a."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, _field_id, reviewer_a, _reviewer_b = built

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_a,
        run_id=run_id,
    )

    assert result.count >= 1
    assert result.suggestions[0].status == "accepted"


@pytest.mark.asyncio
async def test_load_suggestions_reviewer_b_status_is_rejected(
    db_session: AsyncSession,
) -> None:
    """reviewer_b's REJECT decision → status 'rejected' for caller=reviewer_b."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, _field_id, _reviewer_a, reviewer_b = built

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_b,
        run_id=run_id,
    )

    assert result.count >= 1
    assert result.suggestions[0].status == "rejected"


@pytest.mark.asyncio
async def test_load_suggestions_caller_scope_blind_boundary(
    db_session: AsyncSession,
) -> None:
    """Blind boundary: reviewer_a's status never reflects reviewer_b's decisions.

    reviewer_a has EDIT (accepted), reviewer_b has REJECT.
    When caller=reviewer_a, status must be 'accepted' — NOT 'rejected' (B's).
    When caller=reviewer_b, status must be 'rejected' — NOT 'accepted' (A's).
    Neither caller should see the other's decision bled in.
    """
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, _field_id, reviewer_a, reviewer_b = built

    result_a = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_a,
        run_id=run_id,
    )
    result_b = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=reviewer_b,
        run_id=run_id,
    )

    assert result_a.suggestions[0].status == "accepted", (
        f"Reviewer A's status should be 'accepted' (EDIT decision) "
        f"but got '{result_a.suggestions[0].status}' — "
        "did reviewer B's REJECT bleed through?"
    )
    assert result_b.suggestions[0].status == "rejected", (
        f"Reviewer B's status should be 'rejected' "
        f"but got '{result_b.suggestions[0].status}' — "
        "did reviewer A's EDIT bleed through?"
    )


@pytest.mark.asyncio
async def test_load_suggestions_pending_when_no_decision(
    db_session: AsyncSession,
) -> None:
    """A caller with no reviewer_state for a coord gets status 'pending'."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, _field_id, _reviewer_a, _reviewer_b = built

    # Use the manager (primary_profile) as caller — they never recorded a decision
    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=SEED.primary_profile,
        run_id=run_id,
    )

    assert result.count >= 1
    assert result.suggestions[0].status == "pending"


@pytest.mark.asyncio
async def test_load_suggestions_dedup_latest_per_coord(
    db_session: AsyncSession,
) -> None:
    """Only the LATEST AI proposal per (instance, field) is returned."""
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    # Insert two AI proposals for the same coord — only latest wins.
    # Both proposals land in the same DB transaction so they share the same
    # created_at (PostgreSQL now() is constant within a transaction).  To make
    # the ordering deterministic we back-date the OLDER row by 1 second via a
    # raw UPDATE after the flush, before calling load_suggestions.
    older = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "OLDER"},
    )
    await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "NEWER"},
    )
    await db_session.flush()
    # Back-date the OLDER row so created_at ordering is unambiguous.
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' "
            "WHERE id = :id"
        ),
        {"id": str(older.id)},
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=manager_id,
        run_id=run.id,
    )

    assert result.count == 1
    assert result.suggestions[0].proposed_value == {"value": "NEWER"}


@pytest.mark.asyncio
async def test_load_suggestions_latest_no_info_keeps_earlier_real_value(
    db_session: AsyncSession,
) -> None:
    """A later 'no information' run must not bury an earlier run's real value.

    Since #443 an AI run that abstains records a real proposal with
    proposed_value={"value": None}. The inline strip dedups to latest-per-coord;
    without the no-info guard, re-running extraction (which often abstains on a
    field the first run found) would surface the null proposal and blank the
    suggestion. The dedup must fall back to the most recent proposal that
    actually carries a value — the abstention stays in get_suggestion_history.
    Regression test for the "suggestion disappears after a 2nd AI extraction" bug.
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    # Older run found a value; the latest run abstained (no information).
    older = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "REAL-VALUE"},
    )
    await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": None},  # no information
    )
    await db_session.flush()
    # Back-date the OLDER (real-value) row so created_at ordering is unambiguous.
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' "
            "WHERE id = :id"
        ),
        {"id": str(older.id)},
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=manager_id,
        run_id=run.id,
    )

    assert result.count == 1
    assert result.suggestions[0].proposed_value == {"value": "REAL-VALUE"}, (
        "A later no-information proposal buried the earlier real value in the "
        "inline strip — the dedup should prefer the latest proposal WITH a value."
    )


@pytest.mark.asyncio
async def test_load_suggestions_newer_marker_wins_over_older_value(
    db_session: AsyncSession,
) -> None:
    """ADR-0016: a coded ``no_information`` marker is a GENUINE answer, so unlike
    a bare-null abstention it MAY win by recency over an older real value. The
    dedup delegates emptiness to ``is_value_empty``, which treats a marker as
    filled — so the newest non-empty proposal (here the marker) wins. Contrast
    with the bare-null case above, where the older real value is preserved."""
    marker = {"value": None, "absent_reason": "no_information"}
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    older = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "REAL-VALUE"},
    )
    await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value=marker,  # the AI re-ran and now says "no information"
    )
    await db_session.flush()
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' WHERE id = :id"
        ),
        {"id": str(older.id)},
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=manager_id,
        run_id=run.id,
    )
    assert result.count == 1
    assert result.suggestions[0].proposed_value == marker, (
        "A newer coded marker is a genuine answer and should win by recency — "
        "only a bare {'value': null} is buryable."
    )


@pytest.mark.asyncio
async def test_load_suggestions_newer_bare_null_does_not_bury_marker(
    db_session: AsyncSession,
) -> None:
    """The mirror of the above: an earlier resolved ``no_information`` marker is
    a genuine value, so a later *bare-null* abstention (no marker) must NOT bury
    it — the marker is preferred exactly like a real value would be."""
    marker = {"value": None, "absent_reason": "no_information"}
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    older = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value=marker,
    )
    await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": None},  # bare-null abstention, no marker
    )
    await db_session.flush()
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' WHERE id = :id"
        ),
        {"id": str(older.id)},
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=manager_id,
        run_id=run.id,
    )
    assert result.count == 1
    assert result.suggestions[0].proposed_value == marker, (
        "A later bare-null abstention buried an earlier resolved marker — the "
        "marker is a genuine value and must be preferred."
    )


@pytest.mark.asyncio
async def test_load_suggestions_all_no_info_returns_no_info(
    db_session: AsyncSession,
) -> None:
    """When every run abstained, the coord still surfaces a (no-info) proposal.

    The latest-with-value preference only kicks in when a real value exists;
    if all proposals are no-info, the coord still appears (so the quiet
    "no information" indicator and its provenance remain reachable).
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    for _ in range(2):
        await proposal_svc.record_proposal(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"value": None},
        )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=SEED.primary_article,
        caller_id=manager_id,
        run_id=run.id,
    )

    assert result.count == 1
    assert result.suggestions[0].proposed_value == {"value": None}


@pytest.mark.asyncio
async def test_load_suggestions_empty_instance_ids(
    db_session: AsyncSession,
) -> None:
    """Empty instance_ids returns empty result."""
    result = await load_suggestions(
        db_session,
        [],
        article_id=SEED.primary_article,
        caller_id=SEED.primary_profile,
    )
    assert result.count == 0
    assert result.suggestions == []


@pytest.mark.asyncio
async def test_get_suggestion_history_no_status(
    db_session: AsyncSession,
) -> None:
    """get_suggestion_history returns AI proposals newest-first, no status field."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, field_id, _reviewer_a, _reviewer_b = built  # noqa: F841

    history = await get_suggestion_history(
        db_session, instance_id, field_id, article_id=SEED.primary_article
    )

    assert len(history) >= 1
    item = history[0]
    assert item.instance_id == instance_id
    assert item.field_id == field_id
    assert item.proposed_value == {"value": "AI-PROPOSED"}
    # AISuggestionHistoryItem has no `status` attribute
    assert not hasattr(item, "status")


@pytest.mark.asyncio
async def test_get_suggestion_history_limit(
    db_session: AsyncSession,
) -> None:
    """get_suggestion_history respects the limit parameter."""
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )
    proposal_svc = ExtractionProposalService(db_session)
    for i in range(3):
        await proposal_svc.record_proposal(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"value": f"v{i}"},
        )
    await db_session.flush()

    history = await get_suggestion_history(
        db_session, instance_id, field_id, article_id=SEED.primary_article, limit=2
    )
    assert len(history) <= 2


@pytest.mark.asyncio
async def test_get_article_instance_ids(
    db_session: AsyncSession,
) -> None:
    """get_article_instance_ids returns instance ids for the article."""
    ids = await get_article_instance_ids(db_session, SEED.primary_article)
    assert SEED.primary_instance in ids


# ---------------------------------------------------------------------------
# ENDPOINT TESTS
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_instance_ids_endpoint_200(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """GET /articles/{article_id}/instance-ids returns 200 with instance ids."""
    resp = await db_client.get(f"{_ARTICLES_URL}/{SEED.primary_article}/instance-ids")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    ids = payload["data"]
    assert isinstance(ids, list)
    assert str(SEED.primary_instance) in ids


@pytest.mark.asyncio
async def test_instance_ids_endpoint_403_bola(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    """BOLA gate: non-member gets 403 on instance-ids."""
    resp = await db_client.get(f"{_ARTICLES_URL}/{SEED.primary_article}/instance-ids")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_suggestions_endpoint_200(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """GET /articles/{article_id}/suggestions?instance_ids= returns 200."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, _field_id, _reviewer_a, _reviewer_b = built

    resp = await db_client.get(
        f"{_ARTICLES_URL}/{SEED.primary_article}/suggestions",
        params={
            "instance_ids": str(instance_id),
            "run_id": str(run_id),
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert "suggestions" in data
    assert "count" in data
    assert data["count"] >= 1


@pytest.mark.asyncio
async def test_suggestions_endpoint_403_bola(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    """BOLA gate: non-member gets 403 on suggestions."""
    resp = await db_client.get(
        f"{_ARTICLES_URL}/{SEED.primary_article}/suggestions",
        params={"instance_ids": str(SEED.primary_instance)},
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_suggestions_history_endpoint_200(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """GET /articles/{article_id}/suggestions/history returns 200."""
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    _run_id, instance_id, field_id, _reviewer_a, _reviewer_b = built

    resp = await db_client.get(
        f"{_ARTICLES_URL}/{SEED.primary_article}/suggestions/history",
        params={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert isinstance(data, list)
    assert len(data) >= 1
    item = data[0]
    assert "proposed_value" in item
    assert "status" not in item


@pytest.mark.asyncio
async def test_suggestions_history_endpoint_403_bola(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    """BOLA gate: non-member gets 403 on suggestions/history."""
    resp = await db_client.get(
        f"{_ARTICLES_URL}/{SEED.primary_article}/suggestions/history",
        params={
            "instance_id": str(SEED.primary_instance),
            "field_id": str(SEED.primary_field),
        },
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# IDOR REGRESSION TESTS
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_suggestions_excludes_foreign_article_instance(
    db_session: AsyncSession,
) -> None:
    """IDOR guard: load_suggestions with a foreign article_id returns nothing.

    The instance_id belongs to SEED.primary_article.  Passing a different
    (non-existent) article_id must yield count=0 / suggestions=[] — the JOIN
    on ExtractionInstance.article_id excludes it at the DB level.
    Regression test for the cross-project IDOR fixed in extraction_suggestion_read_service.py.
    """
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, _field_id, reviewer_a, _reviewer_b = built

    foreign_article_id = uuid4()  # does not exist — primary_article's instance excluded

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=foreign_article_id,
        caller_id=reviewer_a,
        run_id=run_id,
    )

    assert result.count == 0, (
        "IDOR guard failed: load_suggestions returned suggestions for an instance "
        "that belongs to a different article than the one passed as article_id. "
        f"Got count={result.count}, expected 0."
    )
    assert result.suggestions == [], (
        "IDOR guard failed: suggestions list should be empty when article_id "
        "does not match the instance's article."
    )


@pytest.mark.asyncio
async def test_get_suggestion_history_excludes_foreign_article_instance(
    db_session: AsyncSession,
) -> None:
    """IDOR guard: get_suggestion_history with a foreign article_id returns [].

    The instance_id belongs to SEED.primary_article.  Passing a different
    article_id must yield an empty list — the JOIN on ExtractionInstance.article_id
    excludes it at the DB level.
    Regression test for the cross-project IDOR fixed in extraction_suggestion_read_service.py.
    """
    built = await _build_suggestion_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    _run_id, instance_id, field_id, _reviewer_a, _reviewer_b = built

    foreign_article_id = uuid4()  # does not exist — primary_article's instance excluded

    history = await get_suggestion_history(
        db_session,
        instance_id,
        field_id,
        article_id=foreign_article_id,
    )

    assert history == [], (
        "IDOR guard failed: get_suggestion_history returned history for an instance "
        "that belongs to a different article than the one passed as article_id. "
        f"Got {len(history)} items, expected 0."
    )


# ---------------------------------------------------------------------------
# BLOCK IDS TESTS (Task 7)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_suggestions_evidence_block_ids_populated(
    db_session: AsyncSession,
) -> None:
    """evidence.block_ids is populated from position.anchor.blockIds (load_suggestions).

    Creates a run + proposal + evidence row with a PositionV1 hybrid anchor
    that carries blockIds=[2].  Asserts that load_suggestions returns
    evidence.block_ids == [2] (and the alias blockIds round-trips via model_dump).
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    proposal = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "BLOCK-ID-TEST"},
    )
    await db_session.flush()

    # Insert an evidence row with a PositionV1 hybrid anchor carrying blockIds=[2].
    # charStart/charEnd are the PDFTextRange aliases; x/y/width/height are PDFRect fields.
    position_payload = {
        "version": 1,
        "anchor": {
            "kind": "hybrid",
            "range": {"page": 1, "charStart": 0, "charEnd": 10},
            "rect": {"x": 0.0, "y": 0.0, "width": 100.0, "height": 20.0},
            "quote": "test quote",
            "blockIds": [2],
        },
    }
    db_session.add(
        ExtractionEvidence(
            id=uuid4(),
            project_id=project_id,
            article_id=article_id,
            run_id=run.id,
            proposal_record_id=proposal.id,
            page_number=1,
            text_content="test quote",
            created_by=manager_id,
            position=position_payload,
        )
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=article_id,
        caller_id=manager_id,
        run_id=run.id,
    )

    assert result.count >= 1
    suggestion = next(
        s for s in result.suggestions if s.proposed_value == {"value": "BLOCK-ID-TEST"}
    )
    assert isinstance(suggestion.evidence, list) and len(suggestion.evidence) >= 1
    assert suggestion.evidence[0].block_ids == [2], (
        f"Expected evidence[0].block_ids == [2], got {suggestion.evidence[0].block_ids}"
    )
    # Alias round-trip: model_dump(by_alias=True) must emit blockIds
    dumped = suggestion.evidence[0].model_dump(by_alias=True)
    assert dumped["blockIds"] == [2], f"blockIds alias missing from serialized evidence: {dumped}"


@pytest.mark.asyncio
async def test_get_suggestion_history_evidence_block_ids_populated(
    db_session: AsyncSession,
) -> None:
    """evidence.block_ids is populated from position.anchor.blockIds (get_suggestion_history).

    Same setup as the load_suggestions variant — confirms BOTH call sites
    in the read service surface block_ids correctly.
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    proposal = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "BLOCK-ID-HISTORY-TEST"},
    )
    await db_session.flush()

    position_payload = {
        "version": 1,
        "anchor": {
            "kind": "hybrid",
            "range": {"page": 3, "charStart": 5, "charEnd": 20},
            "rect": {"x": 10.0, "y": 10.0, "width": 80.0, "height": 15.0},
            "quote": "history quote",
            "blockIds": [2],
        },
    }
    db_session.add(
        ExtractionEvidence(
            id=uuid4(),
            project_id=project_id,
            article_id=article_id,
            run_id=run.id,
            proposal_record_id=proposal.id,
            page_number=3,
            text_content="history quote",
            created_by=manager_id,
            position=position_payload,
        )
    )
    await db_session.flush()

    history = await get_suggestion_history(db_session, instance_id, field_id, article_id=article_id)

    matched = next(
        (h for h in history if h.proposed_value == {"value": "BLOCK-ID-HISTORY-TEST"}),
        None,
    )
    assert matched is not None, "Expected proposal not found in history"
    assert isinstance(matched.evidence, list) and len(matched.evidence) >= 1
    assert matched.evidence[0].block_ids == [2], (
        f"Expected evidence[0].block_ids == [2], got {matched.evidence[0].block_ids}"
    )
    dumped = matched.evidence[0].model_dump(by_alias=True)
    assert dumped["blockIds"] == [2], f"blockIds alias missing from serialized evidence: {dumped}"


@pytest.mark.asyncio
async def test_load_suggestions_evidence_block_ids_empty_when_no_position(
    db_session: AsyncSession,
) -> None:
    """evidence.block_ids defaults to [] when position is None or missing anchor."""
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    proposal = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "NO-POSITION-TEST"},
    )
    await db_session.flush()

    # Evidence row with position=None (legacy row)
    db_session.add(
        ExtractionEvidence(
            id=uuid4(),
            project_id=project_id,
            article_id=article_id,
            run_id=run.id,
            proposal_record_id=proposal.id,
            page_number=1,
            text_content="no position",
            created_by=manager_id,
            position=None,
        )
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=article_id,
        caller_id=manager_id,
        run_id=run.id,
    )

    assert result.count >= 1
    suggestion = next(
        s for s in result.suggestions if s.proposed_value == {"value": "NO-POSITION-TEST"}
    )
    assert isinstance(suggestion.evidence, list) and len(suggestion.evidence) >= 1
    assert suggestion.evidence[0].block_ids == [], (
        f"Expected evidence[0].block_ids == [] for no-position evidence, got {suggestion.evidence[0].block_ids}"
    )


# ---------------------------------------------------------------------------
# ORDERED EVIDENCE LIST TESTS (Task 5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_suggestions_evidence_ordered_list(
    db_session: AsyncSession,
) -> None:
    """load_suggestions returns evidence as an ordered list (rank asc) with rank + attribution_label.

    Seed a proposal with two evidence rows:
      - rank=1, attribution_label='entailed', text='rank-1'
      - rank=0, attribution_label=None, text='rank-0'
    Assert evidence is a length-2 list, ordered rank-0 then rank-1, with
    attribution_label preserved.
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    proposal = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "ORDERED-EVIDENCE-TEST"},
    )
    await db_session.flush()

    # rank=1 row inserted first, rank=0 second — service must order by rank asc
    db_session.add(
        ExtractionEvidence(
            id=uuid4(),
            project_id=project_id,
            article_id=article_id,
            run_id=run.id,
            proposal_record_id=proposal.id,
            page_number=2,
            text_content="rank-1",
            created_by=manager_id,
            position=None,
            rank=1,
            attribution_label="entailed",
        )
    )
    db_session.add(
        ExtractionEvidence(
            id=uuid4(),
            project_id=project_id,
            article_id=article_id,
            run_id=run.id,
            proposal_record_id=proposal.id,
            page_number=1,
            text_content="rank-0",
            created_by=manager_id,
            position=None,
            rank=0,
            attribution_label=None,
        )
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=article_id,
        caller_id=manager_id,
        run_id=run.id,
    )

    suggestion = next(
        (s for s in result.suggestions if s.proposed_value == {"value": "ORDERED-EVIDENCE-TEST"}),
        None,
    )
    assert suggestion is not None, "Expected proposal not found"

    # evidence must be a list now (not EvidenceResponse | None)
    assert isinstance(suggestion.evidence, list), (
        f"evidence should be a list, got {type(suggestion.evidence)}"
    )
    assert len(suggestion.evidence) == 2, (
        f"Expected 2 evidence items, got {len(suggestion.evidence)}"
    )

    # ordered by rank ascending: rank-0 first, rank-1 second
    assert suggestion.evidence[0].rank == 0, (
        f"First evidence item should have rank=0, got {suggestion.evidence[0].rank}"
    )
    assert suggestion.evidence[0].text_content == "rank-0"
    assert suggestion.evidence[0].attribution_label is None

    assert suggestion.evidence[1].rank == 1, (
        f"Second evidence item should have rank=1, got {suggestion.evidence[1].rank}"
    )
    assert suggestion.evidence[1].text_content == "rank-1"
    assert suggestion.evidence[1].attribution_label == "entailed"


@pytest.mark.asyncio
async def test_load_suggestions_evidence_legacy_length_one(
    db_session: AsyncSession,
) -> None:
    """Backward-compat: a proposal with a single evidence row returns a length-1 list.

    rank=0, attribution_label=None (legacy defaults).
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    instance_id = SEED.primary_instance
    field_id = SEED.primary_field
    manager_id = SEED.primary_profile

    lifecycle = RunLifecycleService(db_session)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=manager_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=manager_id
    )

    proposal_svc = ExtractionProposalService(db_session)
    proposal = await proposal_svc.record_proposal(
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "LEGACY-SINGLE-EVIDENCE"},
    )
    await db_session.flush()

    db_session.add(
        ExtractionEvidence(
            id=uuid4(),
            project_id=project_id,
            article_id=article_id,
            run_id=run.id,
            proposal_record_id=proposal.id,
            page_number=1,
            text_content="legacy single evidence",
            created_by=manager_id,
            position=None,
            rank=0,
            attribution_label=None,
        )
    )
    await db_session.flush()

    result = await load_suggestions(
        db_session,
        [instance_id],
        article_id=article_id,
        caller_id=manager_id,
        run_id=run.id,
    )

    suggestion = next(
        (s for s in result.suggestions if s.proposed_value == {"value": "LEGACY-SINGLE-EVIDENCE"}),
        None,
    )
    assert suggestion is not None, "Expected proposal not found"

    # backward-compat: single evidence row → length-1 list
    assert isinstance(suggestion.evidence, list), (
        f"evidence should be a list, got {type(suggestion.evidence)}"
    )
    assert len(suggestion.evidence) == 1, (
        f"Expected 1 evidence item, got {len(suggestion.evidence)}"
    )
    assert suggestion.evidence[0].rank == 0
    assert suggestion.evidence[0].attribution_label is None
