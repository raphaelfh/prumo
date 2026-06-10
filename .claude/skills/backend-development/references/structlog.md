# structlog in prumo

Configured in `app/core/logging.py`. Dev: colored console renderer. Prod: JSON renderer that streams to stdout, picked up by the platform's log forwarder.

## Logger acquisition

```python
from app.core.logging import get_logger
logger = get_logger(__name__)
```

`get_logger` returns a `BoundLogger` bound to the module name. Use one per module, not one per function.

## Log event names

The first positional argument is the **event name**. Make it stable, dotted, lowercase:

| Good | Bad |
|---|---|
| `"hitl_session.opened"` | `"opened a new HITL session for user"` |
| `"extraction.proposal_recorded"` | `f"recorded proposal {proposal_id}"` |
| `"celery.extract_section.failed"` | `"task failed"` |

Stable event names are what you filter by in production dashboards. Free-form sentences are unsearchable.

## Structured key-value context

Everything that isn't the event name goes as a keyword:

```python
logger.info(
    "hitl_session.opened",
    project_id=str(body.project_id),
    article_id=str(body.article_id),
    kind=body.kind,
    run_id=str(session.run_id),
    run_created=session.created,
)
```

- Always stringify UUIDs and datetimes — the JSON renderer handles primitives well, but custom types can hit edge cases.
- Don't log secrets, raw JWTs, or PII. The redaction processor in `logging.py` catches common keys (`authorization`, `password`, `token`), but is not exhaustive — review what you're logging.
- Don't include the entire request body. Pick the keys that matter.

## Context propagation — `bind_contextvars`

For a request-scoped or task-scoped context that should appear on every log line:

```python
import structlog

structlog.contextvars.bind_contextvars(
    run_id=str(run_id),
    project_id=str(project_id),
)
try:
    await service.do_work()
finally:
    structlog.contextvars.clear_contextvars()
```

`contextvars`-based propagation works across `await` boundaries — the bound keys travel with the coroutine. The request middleware (`app/core/middleware.py`) binds `trace_id`, `user_id`, and `path` at request start.

For a service-method-scoped binding, use the context manager:
```python
with structlog.contextvars.bound_contextvars(stage="proposal"):
    logger.info("extraction.stage_entered")
```

## Levels — when to use which

| Level | When |
|---|---|
| `debug` | Loop iteration counts, internal state during dev. Off in prod. |
| `info` | Normal events: request handled, task completed, state transitioned. |
| `warning` | Recoverable problems: retry attempted, fallback used, expected business-rule rejection. |
| `error` | Unrecoverable for *this request* / task: caught exception, RLS denial, downstream 5xx. |
| `critical` | System-wide failure: DB unreachable, JWKS fetch broken, broker down. Page someone. |

`logger.exception(...)` (inside an `except`) automatically includes the traceback as `exc_info`. Use it instead of `logger.error(... exc=str(e))`.

## Celery tasks

The task wrapper should bind context so every log line inside the task carries the task id:

```python
@celery_app.task(bind=True, ...)
def extract_section_task(self, **kwargs):
    structlog.contextvars.bind_contextvars(
        task_id=self.request.id,
        task_name=self.name,
        retry_count=self.request.retries,
    )
    try:
        return asyncio.run(_run(**kwargs))
    finally:
        structlog.contextvars.clear_contextvars()
```

Without that, task logs land in the same JSON sink as request logs but can't be correlated to a job.

## Output shapes

Dev (console, colored):
```
2026-05-17T14:32:11Z [info ] hitl_session.opened project_id=8f... article_id=a3... kind=extraction run_id=...
```

Prod (JSON, one line per event):
```json
{"timestamp":"2026-05-17T14:32:11Z","level":"info","event":"hitl_session.opened","project_id":"8f...","article_id":"a3...","kind":"extraction","run_id":"...","logger":"app.services.hitl_session_service"}
```

Switch via `settings.DEBUG`.

## Redaction

Common sensitive keys are redacted by a processor in `logging.py`. If you add a new sensitive field (e.g. an API key), add it to the redaction list — don't rely on developers remembering to omit it.

PII like email addresses: don't log them at info level. Hash or truncate (`user_email[:3] + "..."`) when you need correlation.

## Don't

- Don't `print()`. Ever. It bypasses the renderer and breaks JSON parsing on the log forwarder.
- Don't construct log strings with f-strings. `logger.info(f"created {x}")` defeats structured logging. Use kwargs.
- Don't log inside tight loops without an aggregation strategy. Emit one summary line after the loop instead.
- Don't log the full SQLAlchemy `select()` object — it's huge and not human-readable. Log the parameters you care about.
