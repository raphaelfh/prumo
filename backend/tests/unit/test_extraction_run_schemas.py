"""Pure validation tests for app.schemas.extraction_run."""

import types
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.extraction_run import (
    AdvanceStageRequest,
    ConsensusDecisionResponse,
    ConsensusResultResponse,
    CreateConsensusRequest,
    CreateDecisionRequest,
    CreateProposalRequest,
    CreateRunRequest,
    ProposalRecordResponse,
    PublishedStateResponse,
    ReviewerDecisionResponse,
    RunDetailResponse,
    RunReviewerProfile,
    RunReviewersResponse,
    RunSummaryResponse,
    RunViewCurrentValue,
    RunViewEntityType,
    RunViewField,
    RunViewResponse,
)

NOW = datetime(2026, 6, 13, 12, 0, 0, tzinfo=UTC)


# --------------------------------------------------------------------------- #
# CreateRunRequest
# --------------------------------------------------------------------------- #
class TestCreateRunRequest:
    def test_valid_minimal(self) -> None:
        req = CreateRunRequest(
            project_id=uuid4(),
            article_id=uuid4(),
            project_template_id=uuid4(),
        )
        assert req.parameters is None

    def test_valid_with_parameters(self) -> None:
        req = CreateRunRequest(
            project_id=uuid4(),
            article_id=uuid4(),
            project_template_id=uuid4(),
            parameters={"foo": "bar"},
        )
        assert req.parameters == {"foo": "bar"}

    def test_missing_required_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CreateRunRequest(project_id=uuid4(), article_id=uuid4())  # type: ignore[call-arg]

    def test_bad_uuid_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CreateRunRequest(
                project_id="not-a-uuid",  # type: ignore[arg-type]
                article_id=uuid4(),
                project_template_id=uuid4(),
            )


# --------------------------------------------------------------------------- #
# CreateProposalRequest  (source pattern ^(ai|human|system)$)
# --------------------------------------------------------------------------- #
class TestCreateProposalRequest:
    @staticmethod
    def _kwargs(**kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "source": "ai",
            "proposed_value": {"value": 1},
        }
        base.update(kw)
        return base

    @pytest.mark.parametrize("source", ["ai", "human", "system"])
    def test_valid_sources_accepted(self, source: str) -> None:
        req = CreateProposalRequest(**self._kwargs(source=source))
        assert req.source == source

    @pytest.mark.parametrize("source", ["robot", "AI", "human ", "", "ai|human"])
    def test_invalid_source_rejected(self, source: str) -> None:
        with pytest.raises(ValidationError):
            CreateProposalRequest(**self._kwargs(source=source))

    def test_optional_defaults(self) -> None:
        req = CreateProposalRequest(**self._kwargs())
        assert req.source_user_id is None
        assert req.confidence_score is None
        assert req.rationale is None

    def test_all_optionals_populated(self) -> None:
        uid = uuid4()
        req = CreateProposalRequest(
            **self._kwargs(source_user_id=uid, confidence_score=0.9, rationale="why")
        )
        assert req.source_user_id == uid
        assert req.confidence_score == 0.9
        assert req.rationale == "why"

    def test_missing_proposed_value_rejected(self) -> None:
        kwargs = self._kwargs()
        del kwargs["proposed_value"]
        with pytest.raises(ValidationError):
            CreateProposalRequest(**kwargs)


