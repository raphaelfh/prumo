"""Kill switches for an agent-started batch (ADR 0021), checked before each advance.

An agent batch keeps running only while three things still hold: the
credential that started it is usable and still carries the AI-run grant, the project policy still lets its
owner start agent runs, and the project's engine is the one the human
approved. In-flight items always finish; only queued ones are withheld.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_batch import ExtractionBatch
from app.schemas.llm_target import EngineIdentity
from app.services import ai_policy_service
from app.services.llm_engine_service import EngineRetiredError, resolve_engine, viewer_is_manager
from app.services.pat_service import token_is_usable

TOKEN_INACTIVE = (
    "AGENT_TOKEN_INACTIVE",
    "The access token that started this run was revoked or expired.",
)
RUNS_DISABLED = ("AGENT_RUNS_DISABLED", "A project manager turned off agent-started runs.")
ENGINE_CHANGED = (
    "AGENT_ENGINE_CHANGED",
    "The project's AI engine changed after this run was approved.",
)


async def agent_stop_reason(db: AsyncSession, batch: ExtractionBatch) -> tuple[str, str] | None:
    """(stop_code, stop_message) when an agent-started batch must stop; None to continue.

    Order: token -> policy -> engine. Only called when batch.agent_plan_digest is not None.
    """
    if not await token_is_usable(db, batch.agent_token_id, ai_run=True):
        return TOKEN_INACTIVE

    policy = await ai_policy_service.read(db, batch.project_id)
    if policy.agent_runs == "off" or (
        policy.agent_runs == "managers"
        and not await viewer_is_manager(db, batch.project_id, batch.owner_id)
    ):
        return RUNS_DISABLED

    try:
        current = await resolve_engine(db, batch.project_id, batch.owner_id)
    except EngineRetiredError as exc:
        return "ENGINE_RETIRED", exc.message
    if EngineIdentity.from_target(current) != EngineIdentity.model_validate(batch.agent_engine):
        return ENGINE_CHANGED
    return None
