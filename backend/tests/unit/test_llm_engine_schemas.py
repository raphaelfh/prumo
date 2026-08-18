"""T2 — the LlmEngineStored spine + the PUT request schema (C1b).

The stored shape is ONE typed spine, written via ``.model_dump(mode="json")``
at the single write site and ``model_validate``d at the two read boundaries.
The request schema types ``mode: Literal["fast", "verified"]`` — the write
gate is a closed enum, while the STORED mode is a plain ``str`` (an old
reader must never degrade a project to the env default over a mode it does
not know; reads normalize unknown modes to "fast" instead).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.llm_engine import (
    LlmEngineRead,
    LlmEngineStored,
    LlmEngineUpdateRequest,
)

# ---------------------------------------------------------------------------
# LlmEngineStored — the persisted spine
# ---------------------------------------------------------------------------


def test_stored_minimal_payload_validates_with_defaults() -> None:
    """An older / minimal payload (pair only) validates: every non-identity
    field carries a default, so a schema widening never bricks stored rows."""
    stored = LlmEngineStored.model_validate({"provider": "openai", "model": "gpt-4o-mini"})
    assert stored.mode == "fast"
    assert stored.updated_by is None
    assert stored.updated_at is None
    assert stored.previous_model is None


def test_stored_dump_json_is_flush_safe() -> None:
    """``updated_at`` is a datetime — ``model_dump(mode="json")`` must produce
    a JSON-serialisable dict (a hand-rolled dict dies in json.dumps at flush)."""
    import json

    stored = LlmEngineStored(
        provider="openai",
        model="gpt-4o",
        updated_by=uuid4(),
        updated_at=datetime.now(UTC),
        previous_model="gpt-4o-mini",
    )
    dumped = stored.model_dump(mode="json")
    json.dumps(dumped)  # must not raise
    assert isinstance(dumped["updated_at"], str)
    assert isinstance(dumped["updated_by"], str)


def test_stored_roundtrips_through_its_json_dump() -> None:
    stored = LlmEngineStored(
        provider="anthropic",
        model="claude-sonnet-4-5",
        updated_by=uuid4(),
        updated_at=datetime.now(UTC),
    )
    assert LlmEngineStored.model_validate(stored.model_dump(mode="json")) == stored


# ---------------------------------------------------------------------------
# LlmEngineUpdateRequest — the PUT body
# ---------------------------------------------------------------------------


def test_request_accepts_verified_mode() -> None:
    # Verified shipped: the write gate's Literal widened to the closed pair.
    body = LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini", mode="verified")
    assert body.mode == "verified"


def test_request_still_refuses_unknown_modes() -> None:
    with pytest.raises(ValidationError) as exc:
        LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini", mode="turbo")
    assert any(e["loc"] == ("mode",) for e in exc.value.errors())


def test_stored_mode_is_a_plain_str() -> None:
    # The stored spine tolerates modes this build does not know (panel
    # migration B1): validation must not throw the payload away — the READ
    # normalizes. Otherwise an old reader silently degrades the manager's
    # engine choice to the env default.
    stored = LlmEngineStored.model_validate(
        {"provider": "openai", "model": "gpt-4o-mini", "mode": "someday-mode"}
    )
    assert stored.mode == "someday-mode"


def test_request_forbids_unknown_fields() -> None:
    with pytest.raises(ValidationError) as exc:
        LlmEngineUpdateRequest(
            provider="openai",
            model="gpt-4o-mini",
            temperature=0.2,  # type: ignore[call-arg]
        )
    assert exc.value.errors()[0]["type"] == "extra_forbidden"


def test_request_mode_defaults_to_fast() -> None:
    body = LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini")
    assert body.mode == "fast"


# ---------------------------------------------------------------------------
# Alternates (C2 A1) — stored spine, PUT body, read model
# ---------------------------------------------------------------------------


def test_stored_alternates_default_empty_for_old_payloads() -> None:
    """Payloads persisted before alternates existed keep validating (every
    non-identity field defaults) and read back an empty list."""
    stored = LlmEngineStored.model_validate({"provider": "openai", "model": "gpt-5.6-luna"})
    assert stored.alternates == []


def test_stored_alternates_garbage_entry_degrades_entry_not_payload() -> None:
    """A garbage entry (non-dict, or a dict missing the pair) degrades that
    ENTRY, never the payload — the primary pair keeps the manager's choice."""
    stored = LlmEngineStored.model_validate(
        {
            "provider": "openai",
            "model": "gpt-5.6-luna",
            "alternates": [
                {"provider": "anthropic", "model": "claude-sonnet-5"},
                "garbage",
                42,
            ],
        }
    )
    assert [(a.provider, a.model) for a in stored.alternates] == [("anthropic", "claude-sonnet-5")]


def test_update_request_alternates_default_none_keeps() -> None:
    # None (field absent) = keep the stored list; [] would clear it.
    req = LlmEngineUpdateRequest.model_validate(
        {"provider": "openai", "model": "gpt-5.6-luna", "mode": "fast"}
    )
    assert req.alternates is None


