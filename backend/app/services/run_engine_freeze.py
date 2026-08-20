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
    runs: ExtractionRunRepository,
    run_id: UUID,
    candidate: LlmTarget,
    *,
    repin: bool = False,
) -> LlmTarget:
    """Pin the run's engine on first write; the run's pinned engine wins.

    A Celery retry re-enters with the same payload and a fresh resolution
    of the project engine, so only a run-scoped pin keeps attempt 2 on
    attempt 1's engine. First writer wins: ``candidate`` is installed only
    when the run names no engine yet, and the effective engine is returned
    either way. A pre-C1b pinned snapshot (pair only, no mode fields)
    validates via ``LlmTarget``'s defaults and is never rewritten.

    ``repin=True`` installs ``candidate`` over any existing pin — the
    caller is a human kickoff, which is entitled to the manager's current
    choice. It then returns ``candidate`` unchanged, so a caller that
    resolved credentials for it never has to re-key.
    """
    pinned = await runs.freeze_engine(run_id, candidate.model_dump(), repin=repin)
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
    db: AsyncSession, *, run_id: UUID | None, project_id: UUID, repin: bool
) -> LlmTarget:
    """The engine an attempt must run on — a READ; the write is the service's.

    A RETRY defers to the run's pin, read BEFORE the project resolve: that
    is what keeps attempt 2 on attempt 1's engine, and it also avoids a 409
    on a retired pair the run is legitimately pinned to. A human kickoff
    (``repin``) skips the pin and takes the manager's current choice — see
    ``ExtractionRunRepository.freeze_engine`` for why the pin is owed to the
    retry rather than to the run for its whole life.

    Deliberately does not freeze. Only the services know WHICH run an attempt
    resolved (the standalone paths reuse the coordinate's live run), and
    pinning from here would take the row lock before the run is even
    validated — held, on the in-request route, across the whole LLM call.
    """
    if run_id is not None and not repin:
        pinned = await read_pinned_engine(db, run_id)
        if pinned is not None:
            return pinned
    return await resolve_project_engine(db, project_id)


def build_proposal_engine(
    snapshot: dict[str, Any] | None, engine: LlmTarget
) -> dict[str, Any] | None:
    """Engine identity for ONE proposal row — how THIS value was produced.

    Derived from the section snapshot rather than rebuilt, so the per-row record
    and the run record can never disagree about how the call executed. ``None``
    when no snapshot exists (no LLM ran), which reads as "unattributed".

    Deliberately NOT the snapshot itself. That record is per-section and
    LAST-WRITE-WINS, and its first key is ``ran_by_user_id``. Two consequences
    make it the wrong thing to store on a proposal: it is relabelled whenever the
    section is re-extracted, so an older version would inherit a newer run's
    execution record; and the blind-review scrub only walks dicts read from
    ``extraction_runs.results``, so a proposal row carrying identity would never
    be visited by it and would hand a peer's user id to a blind reviewer.

    Identity is therefore excluded at the WRITE — the guarantee is "never
    stored", not "scrubbed on read" — along with ``prompt_composition`` (which
    would duplicate the full rendered prompt on every row) and ``tokens`` (a
    per-section LLM-call fact that would be a lie per field). Those keep flowing
    from the run snapshot, which readers merge underneath this.

    ``endpoint_id`` is recorded here and nowhere else: ``build_run_provenance``
    does not capture it, so custom-endpoint runs (C2) otherwise carry no engine
    identity beyond a bare model string.
    """
    if snapshot is None:
        return None
    return {
        "provider": engine.provider,
        "model": engine.model,
        "endpoint_id": engine.endpoint_id,
        "key_scope": snapshot.get("key_scope"),
        "mode_requested": snapshot.get("mode_requested"),
        "mode_executed": snapshot.get("mode_executed"),
        "passes": snapshot.get("passes", 1),
    }


def build_run_provenance(
    *,
    ran_by_user_id: str,
    engine: LlmTarget,
    key_scope: KeyScope | None,
    prompt_name: str,
    prompt_version: str,
    usage: LlmUsage | None = None,
    prompt_composition: PromptComposition | None = None,
    mode_requested: str | None = None,
    mode_executed: str | None = None,
    passes: int = 1,
) -> dict[str, Any]:
    """Per-section snapshot of how a section's suggestions were generated.

    Engine, key scope and params come from the run-frozen target and the
    single-source extractor constants, so a later ``settings`` change cannot
    rewrite what this run reports. The key itself is never recorded (§5.2).

    ``mode_requested``/``mode_executed``/``passes`` are this section's
    execution truth (§5 design 3): a verify-pass failure records
    ``mode_executed: "fast", passes: 1`` while ``mode_requested`` keeps the
    ask. They default off the engine (a request-echo) and ``passes=1`` so
    legacy callers keep working; the Verified glue passes the real outcome.
    """
    snapshot: dict[str, Any] = {
        "ran_by_user_id": ran_by_user_id,
        "provider": engine.provider,
        "model": engine.model,
        "key_scope": key_scope.value if key_scope is not None else None,
        "strategy": prompt_name,
        "prompt_version": prompt_version,
        "mode_requested": mode_requested if mode_requested is not None else engine.mode_requested,
        "mode_executed": mode_executed if mode_executed is not None else engine.mode_executed,
        "passes": passes,
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
