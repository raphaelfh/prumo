"""The ONE place an engine turns into the credentials it runs on (§3.3).

An :class:`LlmTarget` names WHAT to run; this module answers WITH WHAT —
key, whose key, and (for a host connection) which host. One path:

* ``connection_id`` set — always the caller's own user-scope host, fetched
  through the ONE ownership predicate (``owned_user_connection``, in the
  WHERE clause). Missing, foreign, corrupt id or undecryptable is the typed
  :class:`ConnectionUnavailableError` (409); there is NO cloud fallback.
* otherwise — :func:`resolve_provider_key`, the one ladder (caller's key →
  project's shared key → the deployment's global setting).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_target import LlmTarget
from app.services.llm_connection_service import (
    ConnectionUnavailableError,
    KeyScope,
    LlmConnectionService,
    owned_user_connection,
    resolve_provider_key,
)

__all__ = ["EngineCredentials", "rekey_for_adopted_engine", "resolve_engine_credentials"]


@dataclass(frozen=True)
class EngineCredentials:
    """What one engine needs at the wire, plus the identity it was resolved
    FOR: ``(provider, connection_id)`` — two hosts share the provider string."""

    api_key: str | None
    key_scope: KeyScope | None
    base_url: str | None
    connection_id: str | None

    def __repr__(self) -> str:
        key = "<redacted>" if self.api_key is not None else "None"
        scope = self.key_scope.value if self.key_scope is not None else None
        return (
            f"EngineCredentials(api_key={key}, key_scope={scope!r}, "
            f"base_url={self.base_url!r}, connection_id={self.connection_id!r})"
        )


def _unavailable(connection_id: str) -> ConnectionUnavailableError:
    return ConnectionUnavailableError(
        f"The engine runs on connection {connection_id}, which is no longer available "
        "to you. Pick another engine, or re-add the connection under Integrations."
    )


async def resolve_engine_credentials(
    db: AsyncSession, *, user_id: UUID | str, project_id: UUID, engine: LlmTarget
) -> EngineCredentials:
    caller = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    if engine.connection_id is not None:
        try:
            connection_id = UUID(engine.connection_id)
        except ValueError:  # a corrupt pinned id is a typed 409, not a 500
            raise _unavailable(engine.connection_id) from None
        row = await owned_user_connection(db, connection_id, caller)
        if row is None:
            raise _unavailable(engine.connection_id)
        return EngineCredentials(
            api_key=await LlmConnectionService(db).decrypt_key(row),
            key_scope=KeyScope.USER_BYOK,
            base_url=row.base_url,
            connection_id=engine.connection_id,
        )
    resolved = await resolve_provider_key(
        db, provider=engine.provider, project_id=project_id, user_id=caller
    )
    return EngineCredentials(
        api_key=resolved.key if resolved is not None else None,
        key_scope=resolved.scope if resolved is not None else None,
        base_url=None,
        connection_id=None,
    )


async def rekey_for_adopted_engine(
    db: AsyncSession,
    *,
    user_id: UUID | str,
    project_id: UUID,
    engine: LlmTarget,
    current: EngineCredentials,
    keyed_for: str | None,
) -> EngineCredentials | None:
    """Credentials for ``engine`` when ``current`` was resolved for another
    engine — ``None`` when they still fit. The identity is the PAIR
    ``(provider, connection_id)``; ``keyed_for=None`` (direct/legacy callers)
    keeps the injected credentials unless they carry a connection identity,
    which only the engine that settled can vouch for."""
    if keyed_for is None:
        if current.connection_id is None:
            return None
    elif keyed_for == engine.provider and current.connection_id == engine.connection_id:
        return None
    return await resolve_engine_credentials(
        db, user_id=user_id, project_id=project_id, engine=engine
    )
