"""Golden wire-shape tests for the typed response payloads (ADR 0008).

The 9 endpoints that returned ``ApiResponse[dict[str, Any]]`` were given
concrete Pydantic models on 2026-06-10. These tests pin the wire format
each model serializes to, so the typing change can never silently alter
what the frontend receives — the exact drift class the models exist to
prevent.
"""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.extraction import (
    BatchSectionResult,
    ModelExtractionResult,
    SectionExtractionResponseData,
    SectionOutcome,
    SingleSectionResult,
)
from app.schemas.user_api_key import (
    CreateAPIKeyResponse,
    KeyValidationResult,
    ListProvidersData,
)
from app.schemas.zotero import (
    DownloadAttachmentResponse,
    SaveCredentialsResponse,
    TestConnectionResponse,
)

SECTION_UNION = TypeAdapter(SectionExtractionResponseData)


class TestCreateAPIKeyWire:
    def test_validates_snake_service_dict_and_dumps_camel(self) -> None:
        """The service returns snake_case; the wire must be camelCase.

        ApiKeysSection.tsx reads ``validationStatus`` — before the typed
        model the raw snake dict left that field undefined and the
        invalid-key toast never fired.
        """
        service_dict = {
            "id": "0b6c8d1e-0000-0000-0000-000000000001",
            "provider": "openai",
            "validation_status": "invalid",
            "validation_message": "Invalid or expired API key",
            "is_default": True,
        }
        wire = CreateAPIKeyResponse.model_validate(service_dict).model_dump(by_alias=True)
        assert wire == {
            "id": "0b6c8d1e-0000-0000-0000-000000000001",
            "provider": "openai",
            "validationStatus": "invalid",
            "validationMessage": "Invalid or expired API key",
            "isDefault": True,
        }


class TestKeyValidationWire:
    def test_accepts_service_shape(self) -> None:
        wire = KeyValidationResult.model_validate(
            {"status": "pending", "message": "Provider validation is not implemented"}
        ).model_dump()
        assert wire == {
            "status": "pending",
            "message": "Provider validation is not implemented",
        }

    def test_rejects_unknown_status(self) -> None:
        with pytest.raises(ValidationError):
            KeyValidationResult.model_validate({"status": "maybe", "message": "?"})


class TestProvidersWire:
    def test_validates_camel_literal_dicts(self) -> None:
        data = ListProvidersData.model_validate(
            {
                "providers": [
                    {
                        "id": "openai",
                        "name": "OpenAI",
                        "description": "GPT-4, GPT-4o, etc.",
                        "docsUrl": "https://platform.openai.com/api-keys",
                    }
                ]
            }
        )
        wire = data.model_dump(by_alias=True)
        assert wire["providers"][0]["docsUrl"].startswith("https://")


class TestSectionExtractionUnion:
    def test_discriminates_single_by_mode(self) -> None:
        parsed = SECTION_UNION.validate_python(
            {
                "mode": "single",
                "extractionRunId": "r1",
                "suggestionsCreated": 3,
                "entityTypeId": "et1",
                "tokensPrompt": 10,
                "tokensCompletion": 5,
                "tokensTotal": 15,
                "durationMs": 12.5,
            }
        )
        assert isinstance(parsed, SingleSectionResult)

    def test_discriminates_batch_and_types_sections(self) -> None:
        # Items mirror the two raw shapes the service appends today:
        # a success row (with counters) and a failure row (with error).
        parsed = SECTION_UNION.validate_python(
            {
                "mode": "batch",
                "extractionRunId": "r1",
                "totalSections": 2,
                "successfulSections": 1,
                "failedSections": 1,
                "totalSuggestionsCreated": 4,
                "totalTokensUsed": 99,
                "durationMs": 100.0,
                "sections": [
                    {
                        "entity_type_id": "et1",
                        "entity_type_name": "Participants",
                        "success": True,
                        "suggestions_created": 4,
                        "tokens_used": 99,
                        "skipped": False,
                    },
                    {
                        "entity_type_id": "et2",
                        "entity_type_name": "Outcome",
                        "success": False,
                        "error": "boom",
                    },
                ],
            }
        )
        assert isinstance(parsed, BatchSectionResult)
        assert all(isinstance(item, SectionOutcome) for item in parsed.sections)
        # Section items stay snake_case on the wire (preserved verbatim
        # from the pre-typing format).
        wire = parsed.model_dump(by_alias=True)
        assert "entity_type_id" in wire["sections"][0]
        assert wire["sections"][1]["error"] == "boom"


class TestModelExtractionWire:
    def test_validates_endpoint_shape_and_dumps_camel(self) -> None:
        result = ModelExtractionResult.model_validate(
            {
                "extractionRunId": "r1",
                "modelsCreated": [
                    {
                        "instanceId": "i1",
                        "modelName": "Cox PH",
                        "modellingMethod": "cox",
                    }
                ],
                "totalModels": 1,
                "childInstancesCreated": 6,
                "metadata": {
                    "duration": 1200,
                    "modelsFound": 1,
                    "tokensPrompt": 10,
                    "tokensCompletion": 20,
                    "tokensTotal": 30,
                },
            }
        )
        wire = result.model_dump(by_alias=True)
        assert wire["modelsCreated"][0]["instanceId"] == "i1"
        assert wire["metadata"]["tokensTotal"] == 30


class TestZoteroActionWire:
    def test_save_credentials_shape(self) -> None:
        wire = SaveCredentialsResponse.model_validate({"integration_id": "abc"}).model_dump()
        assert wire == {"integration_id": "abc"}

    def test_connection_failure_shape(self) -> None:
        wire = TestConnectionResponse.model_validate(
            {"success": False, "error": "401"}
        ).model_dump()
        assert wire["success"] is False
        assert wire["error"] == "401"

    def test_download_attachment_shape(self) -> None:
        wire = DownloadAttachmentResponse.model_validate(
            {
                "base64": "aGk=",
                "filename": "paper.pdf",
                "content_type": "application/pdf",
                "size": 2,
            }
        ).model_dump()
        assert wire["filename"] == "paper.pdf"
