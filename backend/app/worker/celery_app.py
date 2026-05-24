"""
Celery Application Configuration.

Configures Celery with Redis as broker and result backend.
"""

import os

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
    },
)


# Task base class with logging
class LoggedTask(celery_app.Task):
    """Task base class with structured logging."""

    def on_failure(self, exc, task_id, args, kwargs, _einfo):
        """Log on failure."""
        import structlog

        logger = structlog.get_logger()
        logger.error(
            "task_failed",
            task_id=task_id,
            task_name=self.name,
            error=str(exc),
            args=args,
            kwargs=kwargs,
        )

    def on_success(self, _retval, task_id, _args, _kwargs):
        """Log on success."""
        import structlog

        logger = structlog.get_logger()
        logger.info(
            "task_completed",
            task_id=task_id,
            task_name=self.name,
        )

    def on_retry(self, exc, task_id, _args, _kwargs, _einfo):
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
