"""Pure-validation unit tests for ``app.schemas.extraction``.

Targets the validation surface NOT already covered by
``test_typed_envelope_schemas.py`` (which pins the discriminated
``SectionExtractionResponseData`` union + wire shapes of
``SingleSectionResult`` / ``BatchSectionResult`` / ``SectionOutcome`` /
``ModelExtractionResult``). Here we exercise constraints, cross-field
``model_validator``s, Literal fields, camelCase aliases, the
``CitationAnchor`` discriminated union, ``PositionV1`` and the
``parse_position`` helper.

No DB, no async, no fixtures — these run in milliseconds.
"""

from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.extraction import (
    BatchSectionResult,
    CitationAnchor,
    CreatedModelInfo,
    CreateInstanceRequest,
    CreateModelHierarchyRequest,
    CreateModelHierarchyResponse,
    EvidencePassage,
    ExtractionEntityTypeSchema,
    ExtractionFieldSchema,
    ExtractionOptions,
    ExtractionTemplateSchema,
    FieldSuggestion,
    HybridCitationAnchor,
    IdentifiedModel,
    InstanceResponse,
    ModelExtractionRequest,
    ModelExtractionResult,
    ModelExtractionRunStats,
    ModelHierarchyChildResponse,
    PDFRect,
    PDFTextRange,
    PositionV1,
    RegionCitationAnchor,
    ReviewSuggestionRequest,
    SaveValueRequest,
    SectionExtractionRequest,
    SectionOutcome,
    SingleSectionResult,
    SuggestionResponse,
    TextCitationAnchor,
    ValueResponse,
    parse_position,
)

CITATION_UNION = TypeAdapter(CitationAnchor)


# =================== ExtractionOptions ===================


class TestExtractionOptions:
    def test_defaults(self) -> None:
        opts = ExtractionOptions()
        assert opts.model == "gpt-4o-mini"
        assert opts.temperature == 0.1
        assert opts.max_tokens is None

    def test_temperature_bounds_just_inside(self) -> None:
        assert ExtractionOptions(temperature=0).temperature == 0
        assert ExtractionOptions(temperature=2).temperature == 2

    def test_temperature_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionOptions(temperature=-0.0001)

    def test_temperature_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionOptions(temperature=2.0001)

    def test_max_tokens_bounds_just_inside(self) -> None:
        assert ExtractionOptions(max_tokens=100).max_tokens == 100
        assert ExtractionOptions(max_tokens=16000).max_tokens == 16000

    def test_max_tokens_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionOptions(max_tokens=99)

    def test_max_tokens_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionOptions(max_tokens=16001)


# =================== EvidencePassage ===================


class TestEvidencePassage:
    def test_minimal_construction(self) -> None:
        ev = EvidencePassage(text="hello")
        assert ev.text == "hello"
        assert ev.page_number is None
        assert ev.confidence is None

    def test_confidence_bounds_just_inside(self) -> None:
        assert EvidencePassage(text="x", confidence=0).confidence == 0
        assert EvidencePassage(text="x", confidence=1).confidence == 1

    def test_confidence_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            EvidencePassage(text="x", confidence=-0.01)

    def test_confidence_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            EvidencePassage(text="x", confidence=1.01)

    def test_missing_text_rejected(self) -> None:
        with pytest.raises(ValidationError):
            EvidencePassage()  # type: ignore[call-arg]


# =================== FieldSuggestion ===================


class TestFieldSuggestion:
    def test_construct_from_camel_alias(self) -> None:
        fid = uuid4()
        fs = FieldSuggestion(
            fieldId=fid,
            fieldName="age",
            suggestedValue=42,
            confidenceScore=0.9,
        )
        assert fs.field_id == fid
        assert fs.field_name == "age"
        assert fs.suggested_value == 42

    def test_construct_from_snake_name(self) -> None:
        fid = uuid4()
        fs = FieldSuggestion(
            field_id=fid,
            field_name="age",
            suggested_value=42,
        )
        assert fs.field_id == fid
        assert fs.confidence_score is None
        assert fs.evidence == []

    def test_dump_by_alias_is_camel(self) -> None:
        fs = FieldSuggestion(
            field_id=uuid4(),
            field_name="age",
            suggested_value=42,
            confidence_score=0.5,
        )
        wire = fs.model_dump(by_alias=True)
        assert "fieldId" in wire
        assert "fieldName" in wire
        assert "suggestedValue" in wire
        assert "confidenceScore" in wire

    def test_confidence_bounds_just_inside(self) -> None:
        base = {"field_id": uuid4(), "field_name": "x", "suggested_value": 1}
        assert FieldSuggestion(**base, confidence_score=0).confidence_score == 0
        assert FieldSuggestion(**base, confidence_score=1).confidence_score == 1

    def test_confidence_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FieldSuggestion(
                field_id=uuid4(),
                field_name="x",
                suggested_value=1,
                confidence_score=-0.01,
            )

    def test_confidence_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FieldSuggestion(
                field_id=uuid4(),
                field_name="x",
                suggested_value=1,
                confidence_score=1.01,
            )


