"""Integration tests for the unified HITL session endpoint.

Covers both kinds the endpoint accepts:

* ``quality_assessment``: pass ``global_template_id``; service clones the
  global PROBAST/QUADAS-2 template into the project on first call.
* ``extraction``: pass ``project_template_id`` directly; the service refuses
  ``global_template_id`` because extraction templates are authored per project.
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

_SESSION_URL = "/api/v1/hitl/sessions"


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


async def _pick_extraction_project_template(db: AsyncSession) -> UUID | None:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' LIMIT 1"
            )
        )
    ).scalar()
    return UUID(str(raw)) if raw is not None else None


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    raw = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if raw is None:
        return None
    return UUID(str(raw[0])), UUID(str(raw[1]))


async def _wipe_qa_state(
    db: AsyncSession,
    *,
    project_id: UUID,
    global_template_id: UUID,
    article_id: UUID | None = None,
) -> None:
    """Reset the (project, article?, qa-template) tuple so subsequent calls
    exercise the create branch rather than the reuse branch."""
    article_clause = "AND article_id = :aid" if article_id is not None else ""
    params: dict[str, object] = {"pid": str(project_id), "gid": str(global_template_id)}
    if article_id is not None:
        params["aid"] = str(article_id)

    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_runs
            WHERE project_id = :pid {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_instances
            WHERE project_id = :pid {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            "DELETE FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND global_template_id = :gid"
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db.commit()


# =================== QA: clone-on-first-call ===================


@pytest.mark.asyncio
async def test_qa_session_clones_template_on_first_call(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_state(
        db_session,
        project_id=project_id,
        global_template_id=global_template_id,
        article_id=article_id,
    )

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(global_template_id),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["kind"] == "quality_assessment"
    assert UUID(body["run_id"])
    assert UUID(body["project_template_id"])
    assert len(body["instances_by_entity_type"]) >= 1

    # The cloned project_extraction_template carries kind=quality_assessment.
    kind = (
        await db_session.execute(
            text("SELECT kind FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": body["project_template_id"]},
        )
    ).scalar()
    assert kind == "quality_assessment"

    # And v=1 active version was created (migration 0004 invariant).
    version_count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active = true"
            ),
            {"tid": body["project_template_id"]},
        )
    ).scalar()
    assert version_count == 1

    # The Run lands in PROPOSAL ready for the UI to record proposals.
    stage = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :rid"),
            {"rid": body["run_id"]},
        )
    ).scalar()
    assert stage == "proposal"


@pytest.mark.asyncio
async def test_qa_session_is_idempotent_across_calls(
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
        "kind": "quality_assessment",
        "project_id": str(project_id),
        "article_id": str(article_id),
        "global_template_id": str(global_template_id),
    }
    first = await db_client.post(_SESSION_URL, json=payload)
    assert first.status_code == 201
    second = await db_client.post(_SESSION_URL, json=payload)
    assert second.status_code == 201
    assert (
        second.json()["data"]["project_template_id"] == first.json()["data"]["project_template_id"]
    )
    assert second.json()["data"]["run_id"] == first.json()["data"]["run_id"]


@pytest.mark.asyncio
async def test_qa_session_returns_finalized_run_instead_of_forking(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Re-opening after finalize must surface the finalized run, not silently
    fork a new one — otherwise every page reload after publish would orphan
    the published values. Reopen is the explicit revision path."""
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need an article + a seeded QA template")
    article_id, project_id = article

    await _wipe_qa_state(
        db_session,
        project_id=project_id,
        global_template_id=global_template_id,
        article_id=article_id,
    )

    payload = {
        "kind": "quality_assessment",
        "project_id": str(project_id),
        "article_id": str(article_id),
        "global_template_id": str(global_template_id),
    }
    first = await db_client.post(_SESSION_URL, json=payload)
    assert first.status_code == 201
    run_id = first.json()["data"]["run_id"]

    for stage in ("review", "consensus", "finalized"):
        adv = await db_client.post(f"/api/v1/runs/{run_id}/advance", json={"target_stage": stage})
        assert adv.status_code == 200, adv.text

    second = await db_client.post(_SESSION_URL, json=payload)
    assert second.status_code == 201
    assert second.json()["data"]["run_id"] == run_id


