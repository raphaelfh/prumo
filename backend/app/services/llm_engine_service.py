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

The default is always a catalogue pair (§3.1); per-user engines and hosts
live in ``user_engine_service`` / ``llm_connection_service``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.error_handler import AppError
from app.core.logging import get_logger
from app.llm.catalog import canonical, find_entry, selectable_catalog
from app.llm.registry import llm_provider_ids
from app.models.llm_connection import UserProjectEngine
from app.models.project import Project
from app.repositories.project_repository import ProjectRepository
from app.schemas.llm_engine import (
    LlmEngineCatalogEntryRead,
    LlmEngineDefaultRead,
    LlmEngineEffectiveRead,
    LlmEngineRead,
    LlmEngineStored,
)
from app.schemas.llm_target import LlmTarget
from app.services.llm_connection_service import availability_map, owned_user_connection
from app.services.parser_settings_service import ProjectNotFoundError
from app.services.profile_names import profile_names

__all__ = [
    "EngineRetiredError",
    "LlmEngineService",
    "ProjectNotFoundError",
    "ResolvedProjectEngine",
    "get_user_engine",
    "resolve_engine",
    "user_row_is_retired",
    "viewer_is_manager",
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


async def get_user_engine(
    db: AsyncSession, *, user_id: UUID, project_id: UUID
) -> UserProjectEngine | None:
    """The viewer's own ``user_project_engines`` row, or ``None`` (§3.1)."""
    return await db.get(UserProjectEngine, (user_id, project_id))


async def user_row_is_retired(db: AsyncSession, row: UserProjectEngine) -> bool:
    """Catalogue miss, or a host row whose connection is gone / unverified /
    no longer allows the model (§3.2 step 2). ONE predicate for the write
    gate (``user_engine_service.set_user_engine``) and for resolution."""
    if row.provider == "openai_compatible":
        if row.connection_id is None:
            return True
        conn = await owned_user_connection(db, row.connection_id, row.user_id)
        return (
            conn is None
            or conn.validation_status != "ok"
            or row.model not in (conn.allowed_models or [])
        )
    return find_entry(row.provider, row.model) is None


async def viewer_is_manager(db: AsyncSession, project_id: UUID, viewer_id: UUID) -> bool:
    """Whether the viewer manages this project — the same
    ``public.is_project_manager`` helper the RLS policies and the API
    role gates use, so one definition of "manager" serves all three."""
    return bool(
        (
            await db.execute(
                text("SELECT public.is_project_manager(:pid, :uid) AS ok"),
                {"pid": str(project_id), "uid": str(viewer_id)},
            )
        ).scalar_one()
    )


async def resolve_engine(db: AsyncSession, project_id: UUID, user_id: UUID) -> LlmTarget:
    """The engine ``user_id``'s next run in ``project_id`` runs on (§3.2).

    1. The project default; retired (catalogue miss) → ``EngineRetiredError``
       (a manager must re-choose).
    2. If the caller may choose (``user_choice_allowed``, or a manager) and a
       ``user_project_engines`` row exists: validate it the same way; retired
       → ``EngineRetiredError`` worded for the user; valid → that engine with
       ``deviation`` computed against the default NOW and never recomputed.
    3. Otherwise the default. The lock is enforced here, not in the UI.

    Read boundary #2 (with :meth:`LlmEngineService.get_for_project`): the
    stored payload is ``model_validate``d here, never re-parsed downstream.
    Unset — or structurally unparseable (see :func:`_stored_engine`) — falls
    back to the env default pair.
    """
    project = await db.get(Project, project_id)
    stored = _stored_engine(project.settings if project is not None else None)
    if stored is None:
        default = LlmTarget(provider=settings.LLM_PROVIDER, model=settings.LLM_DEFAULT_MODEL)
        allowed = True
    else:
        if find_entry(stored.provider, stored.model) is None:
            raise EngineRetiredError(
                f"The project's stored engine {stored.provider}:{stored.model} is no longer "
                "available. Ask a project manager to choose a new model."
            )
        mode = _normalized_mode(stored, project_id)
        default = LlmTarget(
            provider=stored.provider,
            model=stored.model,
            mode_requested=mode,
            mode_executed=mode,
        )
        allowed = stored.user_choice_allowed
    row = await get_user_engine(db, user_id=user_id, project_id=project_id)
    if row is None or not (allowed or await viewer_is_manager(db, project_id, user_id)):
        return default
    if await user_row_is_retired(db, row):
        raise EngineRetiredError(
            f"Your engine for this project ({row.provider}:{row.model}) is no longer available. "
            "Pick a new model."
        )
    row_mode = row.mode if row.mode in ("fast", "verified") else "fast"
    return LlmTarget(
        provider=row.provider,
        model=row.model,
        mode_requested=row_mode,
        mode_executed=row_mode,
        connection_id=str(row.connection_id) if row.connection_id is not None else None,
        deviation=(row.provider, row.model) != (default.provider, default.model)
        or row.connection_id is not None,
    )


@dataclass(frozen=True)
class ResolvedProjectEngine:
    """A project's effective engine: stored choice or the env default.

    ``user_choice_allowed`` is the manager lock carried by the stored
    default; the env-default branch is always open.
    """

    provider: str
    model: str
    mode: Literal["fast", "verified"]
    source: Literal["project", "default"]
    retired: bool
    stored: LlmEngineStored | None
    user_choice_allowed: bool = True


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
                user_choice_allowed=True,
            )
        return ResolvedProjectEngine(
            provider=stored.provider,
            model=stored.model,
            mode=_normalized_mode(stored, project_id),
            source="project",
            retired=find_entry(stored.provider, stored.model) is None,
            stored=stored,
            user_choice_allowed=stored.user_choice_allowed,
        )

    async def set_for_project(
        self,
        *,
        project_id: UUID,
        provider: str,
        model: str,
        mode: Literal["fast", "verified"],
        updated_by: UUID,
        user_choice_allowed: bool = True,
    ) -> LlmEngineStored:
        """Persist the project default (a catalogue pair) and the lock, with
        attribution. ``updated_by`` comes from the auth dependency and
        ``previous_model`` from the stored value — never client-supplied."""
        if provider == "openai_compatible":
            raise ValueError("The project default is a catalogue pair; a host is a per-user engine")
        if find_entry(provider, model) is None:
            raise ValueError(f"Unknown engine {provider}:{model} — not in the server catalogue")
        # Row-locked read for the read-modify-reassign below (mirrors
        # ``freeze_engine``'s reasoning in ``extraction_run_repository``):
        # ``settings`` is a whole-column JSONB write shared with
        # ``ParserSettingsService``, so two unlocked writers interleaving
        # (read A, read B, write A, write B) would silently drop one
        # sub-key. ``populate_existing`` refreshes any stale identity-map
        # copy — the lock is useless if a pre-lock read is served.
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
        stored = LlmEngineStored(
            provider=provider,
            model=model,
            mode=mode,
            updated_by=updated_by,
            updated_at=datetime.now(UTC),
            previous_model=previous.model if previous is not None else None,
            user_choice_allowed=user_choice_allowed,
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
        """The whole member-visible read model for the ⚙ popover (§4).

        ``default`` is the project's choice with its lock and attribution;
        ``effective`` is what the VIEWER's next run runs on — their own
        ``user_project_engines`` row when the lock allows it (or they
        manage the project), else the default. ``availability`` is the
        credential ladder's dry run for THIS caller: a scope tag per
        registry LLM provider, never key material.
        """
        resolved = await self.get_for_project(project_id)
        stored = resolved.stored
        updated_by_name: str | None = None
        if stored is not None and stored.updated_by is not None:
            updated_by_name = (await profile_names(self.db, {stored.updated_by})).get(
                stored.updated_by
            )
        default_source: Literal["project", "env_default"] = (
            "project" if stored is not None else "env_default"
        )
        default = LlmEngineDefaultRead(
            provider=resolved.provider,
            model=resolved.model,
            mode=resolved.mode,
            source=default_source,
            retired=resolved.retired,
            user_choice_allowed=resolved.user_choice_allowed,
            updated_by_name=updated_by_name,
            updated_at=stored.updated_at if stored is not None else None,
            previous_model=stored.previous_model if stored is not None else None,
        )
        effective = LlmEngineEffectiveRead(
            provider=default.provider,
            model=default.model,
            mode=default.mode,
            source=default_source,
            retired=default.retired,
        )
        row = await get_user_engine(self.db, user_id=viewer_id, project_id=project_id)
        if row is not None and (
            resolved.user_choice_allowed or await viewer_is_manager(self.db, project_id, viewer_id)
        ):
            label: str | None = None
            if row.connection_id is not None:
                conn = await owned_user_connection(self.db, row.connection_id, viewer_id)
                label = conn.label if conn is not None else None
            effective = LlmEngineEffectiveRead(
                provider=row.provider,
                model=row.model,
                mode=row.mode if row.mode in ("fast", "verified") else "fast",  # type: ignore[arg-type]
                source="user",
                retired=await user_row_is_retired(self.db, row),
                connection_id=row.connection_id,
                connection_label=label,
            )
        return LlmEngineRead(
            default=default,
            effective=effective,
            source=effective.source,
            catalog=[
                LlmEngineCatalogEntryRead(
                    provider=entry.provider,
                    model=entry.model,
                    canonical=canonical(entry),
                    label=entry.label,
                    best_for=entry.best_for,
                    context_window=entry.context_window,
                    cost_tier=entry.cost_tier,
                )
                for entry in selectable_catalog()
            ],
            availability=await availability_map(
                self.db, project_id=project_id, user_id=viewer_id, providers=llm_provider_ids()
            ),
        )
