"""Integration tests for extraction global template clone (CHARMS).

Validates the optimized clone path: batch-loaded global fields, combined
counts query, and API response parity with global catalogue row counts.
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

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """JWT sub must be a real profile id (FK on project_extraction_templates)."""
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


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    raw = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if raw is None:
        return None
    return UUID(str(raw[0])), UUID(str(raw[1]))


async def _global_extraction_catalog_counts(
    db: AsyncSession,
    global_template_id: UUID,
) -> tuple[int, int]:
    """Entity-type and field counts for rows still linked to the global template."""
    row = (
        await db.execute(
            text(
                """
                SELECT
                    (
                        SELECT COUNT(*)::bigint
                        FROM public.extraction_entity_types et
                        WHERE et.template_id = CAST(:tid AS uuid)
                    ),
                    (
                        SELECT COUNT(*)::bigint
                        FROM public.extraction_fields f
                        INNER JOIN public.extraction_entity_types et
                            ON et.id = f.entity_type_id
                        WHERE et.template_id = CAST(:tid AS uuid)
                    )
                """
            ),
            {"tid": str(global_template_id)},
        )
    ).one()
    return int(row[0]), int(row[1])


async def _wipe_charms_clone(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID | None,
) -> None:
    """Remove CHARMS project clone (and dependent runs/instances) for a clean clone test."""
    article_clause = "AND article_id = :aid" if article_id is not None else ""
    params: dict[str, object] = {
        "pid": str(project_id),
        "gid": str(CHARMS_GLOBAL_ID),
    }
    if article_id is not None:
        params["aid"] = str(article_id)

    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_runs
            WHERE project_id = CAST(:pid AS uuid) {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = CAST(:pid AS uuid)
                  AND global_template_id = CAST(:gid AS uuid)
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_instances
            WHERE project_id = CAST(:pid AS uuid) {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = CAST(:pid AS uuid)
                  AND global_template_id = CAST(:gid AS uuid)
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            "DELETE FROM public.project_extraction_templates "
            "WHERE project_id = CAST(:pid AS uuid) AND global_template_id = CAST(:gid AS uuid)"
        ),
        {"pid": str(project_id), "gid": str(CHARMS_GLOBAL_ID)},
    )
    await db.commit()


@pytest.mark.asyncio
async def test_clone_extraction_charms_response_matches_global_catalog_counts(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Clone CHARMS into a project; API counts must match global entity/field totals."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    expected_et, expected_fields = await _global_extraction_catalog_counts(
        db_session, CHARMS_GLOBAL_ID
    )
    if expected_et == 0 or expected_fields == 0:
        pytest.skip("CHARMS global catalogue not seeded (seed_charms did not insert)")

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article

    await _wipe_charms_clone(db_session, project_id=project_id, article_id=article_id)

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"}

    res = await db_client.post(url, json=payload)
    assert res.status_code == 201, res.text
    data = res.json()["data"]
    assert data["created"] is True
    assert data["entity_type_count"] == expected_et
    assert data["field_count"] == expected_fields
    assert UUID(data["project_template_id"])
    assert UUID(data["version_id"])


@pytest.mark.asyncio
async def test_clone_extraction_charms_is_idempotent(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Second clone call returns the same template with matching counts."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    expected_et, expected_fields = await _global_extraction_catalog_counts(
        db_session, CHARMS_GLOBAL_ID
    )
    if expected_et == 0:
        pytest.skip("CHARMS global catalogue not seeded")

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article

    await _wipe_charms_clone(db_session, project_id=project_id, article_id=article_id)

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"}

    first = await db_client.post(url, json=payload)
    assert first.status_code == 201, first.text
    first_body = first.json()["data"]

    second = await db_client.post(url, json=payload)
    assert second.status_code == 201, second.text
    second_body = second.json()["data"]

    assert second_body["project_template_id"] == first_body["project_template_id"]
    assert second_body["created"] is False
    assert second_body["entity_type_count"] == expected_et
    assert second_body["field_count"] == expected_fields
    assert second_body["entity_type_count"] == first_body["entity_type_count"]
    assert second_body["field_count"] == first_body["field_count"]


@pytest.mark.asyncio
async def test_clone_extraction_deactivates_sibling_extraction_templates(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Single-active invariant for extraction kind.

    Cloning a second extraction template into the same project must leave
    exactly one active extraction template (the newly cloned one). This
    mirrors ``update_project_template_active`` which refuses to deactivate
    the last active extraction template — the workflow assumes single
    active at all times, so cloning must enforce it on the way in too.
    QA siblings (different kind) must be left untouched.
    """
    from app.models.extraction import ProjectExtractionTemplate
    from app.seed import seed_charms, seed_probast

    await seed_charms(db_session)
    await seed_probast(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    # Seed an existing active extraction template via direct insert (mimics
    # the "user already had E2E" scenario from production).
    legacy_id = UUID("11111111-1111-1111-1111-111111111111")
    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, description, framework, version, kind, schema,
                 is_active, created_by)
            VALUES (:id, :pid, 'Legacy E2E', 'legacy', 'CUSTOM', '1.0', 'extraction',
                    '{}'::jsonb, true,
                    (SELECT id FROM public.profiles LIMIT 1))
            ON CONFLICT (id) DO UPDATE SET is_active = true
            """
        ),
        {"id": str(legacy_id), "pid": str(project_id)},
    )
    # Active template version (deferred trigger requires it).
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (project_template_id, version, schema, published_at,
                 published_by, is_active)
            VALUES (:tid, 1, '{}'::jsonb, NOW(),
                    (SELECT id FROM public.profiles LIMIT 1), true)
            ON CONFLICT DO NOTHING
            """
        ),
        {"tid": str(legacy_id)},
    )
    # Also create an active QA template — must stay active after clone.
    probast_clone_url = f"/api/v1/projects/{project_id}/templates/clone"
    qa_payload = {
        "global_template_id": "00b00000-0000-0000-0000-000000000001",
        "kind": "quality_assessment",
    }
    qa_res = await db_client.post(probast_clone_url, json=qa_payload)
    assert qa_res.status_code == 201, qa_res.text
    qa_template_id = UUID(qa_res.json()["data"]["project_template_id"])

    await db_session.commit()

    # Clone CHARMS — this should deactivate "Legacy E2E" but leave PROBAST.
    res = await db_client.post(
        probast_clone_url,
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    assert res.status_code == 201, res.text
    new_id = UUID(res.json()["data"]["project_template_id"])

    # Reload from DB.
    legacy = await db_session.get(ProjectExtractionTemplate, legacy_id)
    new_tpl = await db_session.get(ProjectExtractionTemplate, new_id)
    qa_tpl = await db_session.get(ProjectExtractionTemplate, qa_template_id)
    await db_session.refresh(legacy)
    await db_session.refresh(new_tpl)
    await db_session.refresh(qa_tpl)

    assert new_tpl is not None and new_tpl.is_active is True
    assert legacy is not None and legacy.is_active is False, (
        "Cloning a new extraction template must deactivate sibling extraction templates"
    )
    assert qa_tpl is not None and qa_tpl.is_active is True, (
        "Sibling QA template must remain active when cloning an extraction template"
    )

    # And the single-active invariant: only one active extraction template.
    active_count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' AND is_active = true"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    assert active_count == 1


@pytest.mark.asyncio
async def test_partial_unique_index_blocks_second_active_extraction_template(
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Defence-in-depth: the partial unique index
    ``uq_one_active_extraction_template_per_project`` rejects any direct
    INSERT/UPDATE that would leave the project with two active extraction
    templates. Catches future callers that bypass
    ``TemplateCloneService.clone`` (e.g. ad-hoc Supabase inserts).
    """
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article

    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    # Insert two active extraction templates in a single transaction; the
    # second insert must fail. Use a savepoint per insert so the test
    # session isn't poisoned by a failed transaction.
    profile_id = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()

    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, description, framework, version, kind, schema,
                 is_active, created_by)
            VALUES (gen_random_uuid(), :pid, 'tpl-a', NULL, 'CUSTOM', '1.0',
                    'extraction', '{}'::jsonb, true, :uid)
            """
        ),
        {"pid": str(project_id), "uid": str(profile_id)},
    )
    # The deferred trigger ``project_extraction_templates_active_version``
    # requires every template to have an active version row by COMMIT.
    # Insert one for the first template before attempting the second one
    # so the failure isolates to the partial unique index, not the
    # active-version invariant.
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (project_template_id, version, schema, published_at,
                 published_by, is_active)
            SELECT id, 1, '{}'::jsonb, NOW(), :uid, true
            FROM public.project_extraction_templates
            WHERE project_id = :pid AND kind = 'extraction' AND is_active = true
            """
        ),
        {"pid": str(project_id), "uid": str(profile_id)},
    )
    await db_session.flush()

    # Second active extraction template: must violate the partial unique index.
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.project_extraction_templates
                    (id, project_id, name, description, framework, version, kind, schema,
                     is_active, created_by)
                VALUES (gen_random_uuid(), :pid, 'tpl-b', NULL, 'CUSTOM', '1.0',
                        'extraction', '{}'::jsonb, true, :uid)
                """
            ),
            {"pid": str(project_id), "uid": str(profile_id)},
        )
        await db_session.flush()

    await db_session.rollback()


