"""Integration tests for ``TemplateVersionService.republish``.

Template edits happen through the Supabase client (PostgREST) and never
touched ``extraction_template_versions`` — so every run (including brand
new ones) rendered the schema frozen at clone time. ``republish``
publishes the live structure as a NEW active version (v+1), leaving the
prior version row untouched (runs from ``consensus`` on stay pinned to
the schema they were assessed under), and re-pins runs still in an
editable stage (``pending`` / ``extract``) to the new version.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionEntityType, TemplateKind
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.template_clone_service import TemplateCloneService
from app.services.template_version_service import (
    TemplateNotFoundError,
    TemplateVersionService,
)
from tests.integration.conftest import SEED

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")


async def _clean_project_clones(db: AsyncSession, project_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.project_extraction_templates WHERE project_id = :pid"),
        {"pid": str(project_id)},
    )


async def _clone_charms(db: AsyncSession, project_id: UUID, user_id: UUID):
    return await TemplateCloneService(db).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )


async def _first_entity_type_id(db: AsyncSession, project_template_id: UUID) -> UUID:
    return (
        await db.execute(
            select(ExtractionEntityType.id)
            .where(ExtractionEntityType.project_template_id == project_template_id)
            .order_by(ExtractionEntityType.sort_order)
            .limit(1)
        )
    ).scalar_one()


async def _add_field_like_postgrest(db: AsyncSession, entity_type_id: UUID, name: str) -> UUID:
    """Simulate the config UI's direct PostgREST insert of a new field."""
    field_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order, "
            " allow_other, allows_not_applicable, allows_not_evaluated) "
            "VALUES (:id, :et, :name, :label, 'text', false, 999, true, true, true)"
        ),
        {"id": str(field_id), "et": str(entity_type_id), "name": name, "label": name},
    )
    await db.flush()
    return field_id


def _snapshot_field_names(version: ExtractionTemplateVersion) -> set[str]:
    return {
        f["name"]
        for et in (version.schema_ or {}).get("entity_types", [])
        for f in et.get("fields", [])
    }


@pytest.mark.asyncio
async def test_republish_creates_new_active_version_and_preserves_old(
    db_session: AsyncSession,
) -> None:
    """An edit + republish yields v2 (active, containing the new field with
    its disposition flags) while v1 survives untouched and inactive."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    et_id = await _first_entity_type_id(db_session, clone.project_template_id)
    await _add_field_like_postgrest(db_session, et_id, "late_added_field")

    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )

    versions = (
        (
            await db_session.execute(
                select(ExtractionTemplateVersion)
                .where(ExtractionTemplateVersion.project_template_id == clone.project_template_id)
                .order_by(ExtractionTemplateVersion.version)
            )
        )
        .scalars()
        .all()
    )
    assert [v.version for v in versions] == [1, 2]
    v1, v2 = versions
    assert v1.id == clone.version_id
    assert v1.is_active is False
    assert "late_added_field" not in _snapshot_field_names(v1), (
        "v1 must stay frozen — republish must not mutate the old snapshot"
    )
    assert v2.is_active is True
    assert result.version_id == v2.id
    assert result.version == 2
    assert "late_added_field" in _snapshot_field_names(v2)

    new_field = next(
        f
        for et in v2.schema_["entity_types"]
        for f in et.get("fields", [])
        if f["name"] == "late_added_field"
    )
    assert new_field["allow_other"] is True
    assert new_field["allows_not_applicable"] is True
    assert new_field["allows_not_evaluated"] is True

    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_is_noop_when_snapshot_current(db_session: AsyncSession) -> None:
    """Republishing without live changes must not spawn version rows."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    service = TemplateVersionService(db_session)
    first = await service.republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    second = await service.republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert first.version_id == clone.version_id, "no changes → keep the clone version"
    assert second.version_id == clone.version_id
    count = (
        (
            await db_session.execute(
                select(ExtractionTemplateVersion.id).where(
                    ExtractionTemplateVersion.project_template_id == clone.project_template_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(count) == 1

    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_repins_editable_runs_but_not_finalized(
    db_session: AsyncSession,
) -> None:
    """Runs in pending/extract move to the new version; runs from consensus
    onward keep the version they were assessed under."""
    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    article_ids = []
    for i in range(2):
        aid = uuid4()
        await db_session.execute(
            text(
                "INSERT INTO public.articles (id, project_id, title, row_version) "
                "VALUES (:id, :pid, :title, 1)"
            ),
            {"id": str(aid), "pid": str(project_id), "title": f"republish art {i}"},
        )
        article_ids.append(aid)
    await db_session.flush()

    lifecycle = RunLifecycleService(db_session)
    editable_run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_ids[0],
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    frozen_run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_ids[1],
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'extract' WHERE id = :id"),
        {"id": str(editable_run.id)},
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'finalized' WHERE id = :id"),
        {"id": str(frozen_run.id)},
    )
    await db_session.flush()

    et_id = await _first_entity_type_id(db_session, clone.project_template_id)
    await _add_field_like_postgrest(db_session, et_id, "repin_field")

    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert result.repinned_run_count == 1

    rows = dict(
        (
            await db_session.execute(
                text("SELECT id, version_id FROM public.extraction_runs WHERE id IN (:a, :b)"),
                {"a": str(editable_run.id), "b": str(frozen_run.id)},
            )
        ).all()
    )
    assert str(rows[editable_run.id]) == str(result.version_id)
    assert str(rows[frozen_run.id]) == str(clone.version_id)

    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_materializes_instances_for_new_singleton_section(
    db_session: AsyncSession,
) -> None:
    """A new cardinality-one section added mid-run must get an instance for
    every re-pinned run's article — otherwise the ADR-0009 finalize gate
    (which counts required fields per EXISTING instance) silently skips
    the new section and a run can finalize with it empty."""
    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    aid = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'instance-backfill article', 1)"
        ),
        {"id": str(aid), "pid": str(project_id)},
    )
    await db_session.flush()
    run = await RunLifecycleService(db_session).create_run(
        project_id=project_id,
        article_id=aid,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'extract' WHERE id = :id"),
        {"id": str(run.id)},
    )
    await db_session.flush()

    new_section_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order, "
            " is_required) "
            "VALUES (:id, :tid, 'funding', 'Funding', 'one', 'study_section', 999, true)"
        ),
        {"id": str(new_section_id), "tid": str(clone.project_template_id)},
    )
    await db_session.flush()

    await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )

    instance = (
        await db_session.execute(
            text(
                "SELECT 1 FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et"
            ),
            {"aid": str(aid), "et": str(new_section_id)},
        )
    ).scalar()
    assert instance == 1, (
        "republish re-pinned the run to a snapshot containing the new section "
        "but materialized no instance for it — the finalize completeness gate "
        "would skip the section entirely"
    )

    await db_session.rollback()


