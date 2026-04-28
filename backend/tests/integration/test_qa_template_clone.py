"""Integration tests for the Quality-Assessment template clone endpoint."""

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
    """Override auth so the JWT sub points at a real profile."""
    raw = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
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


async def _pick_qa_global_template(db: AsyncSession) -> UUID | None:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind = 'quality_assessment' LIMIT 1"
            )
        )
    ).scalar()
    return UUID(str(raw)) if raw is not None else None


async def _pick_project(db: AsyncSession) -> UUID | None:
    raw = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    return UUID(str(raw)) if raw is not None else None


@pytest.mark.asyncio
async def test_clone_qa_template_creates_full_tree(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    project_id = await _pick_project(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if project_id is None or global_template_id is None:
        pytest.skip("Need projects + a seeded QA template")

    # Drop any prior clone for (project, global_template) so this test is
    # repeatable against a non-rolled-back db_session fixture. ExtractionRun
    # and ExtractionInstance ON DELETE RESTRICT against the template, so wipe
    # them first; CASCADE on the template then handles entity_types + fields
    # + versions.
    await db_session.execute(
        text(
            """
            DELETE FROM public.extraction_runs
            WHERE template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
            )
            """
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db_session.execute(
        text(
            """
            DELETE FROM public.extraction_instances
            WHERE template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
            )
            """
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db_session.execute(
        text(
            """
            DELETE FROM public.project_extraction_templates
            WHERE project_id = :pid AND global_template_id = :gid
            """
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db_session.commit()

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/qa-templates",
        json={"global_template_id": str(global_template_id)},
    )
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert UUID(body["project_template_id"])
    assert UUID(body["version_id"])
    assert body["entity_type_count"] >= 1
    assert body["field_count"] >= 1
    assert body["created"] is True

    # Cloned project_extraction_template carries kind=quality_assessment
    kind = (
        await db_session.execute(
            text("SELECT kind FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": body["project_template_id"]},
        )
    ).scalar()
    assert kind == "quality_assessment"

    # Active v=1 row was created for the new template.
    version_count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND version = 1 AND is_active = true"
            ),
            {"tid": body["project_template_id"]},
        )
    ).scalar()
    assert version_count == 1


@pytest.mark.asyncio
async def test_clone_qa_template_is_idempotent(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    project_id = await _pick_project(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if project_id is None or global_template_id is None:
        pytest.skip("Need projects + a seeded QA template")

    first = await db_client.post(
        f"/api/v1/projects/{project_id}/qa-templates",
        json={"global_template_id": str(global_template_id)},
    )
    assert first.status_code == 201
    first_body = first.json()["data"]

    second = await db_client.post(
        f"/api/v1/projects/{project_id}/qa-templates",
        json={"global_template_id": str(global_template_id)},
    )
    assert second.status_code == 201
    second_body = second.json()["data"]

    assert second_body["project_template_id"] == first_body["project_template_id"]
    assert second_body["version_id"] == first_body["version_id"]
    assert second_body["created"] is False


@pytest.mark.asyncio
async def test_clone_qa_template_rejects_non_qa_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    project_id = await _pick_project(db_session)
    if project_id is None:
        pytest.skip("Need a project")
    extraction_global = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    if extraction_global is None:
        pytest.skip("No extraction-kind global template seeded")

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/qa-templates",
        json={"global_template_id": str(extraction_global)},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_clone_qa_template_returns_404_when_template_missing(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    project_id = await _pick_project(db_session)
    if project_id is None:
        pytest.skip("Need a project")

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/qa-templates",
        json={"global_template_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 404


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    raw = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if raw is None:
        return None
    return UUID(str(raw[0])), UUID(str(raw[1]))


@pytest.mark.asyncio
async def test_open_qa_assessment_creates_run_instances_and_advances_to_proposal(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    # Wipe any prior assessment artifacts so this test exercises the
    # create branch (Run lookup reuses non-finalized runs by design).
    await db_session.execute(
        text(
            """
            DELETE FROM public.extraction_runs
            WHERE article_id = :aid AND project_id = :pid
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        {"aid": str(article_id), "pid": str(project_id), "gid": str(global_template_id)},
    )
    await db_session.commit()

    res = await db_client.post(
        "/api/v1/qa-assessments",
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(global_template_id),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert UUID(body["run_id"])
    assert UUID(body["project_template_id"])
    assert len(body["instances_by_entity_type"]) >= 1

    stage = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :rid"),
            {"rid": body["run_id"]},
        )
    ).scalar()
    assert stage == "proposal"


@pytest.mark.asyncio
async def test_open_qa_assessment_reuses_in_flight_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    payload = {
        "project_id": str(project_id),
        "article_id": str(article_id),
        "global_template_id": str(global_template_id),
    }
    first = await db_client.post("/api/v1/qa-assessments", json=payload)
    assert first.status_code == 201
    first_run = first.json()["data"]["run_id"]

    second = await db_client.post("/api/v1/qa-assessments", json=payload)
    assert second.status_code == 201
    assert second.json()["data"]["run_id"] == first_run
