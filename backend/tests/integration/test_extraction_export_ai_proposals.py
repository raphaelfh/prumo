"""Integration coverage for the AI proposals sheet loader (§7, D6).

These tests exercise ``ExtractionExportService._load_ai_proposal_rows``
against the real local Supabase Postgres:

* the row set: every ``source=ai`` proposal of the current runs, plus a
  ``source=ai`` proposal an in-scope decision links to in an earlier run;
* evidence renders numeric-sorted, deduped pages (so ``"2"`` < ``"10"``)
  and a deduped, page-ordered quote, only when AI detail is requested;
* only immutable proposal facts may supply the exported engine. Legacy rows
  never borrow mutable run metadata or request parameters;
* the loader never reads the snapshot's prompt payload.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEvidence,
    ExtractionFieldType,
    ExtractionRun,
    ExtractionRunStage,
)
from app.models.extraction_workflow import ExtractionProposalRecord, ExtractionProposalSource
from app.services.exports.ai_proposal_projection import EngineFacts
from app.services.extraction_export_service import (
    AIProposalRow,
    ArticleDescriptor,
    ExportMode,
    FieldDescriptor,
)
from app.services.extraction_review_service import ExtractionReviewService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED, land_ai_proposal
from tests.integration.helpers.export_fixtures import export_service, make_run

pytestmark = pytest.mark.asyncio

_SHARED_TS = datetime(2026, 1, 1, tzinfo=UTC)


async def _coord(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve a coherent (project, article, template, profile,
    entity_type, instance, field) tuple from one seeded extraction
    instance. Returns None when the dev DB is not seeded (test skips).
    Scopes the article/template join by ``project_id`` per the
    integration rule. All columns are non-null by the JOIN.
    """
    profile = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    row = (
        await db.execute(
            text(
                """
                SELECT i.article_id, i.template_id, i.entity_type_id, i.id, f.id, t.project_id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                JOIN public.project_extraction_templates t ON t.id = i.template_id
                WHERE t.kind = 'extraction' AND t.project_id = :pid
                LIMIT 1
                """
            ),
            {"pid": str(SEED.primary_project)},
        )
    ).first()
    if profile is None or row is None:
        return None
    article_id, template_id, entity_type_id, instance_id, field_id, project_id = row
    return (
        UUID(str(project_id)),
        UUID(str(article_id)),
        UUID(str(template_id)),
        UUID(str(profile)),
        UUID(str(entity_type_id)),
        UUID(str(instance_id)),
        UUID(str(field_id)),
    )


def _ai_proposal(
    *,
    proposal_id: UUID,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    value: object,
    created_at: datetime = _SHARED_TS,
) -> ExtractionProposalRecord:
    return ExtractionProposalRecord(
        id=proposal_id,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI.value,
        proposed_value={"value": value},
        created_at=created_at,
    )


def _article(
    *, article_id: UUID, run_id: UUID, entity_type_id: UUID, instance_id: UUID
) -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=article_id,
        article_label="Article",
        run_id=run_id,
        version_id=None,
        entries={(entity_type_id, None): (instance_id,)},
    )


def _field(field_id: UUID) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=field_id, label="Field", type=ExtractionFieldType.TEXT, allowed_values=()
    )


