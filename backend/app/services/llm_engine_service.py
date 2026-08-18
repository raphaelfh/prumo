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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.error_handler import AppError
from app.core.logging import get_logger
from app.llm.catalog import CATALOG, canonical, canonical_pair, find_entry
from app.models.project import Project
from app.models.user import Profile
from app.repositories.project_repository import ProjectRepository
from app.schemas.llm_engine import (
    LlmEngineAlternate,
    LlmEngineAlternateRead,
    LlmEngineCatalogEntryRead,
    LlmEngineRead,
    LlmEngineStored,
)
from app.schemas.llm_target import LlmTarget
from app.services.api_key_service import APIKeyService
from app.services.parser_settings_service import ProjectNotFoundError

__all__ = [
    "EngineRetiredError",
    "LlmEngineService",
    "ProjectNotFoundError",
    "ResolvedProjectEngine",
    "resolve_project_engine",
]

logger = get_logger(__name__)


class EngineRetiredError(AppError):
    """The project's stored engine left the server catalogue.

    New extraction kickoffs are refused until a manager picks a new model
    (§5 never-visible-but-fails). As an :class:`AppError` the registered
    handler serves the typed envelope — ``error.code = "LLM_ENGINE_RETIRED"``,
    HTTP 409 — instead of the bare ``HTTP_ERROR`` an HTTPException would
    hardcode; the worker classifies it by type into a friendly task code.
    """

    def __init__(self, message: str) -> None:
        super().__init__(code="LLM_ENGINE_RETIRED", message=message, status_code=409)


def _normalized_mode(stored: LlmEngineStored, project_id: UUID) -> Literal["fast", "verified"]:
    """The stored mode, normalized to the closed vocabulary at the read.

    The stored spine keeps ``mode`` a plain ``str`` (see ``LlmEngineStored``)
    so an old reader never throws a whole payload away over a mode it does
    not know; an unknown — or non-string, belt-and-braces under the schema's
    stringify — mode degrades to ``"fast"`` here — loudly, never silently —
    while the engine PAIR keeps the manager's choice.
    """
    if isinstance(stored.mode, str) and stored.mode in ("fast", "verified"):
        return stored.mode  # type: ignore[return-value]
    logger.warning(
        "llm_engine_unknown_mode_normalized",
        project_id=str(project_id),
        stored_mode=str(stored.mode),
    )
    return "fast"


async def resolve_project_engine(db: AsyncSession, project_id: UUID) -> LlmTarget:
    """The engine an extraction kicked off in ``project_id`` runs on.

    Read boundary #2 (with :meth:`LlmEngineService.get_for_project`): the
    stored payload is ``model_validate``d here, never re-parsed downstream.
    Unset — or structurally unparseable (see :func:`_stored_engine`) — falls
    back to the env default pair. A well-formed pair the catalogue no longer
    lists raises :class:`EngineRetiredError`.

    The returned target carries the mode fields too — the freeze pins the
    whole spine (as a request-echo; execution truth is per-section).
    """
    project = await db.get(Project, project_id)
    stored = _stored_engine(project.settings if project is not None else None)
    if stored is None:
        return LlmTarget(provider=settings.LLM_PROVIDER, model=settings.LLM_DEFAULT_MODEL)
    if find_entry(stored.provider, stored.model) is None:
        raise EngineRetiredError(
            f"The project's stored engine {stored.provider}:{stored.model} is no longer "
            "available. Ask a project manager to choose a new model."
        )
    mode = _normalized_mode(stored, project_id)
    return LlmTarget(
        provider=stored.provider,
        model=stored.model,
        mode_requested=mode,
        mode_executed=mode,
    )


@dataclass(frozen=True)
class ResolvedProjectEngine:
    """A project's effective engine: stored choice or the env default."""

    provider: str
    model: str
    mode: Literal["fast", "verified"]
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