# =================== SectionExtractionRequest ===================


def _section_req_base(**kw: object) -> dict[str, object]:
    base: dict[str, object] = {
        "projectId": uuid4(),
        "articleId": uuid4(),
        "templateId": uuid4(),
    }
    base.update(kw)
    return base


class TestSectionExtractionRequest:
    def test_qa_mode_run_id_skips_other_checks(self) -> None:
        # Branch (a): run_id present => QA mode, no entity_type_id /
        # parent_instance_id required even with extract_all_sections=True.
        req = SectionExtractionRequest(**_section_req_base(runId=uuid4(), extractAllSections=True))
        assert req.run_id is not None
        assert req.entity_type_id is None
        assert req.parent_instance_id is None

    def test_batch_requires_parent_instance_id(self) -> None:
        # Branch (b) happy path.
        req = SectionExtractionRequest(
            **_section_req_base(extractAllSections=True, parentInstanceId=uuid4())
        )
        assert req.extract_all_sections is True
        assert req.parent_instance_id is not None

    def test_batch_missing_parent_instance_id_rejected(self) -> None:
        with pytest.raises(ValidationError) as exc:
            SectionExtractionRequest(**_section_req_base(extractAllSections=True))
        assert "parentInstanceId is required" in str(exc.value)

    def test_single_requires_entity_type_id(self) -> None:
        # Branch (c) happy path.
        req = SectionExtractionRequest(**_section_req_base(entityTypeId=uuid4()))
        assert req.extract_all_sections is False
        assert req.entity_type_id is not None

    def test_single_missing_entity_type_id_rejected(self) -> None:
        with pytest.raises(ValidationError) as exc:
            SectionExtractionRequest(**_section_req_base())
        assert "entityTypeId is required" in str(exc.value)

    def test_alias_and_default_flags(self) -> None:
        req = SectionExtractionRequest(**_section_req_base(entityTypeId=uuid4()))
        assert req.auto_advance_to_review is True
        assert req.skip_fields_with_human_proposals is False
        assert req.model == "gpt-4o-mini"

    def test_dump_by_alias_is_camel(self) -> None:
        req = SectionExtractionRequest(**_section_req_base(entityTypeId=uuid4()))
        wire = req.model_dump(by_alias=True)
        assert "projectId" in wire
        assert "extractAllSections" in wire
        assert "autoAdvanceToReview" in wire
        assert "skipFieldsWithHumanProposals" in wire


# =================== PDFTextRange ===================


class TestPDFTextRange:
    def test_construct_from_camel_alias(self) -> None:
        r = PDFTextRange(page=1, charStart=0, charEnd=10)
        assert r.char_start == 0
        assert r.char_end == 10

    def test_construct_from_snake_name(self) -> None:
        r = PDFTextRange(page=2, char_start=3, char_end=3)
        assert r.char_start == 3

    def test_page_min_just_inside(self) -> None:
        assert PDFTextRange(page=1, charStart=0, charEnd=0).page == 1

    def test_page_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PDFTextRange(page=0, charStart=0, charEnd=0)

    def test_char_start_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PDFTextRange(page=1, charStart=-1, charEnd=0)

    def test_char_end_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PDFTextRange(page=1, charStart=0, charEnd=-1)

    def test_equal_range_accepted(self) -> None:
        r = PDFTextRange(page=1, charStart=5, charEnd=5)
        assert r.char_start == r.char_end

    def test_greater_range_accepted(self) -> None:
        r = PDFTextRange(page=1, charStart=5, charEnd=9)
        assert r.char_end > r.char_start

    def test_end_before_start_rejected(self) -> None:
        with pytest.raises(ValidationError) as exc:
            PDFTextRange(page=1, charStart=10, charEnd=9)
        assert "charEnd must be >= charStart" in str(exc.value)

    def test_dump_by_alias_is_camel(self) -> None:
        wire = PDFTextRange(page=1, char_start=0, char_end=4).model_dump(by_alias=True)
        assert "charStart" in wire
        assert "charEnd" in wire


# =================== PDFRect ===================


