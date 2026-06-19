"""Integration tests for the embedded RunViewResponse in POST /api/v1/hitl/sessions.

Pins that the extraction session-open response embeds a populated ``run_view``
(the same data the client would previously fetch with a follow-up
GET /api/v1/runs/{id}/view), allowing the run-open form to render in one
round-trip.

Test 2 (reviewer-scoped embed / blind isolation for a review-stage run) is
omitted here. The endpoint's ``is_arbitrator`` wiring (computed via
``is_run_arbitrator(db, body.project_id, current_user_sub)``) relies on
``test_build_run_view_blinds_peer_in_review`` (Task 5) for blind coverage.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED

_SESSION_URL = "/api/v1/hitl/sessions"


# =================== FIXTURES ===================


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override ``get_current_user`` so its JWT subject is ``SEED.primary_profile``.

    Identical to the pattern used in ``test_run_view_endpoint.py`` and
    ``test_hitl_session.py``.
    """
    del db_session  # kept for fixture-dependency ordering (seed runs first)
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# =================== TESTS ===================


@pytest.mark.asyncio
async def test_extraction_session_open_embeds_run_view(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001 — fixture order: seed runs first
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Core embed: POST /api/v1/hitl/sessions (extraction) returns run_view != null.

    Asserts:
    - ``data["run_view"]`` is not None (embed is present).
    - ``run_view["run"]["id"]`` matches ``data["run_id"]`` (same run).
    - ``run_view`` has ``entity_types`` and ``current_values`` keys
      (the RunViewResponse contract beyond RunDetailResponse).
    - Stage is 'proposal' (session open advances pending → proposal).
    - ``current_values`` is empty (proposal stage → no value resolution yet).
    """
    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(SEED.primary_project),
            "article_id": str(SEED.primary_article),
            "project_template_id": str(SEED.primary_template),
        },
    )
    assert res.status_code in (200, 201), res.text

    payload = res.json()
    assert payload["ok"] is True
    data = payload["data"]

    run_id = data["run_id"]
    view = data["run_view"]

    assert view is not None, "run_view must be embedded for extraction kind"
    assert view["run"]["id"] == run_id, "Embedded run id must match run_id in response"
    assert "entity_types" in view, "run_view must contain entity_types"
    assert "current_values" in view, "run_view must contain current_values"
    assert view["run"]["stage"] == "proposal", "Session open must advance the run to proposal stage"
    assert view["current_values"] == [], (
        "current_values must be empty for a freshly-opened proposal-stage run"
    )
    # RunDetailResponse keys inherited by RunViewResponse
    assert "proposals" in view
    assert "decisions" in view
    assert "consensus_decisions" in view
    assert "published_states" in view


@pytest.mark.asyncio
async def test_qa_session_open_embeds_run_view(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Quality-assessment sessions ALSO embed a (server-blinded) ``run_view``.

    QA is in scope for blind-review: the manager-blind rule keys on ``run.kind``,
    so the session-open response embeds the same ``RunViewResponse`` as
    extraction (the QA page consumes it via the run-detail cache) rather than
    null. Previously QA was skipped — that was the pre-blind-review behavior.
    """
    raw = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind='quality_assessment' AND name='PROBAST' LIMIT 1"
            )
        )
    ).scalar()
    if raw is None:
        pytest.skip("No global QA template (PROBAST) seeded — run `python -m backend.app.seed`")
    global_tpl_id = UUID(str(raw))

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(SEED.primary_project),
            "article_id": str(SEED.primary_article),
            "global_template_id": str(global_tpl_id),
        },
    )
    assert res.status_code in (200, 201), res.text

    payload = res.json()
    assert payload["ok"] is True
    data = payload["data"]

    assert data["kind"] == "quality_assessment"
    view = data["run_view"]
    assert view is not None, "run_view must be embedded for QA sessions too (QA is in scope)"
    assert view["run"]["id"] == data["run_id"], "Embedded run id must match run_id"
    assert "entity_types" in view and "current_values" in view