# --------------------------------------------------------------------------- #
# CreateDecisionRequest  (decision pattern ^(accept_proposal|reject|edit)$)
# --------------------------------------------------------------------------- #
class TestCreateDecisionRequest:
    @staticmethod
    def _kwargs(**kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "decision": "accept_proposal",
        }
        base.update(kw)
        return base

    @pytest.mark.parametrize("decision", ["accept_proposal", "reject", "edit"])
    def test_valid_decisions_accepted(self, decision: str) -> None:
        req = CreateDecisionRequest(**self._kwargs(decision=decision))
        assert req.decision == decision

    @pytest.mark.parametrize("decision", ["accept", "rejected", "EDIT", "", "accept_proposalx"])
    def test_invalid_decision_rejected(self, decision: str) -> None:
        with pytest.raises(ValidationError):
            CreateDecisionRequest(**self._kwargs(decision=decision))

    def test_optional_defaults(self) -> None:
        req = CreateDecisionRequest(**self._kwargs())
        assert req.proposal_record_id is None
        assert req.value is None
        assert req.rationale is None

    def test_optionals_populated(self) -> None:
        pid = uuid4()
        req = CreateDecisionRequest(
            **self._kwargs(decision="edit", proposal_record_id=pid, value={"v": 2}, rationale="r")
        )
        assert req.proposal_record_id == pid
        assert req.value == {"v": 2}


# --------------------------------------------------------------------------- #
# CreateConsensusRequest  (mode pattern ^(select_existing|manual_override)$)
# --------------------------------------------------------------------------- #
class TestCreateConsensusRequest:
    @staticmethod
    def _kwargs(**kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "mode": "select_existing",
        }
        base.update(kw)
        return base

    @pytest.mark.parametrize("mode", ["select_existing", "manual_override"])
    def test_valid_modes_accepted(self, mode: str) -> None:
        req = CreateConsensusRequest(**self._kwargs(mode=mode))
        assert req.mode == mode

    @pytest.mark.parametrize("mode", ["select", "override", "manual", "", "select_existingx"])
    def test_invalid_mode_rejected(self, mode: str) -> None:
        with pytest.raises(ValidationError):
            CreateConsensusRequest(**self._kwargs(mode=mode))

    def test_optional_defaults(self) -> None:
        req = CreateConsensusRequest(**self._kwargs())
        assert req.selected_decision_id is None
        assert req.value is None
        assert req.rationale is None

    def test_optionals_populated(self) -> None:
        did = uuid4()
        req = CreateConsensusRequest(
            **self._kwargs(mode="manual_override", selected_decision_id=did, value={"v": 3})
        )
        assert req.selected_decision_id == did
        assert req.value == {"v": 3}


# --------------------------------------------------------------------------- #
# AdvanceStageRequest
# (target_stage pattern ^(pending|extract|consensus|finalized|cancelled)$)
# --------------------------------------------------------------------------- #
class TestAdvanceStageRequest:
    @pytest.mark.parametrize(
        "stage",
        ["pending", "extract", "consensus", "finalized", "cancelled"],
    )
    def test_valid_stages_accepted(self, stage: str) -> None:
        req = AdvanceStageRequest(target_stage=stage)
        assert req.target_stage == stage

    @pytest.mark.parametrize(
        "stage",
        ["canceled", "done", "PENDING", "", "finalised", "review "],
    )
    def test_invalid_stage_rejected(self, stage: str) -> None:
        with pytest.raises(ValidationError):
            AdvanceStageRequest(target_stage=stage)

    def test_missing_target_stage_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AdvanceStageRequest()  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# ProposalRecordResponse (from_attributes)
# --------------------------------------------------------------------------- #
class TestProposalRecordResponse:
    @staticmethod
    def _ns(**kw: object) -> types.SimpleNamespace:
        base: dict[str, object] = {
            "id": uuid4(),
            "run_id": uuid4(),
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "source": "ai",
            "source_user_id": None,
            "proposed_value": {"value": 1},
            "confidence_score": None,
            "rationale": None,
            "created_at": NOW,
        }
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_from_attributes(self) -> None:
        resp = ProposalRecordResponse.model_validate(self._ns())
        assert resp.source == "ai"
        assert resp.proposed_value == {"value": 1}

    def test_from_attributes_with_optionals(self) -> None:
        uid = uuid4()
        resp = ProposalRecordResponse.model_validate(
            self._ns(source_user_id=uid, confidence_score=0.5, rationale="r")
        )
        assert resp.source_user_id == uid
        assert resp.confidence_score == 0.5

    def test_missing_required_attr_rejected(self) -> None:
        ns = self._ns()
        del ns.source
        with pytest.raises(ValidationError):
            ProposalRecordResponse.model_validate(ns)


