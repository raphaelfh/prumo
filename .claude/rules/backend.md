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
- **Row-in-parent** → the named guard for that pair:
  `project_template_active_service.owned_template`,
  `template_section_service.owned_section`,
  `ExtractionInstanceRepository.get_in_coordinate`. Need a new pair? Add
  ONE guard and import it — never copy a sibling.
- **The request coordinate** for the AI kickoff endpoints →
  `api/deps/scope.assert_kickoff_scope`. Both kickoff endpoints share it;
  `/extraction/models` shipped without the binding precisely because the
  logic lived inline in its sibling.
- **Scope goes in the WHERE clause**, never a compare after `db.get` /
  `get_by_id`. A scoped SELECT never locks a foreign row, and makes
  "missing" and "foreign" indistinguishable — no existence oracle.
- One error for both cases, 404-class, and the message names no field of
  the foreign row (not even its editor's name).
- Endpoints may not reach a repository, so an api-layer guard calls the
  service wrapper (`assert_instance_in_coordinate`), not the repo.

CI: `scripts/fitness/check_scope_guards.py` — a second implementation of
an existing predicate fails the gate. Grandfathering needs a baseline
line with a reason in the same PR; the baseline only shrinks.

## Dead code

- CI runs a vulture **shrink-only ratchet** (config in `[tool.vulture]`,
  baseline in `backend/.vulture_baseline`, gate in
  `scripts/vulture_baseline.py` — also a `verify_all.sh` gate). A new
  finding fails CI: delete the dead symbol, or — only if it is genuinely
  framework-consumed (Starlette `dispatch`, Celery `on_failure`) —
  baseline it with `--exec --update` in the same PR and say why in the
  PR body. After deleting dead code, tighten the baseline the same way.
  Pydantic/SQLAlchemy field declarations under `app/schemas` and
  `app/models` are excluded by design; don't move dead logic there.

## Tests

- Integration over mocks: pytest runs against the real local Supabase
  Postgres (RLS, CHECK constraints, deferred triggers are invisible to
  mocks). Deferred-trigger tests need the `db_session_real` fixture.
- Integration setup helpers must scope article/template queries by
  `project_id`.
- Run with `make test-backend`; seed graph is auto-created by the
  autouse `SEED` fixture in `tests/integration/conftest.py`.