# =================== QA: bad inputs ===================


@pytest.mark.asyncio
async def test_qa_session_rejects_extraction_global_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article")
    article_id, project_id = article
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
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(extraction_global),
        },
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_qa_session_returns_404_when_global_template_missing(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article")
    article_id, project_id = article

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert res.status_code == 404


# =================== Extraction kind ===================


@pytest.mark.asyncio
async def test_extraction_session_requires_project_template_id(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Extraction templates are authored per project, so passing only a
    global_template_id makes no sense and must 400."""
    article = await _pick_article(db_session)
    qa_global = await _pick_qa_global_template(db_session)
    if article is None or qa_global is None:
        pytest.skip("Need an article + a seeded global template")
    article_id, project_id = article

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(qa_global),
        },
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_extraction_session_opens_run_for_existing_project_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    template_id = await _pick_extraction_project_template(db_session)
    if article is None or template_id is None:
        pytest.skip("Need an article + an extraction project template")
    article_id, project_id = article

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["kind"] == "extraction"
    assert body["project_template_id"] == str(template_id)
    assert UUID(body["run_id"])


# =================== Project-template management ===================


@pytest.mark.asyncio
async def test_clone_template_endpoint_is_idempotent(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need a project + a seeded QA template")
    _, project_id = article

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(global_template_id), "kind": "quality_assessment"}

    first = await db_client.post(url, json=payload)
    assert first.status_code == 201, first.text
    first_body = first.json()["data"]
    assert UUID(first_body["project_template_id"])
    assert UUID(first_body["version_id"])

    second = await db_client.post(url, json=payload)
    assert second.status_code == 201
    second_body = second.json()["data"]
    assert second_body["project_template_id"] == first_body["project_template_id"]
    assert second_body["created"] is False


@pytest.mark.asyncio
async def test_clone_template_endpoint_rejects_kind_mismatch(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    qa_global = await _pick_qa_global_template(db_session)
    if article is None or qa_global is None:
        pytest.skip("Need a project + a seeded QA global template")
    _, project_id = article

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(qa_global), "kind": "extraction"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_patch_template_active_toggles_qa_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    global_template_id = await _pick_qa_global_template(db_session)
    if article is None or global_template_id is None:
        pytest.skip("Need a project + a seeded QA template")
    _, project_id = article

    clone = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(global_template_id), "kind": "quality_assessment"},
    )
    assert clone.status_code == 201
    template_id = clone.json()["data"]["project_template_id"]

    off = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": False},
    )
    assert off.status_code == 200, off.text
    assert off.json()["data"]["is_active"] is False

    on = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": True},
    )
    assert on.status_code == 200
    assert on.json()["data"]["is_active"] is True


@pytest.mark.asyncio
async def test_patch_template_active_rejects_disabling_only_extraction_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Disabling the project's only active extraction template must 400 —
    extraction's article-table view assumes a single active template."""
    template_id = await _pick_extraction_project_template(db_session)
    if template_id is None:
        pytest.skip("Need an extraction project template")
    project_id = (
        await db_session.execute(
            text("SELECT project_id FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(template_id)},
        )
    ).scalar()

    other_active = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' "
                "AND is_active = true AND id <> :tid"
            ),
            {"pid": str(project_id), "tid": str(template_id)},
        )
    ).scalar()
    if (other_active or 0) > 0:
        pytest.skip("Project has more than one active extraction template; rule does not apply")

    res = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/{template_id}",
        json={"is_active": False},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_patch_template_active_returns_404_for_unknown_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need a project")
    _, project_id = article

    res = await db_client.patch(
        f"/api/v1/projects/{project_id}/templates/00000000-0000-0000-0000-000000000000",
        json={"is_active": False},
    )
    assert res.status_code == 404