# --------------------------------------------------------------------------- #
# ReviewerDecisionResponse (from_attributes)
# --------------------------------------------------------------------------- #
class TestReviewerDecisionResponse:
    @staticmethod
    def _ns(**kw: object) -> types.SimpleNamespace:
        base: dict[str, object] = {
            "id": uuid4(),
            "run_id": uuid4(),
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "reviewer_id": uuid4(),
            "decision": "accept_proposal",
            "proposal_record_id": None,
            "value": None,
            "rationale": None,
            "created_at": NOW,
        }
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_from_attributes(self) -> None:
        resp = ReviewerDecisionResponse.model_validate(self._ns())
        assert resp.decision == "accept_proposal"

    def test_from_attributes_with_value(self) -> None:
        resp = ReviewerDecisionResponse.model_validate(self._ns(value={"v": 1}, decision="edit"))
        assert resp.value == {"v": 1}


# --------------------------------------------------------------------------- #
# ConsensusDecisionResponse (from_attributes)
# --------------------------------------------------------------------------- #
class TestConsensusDecisionResponse:
    @staticmethod
    def _ns(**kw: object) -> types.SimpleNamespace:
        base: dict[str, object] = {
            "id": uuid4(),
            "run_id": uuid4(),
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "consensus_user_id": uuid4(),
            "mode": "select_existing",
            "selected_decision_id": None,
            "value": None,
            "rationale": None,
            "created_at": NOW,
        }
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_from_attributes(self) -> None:
        resp = ConsensusDecisionResponse.model_validate(self._ns())
        assert resp.mode == "select_existing"


# --------------------------------------------------------------------------- #
# PublishedStateResponse (from_attributes)
# --------------------------------------------------------------------------- #
class TestPublishedStateResponse:
    @staticmethod
    def _ns(**kw: object) -> types.SimpleNamespace:
        base: dict[str, object] = {
            "id": uuid4(),
            "run_id": uuid4(),
            "instance_id": uuid4(),
            "field_id": uuid4(),
            "value": {"value": 7},
            "published_at": NOW,
            "published_by": uuid4(),
            "version": 1,
        }
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_from_attributes(self) -> None:
        resp = PublishedStateResponse.model_validate(self._ns())
        assert resp.version == 1
        assert resp.value == {"value": 7}

    def test_version_coerced_from_str(self) -> None:
        resp = PublishedStateResponse.model_validate(self._ns(version="3"))
        assert resp.version == 3


# --------------------------------------------------------------------------- #
# ConsensusResultResponse (nested)
# --------------------------------------------------------------------------- #
def _consensus_resp() -> ConsensusDecisionResponse:
    return ConsensusDecisionResponse.model_validate(
        types.SimpleNamespace(
            id=uuid4(),
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            consensus_user_id=uuid4(),
            mode="manual_override",
            selected_decision_id=None,
            value={"v": 1},
            rationale=None,
            created_at=NOW,
        )
    )


def _published_resp() -> PublishedStateResponse:
    return PublishedStateResponse.model_validate(
        types.SimpleNamespace(
            id=uuid4(),
            run_id=uuid4(),
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"value": 7},
            published_at=NOW,
            published_by=uuid4(),
            version=2,
        )
    )


class TestConsensusResultResponse:
    def test_valid_construction(self) -> None:
        result = ConsensusResultResponse(consensus=_consensus_resp(), published=_published_resp())
        assert result.consensus.mode == "manual_override"
        assert result.published.version == 2

    def test_missing_published_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ConsensusResultResponse(consensus=_consensus_resp())  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# RunSummaryResponse (from_attributes)
