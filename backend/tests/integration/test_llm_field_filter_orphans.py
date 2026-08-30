"""An exclusion coordinate no live field answers to must be reported.

The derived spec names the assessor-owned fields the model must never see. It
is live JSON, and so are the field names it points at, so renaming a field in
the template editor orphans the pointer — and an orphaned pointer silently
re-opens a judgment to the model. That is asked here, once per run against the
whole live tree, because it has no answer anywhere else: the run view and the
export both check the spec against the FROZEN snapshot, where the old name
still resolves.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.services.llm_field_filter import build_llm_field_filter
from app.services.run_lifecycle_service import RunLifecycleService
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED

_SECTION = "dev_d1_participants"


def _spec(judgment_field: str) -> dict:
    return {
        "derived_judgments": [
            {
                "id": "dev_d1_quality",
                "label": "Development D1: quality",
                "rule": "signaling_worst",
                "target": {"section": _SECTION, "field": judgment_field},
                "rationale": {"section": _SECTION, "field": "quality_concern_rationale"},
                "inputs": [{"section": _SECTION, "field": "q1"}],
            }
        ]
    }


async def _qa_run(db: AsyncSession, spec: dict) -> tuple[UUID, UUID] | None:
    """A QA run whose template declares *spec* over a live three-field section."""
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
        name=f"qa-orphan-{uuid4().hex[:8]}", kind="quality_assessment", is_active=True
    )
    et_id = await factory.add_study_section(template_id, name=_SECTION)
    for order, name in enumerate(("q1", "quality_concern", "quality_concern_rationale")):
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
                "VALUES (:id, :etid, :n, :n, 'select', false, :so)"
            ),
            {"id": str(uuid4()), "etid": str(et_id), "n": name, "so": order},
        )
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates SET schema = CAST(:s AS jsonb) "
            "WHERE id = :tid"
        ),
        {"s": json.dumps(spec), "tid": str(template_id)},
    )
    await db.flush()

    run = await RunLifecycleService(db).create_run(
        project_id=UUID(str(project_id)),
        article_id=UUID(str(article_id)),
        project_template_id=template_id,
        user_id=UUID(str(user_id)),
    )
    return run.id, UUID(str(user_id))


async def _warnings_while_building(db: AsyncSession, run_id: UUID) -> list:
    """The dangling-ref warnings emitted while resolving *run_id*'s filter."""
    run = await db.get(ExtractionRun, run_id)
    with patch("app.services.llm_field_filter.logger", MagicMock()) as log:
        await build_llm_field_filter(db, run)
    return [
        c for c in log.warning.call_args_list if c.args[:1] == ("qa_derived_spec_dangling_ref",)
    ]


async def test_orphaned_exclusion_is_reported(db_session: AsyncSession) -> None:
    built = await _qa_run(db_session, _spec("risk_of_bias"))  # no such live field
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, _ = built

    warned = await _warnings_while_building(db_session, run_id)
    assert warned, "expected a qa_derived_spec_dangling_ref for the renamed target"
    assert warned[0].kwargs["coordinates"] == [(_SECTION, "risk_of_bias")]
    await db_session.rollback()


async def test_a_resolvable_spec_is_silent(db_session: AsyncSession) -> None:
    """The control that makes the test above mean something.

    Both of PROBAST+AI's exclusion sources overlap by construction — the scope
    rules exclude the very sections whose judgments the spec owns — and the
    per-section version of this check read that overlap as a rename, warning
    about every assessor-owned coordinate on any development-only run.
    """
    built = await _qa_run(db_session, _spec("quality_concern"))  # resolves live
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, _ = built

    assert await _warnings_while_building(db_session, run_id) == []
    await db_session.rollback()


async def test_the_filter_still_excludes_the_resolvable_coordinates(
    db_session: AsyncSession,
) -> None:
    """Fail-open is about the WARNING, not the filter: a live coordinate is
    still withheld from the model."""
    built = await _qa_run(db_session, _spec("quality_concern"))
    if built is None:
        pytest.skip("Missing fixtures.")
    run_id, _ = built

    run = await db_session.get(ExtractionRun, run_id)
    flt = await build_llm_field_filter(db_session, run)
    assert (_SECTION, "quality_concern") in flt.excluded_coordinates
    assert (_SECTION, "quality_concern_rationale") in flt.excluded_coordinates
    await db_session.rollback()
