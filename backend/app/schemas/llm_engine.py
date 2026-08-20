"""Typed spine for the per-project LLM engine setting (§5, C1b).

``LlmEngineStored`` is the ONE shape ever persisted under
``projects.settings["llm_engine"]``: written via ``.model_dump(mode="json")``
at the single write site (``LlmEngineService.set_for_project`` —
``updated_at`` is a datetime, so a hand-rolled dict dies in ``json.dumps``
at flush) and ``model_validate``d at exactly the two read boundaries
(``get_for_project`` / ``resolve_project_engine``). Every non-identity field
defaults so older payloads keep validating when the shape widens, and
garbage degrades the ENTRY, never the payload: stored ``alternates``
entries validate individually — an invalid entry is dropped with a
warning while the primary pair keeps the manager's choice.

The request/read models below are the endpoint contract; the endpoint never
parses the stored JSONB itself.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.core.logging import get_logger

logger = get_logger(__name__)


class LlmEngineAlternate(BaseModel):
    """One fallback engine pair — the stored and request entry shape.

    ``extra="forbid"`` + bounded field lengths: a REQUEST entry smuggling
    keys (temperature/seed — same posture as ``LlmEngineUpdateRequest``) or
    an oversized value is a hard 422; a hand-written STORED entry with the
    same defects is dropped by the tolerant per-entry validator on
    ``LlmEngineStored.alternates`` — the entry degrades, never the payload.
    """

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(max_length=200)
    model: str = Field(max_length=200)


class LlmEngineStored(BaseModel):
    """The persisted engine choice: identity pair + attribution trail.

    ``mode`` is a plain ``str`` ON PURPOSE (panel migration B1): a stored
    Literal makes NEW payloads invalid to OLD readers, whose swallowed
    ValidationError silently degrades the manager's engine choice to the
    env default. Reads NORMALIZE an unknown mode to ``"fast"`` with a
    warning instead; the closed enum lives on the write gate below.

    ``alternates`` is the manager's ordered fallback list; entries are
    tolerated individually — a garbage entry is dropped with a warning,
    never the payload.

    ``endpoint_id`` (C2 B8) points the engine at a project-scoped custom
    endpoint (``project_llm_endpoints``); when set, ``provider`` is
    ``"openai_compatible"`` and the pair is validated against the endpoint
    (exists in this project, model allowed, verified) instead of the
    catalogue. ``None`` — the default every pre-B8 payload reads back —
    means a catalogue engine.
    """

    provider: str
    model: str
    mode: str = "fast"
    updated_by: UUID | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    alternates: list[LlmEngineAlternate] = []
    endpoint_id: UUID | None = None

    @field_validator("mode", mode="before")
    @classmethod
    def _stringify_garbage_mode(cls, v: Any) -> Any:
        # A hand-written NON-STRING mode (numeric JSONB via PostgREST) must
        # not throw the WHOLE payload away — the pair keeps the manager's
        # choice; the read normalizes the unknown mode to "fast", loudly.
        return v if isinstance(v, str) else str(v)

    @field_validator("alternates", mode="before")
    @classmethod
    def _drop_garbage_alternates(cls, v: Any) -> Any:
        # Per-entry tolerance (module rule): a hand-written garbage entry
        # degrades that ENTRY, never the payload — the primary pair keeps
        # the manager's choice.
        if not isinstance(v, list):
            logger.warning("llm_engine_alternates_not_a_list", raw_type=type(v).__name__)
            return []
        kept: list[LlmEngineAlternate] = []
        for entry in v:
            if isinstance(entry, LlmEngineAlternate):
                kept.append(entry)
                continue
            try:
                kept.append(LlmEngineAlternate.model_validate(entry))
            except ValidationError:
                logger.warning("llm_engine_alternate_entry_dropped", entry=str(entry)[:200])
        return kept


class LlmEngineUpdateRequest(BaseModel):
    """PUT body for the project engine.

    ``mode: Literal["fast", "verified"]`` is the closed write gate (§5 —
    Verified shipped with the verify pass; anything else is a free 422);
    ``extra="forbid"`` blocks smuggled keys (no temperature/seed, by design).
    ``alternates`` is tri-state: ``None`` (field absent) keeps the stored
    list, ``[]`` clears it, a list replaces it.

    ``endpoint_id`` selects a project custom endpoint as the engine (C2
    B8): it requires ``provider == "openai_compatible"`` and the service
    validates the endpoint (project-scoped, model allowed, verified)
    instead of the catalogue. Omitted/None = a catalogue engine.
    """

    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    mode: Literal["fast", "verified"] = "fast"
    alternates: list[LlmEngineAlternate] | None = None
    endpoint_id: UUID | None = None


class LlmEngineAlternateRead(BaseModel):
    """One alternate as the popover renders it: the pair plus its canonical
    catalogue id and a per-entry ``retired`` flag (the catalogue no longer
    lists that pair)."""

    provider: str
    model: str
    canonical: str
    retired: bool


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
    """The resolved engine view the ⚙ popover renders.

    ``source`` says whether the pair is the project's stored choice or the
    server's env default; ``retired`` flags a stored pair the catalogue no
    longer lists (new runs are refused until a manager re-chooses).
    ``availability`` maps provider → whether the CALLER can run it (their
    own stored key, or a global service key) — booleans only, never key
    material or metadata. ``alternates`` is the stored fallback list with
    a per-entry ``retired`` flag.

    ``endpoint_id`` / ``endpoint_label`` are the ONLY endpoint data on this
    read (decision 12 — no embedded endpoints matrix; the picker's endpoint
    groups come from the manager-only endpoints listing instead): the
    stored pointer plus the row's label for the chip. ``endpoint_label`` is
    ``None`` for catalogue engines AND for a dangling pointer (row gone —
    ``retired`` is True then).
    """

    provider: str
    model: str
    mode: Literal["fast", "verified"]
    source: Literal["project", "default"]
    retired: bool
    updated_by_name: str | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    catalog: list[LlmEngineCatalogEntryRead]
    availability: dict[str, bool]
    alternates: list[LlmEngineAlternateRead] = []
    endpoint_id: UUID | None = None
    endpoint_label: str | None = None
