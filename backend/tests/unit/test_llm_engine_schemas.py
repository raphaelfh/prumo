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


def test_update_request_still_forbids_extras() -> None:
    with pytest.raises(ValidationError):
        LlmEngineUpdateRequest.model_validate(
            {"provider": "openai", "model": "x", "mode": "fast", "temperature": 1}
        )


# ---------------------------------------------------------------------------
# Slice 2 — connection_id + the manager lock
# ---------------------------------------------------------------------------


def test_stored_legacy_endpoint_id_payload_validates_and_reads_no_connection() -> None:
    """Read tolerance (§3.1): a pre-slice-2 payload carrying ``endpoint_id``
    still validates; the pointer is gone (the table is dropped), so the
    engine reads as a catalogue pair — retired if it named a host."""
    stored = LlmEngineStored.model_validate(
        {"provider": "openai_compatible", "model": "llama3", "endpoint_id": str(uuid4())}
    )
    assert stored.connection_id is None and stored.user_choice_allowed is True


def test_stored_lock_roundtrips_through_its_json_dump() -> None:
    stored = LlmEngineStored(provider="openai", model="gpt-4o-mini", user_choice_allowed=False)
    assert (
        LlmEngineStored.model_validate(stored.model_dump(mode="json")).user_choice_allowed is False
    )


def test_update_request_lock_defaults_open() -> None:
    assert (
        LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini").user_choice_allowed is True
    )


def test_update_request_refuses_alternates_endpoint_id_and_connection_id() -> None:
    """§6: the default is always a catalogue pair — a pointer of any name is
    a 422, by ``extra="forbid"`` (no field exists to carry one)."""
    for extra in (
        {"alternates": []},
        {"endpoint_id": str(uuid4())},
        {"connection_id": str(uuid4())},
    ):
        with pytest.raises(ValidationError):
            LlmEngineUpdateRequest(provider="openai", model="gpt-4o-mini", **extra)
