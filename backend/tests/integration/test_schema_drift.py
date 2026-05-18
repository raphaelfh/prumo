"""Schema-drift detectors for the extraction + HITL stack.

The frontend pins specific function names, FK names, enum values, RLS
helpers, and table columns. When a migration silently renames any of
those, the user surfaces it as "0% progress", "PGRST202: function not
found", or — worst case — a silent cross-run / cross-project leak.

These tests are intentionally narrow: each one names exactly one
contract and asserts the catalog matches it. Failure points at the
contract that drifted, not at a downstream symptom.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# ==================================================================
# Function signatures the frontend / services depend on
# ==================================================================


async def test_calculate_model_progress_signature_locked(db_session: AsyncSession) -> None:
    """Contract: ``calculate_model_progress(p_article_id uuid, p_model_id uuid)``.
    Frontend uses these exact names in ``useModelManagement``."""
    args = (
        await db_session.execute(
            text(
                "SELECT pg_get_function_arguments(oid) FROM pg_proc "
                "WHERE proname = 'calculate_model_progress'"
            )
        )
    ).scalar()
    assert args == "p_article_id uuid, p_model_id uuid"


async def test_calculate_model_progress_is_security_definer(db_session: AsyncSession) -> None:
    """Contract: SECURITY DEFINER + pinned search_path — required so the
    function works from the anon role through PostgREST without RLS
    masking parts of the aggregate."""
    row = (
        await db_session.execute(
            text(
                "SELECT prosecdef, proconfig FROM pg_proc "
                "WHERE proname = 'calculate_model_progress'"
            )
        )
    ).first()
    assert row is not None
    assert row[0] is True  # security definer
    proconfig = list(row[1] or [])
    assert any("search_path=" in entry for entry in proconfig)


async def test_check_cardinality_one_signature_locked(db_session: AsyncSession) -> None:
    """Contract: ``check_cardinality_one(p_article_id, p_entity_type_id,
    p_parent_instance_id)``. Called from
    ``extractionInstanceService.createInstance`` before INSERT to
    short-circuit cardinality='one' duplication."""
    args = (
        await db_session.execute(
            text(
                "SELECT pg_get_function_arguments(oid) FROM pg_proc "
                "WHERE proname = 'check_cardinality_one'"
            )
        )
    ).scalar()
    assert args is not None
    assert "p_article_id" in args
    assert "p_entity_type_id" in args
    assert "p_parent_instance_id" in args


async def test_is_project_reviewer_helper_exists(db_session: AsyncSession) -> None:
    """Contract: SECURITY DEFINER helper that broadens RLS write to
    reviewer/consensus roles (migration 0018). Pre-0018 only managers
    could write to workflow tables — a regression would break legitimate
    reviewer decisions."""
    exists = (
        await db_session.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_project_reviewer')"
            )
        )
    ).scalar()
    assert exists is True


# ==================================================================
# Foreign-key contracts that prevent cross-run / cross-project leaks
# ==================================================================


async def test_reviewer_states_composite_fk_to_decisions(db_session: AsyncSession) -> None:
    """Contract: ``extraction_reviewer_states.current_decision_id`` is
    constrained by the composite FK ``(run_id, current_decision_id)``
    so a state row cannot point at a decision that belongs to a
    different Run (migration 0005)."""
    name = (
        await db_session.execute(
            text(
                """
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'public.extraction_reviewer_states'::regclass
                  AND contype = 'f'
                  AND conname = 'fk_extraction_reviewer_states_decision_run_match'
                """
            )
        )
    ).scalar()
    assert name == "fk_extraction_reviewer_states_decision_run_match"


async def test_consensus_decisions_selected_run_match_fk(db_session: AsyncSession) -> None:
    """Contract: ``extraction_consensus_decisions.selected_decision_id`` is
    constrained by the composite FK ``(run_id, selected_decision_id)``
    (migration 0012). Prevents a consensus row from "selecting" a
    reviewer decision from a different run."""
    name = (
        await db_session.execute(
            text(
                """
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'public.extraction_consensus_decisions'::regclass
                  AND contype = 'f'
                  AND conname = 'fk_extraction_consensus_decisions_selected_run_match'
                """
            )
        )
    ).scalar()
    assert name == "fk_extraction_consensus_decisions_selected_run_match"


async def test_project_extraction_templates_composite_unique_id_kind(
    db_session: AsyncSession,
) -> None:
    """Contract: ``(id, kind)`` is unique on ``project_extraction_templates``
    — paired with the composite FK ``extraction_runs(template_id, kind) →
    project_extraction_templates(id, kind)`` so a Run cannot point at a
    template of a different kind (the "QA Run referencing an extraction
    template" class of bugs)."""
    name = (
        await db_session.execute(
            text(
                """
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'public.project_extraction_templates'::regclass
                  AND contype = 'u'
                  AND conname = 'uq_project_extraction_templates_id_kind'
                """
            )
        )
    ).scalar()
    assert name == "uq_project_extraction_templates_id_kind"


# ==================================================================
# Enum integrity — frontend and Python enum unions must match
# ==================================================================


async def test_template_kind_enum_values(db_session: AsyncSession) -> None:
    """Contract: ``template_kind = {extraction, quality_assessment}``.
    Frontend's ``HITLKind`` Zod / TS union mirrors this exactly."""
    values = (
        await db_session.execute(
            text(
                """
                SELECT enumlabel FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'template_kind'
                ORDER BY e.enumsortorder
                """
            )
        )
    ).scalars().all()
    assert set(values) == {"extraction", "quality_assessment"}


async def test_extraction_run_stage_enum_values(db_session: AsyncSession) -> None:
    """Contract: ``extraction_run_stage`` has the exact 6 lifecycle stages
    the frontend uses to gate the UI ("Submit for review" only shows on
    PROPOSAL, "Publish assessment" only on CONSENSUS, etc.)."""
    values = (
        await db_session.execute(
            text(
                """
                SELECT enumlabel FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'extraction_run_stage'
                ORDER BY e.enumsortorder
                """
            )
        )
    ).scalars().all()
    assert list(values) == [
        "pending",
        "proposal",
        "review",
        "consensus",
        "finalized",
        "cancelled",
    ]


async def test_extraction_reviewer_decision_enum_values(db_session: AsyncSession) -> None:
    """Contract: reviewer can only ``accept_proposal``, ``reject``, or
    ``edit``. Changes here cascade into ``aiSuggestionService`` and the
    consensus check."""
    values = (
        await db_session.execute(
            text(
                """
                SELECT enumlabel FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'extraction_reviewer_decision'
                ORDER BY e.enumsortorder
                """
            )
        )
    ).scalars().all()
    assert set(values) == {"accept_proposal", "reject", "edit"}


async def test_extracted_values_table_is_dropped(db_session: AsyncSession) -> None:
    """Contract: ``extracted_values`` was removed in migration 0002. Any
    code path that recreates it would silently bypass the new HITL
    write surface (ReviewerDecision + PublishedState)."""
    exists = (
        await db_session.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'extracted_values')"
            )
        )
    ).scalar()
    assert exists is False


async def test_ai_suggestions_table_is_dropped(db_session: AsyncSession) -> None:
    """Contract: ``ai_suggestions`` was removed alongside its
    ``suggestion_status`` enum. AI proposals now live in
    ``extraction_proposal_records`` with ``source='ai'``; resurrecting the
    legacy table would let two separate read paths drift."""
    exists = (
        await db_session.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'ai_suggestions')"
            )
        )
    ).scalar()
    assert exists is False


# ==================================================================
# Partial unique index that closes the multi-active gap
# ==================================================================


async def test_partial_unique_index_scoped_to_extraction_kind(
    db_session: AsyncSession,
) -> None:
    """Contract: the partial unique index applies only to
    ``kind = 'extraction'`` so PROBAST + QUADAS-2 still coexist. Drop
    the predicate by mistake and you would lock QA to one active too,
    silently breaking the QA workflow."""
    definition = (
        await db_session.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'uq_one_active_extraction_template_per_project'"
            )
        )
    ).scalar()
    assert definition is not None
    assert "kind = 'extraction'" in definition
    assert "WHERE" in definition  # partial, not full
