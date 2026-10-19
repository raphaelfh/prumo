"""The plan core of an agent-started AI extraction run: a pure read.

``build_plan`` answers what a run would do — template, engine, payer, which
articles run and which are skipped and why, a lower-bound estimate, blockers
and warnings — without writing a row, calling a model or decrypting a key.
``plan_ai_run`` renders it; ``start_ai_run`` recomputes it and refuses drift.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.catalog import find_entry
from app.models.article import Article, ArticleFile
from app.models.extraction import ProjectExtractionTemplate
from app.repositories.extraction_batch_repository import ExtractionBatchRepository
from app.schemas.ai_policy import AgentRuns
from app.schemas.llm_target import EngineIdentity, LlmTarget
from app.schemas.mcp_ai_runs import BlockerCode, BlockerReason, Payer, SkipReason
from app.services import ai_policy_service, engine_credentials
from app.services.ai_run_plan_estimate import Estimate, estimate, warnings_for
from app.services.article_read_service import owned_articles
from app.services.current_run import CurrentRunResolver
from app.services.engine_identity import engine_identity
from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher
from app.services.extraction_batch_guards import (
    runs_with_ai_suggestions,
    runs_with_owner_live_attempt,
    stage_reason,
)
from app.services.extraction_batch_service import AGENT_CAP_WINDOW
from app.services.llm_connection_service import ConnectionUnavailableError, MissingCredentialError
from app.services.llm_engine_service import EngineRetiredError, resolve_engine
from app.services.project_read_service import project_name
from app.services.project_template_active_service import owned_template
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
)
from app.worker import queue_health

_TEMPLATE_KIND_EXTRACTION = "extraction"


class TemplateAmbiguousError(Exception):
    """No template named and not exactly one active extraction template."""

    def __init__(self, templates: list[tuple[UUID, str, str]]) -> None:
        super().__init__("Name the template to run")
        self.templates = templates  # (id, name, kind) of the active templates


@dataclass(frozen=True, slots=True)
class PlanTemplate:
    id: UUID
    name: str
    kind: str
    version_id: UUID | None
    version: int | None


@dataclass(frozen=True, slots=True)
class PlanEngine:
    provider: str
    model: str
    label: str | None
    mode: str
    cost_tier: Literal["$", "$$", "$$$"] | None
    connection_id: str | None


@dataclass(frozen=True, slots=True)
class Blocker:
    code: BlockerCode
    reason_code: BlockerReason | None = None
    batch_id: UUID | None = None


@dataclass(frozen=True)
class PlanCore:
    project_id: UUID
    project_name: str
    template: PlanTemplate
    engine: PlanEngine | None  # None when the engine cannot resolve (retired)
    engine_identity: EngineIdentity | None
    agent_runs: AgentRuns
    daily_cap: int
    max_articles_per_run: int
    payer: Payer | None
    requested: int
    will_run_ids: list[UUID]
    skipped: dict[UUID, SkipReason]
    remaining_beyond_cap: int
    titles: dict[UUID, str]  # every selected article, in selection order
    estimate: Estimate
    daily_remaining: int
    selection: Literal["remaining"] | list[UUID]
    rerun: bool
    blockers: list[Blocker] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def will_run_digest(ids: Sequence[UUID]) -> str:
    """sha256 hex of the sorted will-run ids: what the token binds."""
    return hashlib.sha256("".join(sorted(str(i) for i in ids)).encode()).hexdigest()


async def _template(
    db: AsyncSession, project_id: UUID, template_id: UUID | None
) -> ProjectExtractionTemplate:
    if template_id is not None:
        return await owned_template(db, project_id=project_id, template_id=template_id)
    active = list(
        (
            await db.execute(
                select(ProjectExtractionTemplate)
                .where(
                    ProjectExtractionTemplate.project_id == project_id,
                    ProjectExtractionTemplate.is_active.is_(True),
                )
                .order_by(ProjectExtractionTemplate.name, ProjectExtractionTemplate.id)
            )
        ).scalars()
    )
    extraction = [t for t in active if t.kind == _TEMPLATE_KIND_EXTRACTION]
    if len(extraction) != 1:
        raise TemplateAmbiguousError([(t.id, t.name, t.kind) for t in active])
    return extraction[0]


async def _engine(
    db: AsyncSession, project_id: UUID, owner_id: UUID
) -> tuple[LlmTarget | None, Blocker | None]:
    try:
        target = await resolve_engine(db, project_id, owner_id)
    except EngineRetiredError:
        return None, Blocker("AI_NOT_CONFIGURED", "LLM_ENGINE_RETIRED")
    try:
        await engine_credentials.assert_engine_ready(
            db, project_id=project_id, user_id=owner_id, allow_global=False
        )
    except MissingCredentialError as exc:
        reason = (exc.details or {}).get("reason", "MISSING_API_KEY")
        return target, Blocker("AI_NOT_CONFIGURED", reason)
    except ConnectionUnavailableError:
        return target, Blocker("AI_NOT_CONFIGURED", "LLM_ENDPOINT_UNAVAILABLE")
    except EngineRetiredError:
        return target, Blocker("AI_NOT_CONFIGURED", "LLM_ENGINE_RETIRED")
    return target, None


def _plan_engine(target: LlmTarget | None) -> PlanEngine | None:
    if target is None:
        return None
    entry = find_entry(target.provider, target.model)
    return PlanEngine(
        provider=target.provider,
        model=target.model,
        label=entry.label if entry is not None else None,
        mode=target.mode_requested,
        cost_tier=entry.cost_tier if entry is not None else None,
        connection_id=target.connection_id,
    )


async def _titles(db: AsyncSession, project_id: UUID, ids: Sequence[UUID]) -> dict[UUID, str]:
    rows = await db.execute(
        select(Article.id, Article.title).where(
            Article.project_id == project_id, Article.id.in_(ids)
        )
    )
    return {article_id: title or "" for article_id, title in rows.all()}


async def _remaining(
    db: AsyncSession, *, project_id: UUID, template_id: UUID, rerun: bool
) -> list[tuple[UUID, str]]:
    """Project articles by (title, id) whose run is not finalized and (rerun
    or no AI suggestion yet)."""
    rows = (
        await db.execute(
            select(Article.id, Article.title)
            .where(Article.project_id == project_id)
            .order_by(Article.title, Article.id)
        )
    ).all()
    runs = await CurrentRunResolver(db).resolve_by_article(
        project_id=project_id, template_id=template_id, article_ids=[r[0] for r in rows]
    )
    suggested = (
        set() if rerun else await runs_with_ai_suggestions(db, [r.id for r in runs.values()])
    )
    out: list[tuple[UUID, str]] = []
    for article_id, title in rows:
        run = runs.get(article_id)
        if run is not None and (stage_reason(run.stage) == "RUN_FINALIZED" or run.id in suggested):
            continue
        out.append((article_id, title or ""))
    return out


async def _latest_pdf_markdown_chars(
    db: AsyncSession, article_ids: Sequence[UUID]
) -> dict[UUID, int | None]:
    """Per article with a PDF: the latest PDF's ``content_markdown`` length
    (None when unparsed). The set form of ``get_latest_pdf``'s predicate."""
    if not article_ids:
        return {}
    rows = await db.execute(
        select(ArticleFile.article_id, func.length(ArticleFile.content_markdown))
        .where(ArticleFile.article_id.in_(article_ids), ArticleFile.file_type.ilike("%pdf%"))
        .order_by(ArticleFile.article_id, ArticleFile.created_at.desc())
        .distinct(ArticleFile.article_id)
    )
    return dict(rows.tuples().all())


