---
paths:
  - "backend/**"
  - "supabase/**"
---

# Backend conventions (prumo)

For any non-trivial backend change, load the `backend-development` skill
before writing code (deep dives also in `docs/reference/`). This file is the
always-true core.

## Repository vs service SQL

Use a repository (`backend/app/repositories/`) when a query is reused by >1
service, or the entity has several distinct query shapes. Otherwise inline
`select()` in the owning service. Repositories call `flush()`, never `commit()`.

## Layering (CI-enforced by `scripts/fitness/check_layered_arch.py`)

`api → services → repositories → models`. Endpoints never touch the
DB or return ORM objects; services never import api or return HTTP
objects; repositories never contain business logic.

## Migrations

- App schema = Alembic only. From `backend/`:
  `alembic revision --autogenerate -m "..."` then `alembic upgrade head`.
- Revision ids must be **≤ 32 chars** (`alembic_version.version_num`
  is varchar(32); overflow breaks CI and the Railway deploy).
- `auth`/`storage` schemas = Supabase CLI (`supabase migration new`),
  deployed with `supabase db push` — they are NOT auto-applied on
  deploy (only Alembic is). Never `mcp__supabase__apply_migration`.
- Migration touching `extraction_*`? Update the migration-head line
  and `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.

## API contract

- Responses use the `ApiResponse` envelope; errors expose
  `error.message` (not FastAPI's default `detail`). New endpoints get
  a typed Pydantic response model — never `ApiResponse[dict[str, Any]]`.
- Every project-scoped endpoint checks project membership (BOLA is a
  recurring incident class here — see the `code-review` skill).

## Tests

- Integration over mocks: pytest runs against the real local Supabase
  Postgres (RLS, CHECK constraints, deferred triggers are invisible to
  mocks). Deferred-trigger tests need the `db_session_real` fixture.
- Integration setup helpers must scope article/template queries by
  `project_id`.
- Run with `make test-backend`; seed graph is auto-created by the
  autouse `SEED` fixture in `tests/integration/conftest.py`.
