"""API contract tests for GET /api/v1/runs/{run_id}/view.

Pins three behaviours:
1. A project member gets 200 with envelope ``{"ok": true, "data": {...}}``
   where ``data`` has keys ``run``, ``proposals``, ``entity_types``,
   ``current_values`` (plus the RunDetailResponse keys inherited by
   RunViewResponse: ``decisions``, ``consensus_decisions``,
   ``published_states``).
2. A non-member (different project) gets 403 (BOLA gate).
3. QA parity: ``/view`` also works (200, same keys) for a
   ``kind=quality_assessment`` run opened via ``POST /api/v1/hitl/sessions``.

Pattern copied from ``test_extraction_runs_endpoints.py``:
- ``db_client`` (real-DB AsyncClient from ``backend/tests/conftest.py``)
- ``auth_as_profile`` fixture pins JWT sub to ``SEED.primary_profile``
- ``outsider_user`` fixture from ``test_membership_guards.py`` for BOLA case
- ``_create_run_via_api`` helper for extraction run setup
- ``_pick_qa_global_template`` / ``_open_qa_session`` from
  ``test_qa_publish_flow.py`` for QA run setup
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

API_PREFIX = "/api/v1/runs"
_SESSION_URL = "/api/v1/hitl/sessions"


# =================== FIXTURES ===================


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override ``get_current_user`` so its JWT subject is ``SEED.primary_profile``.

    Identical to the pattern used in ``test_extraction_runs_endpoints.py`` and
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


@pytest_asyncio.fixture
async def outsider_user(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Create a fresh auth.users row + profile that has no project membership.

    Copied from ``test_membership_guards.py``.
    """
    import uuid as _uuid_mod

    outsider_id = _uuid_mod.uuid4()
    email = f"outsider-view-{outsider_id}@run-view-test.local"

    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.commit()

    # Ensure the profile exists (trigger may be absent on CI).
    profile_id = (
        await db_session.execute(
            text("SELECT id FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
    ).scalar()
    if profile_id is None:
        await db_session.execute(
            text("INSERT INTO public.profiles (id, full_name) VALUES (:id, 'Outsider View')"),
            {"id": str(outsider_id)},
        )
        await db_session.commit()

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(outsider_id),
            email=email,
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
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


# =================== HELPERS ===================


async def _create_extraction_run(
    client: AsyncClient,
) -> dict[str, Any]:
    """Create a new extraction run against the seed sentinel fixtures."""
    body = {
        "project_id": str(SEED.primary_project),
        "article_id": str(SEED.primary_article),
        "project_template_id": str(SEED.primary_template),
    }
    resp = await client.post(API_PREFIX, json=body)
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    return payload["data"]


async def _pick_qa_global_template(db: AsyncSession, name: str = "PROBAST") -> UUID | None:
    """Return the id of a seeded global QA template (PROBAST or QUADAS-2)."""
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind='quality_assessment' AND name=:n LIMIT 1"
            ),
            {"n": name},
        )
    ).scalar()
    return UUID(str(raw)) if raw is not None else None


async def _open_qa_session(
    client: AsyncClient,
    *,
    project_id: UUID,
    article_id: UUID,
    global_template_id: UUID,
) -> dict[str, Any]:
    """Open a quality_assessment HITL session and return its run data."""
    res = await client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(global_template_id),
        },
    )
    assert res.status_code in (200, 201), res.text
    return res.json()["data"]


async def _provision_run_outsider_cannot_see(db: AsyncSession) -> UUID:
    """Create a run in SEED.primary_project (the outsider is not a member).

    Provisioned directly via ``RunLifecycleService`` on the shared rolled-back
    ``db_session`` so the BOLA test has a concrete run target without depending
    on order-of-execution leftovers in the DB. The run is created as the seed
    manager (``SEED.primary_profile``); the outsider is intentionally not a
    member of ``primary_project``, so the ``/view`` BOLA gate must reject them.
    """
    run = await RunLifecycleService(db).create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    return run.id


# =================== TESTS ===================


@pytest.mark.asyncio
async def test_get_run_view_returns_200_with_required_keys(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001 — fixture order: seed runs first
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Happy path: member gets 200 envelope with the four required data keys."""
    created = await _create_extraction_run(db_client)
    run_id = created["id"]

    resp = await db_client.get(f"{API_PREFIX}/{run_id}/view")
    assert resp.status_code == 200, resp.text

    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]

    # RunDetailResponse fields (inherited)
    assert data["run"]["id"] == run_id
    assert "proposals" in data
    assert "decisions" in data
    assert "consensus_decisions" in data
    assert "published_states" in data

    # RunViewResponse additional fields
    assert "entity_types" in data
    assert "current_values" in data
    assert "instances" in data, "RunViewResponse must include instances"

    # Freshly-created run in pending stage: no workflow rows yet; no
    # current_values (pending stage bypasses value resolution).
    assert data["proposals"] == []
    assert data["current_values"] == []
    # entity_types may be empty when the seed template has no entity types
    # stored in the version snapshot, which is valid.
    assert isinstance(data["entity_types"], list)
    assert isinstance(data["instances"], list)

    # Wire-key assertion: instance dicts must emit "metadata" not "metadata_".
    assert len(data["instances"]) >= 1, (
        "need at least one instance to exercise the metadata wire key"
    )
    for inst in data["instances"]:
        assert "metadata" in inst, "instance wire key must be 'metadata' not 'metadata_'"
        assert "metadata_" not in inst, "ORM attribute name must not leak into JSON"


@pytest.mark.asyncio
async def test_get_run_view_returns_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    """BOLA gate: a caller who is not a member of the run's project gets 403."""
    del outsider_user  # auth override active via fixture; sub is the outsider
    run_id = await _provision_run_outsider_cannot_see(db_session)

    resp = await db_client.get(f"{API_PREFIX}/{run_id}/view")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_get_run_view_works_for_qa_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """QA parity: /view returns 200 with the same four keys for kind=quality_assessment."""
    global_tpl_id = await _pick_qa_global_template(db_session)
    if global_tpl_id is None:
        pytest.skip("No global QA template (PROBAST) seeded — run `python -m backend.app.seed`")

    session_data = await _open_qa_session(
        db_client,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        global_template_id=global_tpl_id,
    )
    # OpenHITLSessionResponse has ``run_id`` at top level (not ``run.id``).
    run_id = session_data["run_id"]

    resp = await db_client.get(f"{API_PREFIX}/{run_id}/view")
    assert resp.status_code == 200, resp.text

    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]

    assert data["run"]["id"] == run_id
    assert data["run"]["kind"] == "quality_assessment"
    assert "proposals" in data
    assert "entity_types" in data
    assert "current_values" in data
    assert isinstance(data["entity_types"], list)
    assert isinstance(data["current_values"], list)
