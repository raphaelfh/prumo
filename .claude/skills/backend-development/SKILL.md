---
name: backend-development
description: "Use when writing or changing prumo backend code under `backend/` or `supabase/`: FastAPI endpoints, services, SQLAlchemy models and queries, Alembic migrations, RLS policies, Celery tasks, Pydantic schemas. Carries the house patterns and the traps that recur here: the envelope, locking, worker queues, per-task sessions, the migration split."
---

# Backend Development (prumo)

FastAPI web service + Celery worker + Redis on Railway, one Postgres on Supabase. The API and the worker connect as a privileged role and **bypass RLS**; the browser reads through Supabase with RLS. Alembic owns the app schema; the Supabase CLI owns `auth` and `storage`. The always-true rules are in `.claude/rules/backend.md` (layering, ownership guards, dead code): this skill adds how to write the code.

## Layout

```
backend/app/
  api/v1/endpoints/   # routers: validation, guard, one service call, commit
  api/v1/router.py    # api_router = APIRouter(); main.py mounts it at /api/v1
  api/deps/           # security.py (ensure_project_*, require_project_*), scope.py (load_run_for_member, assert_kickoff_scope)
  core/               # config (Settings), deps (DbSession), error_handler, logging, middleware, security
  services/           # business logic; owns its transaction's writes
  repositories/       # reused query shapes; flush(), never commit()
  models/  schemas/   # SQLAlchemy models, Pydantic DTOs
  llm/  domain/  infrastructure/  utils/
  worker/             # celery_app.py, tasks/, _runner.py, _session.py
backend/alembic/versions/   # NNNN_slug.py, one head
supabase/migrations/        # auth + storage only
```

## Endpoints

The real shape, from `endpoints/hitl_sessions.py`:

```python
@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def open_hitl_session(
    body: OpenHITLSessionRequest,
    request: Request,
    response: Response,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[OpenHITLSessionResponse]:
    await ensure_project_member(db, body.project_id, current_user_sub)
    try:
        session = await HITLSessionService(db).open_or_resume(...)
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        OpenHITLSessionResponse(...),
        trace_id=getattr(request.state, "trace_id", None),
    )
```

- **Guard first.** Bind every client-supplied id with its guard before any data access (`.claude/rules/backend.md` § Ownership guards). The role follows the RLS write policy: `ensure_project_reviewer` for a reviewer-write table, `ensure_project_manager` for a manager-only one. An API more permissive than its policy is the #831 bug.
- **The endpoint commits.** `get_db` only closes the session; nothing commits for you.
- **Envelope.** Return `ApiResponse.success(x, trace_id=…)`; a bare `ApiResponse(data=…)` fails validation because `ok` is required. A file download may return a raw `Response`. DELETE answers 200 with an envelope, not 204.
- **Errors.** Raise `HTTPException` or an `AppError` subclass (`core/error_handler.py`: `NotFoundError`, `ConflictError`, `AuthorizationError`…); the handler turns it into `{ok: false, error: {code, message}}`. Request validation becomes `VALIDATION_ERROR` with `error.details.errors`, never FastAPI's `detail`. Translate a service's domain exception at the endpoint, as above.
- **Wiring.** Include a new router in `api/v1/router.py`; it is mounted under `/api/v1` once, in `main.py::create_app`, so a prefix on the router doubles it. CORS is set in `create_app`; custom middleware in `core/middleware.py::register_middlewares` (last added runs outermost).
- **Rate limits.** `limiter` (`utils/rate_limiter.py`) is a slowapi `Limiter`, not middleware; it keys by the hashed bearer token and falls back to the IP. Decorate with `@limiter.limit(...)`; the endpoint must take `request: Request`.
- **Long work** goes to Celery: enqueue, return 202 with a job id, and the frontend polls (`frontend/hooks/useBackgroundJobPolling.ts`). There is no SSE and no WebSocket.

## Schemas (Pydantic v2)

- Separate `*Create` / `*Update` schemas that list only what a user may set; never reuse a read schema for writes (mass assignment).
- New request schemas set `model_config = ConfigDict(extra="forbid")`.
- `Literal[...]` for closed enums in DTOs; Python enums for ORM and Postgres types. `model_validator(mode="after")` for cross-field rules.
- ORM to DTO: `Schema.model_validate(orm_obj, from_attributes=True)`.

## Models and queries (SQLAlchemy 2 async)

