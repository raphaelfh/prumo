---
name: backend-development
description: Use this when writing or modifying anything under `backend/app/` — FastAPI endpoints, SQLAlchemy 2.0 async models or queries, Alembic migrations, Celery tasks in `backend/app/worker/`, Pydantic v2 schemas, Supabase RLS policies in `supabase/migrations/`, or `pytest` tests. Covers prumo's HITL stack (extraction + quality assessment), project-membership auth, structlog observability, and the migration split between Alembic (app schema) and Supabase CLI (auth/storage). Trigger on requests like "add endpoint", "create migration", "write a Celery task", "fix RLS", "new SQLAlchemy model", or anything touching `extraction_*` tables or `/api/v1/runs/...` / `/api/v1/hitl/sessions`.
---

# Backend Development (prumo)

Prumo's backend is a FastAPI web service + Celery worker + managed Redis on Railway (the React frontend deploys to Vercel). One Python codebase under `backend/`. One Postgres database (Supabase) accessed two ways: async SQLAlchemy from the API/worker, and Supabase Postgres-with-RLS for the browser client. Migrations are split: Alembic owns the `public` schema, Supabase CLI owns `auth` + `storage`.

This skill keeps backend changes consistent with the existing patterns. Pick the right reference for deep dives — SKILL.md is the index, not the manual.

## Stack snapshot

| Layer | Tech | Where it lives |
|---|---|---|
| HTTP | FastAPI 0.115+, Uvicorn/Gunicorn | `backend/app/main.py`, `backend/app/api/v1/` |
| ORM | SQLAlchemy 2.0 async + asyncpg | `backend/app/models/`, queries in services |
| Validation | Pydantic v2 + pydantic-settings | `backend/app/schemas/`, `backend/app/core/config.py` |
| Migrations | Alembic (app), Supabase CLI (auth/storage) | `backend/alembic/versions/`, `supabase/migrations/` |
| Background | Celery 5 + Redis | `backend/app/worker/celery_app.py`, `backend/app/worker/tasks/` |
| Logging | structlog (JSON in prod, console in dev) | `backend/app/core/logging.py` |
| Auth | Supabase JWT verified via JWKS | `backend/app/core/security.py`, `backend/app/api/deps/security.py` |
| Rate limit | SlowAPI | `backend/app/utils/rate_limiter.py` |
| Tests | pytest + pytest-asyncio | `backend/tests/` |

Out of scope: Node.js, NestJS, Django, Go, Rust, MongoDB, OAuth provider SDKs, Docker/Kubernetes deploy patterns. Mention only if a question forces it.

## Repository layout you must respect

```
backend/app/
  api/v1/endpoints/   # FastAPI routers — thin, validation + service call only
  api/v1/router.py    # aggregates routers under /api/v1
  api/deps/security.py# ensure_project_member, require_project_manager, ...
  core/               # config, logging, deps (DbSession), security, middleware
  models/             # SQLAlchemy 2.0 declarative models (Mapped/mapped_column)
  schemas/            # Pydantic v2 request/response DTOs
  services/           # business logic, transactional unit
  repositories/       # data-access helpers (when used)
  domain/events/      # in-process domain events + handlers
  infrastructure/     # external IO (storage adapters, ...)
  worker/celery_app.py
  worker/tasks/       # extraction_tasks.py, import_tasks.py, export_tasks.py
  utils/, seed.py, main.py
backend/alembic/versions/    # app-schema migrations (numbered 0001_*, 0002_*, ...)
supabase/migrations/         # auth + storage only (RLS bucket policies)
```

Endpoints are thin. Business logic lives in services. SQL lives in services or repositories — not in endpoints. Background work goes to Celery, not BackgroundTasks.

## Hard rules (small, with reasoning)

1. **Alembic for app schema, Supabase CLI for `auth`/`storage`.** If you touched a SQLAlchemy model in `backend/app/models/`, you owe an Alembic migration. Storage buckets and `auth.users` triggers belong in `supabase/migrations/` because the Supabase CLI is the only system that can replay them against a hosted project.
2. **RLS is the source of truth — never bypass it silently.** The API runs as service role and bypasses RLS, so endpoints must enforce membership themselves via `ensure_project_member` / `require_project_scope` / `require_project_manager` from `app/api/deps/security.py`. Those call the same SQL helpers (`is_project_member`, `is_project_manager`, `is_project_reviewer`) the RLS policies use, so the gate stays identical on both sides.
3. **Never trust the client's field set.** Mass-assignment attacks come through Pydantic models with too many fields. Define `*Create` / `*Update` schemas with only the fields a user may set; never reuse the read schema for writes.
4. **Async all the way.** `AsyncSession`, `await db.execute(select(...))`, async services. Sync calls inside the request loop will starve the event loop.
5. **One transaction per request, by default.** The `get_db` dependency yields one session — services on a single request share it. Open a nested `async with db.begin_nested()` only for true savepoint semantics.
6. **Migration numbering is monotonic.** New migrations always extend the head (`0013_*`, `0014_*`, ...). Never rewrite history of pushed migrations. Squash deliberately and document — see `docs/reference/migrations.md`.

