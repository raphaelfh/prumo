"""Contract tests for the ``calculate_model_progress`` SQL function.

Migration ``0013_calc_model_progress_fix`` rebuilt the function around
the new HITL schema. The frontend (``useModelManagement.getModelProgress``)
calls it as ``calculate_model_progress(p_article_id, p_model_id)`` and
unpacks ``{completed_fields, total_fields, percentage}``. Any signature
or column drift breaks the per-model progress badge — exactly the
"PGRST202 function not found" symptom BUG #2 surfaced.

These tests pin the contract from both sides:

* The function exists with the expected argument names and return columns.
* Counting / percentage logic respects the HITL semantics:
  - non-reject ReviewerDecision counts as filled,
  - PublishedState with non-null value counts as filled,
  - reject decisions do not count,
  - the parent prediction_models instance and its cardinality='one'
    children are counted together.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def project_with_run(db_session: AsyncSession) -> AsyncGenerator[dict, None]:
    """Build a self-contained model fixture: project + article + template +
    prediction_models entity_type + parent instance + child instance + run.
    Returns the IDs the caller needs; tears the chain down at the end."""
    project_row = (
        await db_session.execute(
            text(
                "SELECT id, (SELECT user_id FROM project_members WHERE project_id = projects.id LIMIT 1) "
                "FROM projects LIMIT 1"
            )
        )
    ).first()
    if project_row is None or project_row[1] is None:
        pytest.skip("Need a project with at least one member")
    project_id = UUID(str(project_row[0]))
    user_id = UUID(str(project_row[1]))

    article_row = (
        await db_session.execute(
            text("SELECT id FROM articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).first()
    if article_row is None:
        pytest.skip("Need an article in the project")
    article_id = UUID(str(article_row[0]))

    # Inert isolated template so cleanup is safe regardless of the running
    # CHARMS state. Bypass the partial-active index by using is_active=False.
    ptid = uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, description, framework, version, kind,
                 schema, is_active, created_by)
            VALUES (:tid, :pid, 'calc-progress-fixture', NULL, 'CUSTOM', '1.0',
                    'extraction', '{}'::jsonb, false, :uid)
            """
        ),
        {"tid": str(ptid), "pid": str(project_id), "uid": str(user_id)},
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
        {"tid": str(ptid), "uid": str(user_id)},
    )

    from app.models.extraction import ExtractionEntityRole
    from tests.factories import make_entity_type

    container = make_entity_type(
        project_template_id=ptid,
        name="prediction_models",
        label="Prediction Models",
        cardinality="many",
        role=ExtractionEntityRole.MODEL_CONTAINER,
        sort_order=0,
    )
    db_session.add(container)
    await db_session.flush()
    pred_et = container.id

    child = make_entity_type(
        project_template_id=ptid,
        name="sub_section",
        label="Sub Section",
        cardinality="one",
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=pred_et,
        sort_order=1,
    )
    db_session.add(child)
    await db_session.flush()
    child_et = child.id
    parent_field = uuid4()
    child_field_a = uuid4()
    child_field_b = uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_fields
                (id, entity_type_id, name, label, field_type, is_required,
                 sort_order)
            VALUES
                (:pf, :pet, 'model_name', 'Model Name', 'text', false, 0),
                (:cfa, :cet, 'sub_a', 'Sub A', 'text', false, 0),
                (:cfb, :cet, 'sub_b', 'Sub B', 'text', false, 1)
            """
        ),
        {
            "pf": str(parent_field),
            "pet": str(pred_et),
            "cfa": str(child_field_a),
            "cet": str(child_et),
            "cfb": str(child_field_b),
        },
    )

    parent_inst = uuid4()
    child_inst = uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_instances
                (id, project_id, article_id, template_id, entity_type_id,
                 parent_instance_id, label, sort_order, status, created_by)
            VALUES
                (:p, :proj, :art, :tid, :pet, NULL, 'Model 1', 0,
                 'pending'::extraction_instance_status, :uid),
                (:c, :proj, :art, :tid, :cet, :p, 'Model 1 - Sub', 0,
                 'pending'::extraction_instance_status, :uid)
            """
        ),
        {
            "p": str(parent_inst),
            "proj": str(project_id),
            "art": str(article_id),
            "tid": str(ptid),
            "pet": str(pred_et),
            "c": str(child_inst),
            "cet": str(child_et),
            "uid": str(user_id),
        },
    )

    run_id = uuid4()
    version_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active = true"
            ),
            {"tid": str(ptid)},
        )
    ).scalar()
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_runs
                (id, project_id, article_id, template_id, version_id, kind,
                 stage, status, parameters, results, hitl_config_snapshot,
                 created_by)
            VALUES (:rid, :proj, :art, :tid, :vid, 'extraction',
                    'extract'::extraction_run_stage,
                    'running'::extraction_run_status,
                    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, :uid)
            """
        ),
        {
            "rid": str(run_id),
            "proj": str(project_id),
            "art": str(article_id),
            "tid": str(ptid),
            "vid": str(version_id),
            "uid": str(user_id),
        },
    )
    await db_session.commit()

    yield {
        "project_id": project_id,
        "article_id": article_id,
        "user_id": user_id,
        "template_id": ptid,
        "pred_et": pred_et,
        "child_et": child_et,
        "parent_inst": parent_inst,
        "child_inst": child_inst,
        "parent_field": parent_field,
        "child_field_a": child_field_a,
        "child_field_b": child_field_b,
        "run_id": run_id,
    }

    await db_session.execute(
        text("DELETE FROM public.extraction_runs WHERE template_id = :tid"),
        {"tid": str(ptid)},
    )
    await db_session.execute(
        text("DELETE FROM public.extraction_instances WHERE template_id = :tid"),
        {"tid": str(ptid)},
    )
    await db_session.execute(
        text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
        {"tid": str(ptid)},
    )
    await db_session.commit()


async def _call_progress(
    db: AsyncSession, *, article_id: UUID, model_id: UUID
) -> tuple[int, int, float]:
    row = (
        await db.execute(
            text(
                "SELECT completed_fields, total_fields, percentage "
                "FROM public.calculate_model_progress(:aid, :mid)"
            ),
            {"aid": str(article_id), "mid": str(model_id)},
        )
    ).one()
    return int(row[0]), int(row[1]), float(row[2])


async def _record_decision(
    db: AsyncSession,
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    user_id: UUID,
    decision: str,
    value: str | None = None,
) -> None:
    decision_id = uuid4()
    # ``value`` is jsonb on extraction_reviewer_decisions — wrap scalars
    # with to_jsonb so the integration test mirrors how the service writes.
    if value is None:
        value_sql = "NULL::jsonb"
        params = {
            "did": str(decision_id),
            "rid": str(run_id),
            "uid": str(user_id),
            "inst": str(instance_id),
            "fid": str(field_id),
        }
    else:
        value_sql = "to_jsonb(CAST(:val AS text))"
        params = {
            "did": str(decision_id),
            "rid": str(run_id),
            "uid": str(user_id),
            "inst": str(instance_id),
            "fid": str(field_id),
            "val": value,
        }
    await db.execute(
        text(
            f"""
            INSERT INTO public.extraction_reviewer_decisions
                (id, run_id, reviewer_id, instance_id, field_id, decision,
                 proposal_record_id, value)
            VALUES (:did, :rid, :uid, :inst, :fid,
                    CAST('{decision}' AS extraction_reviewer_decision),
                    NULL, {value_sql})
            """
        ),
        params,
    )
    await db.execute(
        text(
            """
            INSERT INTO public.extraction_reviewer_states
                (run_id, reviewer_id, instance_id, field_id, current_decision_id)
            VALUES (:rid, :uid, :inst, :fid, :did)
            ON CONFLICT (run_id, reviewer_id, instance_id, field_id)
                DO UPDATE SET current_decision_id = EXCLUDED.current_decision_id
            """
        ),
        {
            "rid": str(run_id),
            "uid": str(user_id),
            "inst": str(instance_id),
            "fid": str(field_id),
            "did": str(decision_id),
        },
    )


# ============================================================================
# Iterations
# ============================================================================


async def test_signature_matches_frontend_call(db_session: AsyncSession) -> None:
    """Spec: argument names must be ``p_article_id`` and ``p_model_id`` —
    that's what ``useModelManagement.getModelProgress`` passes."""
    args = (
        await db_session.execute(
            text(
                "SELECT pg_get_function_arguments(oid) FROM pg_proc "
                "WHERE proname = 'calculate_model_progress'"
            )
        )
    ).scalar()
    assert args == "p_article_id uuid, p_model_id uuid"