@pytest.mark.asyncio
async def test_clone_reactivates_inactive_existing_extraction_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: re-importing CHARMS when the existing clone is inactive must
    flip ``is_active`` back to true (and deactivate siblings). Mirrors
    the user intent "use this template now"."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"}

    first = await db_client.post(url, json=payload)
    assert first.status_code == 201
    tpl_id = UUID(first.json()["data"]["project_template_id"])

    # Take the existing CHARMS clone offline.
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates SET is_active = false WHERE id = :id"
        ),
        {"id": str(tpl_id)},
    )
    await db_session.commit()

    # Re-import.
    second = await db_client.post(url, json=payload)
    assert second.status_code == 201
    assert second.json()["data"]["project_template_id"] == str(tpl_id)
    assert second.json()["data"]["created"] is False

    is_active = (
        await db_session.execute(
            text(
                "SELECT is_active FROM public.project_extraction_templates WHERE id = :id"
            ),
            {"id": str(tpl_id)},
        )
    ).scalar()
    assert is_active is True


@pytest.mark.asyncio
async def test_clone_heals_empty_clone_by_repopulating_entity_types(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: a clone row that exists but has zero entity_types must be
    healed by the next clone call — the service re-reads the global
    structure and inserts entity_types + fields + an active version."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"}
    first = await db_client.post(url, json=payload)
    assert first.status_code == 201
    tpl_id = UUID(first.json()["data"]["project_template_id"])

    # Strip the entity_types so the next clone hits the heal branch.
    await db_session.execute(
        text("DELETE FROM public.extraction_entity_types WHERE project_template_id = :id"),
        {"id": str(tpl_id)},
    )
    await db_session.commit()

    second = await db_client.post(url, json=payload)
    assert second.status_code == 201
    body = second.json()["data"]
    assert body["created"] is False
    assert body["entity_type_count"] > 0
    assert body["field_count"] > 0