- Models inherit `BaseModel` (`models/base.py`): uuid `id`, timestamps, `__table_args__ = {"schema": "public"}`. A custom `__table_args__` tuple still ends with `{"schema": "public"}`, and foreign keys are written `ForeignKey("public.<table>.id", ondelete=...)`.
- A Postgres enum column is `mapped_column(PostgreSQLEnumType("<type_name>"))`, and the type's values are listed in `POSTGRESQL_ENUM_VALUES` in `models/base.py`.
- `select()` only, never the legacy `Query` API. `selectinload` for collections, `joinedload` for to-one.
- Locking: `load_run_for_update` (`services/_extraction_run_lock.py`) for a run row; `take_advisory_xact_lock(db, left, right)` (`services/advisory_locks.py`) for a coordinate, keyed exactly as its other callers key it.
- A write that must survive a later failure gets its own commit or a dedicated session (`extraction_attempt_service.py`); `begin_nested()` is only for an atomic sub-step.
- The workflow tables are append-only. An `ON CONFLICT` target must match a real unique index (`on_conflict_do_nothing(index_elements=["request_id"])` in `repositories/extraction_attempt_repository.py`).
- Raw SQL uses `text()` with bound parameters, never f-strings.

## Migrations (Alembic)

```bash
cd backend && uv run alembic revision --autogenerate -m "add foo to extraction_runs"
# autogenerate misses CHECKs, enum value changes, RLS policies and partial indexes: edit by hand
uv run alembic upgrade head && uv run alembic check
```

- File `NNNN_slug.py`, next number after the head; revision id ≤ 32 characters. Never rewrite a pushed migration. Strategy and squashing: `docs/reference/migrations.md`.
- RLS on `public` tables is written in the same Alembic migration as the table (`op.execute("CREATE POLICY …")`), through the `public.is_project_*` helpers. A backend-only table may be `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` with no policy (0075, 0076).
- Storage-object policies that read `public` tables live in Alembic (0003); pure bucket policies and `auth.users` triggers live in `supabase/migrations/`, pushed with `supabase db push`, never auto-applied on deploy.
- Enum value: `ALTER TYPE … ADD VALUE` in a migration **and** the `POSTGRESQL_ENUM_VALUES` entry.
- Railway runs `alembic upgrade head` at boot, so a migration that raises blocks every later deploy. A data migration that deletes or updates rows guards itself in SQL (`AND NOT EXISTS …`) and stays idempotent; see `0039_absent_reason_backfill.py`.
- CI runs `upgrade head` and `alembic check`, never a downgrade. When a downgrade matters, add a round-trip case to `backend/tests/integration/test_migration_roundtrip.py` and bump its head pin.
- Local reset: `make db-fresh` (migrate + seed), not `make reset-db`.

## Celery

Tasks live in `worker/tasks/` and wrap a coroutine with `run_task`; each builds its own NullPool session:

```python
@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, rate_limit="5/m")
def run_section_extraction_task(self, payload_json: dict, user_id: str, trace_id: str | None = None, ...) -> dict:
    async def run() -> dict:
        async with worker_session() as session:  # app.worker._session
            ...
    return run_task(run)                           # app.worker._runner
```

- Never `asyncio.run` or the app-wide engine inside a task: a pooled engine reused across per-task loops raises "attached to a different loop". Build Supabase and DB clients inside the coroutine.
- A new task module is registered in three places: `include=` and `task_routes` in `celery_app.py`, and its queue in the worker's `--queues` in `railway.toml`. `tests/unit/test_celery_app_task_registry.py` and `test_celery_routes_drift.py` guard them. A worker started without `--queues` consumes only `celery`, so extractions, imports and exports never run: `cd backend && uv run celery -A app.worker.celery_app worker --loglevel=info --queues=extractions,imports,exports,celery`.
- Arguments are primitives (uuid strings, dicts), never ORM objects. Tasks are idempotent: a retry re-enters with the same payload. `task_acks_late` is global, so each task's hard `time_limit` stays under the broker `visibility_timeout` (3600 s).
- `.delay()` is synchronous; a failed enqueue answers 503 `SERVICE_UNAVAILABLE` (`endpoints/section_extraction.py`).

## Logging and config

- `get_logger(__name__)` from `core/logging.py`. The request middleware binds `trace_id` only (from `x-trace-id` or a fresh uuid4); pass it to tasks as a `trace_id` argument. `LoggedTask` already logs the task id. Event names are stable identifiers, not sentences.
- Nothing redacts log fields: never log tokens, keys or personal data.
- Settings come from `core/config.py` (`from app.core.config import settings`, env file `backend/.env`). Add a typed field there instead of calling `os.getenv`; `celery_app.py` and `core/logging.py` read the environment directly only to bootstrap.

## Tests

`make test-backend` runs pytest against the local Supabase Postgres. Fixtures (`db_client`, `db_session`, `db_session_real`), the seed graph and the authorization-test recipe are in the `web-testing` skill.
