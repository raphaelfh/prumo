"""Membership guards for endpoints flagged by GH issues #28, #57-#62, #76.

These tests confirm that a freshly-created authenticated user who is NOT a
member of the target project cannot read or mutate run / template / export
state belonging to that project.

The cluster of fixes share two helpers:

* ``outsider_user`` — inserts a transient ``auth.users`` row (the
  ``handle_new_user`` trigger materializes a matching ``public.profiles``
  row) and overrides ``get_current_user`` so the JWT sub is the outsider's
  id. Cleaned up at teardown.
* ``insider_run`` — picks an existing run owned by a project the outsider
  does NOT belong to, plus matching ``(instance_id, field_id)`` coords for
  the proposal/decision/consensus payloads.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app

# =================== FIXTURES ===================


@pytest_asyncio.fixture
async def outsider_user(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Create a fresh auth.users row + profile that has no project membership."""
    outsider_id = uuid.uuid4()
    email = f"outsider-{outsider_id}@membership-test.local"

    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.commit()

    # Sanity check: handle_new_user trigger should have materialised the profile.
    profile_id = (
        await db_session.execute(
            text("SELECT id FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
    ).scalar()
    if profile_id is None:
        # Fall back to explicit profile creation if the trigger is absent.
        await db_session.execute(
            text("INSERT INTO public.profiles (id, full_name) VALUES (:id, 'Outsider')"),
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


async def _pick_run_for_outsider(
    db: AsyncSession, outsider_id: UUID
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Return (run_id, project_id, instance_id, field_id) for any run whose
    project does NOT include ``outsider_id`` as a member."""
    row = (
        await db.execute(
            text(
                """
                SELECT r.id, r.project_id, i.id, f.id
                FROM public.extraction_runs r
                JOIN public.extraction_instances i ON i.template_id = r.template_id
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE NOT public.is_project_member(r.project_id, :uid)
                LIMIT 1
                """
            ),
            {"uid": str(outsider_id)},
        )
    ).first()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1])), UUID(str(row[2])), UUID(str(row[3]))


async def _pick_template_for_outsider(
    db: AsyncSession, outsider_id: UUID
) -> tuple[UUID, UUID] | None:
    row = (
        await db.execute(
            text(
                "SELECT id, project_id FROM public.project_extraction_templates "
                "WHERE NOT public.is_project_member(project_id, :uid) LIMIT 1"
            ),
            {"uid": str(outsider_id)},
        )
    ).first()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1]))


# =================== #57: GET /runs/{id} ===================


@pytest.mark.asyncio
async def test_get_run_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, _, _ = fx

    res = await db_client.get(f"/api/v1/runs/{run_id}")
    assert res.status_code == 403, res.text


# =================== #58: GET /runs/{id}/reviewers ===================


@pytest.mark.asyncio
async def test_list_run_reviewers_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, _, _ = fx

    res = await db_client.get(f"/api/v1/runs/{run_id}/reviewers")
    assert res.status_code == 403, res.text


# =================== #61: POST /runs/{id}/advance + /reopen ===================


@pytest.mark.asyncio
async def test_advance_run_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, _, _ = fx

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "cancelled"},
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_reopen_run_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, _, _ = fx

    res = await db_client.post(f"/api/v1/runs/{run_id}/reopen")
    assert res.status_code == 403, res.text


# =================== #62: POST /runs and POST /hitl/sessions ===================


@pytest.mark.asyncio
async def test_create_run_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_template_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a template in a project the outsider does not belong to")
    template_id, project_id = fx
    article_id = (
        await db_session.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).scalar()
    if article_id is None:
        pytest.skip("Need an article in the same project")

    res = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_open_hitl_session_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_template_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a template in a project the outsider does not belong to")
    template_id, project_id = fx
    article_id = (
        await db_session.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).scalar()
    if article_id is None:
        pytest.skip("Need an article in the same project")

    res = await db_client.post(
        "/api/v1/hitl/sessions",
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    assert res.status_code == 403, res.text


# =================== #76: POST /runs/{id}/proposals + /decisions + /consensus ===================


@pytest.mark.asyncio
async def test_create_proposal_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, instance_id, field_id = fx

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/proposals",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "source": "human",
            "proposed_value": {"text": "outsider"},
        },
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_create_decision_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, instance_id, field_id = fx

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/decisions",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "decision": "reject",
        },
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_create_consensus_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_run_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a run in a project the outsider does not belong to")
    run_id, _, instance_id, field_id = fx

    res = await db_client.post(
        f"/api/v1/runs/{run_id}/consensus",
        json={
            "instance_id": str(instance_id),
            "field_id": str(field_id),
            "mode": "manual_override",
            "value": {"text": "outsider"},
        },
    )
    assert res.status_code == 403, res.text


# =================== #59: PATCH /projects/{id}/templates/{tid} ===================


@pytest.mark.asyncio
async def test_patch_template_active_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    outsider_user: UUID,
) -> None:
    fx = await _pick_template_for_outsider(db_session, outsider_user)
    if fx is None:
        pytest.skip("Need a template in a project the outsider does not belong to")
    template_id, project_id = fx

    res = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": False},
    )
    assert res.status_code == 403, res.text


# =================== #28: DELETE /articles-export/status/{job_id} ===================


@pytest.mark.asyncio
async def test_cancel_export_rejects_non_owner(
    db_client: AsyncClient,
    outsider_user: UUID,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cancel must refuse to revoke a job the caller did not start.

    We simulate the start path having recorded a different owner in Redis
    by monkeypatching the lookup helper; the underlying ``Redis`` and
    ``celery_app`` calls would otherwise need a real broker.
    """
    from app.api.v1.endpoints import articles_export as ae
    from app.worker.celery_app import celery_app

    job_id = str(uuid.uuid4())
    owner_user_id = str(uuid.uuid4())  # not the outsider

    monkeypatch.setattr(ae, "_lookup_export_owner", lambda _jid: owner_user_id)

    revoked: list[str] = []

    class _FakeResult:
        state = "PENDING"
        result = None

        def __init__(self, *args, **kwargs):
            pass

    # AsyncResult is imported at call time inside cancel_export; patch the
    # canonical class object so the local rebinding inherits the fake.
    import celery.result as celery_result_mod

    monkeypatch.setattr(celery_result_mod, "AsyncResult", _FakeResult)

    def _fake_revoke(jid, terminate=False):  # noqa: ARG001
        revoked.append(jid)

    monkeypatch.setattr(celery_app.control, "revoke", _fake_revoke)

    res = await db_client.delete(f"/api/v1/articles-export/status/{job_id}")
    assert res.status_code == 200, res.text  # envelope-style failure
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "FORBIDDEN"
    assert revoked == []