# --------------------------------------------------------------------------- #
def _run_summary_ns(**kw: object) -> types.SimpleNamespace:
    base: dict[str, object] = {
        "id": uuid4(),
        "project_id": uuid4(),
        "article_id": uuid4(),
        "template_id": uuid4(),
        "kind": "extraction",
        "version_id": uuid4(),
        "stage": "extract",
        "status": "running",
        "hitl_config_snapshot": {"reviewer_count": 1},
        "parameters": {},
        "results": {},
        "created_at": NOW,
        "created_by": uuid4(),
    }
    base.update(kw)
    return types.SimpleNamespace(**base)


class TestRunSummaryResponse:
    def test_from_attributes(self) -> None:
        resp = RunSummaryResponse.model_validate(_run_summary_ns())
        assert resp.kind == "extraction"
        assert resp.stage == "extract"

    def test_missing_required_attr_rejected(self) -> None:
        ns = _run_summary_ns()
        del ns.hitl_config_snapshot
        with pytest.raises(ValidationError):
            RunSummaryResponse.model_validate(ns)


# --------------------------------------------------------------------------- #
# RunDetailResponse (nested lists)
# --------------------------------------------------------------------------- #
class TestRunDetailResponse:
    def test_valid_empty_lists(self) -> None:
        resp = RunDetailResponse(
            run=RunSummaryResponse.model_validate(_run_summary_ns()),
            proposals=[],
            decisions=[],
            consensus_decisions=[],
            published_states=[],
        )
        assert resp.proposals == []

    def test_missing_run_rejected(self) -> None:
        with pytest.raises(ValidationError):
            RunDetailResponse(  # type: ignore[call-arg]
                proposals=[],
                decisions=[],
                consensus_decisions=[],
                published_states=[],
            )


# --------------------------------------------------------------------------- #
# RunViewField (from_attributes, defaults)
# --------------------------------------------------------------------------- #
class TestRunViewField:
    @staticmethod
    def _ns(**kw: object) -> types.SimpleNamespace:
        base: dict[str, object] = {
            "id": uuid4(),
            "name": "age",
            "label": "Age",
            "field_type": "number",
            "is_required": True,
            "sort_order": 0,
        }
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_defaults(self) -> None:
        field = RunViewField.model_validate(self._ns())
        assert field.description is None
        assert field.validation_schema is None
        assert field.allowed_values is None
        assert field.unit is None
        assert field.allowed_units is None
        assert field.llm_description is None
        assert field.allow_other is False
        assert field.other_label is None
        assert field.other_placeholder is None

    def test_full_population(self) -> None:
        field = RunViewField.model_validate(
            self._ns(
                description="d",
                validation_schema={"type": "number"},
                allowed_values=["a", "b"],
                unit="kg",
                allowed_units=["kg", "g"],
                llm_description="ll",
                allow_other=True,
                other_label="Other",
                other_placeholder="Specify",
            )
        )
        assert field.allow_other is True
        assert field.allowed_units == ["kg", "g"]

    def test_missing_required_rejected(self) -> None:
        ns = self._ns()
        del ns.field_type
        with pytest.raises(ValidationError):
            RunViewField.model_validate(ns)


# --------------------------------------------------------------------------- #
# RunViewEntityType (from_attributes, embedded fields)
# --------------------------------------------------------------------------- #
class TestRunViewEntityType:
    @staticmethod
    def _field_ns() -> types.SimpleNamespace:
        return types.SimpleNamespace(
            id=uuid4(),
            name="age",
            label="Age",
            field_type="number",
            is_required=True,
            sort_order=0,
        )

    @staticmethod
    def _ns(**kw: object) -> types.SimpleNamespace:
        base: dict[str, object] = {
            "id": uuid4(),
            "name": "patient",
            "label": "Patient",
            "cardinality": "many",
            "role": "study",
            "sort_order": 0,
            "is_required": True,
            "fields": [],
        }
        base.update(kw)
        return types.SimpleNamespace(**base)

    def test_defaults(self) -> None:
        et = RunViewEntityType.model_validate(self._ns())
        assert et.description is None
        assert et.parent_entity_type_id is None
        assert et.fields == []

    def test_with_embedded_fields(self) -> None:
        et = RunViewEntityType.model_validate(self._ns(fields=[self._field_ns()]))
        assert len(et.fields) == 1
        assert isinstance(et.fields[0], RunViewField)
        assert et.fields[0].name == "age"