async def test_ai_evidence_ordered_and_deduped(
    db_session: AsyncSession,
) -> None:
    """A5 — evidence pages are numeric-sorted + deduped and text is
    deduped in page order.

    Insert evidence with out-of-order multi-digit pages (10, 2, 9) plus
    one exact ``(text, page)`` duplicate. ``evidence_pages`` must render
    ``"2, 9, 10"`` (numeric sort, not lexicographic ``"10, 2, 9"``) and
    ``evidence_text`` must contain each distinct snippet once, in page
    order, with no duplicate.
    """
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    proposal_id = uuid4()
    db_session.add(
        _ai_proposal(
            proposal_id=proposal_id,
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="AI-VALUE",
        )
    )
    await db_session.flush()

    # Out-of-order multi-digit pages + an exact (text, page) duplicate of
    # page 2's snippet. Evidence requires run_id (workflow_target_present
    # CHECK) + project_id + article_id + created_by, all NOT NULL.
    for page, snippet in (
        (10, "ten"),
        (2, "two"),
        (9, "nine"),
        (2, "two"),  # exact duplicate — must collapse
    ):
        db_session.add(
            ExtractionEvidence(
                id=uuid4(),
                project_id=project_id,
                article_id=article_id,
                run_id=run.id,
                proposal_record_id=proposal_id,
                page_number=page,
                text_content=snippet,
                created_by=profile_id,
            )
        )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    row = rows[0]
    # Numeric, deduped page rendering — "2" before "10", not lexicographic.
    assert row.page == "2, 9, 10"
    # Text deduped and in page order.
    assert row.evidence_quote == "two | nine | ten"

    bare = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
        with_evidence=False,
    )
    assert (bare[0].evidence_quote, bare[0].page) == ("", "")


# ----------------------------------------------------------------------
# A7 — the provider / model / prompt_version columns.
#
# Every assertion below exists to keep ONE untrusted value out of a
# published export. ``run.parameters`` is client-supplied: the
# ``CreateRunRequest`` schema declares it as a free-form ``dict[str, Any]``
# with no allow-list, ``POST /api/v1/runs`` is authorized by
# ``ensure_project_reviewer``, and the bag is persisted verbatim. Reading
# ``parameters["model"]`` therefore reported whatever an ordinary reviewer
# chose to type. ``results["provenance"]`` cannot be reached from any
# request body — the server writes it from the extractor's own constants
# under a row lock — so it is the only honest source.
# ----------------------------------------------------------------------


def _provenance_results(*sections: tuple[UUID, str]) -> dict[str, object]:
    """A run ``results`` payload shaped exactly like the server writes it.

    Mirrors the AI-extraction section snapshot merged through
    ``ExtractionRunRepository.merge_provenance_section``: one snapshot per
    entity type under ``provenance.sections``, keyed by the stringified id.
    Only ``model`` is populated — the sibling keys are irrelevant here.
    """
    return {"provenance": {"sections": {str(etid): {"model": m} for etid, m in sections}}}