@pytest.mark.asyncio
async def test_clone_404s_on_unknown_global_template(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: cloning a non-existent global template surfaces as 404, not 500."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={
            "global_template_id": "00000000-0000-0000-0000-000000000000",
            "kind": "extraction",
        },
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_clone_404s_on_kind_mismatch_with_global(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: asking the API for ``kind=extraction`` but pointing at a QA
    global (PROBAST/QUADAS-2) returns 404, not a silently-mismatched clone."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article

    qa_global_id = "00b00000-0000-0000-0000-000000000001"  # PROBAST
    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": qa_global_id, "kind": "extraction"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_clone_preserves_active_qa_templates(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: cloning a new extraction template must not touch QA templates,
    even if they happen to be active for the same project."""
    from app.seed import seed_charms, seed_probast

    await seed_charms(db_session)
    await seed_probast(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    qa_url = f"/api/v1/projects/{project_id}/templates/clone"
    qa_res = await db_client.post(
        qa_url,
        json={
            "global_template_id": "00b00000-0000-0000-0000-000000000001",
            "kind": "quality_assessment",
        },
    )
    assert qa_res.status_code == 201
    qa_tpl_id = UUID(qa_res.json()["data"]["project_template_id"])
    qa_was_active_before = (
        await db_session.execute(
            text("SELECT is_active FROM public.project_extraction_templates WHERE id = :id"),
            {"id": str(qa_tpl_id)},
        )
    ).scalar()
    assert qa_was_active_before is True

    extract_res = await db_client.post(
        qa_url,
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    assert extract_res.status_code == 201

    qa_is_active_after = (
        await db_session.execute(
            text("SELECT is_active FROM public.project_extraction_templates WHERE id = :id"),
            {"id": str(qa_tpl_id)},
        )
    ).scalar()
    assert qa_is_active_after is True


@pytest.mark.asyncio
async def test_clone_creates_v1_active_template_version(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: every new clone must land with exactly one active
    ``extraction_template_versions`` row (deferred trigger from migration
    0004 enforces this at COMMIT, but the test pins behaviour earlier)."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    assert res.status_code == 201
    tpl_id = res.json()["data"]["project_template_id"]

    active_versions = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active = true"
            ),
            {"tid": tpl_id},
        )
    ).scalar()
    assert active_versions == 1


@pytest.mark.asyncio
async def test_clone_preserves_entity_type_hierarchy(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: parent→child entity_type relationships are remapped to the
    cloned ids — the cloned ``prediction_models`` becomes the parent of
    every cloned sub-section."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    tpl_id = res.json()["data"]["project_template_id"]

    pred_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND name = 'prediction_models'"
            ),
            {"tid": tpl_id},
        )
    ).scalar()
    child_count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_entity_types "
                "WHERE parent_entity_type_id = :pet"
            ),
            {"pet": str(pred_id)},
        )
    ).scalar()
    assert child_count >= 10  # CHARMS has 13 cardinality='one' children + 1 'many'


@pytest.mark.asyncio
async def test_clone_does_not_link_to_global_template_id_for_entity_types(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: cloned entity_types carry ``template_id = NULL`` (project
    scope) and ``project_template_id`` set — the global template id only
    sits on the project-template row, not on the structural rows beneath
    it. This isolates project edits from the global catalogue."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    tpl_id = res.json()["data"]["project_template_id"]

    leaky = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND template_id IS NOT NULL"
            ),
            {"tid": tpl_id},
        )
    ).scalar()
    assert leaky == 0


@pytest.mark.asyncio
async def test_clone_qa_does_not_deactivate_other_qa_templates(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Cloning QA must NOT deactivate other active QA templates.

    PROBAST + QUADAS-2 are meant to coexist for the same project.
    """
    from app.models.extraction import ProjectExtractionTemplate
    from app.seed import seed_probast, seed_quadas2

    await seed_probast(db_session)
    await seed_quadas2(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article

    url = f"/api/v1/projects/{project_id}/templates/clone"
    first = await db_client.post(
        url,
        json={
            "global_template_id": "00b00000-0000-0000-0000-000000000001",
            "kind": "quality_assessment",
        },
    )
    assert first.status_code == 201, first.text
    first_id = UUID(first.json()["data"]["project_template_id"])

    second = await db_client.post(
        url,
        json={
            "global_template_id": "00d00000-0000-0000-0000-000000000001",
            "kind": "quality_assessment",
        },
    )
    assert second.status_code == 201, second.text
    second_id = UUID(second.json()["data"]["project_template_id"])
    assert second_id != first_id

    first_tpl = await db_session.get(ProjectExtractionTemplate, first_id)
    second_tpl = await db_session.get(ProjectExtractionTemplate, second_id)
    await db_session.refresh(first_tpl)
    await db_session.refresh(second_tpl)

    assert first_tpl is not None and first_tpl.is_active is True
    assert second_tpl is not None and second_tpl.is_active is True


@pytest.mark.asyncio
async def test_clone_returns_existing_template_when_duplicate_clone_rows_exist(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Legacy duplicate clone rows must not crash idempotent clone lookup.

    The real race is two first-time clone requests selecting no existing row
    before either transaction commits. The service now serializes that path, but
    production may already contain duplicate QA rows because QA templates are
    allowed to coexist as active. Re-import must choose a deterministic row
    instead of raising ``MultipleResultsFound``.
    """
    from app.seed import seed_probast

    await seed_probast(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    global_template_id = UUID("00b00000-0000-0000-0000-000000000001")

    await db_session.execute(
        text(
            """
            DELETE FROM public.extraction_runs
            WHERE project_id = :pid
              AND template_id IN (
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
            WHERE project_id = :pid
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
              )
            """
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db_session.execute(
        text(
            "DELETE FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND global_template_id = :gid"
        ),
        {"pid": str(project_id), "gid": str(global_template_id)},
    )
    await db_session.commit()

    first_id = uuid4()
    second_id = uuid4()
    profile_id = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    duplicate_templates = (
        (first_id, "PROBAST duplicate A", "2026-01-01T00:00:00Z"),
        (second_id, "PROBAST duplicate B", "2026-01-02T00:00:00Z"),
    )
    for template_id, name, created_at in duplicate_templates:
        await db_session.execute(
            text(
                """
                INSERT INTO public.project_extraction_templates
                    (id, project_id, name, description, framework, version, kind, schema,
                     is_active, created_by, global_template_id, created_at, updated_at)
                VALUES (:id, :pid, :name, NULL, 'CUSTOM', '1.0',
                        'quality_assessment', '{}'::jsonb, true, :uid, :gid,
                        CAST(:created_at AS timestamptz), CAST(:created_at AS timestamptz))
                """
            ),
            {
                "id": str(template_id),
                "pid": str(project_id),
                "name": name,
                "uid": str(profile_id),
                "gid": str(global_template_id),
                "created_at": created_at,
            },
        )
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_template_versions
                    (project_template_id, version, schema, published_at,
                     published_by, is_active)
                VALUES (:tid, 1, '{}'::jsonb, NOW(), :uid, true)
                """
            ),
            {"tid": str(template_id), "uid": str(profile_id)},
        )
    await db_session.commit()

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(global_template_id), "kind": "quality_assessment"},
    )

    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["created"] is False
    assert body["project_template_id"] == str(first_id)
    assert body["entity_type_count"] > 0
    assert body["field_count"] > 0


