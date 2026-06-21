"""API contract tests for /api/v1/runs endpoints (extraction-centric HITL).

Covers happy paths, body validation (422), and service-error mapping
(400/404/422), plus a single end-to-end lifecycle test that walks
create -> proposal -> review -> consensus -> finalized and asserts
that GET /runs/{id} returns the expected aggregate state including
``published_states`` with version=1.

Auth: the conftest ``db_client`` fixture already overrides
``get_current_user`` with ``TokenPayload(sub='test-user-id', ...)``.
``get_current_user_sub`` will derive a stable UUIDv5 from that string
for legacy compatibility, but FK to ``profiles`` would fail. We re-
override ``get_current_user`` here to use a real profile UUID picked
from the test database.
"""

from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED

API_PREFIX = "/api/v1/runs"


# =================== HELPERS ===================


async def _resolve_fixtures(
    db: AsyncSession,  # noqa: ARG001
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Return the seeded sentinel (project, article, template, profile, instance, field).

    Pinning to the seed sentinels (vs ``LIMIT 1``) keeps the BOLA-ownership
    chain coherent — previous revisions of this helper picked any
    project/article/template row at random, which could resolve to a stale,
    half-orphaned trio committed by a previous test session and silently
    skip the whole file with ``Missing fixtures``. The return type stays
    ``... | None`` so every caller's ``if fx is None`` guard remains a
    valid no-op without churn; with the seed always present, it never fires.
    """
    return (
        SEED.primary_project,
        SEED.primary_article,
        SEED.primary_template,
        SEED.primary_profile,
        SEED.primary_instance,
        SEED.primary_field,
    )


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override ``get_current_user`` so its JWT subject is a real profile UUID.

    Must be requested AFTER ``db_client`` (or alongside, since FastAPI just
    checks the override map at request time). Yielding the UUID lets each test
    assert against the same id used by the API. Pinned to the seed sentinel
    so the chosen profile is guaranteed to be a manager of both seed projects
    (see conftest topology).
    """
    del db_session  # kept for fixture-dependency ordering against ``db_client``
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id
    # The outer ``db_client`` fixture clears overrides at teardown.


async def _create_run_via_api(
    client: AsyncClient,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    parameters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "project_id": str(project_id),
        "article_id": str(article_id),
        "project_template_id": str(template_id),
    }
    if parameters is not None:
        body["parameters"] = parameters
    response = await client.post(API_PREFIX, json=body)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["ok"] is True
    return payload["data"]


async def _advance(client: AsyncClient, run_id: UUID, target_stage: str) -> None:
    response = await client.post(
        f"{API_PREFIX}/{run_id}/advance",
        json={"target_stage": target_stage},
    )
    assert response.status_code == 200, response.text


# =================== POST /runs ===================


@pytest.mark.asyncio
async def test_create_run_returns_201_and_summary(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, _, _ = fx

    response = await db_client.post(
        API_PREFIX,
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert UUID(data["id"])
    assert data["stage"] == "pending"
    assert data["status"] == "pending"
    assert data["kind"] == "extraction"
    assert data["template_id"] == str(template_id)
    assert data["project_id"] == str(project_id)
    assert data["article_id"] == str(article_id)
    assert data["created_by"] == str(auth_as_profile)
    assert "hitl_config_snapshot" in data


@pytest.mark.asyncio
async def test_create_run_with_parameters(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, _, _ = fx

    response = await db_client.post(
        API_PREFIX,
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
            "parameters": {"reason": "contract test"},
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["data"]["parameters"] == {"reason": "contract test"}


@pytest.mark.asyncio
async def test_create_run_missing_required_field_returns_422(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    response = await db_client.post(
        API_PREFIX,
        json={
            "project_id": str(uuid4()),
            # article_id and project_template_id missing
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_run_invalid_uuid_returns_422(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    response = await db_client.post(
        API_PREFIX,
        json={
            "project_id": "not-a-uuid",
            "article_id": str(uuid4()),
            "project_template_id": str(uuid4()),
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_run_with_nonexistent_template_returns_404(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, _, _, _, _ = fx

    response = await db_client.post(
        API_PREFIX,
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(uuid4()),
        },
    )
    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert "not found" in body["error"]["message"].lower()


# =================== GET /runs/{id} ===================


@pytest.mark.asyncio
async def test_get_run_returns_200_with_aggregate_shape(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, _, _ = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])

    response = await db_client.get(f"{API_PREFIX}/{run_id}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["run"]["id"] == str(run_id)
    assert data["proposals"] == []
    assert data["decisions"] == []
    assert data["consensus_decisions"] == []
    assert data["published_states"] == []


@pytest.mark.asyncio
async def test_get_nonexistent_run_returns_404(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    response = await db_client.get(f"{API_PREFIX}/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_run_with_invalid_uuid_returns_422(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    response = await db_client.get(f"{API_PREFIX}/not-a-uuid")
    assert response.status_code == 422


# =================== POST /runs/{id}/advance ===================


@pytest.mark.asyncio
async def test_advance_pending_to_extract_returns_200(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, _, _ = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/advance",
        json={"target_stage": "extract"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["stage"] == "extract"


@pytest.mark.asyncio
async def test_advance_pending_to_consensus_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, _, _ = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])

    # Skipping the editable extract stage is rejected (pending → consensus).
    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/advance",
        json={"target_stage": "consensus"},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert "Cannot transition" in body["error"]["message"]


@pytest.mark.asyncio
async def test_advance_invalid_target_stage_returns_422(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, _, _ = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/advance",
        json={"target_stage": "bogus_stage"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_advance_for_nonexistent_run_returns_404(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    response = await db_client.post(
        f"{API_PREFIX}/{uuid4()}/advance",
        json={"target_stage": "extract"},
    )
    assert response.status_code == 404


# =================== POST /runs/{id}/proposals ===================


@pytest.mark.asyncio
async def test_create_proposal_returns_201(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])
    await _advance(db_client, run_id, "extract")

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "ai",
            "proposed_value": {"text": "candidate"},
            "confidence_score": 0.91,
            "rationale": "model rationale",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert UUID(data["id"])
    assert data["run_id"] == str(run_id)
    assert data["source"] == "ai"
    assert data["confidence_score"] == 0.91


@pytest.mark.asyncio
async def test_create_proposal_invalid_source_returns_422(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])
    await _advance(db_client, run_id, "extract")

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "robot",  # not in enum
            "proposed_value": {"v": "x"},
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_proposal_outside_proposal_stage_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Run in PENDING stage -> proposal write must fail with 400."""
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "ai",
            "proposed_value": {"v": "x"},
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert "stage" in body["error"]["message"].lower()


@pytest.mark.asyncio
async def test_create_proposal_with_incoherent_coords_returns_422(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, _ = fx

    other_field_row = await db_session.execute(
        text(
            """
            SELECT f.id FROM public.extraction_fields f
            WHERE f.entity_type_id <> (
                SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
            )
            LIMIT 1
            """
        ),
        {"iid": instance_id},
    )
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])
    await _advance(db_client, run_id, "extract")

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(other_field_id),
            "source": "ai",
            "proposed_value": {"v": "x"},
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_human_proposal_rejected_for_extraction(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Human writes on an extraction run are rejected at /proposals (400):
    they must go through /decisions so each reviewer's value lands as a
    per-user ReviewerDecision (blind-review write defense). The old
    auto-fill-the-caller behaviour no longer applies — human extraction
    proposals are forbidden outright."""
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])
    await _advance(db_client, run_id, "extract")

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "human",
            "proposed_value": {"v": "x"},
        },
    )
    assert response.status_code == 400, response.text
    assert "/decisions" in response.json()["error"]["message"]


# =================== POST /runs/{id}/decisions ===================


async def _setup_review_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID]:
    """Create a run, advance to extract, record one AI proposal. Returns
    (run_id, instance_id, field_id, proposal_id)."""
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])
    await _advance(db_client, run_id, "extract")
    proposal_resp = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "ai",
            "proposed_value": {"v": "candidate"},
        },
    )
    assert proposal_resp.status_code == 201, proposal_resp.text
    proposal_id = UUID(proposal_resp.json()["data"]["id"])
    return run_id, instance_id, field_id, proposal_id


@pytest.mark.asyncio
async def test_create_decision_accept_returns_201(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,
) -> None:
    run_id, instance_id, field_id, proposal_id = await _setup_review_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "accept_proposal",
            "proposal_record_id": str(proposal_id),
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["decision"] == "accept_proposal"
    assert data["proposal_record_id"] == str(proposal_id)
    assert data["reviewer_id"] == str(auth_as_profile)


@pytest.mark.asyncio
async def test_create_decision_invalid_enum_returns_422(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, _ = await _setup_review_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "approve",  # not in enum
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_decision_accept_without_proposal_id_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, _ = await _setup_review_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "accept_proposal",
            # proposal_record_id missing
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert "proposal_record_id" in body["error"]["message"]


@pytest.mark.asyncio
async def test_create_decision_edit_without_value_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, _ = await _setup_review_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "edit",
            # value missing
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_create_decision_outside_review_stage_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "edit",
            "value": {"v": "x"},
        },
    )
    assert response.status_code == 400


# =================== POST /runs/{id}/consensus ===================


async def _setup_consensus_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID]:
    """Create a run, advance through proposal/review/consensus, and return
    (run_id, instance_id, field_id, decision_id)."""
    run_id, instance_id, field_id, proposal_id = await _setup_review_run(db_client, db_session)
    decision_resp = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "accept_proposal",
            "proposal_record_id": str(proposal_id),
        },
    )
    assert decision_resp.status_code == 201, decision_resp.text
    decision_id = UUID(decision_resp.json()["data"]["id"])
    await _advance(db_client, run_id, "consensus")
    return run_id, instance_id, field_id, decision_id


@pytest.mark.asyncio
async def test_create_consensus_select_existing_returns_201(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, decision_id = await _setup_consensus_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "select_existing",
            "selected_decision_id": str(decision_id),
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["consensus"]["mode"] == "select_existing"
    assert data["published"]["version"] == 1
    assert data["published"]["run_id"] == str(run_id)


@pytest.mark.asyncio
async def test_create_consensus_invalid_mode_returns_422(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, _ = await _setup_consensus_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "majority_vote",  # not in enum
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_consensus_select_existing_without_decision_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, _ = await _setup_consensus_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "select_existing",
            # selected_decision_id missing
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_create_consensus_manual_override_without_value_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, field_id, _ = await _setup_consensus_run(db_client, db_session)

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "manual_override",
            # value + rationale missing
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_create_consensus_with_incoherent_coords_returns_422(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    run_id, instance_id, _, _ = await _setup_consensus_run(db_client, db_session)

    other_field_row = await db_session.execute(
        text(
            """
            SELECT f.id FROM public.extraction_fields f
            WHERE f.entity_type_id <> (
                SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
            )
            LIMIT 1
            """
        ),
        {"iid": instance_id},
    )
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(other_field_id),
            "mode": "manual_override",
            "value": {"v": "x"},
            "rationale": "test",
        },
    )
    assert response.status_code == 422


# =================== End-to-end lifecycle ===================


@pytest.mark.asyncio
async def test_full_lifecycle_create_to_finalized(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Walk the full HITL flow:

    create -> proposal -> POST proposal -> review -> POST decision ->
    consensus -> POST consensus -> finalized -> GET run returns published_states v1.
    """
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, _, instance_id, field_id = fx

    created = await _create_run_via_api(
        db_client,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    run_id = UUID(created["id"])
    assert created["stage"] == "pending"

    # pending -> extract
    await _advance(db_client, run_id, "extract")

    # POST proposal
    proposal_resp = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "ai",
            "proposed_value": {"v": "candidate"},
            "confidence_score": 0.85,
        },
    )
    assert proposal_resp.status_code == 201, proposal_resp.text

    # POST decision (accept proposal) — recorded in extract; no review stage
    proposal_id = UUID(proposal_resp.json()["data"]["id"])
    decision_resp = await db_client.post(
        f"{API_PREFIX}/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "accept_proposal",
            "proposal_record_id": str(proposal_id),
        },
    )
    assert decision_resp.status_code == 201, decision_resp.text
    decision_id = UUID(decision_resp.json()["data"]["id"])

    # extract -> consensus
    await _advance(db_client, run_id, "consensus")

    # POST consensus
    consensus_resp = await db_client.post(
        f"{API_PREFIX}/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "select_existing",
            "selected_decision_id": str(decision_id),
        },
    )
    assert consensus_resp.status_code == 201, consensus_resp.text
    consensus_data = consensus_resp.json()["data"]
    assert consensus_data["published"]["version"] == 1

    # consensus -> finalized
    await _advance(db_client, run_id, "finalized")

    # GET run returns full aggregate
    detail_resp = await db_client.get(f"{API_PREFIX}/{run_id}")
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()["data"]
    assert detail["run"]["stage"] == "finalized"
    assert detail["run"]["status"] == "completed"
    assert len(detail["proposals"]) == 1
    assert len(detail["decisions"]) == 1
    assert len(detail["consensus_decisions"]) == 1
    assert len(detail["published_states"]) == 1
    assert detail["published_states"][0]["version"] == 1
    assert detail["published_states"][0]["instance_id"] == str(instance_id)
    assert detail["published_states"][0]["field_id"] == str(field_id)


# =================== BOLA: cross-project ownership ===================


@pytest.mark.asyncio
async def test_create_run_rejects_article_from_another_project(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,
) -> None:
    """POST /runs must reject an article_id that belongs to a different project.

    The endpoint checks that the caller is a member of project_id but previously
    did not validate that article_id belongs to that project. This test pins the
    fix: a cross-project article must return 400, not 201.
    """
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, _article_id, template_id, _, _, _ = fx

    # Create an isolated project + article that the authenticated profile does
    # NOT belong to (no project_members row). The membership guard passes for
    # project_id; only the new article-ownership check should reject it.
    foreign_project_id = uuid4()
    foreign_article_id = uuid4()
    await db_session.execute(
        text("INSERT INTO public.projects (id, name, created_by_id) VALUES (:pid, :name, :uid)"),
        {
            "pid": str(foreign_project_id),
            "name": f"bola-test-{foreign_project_id.hex[:8]}",
            "uid": str(auth_as_profile),
        },
    )
    await db_session.execute(
        text("INSERT INTO public.articles (id, project_id, title) VALUES (:aid, :pid, :title)"),
        {
            "aid": str(foreign_article_id),
            "pid": str(foreign_project_id),
            "title": f"bola-test-article-{foreign_article_id.hex[:8]}",
        },
    )
    await db_session.commit()

    try:
        res = await db_client.post(
            API_PREFIX,
            json={
                "project_id": str(project_id),
                "article_id": str(foreign_article_id),
                "project_template_id": str(template_id),
            },
        )
        assert res.status_code == 400, res.text
        # ApiResponse envelope: the message lives at error.message, not at
        # FastAPI's default ``detail`` key.
        body = res.json()
        message = body.get("error", {}).get("message", body.get("detail", ""))
        assert "article" in message.lower(), body
    finally:
        await db_session.execute(
            text("DELETE FROM public.articles WHERE id = :aid"),
            {"aid": str(foreign_article_id)},
        )
        await db_session.execute(
            text("DELETE FROM public.projects WHERE id = :pid"),
            {"pid": str(foreign_project_id)},
        )
        await db_session.commit()


@pytest.mark.asyncio
async def test_create_run_rejects_template_from_another_project(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,
) -> None:
    """POST /runs must reject a project_template_id that belongs to a different project.

    The endpoint validated project membership but not template ownership. This test
    pins the fix: a cross-project template must return 404, not 201.
    """
    fx = await _resolve_fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, _template_id, _, _, _ = fx

    foreign_project_id = uuid4()
    foreign_template_id = uuid4()
    await db_session.execute(
        text("INSERT INTO public.projects (id, name, created_by_id) VALUES (:pid, :name, :uid)"),
        {
            "pid": str(foreign_project_id),
            "name": f"bola-tpl-{foreign_project_id.hex[:8]}",
            "uid": str(auth_as_profile),
        },
    )
    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, kind, framework, is_active, created_by)
            VALUES (:tid, :pid, :name, 'extraction', 'CUSTOM', false, :uid)
            """
        ),
        {
            "tid": str(foreign_template_id),
            "pid": str(foreign_project_id),
            "name": f"bola-tpl-{foreign_template_id.hex[:8]}",
            "uid": str(auth_as_profile),
        },
    )
    # Migration 0004 deferred trigger: a project_extraction_template must have
    # at least one active version, otherwise commit fails.
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (project_template_id, version, schema, published_by, is_active)
            VALUES (:tid, 1, '{}'::jsonb, :uid, true)
            """
        ),
        {"tid": str(foreign_template_id), "uid": str(auth_as_profile)},
    )
    await db_session.commit()

    try:
        res = await db_client.post(
            API_PREFIX,
            json={
                "project_id": str(project_id),
                "article_id": str(article_id),
                "project_template_id": str(foreign_template_id),
            },
        )
        assert res.status_code == 404, res.text
    finally:
        await db_session.execute(
            text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(foreign_template_id)},
        )
        await db_session.execute(
            text("DELETE FROM public.projects WHERE id = :pid"),
            {"pid": str(foreign_project_id)},
        )
        await db_session.commit()
