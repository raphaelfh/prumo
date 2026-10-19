"""A run evaluates the QA rules frozen in the template version it is pinned to.

Each case pins a PROBAST+AI run to a version holding the seeded rules
(RULES_OLD), then rewrites the template's LIVE ``schema`` to RULES_NEW — a
different study-type scope and one recommendation dropped — and proves the
reader still computes from RULES_OLD: the run view, the finalize divergence
gate, the AI field filter, the AI landing gate and the export (which groups
each article's rules by its own run's version).
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionRun,
    ExtractionRunStage,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.models.extraction_workflow import ExtractionConsensusMode
from app.seed_probast_ai import _PROBAST_AI_TEMPLATE_ID
from app.services.ai_extraction import ProposalLanding
from app.services.exports.extraction_scope_marking import NOT_APPLICABLE
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_export_service import (
    ExportLayout,
    ExportMode,
    ExtractionExportService,
)
from app.services.extraction_run_read_service import build_run_view
from app.services.extraction_snapshot import pinned_template_rules
from app.services.llm_field_filter import build_llm_field_filter, llm_field_filter_of
from app.services.qa_divergence_gate import divergence_rationale_failure
from app.services.run_lifecycle_service import RunLifecycleService
from app.services.template_versioning import (
    PendingConfigDraftError,
    TemplateVersionService,
    clone_template,
)
from tests.integration.conftest import SEED, set_config_draft_marker
from tests.integration.helpers.batch_fixtures import make_article
from tests.integration.helpers.engine_setup import run_in_extract_at

pytestmark = pytest.mark.asyncio

_DROPPED = "dev_d1_quality"
_SECTION = "dev_d1_participants"


@dataclass
class _Pinned:
    run: ExtractionRun
    template_id: UUID
    rules_old: dict[str, Any]
    rules_new: dict[str, Any]


def _rules_new(rules_old: dict[str, Any]) -> dict[str, Any]:
    """RULES_OLD with the development-only scope swapped and one judgment gone."""
    new = copy.deepcopy(rules_old)
    excludes = new["scope_rules"]["excludes"]
    excludes["development_only"], excludes["evaluation_only"] = (
        excludes["evaluation_only"],
        excludes["development_only"],
    )
    new["derived_judgments"] = [j for j in new["derived_judgments"] if j["id"] != _DROPPED]
    return new


async def _reimport(db: AsyncSession) -> Any:
    return await clone_template(
        db,
        project_id=SEED.primary_project,
        global_template_id=_PROBAST_AI_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )


async def _run_on_v1(db: AsyncSession) -> tuple[_Pinned, dict[str, Any]]:
    """A run pinned to a version holding the seeded rules; live schema untouched."""
    clone = await _reimport(db)
    tid = clone.project_template_id
    live = (
        await db.execute(
            text("SELECT schema FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(tid)},
        )
    ).scalar_one()
    rules_old = {k: live[k] for k in ("derived_judgments", "scope_rules")}
    assert any(j["id"] == _DROPPED for j in rules_old["derived_judgments"])

    run = await run_in_extract_at(
        db, project_id=SEED.primary_project, article_id=SEED.primary_article, template_id=tid
    )
    # Precondition: the pinned version froze RULES_OLD.
    assert (await pinned_template_rules(db, [run.version_id]))[run.version_id] == rules_old

    return _Pinned(run, tid, rules_old, _rules_new(rules_old)), live


async def _pinned_qa_run(db: AsyncSession) -> _Pinned:
    pinned, live = await _run_on_v1(db)
    tid, rules_new = pinned.template_id, pinned.rules_new
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates SET schema = CAST(:r2 AS jsonb) "
            "WHERE id = :tid"
        ),
        {"r2": json.dumps({**live, **rules_new}), "tid": str(tid)},
    )
    await db.flush()
    return pinned


async def test_run_view_uses_pinned_rules(db_session: AsyncSession) -> None:
    pinned = await _pinned_qa_run(db_session)

    view = await build_run_view(
        db_session, pinned.run.id, caller_id=SEED.primary_profile, can_see_peers=True
    )

    assert view.scope_rules == pinned.rules_old["scope_rules"]
    assert view.scope_rules != pinned.rules_new["scope_rules"]
    assert _DROPPED in {j.id for j in view.derived_judgments}
    assert {j.id for j in view.derived_judgments} == {
        j["id"] for j in pinned.rules_old["derived_judgments"]
    }


async def _field_id(
    db: AsyncSession, template_id: UUID, field: str, section: str = _SECTION
) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT f.id FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid AND et.name = :s AND f.name = :f"
            ),
            {"tid": str(template_id), "s": section, "f": field},
        )
    ).scalar_one()


async def _section_instance(db: AsyncSession, run: ExtractionRun, section: str = _SECTION) -> UUID:
    et_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND name = :s"
            ),
            {"tid": str(run.template_id), "s": section},
        )
    ).scalar_one()
    existing = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_instances WHERE article_id = :aid "
                "AND template_id = :tid AND entity_type_id = :etid LIMIT 1"
            ),
            {"aid": str(run.article_id), "tid": str(run.template_id), "etid": str(et_id)},
        )
    ).scalar()
    if existing is not None:
        return existing
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, label, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, 'D1', :uid)"
        ),
        {
            "id": str(instance_id),
            "pid": str(run.project_id),
            "tid": str(run.template_id),
            "etid": str(et_id),
            "aid": str(run.article_id),
            "uid": str(SEED.primary_profile),
        },
    )
    return instance_id


async def test_finalize_gate_uses_pinned_rules(db_session: AsyncSession) -> None:
    pinned = await _pinned_qa_run(db_session)
    run = await RunLifecycleService(db_session).advance_stage(
        run_id=pinned.run.id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=SEED.primary_profile,
    )
    instance_id = await _section_instance(db_session, run)
    consensus = ExtractionConsensusService(db_session)
    # Every signaling answer "PY" derives Low; High published over it with no
    # rationale is a divergence only RULES_OLD (which keeps the judgment) sees.
    for field, value in (
        ("q1_appropriate_data_sources", "PY"),
        ("q2_appropriate_study_design", "PY"),
        ("q3_representative_dataset", "PY"),
        ("quality_concern", "High"),
    ):
        await consensus.record_consensus(
            run_id=run.id,
            instance_id=instance_id,
            field_id=await _field_id(db_session, pinned.template_id, field),
            consensus_user_id=SEED.primary_profile,
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"value": value},
            rationale="test",
        )

    failure = await divergence_rationale_failure(db_session, run)

    assert failure is not None
    assert "Resolve divergence" in failure


async def test_llm_field_filter_uses_pinned_rules(db_session: AsyncSession) -> None:
    pinned = await _pinned_qa_run(db_session)

    field_filter = await build_llm_field_filter(db_session, pinned.run)

    assert field_filter == llm_field_filter_of(pinned.rules_old)
    assert field_filter != llm_field_filter_of(pinned.rules_new)
    assert (_SECTION, "quality_concern") in field_filter.excluded_coordinates


async def test_landing_gate_uses_pinned_rules(db_session: AsyncSession) -> None:
    pinned = await _pinned_qa_run(db_session)
    landing = ProposalLanding(db_session, user_id=str(SEED.primary_profile), trace_id="frozen")

    _, field_filter = await landing._gate(pinned.run.id, None)

    assert field_filter == llm_field_filter_of(pinned.rules_old)
    assert field_filter != llm_field_filter_of(pinned.rules_new)


async def test_pinned_template_rules_shape(db_session: AsyncSession) -> None:
    """A version without rules maps to {}; an unknown id is absent."""
    plain_version = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    unknown = uuid4()

    rules = await pinned_template_rules(db_session, [plain_version, unknown])

    assert rules == {plain_version: {}}


# A development-only study: RULES_OLD takes the evaluation domains out of play,
# RULES_NEW (scope swapped) the development ones.
_STUDY_TYPE = ("assessment_scope", "study_type", "development_only")
_DEV = ("dev_d1_participants", "quality_concern", "High")
_EVAL = ("eval_d1_participants", "risk_of_bias", "High")
_DEV_OVERALL = "Overall quality (development)"
_EVAL_OVERALL = "Overall risk of bias (evaluation)"


async def _to_consensus_with_answers(
    db: AsyncSession, run: ExtractionRun, template_id: UUID
) -> ExtractionRun:
    """Advance *run* to CONSENSUS and publish the study type + one answer per side."""
    run = await RunLifecycleService(db).advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )
    consensus = ExtractionConsensusService(db)
    for section, field, value in (_STUDY_TYPE, _DEV, _EVAL):
        await consensus.record_consensus(
            run_id=run.id,
            instance_id=await _section_instance(db, run, section),
            field_id=await _field_id(db, template_id, field, section),
            consensus_user_id=SEED.primary_profile,
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"value": value},
            rationale="test",
        )
    return run


async def _export(db: AsyncSession, template_id: UUID, article_ids: list[UUID]) -> ExportLayout:
    return await ExtractionExportService(
        db=db, user_id=str(SEED.primary_profile), storage=MagicMock()
    ).resolve_layout(
        project_id=SEED.primary_project,
        template_id=template_id,
        mode=ExportMode.ALL_USERS,
        article_ids=article_ids,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )


def _consensus_cell(layout: ExportLayout, article_id: UUID, coord: tuple[str, str, str]) -> Any:
    article = next(a for a in layout.articles if a.article_id == article_id)
    section = next(s for s in layout.sections if s.name == coord[0])
    field = next(f for f in section.fields if f.name == coord[1])
    instance_id = next(
        iid
        for (et, _parent), ids in article.entries.items()
        if et == section.entity_type_id
        for iid in ids
    )
    return layout.value_map.get((article.run_id, instance_id, field.field_id, None))


def _overalls(layout: ExportLayout, article_id: UUID) -> dict[str, Any]:
    assert layout.appraisal is not None
    row = next(r for r in layout.appraisal.rows if r.article_id == article_id)
    return dict(zip(layout.appraisal.derived_labels, row.derived_values, strict=True))


def _assert_scoped_by_old_rules(layout: ExportLayout, article_id: UUID) -> None:
    """Development-only under RULES_OLD: evaluation out of play, development kept."""
    assert _consensus_cell(layout, article_id, _DEV) == "High"
    assert _consensus_cell(layout, article_id, _EVAL) == NOT_APPLICABLE
    overalls = _overalls(layout, article_id)
    assert overalls[_DEV_OVERALL] != NOT_APPLICABLE
    assert overalls[_EVAL_OVERALL] == NOT_APPLICABLE


def _assert_scoped_by_new_rules(layout: ExportLayout, article_id: UUID) -> None:
    """Development-only under RULES_NEW (scope swapped): development out of play."""
    assert _consensus_cell(layout, article_id, _DEV) == NOT_APPLICABLE
    assert _consensus_cell(layout, article_id, _EVAL) == "High"
    overalls = _overalls(layout, article_id)
    assert overalls[_DEV_OVERALL] == NOT_APPLICABLE
    assert overalls[_EVAL_OVERALL] != NOT_APPLICABLE


async def test_export_uses_pinned_rules(db_session: AsyncSession) -> None:
    pinned = await _pinned_qa_run(db_session)
    await _to_consensus_with_answers(db_session, pinned.run, pinned.template_id)

    layout = await _export(db_session, pinned.template_id, [SEED.primary_article])

    _assert_scoped_by_old_rules(layout, SEED.primary_article)


async def test_export_groups_rules_by_article_version(db_session: AsyncSession) -> None:
    """ONE export over two articles reviewed under different versions."""
    pinned = await _pinned_qa_run(db_session)
    # Article A leaves the editable stages first, so publishing v2 keeps it on v1.
    run_a = await _to_consensus_with_answers(db_session, pinned.run, pinned.template_id)
    v2 = await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=pinned.template_id,
        user_id=SEED.primary_profile,
    )
    assert v2.version_id != run_a.version_id
    article_b = await make_article(db_session, SEED.primary_project, "pinned to v2")
    run_b = await run_in_extract_at(
        db_session,
        project_id=SEED.primary_project,
        article_id=article_b,
        template_id=pinned.template_id,
    )
    assert run_b.version_id == v2.version_id
    rules = await pinned_template_rules(db_session, [run_a.version_id, run_b.version_id])
    assert rules[run_a.version_id] == pinned.rules_old
    assert rules[run_b.version_id] == pinned.rules_new
    await _to_consensus_with_answers(db_session, run_b, pinned.template_id)

    layout = await _export(db_session, pinned.template_id, [SEED.primary_article, article_b])

    _assert_scoped_by_old_rules(layout, SEED.primary_article)
    _assert_scoped_by_new_rules(layout, article_b)


# --- Re-import: the catalogue's rules change, the clone publishes them ---


async def _catalogue_ships(db: AsyncSession, rules: dict[str, Any]) -> None:
    """The global PROBAST+AI template now declares *rules*."""
    global_tpl = await db.get(ExtractionTemplateGlobal, _PROBAST_AI_TEMPLATE_ID)
    assert global_tpl is not None
    global_tpl.schema_ = {**(global_tpl.schema_ or {}), **rules}
    await db.flush()


async def _versions(db: AsyncSession, template_id: UUID) -> list[tuple[UUID, bool]]:
    rows = await db.execute(
        text(
            "SELECT id, is_active FROM public.extraction_template_versions "
            "WHERE project_template_id = :tid ORDER BY version"
        ),
        {"tid": str(template_id)},
    )
    return [(r.id, r.is_active) for r in rows]


async def _live_rules(db: AsyncSession, template_id: UUID) -> dict[str, Any]:
    live = (
        await db.execute(
            text("SELECT schema FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    return {k: live[k] for k in ("derived_judgments", "scope_rules")}


async def test_reimport_publishes_new_rules_and_old_run_keeps_old_rules(
    db_session: AsyncSession,
) -> None:
    pinned, _ = await _run_on_v1(db_session)
    # The old run leaves the editable stages, so a publish keeps it on v1.
    old_run = await _to_consensus_with_answers(db_session, pinned.run, pinned.template_id)
    instance_id = await _section_instance(db_session, old_run)
    for field in (
        "q1_appropriate_data_sources",
        "q2_appropriate_study_design",
        "q3_representative_dataset",
    ):
        await ExtractionConsensusService(db_session).record_consensus(
            run_id=old_run.id,
            instance_id=instance_id,
            field_id=await _field_id(db_session, pinned.template_id, field),
            consensus_user_id=SEED.primary_profile,
            mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
            value={"value": "PY"},
            rationale="test",
        )
    before = await _versions(db_session, pinned.template_id)
    await _catalogue_ships(db_session, pinned.rules_new)

    reimported = await _reimport(db_session)

    after = await _versions(db_session, pinned.template_id)
    assert len(after) == len(before) + 1
    v2 = after[-1][0]
    assert after[-1][1] is True
    assert reimported.version_id == v2
    assert (await pinned_template_rules(db_session, [v2]))[v2] == pinned.rules_new
    assert await _live_rules(db_session, pinned.template_id) == pinned.rules_new
    # The pinned run keeps RULES_OLD in every consumer.
    assert old_run.version_id != v2
    view = await build_run_view(
        db_session, old_run.id, caller_id=SEED.primary_profile, can_see_peers=True
    )
    assert view.scope_rules == pinned.rules_old["scope_rules"]
    assert await build_llm_field_filter(db_session, old_run) == llm_field_filter_of(
        pinned.rules_old
    )
    failure = await divergence_rationale_failure(db_session, old_run)
    assert failure is not None and "Resolve divergence" in failure
    _assert_scoped_by_old_rules(
        await _export(db_session, pinned.template_id, [SEED.primary_article]),
        SEED.primary_article,
    )
    # A run created after the re-import reads RULES_NEW.
    article_b = await make_article(db_session, SEED.primary_project, "after re-import")
    new_run = await run_in_extract_at(
        db_session,
        project_id=SEED.primary_project,
        article_id=article_b,
        template_id=pinned.template_id,
    )
    assert new_run.version_id == v2
    new_view = await build_run_view(
        db_session, new_run.id, caller_id=SEED.primary_profile, can_see_peers=True
    )
    assert new_view.scope_rules == pinned.rules_new["scope_rules"]


async def test_reimport_with_pending_draft_and_changed_rules_is_refused(
    db_session: AsyncSession,
) -> None:
    pinned, _ = await _run_on_v1(db_session)
    await db_session.execute(
        text("UPDATE public.extraction_fields SET label = 'Edited label' WHERE id = :fid"),
        {"fid": str(await _field_id(db_session, pinned.template_id, "quality_concern"))},
    )
    stamped = (
        await db_session.execute(
            text(
                "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(pinned.template_id)},
        )
    ).scalar_one()
    assert stamped is not None
    before = await _versions(db_session, pinned.template_id)
    await _catalogue_ships(db_session, pinned.rules_new)

    # The endpoint rolls its transaction back on the refusal; a savepoint
    # stands in for it here.
    with pytest.raises(PendingConfigDraftError):
        async with db_session.begin_nested():
            await _reimport(db_session)

    assert await _versions(db_session, pinned.template_id) == before
    assert await _live_rules(db_session, pinned.template_id) == pinned.rules_old


async def test_reimport_with_unchanged_rules_publishes_nothing(db_session: AsyncSession) -> None:
    pinned, _ = await _run_on_v1(db_session)
    before = await _versions(db_session, pinned.template_id)

    reimported = await _reimport(db_session)

    assert await _versions(db_session, pinned.template_id) == before
    assert reimported.version_id == pinned.run.version_id


async def _add_orphan_field(db: AsyncSession, template_id: UUID) -> None:
    """Live structure drift with no pending draft (a lost republish)."""
    et_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND name = :s"
            ),
            {"tid": str(template_id), "s": _SECTION},
        )
    ).scalar_one()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
            "VALUES (:id, :et, 'orphan_edit', 'Orphan edit', 'text', false, 999)"
        ),
        {"id": str(uuid4()), "et": str(et_id)},
    )
    await set_config_draft_marker(db, template_id, None)


@pytest.mark.parametrize("drift", [False, True], ids=["aligned", "structure_drift"])
async def test_reimport_takes_publish_locks_before_writing_rules(
    db_session: AsyncSession, drift: bool
) -> None:
    pinned, _ = await _run_on_v1(db_session)
    if drift:
        await _add_orphan_field(db_session, pinned.template_id)
    await _catalogue_ships(db_session, pinned.rules_new)
    events: list[str] = []
    real_lock = TemplateVersionService.acquire_publish_locks
    real_flush = AsyncSession.flush

    async def lock(self: TemplateVersionService, template_id: UUID) -> Any:
        events.append("lock")
        return await real_lock(self, template_id)

    async def flush(self: AsyncSession, *args: Any, **kwargs: Any) -> None:
        writes_rules = any(
            isinstance(obj, ProjectExtractionTemplate)
            and (obj.schema_ or {}).get("scope_rules") == pinned.rules_new["scope_rules"]
            for obj in self.sync_session.dirty
        )
        events.append("flush_rules" if writes_rules else "flush")
        await real_flush(self, *args, **kwargs)

    with (
        patch.object(TemplateVersionService, "acquire_publish_locks", lock),
        patch.object(AsyncSession, "flush", flush),
    ):
        await _reimport(db_session)

    assert "flush_rules" in events
    assert "lock" in events
    assert events.index("lock") < events.index("flush_rules")