async def _profile_names(db: AsyncSession, ids: set[UUID]) -> dict[UUID, str | None]:
    """Display names for the given profiles, one query for all of them.

    A profile with no ``full_name`` maps to ``None`` rather than to its
    uuid: the popover renders a fallback, never a raw id dressed as a name.
    (The B-9f ``_publisher_names`` shape.)
    """
    rows = await db.execute(select(Profile.id, Profile.full_name).where(Profile.id.in_(ids)))
    names: dict[UUID, str | None] = {}
    for profile_id, full_name in rows.all():
        names[profile_id] = full_name
    return names


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
            mode=_normalized_mode(stored, project_id),
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
        mode: Literal["fast", "verified"],
        updated_by: UUID,
        alternates: list[LlmEngineAlternate] | None = None,
    ) -> LlmEngineStored:
        """Persist a catalogue-validated engine choice with attribution.

        ``updated_by`` comes from the auth dependency and ``previous_model``
        from the stored value — never client-supplied.

        ``alternates`` is tri-state: ``None`` keeps the previously stored
        list (minus the new primary — a kept list must never contain it),
        ``[]`` clears it, a list replaces it. NEW entries must be in the
        server catalogue (alternates are catalogue-only in C2); entries
        already stored are kept even when the catalogue retired them — the
        A4 frontend echoes the FULL stored list on every mutation, so a
        stored-then-retired pair must not brick every PUT (the read flags
        it amber; a removal echo simply omits it). Duplicates collapse to
        the first occurrence and the primary pair is silently filtered out.
        """
        if find_entry(provider, model) is None:
            raise ValueError(f"Unknown engine {provider}:{model} — not in the server catalogue")
        # Row-locked read for the read-modify-reassign below (mirrors
        # ``freeze_engine``'s reasoning in ``extraction_run_repository``):
        # ``settings`` is a whole-column JSONB write shared with
        # ``ParserSettingsService``, so two unlocked writers interleaving
        # (read A, read B, write A, write B) would silently drop one
        # sub-key. ``populate_existing`` refreshes any stale identity-map
        # copy — the lock is useless if a pre-lock read is served. The
        # alternates curation sits AFTER the lock on purpose: telling a NEW
        # entry from an already-stored one needs the same locked read that
        # feeds previous_model.
        project = (
            await self.db.execute(
                select(Project)
                .where(Project.id == project_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} not found")
        previous = _stored_engine(project.settings)
        previous_alternates = list(previous.alternates) if previous is not None else []
        previous_pairs = {(a.provider, a.model) for a in previous_alternates}
        if alternates is None:
            # None = keep: the previously stored list from the same
            # row-locked read that feeds previous_model.
            candidates = previous_alternates
        else:
            # A replacement list: only entries the project does not already
            # store have to be in the catalogue today (see the docstring).
            for alternate in alternates:
                if (alternate.provider, alternate.model) not in previous_pairs and (
                    find_entry(alternate.provider, alternate.model) is None
                ):
                    raise ValueError(
                        f"Unknown alternate engine {alternate.provider}:{alternate.model} "
                        "— not in the server catalogue"
                    )
            candidates = alternates
        # One curation pass for both paths: first occurrence wins, and the
        # NEW primary never stays listed (promoting an alternate drops it).
        curated: list[LlmEngineAlternate] = []
        seen: set[tuple[str, str]] = set()
        for alternate in candidates:
            pair = (alternate.provider, alternate.model)
            if pair == (provider, model) or pair in seen:
                continue
            seen.add(pair)
            curated.append(alternate)
        stored = LlmEngineStored(
            provider=provider,
            model=model,
            mode=mode,
            updated_by=updated_by,
            updated_at=datetime.now(UTC),
            previous_model=previous.model if previous is not None else None,
            alternates=curated,
        )
        # projects.settings is plain JSONB (NOT MutableDict): build a new dict
        # and REASSIGN, or the change is not tracked and never persists. Only
        # the llm_engine sub-key is written — sibling keys survive.
        new_settings = dict(project.settings or {})
        new_settings["llm_engine"] = stored.model_dump(mode="json")
        project.settings = new_settings
        await self.db.flush()
        return stored

    async def get_engine_read(self, project_id: UUID, viewer_id: UUID) -> LlmEngineRead:
        """The whole member-visible read model for the ⚙ popover.

        Resolved engine + attribution name (batched profile select) + the
        server-curated roster + the CALLER's per-provider availability —
        booleans only (``has_key_for_provider`` is an existence probe: no
        decrypt, no ``update_last_used`` write). Never another user's keys.
        Plus the manager-curated ``alternates`` with a per-entry ``retired``
        flag (empty when the engine is unset — the env default carries no
        alternates). Alternates are runtime-inert in C2: only this read
        surfaces them; :func:`resolve_project_engine` ignores them.
        """
        resolved = await self.get_for_project(project_id)
        stored = resolved.stored

        updated_by_name: str | None = None
        if stored is not None and stored.updated_by is not None:
            names = await _profile_names(self.db, {stored.updated_by})
            updated_by_name = names.get(stored.updated_by)

        keys = APIKeyService(self.db, viewer_id)
        availability: dict[str, bool] = {}
        for provider in sorted({entry.provider for entry in CATALOG}):
            availability[provider] = await keys.has_key_for_provider(provider)

        return LlmEngineRead(
            provider=resolved.provider,
            model=resolved.model,
            mode=resolved.mode,
            source=resolved.source,
            retired=resolved.retired,
            updated_by_name=updated_by_name,
            updated_at=stored.updated_at if stored is not None else None,
            previous_model=stored.previous_model if stored is not None else None,
            catalog=[
                LlmEngineCatalogEntryRead(
                    provider=entry.provider,
                    model=entry.model,
                    canonical=canonical(entry),
                    label=entry.label,
                    best_for=entry.best_for,
                    context_window=entry.context_window,
                    cost_tier=entry.cost_tier,
                    byok_only=entry.byok_only,
                )
                for entry in CATALOG
            ],
            availability=availability,
            alternates=[
                LlmEngineAlternateRead(
                    provider=a.provider,
                    model=a.model,
                    canonical=canonical_pair(a.provider, a.model),
                    retired=find_entry(a.provider, a.model) is None,
                )
                for a in (stored.alternates if stored is not None else [])
            ],
        )
