"""Connections (§2, §3.3): create, list, the two ownership guards and
per-row Fernet.

Ownership predicates live HERE and nowhere else, in the WHERE clause:
:func:`owned_user_connection` (id + scope 'user' + user_id) and
:func:`owned_project_connection` (id + scope 'project' + project_id). A
cross-owner id is a miss, indistinguishable from a deleted row.

Key handling: ``encrypted_api_key`` is a Fernet ciphertext under
``derive_encryption_key(f"connection:{id}")`` — the ``connection:``
prefix domain-separates the row namespace (constitution §IV, per-row
derived keys). Key material never reaches a read model or an error.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from enum import StrEnum
from typing import NamedTuple
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.core.error_handler import AppError
from app.core.integrity import violates_constraint
from app.core.net_guard import validate_endpoint_url
from app.core.security import derive_encryption_key
from app.llm.registry import get_provider, global_key_for
from app.models.llm_connection import LlmConnection
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionRead,
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
    UserConnectionCreateRequest,
)
from app.schemas.llm_endpoint import LlmEndpointCapabilities
from app.services.profile_names import profile_names

__all__ = [
    "ConnectionNotFoundError",
    "ConnectionUnavailableError",
    "KeyScope",
    "LlmConnectionService",
    "ResolvedKey",
    "owned_project_connection",
    "owned_user_connection",
    "resolve_provider_key",
]

_HOSTED_PROVIDER_INDEX = "uq_llm_connections_user_hosted_provider"
_IDENTITY_INDEXES = (
    "uq_llm_connections_user_identity",
    "uq_llm_connections_project_identity",
)


class KeyScope(StrEnum):
    """Whose key paid for a call — recordable in provenance; the key never is."""

    USER_BYOK = "user_byok"
    PROJECT_SHARED = "project_shared"
    GLOBAL_SERVICE = "global_service"


class ResolvedKey(NamedTuple):
    key: str
    scope: KeyScope


class ConnectionUnavailableError(AppError):
    """A pinned connection cannot serve (gone, other owner, undecryptable).

    Same code and status as the endpoint-era error: the worker and the
    frontend classify it unchanged.
    """

    def __init__(self, message: str) -> None:
        super().__init__(code="LLM_ENDPOINT_UNAVAILABLE", message=message, status_code=409)


class ConnectionNotFoundError(Exception):
    """No connection for (owner, id). Routers translate to 404."""


def _fernet_for(connection_id: UUID) -> Fernet:
    return Fernet(base64.urlsafe_b64encode(derive_encryption_key(f"connection:{connection_id}")))


def _encrypt(connection_id: UUID, secret: str) -> str:
    return _fernet_for(connection_id).encrypt(secret.encode()).decode()


async def owned_user_connection(
    db: AsyncSession, connection_id: UUID, user_id: UUID
) -> LlmConnection | None:
    """THE user-scope ownership predicate."""
    return (
        await db.execute(
            select(LlmConnection).where(
                LlmConnection.id == connection_id,
                LlmConnection.scope == "user",
                LlmConnection.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def owned_project_connection(
    db: AsyncSession, connection_id: UUID, project_id: UUID
) -> LlmConnection | None:
    """THE project-scope ownership predicate."""
    return (
        await db.execute(
            select(LlmConnection).where(
                LlmConnection.id == connection_id,
                LlmConnection.scope == "project",
                LlmConnection.project_id == project_id,
            )
        )
    ).scalar_one_or_none()


def _to_read(row: LlmConnection, created_by_name: str | None) -> LlmConnectionRead:
    return LlmConnectionRead.model_validate(
        {
            "id": row.id,
            "scope": row.scope,
            "provider": row.provider,
            "label": row.label,
            "base_url": row.base_url,
            "has_api_key": row.encrypted_api_key is not None,
            "allowed_models": row.allowed_models,
            "capabilities": LlmEndpointCapabilities.model_validate(row.capabilities or {}),
            "validation_status": row.validation_status,
            "last_validated_at": row.last_validated_at,
            "last_used_at": row.last_used_at,
            "created_by_name": created_by_name,
            "created_at": row.created_at,
        }
    )


class LlmConnectionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _reads(self, rows: list[LlmConnection]) -> list[LlmConnectionRead]:
        names = await profile_names(self.db, {r.created_by for r in rows}) if rows else {}
        return [_to_read(r, names.get(r.created_by)) for r in rows]

    async def list_user(self, user_id: UUID) -> list[LlmConnectionRead]:
        rows = (
            (
                await self.db.execute(
                    select(LlmConnection)
                    .where(LlmConnection.scope == "user", LlmConnection.user_id == user_id)
                    .order_by(LlmConnection.created_at, LlmConnection.id)
                )
            )
            .scalars()
            .all()
        )
        return await self._reads(list(rows))

    async def list_project(self, project_id: UUID) -> list[LlmConnectionRead]:
        rows = (
            (
                await self.db.execute(
                    select(LlmConnection)
                    .where(
                        LlmConnection.scope == "project",
                        LlmConnection.project_id == project_id,
                    )
                    .order_by(LlmConnection.created_at, LlmConnection.id)
                )
            )
            .scalars()
            .all()
        )
        return await self._reads(list(rows))

    async def _create(
        self,
        *,
        scope: str,
        user_id: UUID | None,
        project_id: UUID | None,
        created_by: UUID,
        payload: UserConnectionCreateRequest | ProjectConnectionCreateRequest,
    ) -> LlmConnectionRead:
        base_url = (await validate_endpoint_url(payload.base_url)).url if payload.base_url else None
        connection_id = uuid4()  # BEFORE encrypt: it feeds the per-row key
        row = LlmConnection(
            id=connection_id,
            scope=scope,
            user_id=user_id,
            project_id=project_id,
            provider=payload.provider,
            label=payload.label,
            base_url=base_url,
            encrypted_api_key=(
                _encrypt(connection_id, payload.api_key.get_secret_value())
                if payload.api_key
                else None
            ),
            allowed_models=list(payload.allowed_models),
            capabilities={},
            validation_status="unverified",
            created_by=created_by,
        )
        self.db.add(row)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            # The hosted-provider index is label-independent, so the two
            # collisions need different messages — branch on the violated
            # constraint NAME, never on the message text.
            if violates_constraint(exc, _HOSTED_PROVIDER_INDEX):
                raise ValueError(f"You already have a key for {payload.provider}") from None
            if violates_constraint(exc, *_IDENTITY_INDEXES):
                raise ValueError(
                    f"A {payload.provider} connection labeled {payload.label!r} "
                    "already exists at this scope"
                ) from None
            raise
        return (await self._reads([row]))[0]

    async def create_user(
        self, *, user_id: UUID, payload: UserConnectionCreateRequest
    ) -> LlmConnectionRead:
        return await self._create(
            scope="user", user_id=user_id, project_id=None, created_by=user_id, payload=payload
        )

    async def create_project(
        self, *, project_id: UUID, created_by: UUID, payload: ProjectConnectionCreateRequest
    ) -> LlmConnectionRead:
        return await self._create(
            scope="project",
            user_id=None,
            project_id=project_id,
            created_by=created_by,
            payload=payload,
        )

    async def _update(
        self, row: LlmConnection | None, payload: LlmConnectionUpdateRequest
    ) -> LlmConnectionRead:
        if row is None:
            raise ConnectionNotFoundError("Connection not found")
        spec = get_provider(row.provider)
        assert spec is not None  # CHECK-backed
        if spec.needs_host:
            if not payload.base_url:
                raise ValueError(f"{row.provider} requires a base_url")
            vetted = (await validate_endpoint_url(payload.base_url)).url
        else:
            if payload.base_url is not None:
                raise ValueError(f"{row.provider} is a hosted provider; no base_url allowed")
            vetted = None
        invalidated = vetted != row.base_url or list(payload.allowed_models) != list(
            row.allowed_models
        )
        row.label, row.base_url, row.allowed_models = (
            payload.label,
            vetted,
            list(payload.allowed_models),
        )
        if payload.api_key is not None:
            secret = payload.api_key.get_secret_value()
            if secret == "" and not spec.key_optional:
                raise ValueError(f"{row.provider} requires a key; it cannot be cleared")
            row.encrypted_api_key = None if secret == "" else _encrypt(row.id, secret)
        if invalidated:
            row.validation_status, row.capabilities, row.last_validated_at = (
                "unverified",
                {},
                None,
            )
        try:
            await self.db.flush()
        except IntegrityError as exc:
            if not violates_constraint(exc, *_IDENTITY_INDEXES):
                raise
            raise ValueError(
                f"A connection labeled {payload.label!r} already exists at this scope"
            ) from None
        return (await self._reads([row]))[0]

    async def update_user(
        self, *, user_id: UUID, connection_id: UUID, payload: LlmConnectionUpdateRequest
    ) -> LlmConnectionRead:
        return await self._update(
            await owned_user_connection(self.db, connection_id, user_id), payload
        )

    async def update_project(
        self, *, project_id: UUID, connection_id: UUID, payload: LlmConnectionUpdateRequest
    ) -> LlmConnectionRead:
        return await self._update(
            await owned_project_connection(self.db, connection_id, project_id), payload
        )

    async def _delete(self, row: LlmConnection | None) -> LlmConnectionDeleteResult:
        if row is None:
            raise ConnectionNotFoundError("Connection not found")
        await self.db.delete(row)
        await self.db.flush()
        return LlmConnectionDeleteResult(deleted=True, id=row.id)

    async def delete_user(self, *, user_id: UUID, connection_id: UUID) -> LlmConnectionDeleteResult:
        return await self._delete(await owned_user_connection(self.db, connection_id, user_id))

    async def delete_project(
        self, *, project_id: UUID, connection_id: UUID
    ) -> LlmConnectionDeleteResult:
        return await self._delete(
            await owned_project_connection(self.db, connection_id, project_id)
        )

    async def decrypt_key(self, row: LlmConnection) -> str | None:
        if row.encrypted_api_key is None:
            return None
        try:
            return _fernet_for(row.id).decrypt(row.encrypted_api_key.encode()).decode()
        except InvalidToken:
            raise ConnectionUnavailableError(
                f"The stored key for connection {row.id} ({row.label!r}) cannot be decrypted. "
                "Re-enter the key."
            ) from None


async def _scoped_key_row(
    db: AsyncSession,
    *,
    provider: str,
    scope: str,
    owner_column: InstrumentedAttribute[UUID | None],
    owner_id: UUID,
) -> LlmConnection | None:
    """The keyed, host-less row for (scope, owner, provider) — a host's key
    is never handed out as a bare provider key. Project scope is unique on
    (project, provider, label), so several shared keys for one provider are
    legal: take the oldest, never ``scalar_one`` (MultipleResultsFound → 500).
    """
    return (
        await db.execute(
            select(LlmConnection)
            .where(
                LlmConnection.scope == scope,
                owner_column == owner_id,
                LlmConnection.provider == provider,
                LlmConnection.base_url.is_(None),
                LlmConnection.encrypted_api_key.is_not(None),
            )
            .order_by(LlmConnection.created_at, LlmConnection.id)
            .limit(1)
        )
    ).scalar_one_or_none()


async def resolve_provider_key(
    session: AsyncSession, *, provider: str, project_id: UUID, user_id: UUID
) -> ResolvedKey | None:
    """THE credential ladder: caller's user-scope key → project's shared key →
    the deployment's global setting. First hit wins; ``None`` when nothing has
    a key.
    """
    service = LlmConnectionService(session)
    for scope, column, owner, key_scope in (
        ("user", LlmConnection.user_id, user_id, KeyScope.USER_BYOK),
        ("project", LlmConnection.project_id, project_id, KeyScope.PROJECT_SHARED),
    ):
        row = await _scoped_key_row(
            session, provider=provider, scope=scope, owner_column=column, owner_id=owner
        )
        if row is not None:
            key = await service.decrypt_key(row)
            if key:
                row.last_used_at = datetime.now(UTC)
                await session.flush()
                return ResolvedKey(key, key_scope)
    global_key = global_key_for(provider)
    return ResolvedKey(global_key, KeyScope.GLOBAL_SERVICE) if global_key else None
