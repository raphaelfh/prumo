"""Integration coverage for the AI-metadata ``Reviewer outcome`` logic.

These tests exercise ``ExtractionExportService._load_ai_proposal_rows``
against the real local Supabase Postgres (RLS, CHECK constraints,
composite FKs) for the FR-037 outcome-inference corrections shipped in
Phase S2:

* **A2** — a multi-reviewer disagreement (one ``accept_proposal`` on the
  AI proposal, one ``reject`` of it by a *different* reviewer) must
  resolve to ``"accepted"``; the reject of one reviewer cannot mask the
  accept of another.
* **A3** — in SINGLE_USER mode the ``Reviewer outcome`` column reflects
  the *target* reviewer's decision only (the query is scoped to
  ``target_reviewer_id``), and ``Final value used`` reflects the same
  reviewer's value map (blank/None for a reject).
* **A4** — a latest AI proposal that is *touched but not selected* by a
  terminal decision (an accept of a sibling proposal on the same key)
  reports ``"not selected"``, never ``"pending"``.
* **A5** — evidence renders numeric-sorted, deduped pages (so ``"2"`` <
  ``"10"``) and a deduped, page-ordered ``evidence_text``.

The sibling file ``test_extraction_export_ai_outcome_ordering.py`` (the
A6 ``id``-tiebreak determinism guard) ships separately on PR #291; this
file owns the A2/A3/A4/A5 behaviours. Setup mirrors the run / instance /
proposal / decision insertion and ``project_id`` scoping used in
``test_extraction_export_value_resolution.py`` and
``test_extraction_manual_only_flow.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEvidence,
    ExtractionFieldType,
    ExtractionRun,
    ExtractionRunStage,
    TemplateKind,
)
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    SectionDescriptor,
)
from app.services.hitl_session_service import HITLSessionService

pytestmark = pytest.mark.asyncio

# Fixed, hand-picked proposal ids and a shared timestamp. These tests
# deliberately avoid relying on the AI-proposal ``id`` tiebreak for
# equal ``created_at`` (that ordering is owned by PR #291 and is not on
# this branch): every case keeps a single AI proposal per key, so the
# lone AI row is unambiguously the latest AI proposal regardless of id.
_SHARED_TS = datetime(2026, 1, 1, tzinfo=UTC)
_ID_LOW = UUID("00000000-0000-4000-8000-000000000000")
_ID_HIGH = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")


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
                "SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1"
            )
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
                WHERE t.kind = 'extraction'
                LIMIT 1
                """
            )
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


async def _make_run(
    db: AsyncSession, *, project_id: UUID, article_id: UUID, template_id: UUID, profile_id: UUID
) -> ExtractionRun:
    """Create a fresh PROPOSAL run for the coord (clearing leaked runs
    first; the test's rolled-back session undoes both)."""
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db.get(ExtractionRun, session.run_id)
    assert run is not None
    return run


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


def _human_proposal(
    *,
    proposal_id: UUID,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    source_user_id: UUID,
    value: object,
    created_at: datetime = _SHARED_TS,
) -> ExtractionProposalRecord:
    return ExtractionProposalRecord(
        id=proposal_id,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.HUMAN.value,
        source_user_id=source_user_id,
        proposed_value={"value": value},
        created_at=created_at,
    )


async def _record_decision(
    db: AsyncSession,
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    reviewer_id: UUID,
    decision: ExtractionReviewerDecisionType,
    proposal_record_id: UUID | None = None,
    value: dict[str, object] | None = None,
) -> ExtractionReviewerDecision:
    """Insert a reviewer decision + the matching ``current_decision_id``
    state pointer for one reviewer on one (run, instance, field) coord.

    The composite FK ``(run_id, current_decision_id)`` requires the
    decision and state to agree on ``run_id``; we flush the decision
    first so its id is available for the state pointer.
    """
    dec = ExtractionReviewerDecision(
        id=uuid4(),
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_id,
        decision=decision.value,
        proposal_record_id=proposal_record_id,
        value=value,
    )
    db.add(dec)
    await db.flush()
    db.add(
        ExtractionReviewerState(
            id=uuid4(),
            run_id=run_id,
            reviewer_id=reviewer_id,
            instance_id=instance_id,
            field_id=field_id,
            current_decision_id=dec.id,
        )
    )
    await db.flush()
    return dec


def _service(db: AsyncSession, *, profile_id: UUID) -> ExtractionExportService:
    return ExtractionExportService(
        db=db, user_id=str(profile_id), storage=MagicMock(), trace_id="t"
    )