## FastAPI endpoint shape

```python
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.hitl_session import OpenHITLSessionRequest, OpenHITLSessionResponse
from app.services.hitl_session_service import HITLSessionService

router = APIRouter()


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def open_hitl_session(
    body: OpenHITLSessionRequest,
    db: DbSession,
    user_sub: Annotated[UUID, Depends(get_current_user_sub)],
) -> ApiResponse[OpenHITLSessionResponse]:
    await ensure_project_member(db, body.project_id, user_sub)
    service = HITLSessionService(db)
    result = await service.open_or_resume(...)
    return ApiResponse(data=OpenHITLSessionResponse.model_validate(result, from_attributes=True))
```

Conventions:
- Use `DbSession` (the `Annotated[AsyncSession, Depends(get_db)]` alias from `app/core/deps.py`), not bare `Depends(get_db)`.
- Authentication: depend on `get_current_user_sub` (or `CurrentUser` for the full payload). Project access: call `ensure_project_member` *after* dependency resolution, because `project_id` usually comes from the body.
- All write responses go through `ApiResponse[T]` for a uniform envelope. Read endpoints can return the DTO directly if they're high-traffic — be consistent within a router.
- Return real status codes (`201` for create, `204` for delete-with-no-body). Override per-request via `response.status_code` only when create-vs-resume semantics matter; see `endpoints/hitl_sessions.py` for the canonical pattern.
- Wire new routers into `backend/app/api/v1/router.py`.

Detail: see [`references/fastapi.md`](references/fastapi.md) for lifespan, SSE, dependency overrides in tests, and error handling.

## Pydantic v2 schemas

```python
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class OpenHITLSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")  # reject unknown fields

    kind: Literal["extraction", "quality_assessment"]
    project_id: UUID
    article_id: UUID
    project_template_id: UUID | None = None
    global_template_id: UUID | None = None

    @model_validator(mode="after")
    def _require_one_pointer(self) -> "OpenHITLSessionRequest":
        if not (self.project_template_id or self.global_template_id):
            raise ValueError("Either project_template_id or global_template_id is required")
        return self
```

- `Literal[...]` over `str` for closed enums in API DTOs. Keep `PyEnum` for ORM/DB types — they map to Postgres ENUMs.
- `extra="forbid"` on every request schema. It blocks mass-assignment and gives clients a fast, loud failure for typos.
- Use `model_validator(mode="after")` for cross-field rules. `field_validator(mode="before")` for input coercion (trim strings, parse weird date formats).
- Pydantic v2 → ORM: `Schema.model_validate(orm_obj, from_attributes=True)`. Never serialize models by hand.

Detail: see [`references/pydantic.md`](references/pydantic.md) for settings, discriminated unions, partial-update patterns, and validator gotchas.

## SQLAlchemy 2.0 async — models and queries

Models inherit `BaseModel` (`app/models/base.py`), which gives `id: UUID PK`, timestamps, and the Postgres ENUM wrapper. Use `Mapped[T]` / `mapped_column(...)`:

```python
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy import ForeignKey, Text


class ExtractionProposalRecord(BaseModel):
    __tablename__ = "extraction_proposal_records"

    run_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("extraction_runs.id"))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    source: Mapped[ExtractionProposalSource]  # ENUM via PostgreSQLEnumType
```

Queries use `select()`, never the legacy `Query` API:

```python
from sqlalchemy import select
from sqlalchemy.orm import selectinload

stmt = (
    select(ExtractionRun)
    .where(ExtractionRun.project_id == project_id, ExtractionRun.article_id == article_id)
    .options(selectinload(ExtractionRun.proposals))
    .with_for_update(skip_locked=True)  # advisory locking when relevant
)
run = (await db.execute(stmt)).scalar_one_or_none()
```

- `selectinload` for collections, `joinedload` for *to-one. Prefer `selectinload` unless you've measured N+1 going the other way — `joinedload` can blow up row counts on collections.
- `with_for_update()` when state-mutating a row inside a service; combine with `pg_advisory_xact_lock` (see `hitl_session_service.py`) for cross-row coordination.
- For raw SQL (RLS helper calls, advisory locks), use `text()` with named parameters — never f-strings.
- Use `scalar_one()` when you require a row, `scalar_one_or_none()` when you don't.

