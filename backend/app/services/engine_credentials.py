"""The ONE place an engine turns into the credentials it runs on (C2 B9).

An :class:`~app.schemas.llm_target.LlmTarget` names WHAT to run; this
module answers WITH WHAT — key, whose key it is, and (for a custom
endpoint) which host. The three travel together in
:class:`EngineCredentials` because applying them apart is exactly how the
wrong key reaches the wrong host: an adoption that refreshed only the key
would post endpoint A's secret to endpoint B, and one that refreshed only
the host would crash ``build_model`` on a missing ``base_url``.

Two branches, never a bridge between them:

* ``endpoint_id`` set — the project's own endpoint row is the authority.
  The fetch is PROJECT-SCOPED, so a cross-project id riding a pinned
  snapshot is a miss, never another project's key. Anything wrong with
  the row (deleted, undecryptable, corrupt id) is the typed
  ``EndpointUnavailableError``; there is NO cloud fallback — a silent one
  would bill prumo's shared key for a run the project pinned elsewhere.
* no ``endpoint_id`` — the catalogue path, unchanged: the caller's BYOK
  key, else the global service key (``APIKeyService``).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_target import LlmTarget
from app.services.api_key_service import APIKeyService, KeyScope
from app.services.llm_endpoint_service import (
    EndpointNotFoundError,
    EndpointUnavailableError,
    LlmEndpointService,
)

__all__ = [
    "EngineCredentials",
    "rekey_for_adopted_engine",
    "resolve_engine_credentials",
]


@dataclass(frozen=True)
class EngineCredentials:
    """What one engine needs at the wire, plus the identity it was resolved
    FOR.

    ``endpoint_id`` is that identity, not decoration: paired with the
    engine's provider it is what the extraction services compare an adopted
    run pin against — two endpoint engines share the provider string
    ``openai_compatible``, so provider equality alone cannot tell them
    apart.
    """

    api_key: str | None
    key_scope: KeyScope | None
    base_url: str | None
    endpoint_id: str | None

    def __repr__(self) -> str:
        """Everything but the key. These objects live on service attributes,
        so the default dataclass repr would print key material into every
        traceback and debug log (§5.2: scope is recordable, the key never
        is)."""
        key = "<redacted>" if self.api_key is not None else "None"
        scope = self.key_scope.value if self.key_scope is not None else None
        return (
            f"EngineCredentials(api_key={key}, key_scope={scope!r}, "
            f"base_url={self.base_url!r}, endpoint_id={self.endpoint_id!r})"
        )


async def resolve_engine_credentials(
    db: AsyncSession,
    *,
    user_id: UUID | str,
    project_id: UUID,
    engine: LlmTarget,
) -> EngineCredentials:
    """The credentials ``engine`` runs on inside ``project_id``.

    Endpoint engine: the project-scoped row, decrypted (``InvalidToken``
    already maps to ``EndpointUnavailableError`` inside ``decrypt_key``),
    scoped ``SHARED_ENDPOINT``. A keyless endpoint (local Ollama) is legal
    — ``api_key`` is ``None`` and ``build_model`` supplies its
    ``no-key-required`` placeholder. Anything unresolvable raises; it never
    degrades to a cloud key.

    Catalogue engine: ``APIKeyService.get_key_for_provider`` exactly as
    before, with no host and no endpoint identity.
    """
    if engine.endpoint_id is not None:
        service = LlmEndpointService(db)
        try:
            row = await service.get(project_id, UUID(engine.endpoint_id))
        except (EndpointNotFoundError, ValueError):
            # ValueError: the pinned snapshot stores the id as a plain JSON
            # string, so a corrupt one lands here — a typed 409, not a 500.
            raise EndpointUnavailableError(
                f"The engine runs on custom endpoint {engine.endpoint_id}, which is "
                "no longer available in this project. Ask a project manager to "
                "restore it or choose another engine."
            ) from None
        return EngineCredentials(
            api_key=await service.decrypt_key(row),
            key_scope=KeyScope.SHARED_ENDPOINT,
            base_url=row.base_url,
            endpoint_id=engine.endpoint_id,
        )

    resolved = await APIKeyService(db, user_id).get_key_for_provider(engine.provider)
    return EngineCredentials(
        api_key=resolved.key if resolved is not None else None,
        key_scope=resolved.scope if resolved is not None else None,
        base_url=None,
        endpoint_id=None,
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
    engine — ``None`` when they still fit (nothing was re-resolved).

    An extraction adopts the run's PINNED engine, which can differ from the
    one its caller resolved credentials for (a manager flip between pin and
    kickoff; the standalone path reuses the coordinate's live run). The
    identity is the PAIR ``(provider, endpoint_id)``: two custom endpoints
    both say ``openai_compatible``, so provider equality alone would ship
    endpoint A's key to endpoint B's host. ``keyed_for=None`` means the
    caller never declared an identity (direct/legacy callers) — its
    injected credentials are used as-is, UNLESS they carry an endpoint
    identity: an endpoint credential is a key bound to one host, and a
    caller that cannot say which engine it was keyed for cannot vouch that
    it is the one that settled, so those are re-resolved instead.

    The result replaces the credentials WHOLE: key, scope and base_url move
    together, since an adoption that took only the key would leave
    ``build_model`` without a host.
    """
    if keyed_for is None:
        if current.endpoint_id is None:
            return None
    elif keyed_for == engine.provider and current.endpoint_id == engine.endpoint_id:
        return None
    return await resolve_engine_credentials(
        db, user_id=user_id, project_id=project_id, engine=engine
    )