@pytest.mark.asyncio
async def test_clone_heals_project_template_with_no_structure(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Clone is *idempotent + healing*.

    If a ``project_extraction_templates`` row already exists for a
    ``(project_id, global_template_id)`` pair but has zero entity_types
    or zero fields underneath, a fresh clone call must re-populate the
    structure from the global template instead of returning the partial
    row.

    This covers legacy data and any future migration path where the
    structure layer fell behind the parent row.
    """
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    expected_et, expected_fields = await _global_extraction_catalog_counts(
        db_session, CHARMS_GLOBAL_ID
    )
    if expected_et == 0:
        pytest.skip("CHARMS global catalogue not seeded")

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    # 1. Bootstrap a structureless project_extraction_templates row that
    #    references the CHARMS global template — mimics the partial-clone
    #    state we've observed in legacy data.
    partial_id = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, description, framework, version, kind, schema,
                 is_active, created_by, global_template_id)
            VALUES (:id, :pid, 'CHARMS (partial)', NULL, 'CHARMS', '1.0', 'extraction',
                    '{}'::jsonb, true,
                    (SELECT id FROM public.profiles LIMIT 1),
                    :gid)
            ON CONFLICT (id) DO UPDATE SET is_active = true
            """
        ),
        {"id": str(partial_id), "pid": str(project_id), "gid": str(CHARMS_GLOBAL_ID)},
    )
    # The DB-side trigger requires an active version row before commit, so we
    # add a minimal placeholder. The heal path will rewrite the snapshot.
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (id, project_template_id, version, schema, published_at, published_by, is_active)
            VALUES (gen_random_uuid(), :tid, 1, '{}'::jsonb, NOW(),
                    (SELECT id FROM public.profiles LIMIT 1), true)
            """
        ),
        {"tid": str(partial_id)},
    )
    await db_session.commit()

    # Sanity: no entity_types underneath yet.
    et_count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid"
            ),
            {"tid": str(partial_id)},
        )
    ).scalar()
    assert et_count == 0, "Bootstrap failed: expected an empty partial clone"

    # 2. Clone via the public endpoint — should detect the structureless
    #    row and heal it from the global catalogue.
    url = f"/api/v1/projects/{project_id}/templates/clone"
    res = await db_client.post(
        url,
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["project_template_id"] == str(partial_id), (
        "Heal must reuse the existing partial row, not create a duplicate"
    )
    assert body["created"] is False
    assert body["entity_type_count"] == expected_et
    assert body["field_count"] == expected_fields

    # 3. DB confirms the structure was rebuilt.
    et_after = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid"
            ),
            {"tid": str(partial_id)},
        )
    ).scalar()
    f_after = (
        await db_session.execute(
            text(
                """
                SELECT count(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.project_template_id = :tid
                """
            ),
            {"tid": str(partial_id)},
        )
    ).scalar()
    assert et_after == expected_et
    assert f_after == expected_fields
