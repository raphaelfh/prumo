"""
Celery Application Configuration.

Configures Celery with Redis as broker and result backend.
"""

import os
from typing import Any

from celery import Celery

# Redis broker configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Create the Celery app
celery_app = Celery(
    "review_hub",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.worker.tasks.extraction_tasks",
        "app.worker.tasks.import_tasks",
        "app.worker.tasks.export_tasks",
        "app.worker.tasks.extraction_export_tasks",
        "app.worker.tasks.feedback_tasks",
    ],
)

# Configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Result settings
    result_expires=3600,  # 1 hour
    # Task execution
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Rate limiting
    task_default_rate_limit="10/m",  # 10 tasks per minute by default
    # Retry settings
    task_default_retry_delay=60,  # 1 minute between retries
    task_max_retries=3,
    # Concurrency
    worker_concurrency=4,
    worker_prefetch_multiplier=2,
    # Task routes (queues separated by type). Every module in
    # ``include=`` MUST appear here explicitly — the registry test in
    # ``tests/unit/test_celery_app_task_registry.py`` enforces this so
    # new task modules cannot silently fall back to the default
    # ``celery`` queue (which the Railway worker may or may not be
    # consuming). The drift guard
    # ``tests/unit/test_celery_routes_drift.py`` then asserts every
    # queue named here is in the worker ``--queues=...`` list.
    task_routes={
        "app.worker.tasks.extraction_tasks.*": {"queue": "extractions"},
        "app.worker.tasks.import_tasks.*": {"queue": "imports"},
        # Keep CPU-bound XLSX builds off the LLM-heavy `extractions` queue
        # so a long-running extraction can't starve a user-initiated export.
        "app.worker.tasks.extraction_export_tasks.*": {"queue": "exports"},
        # Article exports (CSV/RIS/RDF + ZIP) — explicit `celery` queue so
        # the drift guard has a clean baseline. The Railway worker
        # consumes `celery` alongside the three named queues.
        "app.worker.tasks.export_tasks.*": {"queue": "celery"},
        # Feedback forwarding to Linear — low-volume, no special resource
        # requirements, routed to the already-consumed `celery` queue.
        "app.worker.tasks.feedback_tasks.*": {"queue": "celery"},
    },
)


# Task base class with logging
class LoggedTask(celery_app.Task):
    """Task base class with structured logging."""

    def on_failure(
        self,
        exc: Exception,
        task_id: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        _einfo: Any,
    ) -> None:
        """Log on failure."""
        import structlog
        from celery.exceptions import NotRegistered

        logger = structlog.get_logger()
        if isinstance(exc, NotRegistered):
            # P1-class incident: an enqueued task has no handler. Always
            # caused by a module missing from celery_app.include or a
            # routing typo. Surface separately so dashboards can alert.
            logger.error(
                "celery.task_unregistered",
                task_id=task_id,
                task_name=self.name,
                args=args,
                kwargs=kwargs,
                remediation=(
                    "Check celery_app.include for the missing module and "
                    "tests/unit/test_celery_app_task_registry.py for the "
                    "regression guard."
                ),
            )
            return
        logger.error(
            "task_failed",
            task_id=task_id,
            task_name=self.name,
            error=str(exc),
            args=args,
            kwargs=kwargs,
        )

    def on_success(
        self,
        _retval: Any,
        task_id: str,
        _args: tuple[Any, ...],
        _kwargs: dict[str, Any],
    ) -> None:
        """Log on success."""
        import structlog

        logger = structlog.get_logger()
        logger.info(
            "task_completed",
            task_id=task_id,
            task_name=self.name,
        )

    def on_retry(
        self,
        exc: Exception,
        task_id: str,
        _args: tuple[Any, ...],
        _kwargs: dict[str, Any],
        _einfo: Any,
    ) -> None:
        """Log on retry."""
        import structlog

        logger = structlog.get_logger()
        logger.warning(
            "task_retry",
            task_id=task_id,
            task_name=self.name,
            error=str(exc),
            retry_count=self.request.retries,
        )


# Register the base task class
celery_app.Task = LoggedTask


# Register a signal handler for tasks that the worker receives but
# cannot find in its registry. Celery routes this through the consumer
# (signals.task_unknown), not the task instance's on_failure callback —
# so a NotRegistered branch in on_failure alone would be dead code in
# production. Keep both paths: the signal is the runtime hook, the
# on_failure branch is defense in depth in case Celery changes routing.
from celery.signals import task_unknown, worker_init  # noqa: E402


@worker_init.connect
def _configure_worker_observability(**_kwargs: Any) -> None:
    """Logfire bootstrap for the worker process. Runs via signal (not at
    import time) so the API process importing this module for ``.delay()``
    doesn't get configured with the wrong service_name."""
    from app.llm.observability import configure_observability

    configure_observability(service_name="prumo-worker")


@task_unknown.connect
def _on_task_unknown(
    sender: Any = None,  # noqa: ARG001
    name: str | None = None,
    id: str | None = None,  # noqa: A002 — Celery signal kwarg name
    message: Any = None,  # noqa: ARG001
    exc: Exception | None = None,  # noqa: ARG001
    **_kwargs: Any,
) -> None:
    """Log unregistered-task events as a P1 incident.

    Triggered by Celery when a worker pops a message whose ``task``
    header does not match any entry in ``celery_app.tasks``. Always
    caused by a module missing from ``celery_app.include`` or a routing
    typo. The regression guard at
    ``tests/unit/test_celery_app_task_registry.py`` prevents this at CI,
    and the drift guard at ``tests/unit/test_celery_routes_drift.py``
    prevents queue/route mismatches; this signal is the runtime safety
    net.
    """
    import structlog

    structlog.get_logger().error(
        "celery.task_unregistered",
        task_id=id,
        task_name=name,
        remediation=(
            "Check celery_app.include for the missing module and "
            "tests/unit/test_celery_app_task_registry.py for the "
            "regression guard."
        ),
    )