Detail: see [`references/sqlalchemy.md`](references/sqlalchemy.md) for relationships, hybrid properties, bulk inserts, and AsyncAttrs.

## Alembic migrations

```bash
cd backend
alembic revision --autogenerate -m "add foo to extraction_runs"
# Inspect the generated file — autogenerate misses CHECKs, ENUM value
# changes, RLS policies, partial indexes. Hand-edit liberally.
alembic upgrade head
```

Rules:
- Filename pattern: `NNNN_short_description.py`, monotonic. Look at `backend/alembic/versions/` for the current head.
- App schema only. If you find yourself writing `CREATE POLICY` on a storage bucket or touching `auth.users`, you're in the wrong system — move to `supabase/migrations/`.
- RLS policies on `public.*` tables live in *Alembic* (because the tables themselves do). Use `op.execute("CREATE POLICY ...")`. See migration `0009_tighten_rls_policies.py` for the pattern.
- ENUM lifecycle: add the value via `ALTER TYPE ... ADD VALUE` in a migration *and* update the literal list in `backend/app/models/base.py` `POSTGRESQL_ENUM_VALUES`.
- Data migrations: keep them idempotent and reversible. If reversibility is meaningless (data loss), document it in the docstring and leave `downgrade` empty with a comment.

Detail: see [`references/alembic.md`](references/alembic.md) for migration anatomy, ENUM operations, RLS in migrations, squashing rules, and `docs/reference/migrations.md` for the full strategy.

## Supabase RLS — non-negotiable mental model

| Caller | Connection | RLS applies? |
|---|---|---|
| Browser via `supabase-js` | anon / authenticated JWT | yes |
| FastAPI request handler | service role from `DATABASE_URL` | **no — bypasses RLS** |
| Celery worker | service role | **no — bypasses RLS** |

Because the API and worker bypass RLS, **every endpoint that touches project data must call a membership helper** (`ensure_project_member`, `require_project_scope`, `require_project_manager`). The browser is gated by RLS; the API is gated by code. Both gates evaluate the *same* SQL helpers (`is_project_member`, `is_project_reviewer`, `is_project_manager`), so behavior stays identical.

When adding a new table:
1. Create the model + migration.
2. In the same migration, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and add SELECT/INSERT/UPDATE/DELETE policies that route through the membership helpers.
3. In the corresponding endpoint, call the matching `require_project_*` helper before any write.

Detail: see [`references/rls.md`](references/rls.md) for the helper inventory, common policy shapes, and the "service role from the API" footgun.

## Celery tasks

Worker entry point: `backend/app/worker/celery_app.py`. Tasks live under `backend/app/worker/tasks/` and are registered via `include=[...]` on the Celery app. Tasks are sync entry points that wrap an async coroutine via the shared `app.worker._runner.run_task` helper — never call `asyncio.run` directly.

```python
from app.worker._runner import run_task

@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=5,
    rate_limit="5/m",
)
def extract_section_task(self, project_id: str, article_id: str, ...) -> dict:
    async def run():
        async with AsyncSessionLocal() as db:
            service = SectionExtractionService(db)
            return await service.execute(...)
    return run_task(run)
```

Conventions:
- Pass primitives (UUIDs as strings, ints, dicts), never ORM instances — Celery serializes JSON and ORM objects don't survive that round trip.
- Make tasks idempotent. Use a natural key (e.g. `(run_id, instance_id, field_id)`) and `ON CONFLICT DO NOTHING` for the write so retries are safe.
- Bridge async via `app.worker._runner.run_task(coro_factory)` — see `docs/reference/deployment.md` for the runner rationale. Do not call `asyncio.run` directly or cache event loops.
- Construct Supabase / DB clients *inside* the coroutine, not at module scope — clients bind their connection pools to the loop active at construction time.
- Bind structlog context inside the task wrapper so log lines carry `task_id`, `project_id`, etc.

Detail: see [`references/celery.md`](references/celery.md) for chord/chain patterns, idempotency keys, dead-letter handling, and the `asyncio.run` vs. dedicated loop tradeoff.

## Logging — structlog

`get_logger(__name__)` from `app/core/logging.py`. Dev: colored console renderer. Prod: JSON renderer. Request middleware binds `trace_id`, `user_id`, `path`.

```python
from app.core.logging import get_logger
logger = get_logger(__name__)

logger.info(
    "hitl_session.opened",
    project_id=str(body.project_id),
    article_id=str(body.article_id),
    kind=body.kind,
    run_created=session.created,
)
```

Bind context with `structlog.contextvars.bind_contextvars(run_id=str(run_id))` at the top of a service method when many log lines share the same key — every subsequent log call inherits it for the rest of the request. Reserve message keys (the first positional arg) for stable event names: `hitl_session.opened`, `extraction.proposal_recorded`, never free-form sentences. Stable names are how you build dashboards.

