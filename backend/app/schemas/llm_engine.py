"""Typed spine for the per-project LLM engine setting (§5, C1b).

``LlmEngineStored`` is the ONE shape ever persisted under
``projects.settings["llm_engine"]``: written via ``.model_dump(mode="json")``
at the single write site (``LlmEngineService.set_for_project`` —
``updated_at`` is a datetime, so a hand-rolled dict dies in ``json.dumps``
at flush) and ``model_validate``d at exactly the two read boundaries
(``get_for_project`` / ``resolve_project_engine``). Every non-identity field
defaults so older payloads keep validating when the shape widens.

The request/read models below are the endpoint contract; the endpoint never
parses the stored JSONB itself.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class LlmEngineStored(BaseModel):
    """The persisted project default: identity pair, attribution, lock.

    ``mode`` stays a plain ``str`` on purpose (panel migration B1): reads
    normalize an unknown mode to "fast"; the closed enum is on the write gate.
    ``connection_id`` is always ``None`` for a default (§3.1: the default is
    a catalogue pair) and exists so the field name matches ``LlmTarget``; a
    legacy ``endpoint_id`` key is ignored on read. ``user_choice_allowed``
    is the manager lock (§3.2 step 3): ``False`` binds members to this
    default; managers are never bound.
    """

    provider: str
    model: str
    mode: str = "fast"
    updated_by: UUID | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    connection_id: UUID | None = None
    user_choice_allowed: bool = True

    @field_validator("mode", mode="before")
    @classmethod
    def _stringify_garbage_mode(cls, v: Any) -> Any:
        # A hand-written NON-STRING mode (numeric JSONB via PostgREST) must
        # not throw the WHOLE payload away — the pair keeps the manager's
        # choice; the read normalizes the unknown mode to "fast", loudly.
        return v if isinstance(v, str) else str(v)


class LlmEngineUpdateRequest(BaseModel):
    """PUT body for the project default (§4): always a catalogue pair, so
    there is no ``connection_id`` field — ``extra="forbid"`` makes a
    submitted one (or ``alternates`` / ``endpoint_id``) the 422 §6 asks for."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    mode: Literal["fast", "verified"] = "fast"
    user_choice_allowed: bool = True


class LlmEngineCatalogEntryRead(BaseModel):
    """One selectable engine as the picker renders it."""

    provider: str
    model: str
    canonical: str
    label: str
    best_for: str
    context_window: int
    cost_tier: Literal["$", "$$", "$$$"]
    byok_only: bool


class LlmEngineRead(BaseModel):
    """The member-visible read (reshaped in Task 22 into default/effective).

    ``source`` says whether the pair is the project's stored choice or the
    server's env default; ``retired`` flags a stored pair the catalogue no
    longer lists (new runs are refused until a manager re-chooses).
    ``availability`` maps provider → whether the CALLER can run it (their
    own stored key, or a global service key) — booleans only, never key
    material or metadata. ``user_choice_allowed`` is the manager lock.
    """

    provider: str
    model: str
    mode: Literal["fast", "verified"]
    source: Literal["project", "default"]
    retired: bool
    user_choice_allowed: bool
    updated_by_name: str | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    catalog: list[LlmEngineCatalogEntryRead]
    availability: dict[str, bool]
