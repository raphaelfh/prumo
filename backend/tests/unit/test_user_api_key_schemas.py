"""Pure validation tests for ``app.schemas.user_api_key``.

Wire shapes for CreateAPIKeyResponse, KeyValidationResult and
ListProvidersData are pinned in ``test_typed_envelope_schemas.py``; this
file targets the untested surface: field constraints, aliases +
populate_by_name round-trips, defaults, and the remaining response DTOs.
"""

import pytest
from pydantic import ValidationError

from app.models.user_api_key import SUPPORTED_PROVIDERS
from app.schemas.user_api_key import (
    APIKeyResponse,
    CreateAPIKeyRequest,
    CreateAPIKeyResponse,
    DeleteAPIKeyResult,
    KeyValidationResult,
    ListAPIKeysData,
    ListProvidersData,
    ProviderInfo,
    UpdateAPIKeyRequest,
    UpdateAPIKeyResult,
)


class TestCreateAPIKeyRequest:
    def test_minimal_valid_with_aliases(self) -> None:
        req = CreateAPIKeyRequest.model_validate({"provider": "openai", "apiKey": "0123456789"})
        assert req.provider == "openai"
        assert req.api_key == "0123456789"

    def test_populate_by_name_snake_case(self) -> None:
        req = CreateAPIKeyRequest.model_validate({"provider": "anthropic", "api_key": "0123456789"})
        assert req.api_key == "0123456789"

    def test_dump_by_alias_is_camel_case(self) -> None:
        req = CreateAPIKeyRequest.model_validate(
            {"provider": "gemini", "apiKey": "0123456789", "keyName": "prod"}
        )
        wire = req.model_dump(by_alias=True)
        assert wire["apiKey"] == "0123456789"
        assert wire["keyName"] == "prod"
        assert wire["isDefault"] is True
        assert wire["validateKey"] is True
        assert wire["metadata"] is None

    def test_defaults(self) -> None:
        req = CreateAPIKeyRequest.model_validate({"provider": "grok", "apiKey": "0123456789"})
        assert req.is_default is True
        assert req.validate_key is True
        assert req.key_name is None
        assert req.key_metadata is None

    def test_api_key_min_length_boundary_accepted(self) -> None:
        req = CreateAPIKeyRequest.model_validate(
            {"provider": "openai", "apiKey": "1234567890"}  # exactly 10
        )
        assert len(req.api_key) == 10

    def test_api_key_below_min_length_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CreateAPIKeyRequest.model_validate(
                {"provider": "openai", "apiKey": "123456789"}  # 9 chars
            )

    def test_key_name_max_length_boundary_accepted(self) -> None:
        req = CreateAPIKeyRequest.model_validate(
            {"provider": "openai", "apiKey": "0123456789", "keyName": "x" * 100}
        )
        assert req.key_name is not None
        assert len(req.key_name) == 100

    def test_key_name_above_max_length_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CreateAPIKeyRequest.model_validate(
                {"provider": "openai", "apiKey": "0123456789", "keyName": "x" * 101}
            )

    def test_provider_required(self) -> None:
        with pytest.raises(ValidationError):
            CreateAPIKeyRequest.model_validate({"apiKey": "0123456789"})

    @pytest.mark.parametrize("provider", list(SUPPORTED_PROVIDERS))
    def test_supported_providers_accepted(self, provider: str) -> None:
        req = CreateAPIKeyRequest.model_validate({"provider": provider, "apiKey": "0123456789"})
        assert req.provider == provider

    def test_unsupported_provider_is_rejected_by_schema(self) -> None:
        """The schema validates provider against SUPPORTED_PROVIDERS.

        A ``field_validator`` enforces the allow-list at the boundary so an
        unsupported value fails with a clean 422 ``ValidationError`` instead
        of leaking out as a DB/500 at INSERT time. ``SUPPORTED_PROVIDERS``
        (shared with the DB CHECK constraint) is the single source of truth.
        """
        with pytest.raises(ValidationError) as exc_info:
            CreateAPIKeyRequest.model_validate(
                {"provider": "not-a-real-provider", "apiKey": "0123456789"}
            )
        assert any(error["loc"] == ("provider",) for error in exc_info.value.errors())


class TestUpdateAPIKeyRequest:
    def test_all_fields_optional_empty_is_valid(self) -> None:
        req = UpdateAPIKeyRequest.model_validate({})
        assert req.is_default is None
        assert req.is_active is None
        assert req.key_name is None

    def test_aliases_and_dump(self) -> None:
        req = UpdateAPIKeyRequest.model_validate(
            {"isDefault": True, "isActive": False, "keyName": "renamed"}
        )
        assert req.is_default is True
        assert req.is_active is False
        wire = req.model_dump(by_alias=True)
        assert wire == {"isDefault": True, "isActive": False, "keyName": "renamed"}

    def test_populate_by_name(self) -> None:
        req = UpdateAPIKeyRequest.model_validate({"is_active": True})
        assert req.is_active is True

    def test_key_name_max_length_boundary_accepted(self) -> None:
        req = UpdateAPIKeyRequest.model_validate({"keyName": "y" * 100})
        assert req.key_name is not None
        assert len(req.key_name) == 100

    def test_key_name_above_max_length_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UpdateAPIKeyRequest.model_validate({"keyName": "y" * 101})