async def _ai_metadata_rows(
    db: AsyncSession,
    *,
    run: ExtractionRun,
    profile_id: UUID,
    article_id: UUID,
    template_id: UUID,
    entity_type_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    with_evidence: bool = True,
) -> tuple[AIProposalRow, ...]:
    """AI proposals rows for one single-section run, no decisions in scope."""
    return await export_service(db, profile_id=profile_id)._load_ai_proposal_rows(
        template_id=template_id,
        articles=(
            _article(
                article_id=article_id,
                run_id=run.id,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        cells={},
        fields={field_id: _field(field_id)},
        labels={},
        with_evidence=with_evidence,
    )


async def test_engine_ignores_mutable_run_provenance_and_forgeable_parameters(
    db_session: AsyncSession,
) -> None:
    """Legacy proposal engine remains unavailable despite mutable run metadata."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    run.parameters = {"model": "gpt-4o-FORGED"}
    run.results = _provenance_results((entity_type_id, "gpt-5-mini-real"))
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    assert rows[0].engine == EngineFacts("", "", "")


async def test_engine_unavailable_without_per_proposal_facts_for_hitl_run(
    db_session: AsyncSession,
) -> None:
    """Legacy proposal engine remains unavailable despite mutable run metadata."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    assert "model" not in run.parameters, "precondition: the HITL bag carries no engine"
    run.results = _provenance_results((entity_type_id, "gpt-5-mini-real"))
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    assert rows[0].engine.model == ""


async def test_engine_never_guesses_from_sibling_section_candidates(
    db_session: AsyncSession,
) -> None:
    """Legacy proposal engine remains unavailable despite mutable run metadata."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    # Snapshots for two OTHER sections; the proposal's own section has none.
    # Inserted worst-case first so a passing sort cannot be the insertion order.
    run.results = _provenance_results((uuid4(), "z-engine"), (uuid4(), "a-engine"))
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    assert rows[0].engine.model == ""


async def test_engine_never_borrows_flat_run_snapshot(
    db_session: AsyncSession,
) -> None:
    """Legacy proposal engine remains unavailable despite mutable run metadata."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    run.parameters = {"model": "gpt-4o-FORGED"}
    run.results = {"provenance": {"model": "legacy-flat-engine", "provider": "openai"}}
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    assert rows[0].engine.model == ""


async def test_engine_never_falls_back_to_parameters_for_legacy_rows(
    db_session: AsyncSession,
) -> None:
    """Legacy proposal engine remains unavailable despite mutable run metadata."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    # Run A — legacy parameters, and explicitly no provenance.
    run_a = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    run_a.parameters = {"model": "gpt-4o-mini"}
    run_a.results = {}
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run_a.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value-a",
        )
    )
    await db_session.flush()

    # Run B — cloned from run_a's metadata but with a different model.
    # We insert directly to avoid _make_run deleting run_a. Run A is
    # flipped terminal first: uq_one_live_extraction_run_per_coord (0045)
    # allows at most ONE live run per (project, article, template, kind);
    # cancelling keeps run_a's proposal + parameters rows intact.
    run_b = ExtractionRun(
        project_id=run_a.project_id,
        article_id=run_a.article_id,
        template_id=run_a.template_id,
        kind=run_a.kind,
        version_id=run_a.version_id,
        hitl_config_snapshot=run_a.hitl_config_snapshot,
        stage=run_a.stage,
        status=run_a.status,
        parameters={"model": "gpt-4o"},
        created_by=run_a.created_by,
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_runs SET stage = 'cancelled', "
            "status = 'failed' WHERE id = :rid"
        ),
        {"rid": str(run_a.id)},
    )
    db_session.add(run_b)
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run_b.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value-b",
        )
    )
    await db_session.flush()

    rows_a = await _ai_metadata_rows(
        db_session,
        run=run_a,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows_a) == 1
    assert rows_a[0].engine.model == ""

    rows_b = await _ai_metadata_rows(
        db_session,
        run=run_b,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows_b) == 1
    assert rows_b[0].engine.model == ""

    await db_session.rollback()


async def test_engine_empty_when_neither_provenance_nor_parameters(
    db_session: AsyncSession,
) -> None:
    """A7e — nothing recorded anywhere yields ``""``, never a default engine.

    An empty cell is the truthful rendering of "no record of which engine
    ran". Substituting ``settings.LLM_DEFAULT_MODEL`` here would invent
    provenance for a run that has none.
    """
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    run.parameters = {}
    run.results = {}
    await db_session.flush()

    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    assert rows[0].engine.model == ""


async def test_annotated_proposal_exports_the_value_not_the_verification_sibling(
    db_session: AsyncSession,
) -> None:
    """Verified-mode smoke: a proposal carrying the server-written
    ``verification`` ANNOTATION sibling exports its ``.value`` exactly like an
    unannotated row — the sibling never leaks into a cell (the
    exports-only-read-``.value`` claim, verified rather than assumed)."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    db_session.add(
        ExtractionProposalRecord(
            id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI.value,
            proposed_value={"value": "annotated", "verification": {"verdict": "confirmed"}},
            created_at=_SHARED_TS,
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert len(rows) == 1
    assert rows[0].value.value_text == "annotated"


# ----------------------------------------------------------------------
# Row set and the prompt payload (§7, Review Focus 5)
# ----------------------------------------------------------------------


async def _extract_run(db: AsyncSession) -> ExtractionRun:
    run = await make_run(
        db,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
    )
    if run.stage == ExtractionRunStage.PENDING.value:
        await RunLifecycleService(db).advance_stage(
            run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
        )
    return run


async def _single_user_ai_layout(db: AsyncSession):
    return await export_service(db, profile_id=SEED.primary_profile).resolve_layout(
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        mode=ExportMode.SINGLE_USER,
        article_ids=[SEED.primary_article],
        include_ai_metadata=True,
        anonymize_reviewer_names=False,
        reviewer_id=SEED.primary_profile,
    )


async def test_cross_run_ai_proposal_appears_with_its_keys(db_session: AsyncSession) -> None:
    """A reopen leaves the AI proposal in run1; run2's decision links to it."""
    inst, fid = SEED.primary_instance, SEED.primary_field
    run1 = await _extract_run(db_session)
    old_pid = (
        await land_ai_proposal(
            db_session, run_id=run1.id, instance_id=inst, field_id=fid,
            proposed_value={"value": 42},
        )
    ).id  # fmt: skip
    await db_session.execute(
        text(
            "UPDATE public.extraction_runs SET stage = 'finalized', status = 'completed' "
            "WHERE id = :rid"
        ),
        {"rid": str(run1.id)},
    )
    await db_session.flush()
    await db_session.refresh(run1)
    run2, created = await RunLifecycleService(db_session).reopen_run(
        run_id=run1.id, user_id=SEED.primary_profile
    )
    assert created and run2.id != run1.id
    await ExtractionReviewService(db_session).record_decision(
        run_id=run2.id, instance_id=inst, field_id=fid, reviewer_id=SEED.primary_profile,
        decision="edit", value={"value": 42}, proposal_record_id=old_pid,
    )  # fmt: skip

    layout = await _single_user_ai_layout(db_session)

    assert [a.run_id for a in layout.articles] == [run2.id]
    keys = {
        (r.article_id, r.instance_id, r.field_id, r.ai_proposal_id) for r in layout.ai_proposal_rows
    }
    assert (SEED.primary_article, inst, fid, old_pid) in keys


async def test_rows_are_loaded_without_ai_detail(db_session: AsyncSession) -> None:
    """The README's AI-tools table reads the rows; evidence waits for AI detail."""
    run = await _extract_run(db_session)
    pid = (
        await land_ai_proposal(
            db_session, run_id=run.id, instance_id=SEED.primary_instance,
            field_id=SEED.primary_field, proposed_value={"value": 42},
        )
    ).id  # fmt: skip
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id, instance_id=SEED.primary_instance, field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile, decision="edit", value={"value": 7},
    )  # fmt: skip

    layout = await export_service(db_session, profile_id=SEED.primary_profile).resolve_layout(
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        mode=ExportMode.SINGLE_USER,
        article_ids=[SEED.primary_article],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        reviewer_id=SEED.primary_profile,
    )

    assert [r.ai_proposal_id for r in layout.ai_proposal_rows] == [pid]


async def test_loader_ignores_non_ai_proposals(db_session: AsyncSession) -> None:
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord
    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    db_session.add(
        ExtractionProposalRecord(
            id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN.value,
            source_user_id=profile_id,
            proposed_value={"value": "typed"},
        )
    )
    await db_session.flush()

    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=profile_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        instance_id=instance_id,
        field_id=field_id,
    )
    assert rows == ()


async def test_loader_does_not_select_prompt_text(db_session: AsyncSession) -> None:
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord
    run = await make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    db_session.add(
        _ai_proposal(
            proposal_id=uuid4(),
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()
    statements: list[str] = []

    def listener(_conn, _cursor, statement, _params, _context, _many) -> None:
        statements.append(statement)

    conn = (await db_session.connection()).sync_connection
    event.listen(conn, "before_cursor_execute", listener)
    try:
        rows = await _ai_metadata_rows(
            db_session,
            run=run,
            profile_id=profile_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=entity_type_id,
            instance_id=instance_id,
            field_id=field_id,
        )
    finally:
        event.remove(conn, "before_cursor_execute", listener)

    assert len(rows) == 1
    reads = [
        stmt[max(0, m.start() - 60) : m.end() + 3]
        for stmt in statements
        for m in re.finditer(r"\.generation_snapshot\b", stmt)
    ]
    assert reads, "precondition: the loader read the snapshot column"
    # Every read of the column strips the prompt payload or only tests its type.
    assert all(r.endswith(" - ") or "jsonb_typeof(" in r for r in reads), reads
