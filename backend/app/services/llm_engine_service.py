"""Per-project LLM engine setting (§5, C1b).

Owns the ``llm_engine`` sub-key inside ``projects.settings`` — the same
plain-JSONB storage precedent as ``ParserSettingsService``: build a new dict
and REASSIGN, or the change is never tracked and never persists. The service
writes ONLY its own sub-key; sibling keys (``parsing``, …) survive.

The stored shape is the ``LlmEngineStored`` spine
(``app/schemas/llm_engine.py``): dumped ``mode="json"`` at the single write
site here, validated at the read boundaries. A structurally invalid payload
(hand-written JSONB that does not even parse) is treated as *unset* — the
env default runs; a well-formed pair the catalogue no longer lists is
*retired* — surfaced on the read model and refused at run kickoff.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.catalog import find_entry
from app.repositories.project_repository import ProjectRepository
from app.schemas.llm_engine import LlmEngineStored
from app.services.parser_settings_service import ProjectNotFoundError

__all__ = [
    "LlmEngineService",
    "ProjectNotFoundError",
    "ResolvedProjectEngine",
]


@dataclass(frozen=True)
class ResolvedProjectEngine:
    """A project's effective engine: stored choice or the env default."""

    provider: str
    model: str
    mode: str
    source: Literal["project", "default"]
    retired: bool
    stored: LlmEngineStored | None


def _stored_engine(project_settings: dict[str, Any] | None) -> LlmEngineStored | None:
    """Parse the stored payload, or ``None`` when unset / unparseable.

    Contained on purpose: a manager can hand-write raw JSONB through
    PostgREST, and a payload that does not even validate must degrade to
    the env default rather than 500 every read — the retired check (and,
    last, ``build_model``'s provider whitelist) contains the rest.
    """
    raw = (project_settings or {}).get("llm_engine")
    if not isinstance(raw, dict):
        return None
    try:
        return LlmEngineStored.model_validate(raw)
    except ValidationError:
        return None


class LlmEngineService:
    """Read/write the per-project engine choice."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._projects = ProjectRepository(db)

    async def get_for_project(self, project_id: UUID) -> ResolvedProjectEngine:
        """The project's resolved engine view (stored value or env default)."""
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        stored = _stored_engine(project.settings)
        if stored is None:
            return ResolvedProjectEngine(
                provider=settings.LLM_PROVIDER,
                model=settings.LLM_DEFAULT_MODEL,
                mode="fast",
                source="default",
                retired=False,
                stored=None,
            )
        return ResolvedProjectEngine(
            provider=stored.provider,
            model=stored.model,
            mode=stored.mode,
            source="project",
            retired=find_entry(stored.provider, stored.model) is None,
            stored=stored,
        )

    async def set_for_project(
        self,
        *,
        project_id: UUID,
        provider: str,
        model: str,
        mode: Literal["fast"],
        updated_by: UUID,
    ) -> LlmEngineStored:
        """Persist a catalogue-validated engine choice with attribution.

        ``updated_by`` comes from the auth dependency and ``previous_model``
        from the stored value — never client-supplied.
        """
        if find_entry(provider, model) is None:
            raise ValueError(f"Unknown engine {provider}:{model} — not in the server catalogue")
        project = await self._projects.get_by_id(project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        previous = _stored_engine(project.settings)
        stored = LlmEngineStored(
            provider=provider,
            model=model,
            mode=mode,
            updated_by=updated_by,
            updated_at=datetime.now(UTC),
            previous_model=previous.model if previous is not None else None,
        )
        # projects.settings is plain JSONB (NOT MutableDict): build a new dict
        # and REASSIGN, or the change is not tracked and never persists. Only
        # the llm_engine sub-key is written — sibling keys survive.
        new_settings = dict(project.settings or {})
        new_settings["llm_engine"] = stored.model_dump(mode="json")
        project.settings = new_settings
        await self.db.flush()
        return stored
