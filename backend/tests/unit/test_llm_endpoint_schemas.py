"""C2 B2 — custom endpoint schemas: secrets never cross this boundary.

``api_key`` is a ``SecretStr`` on both request shapes so a 422 echo, a
``repr``, or a stray ``model_dump`` never leaks key material; the read
model carries ``has_api_key`` only — never the key itself. Create rejects
``api_key=""`` (a mistake, not keyless); Update accepts it (tri-state:
``None`` keeps, ``""`` clears, a string sets — semantics live in the
service).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.llm_endpoint import (
    LlmEndpointCapabilities,
    LlmEndpointCreateRequest,
    LlmEndpointRead,
    LlmEndpointUpdateRequest,
)

# ---------------------------------------------------------------------------
# LlmEndpointCreateRequest — extra=forbid + empty-key rejection
# ---------------------------------------------------------------------------


def test_create_rejects_extra_keys() -> None:
    """``extra="forbid"``: a smuggled key (temperature, kind, ...) is a 422."""
    with pytest.raises(ValidationError):
        LlmEndpointCreateRequest.model_validate(
            {
                "label": "Lab Ollama",
                "base_url": "https://llm.lab.example/v1",
                "temperature": 0.2,
            }
        )


def test_create_rejects_empty_string_api_key() -> None:
    """``api_key=""`` on create is a mistake, not a keyless endpoint."""
    with pytest.raises(ValidationError) as exc_info:
        LlmEndpointCreateRequest.model_validate(
            {
                "label": "Lab Ollama",
                "base_url": "https://llm.lab.example/v1",
                "api_key": "",
            }
        )
    assert "keyless" in str(exc_info.value)


def test_create_accepts_none_api_key_as_keyless() -> None:
    req = LlmEndpointCreateRequest.model_validate(
        {"label": "Lab Ollama", "base_url": "https://llm.lab.example/v1"}
    )
    assert req.api_key is None
    assert req.allowed_models == []


def test_create_label_bounds() -> None:
    with pytest.raises(ValidationError):
        LlmEndpointCreateRequest.model_validate(
            {"label": "", "base_url": "https://llm.lab.example/v1"}
        )
    with pytest.raises(ValidationError):
        LlmEndpointCreateRequest.model_validate(
            {"label": "x" * 81, "base_url": "https://llm.lab.example/v1"}
        )


def test_create_dump_and_repr_never_leak_the_key() -> None:
    """SecretStr masks: neither ``model_dump`` stringification nor ``repr``
    ever contains the plaintext key."""
    req = LlmEndpointCreateRequest.model_validate(
        {
            "label": "Lab Ollama",
            "base_url": "https://llm.lab.example/v1",
            "api_key": "sk-test-secret",
        }
    )
    assert req.api_key is not None
    assert req.api_key.get_secret_value() == "sk-test-secret"
    assert "sk-test" not in str(req.model_dump())
    assert "sk-test" not in repr(req)


# ---------------------------------------------------------------------------
# LlmEndpointUpdateRequest — tri-state api_key (clear semantics service-side)
# ---------------------------------------------------------------------------


def test_update_accepts_empty_string_api_key_as_clear() -> None:
    req = LlmEndpointUpdateRequest.model_validate(
        {
            "label": "Lab Ollama",
            "base_url": "https://llm.lab.example/v1",
            "api_key": "",
        }
    )
    assert req.api_key is not None
    assert req.api_key.get_secret_value() == ""


def test_update_rejects_extra_keys() -> None:
    with pytest.raises(ValidationError):
        LlmEndpointUpdateRequest.model_validate(
            {
                "label": "Lab Ollama",
                "base_url": "https://llm.lab.example/v1",
                "kind": "openai_compatible",
            }
        )


# ---------------------------------------------------------------------------
# LlmEndpointRead — never carries key material
# ---------------------------------------------------------------------------


def test_read_model_has_no_api_key_field() -> None:
    assert "api_key" not in LlmEndpointRead.model_fields
    assert not any("key" in name and name != "has_api_key" for name in LlmEndpointRead.model_fields)
    assert "has_api_key" in LlmEndpointRead.model_fields


# ---------------------------------------------------------------------------
# LlmEndpointCapabilities — defaults
# ---------------------------------------------------------------------------


def test_capabilities_defaults() -> None:
    caps = LlmEndpointCapabilities()
    assert caps.output_mode is None
    assert caps.models_seen == []


def test_capabilities_rejects_unknown_output_mode() -> None:
    with pytest.raises(ValidationError):
        LlmEndpointCapabilities.model_validate({"output_mode": "telepathy"})