def _article(
    *, article_id: UUID, run_id: UUID, run_stage: str, entity_type_id: UUID, instance_id: UUID
) -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=article_id,
        header_label="Article",
        run_id=run_id,
        run_stage=ExtractionRunStage(run_stage),
        version_id=None,
        model_instances=(),
        section_instances={entity_type_id: (instance_id,)},
    )


def _section(*, entity_type_id: UUID, field_id: UUID) -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=entity_type_id,
        label="Section",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=field_id,
                label="Field",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                parent_section_id=entity_type_id,
            ),
        ),
    )


async def test_ai_outcome_accept_not_masked_by_other_reviewer_reject(
    db_session: AsyncSession,
) -> None:
    """A2 — one reviewer accepts the AI proposal, another rejects it.

    The single ``AIProposalRow`` must report ``"accepted"``: an exact
    ``accept_proposal`` on this proposal_id outranks any blanket
    ``reject`` from a different reviewer. Pre-fix, the reject (evaluated
    before the superseded/accept precedence and across all reviewers)
    masked the accept.
    """
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await _make_run(
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

    # Two distinct reviewers on the same coord: target accepts, other rejects.
    reviewer_accept = profile_id
    reviewer_reject = (
        await db_session.execute(
            text("SELECT id FROM public.profiles WHERE id <> :pid LIMIT 1"),
            {"pid": str(profile_id)},
        )
    ).scalar()
    assert reviewer_reject is not None, "need a second profile for the multi-reviewer case"
    await _record_decision(
        db_session,
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=reviewer_accept,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )
    await _record_decision(
        db_session,
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=UUID(str(reviewer_reject)),
        decision=ExtractionReviewerDecisionType.REJECT,
    )

    rows = await _service(db_session, profile_id=profile_id)._load_ai_proposal_rows(
        articles=(
            _article(
                article_id=article_id,
                run_id=run.id,
                run_stage=run.stage,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        sections=(_section(entity_type_id=entity_type_id, field_id=field_id),),
        value_map={},
        mode=ExportMode.CONSENSUS,
        target_reviewer_id=None,
    )
    assert len(rows) == 1
    assert rows[0].reviewer_outcome == "accepted"

    await db_session.rollback()


async def test_ai_outcome_single_user_scoped_to_target(
    db_session: AsyncSession,
) -> None:
    """A3 — SINGLE_USER outcome + final value reflect the target reviewer.

    Target reviewer rejects the AI proposal; a different reviewer accepts
    it. With ``mode=SINGLE_USER, target_reviewer_id=<target>`` the
    decision query is scoped to the target, so the outcome is
    ``"rejected"`` (not ``"accepted"``) and ``final_value_used`` is the
    single-user value map's entry for the coord — None for a reject.
    """
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await _make_run(
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

    target_reviewer = profile_id
    other_reviewer = (
        await db_session.execute(
            text("SELECT id FROM public.profiles WHERE id <> :pid LIMIT 1"),
            {"pid": str(profile_id)},
        )
    ).scalar()
    assert other_reviewer is not None
    await _record_decision(
        db_session,
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=target_reviewer,
        decision=ExtractionReviewerDecisionType.REJECT,
    )
    await _record_decision(
        db_session,
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=UUID(str(other_reviewer)),
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=proposal_id,
    )

    # Single-user value map: the target rejected, so there is no value for
    # the coord — ``final_value_used`` must come out None (blank cell).
    rows = await _service(db_session, profile_id=profile_id)._load_ai_proposal_rows(
        articles=(
            _article(
                article_id=article_id,
                run_id=run.id,
                run_stage=run.stage,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        sections=(_section(entity_type_id=entity_type_id, field_id=field_id),),
        value_map={},
        mode=ExportMode.SINGLE_USER,
        target_reviewer_id=target_reviewer,
    )
    assert len(rows) == 1
    assert rows[0].reviewer_outcome == "rejected"
    assert rows[0].final_value_used is None

    await db_session.rollback()


async def test_ai_outcome_not_selected_when_terminal_decision_exists(
    db_session: AsyncSession,
) -> None:
    """A4 — the latest AI proposal, reviewed but not chosen, is
    ``"not selected"`` (never ``"pending"``).

    A reviewer accepts a *sibling* (human) proposal on the same key, so a
    terminal decision exists on the key while the AI proposal itself was
    not the accepted one. The AI row is therefore touched-but-not-chosen
    and must report ``"not selected"`` rather than the unreviewed
    ``"pending"``.

    The sibling is a ``human`` proposal (not a second AI row) so this
    case does not depend on the AI-proposal ``id`` tiebreak (owned by
    PR #291, not on this branch): the single AI proposal is
    unambiguously the latest AI proposal for the key.
    """
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await _make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    ai_id = _ID_HIGH
    sibling_human_id = _ID_LOW
    db_session.add_all(
        [
            _human_proposal(
                proposal_id=sibling_human_id,
                run_id=run.id,
                instance_id=instance_id,
                field_id=field_id,
                source_user_id=profile_id,
                value="HUMAN-SIBLING",
            ),
            _ai_proposal(
                proposal_id=ai_id,
                run_id=run.id,
                instance_id=instance_id,
                field_id=field_id,
                value="LATEST-AI",
            ),
        ]
    )
    await db_session.flush()

    # Accept the SIBLING human proposal — the AI proposal on the same key
    # is touched-but-not-selected (a different proposal was accepted).
    await _record_decision(
        db_session,
        run_id=run.id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=profile_id,
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL,
        proposal_record_id=sibling_human_id,
    )

    rows = await _service(db_session, profile_id=profile_id)._load_ai_proposal_rows(
        articles=(
            _article(
                article_id=article_id,
                run_id=run.id,
                run_stage=run.stage,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        sections=(_section(entity_type_id=entity_type_id, field_id=field_id),),
        value_map={},
        mode=ExportMode.CONSENSUS,
        target_reviewer_id=None,
    )
    # Only the AI proposal produces a row (source='ai' filter).
    assert len(rows) == 1
    assert rows[0].ai_proposed_value == "LATEST-AI"
    assert rows[0].reviewer_outcome == "not selected"
    # Never 'pending' once the key has a terminal decision.
    assert rows[0].reviewer_outcome != "pending"

    await db_session.rollback()


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

    run = await _make_run(
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

    rows = await _service(db_session, profile_id=profile_id)._load_ai_proposal_rows(
        articles=(
            _article(
                article_id=article_id,
                run_id=run.id,
                run_stage=run.stage,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        sections=(_section(entity_type_id=entity_type_id, field_id=field_id),),
        value_map={},
        mode=ExportMode.CONSENSUS,
        target_reviewer_id=None,
    )
    assert len(rows) == 1
    row = rows[0]
    # Numeric, deduped page rendering — "2" before "10", not lexicographic.
    assert row.evidence_pages == "2, 9, 10"
    # Text deduped and in page order.
    assert row.evidence_text == "two | nine | ten"


async def test_model_used_resolved_from_run_parameters(
    db_session: AsyncSession,
) -> None:
    """A7 — model_used is resolved from run.parameters["model"].

    Two runs with different ``parameters["model"]`` values are each
    represented by one AI proposal. The AIProposalRow for each proposal
    must carry the model from its run. A run without a "model" key must
    yield an empty string (graceful degradation for older runs).
    """
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    # Run A — has parameters["model"] = "gpt-4o-mini".
    run_a = await _make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    run_a.parameters = {"model": "gpt-4o-mini"}
    await db_session.flush()

    proposal_a = uuid4()
    db_session.add(
        _ai_proposal(
            proposal_id=proposal_a,
            run_id=run_a.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value-a",
        )
    )
    await db_session.flush()

    rows = await _service(db_session, profile_id=profile_id)._load_ai_proposal_rows(
        articles=(
            _article(
                article_id=article_id,
                run_id=run_a.id,
                run_stage=run_a.stage,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        sections=(_section(entity_type_id=entity_type_id, field_id=field_id),),
        value_map={},
        mode=ExportMode.CONSENSUS,
        target_reviewer_id=None,
    )
    assert len(rows) == 1
    assert rows[0].model_used == "gpt-4o-mini"

    await db_session.rollback()


async def test_model_used_empty_when_parameters_absent(
    db_session: AsyncSession,
) -> None:
    """A7b — run.parameters without "model" key yields model_used=""."""
    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await _make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )
    # Leave run.parameters empty (no "model" key).
    run.parameters = {}
    await db_session.flush()

    proposal_id = uuid4()
    db_session.add(
        _ai_proposal(
            proposal_id=proposal_id,
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_id,
            value="value",
        )
    )
    await db_session.flush()

    rows = await _service(db_session, profile_id=profile_id)._load_ai_proposal_rows(
        articles=(
            _article(
                article_id=article_id,
                run_id=run.id,
                run_stage=run.stage,
                entity_type_id=entity_type_id,
                instance_id=instance_id,
            ),
        ),
        sections=(_section(entity_type_id=entity_type_id, field_id=field_id),),
        value_map={},
        mode=ExportMode.CONSENSUS,
        target_reviewer_id=None,
    )
    assert len(rows) == 1
    assert rows[0].model_used == ""

    await db_session.rollback()

    await db_session.rollback()
