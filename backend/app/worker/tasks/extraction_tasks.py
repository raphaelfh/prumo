"""Extraction Celery tasks.

Celery tasks that drive AI-assisted extraction (single-section and
prediction-model extraction) plus a small batch-fanout helper.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

import random
from dataclasses import replace
from typing import Any
from uuid import UUID

from celery import Task

from app.core.logging import get_logger
from app.llm.errors import is_transient_llm_error
from app.services.api_key_service import KeyScope
from app.services.engine_credentials import EngineCredentials
from app.services.extraction_errors import ExtractionTaskError, classify_extraction_error

# Module-level on purpose: these are the patchable seams the task tests pin
# (``extraction_tasks.resolve_project_engine`` / ``.resolve_engine_for_run``).
from app.services.llm_engine_service import resolve_project_engine
from app.services.run_engine_freeze import resolve_engine_for_run
from app.worker._runner import run_task
from app.worker.celery_app import celery_app

logger = get_logger(__name__)

_RETRY_BASE_SECONDS = 60
_RETRY_MAX_SECONDS = 600


def _with_byok_override(
    credentials: EngineCredentials,
    openai_api_key: str | None,
    *,
    provider: str,
) -> EngineCredentials:
    """Apply a message-borne key to CATALOGUE credentials only.

    A key handed in through the task message is the CALLER's own, and it
    overrides just the KEY half — the resolved base_url and endpoint
    identity still travel, or an endpoint engine would reach ``build_model``
    without a host.

    For an ENDPOINT-backed engine there is nothing to override: the host is
    the manager's choice and the endpoint's shared key is the only
    credential that belongs on it. Applying the caller's key there would
    post a personal secret to a third-party host AND record the run as
    ``user_byok`` when it ran on shared infrastructure. Ignored, loudly —
    the log names the endpoint and provider, never the key.
    """
    if not openai_api_key:
        return credentials
    if credentials.endpoint_id is not None:
        logger.warning(
            "byok_override_ignored_for_endpoint_engine",
            endpoint_id=credentials.endpoint_id,
            provider=provider,
        )
        return credentials
    return replace(credentials, api_key=openai_api_key, key_scope=KeyScope.USER_BYOK)


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
def extract_section_task(
    self: Task[Any, Any],
    project_id: str,
    article_id: str,
    template_id: str,
    entity_type_id: str,
    user_id: str,
    parent_instance_id: str | None = None,
    openai_api_key: str | None = None,
) -> dict[str, Any]:
    """Run AI extraction for a single section of an article.

    Args:
        project_id: Project UUID.
        article_id: Article UUID.
        template_id: Project template UUID.
        entity_type_id: Entity type UUID to extract.
        user_id: User UUID owning the run.
        parent_instance_id: Parent instance UUID, when extracting a child
            section under a model container (optional).
        openai_api_key: BYOK override. If ``None``, the user's stored key
            is resolved; falls back to the global service key.

    Returns:
        Dict with the extraction result summary.
    """

    async def run() -> dict[str, Any]:
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.engine_credentials import resolve_engine_credentials
        from app.services.section_extraction_service import SectionExtractionService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)

                # DEAD ENTRY POINT: no production enqueue sites remain (the
                # live path is run_section_extraction_task). Before re-arming,
                # take the engine from ``resolve_engine_for_run(..., repin=
                # self.request.retries == 0)`` as that task does: a bare
                # project resolve makes every attempt a re-pin, so a retry
                # can run an engine attempt 1 did not. This task carries no
                # run_id and passes no ``repin``, so it currently DEFERS to a
                # reused run's pin and relies on the service's re-key
                # (key_provider) when that pin names another provider.
                # If re-armed on an OLD build, a stored mode this build does
                # not know degrades the read to the env-default engine.
                engine = await resolve_project_engine(session, UUID(project_id))

                # One resolver for key + scope + endpoint host (B9); the
                # message-borne key applies to catalogue engines only (see
                # ``_with_byok_override``).
                credentials = _with_byok_override(
                    await resolve_engine_credentials(
                        session, user_id=user_id, project_id=UUID(project_id), engine=engine
                    ),
                    openai_api_key,
                    provider=engine.provider,
                )

                service = SectionExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                    llm_credentials=credentials,
                    key_provider=engine.provider,
                )

                result = await service.extract_section(
                    project_id=UUID(project_id),
                    article_id=UUID(article_id),
                    template_id=UUID(template_id),
                    entity_type_id=UUID(entity_type_id),
                    parent_instance_id=UUID(parent_instance_id) if parent_instance_id else None,
                    engine=engine,
                )

                await session.commit()

                return {
                    "extraction_run_id": result.extraction_run_id,
                    "suggestions_created": result.suggestions_created,
                    "entity_type_id": result.entity_type_id,
                    "duration_ms": int(result.duration_ms),
                }
            except Exception:
                await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        if not is_transient_llm_error(exc):
            raise  # permanent: fail fast, no retry
        raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    rate_limit="5/m",
)
def extract_models_task(
    self: Task[Any, Any],
    project_id: str,
    article_id: str,
    template_id: str,
    user_id: str,
    openai_api_key: str | None = None,
) -> dict[str, Any]:
    """Run AI extraction for prediction models in an article.

    Args:
        project_id: Project UUID.
        article_id: Article UUID.
        template_id: Project template UUID.
        user_id: User UUID owning the run.
        openai_api_key: BYOK override. If ``None``, the user's stored key
            is resolved; falls back to the global service key.

    Returns:
        Dict with the extracted models summary.
    """

    async def run() -> dict[str, Any]:
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.engine_credentials import resolve_engine_credentials
        from app.services.model_extraction_service import ModelExtractionService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)

                # DEAD ENTRY POINT: no production enqueue sites remain (only
                # the equally-unenqueued batch_extract_task fans out here).
                # Before re-arming, pass ``repin=self.request.retries == 0``
                # to ``extract`` below: it defaults to False, so today every
                # attempt DEFERS to a reused run's pin and a manager's model
                # change would never reach this path — the bug fixed on the
                # live route. If re-armed on an OLD build, a stored mode it
                # does not know degrades the read to the env-default engine.
                engine = await resolve_project_engine(session, UUID(project_id))

                # One resolver for key + endpoint host (B9). The scope rides
                # along unused: this service writes no provenance, but the
                # credential is applied whole — splitting it is how an
                # endpoint key reaches a cloud host. The message-borne key
                # applies to catalogue engines only (``_with_byok_override``).
                credentials = _with_byok_override(
                    await resolve_engine_credentials(
                        session, user_id=user_id, project_id=UUID(project_id), engine=engine
                    ),
                    openai_api_key,
                    provider=engine.provider,
                )

                service = ModelExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                    llm_credentials=credentials,
                )

                result = await service.extract(
                    project_id=UUID(project_id),
                    article_id=UUID(article_id),
                    template_id=UUID(template_id),
                    engine=engine,
                )

                await session.commit()

                return {
                    "extraction_run_id": result.extraction_run_id,
                    "total_models": result.total_models,
                    "child_instances_created": result.child_instances_created,
                    "duration_ms": int(result.duration_ms),
                    "models": [
                        {
                            "instance_id": m.get("instanceId") or m.get("instance_id"),
                            # Public API contract keeps "model_name" as
                            # the key; internal sources may use either
                            # the new neutral "name" or the legacy
                            # "modelName"/"model_name".
                            "model_name": (
                                m.get("name") or m.get("modelName") or m.get("model_name")
                            ),
                            "model_type": (
                                m.get("modellingMethod")
                                or m.get("modelType")
                                or m.get("model_type")
                            ),
                        }
                        for m in result.models_created
                    ],
                }
            except Exception:
                await session.rollback()
                raise

    try:
        return run_task(run)
    except Exception as exc:
        if not is_transient_llm_error(exc):
            raise  # permanent: fail fast, no retry
        raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))


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
                    # (with their endpoint_id, the full identity). The
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


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    rate_limit="1/m",
)
def batch_extract_task(
    self: Task[Any, Any],  # noqa: ARG001
    project_id: str,
    article_ids: list[str],
    template_id: str,
    user_id: str,
) -> dict[str, Any]:
    """Fan out model extraction across a batch of articles.

    Args:
        project_id: Project UUID.
        article_ids: List of article UUIDs to extract.
        template_id: Project template UUID.
        user_id: User UUID owning the runs.

    Returns:
        Dict with per-article queue stats for the batch.
    """
    results = {
        "total": len(article_ids),
        "queued": 0,
        "results": [],
    }

    for article_id in article_ids:
        try:
            task = extract_models_task.delay(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                user_id=user_id,
            )

            results["results"].append(
                {
                    "article_id": article_id,
                    "task_id": task.id,
                    "status": "queued",
                }
            )
            results["queued"] += 1

        except Exception as e:
            results["results"].append(
                {
                    "article_id": article_id,
                    "status": "failed",
                    "error": str(e),
                }
            )

    return results
