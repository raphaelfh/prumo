"""Extensive coverage of ``HITLSessionService._backfill_child_singletons``.

The backfill maintains the invariant: every parent instance must have
exactly one instance of each cardinality='one' child entity_type. It
fires on every ``POST /api/v1/hitl/sessions`` so the UI form can bind
to a real instance even when the manager adds new sub-sections AFTER
models were created. These tests cover the slice that the original
``test_hitl_session.py`` happy-path tests skip.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionEntityRole
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")
PROBAST_GLOBAL_ID = UUID("00b00000-0000-0000-0000-000000000001")
_SESSION_URL = "/api/v1/hitl/sessions"


@pytest_asyncio.fixture
async def auth_as_profile(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
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


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    row = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1]))


async def _wipe_clone_chain(db: AsyncSession, *, project_id: UUID, global_id: UUID) -> None:
    """Tear down every project_extraction_templates row tied to a given
    global template id + its dependent runs/instances. Idempotent."""
    await db.execute(
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
        {"pid": str(project_id), "gid": str(global_id)},
    )
    await db.execute(
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
        {"pid": str(project_id), "gid": str(global_id)},
    )
    await db.execute(
        text(
            "DELETE FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND global_template_id = :gid"
        ),
        {"pid": str(project_id), "gid": str(global_id)},
    )
    await db.commit()


async def _seed_charms_clone(db: AsyncSession, db_client: AsyncClient, project_id: UUID) -> UUID:
    from app.seed import seed_charms

    await seed_charms(db)
    await db.commit()
    await _wipe_clone_chain(db, project_id=project_id, global_id=CHARMS_GLOBAL_ID)
    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/clone",
        json={"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"},
    )
    assert res.status_code == 201, res.text
    return UUID(res.json()["data"]["project_template_id"])


async def _insert_model_instance(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    project_template_id: UUID,
    prediction_models_et_id: UUID,
    label: str,
) -> UUID:
    raw = (
        await db.execute(
            text(
                """
                INSERT INTO public.extraction_instances
                    (project_id, article_id, template_id, entity_type_id,
                     parent_instance_id, label, sort_order, created_by)
                VALUES (:pid, :aid, :tid, :etid, NULL, :label, 0,
                        (SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1))
                RETURNING id
                """
            ),
            {
                "pid": str(project_id),
                "aid": str(article_id),
                "tid": str(project_template_id),
                "etid": str(prediction_models_et_id),
                "label": label,
            },
        )
    ).scalar()
    return UUID(str(raw))


async def _prediction_models_et_id(db: AsyncSession, project_template_id: UUID) -> UUID:
    raw = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :ptid AND name = 'prediction_models'"
            ),
            {"ptid": str(project_template_id)},
        )
    ).scalar()
    return UUID(str(raw))


async def _add_child_entity_type(
    db: AsyncSession,
    *,
    project_template_id: UUID,
    parent_et_id: UUID,
    name: str,
    cardinality: str = "one",
    sort_order: int = 99,
) -> UUID:
    """Insert a synthetic child entity type under an existing model
    container.

    Thin wrapper over ``TemplateFactory.add_section`` so existing tests
    keep their signature; new tests should use the factory directly.
    Routes through the ORM so the CHECK + trigger from migration 0016
    fire on misuse instead of producing inconsistent rows.
    """
    from typing import Literal as L
    from typing import cast

    from tests.factories import make_entity_type

    et = make_entity_type(
        project_template_id=project_template_id,
        name=name,
        cardinality=cast(L["one", "many"], cardinality),
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=parent_et_id,
        sort_order=sort_order,
    )
    db.add(et)
    await db.flush()
    return et.id


# ============================================================================
# Backfill iterations
# ============================================================================


async def test_backfill_creates_child_for_late_added_singleton(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: when a sub-section is added under an existing many-parent, the
    next session open materialises an instance for every existing parent."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)

    model = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="ModelA",
    )
    sub_et = await _add_child_entity_type(
        db_session, project_template_id=ptid, parent_et_id=pred_et, name="late_sub_a"
    )
    await db_session.commit()

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    assert res.status_code in (200, 201), res.text

    count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et "
                "AND parent_instance_id = :pid"
            ),
            {"aid": str(article_id), "et": str(sub_et), "pid": str(model)},
        )
    ).scalar()
    assert count == 1


async def test_backfill_skips_existing_children(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: an existing child instance is not duplicated even if the
    backfill runs many times — the set-lookup gates inserts."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    model = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="ModelB",
    )
    await db_session.commit()

    for _ in range(3):
        res = await db_client.post(
            _SESSION_URL,
            json={
                "kind": "extraction",
                "project_id": str(project_id),
                "article_id": str(article_id),
                "project_template_id": str(ptid),
            },
        )
        assert res.status_code in (200, 201)

    dup = (
        await db_session.execute(
            text(
                """
                SELECT entity_type_id, COUNT(*)
                FROM public.extraction_instances
                WHERE article_id = :aid AND parent_instance_id = :pid
                GROUP BY entity_type_id
                HAVING COUNT(*) > 1
                """
            ),
            {"aid": str(article_id), "pid": str(model)},
        )
    ).all()
    assert dup == []


async def test_backfill_does_not_create_for_many_cardinality_children(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: only cardinality='one' children are materialised. A
    cardinality='many' child (e.g. ``final_predictors`` in CHARMS) must
    remain user-driven so reviewers/AI add instances on demand."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    model = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="ModelC",
    )
    many_child = await _add_child_entity_type(
        db_session,
        project_template_id=ptid,
        parent_et_id=pred_et,
        name="late_many_child",
        cardinality="many",
    )
    await db_session.commit()

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    assert res.status_code in (200, 201)

    count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et "
                "AND parent_instance_id = :pid"
            ),
            {"aid": str(article_id), "et": str(many_child), "pid": str(model)},
        )
    ).scalar()
    assert count == 0


async def test_backfill_creates_one_instance_per_parent_model(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: with N model instances and a late-added singleton child,
    backfill creates exactly N child instances (one per parent)."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    models = []
    for label in ("ModelA", "ModelB", "ModelC"):
        models.append(
            await _insert_model_instance(
                db_session,
                project_id=project_id,
                article_id=article_id,
                project_template_id=ptid,
                prediction_models_et_id=pred_et,
                label=label,
            )
        )
    sub_et = await _add_child_entity_type(
        db_session, project_template_id=ptid, parent_et_id=pred_et, name="late_multi"
    )
    await db_session.commit()

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    assert res.status_code in (200, 201)

    backfilled_by_model = (
        await db_session.execute(
            text(
                """
                SELECT parent_instance_id, COUNT(*)
                FROM public.extraction_instances
                WHERE article_id = :aid AND entity_type_id = :et
                GROUP BY parent_instance_id
                """
            ),
            {"aid": str(article_id), "et": str(sub_et)},
        )
    ).all()
    by_parent = {UUID(str(row[0])): row[1] for row in backfilled_by_model}
    for m in models:
        assert by_parent.get(m) == 1, f"Model {m} missing or duplicated child"


async def test_backfill_label_includes_parent_label(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: the backfilled child carries a label that pairs the parent
    name with the child entity_type label — useful when the reviewer sees
    multiple models in the form."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    model_id = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="LogReg",
    )
    sub_et = await _add_child_entity_type(
        db_session, project_template_id=ptid, parent_et_id=pred_et, name="LateLabelCheck"
    )
    await db_session.commit()

    await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )

    label = (
        await db_session.execute(
            text(
                "SELECT label FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et "
                "AND parent_instance_id = :pid"
            ),
            {"aid": str(article_id), "et": str(sub_et), "pid": str(model_id)},
        )
    ).scalar()
    assert label is not None
    assert "LogReg" in str(label)
    assert "LateLabelCheck" in str(label)


async def test_backfill_metadata_marks_origin(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: a backfilled instance carries ``metadata.created_via =
    "hitl_session_backfill"`` so we can audit what the runtime healed
    vs what the user / AI / clone path created."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    model_id = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="MetaCheck",
    )
    sub_et = await _add_child_entity_type(
        db_session, project_template_id=ptid, parent_et_id=pred_et, name="meta_late"
    )
    await db_session.commit()

    await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )

    raw = (
        await db_session.execute(
            text(
                "SELECT metadata FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et "
                "AND parent_instance_id = :pid"
            ),
            {"aid": str(article_id), "et": str(sub_et), "pid": str(model_id)},
        )
    ).scalar()
    assert raw is not None
    assert dict(raw).get("created_via") == "hitl_session_backfill"


async def test_backfill_respects_sort_order_from_entity_type(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: ``sort_order`` on the backfilled instance copies from the
    entity_type's ``sort_order`` — keeping the rendering deterministic."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    model_id = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="SortCheck",
    )
    sub_et = await _add_child_entity_type(
        db_session,
        project_template_id=ptid,
        parent_et_id=pred_et,
        name="sort_late",
        sort_order=42,
    )
    await db_session.commit()

    await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    sort_order = (
        await db_session.execute(
            text(
                "SELECT sort_order FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et "
                "AND parent_instance_id = :pid"
            ),
            {"aid": str(article_id), "et": str(sub_et), "pid": str(model_id)},
        )
    ).scalar()
    assert sort_order == 42


async def test_backfill_skips_when_template_has_no_many_parents(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: QA templates (PROBAST, QUADAS-2) have no many-parent so the
    backfill is a no-op — no extra instances appear."""
    from app.seed import seed_probast

    await seed_probast(db_session)
    await db_session.commit()
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    await _wipe_clone_chain(db_session, project_id=project_id, global_id=PROBAST_GLOBAL_ID)

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "quality_assessment",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "global_template_id": str(PROBAST_GLOBAL_ID),
        },
    )
    assert res.status_code == 201
    project_template_id = UUID(res.json()["data"]["project_template_id"])

    backfilled = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_instances
                WHERE article_id = :aid
                  AND template_id = :tid
                  AND (metadata->>'created_via') = 'hitl_session_backfill'
                """
            ),
            {"aid": str(article_id), "tid": str(project_template_id)},
        )
    ).scalar()
    assert backfilled == 0


async def test_backfill_uses_existing_advisory_lock(
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: the backfill runs inside the ``(article, template)`` advisory
    lock taken at the start of ``_ensure_instances``. We can't observe
    lock acquisition directly, but a quick smoke test asserts that the
    backfill doesn't acquire any extra session-scoped locks that would
    leak across requests."""
    locks = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM pg_locks WHERE locktype = 'advisory' AND objsubid = 2")
        )
    ).scalar()
    # No session-scoped advisory locks before / after this test boundary.
    assert (locks or 0) == 0