@pytest.mark.asyncio
async def test_run_created_after_republish_uses_new_version(
    db_session: AsyncSession,
) -> None:
    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    et_id = await _first_entity_type_id(db_session, clone.project_template_id)
    await _add_field_like_postgrest(db_session, et_id, "post_edit_field")
    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )

    aid = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'post-republish article', 1)"
        ),
        {"id": str(aid), "pid": str(project_id)},
    )
    await db_session.flush()
    run = await RunLifecycleService(db_session).create_run(
        project_id=project_id,
        article_id=aid,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert run.version_id == result.version_id

    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_rejects_template_from_other_project(
    db_session: AsyncSession,
) -> None:
    """BOLA: a template id from another project must 404, not republish."""
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, SEED.secondary_project)
    clone = await _clone_charms(db_session, SEED.secondary_project, user_id)

    with pytest.raises(TemplateNotFoundError):
        await TemplateVersionService(db_session).republish(
            project_id=SEED.primary_project,
            project_template_id=clone.project_template_id,
            user_id=user_id,
        )

    await db_session.rollback()


@pytest.mark.asyncio
async def test_reclone_preserves_republished_user_edits(
    db_session: AsyncSession,
) -> None:
    """Heal must not wipe deliberate edits: once an edit is republished
    (live == active snapshot), re-cloning the same global template is a
    no-op — the user's field survives. Pre-fix, heal compared live counts
    to the GLOBAL template and wiped any customized clone."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    et_id = await _first_entity_type_id(db_session, clone.project_template_id)
    field_id = await _add_field_like_postgrest(db_session, et_id, "user_custom_field")
    await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )

    recloned = await _clone_charms(db_session, project_id, user_id)
    assert recloned.project_template_id == clone.project_template_id

    still_there = (
        await db_session.execute(
            text("SELECT 1 FROM public.extraction_fields WHERE id = :id"),
            {"id": str(field_id)},
        )
    ).scalar()
    assert still_there == 1, (
        "re-clone wiped a republished user edit — heal must compare live "
        "structure to the ACTIVE SNAPSHOT, not to the global template"
    )

    await db_session.rollback()


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """JWT sub must be a real profile id (manager on the seeded projects)."""
    del db_session  # kept for fixture-dependency ordering; the seed runs first
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


@pytest.mark.asyncio
async def test_republish_endpoint_publishes_edit(
    db_session: AsyncSession,
    db_client: AsyncClient,
    auth_as_profile: UUID,
) -> None:
    project_id = SEED.secondary_project
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, auth_as_profile)
    et_id = await _first_entity_type_id(db_session, clone.project_template_id)
    await _add_field_like_postgrest(db_session, et_id, "endpoint_field")

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}/republish-version"
    )
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["version"] == 2
    assert data["changed"] is True
    assert UUID(data["version_id"]) != clone.version_id

    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_endpoint_404_for_foreign_template(
    db_session: AsyncSession,
    db_client: AsyncClient,
    auth_as_profile: UUID,
) -> None:
    """BOLA: republishing a template through another project's URL is 404."""
    await _clean_project_clones(db_session, SEED.secondary_project)
    clone = await _clone_charms(db_session, SEED.secondary_project, auth_as_profile)

    res = await db_client.post(
        f"/api/v1/projects/{SEED.primary_project}/templates/"
        f"{clone.project_template_id}/republish-version"
    )
    assert res.status_code == 404, res.text

    await db_session.rollback()