def test_update_request_still_forbids_extras() -> None:
    with pytest.raises(ValidationError):
        LlmEngineUpdateRequest.model_validate(
            {"provider": "openai", "model": "x", "mode": "fast", "temperature": 1}
        )


def test_stored_alternate_with_extra_key_is_dropped_entry_not_payload() -> None:
    """``extra="forbid"`` on the entry shape: a hand-written STORED entry
    smuggling keys (temperature/seed) is dropped by the tolerant per-entry
    validator — with the ``llm_engine_alternate_entry_dropped`` warning —
    while the payload and the well-formed siblings survive."""
    stored = LlmEngineStored.model_validate(
        {
            "provider": "openai",
            "model": "gpt-5.6-luna",
            "alternates": [
                {"provider": "openai", "model": "gpt-5.6-luna", "temperature": 2},
                {"provider": "anthropic", "model": "claude-sonnet-5"},
            ],
        }
    )
    assert [(a.provider, a.model) for a in stored.alternates] == [("anthropic", "claude-sonnet-5")]


def test_stored_alternate_oversized_field_is_dropped() -> None:
    """A field beyond the 200-char bound degrades that ENTRY, never the payload."""
    stored = LlmEngineStored.model_validate(
        {
            "provider": "openai",
            "model": "gpt-5.6-luna",
            "alternates": [{"provider": "openai", "model": "x" * 201}],
        }
    )
    assert stored.alternates == []


def test_request_alternate_with_extra_key_is_refused() -> None:
    """Request-side, the same smuggled key is a hard 422 — no tolerance on
    the write gate."""
    with pytest.raises(ValidationError) as exc:
        LlmEngineUpdateRequest.model_validate(
            {
                "provider": "openai",
                "model": "gpt-5.6-luna",
                "mode": "fast",
                "alternates": [{"provider": "openai", "model": "gpt-4o-mini", "temperature": 2}],
            }
        )
    assert any(e["type"] == "extra_forbidden" for e in exc.value.errors())


def test_read_alternates_default_empty() -> None:
    """``LlmEngineRead`` validates without the field — alternates default []."""
    read = LlmEngineRead.model_validate(
        {
            "provider": "openai",
            "model": "gpt-5.6-luna",
            "mode": "fast",
            "source": "default",
            "retired": False,
            "catalog": [],
            "availability": {},
        }
    )
    assert read.alternates == []


# ---------------------------------------------------------------------------
# Endpoint-backed engines (C2 B8) — stored pointer, PUT body, read scalars
# ---------------------------------------------------------------------------


def test_stored_endpoint_id_defaults_none_for_old_payloads() -> None:
    """Payloads persisted before endpoint engines existed keep validating
    (every non-identity field defaults) and read back ``endpoint_id`` None."""
    stored = LlmEngineStored.model_validate({"provider": "openai", "model": "gpt-5.6-luna"})
    assert stored.endpoint_id is None


def test_stored_endpoint_id_roundtrips_through_its_json_dump() -> None:
    """The pointer survives the write-site dump (uuid → str) and the
    read-boundary validate (str → uuid)."""
    endpoint_id = uuid4()
    stored = LlmEngineStored(
        provider="openai_compatible", model="local-model", endpoint_id=endpoint_id
    )
    dumped = stored.model_dump(mode="json")
    assert dumped["endpoint_id"] == str(endpoint_id)
    assert LlmEngineStored.model_validate(dumped).endpoint_id == endpoint_id


def test_update_request_endpoint_id_defaults_none() -> None:
    """A catalogue-engine PUT (no field) means no endpoint pointer."""
    req = LlmEngineUpdateRequest.model_validate({"provider": "openai", "model": "gpt-5.6-luna"})
    assert req.endpoint_id is None


def test_update_request_accepts_an_endpoint_id() -> None:
    endpoint_id = uuid4()
    req = LlmEngineUpdateRequest.model_validate(
        {
            "provider": "openai_compatible",
            "model": "local-model",
            "endpoint_id": str(endpoint_id),
        }
    )
    assert req.endpoint_id == endpoint_id


def test_read_endpoint_scalars_default_none() -> None:
    """``LlmEngineRead`` gains ONLY the two scalars (decision 12): both
    default None for catalogue engines, and there is NO embedded endpoints
    matrix on the read."""
    read = LlmEngineRead.model_validate(
        {
            "provider": "openai",
            "model": "gpt-5.6-luna",
            "mode": "fast",
            "source": "default",
            "retired": False,
            "catalog": [],
            "availability": {},
        }
    )
    assert read.endpoint_id is None
    assert read.endpoint_label is None
    assert "endpoints" not in LlmEngineRead.model_fields


def test_read_carries_the_endpoint_scalars() -> None:
    endpoint_id = uuid4()
    read = LlmEngineRead.model_validate(
        {
            "provider": "openai_compatible",
            "model": "local-model",
            "mode": "fast",
            "source": "project",
            "retired": False,
            "catalog": [],
            "availability": {},
            "endpoint_id": str(endpoint_id),
            "endpoint_label": "Lab Ollama",
        }
    )
    assert read.endpoint_id == endpoint_id
    assert read.endpoint_label == "Lab Ollama"
