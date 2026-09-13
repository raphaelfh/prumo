"""The viewer's own engine for new runs in one project (§3.1, §3.2, §4).

No row = follow the project default. Writes validate exactly what
resolution re-checks — ``user_row_is_retired`` (catalogue pair, or the
caller's own verified host through ``owned_user_connection``) — so a pick
can never lead to a guaranteed 409 at kickoff; the lock is enforced HERE
and in ``resolve_engine``, never in the UI. The READ side of the row
(``get_user_engine``, ``user_row_is_retired``) lives in
``llm_engine_service`` beside ``resolve_engine``; this module imports it
at module level and nothing imports this module back (plan header, import
direction).
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.llm_connection import UserProjectEngine
from app.services.llm_connection_service import availability_map
from app.services.llm_engine_service import (
    LlmEngineService,
    get_user_engine,
    user_row_is_retired,
)

__all__ = [
    "EngineLockedError",
    "EngineNeedsKeyError",
    "clear_user_engine",
    "set_user_engine",
]


class EngineLockedError(AppError):
    """A manager locked the project to its default engine (§3.1)."""

    def __init__(self) -> None:
        super().__init__(
            code="LLM_ENGINE_LOCKED",
            message="A project manager locked this project to its default engine.",
            status_code=403,
        )


class EngineNeedsKeyError(AppError):
    """Nothing on the ladder would pay for a call on this provider (§4)."""

    def __init__(self, provider: str) -> None:
        super().__init__(
            code="LLM_ENGINE_NEEDS_KEY",
            message=(
                f"No credential for {provider}: add your own key under Integrations, ask a "
                "manager for a shared key, or ask the operator to set one."
            ),
            status_code=422,
        )


async def set_user_engine(
    db: AsyncSession,
    *,
    user_id: UUID,
    project_id: UUID,
    provider: str,
    model: str,
    mode: Literal["fast", "verified"],
    connection_id: UUID | None,
    is_manager: bool,
) -> UserProjectEngine:
    """Write the viewer's row after the same checks resolution re-runs."""
    default = await LlmEngineService(db).get_for_project(project_id)  # ProjectNotFoundError → 404
    if not default.user_choice_allowed and not is_manager:
        raise EngineLockedError()
    if (connection_id is not None) != (provider == "openai_compatible"):
        raise ValueError(
            "A connection_id is required for, and only for, provider 'openai_compatible'"
        )
    row = UserProjectEngine(
        user_id=user_id,
        project_id=project_id,
        provider=provider,
        model=model,
        connection_id=connection_id,
        mode=mode,
    )
    if await user_row_is_retired(db, row):
        raise ValueError(
            f"Unknown engine {provider}:{model} — not in the catalogue, "
            "or not one of your verified connections"
        )
    if (await availability_map(db, project_id=project_id, user_id=user_id, providers=(provider,)))[
        provider
    ] is None:
        raise EngineNeedsKeyError(provider)
    merged = await db.merge(row)
    await db.flush()
    return merged


async def clear_user_engine(db: AsyncSession, *, user_id: UUID, project_id: UUID) -> bool:
    """Drop the viewer's row; ``False`` when there was nothing to drop."""
    row = await get_user_engine(db, user_id=user_id, project_id=project_id)
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True
