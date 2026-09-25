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
- `auth`/`storage` schemas = Supabase CLI (`supabase migration new`). A
  `main` push deploys them through the Supabase GitHub integration; its
  `Supabase Preview` check is not a required context, so read it after a
  promotion that touches `supabase/`. Never a Supabase MCP
  `apply_migration`: its stamped version breaks every later deploy.
- The `ck` naming convention (`app/models/base.py`) wraps explicit names
  too: pass the SHORT name (`llm_instruction_len`) to both
  `CheckConstraint` and `op.create_check_constraint`. A pre-expanded
  `ck_<table>_...` literal double-wraps and is md5-truncated to 63 chars.
  Drop or recreate a baseline-named (un-prefixed) constraint with raw
  `op.execute("ALTER TABLE ... DROP/ADD CONSTRAINT <literal>")`; check the
  emitted DDL with `alembic upgrade <range> --sql`.
- Migration touching `extraction_*`? Update the migration-head line
  and `last_reviewed` in `docs/reference/extraction-hitl-architecture.md`.

## API contract

- Responses use the `ApiResponse` envelope with a typed model
  (`ApiResponse[dict[str, Any]]` fails `check_api_response_envelope.py`).
  Errors reach the client as `error.message`, not FastAPI's default
  `detail`: raise `HTTPException` or an `AppError` subclass and let
  `app/core/error_handler.py` wrap it.
- Map an `IntegrityError` by constraint NAME with
  `app/core/integrity.py::violates_constraint`, never by raw SQLSTATE:
  Postgres 18 reports ON DELETE RESTRICT as 23001, not 23503.
- A Pydantic schema's class docstring and `Field(description=...)` are
  published in `openapi.json`. After ANY edit to a public schema class,
  comment-only included, run `npm run generate:api-types` from the repo
  root and commit the diff; the CI `API Contract` job fails otherwise.

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
  `template_field_service.owned_field` (a field in a section of its template),
  `article_read_service.owned_articles` (and `owned_article`, which delegates),
  `article_read_service.owned_article_file` (an article file in its article;
  `resolve_article_file` wraps it with the latest-PDF fallback),
  `extraction_batch_service.owned_batch` (a batch in its owner, who is still
  a project member),
  `ExtractionInstanceRepository.get_in_coordinate`,
  `llm_connection_service.owned_user_connection` (a user-scope connection
  in its owner), `llm_connection_service.owned_project_connection` (a
  project-scope connection in its project), `pat_service.owned_token` (a
  personal access token in its owner). Need a new pair? Add
  ONE guard and import it — never copy a sibling. This list is load-bearing:
  the CI gate matches WHERE-clause shapes, so it cannot see a
  `db.get`-then-compare copy — the enumeration is what prevents copy #3.
- **The request coordinate** for an AI kickoff endpoint →
  `api/deps/scope.assert_kickoff_scope` (`POST /extraction/sections`). A new
  kickoff endpoint imports it: the retired `/extraction/models` shipped
  without the binding because the logic lived inline in its sibling.
- **An MCP tool's project** → the `@agent_tool(requires=…, project_arg=…)`
  choke point in `app/api/mcp/server.py`, in order: token scope, per-token
  rate limit, project resolution (`get_article_project_id` for
  article-scoped tools; `project_arg=None` tools such as `list_projects`
  read only the caller's own rows), then
  `is_project_member` (false → `NOT_FOUND`) and, for writes, the
  non-raising `is_project_manager` (false → `MANAGER_REQUIRED`). It maps
  the booleans, never `ensure_*` (their 403s differ only in detail text).
  Register tools through `@agent_tool`, never the SDK's `@mcp.tool()`; no
  tool re-checks membership or role.
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
- Vulture scans `app/` only (`[tool.vulture] paths = ["app"]`): tests are
  not consumers. Rerouting a public function's last `app/` caller makes it
  a finding even if tests still call it — route the caller through the
  public function, or delete it after `git log --all -S<name>` shows no
  open branch needs it.

## Tests

- Integration over mocks: pytest runs against the real local Supabase
  Postgres (RLS, CHECK constraints, deferred triggers are invisible to
  mocks). Deferred-trigger tests need the `db_session_real` fixture.
- Integration setup helpers must scope article/template queries by
  `project_id`.
- Run with `make test-backend`; the seed graph is auto-created by the
  autouse `seeded_integration_db` fixture in `tests/integration/conftest.py`
  (its ids are in `SEED`). Fixture and
  authorization-test recipes: the `web-testing` skill.
- A test subprocess env is `{**os.environ, "VAR": ...}`, never hand-built:
  CI has no `backend/.env`.

## Local database

- ONE local Supabase stack (ports 54321/54322) serves every worktree and
  session. `make db-fresh`, `make reset-db` and `supabase db reset` wipe
  other sessions' data and auth users — coordinate with peers before
  running them.
- Keep the shared DB at `dev`'s head. Applying a migration that exists only
  in your worktree stamps an `alembic_version` other checkouts cannot
  resolve, and their backend exits at boot: `alembic downgrade <dev head>`
  as soon as local verification is done.
- `Can't locate revision` means the DB is ahead of your checkout. If
  `git ls-tree -r --name-only origin/dev backend/alembic/versions` lists
  the revision, your branch is behind dev: update it. Otherwise a peer's
  unmerged migration is applied: ask its session to roll it back. Never
  `alembic stamp`, and never downgrade another session's revision.