class TestAPIKeyResponse:
    def _service_dict(self) -> dict[str, object]:
        return {
            "id": "k1",
            "provider": "openai",
            "key_name": "prod",
            "is_active": True,
            "is_default": False,
            "validation_status": "valid",
            "last_used_at": "2026-06-13T00:00:00Z",
            "last_validated_at": None,
            "created_at": "2026-06-01T00:00:00Z",
        }

    def test_validates_snake_case_and_dumps_camel(self) -> None:
        resp = APIKeyResponse.model_validate(self._service_dict())
        wire = resp.model_dump(by_alias=True)
        assert wire["keyName"] == "prod"
        assert wire["isActive"] is True
        assert wire["isDefault"] is False
        assert wire["validationStatus"] == "valid"
        assert wire["lastUsedAt"] == "2026-06-13T00:00:00Z"
        assert wire["lastValidatedAt"] is None
        assert wire["createdAt"] == "2026-06-01T00:00:00Z"

    def test_populate_by_camel_alias(self) -> None:
        resp = APIKeyResponse.model_validate(
            {
                "id": "k2",
                "provider": "grok",
                "keyName": None,
                "isActive": False,
                "isDefault": True,
                "validationStatus": None,
                "lastUsedAt": None,
                "lastValidatedAt": None,
                "createdAt": "2026-06-02T00:00:00Z",
            }
        )
        assert resp.key_name is None
        assert resp.is_default is True

    def test_missing_required_field_rejected(self) -> None:
        bad = self._service_dict()
        del bad["created_at"]
        with pytest.raises(ValidationError):
            APIKeyResponse.model_validate(bad)


class TestCreateAPIKeyResponse:
    def test_construction_and_alias_round_trip(self) -> None:
        resp = CreateAPIKeyResponse.model_validate(
            {
                "id": "k1",
                "provider": "openai",
                "validation_status": "pending",
                "validation_message": None,
                "is_default": True,
            }
        )
        wire = resp.model_dump(by_alias=True)
        assert wire["validationStatus"] == "pending"
        assert wire["validationMessage"] is None
        assert wire["isDefault"] is True


class TestListAPIKeysData:
    def test_empty_list(self) -> None:
        data = ListAPIKeysData.model_validate({"keys": []})
        assert data.keys == []

    def test_nested_response_round_trip(self) -> None:
        data = ListAPIKeysData.model_validate(
            {
                "keys": [
                    {
                        "id": "k1",
                        "provider": "openai",
                        "keyName": "prod",
                        "isActive": True,
                        "isDefault": True,
                        "validationStatus": "valid",
                        "lastUsedAt": None,
                        "lastValidatedAt": None,
                        "createdAt": "2026-06-01T00:00:00Z",
                    }
                ]
            }
        )
        assert len(data.keys) == 1
        assert isinstance(data.keys[0], APIKeyResponse)
        wire = data.model_dump(by_alias=True)
        assert wire["keys"][0]["keyName"] == "prod"


class TestUpdateAPIKeyResult:
    def test_construction(self) -> None:
        result = UpdateAPIKeyResult.model_validate({"id": "k1", "updated": True})
        assert result.id == "k1"
        assert result.updated is True

    def test_missing_field_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UpdateAPIKeyResult.model_validate({"id": "k1"})


class TestDeleteAPIKeyResult:
    def test_construction(self) -> None:
        result = DeleteAPIKeyResult.model_validate({"id": "k1", "deleted": True})
        assert result.id == "k1"
        assert result.deleted is True


class TestProviderInfo:
    def test_validates_snake_and_dumps_camel(self) -> None:
        info = ProviderInfo.model_validate(
            {
                "id": "openai",
                "name": "OpenAI",
                "description": "GPT models",
                "docs_url": "https://example.com",
            }
        )
        wire = info.model_dump(by_alias=True)
        assert wire["docsUrl"] == "https://example.com"

    def test_populate_by_camel_alias(self) -> None:
        info = ProviderInfo.model_validate(
            {
                "id": "anthropic",
                "name": "Anthropic",
                "description": "Claude",
                "docsUrl": "https://example.com/docs",
            }
        )
        assert info.docs_url == "https://example.com/docs"


class TestListProvidersData:
    def test_empty_list(self) -> None:
        data = ListProvidersData.model_validate({"providers": []})
        assert data.providers == []


class TestKeyValidationResult:
    @pytest.mark.parametrize("status", ["valid", "invalid", "pending"])
    def test_valid_literal_values(self, status: str) -> None:
        result = KeyValidationResult.model_validate({"status": status, "message": "m"})
        assert result.status == status

    def test_invalid_literal_rejected(self) -> None:
        with pytest.raises(ValidationError):
            KeyValidationResult.model_validate({"status": "expired", "message": "m"})

    def test_message_required(self) -> None:
        with pytest.raises(ValidationError):
            KeyValidationResult.model_validate({"status": "valid"})
