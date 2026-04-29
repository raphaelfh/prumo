"""Integration tests for the HITL config CRUD endpoints.

These cover the surface used by Project Settings → Review consensus:
GET / PUT / DELETE at both project and template scope, including
manager-only enforcement and arbitrator validation.
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


async def _delete_existing_configs(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID | None = None,
) -> None:
    await db.execute(
        text(
            "DELETE FROM public.extraction_hitl_configs "
            "WHERE (scope_kind = 'project' AND scope_id = :pid) "
            "   OR (scope_kind = 'template' AND scope_id = :tid)"
        ),
        {"pid": str(project_id), "tid": str(template_id) if template_id else None},
    )


@pytest_asyncio.fixture
async def manager_project(
    db_session: AsyncSession,
) -> AsyncGenerator[tuple[UUID, UUID, UUID], None]:
    """Yield ``(project_id, manager_profile_id, project_template_id)``.

    Picks the first project that has at least one manager + one extraction
    template; ensures the JWT override returns the manager's profile id.
    Skips when fixtures are insufficient.
    """
    row = (
        await db_session.execute(
            text(
                """
                SELECT pm.project_id, pm.user_id, pet.id
                FROM public.project_members pm
                JOIN public.project_extraction_templates pet
                  ON pet.project_id = pm.project_id
                WHERE pm.role = 'manager'
                LIMIT 1
                """
            )
        )
    ).first()
    if row is None:
        pytest.skip("Need a project with a manager + an extraction template")

    project_id, manager_id, template_id = (
        UUID(str(row[0])),
        UUID(str(row[1])),
        UUID(str(row[2])),
    )

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(manager_id),
            email="manager@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    await _delete_existing_configs(db_session, project_id, template_id)
    await db_session.commit()
    try:
        yield project_id, manager_id, template_id
    finally:
        await _delete_existing_configs(db_session, project_id, template_id)
        await db_session.commit()


# ---------------------------------------------------------------------------
# Project-scoped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_project_config_returns_system_default_when_unset(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project
    res = await db_client.get(f"/api/v1/projects/{project_id}/hitl-config")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["scope_kind"] == "system_default"
    assert data["reviewer_count"] == 1
    assert data["consensus_rule"] == "unanimous"
    assert data["arbitrator_id"] is None
    assert data["inherited"] is True


@pytest.mark.asyncio
async def test_put_then_get_project_config_roundtrip(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project

    res = await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={
            "reviewer_count": 2,
            "consensus_rule": "majority",
            "arbitrator_id": None,
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["scope_kind"] == "project"
    assert data["reviewer_count"] == 2
    assert data["consensus_rule"] == "majority"
    assert data["inherited"] is False

    # Reading after PUT returns the same row.
    res = await db_client.get(f"/api/v1/projects/{project_id}/hitl-config")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["scope_kind"] == "project"
    assert data["reviewer_count"] == 2
    assert data["inherited"] is False


@pytest.mark.asyncio
async def test_put_arbitrator_rule_requires_arbitrator_id(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project
    res = await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={
            "reviewer_count": 3,
            "consensus_rule": "arbitrator",
            # arbitrator_id intentionally omitted
        },
    )
    # Pydantic validation rejects: 422.
    assert res.status_code == 422, res.text


@pytest.mark.asyncio
async def test_put_arbitrator_must_be_project_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, manager_id, _ = manager_project
    outsider = (
        await db_session.execute(
            text(
                """
                SELECT id FROM public.profiles
                WHERE id NOT IN (
                    SELECT user_id FROM public.project_members WHERE project_id = :pid
                )
                LIMIT 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if outsider is None:
        pytest.skip("Need a profile that is not a member of the project")
    assert UUID(str(outsider)) != manager_id

    res = await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={
            "reviewer_count": 2,
            "consensus_rule": "arbitrator",
            "arbitrator_id": str(outsider),
        },
    )
    assert res.status_code == 400, res.text
    assert "not a member" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_project_config_falls_back_to_default(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project
    await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={"reviewer_count": 2, "consensus_rule": "majority"},
    )
    res = await db_client.delete(f"/api/v1/projects/{project_id}/hitl-config")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["scope_kind"] == "system_default"
    assert data["inherited"] is True


@pytest.mark.asyncio
async def test_non_manager_cannot_write(
    db_client: AsyncClient,
    db_session: AsyncSession,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project
    # Pick a non-manager member of the same project (or skip).
    reviewer = (
        await db_session.execute(
            text(
                """
                SELECT user_id FROM public.project_members
                WHERE project_id = :pid AND role <> 'manager'
                LIMIT 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if reviewer is None:
        pytest.skip("Need a non-manager member of the project")

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(reviewer),
            email="reviewer@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user

    # Read still works.
    res = await db_client.get(f"/api/v1/projects/{project_id}/hitl-config")
    assert res.status_code == 200

    # Write does not.
    res = await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={"reviewer_count": 2, "consensus_rule": "majority"},
    )
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# Template-scoped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_template_config_inherits_from_project(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, template_id = manager_project

    # Set the project default but no template override.
    await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={"reviewer_count": 2, "consensus_rule": "majority"},
    )

    res = await db_client.get(f"/api/v1/projects/{project_id}/templates/{template_id}/hitl-config")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["scope_kind"] == "project"
    assert data["reviewer_count"] == 2
    assert data["inherited"] is True


@pytest.mark.asyncio
async def test_template_override_takes_priority(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, manager_id, template_id = manager_project
    # Project default: 2 reviewers / majority
    await db_client.put(
        f"/api/v1/projects/{project_id}/hitl-config",
        json={"reviewer_count": 2, "consensus_rule": "majority"},
    )
    # Template override: 3 reviewers / arbitrator (manager is a member, so valid)
    res = await db_client.put(
        f"/api/v1/projects/{project_id}/templates/{template_id}/hitl-config",
        json={
            "reviewer_count": 3,
            "consensus_rule": "arbitrator",
            "arbitrator_id": str(manager_id),
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["scope_kind"] == "template"
    assert data["reviewer_count"] == 3
    assert data["consensus_rule"] == "arbitrator"
    assert data["arbitrator_id"] == str(manager_id)
    assert data["inherited"] is False

    # Deleting the override falls back to the project default.
    res = await db_client.delete(
        f"/api/v1/projects/{project_id}/templates/{template_id}/hitl-config"
    )
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["scope_kind"] == "project"
    assert data["inherited"] is True


@pytest.mark.asyncio
async def test_template_endpoint_404_when_template_missing(
    db_client: AsyncClient,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project
    bogus = uuid4()
    res = await db_client.get(f"/api/v1/projects/{project_id}/templates/{bogus}/hitl-config")
    assert res.status_code == 404, res.text


@pytest.mark.asyncio
async def test_template_endpoint_404_when_template_belongs_to_other_project(
    db_client: AsyncClient,
    db_session: AsyncSession,
    manager_project: tuple[UUID, UUID, UUID],
) -> None:
    project_id, _, _ = manager_project
    other_template = (
        await db_session.execute(
            text(
                """
                SELECT id FROM public.project_extraction_templates
                WHERE project_id <> :pid
                LIMIT 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if other_template is None:
        pytest.skip("Need a template owned by a different project")

    res = await db_client.get(
        f"/api/v1/projects/{project_id}/templates/{other_template}/hitl-config"
    )
    assert res.status_code == 404, res.text
