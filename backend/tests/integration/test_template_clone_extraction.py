"""Integration tests for extraction global template clone (CHARMS).

Validates the optimized clone path: batch-loaded global fields, combined
counts query, and API response parity with global catalogue row counts.
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
    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()

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
        text("UPDATE public.project_extraction_templates SET is_active = false WHERE id = :id"),
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
            text("SELECT is_active FROM public.project_extraction_templates WHERE id = :id"),
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
    cloned ids. After the study-level vs per-model split (migration 0015),
    ``prediction_models`` only parents the per-model sections (Model
    Development, Final Predictors, Performance, Validation, Results,
    Interpretation = 6 children); the study-level sections (Source of
    Data, Participants, Outcome, Candidate Predictors, Sample Size,
    Missing Data, Observations) sit at the root."""
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

    # Look up the model container by structural role — the same way every
    # service does post migration 0016. Regression guard against the
    # legacy ``name='prediction_models'`` lookup creeping back.
    pred_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND role = 'model_container'"
            ),
            {"tid": tpl_id},
        )
    ).scalar()
    child_count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_entity_types "
                "WHERE parent_entity_type_id = :pet AND role = 'model_section'"
            ),
            {"pet": str(pred_id)},
        )
    ).scalar()
    assert child_count == 6  # CHARMS per-model children after the 0015 split

    # Study-level sections must carry role='study_section' and live at the
    # root of the clone. Regression guard for the prior bug where
    # everything was nested under the model selector.
    study_level_names = sorted(
        r[0]
        for r in (
            await db_session.execute(
                text(
                    "SELECT name FROM public.extraction_entity_types "
                    "WHERE project_template_id = :tid "
                    "AND role = 'study_section'"
                ),
                {"tid": tpl_id},
            )
        ).all()
    )
    assert study_level_names == [
        "candidate_predictors",
        "missing_data",
        "model_observations",
        "outcome_to_be_predicted",
        "participants",
        "sample_size",
        "source_of_data",
    ]


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


# ============================================================================
# Schema invariants introduced by migration 0016_entity_role_column
#
# These tests pin the role column's constraints from the DB side. They
# bypass the API to insert directly against the table so any regression in
# the partial unique index, CHECK constraint, or trigger surfaces as a
# test failure here rather than as a silent bug downstream.
# ============================================================================


@pytest.mark.asyncio
async def test_clone_handles_unordered_sort_order(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """``TemplateCloneService`` must topologically sort, not rely on
    ``sort_order`` for parent/child ordering.

    Reseeds CHARMS, then deliberately shuffles the global ``sort_order``
    so each model_section comes BEFORE its parent model_container in the
    DB's natural ORDER BY result. Pre-cleanup, the clone loop trusted
    that order and crashed with ``KeyError`` on the children. Post fix,
    the topological sort recovers the correct insertion order regardless
    of the input.
    """
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article
    await _wipe_charms_clone(db_session, project_id=project_id, article_id=None)

    # Invert sort_order on the global rows: children get the lowest
    # numbers, container in the middle, study-level last. ``ORDER BY
    # sort_order`` will now hand the clone the children first.
    await db_session.execute(
        text(
            """
            UPDATE public.extraction_entity_types
            SET sort_order = CASE role
                WHEN 'model_section' THEN sort_order - 100
                WHEN 'study_section' THEN sort_order + 100
                ELSE sort_order
            END
            WHERE template_id = :tid
            """
        ),
        {"tid": str(CHARMS_GLOBAL_ID)},
    )
    await db_session.commit()

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    assert res.status_code == 201, res.text
    tpl_id = res.json()["data"]["project_template_id"]

    # Every model_section in the clone must point at the project's
    # model_container — not at a global id or a missing one.
    bad_parents = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_entity_types child
                LEFT JOIN public.extraction_entity_types parent
                  ON parent.id = child.parent_entity_type_id
                WHERE child.project_template_id = :tid
                  AND child.role = 'model_section'
                  AND (parent.id IS NULL OR parent.role <> 'model_container')
                """
            ),
            {"tid": tpl_id},
        )
    ).scalar()
    assert bad_parents == 0, "topological sort must place model_container before children"


@pytest.mark.asyncio
async def test_cannot_insert_two_model_containers_per_template(
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """The partial unique index makes a second model_container per
    template unrepresentable. Adding one must raise an IntegrityError."""
    from sqlalchemy.exc import IntegrityError

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article

    # Find any existing CHARMS clone (already has exactly one container).
    clone_row = (
        await db_session.execute(
            text(
                """
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
                LIMIT 1
                """
            ),
            {"pid": str(project_id), "gid": str(CHARMS_GLOBAL_ID)},
        )
    ).scalar()
    if clone_row is None:
        pytest.skip("Need an existing CHARMS clone; previous tests should create one")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_entity_types
                    (project_template_id, name, label, cardinality, role,
                     sort_order, is_required)
                VALUES (:tid, 'second_container', 'Second Container',
                        'many', 'model_container', 999, false)
                """
            ),
            {"tid": str(clone_row)},
        )
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_model_section_without_container_parent_rejected(
    db_session_real: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """The deferred trigger rejects a model_section whose parent is not
    a model_container — even if the row otherwise satisfies the CHECK
    constraint (parent IS NOT NULL).

    Uses ``db_session_real`` because the trigger is DEFERRABLE INITIALLY
    DEFERRED — it fires at COMMIT, which the SAVEPOINT-based default
    fixture never reaches. See also
    ``backend/tests/integration/smoke_constraints/test_entity_role_parent.py``
    for the schema-level coverage of the same trigger against a freshly
    seeded graph.
    """
    from sqlalchemy.exc import IntegrityError

    article = await _pick_article(db_session_real)
    if article is None:
        pytest.skip("Need an article + project")
    _, project_id = article

    clone_row = (
        await db_session_real.execute(
            text(
                """
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND global_template_id = :gid
                LIMIT 1
                """
            ),
            {"pid": str(project_id), "gid": str(CHARMS_GLOBAL_ID)},
        )
    ).scalar()
    if clone_row is None:
        pytest.skip("Need an existing CHARMS clone; previous tests should create one")

    # Use a study_section as the bogus parent — it's a real row in the
    # same template but the wrong role for hosting a model_section.
    bogus_parent = (
        await db_session_real.execute(
            text(
                """
                SELECT id FROM public.extraction_entity_types
                WHERE project_template_id = :tid AND role = 'study_section'
                LIMIT 1
                """
            ),
            {"tid": str(clone_row)},
        )
    ).scalar()
    assert bogus_parent is not None

    with pytest.raises(IntegrityError):
        await db_session_real.execute(
            text(
                """
                INSERT INTO public.extraction_entity_types
                    (project_template_id, name, label, cardinality, role,
                     parent_entity_type_id, sort_order, is_required)
                VALUES (:tid, 'orphan_section', 'Orphan Section',
                        'one', 'model_section', :pet, 999, false)
                """
            ),
            {"tid": str(clone_row), "pet": str(bogus_parent)},
        )
        # The trigger is DEFERRED — fires at COMMIT, not at INSERT.
        await db_session_real.commit()
    await db_session_real.rollback()
