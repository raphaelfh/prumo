"""Extraction Celery tasks.

Celery tasks that drive AI-assisted extraction (single-section and
prediction-model extraction) plus a small batch-fanout helper.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

import random
from typing import Any

from celery import Task

from app.core.logging import get_logger
from app.llm.errors import is_transient_llm_error
from app.services.extraction_errors import ExtractionTaskError, classify_extraction_error

# Module-level on purpose: this is the patchable seam the task tests pin
# (``extraction_tasks.resolve_engine_for_run``).
from app.services.run_engine_freeze import resolve_engine_for_run
from app.worker._runner import run_task
from app.worker.celery_app import celery_app

logger = get_logger(__name__)

_RETRY_BASE_SECONDS = 60
_RETRY_MAX_SECONDS = 600


def _retry_countdown(retries: int) -> float:
    """Exponential backoff with jitter, with the final value capped at the
    max (so jitter never pushes a retry past _RETRY_MAX_SECONDS)."""
    # float() pins the type: mypy infers ``2**retries`` as Any (the exponent
    # sign is unknown), which would otherwise poison the declared float return.
    base = float(min(_RETRY_BASE_SECONDS * 2**retries, _RETRY_MAX_SECONDS))
    return min(base + random.uniform(0, base * 0.1), float(_RETRY_MAX_SECONDS))


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    rate_limit="5/m",
)
def run_section_extraction_task(
    self: Task[Any, Any],
    payload_json: dict[str, Any],
    user_id: str,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Run AI section extraction from a serialised SectionExtractionRequest.

    Covers all three dispatch branches (single-section, extract-for-run,
    extract-all-sections) via ``SectionExtractionService.run_from_request``.
    Intended as the async-safe replacement for firing extraction on the
    synchronous web request (which causes gunicorn worker timeouts on real PDFs).

    Args:
        payload_json: ``SectionExtractionRequest`` fields as a plain dict
            (camelCase aliases accepted — Pydantic parses them).
        user_id: User UUID owning the run.
        trace_id: Optional trace ID forwarded from the originating request.

    Returns:
        Normalised result dict.  Shape depends on the branch:
        - Single-section: ``{"mode": "single", "extraction_run_id": str,
          "suggestions_created": int}``
        - Batch (extract_for_run / extract_all_sections): ``{"mode": "batch",
          "extraction_run_id": str, "total_sections": int,
          "successful_sections": int, "failed_sections": int,
          "total_suggestions_created": int}``
    """

    async def run() -> dict[str, Any]:
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.schemas.extraction import SectionExtractionRequest
        from app.services.engine_credentials import resolve_engine_credentials
        from app.services.section_extraction_service import (
            BatchAllSectionsFailed,
            BatchExtractionResult,
            SectionExtractionService,
        )
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)

                request = SectionExtractionRequest(**payload_json)

                # Attempt 0 is the HUMAN kickoff (one enqueue site — the
                # endpoint); every later attempt is a Celery retry, which
                # re-enters HERE with the same payload. Hence the flag is
                # derived at this line and never rides IN the payload:
                # ``self.retry`` replays kwargs, so a payload flag would
                # re-pin on exactly the attempts that must not.
                repin = self.request.retries == 0

                # C1b ordering (panel, security): settle the engine FIRST,
                # then resolve the key for it. A retry that keyed for the
                # manager's NEW provider while running the pinned one gets a
                # spurious MissingLLMKeyError and a key_scope recorded
                # against a provider that never ran.
                engine = await resolve_engine_for_run(
                    session,
                    run_id=request.run_id,
                    project_id=request.project_id,
                    repin=repin,
                )

                credentials = await resolve_engine_credentials(
                    session,
                    user_id=user_id,
                    project_id=request.project_id,
                    engine=engine,
                )

                service = SectionExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=trace_id or self.request.id or "worker-missing-trace",
                    llm_credentials=credentials,
                    # F1: the provider these credentials were resolved FOR
                    # (with their connection_id, the full identity). The
                    # standalone branch (run_id=None) can still ADOPT the
                    # coordinate's live run's pin inside the service — an
                    # engine flip between pin and kickoff would pair these
                    # credentials with an engine they do not fit, so the
                    # service re-resolves when the adopted engine differs.
                    # Under repin the service installs THIS engine instead of
                    # adopting, so the re-key is a no-op on the kickoff path.
                    key_provider=engine.provider,
                    repin=repin,
                )

                res = await service.run_from_request(request, engine=engine)

                await session.commit()

                if isinstance(res, BatchExtractionResult):
                    return {
                        "mode": "batch",
                        "extraction_run_id": res.extraction_run_id,
                        "total_sections": res.total_sections,
                        "successful_sections": res.successful_sections,
                        "failed_sections": res.failed_sections,
                        "total_suggestions_created": res.total_suggestions_created,
                        # Per-section outcomes — enables legacy frontend flows to
                        # reconstruct BatchSectionResult.sections from the job result.
                        "sections": res.sections,
                    }

                # SectionExtractionResult (single)
                return {
                    "mode": "single",
                    "extraction_run_id": res.extraction_run_id,
                    "suggestions_created": res.suggestions_created,
                    # entity_type_id — enables legacy frontend flows to reconstruct
                    # SingleSectionResult.entityTypeId from the job result.
                    "entity_type_id": res.entity_type_id,
                }

            except BatchAllSectionsFailed:
                # The service already rolled back data writes and marked the run
                # FAILED (rollback_and_fail). Commit that terminal status so the
                # failed run is visible to status polls — a blanket rollback would
                # discard it (matches the pre-async endpoint's handling).
                await session.commit()
                raise
            except Exception:
                await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        if is_transient_llm_error(exc) and self.request.retries < self.max_retries:
            # Transient and retries remain — back off and retry.
            raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))
        # Terminal failure (permanent, or transient with retries exhausted):
        # attach a stable, machine-readable code so the status endpoint can
        # surface specific frontend copy instead of parsing the exception repr.
        code, message = classify_extraction_error(exc)
        raise ExtractionTaskError(code, message) from exc
