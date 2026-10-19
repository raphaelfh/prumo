"""plan_ai_run: preview an agent-started AI extraction run (ADR 0021).

Grant-gated (``ai_run``) and read-only: it renders ``build_plan`` and, only
when nothing blocks and minting is allowed, a signed plan token bound to this
token, user, project and plan. It writes nothing and calls no model.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import is_project_manager
from app.api.mcp import ai_run_plan_token
from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.errors import McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_ai_runs import (
    McpAiRunPlan,
    McpPlanArticle,
    McpPlanBlocker,
    McpPlanConfirm,
    McpPlanCounts,
    McpPlanEngine,
    McpPlanEstimate,
    McpPlanLimits,
    McpPlanProject,
    McpPlanTemplate,
    McpPlanWarning,
)
from app.services.ai_run_plan_service import (
    PlanCore,
    TemplateAmbiguousError,
    build_plan,
    will_run_digest,
)
from app.utils.text_caps import cap_json_weight, cap_text

_TITLE_CAP = 80
_TITLE_WEIGHT = 120  # compact-JSON chars: an escaped title cannot outgrow the result cap

_BLOCKER_TEXT: dict[str, tuple[str, str]] = {
    "AGENT_RUNS_OFF": (
        "This project does not allow agent-started AI runs.",
        "A project manager can allow them in prumo Settings → AI engine.",
    ),
    "MANAGERS_ONLY": (
        "Only project managers may start agent AI runs in this project.",
        "Ask a project manager to start the run, or to allow reviewers.",
    ),
    "TEMPLATE_NOT_PUBLISHED": (
        "The template has no published version.",
        "A project manager publishes the template in prumo.",
    ),
    "AI_NOT_CONFIGURED": (
        "The AI engine is not ready for agent-started runs.",
        "Configure the AI engine, or add your own or the project's key, in prumo.",
    ),
    "AI_RUN_ACTIVE": (
        "You already have an AI run going for this template.",
        "Wait for it to finish, or cancel it in prumo.",
    ),
    "AI_RUN_LIMIT": (
        "The run is over a limit set by the project's AI agents policy.",
        "Run fewer articles, or wait for the daily window to free up.",
    ),
    "SERVICE_UNAVAILABLE": (
        "The extraction service is not answering right now.",
        "Try again in a few minutes.",
    ),
    "NOTHING_TO_RUN": (
        "No article in the selection can run.",
        "Pick other articles, or pass rerun_articles_with_ai_suggestions=true.",
    ),
}
_WARNING_TEXT: dict[str, str] = {
    "PICOTS_OFF_OR_EMPTY": "The review question is off or empty: AI gets no review context.",
    "TEMPLATE_INSTRUCTION_PLACEHOLDERS": (
        "The template instruction still holds [customize: ...] placeholders."
    ),
    "ARTICLES_UNPARSED": (
        "Some articles have no parsed text yet; they are parsed first, which takes longer."
    ),
    "VERIFIED_MODE_TWO_PASSES": "Verified mode runs every section twice.",
}
_PAYER_PHRASE = {
    "your_key": "your own API key",
    "project_key": "the project's shared API key",
}


def _title(value: str) -> str:
    return cap_json_weight(cap_text(value, _TITLE_CAP)[0], _TITLE_WEIGHT)[0]


def _selection_claim(plan: PlanCore) -> str:
    if plan.selection == "remaining":
        return "remaining"
    raw = b"".join(article_id.bytes for article_id in plan.selection)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _confirmation(plan: PlanCore, payer: str) -> str:
    engine = plan.engine
    assert engine is not None  # no AI_NOT_CONFIGURED blocker => the engine resolved
    passes = plan.estimate.passes
    skipped = len(plan.skipped)
    breakdown = ", ".join(
        f"{count} {reason}" for reason, count in sorted(_skip_counts(plan).items())
    )
    skip_text = f" {skipped} skipped ({breakdown})." if skipped else ""
    return (
        f"Run AI extraction on {len(plan.will_run_ids)} of {plan.requested} articles in "
        f'project "{plan.project_name}" with {engine.label or engine.model} '
        f"({engine.mode} mode, {passes} pass{'es' if passes > 1 else ''} per section), "
        f"paid with {_PAYER_PHRASE[payer]}.{skip_text} "
        "AI only adds suggestions; answers people gave are kept. "
        "Reviewers of these articles will see the suggestions."
    )


def _skip_counts(plan: PlanCore) -> dict[str, int]:
    counts: dict[str, int] = {}
    for reason in plan.skipped.values():
        counts[reason] = counts.get(reason, 0) + 1
    return counts


@agent_tool(
    requires="ai_run",
    role="reviewer",
    tier="ai_plan",
    read_only=True,
    open_world=False,
    requires_user_interaction=False,
    destructive=False,
    idempotent=True,
    project_arg="project_id",
    title="Plan an AI extraction run",
    description=(
        "Preview an AI extraction run without starting it. Use ONLY when the user explicitly "
        "asked, in this conversation, to run AI extraction. Defaults to the project's active "
        "extraction template and the articles without AI suggestions yet. Returns what would "
        "run, what is skipped and why, the model, who pays, a token estimate, blockers, and a "
        "`confirmation` text to show the user verbatim. Runs no AI and changes nothing."
    ),
)
async def plan_ai_run(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID | None = None,
    article_ids: Annotated[list[UUID], Field(min_length=1, max_length=100)] | None = None,
    rerun_articles_with_ai_suggestions: bool = False,
) -> McpAiRunPlan:
    principal = current_principal()
    now = datetime.now(UTC)
    try:
        plan = await build_plan(
            db,
            owner_id=principal.user_sub,
            project_id=project_id,
            template_id=template_id,
            article_ids=article_ids,
            rerun=rerun_articles_with_ai_suggestions,
            caller_is_manager=await is_project_manager(db, project_id, principal.user_sub),
            now=now,
        )
    except TemplateAmbiguousError as exc:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT,
            "Name the template to run: the project has no single active extraction template.",
            field="template_id",
            templates=[
                {"id": str(tid), "name": cap_text(name, _TITLE_CAP)[0], "kind": kind}
                for tid, name, kind in exc.templates
            ],
            untrusted_content=True,
            untrusted_fields=["templates[].name"],
        ) from exc

    can_start = not plan.blockers and ai_run_plan_token.minting_allowed()
    token = expires_at = confirm = confirmation = None
    if can_start and plan.payer is not None and plan.engine is not None:
        iat = int(now.timestamp())
        token, _digest = ai_run_plan_token.mint(
            {
                "token_id": str(principal.token_id),
                "user_id": str(principal.user_sub),
                "project_id": str(project_id),
                "template_id": str(plan.template.id),
                "template_version_id": str(plan.template.version_id),
                "selection": _selection_claim(plan),
                "rerun": plan.rerun,
                "will_run_digest": will_run_digest(plan.will_run_ids),
                "will_run_count": len(plan.will_run_ids),
                "engine": plan.engine_identity.model_dump(mode="json")
                if plan.engine_identity is not None
                else None,
                "payer": plan.payer,
                "iat": iat,
            }
        )
        expires_at = datetime.fromtimestamp(iat, UTC) + ai_run_plan_token.TOKEN_TTL
        confirm = McpPlanConfirm(
            article_count=len(plan.will_run_ids),
            model=f"{plan.engine.provider}:{plan.engine.model}",
            payer=plan.payer,
        )
        confirmation = _confirmation(plan, plan.payer)
    else:
        can_start = False

    will_run = set(plan.will_run_ids)
    return McpAiRunPlan(
        project=McpPlanProject(id=project_id, name=cap_text(plan.project_name, _TITLE_CAP)[0]),
        template=McpPlanTemplate(
            id=plan.template.id,
            name=cap_text(plan.template.name, _TITLE_CAP)[0],
            kind=plan.template.kind,
            version=plan.template.version,
        ),
        engine=McpPlanEngine(
            provider=plan.engine.provider,
            model=plan.engine.model,
            label=plan.engine.label,
            mode=plan.engine.mode,  # type: ignore[arg-type]
            cost_tier=plan.engine.cost_tier,
        )
        if plan.engine is not None
        else None,
        payer=plan.payer,
        counts=McpPlanCounts(
            requested=plan.requested,
            will_run=len(plan.will_run_ids),
            skipped=len(plan.skipped),
            remaining_beyond_cap=plan.remaining_beyond_cap,
        ),
        skipped_by_reason=_skip_counts(plan),  # type: ignore[arg-type]
        articles=[
            McpPlanArticle(
                article_id=article_id,
                title=_title(title),
                will_run=article_id in will_run,
                reason_code=plan.skipped.get(article_id),
            )
            for article_id, title in list(plan.titles.items())[:100]
        ],
        estimate=McpPlanEstimate(
            input_tokens_low=plan.estimate.input_tokens_low,
            llm_calls_low=plan.estimate.llm_calls_low,
            passes=plan.estimate.passes,
        ),
        limits=McpPlanLimits(
            max_articles_per_run=plan.max_articles_per_run, daily_remaining=plan.daily_remaining
        ),
        blockers=[
            McpPlanBlocker(
                code=b.code,
                reason_code=b.reason_code,
                message=_BLOCKER_TEXT[b.code][0],
                fix=_BLOCKER_TEXT[b.code][1],
                batch_id=b.batch_id,
            )
            for b in plan.blockers
        ],
        warnings=[McpPlanWarning(code=w, message=_WARNING_TEXT[w]) for w in plan.warnings],  # type: ignore[arg-type]
        can_start=can_start,
        plan_token=token,
        expires_at=expires_at,
        confirm=confirm,
        confirmation=confirmation,
    )