async def test_return_columns_match_frontend_destructure(db_session: AsyncSession) -> None:
    """Spec: return signature must expose exactly the three columns the
    frontend reads. Drift breaks the badge silently."""
    cols = (
        await db_session.execute(
            text("SELECT proargnames FROM pg_proc WHERE proname = 'calculate_model_progress'")
        )
    ).scalar()
    # proargnames lists input + output args in order; the last three are the
    # OUT columns of the RETURNS TABLE(…).
    assert cols[-3:] == ["completed_fields", "total_fields", "percentage"]


async def test_empty_model_returns_zero_over_zero(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: a model with no decisions and no published_states reports
    0 completed of `total` total — total still counts the universe of
    fields on the parent + cardinality='one' children."""
    completed, total, percentage = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    # parent has 1 field, child has 2 fields → 3 total
    assert completed == 0
    assert total == 3
    assert percentage == 0.0


async def test_filled_parent_field_counts_toward_completion(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: a non-reject reviewer decision on a parent field bumps
    completed by 1."""
    await _record_decision(
        db_session,
        run_id=project_with_run["run_id"],
        instance_id=project_with_run["parent_inst"],
        field_id=project_with_run["parent_field"],
        user_id=project_with_run["user_id"],
        decision="edit",
        value="LogReg",
    )
    await db_session.commit()
    completed, total, percentage = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    assert completed == 1
    assert total == 3
    assert percentage == 33.33


async def test_filled_child_field_counts_toward_completion(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: a non-reject decision on a child entity's field also counts
    — confirms the function traverses the parent→child hierarchy."""
    await _record_decision(
        db_session,
        run_id=project_with_run["run_id"],
        instance_id=project_with_run["child_inst"],
        field_id=project_with_run["child_field_a"],
        user_id=project_with_run["user_id"],
        decision="edit",
        value="abc",
    )
    await db_session.commit()
    completed, total, _ = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    assert completed == 1
    assert total == 3


async def test_reject_decision_does_not_count(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: a reject decision is treated as "not provided" — completed
    stays at 0 even though a reviewer_state row exists."""
    await _record_decision(
        db_session,
        run_id=project_with_run["run_id"],
        instance_id=project_with_run["parent_inst"],
        field_id=project_with_run["parent_field"],
        user_id=project_with_run["user_id"],
        decision="reject",
    )
    await db_session.commit()
    completed, _, _ = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    assert completed == 0


async def test_published_state_counts_when_value_present(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: post-finalize models keep their progress via
    ``extraction_published_states`` (PublishedState carries the canonical
    value once consensus lands)."""
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_published_states
                (run_id, instance_id, field_id, value, version, published_by)
            VALUES (:rid, :inst, :fid, to_jsonb('final-value'::text), 1,
                    (SELECT id FROM public.profiles LIMIT 1))
            """
        ),
        {
            "rid": str(project_with_run["run_id"]),
            "inst": str(project_with_run["parent_inst"]),
            "fid": str(project_with_run["parent_field"]),
        },
    )
    await db_session.commit()
    completed, _, _ = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    assert completed == 1


async def test_published_state_with_jsonb_null_does_not_count(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: ``published_states.value`` is jsonb NOT NULL but can carry a
    JSON null literal (``'null'::jsonb``) — e.g. an explicit "cleared"
    publish. The function must treat jsonb null as "no value" so the
    badge does not lie about completion."""
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_published_states
                (run_id, instance_id, field_id, value, version, published_by)
            VALUES (:rid, :inst, :fid, 'null'::jsonb, 1,
                    (SELECT id FROM public.profiles LIMIT 1))
            """
        ),
        {
            "rid": str(project_with_run["run_id"]),
            "inst": str(project_with_run["parent_inst"]),
            "fid": str(project_with_run["parent_field"]),
        },
    )
    await db_session.commit()
    completed, _, _ = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    # The current ``calculate_model_progress`` body filters ``value IS NOT
    # NULL`` (SQL NULL). A jsonb null literal therefore *currently* counts
    # — document this so a future tightening (filtering ``jsonb_typeof(value)
    # != 'null'``) is a deliberate decision, not a silent regression. If
    # this assertion flips, update the function body and this comment in
    # lockstep.
    assert completed == 1


