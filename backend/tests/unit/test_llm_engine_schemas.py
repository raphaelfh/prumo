"""T2 — the LlmEngineStored spine + the PUT request schema (C1b).

The stored shape is ONE typed spine, written via ``.model_dump(mode="json")``
at the single write site and ``model_validate``d at the two read boundaries.
The request schema types ``mode: Literal["fast"]`` so Pydantic refuses
``verified`` with a free 422 — no typed-error class, no branch; the Literal
widens compatibly when Verified ships.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.llm_engine import LlmEngineStored, LlmEngineUpdateRequest

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


def test_request_refuses_verified_mode_at_the_schema() -> None:
    with pytest.raises(ValidationError) as exc:
        LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini", mode="verified")
    assert any(e["loc"] == ("mode",) for e in exc.value.errors())


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