async def _skips(
    db: AsyncSession,
    *,
    owner_id: UUID,
    project_id: UUID,
    template_id: UUID,
    ids: list[UUID],
    pdf_chars: dict[UUID, int | None],
    rerun: bool,
    now: datetime,
) -> dict[UUID, SkipReason]:
    """The dispatcher's guards predicted over a read-only run resolution."""
    runs = await CurrentRunResolver(db).resolve_by_article(
        project_id=project_id, template_id=template_id, article_ids=ids
    )
    run_ids = [r.id for r in runs.values()]
    live = await runs_with_owner_live_attempt(
        db,
        run_ids=run_ids,
        owner_id=owner_id,
        since=now - ExtractionBatchDispatcher.LIVE_WINDOW,
    )
    suggested = set() if rerun else await runs_with_ai_suggestions(db, run_ids)
    skipped: dict[UUID, SkipReason] = {}
    for article_id in ids:
        run = runs.get(article_id)
        reason = stage_reason(run.stage if run is not None else None)
        if reason is not None:
            skipped[article_id] = reason  # type: ignore[assignment]
        elif run is not None and run.id in live:
            skipped[article_id] = "AI_ALREADY_RUNNING"
        elif run is not None and run.id in suggested:
            skipped[article_id] = "ALREADY_HAS_AI_SUGGESTIONS"
        elif article_id not in pdf_chars:
            skipped[article_id] = "NO_PDF"
    return skipped


