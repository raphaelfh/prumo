"""The identity an agent-started run is approved on and guarded by (ADR 0021).

One builder for the plan (``build_plan``), the plan token's ``engine`` claim
and the dispatcher's kill switch, so the three compare the same value.
"""

from __future__ import annotations

import hashlib
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_target import EngineIdentity, LlmTarget
from app.schemas.mcp_ai_runs import Payer
from app.services import llm_connection_service
from app.services.llm_connection_service import owned_user_connection


async def payer_for(
    db: AsyncSession, target: LlmTarget, *, project_id: UUID, owner_id: UUID
) -> Payer | None:
    """Whose key ``target`` runs on for ``owner_id``; ``None``: no key an
    agent run may use (the deployment key never pays for one)."""
    if target.connection_id is not None:
        return "your_key"
    rung = (
        await llm_connection_service.availability_map(
            db, project_id=project_id, user_id=owner_id, providers=[target.provider]
        )
    ).get(target.provider)
    return {"user": "your_key", "project": "project_key"}.get(rung or "")  # type: ignore[return-value]


async def _endpoint_sha256(db: AsyncSession, target: LlmTarget, owner_id: UUID) -> str | None:
    if target.connection_id is None:
        return None
    row = await owned_user_connection(db, UUID(target.connection_id), owner_id)
    if row is None or row.base_url is None:
        return None
    return hashlib.sha256(row.base_url.encode()).hexdigest()


async def engine_identity(
    db: AsyncSession, target: LlmTarget, *, project_id: UUID, owner_id: UUID
) -> EngineIdentity:
    """The identity of the engine ``target`` resolves to for ``owner_id``."""
    return EngineIdentity(
        provider=target.provider,
        model=target.model,
        mode=target.mode_requested,
        connection_id=target.connection_id,
        endpoint_sha256=await _endpoint_sha256(db, target, owner_id),
        payer=await payer_for(db, target, project_id=project_id, owner_id=owner_id),
    )
