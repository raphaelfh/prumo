"""§6: provider not in registry, host on a host-less provider, missing host,
project scope on a host-bearing provider → 422 from the schema."""

from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

from app.schemas.llm_connection import (
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
    UserConnectionCreateRequest,
)


def test_unknown_provider_is_rejected() -> None:
    with pytest.raises(ValidationError, match="provider"):
        UserConnectionCreateRequest(provider="grok", label="x", api_key=SecretStr("k"))


def test_host_on_a_hosted_provider_is_rejected() -> None:
    with pytest.raises(ValidationError, match="base_url"):
        UserConnectionCreateRequest(
            provider="openai", label="x", api_key=SecretStr("k"), base_url="https://a.example/v1"
        )


def test_missing_host_on_a_host_bearing_provider_is_rejected() -> None:
    with pytest.raises(ValidationError, match="base_url"):
        UserConnectionCreateRequest(provider="openai_compatible", label="x")


def test_missing_key_is_rejected_unless_the_provider_allows_keyless() -> None:
    with pytest.raises(ValidationError, match="api_key"):
        UserConnectionCreateRequest(provider="anthropic", label="x")
    keyless = UserConnectionCreateRequest(
        provider="openai_compatible", label="ollama", base_url="https://8.8.8.8/v1"
    )
    assert keyless.api_key is None


def test_empty_key_is_a_mistake_not_keyless() -> None:
    with pytest.raises(ValidationError, match="api_key"):
        UserConnectionCreateRequest(provider="openai", label="x", api_key=SecretStr(""))


def test_project_scope_refuses_a_host_bearing_provider() -> None:
    with pytest.raises(ValidationError, match="project"):
        ProjectConnectionCreateRequest(
            provider="openai_compatible", label="x", base_url="https://8.8.8.8/v1"
        )


def test_project_scope_accepts_llama_cloud() -> None:
    req = ProjectConnectionCreateRequest(
        provider="llama_cloud", label="parsing", api_key=SecretStr("lc")
    )
    assert req.provider == "llama_cloud"


def test_secret_never_appears_in_repr_or_dump() -> None:
    req = UserConnectionCreateRequest(provider="openai", label="x", api_key=SecretStr("sk-real"))
    assert "sk-real" not in repr(req)
    assert "sk-real" not in str(req.model_dump())


def test_update_clear_key_is_the_empty_string() -> None:
    req = LlmConnectionUpdateRequest(label="x", api_key=SecretStr(""))
    assert req.api_key is not None and req.api_key.get_secret_value() == ""
