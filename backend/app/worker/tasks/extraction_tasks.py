"""Extraction Celery tasks.

Celery tasks that drive AI-assisted extraction (single-section and
prediction-model extraction) plus a small batch-fanout helper.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

import random
from typing import Any
from uuid import UUID

from celery import Task

from app.llm.errors import is_transient_llm_error
from app.services.extraction_errors import ExtractionTaskError, classify_extraction_error

# Module-level on purpose: these are the patchable seams the task tests pin
# (``extraction_tasks.resolve_project_engine`` / ``.read_pinned_engine``).
from app.services.llm_engine_service import resolve_project_engine
from app.services.run_engine_freeze import read_pinned_engine
from app.worker._runner import run_task
from app.worker.celery_app import celery_app

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
        from app.services.api_key_service import APIKeyService, KeyScope
        from app.services.section_extraction_service import SectionExtractionService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)

                # DEAD ENTRY POINT: no production enqueue sites remain (the
                # live path is run_section_extraction_task). Real invariant
                # before re-arming: pin first when a run exists — read the
                # run's pinned engine BEFORE keying, the way
                # run_section_extraction_task does; resolving only the
                # project engine lets a manager flip re-route a pinned run.
                # This task carries no run_id, so it resolves the project
                # engine and relies on the service's re-key (key_provider)
                # when a reused run's pin settles on another provider.
                engine = await resolve_project_engine(session, UUID(project_id))

                # Resolve user API key if not provided
                api_key = openai_api_key
                # An api_key handed in through the message is the caller's own.
                key_scope: KeyScope | None = KeyScope.USER_BYOK if api_key else None
                if not api_key:
                    api_key_service = APIKeyService(db=session, user_id=user_id)
                    resolved = await api_key_service.get_key_for_provider(engine.provider)
                    if resolved is not None:
                        api_key, key_scope = resolved.key, resolved.scope

                service = SectionExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                    openai_api_key=api_key,
                    key_scope=key_scope,
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
        from app.services.api_key_service import APIKeyService
        from app.services.model_extraction_service import ModelExtractionService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)

                # DEAD ENTRY POINT: no production enqueue sites remain (only
                # the equally-unenqueued batch_extract_task fans out here).
                # Real invariant before re-arming: pin first when a run
                # exists — the endpoint path reads the run's pinned engine
                # before keying (resolve_engine_for_run); this task carries
                # no run_id, so it resolves the project engine only. Align
                # with the endpoint before re-use.
                engine = await resolve_project_engine(session, UUID(project_id))

                # Resolve user API key if not provided
                api_key = openai_api_key
                if not api_key:
                    api_key_service = APIKeyService(db=session, user_id=user_id)
                    # Scope is dropped here on purpose: this service writes no
                    # provenance, so there is nothing to record it against.
                    resolved = await api_key_service.get_key_for_provider(engine.provider)
                    api_key = resolved.key if resolved is not None else None

                service = ModelExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                    openai_api_key=api_key,
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
        from app.services.api_key_service import APIKeyService
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

                # C1b ordering (panel, security): freeze — or read the
                # already-pinned engine — FIRST, and only then resolve the
                # key for the PINNED provider. A retry after a manager's
                # provider flip must not look up a key for a provider the
                # frozen engine does not use (spurious MissingLLMKeyError +
                # key_scope recorded against the wrong provider).
                engine = (
                    await read_pinned_engine(session, request.run_id)
                    if request.run_id is not None
                    else None
                )
                if engine is None:
                    engine = await resolve_project_engine(session, request.project_id)

                api_key_service = APIKeyService(db=session, user_id=user_id)
                resolved = await api_key_service.get_key_for_provider(engine.provider)

                service = SectionExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=trace_id or self.request.id or "worker-missing-trace",
                    openai_api_key=resolved.key if resolved is not None else None,
                    key_scope=resolved.scope if resolved is not None else None,
                    # F1: the provider this key was resolved FOR. The
                    # standalone branch (run_id=None) can still ADOPT the
                    # coordinate's live run's pin inside the service — a
                    # provider flip between pin and kickoff would pair this
                    # key with an engine it does not fit, so the service
                    # re-keys itself when the adopted provider differs.
                    key_provider=engine.provider,
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
