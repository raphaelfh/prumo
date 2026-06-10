# Celery tasks in prumo

The worker app lives at `backend/app/worker/celery_app.py`. Task modules under `backend/app/worker/tasks/` (extraction / import / export). Broker and backend are Redis (`REDIS_URL`).

## Worker startup (local)

```bash
cd backend
celery -A app.worker.celery_app worker --loglevel=info
# or with autoreload during dev:
celery -A app.worker.celery_app worker --loglevel=debug -Q celery --concurrency=2
```

The app's `include=[...]` list in `celery_app.py` is the registry. New task modules must be added to that list, or Celery won't see the decorators.

## Task shape

Celery tasks are sync entry points. To use async services, wrap with `asyncio.run`:

```python
import asyncio
from typing import Any
from uuid import UUID

from app.worker.celery_app import celery_app


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=5,
    rate_limit="5/m",
    acks_late=True,
)
def extract_section_task(
    self,
    *,
    project_id: str,
    article_id: str,
    template_id: str,
    user_id: str,
) -> dict[str, Any]:
    """Extract one section. Idempotent on (article_id, template_id, section_id)."""
    # Late imports — keeps Celery startup fast and avoids circular imports.
    from app.core.deps import AsyncSessionLocal
    from app.services.section_extraction_service import SectionExtractionService

    async def _run():
        async with AsyncSessionLocal() as db:
            service = SectionExtractionService(db)
            return await service.extract(
                project_id=UUID(project_id),
                article_id=UUID(article_id),
                template_id=UUID(template_id),
                user_id=UUID(user_id),
            )

    return asyncio.run(_run())
```

Why these flags:
- `bind=True` — gives access to `self` so the task can call `self.retry(...)` when needed.
- `autoretry_for=(Exception,)` — auto-retry on any unhandled exception. Tighten the tuple (e.g. `(httpx.HTTPError, OperationalError)`) once you know which failures are transient.
- `retry_backoff=True` + `retry_backoff_max=600` — exponential backoff capped at 10 min.
- `retry_jitter=True` — spread retries to avoid thundering-herd on a downstream service.
- `max_retries=5` — total attempts = 1 + 5. Tune per task; a Zotero import task can afford more, an OpenAI call usually fewer.
- `acks_late=True` — the broker holds the message until the task succeeds, so a worker crash redelivers. Pair with idempotency or you'll double-process.
- `rate_limit="5/m"` — per-worker rate cap. Useful for OpenAI / Zotero calls that have provider rate limits.

## Serialization — primitives only

Celery's JSON serializer can't carry SQLAlchemy instances, Pydantic models, or `UUID` objects directly:

| Pass | Don't pass |
|---|---|
| UUID as string (`str(some_uuid)`) | `UUID` object |
| dict / list | ORM instance |
| Pydantic `.model_dump()` | Pydantic instance |
| datetime as ISO 8601 string | `datetime` object |

Reconstruct types inside the task (`UUID(project_id)`).

## Idempotency

Tasks **will** be re-delivered. Plan for it.

Two patterns that work:

1. **Natural-key writes.** Use `INSERT ... ON CONFLICT DO NOTHING` against a unique constraint:
   ```python
   stmt = pg_insert(ExtractionProposalRecord).values(rows)
   stmt = stmt.on_conflict_do_nothing(
       index_elements=["run_id", "instance_id", "field_id", "source"]
   )
   ```
   Retries are safe — duplicate inserts are no-ops.

2. **Idempotency-key tracking.** For tasks whose effect can't be expressed as a single insert, write a `task_runs` row keyed by `(task_name, idempotency_key)` at the start, check before doing work:
   ```python
   key = f"extract:{article_id}:{template_id}"
   if await idempotency.already_done(db, key):
       return {"status": "skipped"}
   try:
       await do_work()
       await idempotency.record(db, key)
   except RetryableError:
       raise
   ```

## Calling tasks

```python
# Fire and forget
extract_section_task.delay(project_id=str(p), article_id=str(a), ...)

# Get a result token
result = extract_section_task.apply_async(kwargs={...}, countdown=30)
# result.id — store, expose via API for polling
```

The endpoint that triggers the task returns immediately with the task id and the run id. The frontend polls a status endpoint or subscribes to SSE.

## Workflows: chain, group, chord

```python
from celery import chain, group, chord

# Sequential pipeline
chain(
    fetch_pdf_task.s(article_id),
    extract_text_task.s(),
    extract_sections_task.s(),
).apply_async()

# Fan-out + reduce
chord(
    group(extract_field_task.s(field_id) for field_id in field_ids),
    reduce_proposals_task.s(run_id),
).apply_async()
```

`chain` passes each task's return value to the next. `chord` runs the group in parallel, then the callback with the list of results. Both are how article-export pipelines are composed.

## Failure modes to handle

| Mode | Fix |
|---|---|
| Worker dies mid-task with `acks_late=True` | Redelivered; idempotency saves you |
| OpenAI returns 429 | Catch, raise `self.retry(countdown=30)` (or rely on `autoretry_for`) |
| Long task exceeds visibility timeout (default 1 hour) | Bump `task_soft_time_limit` + checkpoint progress; or split into smaller tasks |
| Dead letter | Catch in an `except` that posts a "failed" event row; alert via structlog |

## Testing tasks

Celery has an eager mode that runs tasks inline:

```python
@pytest.fixture
def celery_eager(monkeypatch):
    monkeypatch.setattr("app.worker.celery_app.celery_app.conf.task_always_eager", True)
    monkeypatch.setattr("app.worker.celery_app.celery_app.conf.task_eager_propagates", True)
```

`task_eager_propagates=True` makes exceptions surface as test failures instead of being swallowed by the result backend. Always set it in tests.

## Beat / scheduled tasks

We don't run Celery Beat in prod yet. If you add a scheduled task:
1. Register the schedule in `celery_app.py::celery_app.conf.beat_schedule`.
2. Run `celery -A app.worker.celery_app beat` as a separate process (one instance, never multiple — duplicates the schedule).
3. Keep schedules in IANA timezone (the app config is UTC).
