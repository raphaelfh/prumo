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

API_PREFIX = "/api/v1/runs"


# =================== HELPERS ===================


async def _resolve_fixtures(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve (project, article, template, profile, instance, field) IDs from the
    test database, picking instance + field that share the same template/entity_type."""
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None

    row = await db.execute(
        text(
            """
            SELECT i.id AS iid, f.id AS fid
            FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE i.template_id = :tid
            LIMIT 1
            """
        ),
        {"tid": template_id},
    )
    pair = row.first()
    if pair is None:
        return None
    instance_id, field_id = pair
    return project_id, article_id, template_id, profile_id, instance_id, field_id


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override ``get_current_user`` so its JWT subject is a real profile UUID.

    Must be requested AFTER ``db_client`` (or alongside, since FastAPI just
    checks the override map at request time). Yielding the UUID lets each test
    assert against the same id used by the API.
    """
    profile_id_raw = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if profile_id_raw is None:
        pytest.skip("No profile rows available in test database")
    profile_id = UUID(str(profile_id_raw))

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
async def test_advance_pending_to_proposal_returns_200(
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
        json={"target_stage": "proposal"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["stage"] == "proposal"


@pytest.mark.asyncio
async def test_advance_pending_to_review_returns_400(
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
        json={"target_stage": "review"},
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
        json={"target_stage": "proposal"},
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
    await _advance(db_client, run_id, "proposal")

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
    await _advance(db_client, run_id, "proposal")

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
    await _advance(db_client, run_id, "proposal")

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
async def test_create_proposal_human_without_user_id_auto_fills_caller(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,
) -> None:
    """A human proposal without ``source_user_id`` is not an error: the
    endpoint defaults it to the authenticated caller so clients don't have
    to thread it through. The CHECK constraint ``human_has_user`` then
    trivially holds because the auto-filled value is non-null."""
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
    await _advance(db_client, run_id, "proposal")

    response = await db_client.post(
        f"{API_PREFIX}/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "human",
            "proposed_value": {"v": "x"},
            # source_user_id intentionally omitted — endpoint auto-fills.
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["data"]["source_user_id"] == str(auth_as_profile)


# =================== POST /runs/{id}/decisions ===================


async def _setup_review_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID]:
    """Create a run, advance to review, record one AI proposal. Returns
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
    await _advance(db_client, run_id, "proposal")
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
    await _advance(db_client, run_id, "review")
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

    # pending -> proposal
    await _advance(db_client, run_id, "proposal")

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

    # proposal -> review
    await _advance(db_client, run_id, "review")

    # POST decision (accept proposal)
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

    # review -> consensus
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
