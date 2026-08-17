"""Run-scoped engine freeze + provenance snapshot helpers (C1b).

Extracted from ``SectionExtractionService`` (file-size fitness) with
explicit params — pure functions of their inputs, shared by the service
and the worker tasks.

The pin lives at ``run.results["provenance"]["engine"]`` (server-only;
``run.parameters`` is client-writable and must never hold provenance —
the hole #610 closed on the export side).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.extractor import LLM_TEMPERATURE, OUTPUT_RETRIES_DEFAULT, LlmUsage
from app.models.extraction import ExtractionRun
from app.repositories import ExtractionRunRepository
from app.schemas.llm_target import LlmTarget
from app.schemas.prompt_composition import PromptComposition
from app.services.llm_engine_service import resolve_project_engine

if TYPE_CHECKING:
    from app.services.api_key_service import KeyScope


async def freeze_run_engine(
    runs: ExtractionRunRepository, run_id: UUID, candidate: LlmTarget
) -> LlmTarget:
    """Pin the run's engine on first write; the run's pinned engine wins.

    A Celery retry re-enters with the same payload and a fresh resolution
    of the project engine, so only a run-scoped pin keeps attempt 2 on
    attempt 1's engine. First writer wins: ``candidate`` is installed only
    when the run names no engine yet, and the effective engine is returned
    either way. A pre-C1b pinned snapshot (pair only, no mode fields)
    validates via ``LlmTarget``'s defaults and is never rewritten.
    """
    pinned = await runs.freeze_engine(run_id, candidate.model_dump())
    return LlmTarget.model_validate(pinned) if pinned else candidate


async def read_pinned_engine(db: AsyncSession, run_id: UUID) -> LlmTarget | None:
    """The engine a run is already pinned to, or ``None`` — read-only.

    The worker reads this BEFORE resolving an API key so a retry after a
    manager's provider flip looks up the key for the PINNED provider —
    otherwise the attempt resolves a key for a provider the frozen engine
    does not use (spurious ``MissingLLMKeyError``, and a ``key_scope``
    recorded against the wrong provider).
    """
    run = await db.get(ExtractionRun, run_id)
    if run is None:
        return None
    pinned = ((run.results or {}).get("provenance") or {}).get("engine")
    if isinstance(pinned, dict) and pinned:
        return LlmTarget.model_validate(pinned)
    return None


async def resolve_engine_for_run(
    db: AsyncSession, *, run_id: UUID | None, project_id: UUID
) -> LlmTarget:
    """The engine a kickoff must run on, pin included (endpoint-callable).

    A run's PINNED engine wins and is read FIRST — before the project
    resolve, which could 409 a retired pair the run is legitimately pinned
    to — so a pinned run can never execute a second engine while
    ``provenance.engine`` names the first. An unpinned (or absent — the
    service 404s it later) run resolves the project engine and freezes it
    onto the run so the record exists before any LLM call; ``run_id=None``
    is a plain project resolve. Lives in the service layer because the
    freeze needs ``ExtractionRunRepository``, which the api layer must not
    import (``check_layered_arch``).
    """
    if run_id is not None:
        pinned = await read_pinned_engine(db, run_id)
        if pinned is not None:
            return pinned
    engine, _mode = await resolve_project_engine(db, project_id)
    if run_id is not None:
        engine = await freeze_run_engine(ExtractionRunRepository(db), run_id, engine)
    return engine


def build_run_provenance(
    *,
    ran_by_user_id: str,
    engine: LlmTarget,
    key_scope: KeyScope | None,
    prompt_name: str,
    prompt_version: str,
    usage: LlmUsage | None = None,
    prompt_composition: PromptComposition | None = None,
) -> dict[str, Any]:
    """Per-section snapshot of how a section's suggestions were generated.

    Engine, key scope and params come from the run-frozen target and the
    single-source extractor constants, so a later ``settings`` change cannot
    rewrite what this run reports. The key itself is never recorded (§5.2).
    """
    snapshot: dict[str, Any] = {
        "ran_by_user_id": ran_by_user_id,
        "provider": engine.provider,
        "model": engine.model,
        "key_scope": key_scope.value if key_scope is not None else None,
        "strategy": prompt_name,
        "prompt_version": prompt_version,
        "params": {
            "temperature": LLM_TEMPERATURE,
            "output_retries": OUTPUT_RETRIES_DEFAULT,
            "timeout_seconds": settings.LLM_TIMEOUT_SECONDS,
        },
    }
    if usage is not None:
        snapshot["tokens"] = {
            "prompt": usage.prompt_tokens,
            "completion": usage.completion_tokens,
            "total": usage.total_tokens,
        }
    if prompt_composition is not None:
        snapshot["prompt_composition"] = prompt_composition.model_dump()
    return snapshot
