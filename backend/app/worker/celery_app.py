"""
Celery Application Configuration.

Configura Celery with Redis como broker and result backend.
"""

import os

from celery import Celery

# Configuracao do broker Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Criar app Celery
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

# Configuracoes
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Result settings
    result_expires=3600,  # 1 hora
    # Task execution
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Rate limiting
    task_default_rate_limit="10/m",  # 10 tasks por minuto por default
    # Retry settings
    task_default_retry_delay=60,  # 1 minuto entre retries
    task_max_retries=3,
    # Concurrency
    worker_concurrency=4,
    worker_prefetch_multiplier=2,
    # Task routes (filas separadas por tipo)
    task_routes={
        "app.worker.tasks.extraction_tasks.*": {"queue": "extractions"},
        "app.worker.tasks.import_tasks.*": {"queue": "imports"},
        # Keep CPU-bound XLSX builds off the LLM-heavy `extractions` queue
        # so a long-running extraction can't starve a user-initiated export.
        "app.worker.tasks.extraction_export_tasks.*": {"queue": "exports"},
    },
)


# Task base class with logging
class LoggedTask(celery_app.Task):
    """Task base with logging estruturado."""

    def on_failure(self, exc, task_id, args, kwargs, _einfo):
        """Log em caso de falha."""
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
        """Log em caso de sucesso."""
        import structlog

        logger = structlog.get_logger()
        logger.info(
            "task_completed",
            task_id=task_id,
            task_name=self.name,
        )

    def on_retry(self, exc, task_id, _args, _kwargs, _einfo):
        """Log em caso de retry."""
        import structlog

        logger = structlog.get_logger()
        logger.warning(
            "task_retry",
            task_id=task_id,
            task_name=self.name,
            error=str(exc),
            retry_count=self.request.retries,
        )


# Registrar task base
celery_app.Task = LoggedTask