# --------------------------------------------------------------------------- #
# RunViewCurrentValue (no from_attributes)
# --------------------------------------------------------------------------- #
class TestRunViewCurrentValue:
    def test_valid_with_value(self) -> None:
        cv = RunViewCurrentValue(
            instance_id=uuid4(),
            field_id=uuid4(),
            value={"value": 1, "unit": "kg"},
            decision="accept_proposal",
        )
        assert cv.value == {"value": 1, "unit": "kg"}

    def test_valid_null_value(self) -> None:
        cv = RunViewCurrentValue(
            instance_id=uuid4(),
            field_id=uuid4(),
            value=None,
            decision="pending",
        )
        assert cv.value is None

    def test_missing_decision_rejected(self) -> None:
        with pytest.raises(ValidationError):
            RunViewCurrentValue(  # type: ignore[call-arg]
                instance_id=uuid4(),
                field_id=uuid4(),
                value=None,
            )


# --------------------------------------------------------------------------- #
# RunViewResponse (subclass of RunDetailResponse)
# --------------------------------------------------------------------------- #
class TestRunViewResponse:
    def test_valid_construction(self) -> None:
        resp = RunViewResponse(
            run=RunSummaryResponse.model_validate(_run_summary_ns()),
            proposals=[],
            decisions=[],
            consensus_decisions=[],
            published_states=[],
            entity_types=[],
            current_values=[],
            instances=[],
        )
        assert resp.entity_types == []
        assert resp.current_values == []
        assert resp.instances == []

    def test_inherits_detail_requirements(self) -> None:
        with pytest.raises(ValidationError):
            RunViewResponse(  # type: ignore[call-arg]
                run=RunSummaryResponse.model_validate(_run_summary_ns()),
                proposals=[],
                decisions=[],
                consensus_decisions=[],
                published_states=[],
            )

    def test_with_nested_view_data(self) -> None:
        et = RunViewEntityType.model_validate(
            types.SimpleNamespace(
                id=uuid4(),
                name="patient",
                label="Patient",
                cardinality="many",
                role="study",
                sort_order=0,
                is_required=True,
                fields=[],
            )
        )
        cv = RunViewCurrentValue(
            instance_id=uuid4(), field_id=uuid4(), value=None, decision="review"
        )
        resp = RunViewResponse(
            run=RunSummaryResponse.model_validate(_run_summary_ns()),
            proposals=[],
            decisions=[],
            consensus_decisions=[],
            published_states=[],
            entity_types=[et],
            current_values=[cv],
            instances=[],
        )
        assert resp.entity_types[0].name == "patient"
        assert resp.current_values[0].decision == "review"


# --------------------------------------------------------------------------- #
# RunReviewerProfile (defaults)
# --------------------------------------------------------------------------- #
class TestRunReviewerProfile:
    def test_defaults(self) -> None:
        prof = RunReviewerProfile(id=uuid4())
        assert prof.full_name is None
        assert prof.avatar_url is None

    def test_full_population(self) -> None:
        prof = RunReviewerProfile(id=uuid4(), full_name="Jane", avatar_url="http://x/a.png")
        assert prof.full_name == "Jane"
        assert prof.avatar_url == "http://x/a.png"

    def test_missing_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            RunReviewerProfile()  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# RunReviewersResponse
# --------------------------------------------------------------------------- #
class TestRunReviewersResponse:
    def test_empty(self) -> None:
        resp = RunReviewersResponse(reviewers=[])
        assert resp.reviewers == []

    def test_with_profiles(self) -> None:
        resp = RunReviewersResponse(reviewers=[RunReviewerProfile(id=uuid4(), full_name="A")])
        assert resp.reviewers[0].full_name == "A"

    def test_missing_reviewers_rejected(self) -> None:
        with pytest.raises(ValidationError):
            RunReviewersResponse()  # type: ignore[call-arg]
