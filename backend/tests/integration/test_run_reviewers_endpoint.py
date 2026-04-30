"""GET /v1/runs/{run_id}/reviewers — display profiles for the
HITL UI's reviewer-facing widgets (avatars, names, attribution).

The contract:
  · Empty list when nobody has touched the run yet.
  · Contains the human proposer of any human-sourced ProposalRecord.
  · Contains every distinct reviewer behind a ReviewerDecision.
  · Contains the consensus arbitrator behind a ConsensusDecision.
  · Each entry carries `id`, `full_name`, `avatar_url`.
  · 404 when the run id is unknown.
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
    raw = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if raw is None:
        pytest.skip("No profile rows available")
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
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
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
    return (
        str(project_id),
        str(article_id),
        str(template_id),
        str(pair[0]),
        str(pair[1]),
    )


@pytest.mark.asyncio
async def test_reviewers_endpoint_404_for_unknown_run(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    res = await db_client.get("/api/v1/runs/00000000-0000-0000-0000-000000000000/reviewers")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_reviewers_empty_for_fresh_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _pick_fixtures(db_session)
    if fx is None:
        pytest.skip("Need projects + articles + template + instance/field fixture")
    project_id, article_id, template_id, _, _ = fx

    create = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": project_id,
            "article_id": article_id,
            "project_template_id": template_id,
        },
    )
    assert create.status_code == 201
    run_id = create.json()["data"]["id"]

    res = await db_client.get(f"/api/v1/runs/{run_id}/reviewers")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["reviewers"] == []


@pytest.mark.asyncio
async def test_reviewers_collects_proposer_decision_consensus(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,
) -> None:
    fx = await _pick_fixtures(db_session)
    if fx is None:
        pytest.skip("Need projects + articles + template + instance/field fixture")
    project_id, article_id, template_id, instance_id, field_id = fx
    user_id = str(auth_as_profile)

    # 1. Create run, advance to proposal, post a human proposal.
    create = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": project_id,
            "article_id": article_id,
            "project_template_id": template_id,
        },
    )
    assert create.status_code == 201
    run_id = create.json()["data"]["id"]
    adv = await db_client.post(f"/api/v1/runs/{run_id}/advance", json={"target_stage": "proposal"})
    assert adv.status_code == 200

    proposal = await db_client.post(
        f"/api/v1/runs/{run_id}/proposals",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "source": "human",
            "proposed_value": {"value": "X"},
            "source_user_id": user_id,
        },
    )
    assert proposal.status_code == 201, proposal.text

    # 2. Advance to review and post a decision.
    adv2 = await db_client.post(f"/api/v1/runs/{run_id}/advance", json={"target_stage": "review"})
    assert adv2.status_code == 200
    decision = await db_client.post(
        f"/api/v1/runs/{run_id}/decisions",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "decision": "accept_proposal",
            "proposal_record_id": proposal.json()["data"]["id"],
        },
    )
    assert decision.status_code == 201

    # 3. Advance to consensus and post a manual_override.
    adv3 = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "consensus"}
    )
    assert adv3.status_code == 200
    cons = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "mode": "manual_override",
            "value": {"value": "Y"},
            "rationale": "ok",
        },
    )
    assert cons.status_code == 201

    # 4. The reviewers endpoint sees the union; for this test the
    # proposer/reviewer/arbitrator are all the same (auth_as_profile),
    # so we expect exactly one entry — the dedupe must work.
    res = await db_client.get(f"/api/v1/runs/{run_id}/reviewers")
    assert res.status_code == 200, res.text
    body = res.json()["data"]["reviewers"]
    assert len(body) == 1
    entry = body[0]
    assert entry["id"] == user_id
    # Profile fields are present (full_name + avatar_url may be null in
    # the test fixture, but the keys exist).
    assert "full_name" in entry
    assert "avatar_url" in entry
