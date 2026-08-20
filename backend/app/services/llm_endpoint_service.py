"""Project-scoped custom LLM endpoints (§C2): CRUD, per-row Fernet, verify.

Owns ``project_llm_endpoints`` — the SECRETS table (API-only, deny-all
RLS; see the model docstring). Every fetch is project-scoped: a
cross-project endpoint id is a miss, never another project's row (BOLA
gate). Queries are inlined here per the house rule (single-service
entity); the service flushes, never commits.

Key handling: ``encrypted_api_key`` is a Fernet ciphertext under a
per-ROW derived key — ``derive_encryption_key(f"endpoint:{id}")``. The
``endpoint:`` prefix domain-separates the row namespace from the
per-user namespace ``APIKeyService`` derives from (both are bare uuid
strings otherwise) — deliberate, plan decision 3. Constitution §IV was
amended for this per-row variant ("per-user or per-row derived keys").
Key material never appears on a read model (``has_api_key`` only) and
never in an error message.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.core.logging import get_logger
from app.core.net_guard import validate_endpoint_url
from app.core.security import derive_encryption_key
from app.models.project import Project
from app.models.project_llm_endpoint import ProjectLlmEndpoint
from app.schemas.llm_endpoint import (
    LlmEndpointCapabilities,
    LlmEndpointCreateRequest,
    LlmEndpointDeleteResult,
    LlmEndpointProbeResult,
    LlmEndpointRead,
    LlmEndpointUpdateRequest,
)
from app.services.llm_endpoint_probe import probe_endpoint
from app.services.llm_engine_service import _profile_names
from app.services.parser_settings_service import ProjectNotFoundError

__all__ = [
    "EndpointNotFoundError",
    "EndpointUnavailableError",
    "LlmEndpointService",
    "ProjectNotFoundError",
]


class EndpointUnavailableError(AppError):
    """A stored endpoint cannot serve: its key no longer decrypts, or a
    delete was refused because the project engine still points at it.

    Mirrors :class:`~app.services.llm_engine_service.EngineRetiredError`:
    as an :class:`AppError` the registered handler serves the typed
    envelope — ``error.code = "LLM_ENDPOINT_UNAVAILABLE"``, HTTP 409 —
    and the worker classifies it by type into a friendly task code
    (plan decision 13).
    """

    def __init__(self, message: str) -> None:
        super().__init__(code="LLM_ENDPOINT_UNAVAILABLE", message=message, status_code=409)


class EndpointNotFoundError(Exception):
    """No endpoint at (project_id, endpoint_id). HTTP translation (404) in
    the router — the :class:`ProjectNotFoundError` pattern."""


logger = get_logger(__name__)

#: The (project_id, label) unique constraint (see the model's table args).
_LABEL_CONSTRAINT = "uq_llm_endpoint_label"


def _is_duplicate_label(exc: IntegrityError) -> bool:
    """True when ``exc`` is the (project_id, label) unique violation.

    asyncpg exposes the violated constraint on ``constraint_name`` (via
    ``exc.orig`` or its ``__cause__``); the message text carries it too —
    the ``is_one_live_run_conflict`` pattern.
    """
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "constraint_name", None) == _LABEL_CONSTRAINT:
            return True
    return _LABEL_CONSTRAINT in str(orig or exc)


def _fernet_for(endpoint_id: UUID) -> Fernet:
    """The row's Fernet, from the shared per-row derived key.

    ``f"endpoint:{id}"`` is the deliberate domain separation described in
    the module docstring (plan decision 3, constitution §IV amendment).
    """
    key = derive_encryption_key(f"endpoint:{endpoint_id}")
    return Fernet(base64.urlsafe_b64encode(key))


def _to_read(row: ProjectLlmEndpoint, created_by_name: str | None) -> LlmEndpointRead:
    """The manager-surface read shape. ``model_validate`` is the boundary:
    it re-checks the closed ``validation_status`` vocabulary and drops any
    unknown ``capabilities`` keys — and key material has no field to leak
    into."""
    return LlmEndpointRead.model_validate(
        {
            "id": row.id,
            "label": row.label,
            "base_url": row.base_url,
            "has_api_key": row.encrypted_api_key is not None,
            "allowed_models": row.allowed_models,
            "capabilities": LlmEndpointCapabilities.model_validate(row.capabilities or {}),
            "validation_status": row.validation_status,
            "last_validated_at": row.last_validated_at,
            "created_by_name": created_by_name,
        }
    )


class LlmEndpointService:
    """CRUD + verify for a project's custom OpenAI-compatible endpoints."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_for_project(self, project_id: UUID) -> list[LlmEndpointRead]:
        """Every endpoint of the project, oldest first, with creator names
        resolved in one batched profile select."""
        rows = (
            (
                await self.db.execute(
                    select(ProjectLlmEndpoint)
                    .where(ProjectLlmEndpoint.project_id == project_id)
                    # id tiebreaker: same-transaction inserts share now(),
                    # and an un-ordered tail is not a contract.
                    .order_by(ProjectLlmEndpoint.created_at, ProjectLlmEndpoint.id)
                )
            )
            .scalars()
            .all()
        )
        names: dict[UUID, str | None] = {}
        if rows:
            names = await _profile_names(self.db, {row.created_by for row in rows})
        return [_to_read(row, names.get(row.created_by)) for row in rows]

    async def get(self, project_id: UUID, endpoint_id: UUID) -> ProjectLlmEndpoint:
        """Service-layer only — endpoints consume ``LlmEndpointRead``.

        Project-scoped fetch: a cross-project id is a miss (BOLA gate).
        """
        row = (
            await self.db.execute(
                select(ProjectLlmEndpoint).where(
                    ProjectLlmEndpoint.id == endpoint_id,
                    ProjectLlmEndpoint.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise EndpointNotFoundError(f"Endpoint {endpoint_id} not found in project {project_id}")
        return row

    async def create(
        self,
        *,
        project_id: UUID,
        created_by: UUID,
        payload: LlmEndpointCreateRequest,
    ) -> LlmEndpointRead:
        """Vet the URL, encrypt the key under the new row's id, insert."""
        # SSRF gate FIRST — EndpointUrlError propagates sanitized.
        vetted = await validate_endpoint_url(payload.base_url)
        # Pre-check the (project_id, label) unique gate so a duplicate is a
        # clean ValueError (400), not an IntegrityError 500. The check is
        # advisory (a racer can still slip past it) — the flush below turns
        # the lost race into the SAME error.
        if await self._label_taken(project_id, payload.label):
            raise ValueError(
                f"An endpoint labeled {payload.label!r} already exists in this project"
            )
        # id BEFORE encrypt: it feeds the per-row key derivation.
        endpoint_id = uuid4()
        encrypted: str | None = None
        if payload.api_key is not None:
            encrypted = (
                _fernet_for(endpoint_id)
                .encrypt(payload.api_key.get_secret_value().encode())
                .decode()
            )
        row = ProjectLlmEndpoint(
            id=endpoint_id,
            project_id=project_id,
            label=payload.label,
            base_url=vetted.url,  # normalized form, never the raw input
            encrypted_api_key=encrypted,
            allowed_models=list(payload.allowed_models),
            capabilities={},
            validation_status="unverified",
            created_by=created_by,
        )
        self.db.add(row)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            if not _is_duplicate_label(exc):
                raise
            # The racer that lost. Same message as the pre-check: the caller
            # sees one behaviour, not two shaped by timing.
            raise ValueError(
                f"An endpoint labeled {payload.label!r} already exists in this project"
            ) from None
        names = await _profile_names(self.db, {created_by})
        return _to_read(row, names.get(created_by))

    async def _label_taken(self, project_id: UUID, label: str) -> bool:
        """Whether the project already has an endpoint with this label."""
        return (
            await self.db.execute(
                select(ProjectLlmEndpoint.id).where(
                    ProjectLlmEndpoint.project_id == project_id,
                    ProjectLlmEndpoint.label == label,
                )
            )
        ).scalar_one_or_none() is not None

    async def update(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
        payload: LlmEndpointUpdateRequest,
    ) -> LlmEndpointRead:
        """Full-replace ``label``/``base_url``/``allowed_models``; ``api_key``
        tri-state (None keeps, "" clears, a string re-encrypts).

        A ``base_url`` or ``allowed_models`` change invalidates the last
        probe — what was verified is no longer what is stored — so
        ``validation_status``/``capabilities``/``last_validated_at`` reset.
        A label or key change keeps the probe outcome.
        """
        row = await self.get(project_id, endpoint_id)
        vetted = await validate_endpoint_url(payload.base_url)  # re-vetted on every write
        invalidated = vetted.url != row.base_url or list(payload.allowed_models) != list(
            row.allowed_models
        )
        row.label = payload.label
        row.base_url = vetted.url
        row.allowed_models = list(payload.allowed_models)
        if payload.api_key is not None:
            secret = payload.api_key.get_secret_value()
            # Re-encrypt under the SAME endpoint-id-derived key — the id
            # never changes, so neither does the key.
            row.encrypted_api_key = (
                None if secret == "" else _fernet_for(row.id).encrypt(secret.encode()).decode()
            )
        if invalidated:
            row.validation_status = "unverified"
            row.capabilities = {}
            row.last_validated_at = None
        await self.db.flush()
        names = await _profile_names(self.db, {row.created_by})
        return _to_read(row, names.get(row.created_by))

    async def delete(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
    ) -> LlmEndpointDeleteResult:
        """Delete the endpoint — unless the project engine points at it.

        The FOR UPDATE lock on the project row (the ``set_for_project``
        pattern) serializes the pointer check against a concurrent engine
        write, so the engine cannot be pointed at this endpoint between
        check and DELETE. UX sugar: the real guarantee stays the typed
        run-time error (plan decision 13).
        """
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
        row = await self.get(project_id, endpoint_id)
        engine_raw: Any = (project.settings or {}).get("llm_engine")
        # Raw dict read ON PURPOSE (not LlmEngineStored): a payload the
        # spine cannot validate must still block the delete when it names
        # this endpoint — the raw key works for pre-B8 hand-written JSONB
        # and post-B8 stored payloads alike.
        pointed = engine_raw.get("endpoint_id") if isinstance(engine_raw, dict) else None
        if pointed is not None and str(pointed) == str(endpoint_id):
            raise EndpointUnavailableError(
                f"Endpoint {row.label!r} cannot be deleted: the project engine "
                "points at it. Choose another engine first."
            )
        await self.db.delete(row)
        await self.db.flush()
        return LlmEndpointDeleteResult(deleted=True, id=endpoint_id)

    async def verify(
        self,
        *,
        project_id: UUID,
        endpoint_id: UUID,
    ) -> LlmEndpointProbeResult:
        """Probe the endpoint and persist the outcome. The ROUTE only calls
        this — fetch (BOLA-scoped), decrypt, re-vet the stored URL, run the
        B5 ladder, persist capabilities/status/timestamp.

        Three phases, in this order and with NO database work in the middle
        one: every read happens before the network call and every write
        after it. The session's transaction is still open across the probe
        (the request owns it and a rollback here would discard the caller's
        work), but it holds NO lock — deliberately no ``FOR UPDATE``, unlike
        :meth:`delete` — and the wait is bounded: ``_DNS_TIMEOUT_S`` for the
        re-vet plus the probe's own overall ceiling
        (``llm_endpoint_probe._PROBE_DEADLINE_S``, 60s).
        """
        row = await self.get(project_id, endpoint_id)
        api_key = await self.decrypt_key(row)
        # A stored URL is re-vetted before every probe: fails closed if the
        # row was hand-edited or the resolution changed. Sanitized
        # EndpointUrlError propagates.
        vetted = await validate_endpoint_url(row.base_url)
        try:
            result = await probe_endpoint(
                vetted=vetted,
                api_key=api_key,
                allowed_models=list(row.allowed_models),
            )
        except Exception:
            # The probe promises never to raise on endpoint behavior, so
            # this is OUR bug — but the row must not keep advertising a
            # stale ``ok``. Record the failure and RETURN it (re-raising
            # would abort the route before its commit, losing exactly the
            # record this exists to write); the detail goes to the log,
            # never to the manager.
            logger.error(
                "llm_endpoint_verify_unexpected_error",
                endpoint_id=str(endpoint_id),
                project_id=str(project_id),
                exc_info=True,
            )
            result = LlmEndpointProbeResult(
                validation_status="failed",
                output_mode=None,
                models_seen=[],
                error="internal_error",
            )
        row.capabilities = LlmEndpointCapabilities(
            output_mode=result.output_mode,
            models_seen=result.models_seen,
        ).model_dump(mode="json")
        row.validation_status = result.validation_status
        row.last_validated_at = datetime.now(UTC)
        await self.db.flush()
        return result

    async def decrypt_key(self, endpoint: ProjectLlmEndpoint) -> str | None:
        """The plaintext key, or ``None`` for a keyless endpoint.

        ``InvalidToken`` (tampered or rekeyed ciphertext) maps to the typed
        409; the message names the endpoint (id + label) and NEVER carries
        ciphertext.
        """
        if endpoint.encrypted_api_key is None:
            return None
        try:
            return _fernet_for(endpoint.id).decrypt(endpoint.encrypted_api_key.encode()).decode()
        except InvalidToken:
            raise EndpointUnavailableError(
                f"The stored API key for endpoint {endpoint.id} "
                f"({endpoint.label!r}) cannot be decrypted. Re-enter the key."
            ) from None
