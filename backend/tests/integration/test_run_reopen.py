"""Reopen flow: finalized run → new run with seeded proposals.

Validates the "Option C" reopen contract end-to-end against the live
endpoints:

  1. Cannot reopen a run that isn't finalized.
  2. Reopening a finalized run produces a NEW run that:
       - is the same (project, article, template) tuple,
       - lands in stage=REVIEW,
       - carries `parent_run_id` in `parameters`,
       - is seeded with one ``source='system'`` proposal per
         PublishedState in the old run.
  3. The old run is untouched (still finalized, PublishedStates intact).
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
    instance_id, field_id = pair
    return (
        str(project_id),
        str(article_id),
        str(template_id),
        str(instance_id),
        str(field_id),
    )


async def _drive_run_to_finalized(
    db_client: AsyncClient,
    project_id: str,
    article_id: str,
    template_id: str,
    instance_id: str,
    field_id: str,
) -> str:
    """Walk a fresh run through pending → finalized so we have a finalized
    run to reopen. Returns the run id."""
    create = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": project_id,
            "article_id": article_id,
            "project_template_id": template_id,
        },
    )
    assert create.status_code == 201, create.text
    run_id = create.json()["data"]["id"]

    for stage in ("proposal", "review", "consensus"):
        adv = await db_client.post(f"/api/v1/runs/{run_id}/advance", json={"target_stage": stage})
        assert adv.status_code == 200, adv.text

    consensus = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "mode": "manual_override",
            "value": {"text": "v1"},
            "rationale": "initial publish",
        },
    )
    assert consensus.status_code == 201, consensus.text

    final = await db_client.post(
        f"/api/v1/runs/{run_id}/advance", json={"target_stage": "finalized"}
    )
    assert final.status_code == 200, final.text
    return run_id


@pytest.mark.asyncio
async def test_reopen_rejected_when_run_is_not_finalized(
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

    res = await db_client.post(f"/api/v1/runs/{run_id}/reopen")
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_reopen_rejected_when_run_is_unknown(
    db_client: AsyncClient,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    res = await db_client.post("/api/v1/runs/00000000-0000-0000-0000-000000000000/reopen")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_reopen_creates_new_run_seeded_from_published_states(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    fx = await _pick_fixtures(db_session)
    if fx is None:
        pytest.skip("Need projects + articles + template + instance/field fixture")
    project_id, article_id, template_id, instance_id, field_id = fx

    old_run_id = await _drive_run_to_finalized(
        db_client, project_id, article_id, template_id, instance_id, field_id
    )

    res = await db_client.post(f"/api/v1/runs/{old_run_id}/reopen")
    assert res.status_code == 201, res.text
    new_run = res.json()["data"]

    # The new run is a NEW row.
    assert new_run["id"] != old_run_id
    # Same coordinates.
    assert new_run["project_id"] == project_id
    assert new_run["article_id"] == article_id
    assert new_run["template_id"] == template_id
    # Lands in REVIEW (so the form can record decisions immediately).
    assert new_run["stage"] == "review"
    # Lineage is captured in parameters.
    assert new_run["parameters"]["parent_run_id"] == old_run_id
    assert "reopened_at" in new_run["parameters"]
    assert "reopened_by" in new_run["parameters"]

    # The new run carries one system-source ProposalRecord per
    # PublishedState that existed in the old run.
    seeded = (
        await db_session.execute(
            text(
                """
                SELECT instance_id, field_id, source, proposed_value
                FROM public.extraction_proposal_records
                WHERE run_id = :rid
                """
            ),
            {"rid": new_run["id"]},
        )
    ).all()
    assert len(seeded) >= 1
    for row in seeded:
        assert row[2] == "system"
        # The seeded value mirrors what we published in the old run.
        assert row[3] == {"text": "v1"}

    # Old run is untouched.
    old_after = (
        await db_session.execute(
            text("SELECT stage, status FROM public.extraction_runs WHERE id = :rid"),
            {"rid": old_run_id},
        )
    ).first()
    assert old_after is not None
    assert old_after[0] == "finalized"
    assert old_after[1] == "completed"

    # Old PublishedState still exists alongside the new run's own (yet to be created).
    old_published_count = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM public.extraction_published_states WHERE run_id = :rid"),
            {"rid": old_run_id},
        )
    ).scalar()
    assert old_published_count == 1
