"""Schema-layer validation tests for the user-API-key request DTOs.

``CreateAPIKeyRequest.provider`` is constrained to ``SUPPORTED_PROVIDERS``
(the single source of truth, shared with the DB CHECK constraint) so an
unsupported provider fails with a clean 422 ``ValidationError`` at the
boundary instead of leaking out as a DB/500 at INSERT time — the repo's
"clean ApiResponse error envelope" incident class.
"""

import pytest
from pydantic import ValidationError

from app.models.user_api_key import SUPPORTED_PROVIDERS
from app.schemas.user_api_key import CreateAPIKeyRequest


class TestProviderValidation:
    @pytest.mark.parametrize("provider", SUPPORTED_PROVIDERS)
    def test_supported_provider_is_accepted(self, provider: str) -> None:
        """Every provider in the allow-list passes schema validation."""
        request = CreateAPIKeyRequest(provider=provider, apiKey="sk-1234567890")
        assert request.provider == provider

    def test_unsupported_provider_is_rejected_by_schema(self) -> None:
        """An unsupported provider fails at the Pydantic layer (→ 422).

        Pins the constrained behavior: the schema is the gate, not the DB
        CHECK constraint. (Flipped from the former permissive
        ``test_unsupported_provider_is_not_rejected_by_schema``.)
        """
        with pytest.raises(ValidationError) as exc_info:
            CreateAPIKeyRequest(provider="not-a-real-provider", apiKey="sk-1234567890")

        errors = exc_info.value.errors()
        assert any(error["loc"] == ("provider",) for error in errors)

    def test_supported_providers_is_the_single_source_of_truth(self) -> None:
        """The validator rejects a value just outside the allow-list."""
        bogus = "openai-typo"
        assert bogus not in SUPPORTED_PROVIDERS
        with pytest.raises(ValidationError):
            CreateAPIKeyRequest(provider=bogus, apiKey="sk-1234567890")