Detail: see [`references/structlog.md`](references/structlog.md) for context propagation across Celery tasks, redaction processors for PII, and the JSON shape produced in prod.

## Configuration

`app/core/config.py` exposes a Pydantic `Settings` instance loaded from `.env`. Access via `from app.core.config import settings`. New env vars:

1. Add the typed field to `Settings`.
2. Document it in the `.env.example` (if one exists for the area) and the top-of-file docstring.
3. Never read `os.getenv` directly from app code — `Settings` is the single source.

The Celery worker config (`app/worker/celery_app.py`) currently reads `REDIS_URL` via `os.getenv` for bootstrap reasons; new Celery options should still go through `Settings` when possible.

## Errors

| Situation | What to raise |
|---|---|
| Bad input that Pydantic didn't catch | `HTTPException(400, ...)` or a domain exception caught by a handler |
| Auth missing / invalid | `HTTPException(401, ...)` — usually from `get_current_user_sub` |
| Authenticated but not allowed | `HTTPException(403, ...)` — from `ensure_project_member` |
| Not found | `HTTPException(404, ...)` |
| Conflict (optimistic concurrency, idempotency mismatch) | `HTTPException(409, ...)` |
| Service-level validation | Custom domain exception (e.g. `HITLSessionInputError`) — translate to `HTTPException` at the endpoint boundary or via a registered handler |

Domain exceptions live in the service module that owns them. The endpoint catches and translates — never let internal exception types leak through `ApiResponse`. See `register_exception_handlers` in `app/core/error_handler.py`.

## Testing

```bash
make test-backend       # pytest with the project's defaults
make lint-backend       # ruff check + format
```

Tests live under `backend/tests/`. Use `pytest-asyncio` for async tests. Override `get_db` with a transactional fixture that rolls back per test. Override `get_current_user_sub` with a fixed UUID. Hit endpoints with `httpx.AsyncClient(app=app, base_url=...)`.

Coverage targets, in order of value:
1. Service unit tests with a real Postgres (Supabase local) — they catch RLS misses and FK mistakes.
2. Endpoint integration tests with auth + project-member gating.
3. Migration tests: run `alembic upgrade head` then `downgrade -1` on every PR that adds a migration.

Detail: see [`references/testing.md`](references/testing.md) for the fixture playbook, factories, and Celery task testing in eager mode.

## Common workflows

| Task | Steps |
|---|---|
| Add an endpoint | schema in `schemas/` → service method in `services/` → router in `api/v1/endpoints/` → wire in `api/v1/router.py` → membership gate → test |
| Add a column | edit model in `models/` → `alembic revision --autogenerate` → review/edit migration → upgrade → adjust schema + service |
| Add a Celery task | task in `worker/tasks/` → register via `include=` if new file → call from service with `.delay(...)` → ensure idempotency |
| Tighten RLS | new migration in `alembic/versions/` → drop overly-broad policy → re-create scoped policies → update endpoint to call the matching `require_project_*` helper |
| New env var | add field to `Settings` → use via `settings.MY_VAR` → document |
| Background job for a Run | put orchestration in a service that returns immediately after enqueuing → task updates `extraction_run_stage` and emits a domain event |

## Where the architecture lives

Before changing anything under `extraction_*`, `/api/v1/runs/...`, or `/api/v1/hitl/sessions`:

- `docs/reference/extraction-hitl-architecture.md` — canonical schema, the five workflow tables (Proposal → ReviewerDecision → ReviewerState → ConsensusDecision → PublishedState), and the `(run_id, instance_id, field_id)` coordinate system.
- `docs/reference/migrations.md` — when to squash, RLS conventions, AI-assistant pitfalls.
- `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` — original spec, immutable.

These are not optional reading for HITL changes.

## References index

| File | Use when |
|---|---|
| [`references/fastapi.md`](references/fastapi.md) | endpoint patterns, lifespan, SSE, custom middleware, error handlers |
| [`references/sqlalchemy.md`](references/sqlalchemy.md) | relationships, locking, AsyncAttrs, performance |
| [`references/pydantic.md`](references/pydantic.md) | validators, discriminated unions, settings, partial updates |
| [`references/alembic.md`](references/alembic.md) | autogenerate, ENUMs, RLS in migrations, squashing |
| [`references/celery.md`](references/celery.md) | retries, idempotency, chord/chain, testing |
| [`references/rls.md`](references/rls.md) | helper functions, policy shapes, API-bypass model |
| [`references/structlog.md`](references/structlog.md) | context propagation, JSON shape, PII redaction |
| [`references/testing.md`](references/testing.md) | fixtures, factory patterns, Celery in tests |