async def build_plan(
    db: AsyncSession,
    *,
    owner_id: UUID,
    project_id: UUID,
    template_id: UUID | None,
    article_ids: list[UUID] | None,
    rerun: bool,
    caller_is_manager: bool,
    now: datetime,
) -> PlanCore:
    """Strictly reads. Raises ``TemplateAmbiguousError``,
    ``ProjectTemplateNotFoundError`` or ``ArticleNotFoundError``."""
    blockers: list[Blocker] = []
    template = await _template(db, project_id, template_id)
    try:
        tree = await get_active_version_tree(db, project_id=project_id, template_id=template.id)
    except NoActiveTemplateVersionError:
        tree = None
        blockers.append(Blocker("TEMPLATE_NOT_PUBLISHED"))

    policy = await ai_policy_service.read(db, project_id)
    if policy.agent_runs == "off":
        blockers.append(Blocker("AGENT_RUNS_OFF"))
    elif policy.agent_runs == "managers" and not caller_is_manager:
        blockers.append(Blocker("MANAGERS_ONLY"))

    target, engine_blocker = await _engine(db, project_id, owner_id)
    if engine_blocker is not None:
        blockers.append(engine_blocker)
    identity = (
        await engine_identity(db, target, project_id=project_id, owner_id=owner_id)
        if target is not None
        else None
    )

    cap = policy.max_articles_per_run
    selection: Literal["remaining"] | list[UUID]
    if article_ids is not None:
        selected = await owned_articles(db, project_id=project_id, article_ids=article_ids)
        selection = selected
        beyond = 0
        found = await _titles(db, project_id, selected)
        titles = {article_id: found.get(article_id, "") for article_id in selected}
        if len(selected) > cap:
            blockers.append(Blocker("AI_RUN_LIMIT", "MAX_ARTICLES_PER_RUN"))
    else:
        remaining = await _remaining(
            db, project_id=project_id, template_id=template.id, rerun=rerun
        )
        selection = "remaining"
        selected = [article_id for article_id, _ in remaining[:cap]]
        beyond = max(len(remaining) - cap, 0)
        titles = dict(remaining[:cap])

    pdf_chars = await _latest_pdf_markdown_chars(db, selected)
    skipped = await _skips(
        db,
        owner_id=owner_id,
        project_id=project_id,
        template_id=template.id,
        ids=selected,
        pdf_chars=pdf_chars,
        rerun=rerun,
        now=now,
    )
    will_run = [a for a in selected if a not in skipped]

    batches = ExtractionBatchRepository(db)
    active = await batches.active_batch_id(owner_id, template.id)
    if active is not None:
        blockers.append(Blocker("AI_RUN_ACTIVE", batch_id=active))
    used = await batches.agent_articles_since(project_id, since=now - AGENT_CAP_WINDOW)
    daily_remaining = max(policy.daily_agent_article_cap - used, 0)
    if len(will_run) > daily_remaining:
        blockers.append(Blocker("AI_RUN_LIMIT", "DAILY_CAP"))
    if not queue_health.is_queue_available():
        blockers.append(Blocker("SERVICE_UNAVAILABLE"))
    if not will_run:
        blockers.append(Blocker("NOTHING_TO_RUN"))

    mode = target.mode_requested if target is not None else "fast"
    entity_types = tree.entity_types if tree is not None else []
    top_level = sum(1 for et in entity_types if et.parent_entity_type_id is None)
    return PlanCore(
        project_id=project_id,
        project_name=await project_name(db, project_id),
        template=PlanTemplate(
            id=template.id,
            name=template.name,
            kind=template.kind,
            version_id=tree.version_id if tree is not None else None,
            version=tree.version if tree is not None else None,
        ),
        engine=_plan_engine(target),
        engine_identity=identity,
        agent_runs=policy.agent_runs,
        daily_cap=policy.daily_agent_article_cap,
        max_articles_per_run=cap,
        payer=identity.payer if identity is not None else None,  # type: ignore[arg-type]
        requested=len(selected),
        will_run_ids=will_run,
        skipped=skipped,
        remaining_beyond_cap=beyond,
        titles=titles,
        estimate=estimate(
            [pdf_chars.get(a) for a in will_run], top_level=top_level, verified=mode == "verified"
        ),
        daily_remaining=daily_remaining,
        selection=selection,
        rerun=rerun,
        blockers=blockers,
        warnings=await warnings_for(
            db,
            project_id=project_id,
            instruction=template.llm_template_instruction,
            unparsed=any(pdf_chars.get(a) is None for a in will_run),
            verified=mode == "verified",
        ),
    )
