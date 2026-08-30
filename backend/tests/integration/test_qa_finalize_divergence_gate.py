"""The finalize backstop, end to end against a real run.

The rule itself is unit-tested (``tests/unit/test_qa_divergence_gate.py``).
What only a real run can prove is the ASSEMBLY: that the gate resolves the
target's instance and sees the PUBLISHED states — inputs the unit tests hand
it ready-made.

It does NOT prove the tree is read frozen rather than live: the factory's
version carries an empty snapshot, so ``entity_types_for_version`` takes its
live fallback and the two are the same rows here. That split is covered in
``test_pinned_entity_types_provider.py``.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionConsensusMode
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.run_lifecycle_service import (
    DivergenceRationaleError,
    InvalidStageTransitionError,
    RunLifecycleService,
)
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED

_SECTION = "dev_d1_participants"
_LABEL = "Development D1: quality"
_SPEC: dict[str, Any] = {
    "derived_judgments": [
        {
            "id": "dev_d1_quality",
            "label": _LABEL,
            "rule": "signaling_worst",
            "target": {"section": _SECTION, "field": "quality_concern"},
            "rationale": {"section": _SECTION, "field": "quality_concern_rationale"},
            "inputs": [{"section": _SECTION, "field": "q1"}],
        }
    ]
}


class _Built:
    def __init__(self, run_id: UUID, instance_id: UUID, user_id: UUID, **fields: UUID) -> None:
        self.run_id = run_id
        self.instance_id = instance_id
        self.user_id = user_id
        self.fields = fields


async def _qa_run_with_derived_spec(db: AsyncSession) -> _Built | None:
    """A QA run at CONSENSUS whose template declares one recommendation."""
    project_id = (
        await db.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    user_id = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if not all((project_id, article_id, user_id)):
        return None

    factory = TemplateFactory(db, UUID(str(project_id)), UUID(str(user_id)))
    template_id = await factory.create(
        name=f"qa-derived-{uuid4().hex[:8]}", kind="quality_assessment", is_active=True
    )
    et_id = await factory.add_study_section(template_id, name=_SECTION)

    field_ids: dict[str, UUID] = {}
    for order, (name, ftype) in enumerate(
        (("q1", "select"), ("quality_concern", "select"), ("quality_concern_rationale", "text"))
    ):
        field_ids[name] = uuid4()
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
                "VALUES (:id, :etid, :n, :n, :ft, false, :so)"
            ),
            {"id": str(field_ids[name]), "etid": str(et_id), "n": name, "ft": ftype, "so": order},
        )
    # The scope/derivation consumers all read the LIVE schema column.
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates SET schema = CAST(:s AS jsonb) "
            "WHERE id = :tid"
        ),
        {"s": json.dumps(_SPEC), "tid": str(template_id)},
    )

    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, label, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, 'D1', :uid)"
        ),
        {
            "id": str(instance_id),
            "pid": str(project_id),
            "tid": str(template_id),
            "etid": str(et_id),
            "aid": str(article_id),
            "uid": str(user_id),
        },
    )
    await db.flush()

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=UUID(str(project_id)),
        article_id=UUID(str(article_id)),
        project_template_id=template_id,
        user_id=UUID(str(user_id)),
    )
    for stage in (ExtractionRunStage.EXTRACT, ExtractionRunStage.CONSENSUS):
        await lifecycle.advance_stage(run_id=run.id, target_stage=stage, user_id=UUID(str(user_id)))
    return _Built(run.id, instance_id, UUID(str(user_id)), **field_ids)


async def _publish(db: AsyncSession, built: _Built, field: str, value: Any) -> None:
    await ExtractionConsensusService(db).record_consensus(
        run_id=built.run_id,
        instance_id=built.instance_id,
        field_id=built.fields[field],
        consensus_user_id=built.user_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": value},
        rationale="test",
    )


async def test_diverged_judgment_without_rationale_blocks_finalize(
    db_session: AsyncSession,
) -> None:
    built = await _qa_run_with_derived_spec(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")

    # "PY" derives a Low default; the manager published High over it.
    await _publish(db_session, built, "q1", "PY")
    await _publish(db_session, built, "quality_concern", "High")

    svc = RunLifecycleService(db_session)
    with pytest.raises(DivergenceRationaleError) as excinfo:
        await svc.advance_stage(
            run_id=built.run_id,
            target_stage=ExtractionRunStage.FINALIZED,
            user_id=built.user_id,
        )
    # The refusal must name the coordinate and where to fix it, or a manager
    # at the last action of the workflow has nowhere to go.
    assert _LABEL in str(excinfo.value)
    assert "Resolve divergence" in str(excinfo.value)
    # The 400 rests on this inheritance: the endpoint handler catches the base
    # class (proven at test_extraction_runs_endpoints.py), so reparenting this
    # subclass would silently turn the refusal into an unhandled 500.
    assert issubclass(DivergenceRationaleError, InvalidStageTransitionError)

    stage = (
        await db_session.execute(
            text("SELECT stage FROM public.extraction_runs WHERE id = :r"),
            {"r": str(built.run_id)},
        )
    ).scalar()
    assert stage == ExtractionRunStage.CONSENSUS.value
    await db_session.rollback()


async def test_publishing_the_rationale_unblocks_finalize(db_session: AsyncSession) -> None:
    built = await _qa_run_with_derived_spec(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")

    await _publish(db_session, built, "q1", "PY")
    await _publish(db_session, built, "quality_concern", "High")
    await _publish(
        db_session, built, "quality_concern_rationale", "Sample too small to trust the answer."
    )

    finalized = await RunLifecycleService(db_session).advance_stage(
        run_id=built.run_id, target_stage=ExtractionRunStage.FINALIZED, user_id=built.user_id
    )
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    await db_session.rollback()


async def test_agreeing_with_the_derived_default_finalizes(db_session: AsyncSession) -> None:
    built = await _qa_run_with_derived_spec(db_session)
    if built is None:
        pytest.skip("Missing fixtures.")

    await _publish(db_session, built, "q1", "PY")
    await _publish(db_session, built, "quality_concern", "Low")

    finalized = await RunLifecycleService(db_session).advance_stage(
        run_id=built.run_id, target_stage=ExtractionRunStage.FINALIZED, user_id=built.user_id
    )
    assert finalized.stage == ExtractionRunStage.FINALIZED.value
    await db_session.rollback()
