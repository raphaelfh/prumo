"""Unit tests for extraction_workflow models (no DB)."""

from uuid import uuid4

from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionProposalRecord,
    ExtractionProposalSource,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
    ExtractionReviewerState,
)


def test_extraction_proposal_source_enum_values() -> None:
    assert ExtractionProposalSource.AI.value == "ai"
    assert ExtractionProposalSource.HUMAN.value == "human"
    assert ExtractionProposalSource.SYSTEM.value == "system"


def test_extraction_reviewer_decision_type_enum_values() -> None:
    assert ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value == "accept_proposal"
    assert ExtractionReviewerDecisionType.REJECT.value == "reject"
    assert ExtractionReviewerDecisionType.EDIT.value == "edit"


def test_extraction_consensus_mode_enum_values() -> None:
    assert ExtractionConsensusMode.SELECT_EXISTING.value == "select_existing"
    assert ExtractionConsensusMode.MANUAL_OVERRIDE.value == "manual_override"


def test_extraction_proposal_record_instantiation() -> None:
    record = ExtractionProposalRecord(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        source=ExtractionProposalSource.AI.value,
        proposed_value={"text": "candidate"},
        confidence_score=0.91,
        rationale="LLM extracted from page 4",
    )
    assert record.source == "ai"
    assert record.proposed_value == {"text": "candidate"}


def test_extraction_reviewer_decision_instantiation_accept() -> None:
    decision = ExtractionReviewerDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        reviewer_id=uuid4(),
        decision=ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value,
        proposal_record_id=uuid4(),
    )
    assert decision.decision == "accept_proposal"
    assert decision.value is None


def test_extraction_reviewer_decision_instantiation_edit() -> None:
    decision = ExtractionReviewerDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        reviewer_id=uuid4(),
        decision=ExtractionReviewerDecisionType.EDIT.value,
        value={"text": "human-edited"},
        rationale="page 5 confirms different value",
    )
    assert decision.decision == "edit"
    assert decision.value == {"text": "human-edited"}


def test_extraction_reviewer_state_instantiation() -> None:
    state = ExtractionReviewerState(
        run_id=uuid4(),
        reviewer_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        current_decision_id=uuid4(),
    )
    assert state.run_id is not None
    assert state.current_decision_id is not None


def test_extraction_consensus_decision_instantiation_select_existing() -> None:
    decision = ExtractionConsensusDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        consensus_user_id=uuid4(),
        mode=ExtractionConsensusMode.SELECT_EXISTING.value,
        selected_decision_id=uuid4(),
    )
    assert decision.mode == "select_existing"


def test_extraction_consensus_decision_instantiation_manual_override() -> None:
    decision = ExtractionConsensusDecision(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        consensus_user_id=uuid4(),
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE.value,
        value={"text": "arbitrator decision"},
        rationale="reviewers diverged; arbitrator decided X",
    )
    assert decision.mode == "manual_override"
    assert decision.value == {"text": "arbitrator decision"}


def test_extraction_published_state_instantiation() -> None:
    state = ExtractionPublishedState(
        run_id=uuid4(),
        instance_id=uuid4(),
        field_id=uuid4(),
        value={"text": "final"},
        published_by=uuid4(),
        version=1,
    )
    assert state.version == 1


def test_proposal_record_fk_uses_restrict_not_set_null() -> None:
    """Issue #22 regression: `proposal_record_id` FK must be RESTRICT.

    SET NULL would cascade into a CHECK violation for accept_proposal
    rows because `accept_has_proposal` forbids a NULL proposal id for
    that decision. RESTRICT keeps the error surface clean and prevents
    the parent proposal from being deleted while still referenced.
    """
    col = ExtractionReviewerDecision.__table__.c.proposal_record_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].ondelete == "RESTRICT"