class TestPDFRect:
    def test_construction(self) -> None:
        rect = PDFRect(x=1.0, y=2.0, width=3.0, height=4.0)
        assert rect.x == 1.0
        assert rect.height == 4.0

    def test_missing_field_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PDFRect(x=1.0, y=2.0, width=3.0)  # type: ignore[call-arg]


# =================== CitationAnchor discriminated union ===================


class TestCitationAnchorUnion:
    def test_text_kind_resolves(self) -> None:
        anchor = CITATION_UNION.validate_python(
            {
                "kind": "text",
                "range": {"page": 1, "charStart": 0, "charEnd": 5},
                "quote": "hi",
            }
        )
        assert isinstance(anchor, TextCitationAnchor)

    def test_region_kind_resolves(self) -> None:
        anchor = CITATION_UNION.validate_python(
            {
                "kind": "region",
                "page": 2,
                "rect": {"x": 0, "y": 0, "width": 1, "height": 1},
            }
        )
        assert isinstance(anchor, RegionCitationAnchor)

    def test_hybrid_kind_resolves(self) -> None:
        anchor = CITATION_UNION.validate_python(
            {
                "kind": "hybrid",
                "range": {"page": 1, "charStart": 0, "charEnd": 5},
                "rect": {"x": 0, "y": 0, "width": 1, "height": 1},
                "quote": "q",
            }
        )
        assert isinstance(anchor, HybridCitationAnchor)

    def test_unknown_kind_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CITATION_UNION.validate_python({"kind": "nope"})

    def test_missing_kind_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CITATION_UNION.validate_python({"range": {"page": 1, "charStart": 0, "charEnd": 5}})

    def test_region_page_min_just_inside(self) -> None:
        anchor = CITATION_UNION.validate_python(
            {
                "kind": "region",
                "page": 1,
                "rect": {"x": 0, "y": 0, "width": 1, "height": 1},
            }
        )
        assert isinstance(anchor, RegionCitationAnchor)
        assert anchor.page == 1

    def test_region_page_below_min_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CITATION_UNION.validate_python(
                {
                    "kind": "region",
                    "page": 0,
                    "rect": {"x": 0, "y": 0, "width": 1, "height": 1},
                }
            )

    def test_hybrid_requires_quote(self) -> None:
        with pytest.raises(ValidationError):
            CITATION_UNION.validate_python(
                {
                    "kind": "hybrid",
                    "range": {"page": 1, "charStart": 0, "charEnd": 5},
                    "rect": {"x": 0, "y": 0, "width": 1, "height": 1},
                }
            )


# =================== PositionV1 + parse_position ===================


def _valid_position_dict() -> dict[str, object]:
    return {
        "version": 1,
        "anchor": {
            "kind": "text",
            "range": {"page": 1, "charStart": 0, "charEnd": 5},
        },
    }


class TestPositionV1:
    def test_round_trip_valid(self) -> None:
        pos = PositionV1.model_validate(_valid_position_dict())
        assert pos.version == 1
        assert isinstance(pos.anchor, TextCitationAnchor)
        wire = pos.model_dump(by_alias=True)
        assert wire["version"] == 1
        assert wire["anchor"]["kind"] == "text"

    def test_version_2_rejected(self) -> None:
        bad = _valid_position_dict()
        bad["version"] = 2
        with pytest.raises(ValidationError):
            PositionV1.model_validate(bad)

    def test_bad_anchor_kind_rejected(self) -> None:
        bad = _valid_position_dict()
        bad["anchor"] = {"kind": "bogus"}
        with pytest.raises(ValidationError):
            PositionV1.model_validate(bad)


class TestParsePosition:
    def test_none_returns_none(self) -> None:
        assert parse_position(None) is None

    def test_valid_dict_returns_model(self) -> None:
        pos = parse_position(_valid_position_dict())
        assert isinstance(pos, PositionV1)
        assert pos.version == 1

    def test_invalid_dict_raises(self) -> None:
        bad = _valid_position_dict()
        bad["version"] = 99
        with pytest.raises(ValidationError):
            parse_position(bad)

    def test_invalid_anchor_range_raises(self) -> None:
        # charEnd < charStart propagates through the nested validator.
        bad = {
            "version": 1,
            "anchor": {
                "kind": "text",
                "range": {"page": 1, "charStart": 10, "charEnd": 1},
            },
        }
        with pytest.raises(ValidationError):
            parse_position(bad)


# =================== Literal fields ===================


def _field_schema_kw(**kw: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": uuid4(),
        "name": "f",
        "label": "F",
        "fieldType": "text",
    }
    base.update(kw)
    return base


