---
paths:
  - "backend/**"
  - "supabase/**"
---

# Backend conventions (prumo)

For any non-trivial backend change, load the `backend-development` skill
before writing code. This file is the always-true core.

## Layering and SQL

- `api → services → repositories → models`, gated by
  `scripts/fitness/check_layered_arch.py`. Endpoints never touch the DB or
  return ORM objects.
- Use a repository (`backend/app/repositories/`) when a query is reused by
  >1 service, or the entity has several distinct query shapes. Otherwise
  inline `select()` in the owning service. Repositories call `flush()`,
  never `commit()`.

## Migrations

- App schema = Alembic only. From `backend/`:
  `alembic revision --autogenerate -m "..."` then `alembic upgrade head`.
- Revision ids must be **≤ 32 chars** (`alembic_version.version_num`
  is varchar(32); overflow breaks CI and the Railway deploy).
- `auth`/`storage` schemas = Supabase CLI (`supabase migration new`),
  deployed with `supabase db push` — they are NOT auto-applied on
  deploy (only Alembic is). Never a Supabase MCP `apply_migration`.
- Migration touching `extraction_*`? Update the migration-head line
  and `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.

## API contract

- Responses use the `ApiResponse` envelope with a typed model
  (`ApiResponse[dict[str, Any]]` fails `check_api_response_envelope.py`).
  Errors reach the client as `error.message`, not FastAPI's default
  `detail`: raise `HTTPException` or an `AppError` subclass and let
  `app/core/error_handler.py` wrap it.

## Ownership guards (BOLA)

Every client-supplied id is bound to the caller's scope before use, and
every such predicate has exactly ONE implementation. BOLA is this repo's
most repeated incident class, and every instance has been a copy of a
guard that drifted or was never made.

- **Membership / role** → the `public.is_project_*` SQL helpers, via
  `api/deps/security.py`. Never hand-roll `FROM public.project_members`:
  those helpers are what the RLS policies call, so a copy lets the API
  and the database disagree. Services cannot import `api.deps`, so a
  service calls the DB function directly (`SELECT public.is_project_member(...)`).
  A dependency that reads a PATH parameter delegates to the imperative
  helper; the CI gate exempts no module, `security.py` included.
- **A run by id** → `api/deps/scope.load_run_for_member`. It resolves the
  run, then checks membership on the run's own project, so there is no
  second client id to compare. It answers 404 missing / 403 non-member:
  the one accepted existence signal, because run ids are random uuid4
  (`assert_kickoff_scope` docstring).
- **Row-in-parent** → the named guard for that pair:
  `project_template_active_service.owned_template`,
  `template_section_service.owned_section`,
  `article_read_service.owned_article`,
  `ExtractionInstanceRepository.get_in_coordinate`,
  `llm_connection_service.owned_user_connection` (a user-scope connection
  in its owner), `llm_connection_service.owned_project_connection` (a
  project-scope connection in its project). Need a new pair? Add
  ONE guard and import it — never copy a sibling. This list is load-bearing:
  the CI gate matches WHERE-clause shapes, so it cannot see a
  `db.get`-then-compare copy — the enumeration is what prevents copy #3.
- **The request coordinate** for the AI kickoff endpoints →
  `api/deps/scope.assert_kickoff_scope`. Both kickoff endpoints share it;
  `/extraction/models` shipped without the binding precisely because the
  logic lived inline in its sibling.
- **Scope goes in the WHERE clause**, never a compare after `db.get` /
  `get_by_id`. A scoped SELECT never locks a foreign row, and makes
  "missing" and "foreign" indistinguishable — no existence oracle.
- A row-in-parent guard gives one error for missing and foreign alike,
  404-class, and the message names no field of the foreign row (not even
  its editor's name).
- Endpoints may not reach a repository, so an api-layer guard calls the
  service wrapper (`assert_instance_in_coordinate`), not the repo.

CI: `scripts/fitness/check_scope_guards.py` — a second implementation of
an existing predicate fails the gate. Grandfathering needs a baseline
line with a reason in the same PR; the baseline only shrinks.

## Dead code

- CI runs a vulture **shrink-only ratchet** (`scripts/vulture_baseline.py`,
  baseline `backend/.vulture_baseline`, config `[tool.vulture]`). A new
  finding fails CI: delete the dead symbol. Only a genuinely
  framework-consumed one (Starlette `dispatch`, Celery `on_failure`) is
  baselined, with `--exec --update` in the same PR and the reason in the
  PR body; tighten the baseline the same way after deleting dead code.
  Field declarations under `app/schemas` and `app/models` are excluded by
  design; don't move dead logic there.

## Tests

- Integration over mocks: pytest runs against the real local Supabase
  Postgres (RLS, CHECK constraints, deferred triggers are invisible to
  mocks). Deferred-trigger tests need the `db_session_real` fixture.
- Integration setup helpers must scope article/template queries by
  `project_id`.
- Run with `make test-backend`; seed graph is auto-created by the
  autouse `SEED` fixture in `tests/integration/conftest.py`. Fixture and
  authorization-test recipes: the `web-testing` skill.
