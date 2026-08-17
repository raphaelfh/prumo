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
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LlmEngineStored(BaseModel):
    """The persisted engine choice: identity pair + attribution trail."""

    provider: str
    model: str
    mode: Literal["fast"] = "fast"
    updated_by: UUID | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None


class LlmEngineUpdateRequest(BaseModel):
    """PUT body for the project engine.

    ``mode: Literal["fast"]`` refuses ``verified`` with a free 422 until
    Verified ships (§5 — the Literal itself is the enum landing in C1);
    ``extra="forbid"`` blocks smuggled keys (no temperature/seed, by design).
    """

    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    mode: Literal["fast"] = "fast"


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
    material or metadata.
    """

    provider: str
    model: str
    mode: Literal["fast"]
    source: Literal["project", "default"]
    retired: bool
    updated_by_name: str | None = None
    updated_at: datetime | None = None
    previous_model: str | None = None
    catalog: list[LlmEngineCatalogEntryRead]
    availability: dict[str, bool]