def _entity_type_kw(**kw: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": uuid4(),
        "name": "et",
        "label": "ET",
        "cardinality": "one",
    }
    base.update(kw)
    return base


class TestExtractionFieldSchema:
    def test_sort_order_default(self) -> None:
        f = ExtractionFieldSchema(**_field_schema_kw())
        assert f.sort_order == 0
        assert f.is_required is False

    def test_construct_from_snake(self) -> None:
        f = ExtractionFieldSchema(
            id=uuid4(),
            name="f",
            label="F",
            field_type="number",
            is_required=True,
            sort_order=3,
        )
        assert f.field_type == "number"
        assert f.sort_order == 3

    def test_dump_by_alias_is_camel(self) -> None:
        wire = ExtractionFieldSchema(**_field_schema_kw()).model_dump(by_alias=True)
        assert "fieldType" in wire
        assert "sortOrder" in wire
        assert "isRequired" in wire


class TestExtractionEntityTypeSchema:
    def test_cardinality_one_and_many(self) -> None:
        assert ExtractionEntityTypeSchema(**_entity_type_kw(cardinality="one")).cardinality == "one"
        assert (
            ExtractionEntityTypeSchema(**_entity_type_kw(cardinality="many")).cardinality == "many"
        )

    def test_cardinality_invalid_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionEntityTypeSchema(**_entity_type_kw(cardinality="zero"))

    def test_role_default(self) -> None:
        et = ExtractionEntityTypeSchema(**_entity_type_kw())
        assert et.role == "study_section"

    def test_role_all_valid_literals(self) -> None:
        for role in ("study_section", "model_container", "model_section"):
            et = ExtractionEntityTypeSchema(**_entity_type_kw(role=role))
            assert et.role == role

    def test_role_invalid_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionEntityTypeSchema(**_entity_type_kw(role="unknown_role"))

    def test_sort_order_default(self) -> None:
        et = ExtractionEntityTypeSchema(**_entity_type_kw())
        assert et.sort_order == 0
        assert et.fields == []


class TestExtractionTemplateSchema:
    def test_framework_all_valid_literals(self) -> None:
        for fw in ("CHARMS", "PICOS", "CUSTOM"):
            tpl = ExtractionTemplateSchema(
                id=uuid4(),
                name="t",
                framework=fw,
                version="1.0",
            )
            assert tpl.framework == fw

    def test_framework_invalid_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionTemplateSchema(
                id=uuid4(),
                name="t",
                framework="GRADE",
                version="1.0",
            )

    def test_entity_types_default_and_alias(self) -> None:
        tpl = ExtractionTemplateSchema(
            id=uuid4(),
            name="t",
            framework="CHARMS",
            version="1.0",
        )
        assert tpl.entity_types == []
        wire = tpl.model_dump(by_alias=True)
        assert "entityTypes" in wire


class TestSaveValueRequest:
    def test_source_default_human(self) -> None:
        v = SaveValueRequest(instanceId=uuid4(), fieldId=uuid4(), value="x")
        assert v.source == "human"

    def test_source_all_valid_literals(self) -> None:
        for src in ("human", "ai", "rule"):
            v = SaveValueRequest(
                instanceId=uuid4(),
                fieldId=uuid4(),
                value="x",
                source=src,
            )
            assert v.source == src

    def test_source_invalid_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SaveValueRequest(
                instanceId=uuid4(),
                fieldId=uuid4(),
                value="x",
                source="machine",
            )

    def test_construct_from_snake(self) -> None:
        v = SaveValueRequest(instance_id=uuid4(), field_id=uuid4(), value=1)
        assert v.evidence == []


class TestReviewSuggestionRequest:
    def test_status_valid_literals(self) -> None:
        for st in ("accepted", "rejected"):
            req = ReviewSuggestionRequest(status=st)
            assert req.status == st

    def test_status_pending_rejected(self) -> None:
        # ReviewSuggestionRequest only allows accepted/rejected (not pending).
        with pytest.raises(ValidationError):
            ReviewSuggestionRequest(status="pending")

    def test_modified_value_alias(self) -> None:
        req = ReviewSuggestionRequest(status="accepted", modifiedValue=42)
        assert req.modified_value == 42
        wire = req.model_dump(by_alias=True)
        assert "modifiedValue" in wire


# =================== Remaining public classes (construction coverage) ===================