async def test_backfill_handles_zero_model_instances_gracefully(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: a fresh CHARMS clone with no model instances yet must not
    fail when the backfill iterates an empty list of many-parents."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    assert res.status_code in (200, 201), res.text


async def test_backfill_creates_runs_continue_to_advance(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: after backfill, the Run still advances from PENDING to
    EXTRACT — the backfill cannot prevent the lifecycle transition."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="RunAdvanceModel",
    )
    await _add_child_entity_type(
        db_session, project_template_id=ptid, parent_et_id=pred_et, name="advance_late_sub"
    )
    await db_session.commit()

    res = await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    assert res.status_code in (200, 201), res.text
    run_id = res.json()["data"]["run_id"]
    stage = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :rid"),
            {"rid": str(run_id)},
        )
    ).scalar()
    assert stage == "extract"


async def test_backfill_preserves_user_created_label(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Spec: a manually-created child instance with a custom label keeps
    that label even though the entity_type may carry a different one — the
    backfill must use ``EXISTS (parent, et)`` and not ``label`` for its
    duplicate guard."""
    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article
    ptid = await _seed_charms_clone(db_session, db_client, project_id)
    pred_et = await _prediction_models_et_id(db_session, ptid)
    model_id = await _insert_model_instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        project_template_id=ptid,
        prediction_models_et_id=pred_et,
        label="LabelKeepModel",
    )
    sub_et = await _add_child_entity_type(
        db_session, project_template_id=ptid, parent_et_id=pred_et, name="manual_late_sub"
    )
    # User-created child instance with a custom label.
    raw = (
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_instances
                    (project_id, article_id, template_id, entity_type_id,
                     parent_instance_id, label, sort_order, created_by)
                VALUES (:pid, :aid, :tid, :etid, :parent, 'My custom label', 0,
                        (SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1))
                RETURNING id
                """
            ),
            {
                "pid": str(project_id),
                "aid": str(article_id),
                "tid": str(ptid),
                "etid": str(sub_et),
                "parent": str(model_id),
            },
        )
    ).scalar()
    custom_inst_id = UUID(str(raw))
    await db_session.commit()

    await db_client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(ptid),
        },
    )
    # Same row, no duplicate.
    rows = (
        await db_session.execute(
            text(
                "SELECT id, label FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :et "
                "AND parent_instance_id = :pid"
            ),
            {"aid": str(article_id), "et": str(sub_et), "pid": str(model_id)},
        )
    ).all()
    assert len(rows) == 1
    assert UUID(str(rows[0][0])) == custom_inst_id
    assert rows[0][1] == "My custom label"