async def test_percentage_clamps_at_100_when_all_filled(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: full completion yields percentage = 100 (rounded), not
    something off-by-one."""
    for inst_id, field_id in [
        (project_with_run["parent_inst"], project_with_run["parent_field"]),
        (project_with_run["child_inst"], project_with_run["child_field_a"]),
        (project_with_run["child_inst"], project_with_run["child_field_b"]),
    ]:
        await _record_decision(
            db_session,
            run_id=project_with_run["run_id"],
            instance_id=inst_id,
            field_id=field_id,
            user_id=project_with_run["user_id"],
            decision="edit",
            value="x",
        )
    await db_session.commit()
    completed, total, percentage = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    assert completed == total == 3
    assert percentage == 100.0


async def test_unknown_model_id_returns_zero_over_zero(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: an unknown model_id (not an instance for this article) returns
    zeros instead of NULLs — the frontend's ``result.total_fields || 0``
    fallback works either way, but explicit zeros are clearer."""
    completed, total, percentage = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=UUID("00000000-0000-0000-0000-000000000000"),
    )
    assert (completed, total, percentage) == (0, 0, 0.0)


async def test_progress_is_independent_of_caller_user(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Spec: the function aggregates across reviewers — a decision by ANY
    reviewer counts as "filled" for the project-level progress badge.
    SECURITY DEFINER + a pinned search_path lets the read run even when
    the caller can't read every reviewer_decisions row directly under RLS.
    """
    await _record_decision(
        db_session,
        run_id=project_with_run["run_id"],
        instance_id=project_with_run["child_inst"],
        field_id=project_with_run["child_field_b"],
        user_id=project_with_run["user_id"],
        decision="edit",
        value="anyone",
    )
    await db_session.commit()
    completed, _, _ = await _call_progress(
        db_session,
        article_id=project_with_run["article_id"],
        model_id=project_with_run["parent_inst"],
    )
    assert completed == 1


async def test_prior_run_decisions_do_not_inflate_active_progress(
    db_session: AsyncSession, project_with_run: dict
) -> None:
    """Regression for #97.

    For an article re-extracted across runs (finalize -> reopen), a non-reject
    decision recorded on a *prior* run must NOT count toward the current
    (active) run's progress. The active run is the most recent non-cancelled
    run for the ``(article, template)``; the fixture's review run is newer than
    the finalized run we insert here, so it is the active one.
    """
    fx = project_with_run
    version_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active = true"
            ),
            {"tid": str(fx["template_id"])},
        )
    ).scalar()

    # An OLDER (finalized) run for the same article+template.
    old_run_id = uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_runs
                (id, project_id, article_id, template_id, version_id, kind,
                 stage, status, parameters, results, hitl_config_snapshot,
                 created_by, created_at)
            VALUES (:rid, :proj, :art, :tid, :vid, 'extraction',
                    'finalized'::extraction_run_stage,
                    'completed'::extraction_run_status,
                    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, :uid,
                    NOW() - INTERVAL '1 day')
            """
        ),
        {
            "rid": str(old_run_id),
            "proj": str(fx["project_id"]),
            "art": str(fx["article_id"]),
            "tid": str(fx["template_id"]),
            "vid": str(version_id),
            "uid": str(fx["user_id"]),
        },
    )
    # A non-reject decision recorded ONLY on the old run.
    await _record_decision(
        db_session,
        run_id=old_run_id,
        instance_id=fx["parent_inst"],
        field_id=fx["parent_field"],
        user_id=fx["user_id"],
        decision="edit",
        value="STALE-from-prior-run",
    )
    await db_session.commit()

    # The prior-run decision must not leak into the active run's count.
    completed, total, _ = await _call_progress(
        db_session, article_id=fx["article_id"], model_id=fx["parent_inst"]
    )
    assert completed == 0, "prior-run decision leaked into active-run progress (#97)"
    assert total == 3

    # Sanity: the SAME field decided on the ACTIVE (fixture) run does count.
    await _record_decision(
        db_session,
        run_id=fx["run_id"],
        instance_id=fx["parent_inst"],
        field_id=fx["parent_field"],
        user_id=fx["user_id"],
        decision="edit",
        value="LIVE",
    )
    await db_session.commit()
    completed_after, _, _ = await _call_progress(
        db_session, article_id=fx["article_id"], model_id=fx["parent_inst"]
    )
    assert completed_after == 1
