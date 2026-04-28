"""End-to-end HITL lifecycle test against the live API endpoints.

Walks through the canonical sequence:
  POST /v1/runs                  → create
  POST /v1/runs/{id}/advance     → pending → proposal
  POST /v1/runs/{id}/proposals   → AI proposal recorded
  POST /v1/runs/{id}/advance     → proposal → review
  POST /v1/runs/{id}/decisions   → accept_proposal
  POST /v1/runs/{id}/advance     → review → consensus
  POST /v1/runs/{id}/consensus   → select_existing publishes
  POST /v1/runs/{id}/advance     → consensus → finalized
  GET  /v1/runs/{id}             → returns full aggregate

Uses the FastAPI in-process AsyncClient (no separate server). Confirms the
end-to-end wiring of services, repositories, schemas, error mapping, and
ApiResponse envelope.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override get_current_user so JWT sub is a real profile UUID."""
    raw = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if raw is None:
        pytest.skip("No profile rows available in test database")
    profile_id = UUID(str(raw))

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


async def _pick_fixtures(db: AsyncSession) -> tuple[str, str, str, str, str] | None:
    """Pick (project_id, article_id, template_id, instance_id, field_id) where
    instance + field both belong to the same template/entity_type chain."""
    project_id = (
        await db.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    article_id = (
        await db.execute(text("SELECT id FROM public.articles LIMIT 1"))
    ).scalar()
    template_id = (
        await db.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    if not (project_id and article_id and template_id):
        return None
    pair = (
        await db.execute(
            text(
                """
                SELECT i.id, f.id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE i.template_id = :tid
                LIMIT 1
                """
            ),
            {"tid": template_id},
        )
    ).first()
    if pair is None:
        return None
    instance_id, field_id = pair
    return (
        str(project_id),
        str(article_id),
        str(template_id),
        str(instance_id),
        str(field_id),
    )


@pytest.mark.asyncio
async def test_full_hitl_lifecycle(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _pick_fixtures(db_session)
    if fx is None:
        pytest.skip("Need projects/articles/templates/instances/fields fixtures.")
    project_id, article_id, template_id, instance_id, field_id = fx

    # 1) Create run
    create_res = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": project_id,
            "article_id": article_id,
            "project_template_id": template_id,
        },
    )
    assert create_res.status_code == 201, create_res.text
    run = create_res.json()["data"]
    run_id = run["id"]
    assert run["stage"] == "pending"
    assert run["kind"] == "extraction"

    # 2) Advance to proposal
    advance_res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "proposal"}
    )
    assert advance_res.status_code == 200, advance_res.text
    assert advance_res.json()["data"]["stage"] == "proposal"

    # 3) Record AI proposal
    proposal_res = await db_client.post(
        f"/api/v1/runs/{run_id}/proposals",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "source": "ai",
            "proposed_value": {"text": "lifecycle E2E"},
            "confidence_score": 0.88,
        },
    )
    assert proposal_res.status_code == 201, proposal_res.text
    proposal_id = proposal_res.json()["data"]["id"]
    assert UUID(proposal_id)

    # 4) Advance to review
    advance_res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "review"}
    )
    assert advance_res.status_code == 200

    # 5) Reviewer accepts the proposal
    decision_res = await db_client.post(
        f"/api/v1/runs/{run_id}/decisions",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "decision": "accept_proposal",
            "proposal_record_id": proposal_id,
        },
    )
    assert decision_res.status_code == 201, decision_res.text
    decision_id = decision_res.json()["data"]["id"]

    # 6) Advance to consensus
    advance_res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "consensus"}
    )
    assert advance_res.status_code == 200

    # 7) Consensus: select the existing decision; publish state v=1
    consensus_res = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "mode": "select_existing",
            "selected_decision_id": decision_id,
        },
    )
    assert consensus_res.status_code == 201, consensus_res.text
    body = consensus_res.json()["data"]
    assert body["consensus"]["mode"] == "select_existing"
    assert body["published"]["version"] == 1
    assert body["published"]["value"] == {"text": "lifecycle E2E"}

    # 8) Advance to finalized
    advance_res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "finalized"}
    )
    assert advance_res.status_code == 200
    assert advance_res.json()["data"]["stage"] == "finalized"
    assert advance_res.json()["data"]["status"] == "completed"

    # 9) GET full state — proposals + decisions + consensus + published all there
    get_res = await db_client.get(f"/api/v1/runs/{run_id}")
    assert get_res.status_code == 200
    aggregate = get_res.json()["data"]
    assert aggregate["run"]["stage"] == "finalized"
    assert len(aggregate["proposals"]) == 1
    assert aggregate["proposals"][0]["id"] == proposal_id
    assert len(aggregate["decisions"]) == 1
    assert aggregate["decisions"][0]["id"] == decision_id
    assert len(aggregate["consensus_decisions"]) == 1
    assert len(aggregate["published_states"]) == 1
    assert aggregate["published_states"][0]["version"] == 1


@pytest.mark.asyncio
async def test_invalid_stage_transition_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _pick_fixtures(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    project_id, article_id, template_id, _, _ = fx

    create_res = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": project_id,
            "article_id": article_id,
            "project_template_id": template_id,
        },
    )
    assert create_res.status_code == 201
    run_id = create_res.json()["data"]["id"]

    # pending → review (not allowed; must go pending → proposal first)
    bad = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "review"}
    )
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_proposal_outside_proposal_stage_returns_400(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _pick_fixtures(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    project_id, article_id, template_id, instance_id, field_id = fx

    create_res = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": project_id,
            "article_id": article_id,
            "project_template_id": template_id,
        },
    )
    run_id = create_res.json()["data"]["id"]

    # Run is in pending stage; proposal requires proposal stage
    bad = await db_client.post(
        f"/api/v1/runs/{run_id}/proposals",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "source": "ai",
            "proposed_value": {"v": "x"},
        },
    )
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_get_unknown_run_returns_404(db_client: AsyncClient) -> None:
    res = await db_client.get("/api/v1/runs/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
    body = res.json()
    assert body["ok"] is False
