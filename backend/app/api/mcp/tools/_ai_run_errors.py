"""start_ai_run's refusals, each mapped once next to the tool's audit flow.

The recomputed plan's blockers and the start path's exceptions become the
AI-run codes; anything else that differs from the approved plan is
``PLAN_STALE``. ``to_tool_error`` never sees these: an audited code returned
from there would carry no audit row.
"""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy.exc import DBAPIError

from app.api.mcp.errors import NOT_FOUND_MESSAGE, McpErrorCode, McpToolError
from app.api.v1.endpoints._integrity import is_deadlock
from app.schemas.llm_target import EngineIdentity
from app.services.ai_run_plan_service import PlanCore, will_run_digest
from app.services.extraction_batch_service import (
    BatchAlreadyActiveError,
    BatchScopeError,
    DailyAgentCapError,
    QueueUnavailableError,
)
from app.services.llm_connection_service import ConnectionUnavailableError, MissingCredentialError
from app.services.llm_engine_service import EngineRetiredError

StaleReason = Literal["invalid", "other_token", "expired", "echo_mismatch", "changed"]
Change = Literal["articles", "engine", "payer", "template_version", "blocker"]

_STALE_MESSAGE: dict[StaleReason, str] = {
    "invalid": "The plan token is not valid for this user and project.",
    "other_token": "The plan was made with another token.",
    "expired": "The plan expired.",
    "echo_mismatch": "The confirmed values do not match the plan.",
    "changed": "The run changed since the plan.",
}
# A recomputed blocker that has its own code; any other blocker is plan drift.
_OWN_CODE = frozenset(
    {
        "AGENT_RUNS_OFF",
        "MANAGERS_ONLY",
        "AI_NOT_CONFIGURED",
        "AI_RUN_ACTIVE",
        "AI_RUN_LIMIT",
        "SERVICE_UNAVAILABLE",
    }
)


def plan_stale(reason: StaleReason, **extras: Any) -> McpToolError:
    return McpToolError(McpErrorCode.PLAN_STALE, _STALE_MESSAGE[reason], reason=reason, **extras)


def _not_configured(reason_code: str | None) -> McpToolError:
    return McpToolError(
        McpErrorCode.AI_NOT_CONFIGURED,
        "The AI engine is not ready for agent-started runs.",
        reason_code=reason_code,
    )


def _active(batch_id: object) -> McpToolError:
    return McpToolError(
        McpErrorCode.AI_RUN_ACTIVE,
        "You already have an AI run going for this template.",
        batch_id=str(batch_id),
    )


def _limit(remaining_today: int, plan: PlanCore) -> McpToolError:
    return McpToolError(
        McpErrorCode.AI_RUN_LIMIT,
        "The run is over a limit set by the project's AI agents policy.",
        remaining_today=remaining_today,
        max_articles_per_run=plan.max_articles_per_run,
    )


def _unavailable() -> McpToolError:
    return McpToolError(
        McpErrorCode.SERVICE_UNAVAILABLE, "The extraction service is not answering right now."
    )


def blocker_error(plan: PlanCore) -> McpToolError | None:
    """The code of the recomputed plan's first blocker that has one, in a
    fixed order (the policy first, the queue last)."""
    found = {b.code: b for b in plan.blockers}
    if "AGENT_RUNS_OFF" in found or "MANAGERS_ONLY" in found:
        return McpToolError(
            McpErrorCode.AI_RUNS_NOT_ALLOWED,
            "This project does not allow you to start agent AI runs.",
            agent_runs=plan.agent_runs,
        )
    if "AI_NOT_CONFIGURED" in found:
        return _not_configured(found["AI_NOT_CONFIGURED"].reason_code)
    if "AI_RUN_ACTIVE" in found:
        return _active(found["AI_RUN_ACTIVE"].batch_id)
    if "AI_RUN_LIMIT" in found:
        return _limit(plan.daily_remaining, plan)
    if "SERVICE_UNAVAILABLE" in found:
        return _unavailable()
    return None


def changes(plan: PlanCore, claims: dict[str, Any]) -> list[Change]:
    """What differs between the recomputed plan and the approved one."""
    out: list[Change] = []
    if will_run_digest(plan.will_run_ids) != claims["will_run_digest"]:
        out.append("articles")
    if plan.engine_identity != EngineIdentity.model_validate(claims["engine"]):
        out.append("engine")
    if plan.payer != claims["payer"]:
        out.append("payer")
    if str(plan.template.version_id) != claims["template_version_id"]:
        out.append("template_version")
    if any(b.code not in _OWN_CODE for b in plan.blockers):
        out.append("blocker")
    return out


def start_error(exc: Exception, plan: PlanCore) -> McpToolError | None:
    """The code of a start-path exception; ``None``: not ours, re-raise it."""
    if isinstance(exc, DailyAgentCapError):
        return _limit(exc.args[0], plan)
    if isinstance(exc, BatchAlreadyActiveError):
        return _active((exc.details or {})["batch_id"])
    if isinstance(exc, MissingCredentialError):
        return _not_configured((exc.details or {}).get("reason", "MISSING_API_KEY"))
    if isinstance(exc, EngineRetiredError):
        return _not_configured("LLM_ENGINE_RETIRED")
    if isinstance(exc, ConnectionUnavailableError):
        return _not_configured("LLM_ENDPOINT_UNAVAILABLE")
    if isinstance(exc, QueueUnavailableError):
        return _unavailable()
    if isinstance(exc, BatchScopeError):
        return McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE)
    if isinstance(exc, DBAPIError) and is_deadlock(exc):
        return McpToolError(
            McpErrorCode.RETRY,
            "A concurrent write won; nothing was started.",
            next_step="resend the same start_ai_run call; a plan never starts twice",
        )
    return None
