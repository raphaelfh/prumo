"""Extraction Celery tasks.

Celery tasks that drive AI-assisted extraction (single-section and
prediction-model extraction) plus a small batch-fanout helper.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from celery import Task

from app.core.config import settings
from app.worker._runner import run_task
from app.worker.celery_app import celery_app


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
        from app.services.api_key_service import APIKeyService
        from app.services.section_extraction_service import SectionExtractionService
        from app.worker._session import worker_session

        async with worker_session() as session:
            try:
                supabase = get_supabase_client()
                storage = create_storage_adapter(supabase)

                # Resolve user API key if not provided
                api_key = openai_api_key
                if not api_key:
                    api_key_service = APIKeyService(db=session, user_id=user_id)
                    api_key = await api_key_service.get_key_for_provider(settings.LLM_PROVIDER)

                service = SectionExtractionService(
                    db=session,
                    user_id=user_id,
                    storage=storage,
                    trace_id=self.request.id,
                    openai_api_key=api_key,
                )

                result = await service.extract_section(
                    project_id=UUID(project_id),
                    article_id=UUID(article_id),
                    template_id=UUID(template_id),
                    entity_type_id=UUID(entity_type_id),
                    parent_instance_id=UUID(parent_instance_id) if parent_instance_id else None,
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
        self.retry(exc=exc)


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

                # Resolve user API key if not provided
                api_key = openai_api_key
                if not api_key:
                    api_key_service = APIKeyService(db=session, user_id=user_id)
                    api_key = await api_key_service.get_key_for_provider(settings.LLM_PROVIDER)

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
        self.retry(exc=exc)


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