class TestRemainingConstruction:
    def test_create_model_hierarchy_request(self) -> None:
        req = CreateModelHierarchyRequest(
            projectId=uuid4(),
            articleId=uuid4(),
            templateId=uuid4(),
            modelName="Cox PH",
        )
        assert req.model_name == "Cox PH"
        assert req.modelling_method is None

    def test_model_hierarchy_child_response(self) -> None:
        child = ModelHierarchyChildResponse(
            id=uuid4(),
            entityTypeId=uuid4(),
            parentInstanceId=uuid4(),
            label="Predictors",
        )
        assert child.label == "Predictors"

    def test_create_model_hierarchy_response(self) -> None:
        resp = CreateModelHierarchyResponse(
            modelId=uuid4(),
            modelLabel="Model A",
            childInstances=[],
        )
        assert resp.proposal_run_id is None
        assert resp.child_instances == []

    def test_model_extraction_request(self) -> None:
        req = ModelExtractionRequest(
            projectId=uuid4(),
            articleId=uuid4(),
            templateId=uuid4(),
        )
        assert req.model == "gpt-4o-mini"
        assert req.options is None

    def test_identified_model(self) -> None:
        m = IdentifiedModel(modelName="Logistic")
        assert m.performance_metrics == {}
        assert m.model_type is None

    def test_created_model_info(self) -> None:
        info = CreatedModelInfo(instanceId="i1", modelName="Cox")
        assert info.instance_id == "i1"

    def test_model_extraction_run_stats(self) -> None:
        stats = ModelExtractionRunStats(
            duration=1,
            modelsFound=2,
            tokensPrompt=3,
            tokensCompletion=4,
            tokensTotal=7,
        )
        assert stats.tokens_total == 7

    def test_create_instance_request(self) -> None:
        req = CreateInstanceRequest(
            projectId=uuid4(),
            articleId=uuid4(),
            templateId=uuid4(),
            entityTypeId=uuid4(),
            label="Instance 1",
        )
        assert req.metadata == {}
        assert req.parent_instance_id is None

    def test_instance_response_from_camel(self) -> None:
        now = "2026-06-13T00:00:00Z"
        resp = InstanceResponse(
            id=uuid4(),
            projectId=uuid4(),
            templateId=uuid4(),
            entityTypeId=uuid4(),
            label="L",
            sortOrder=0,
            createdAt=now,
            updatedAt=now,
        )
        assert resp.article_id is None

    def test_value_response_from_camel(self) -> None:
        now = "2026-06-13T00:00:00Z"
        resp = ValueResponse(
            id=uuid4(),
            instanceId=uuid4(),
            fieldId=uuid4(),
            value="v",
            source="ai",
            createdAt=now,
            updatedAt=now,
        )
        assert resp.is_consensus is False
        assert resp.confidence_score is None

    def test_suggestion_response_status_literals(self) -> None:
        now = "2026-06-13T00:00:00Z"
        for st in ("pending", "accepted", "rejected"):
            resp = SuggestionResponse(
                id=uuid4(),
                extractionRunId=uuid4(),
                fieldId=uuid4(),
                suggestedValue="v",
                status=st,
                createdAt=now,
            )
            assert resp.status == st

    def test_suggestion_response_invalid_status_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SuggestionResponse(
                id=uuid4(),
                extractionRunId=uuid4(),
                fieldId=uuid4(),
                suggestedValue="v",
                status="approved",
                createdAt="2026-06-13T00:00:00Z",
            )

    def test_section_outcome_light_construction(self) -> None:
        # Wire shape pinned in test_typed_envelope_schemas; just a smoke
        # construction here for full-class coverage.
        out = SectionOutcome(entity_type_id="et1", success=True)
        assert out.suggestions_created == 0
        assert out.skipped is False

    def test_single_section_result_light_construction(self) -> None:
        res = SingleSectionResult(
            extractionRunId="r1",
            suggestionsCreated=1,
            entityTypeId="et1",
            tokensPrompt=1,
            tokensCompletion=1,
            tokensTotal=2,
            durationMs=1.0,
        )
        assert res.mode == "single"

    def test_batch_section_result_light_construction(self) -> None:
        res = BatchSectionResult(
            extractionRunId="r1",
            totalSections=0,
            successfulSections=0,
            failedSections=0,
            totalSuggestionsCreated=0,
            totalTokensUsed=0,
            durationMs=1.0,
        )
        assert res.mode == "batch"
        assert res.sections == []

    def test_model_extraction_result_light_construction(self) -> None:
        res = ModelExtractionResult(
            extractionRunId="r1",
            modelsCreated=[],
            totalModels=0,
            childInstancesCreated=0,
            metadata=ModelExtractionRunStats(
                duration=1,
                modelsFound=0,
                tokensPrompt=0,
                tokensCompletion=0,
                tokensTotal=0,
            ),
        )
        assert res.total_models == 0
