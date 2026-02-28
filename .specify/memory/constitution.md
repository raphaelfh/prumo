<!--
  Sync Impact Report
  ==================
  Version change: N/A → 1.0.0 (initial ratification)
  Modified principles: N/A (first version)
  Added sections:
    - Core Principles (8 principles)
    - Technology & Tooling Constraints
    - Development Workflow & Quality Gates
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md — ✅ compatible
      (Constitution Check section is a dynamic placeholder; no update needed)
    - .specify/templates/spec-template.md — ✅ compatible
      (Requirements and success criteria sections align with typed/testable principles)
    - .specify/templates/tasks-template.md — ✅ compatible
      (Phase structure matches layered architecture: models → repos → services → endpoints)
    - .specify/templates/checklist-template.md — ✅ compatible
      (Dynamic generation; no hardcoded principle references)
    - .specify/templates/agent-file-template.md — ✅ compatible
      (Technology and code style sections will be populated from constitution)
  Follow-up TODOs: None
-->

# Review Hub Constitution

## Core Principles

### I. Layered Architecture (NON-NEGOTIABLE)

The backend MUST follow a strict four-layer dependency flow:

```
API (Endpoints) → Service → Repository → Model
```

- Endpoints MUST NOT access the database directly (no `db.execute()` in endpoints).
- Services MUST NOT import endpoint modules or return HTTP objects (`Request`, `Response`, `JSONResponse`). Services receive and return Python domain objects only.
- Repositories MUST NOT contain business logic. They perform CRUD and query operations exclusively.
- Repositories MUST call `flush()`, never `commit()`. Commit responsibility belongs to the endpoint or `UnitOfWork`.
- Every new feature MUST respect this flow: define models, create repositories, build services, expose via endpoints.

**Rationale**: Strict layering enforces testability in isolation, prevents circular dependencies, and keeps HTTP concerns out of business logic.

### II. Dependency Injection First

All runtime dependencies MUST be injected, never imported as global singletons.

- Backend: FastAPI `Depends()` for `DbSession`, `CurrentUser`, `SupabaseClient`, `RequestCtx`.
- Services receive `db`, `user_id`, `storage`, and `trace_id` via constructor parameters.
- Repositories are instantiated inside the service that owns them.
- The only permitted singleton is `EventBus` (domain event pub/sub).
- Factory functions (`app/core/factories.py`) MUST be used for complex dependency construction (e.g., `create_storage_adapter`).

**Rationale**: Constructor injection makes dependencies explicit, enables test doubles, and prevents hidden coupling.

### III. Split Migration Ownership (NON-NEGOTIABLE)

The `public` application schema is managed exclusively by **Alembic**. Supabase-owned schemas (`auth.*`, `storage.*`)
are managed exclusively by **Supabase CLI**. These domains MUST NOT cross.

**Alembic owns (`public` schema)**:

- All application tables, views, functions, triggers, indexes, and RLS policies in the `public` schema.
- Migration files live in `backend/alembic/versions/` (Python, named `YYYYMMDD_{rev}_{slug}.py`).
- Apply with: `cd backend && uv run alembic upgrade head`.
- Generate new migration with: `make db-generate MSG="description"`.

**Supabase CLI owns**:

- Storage bucket setup only (`supabase/migrations/0001_storage_bucket_articles.sql`).
- The `auth.users` trigger that auto-creates `profiles` (`supabase/migrations/0002_handle_new_user_trigger.sql`).
- **Do NOT add new application-table migrations to `supabase/migrations/`.**

**Alembic autogenerate safeguards**:

- `env.py` `include_object` filter excludes all non-`public` schemas and Supabase-injected tables.
- Alembic migration files MUST NOT reference `auth.*` or `storage.*` objects.
- A CI script (`scripts/validate_migration_boundaries.sh`) enforces this automatically.

**Remaining rules (unchanged)**:

- Every new table MUST have Row Level Security (RLS) enabled in its Alembic migration.
- RLS policies MUST use `auth.uid()` and project-scoped helpers (`is_project_member()`, `is_project_manager()`).
- New PostgreSQL ENUM types MUST be created in the Alembic migration SQL AND registered in `POSTGRESQL_ENUM_VALUES` in
  `app/models/base.py`.
- Model columns using enums MUST use `PostgreSQLEnumType("enum_name")`, never raw Python `Enum`.

**Startup safety**:

- The application MUST refuse to start if `alembic current` ≠ `alembic head`. `check_pending_migrations()` in
  `app/main.py` enforces this.

**Rationale**: Splitting ownership prevents schema drift — Alembic autogenerate detects application-table changes while
Supabase CLI retains control over its internal auth/storage objects. RLS enforcement guarantees tenant isolation at the
database level.

### IV. Security by Design

Security controls are mandatory, not optional additions.

- Authentication: JWT validation via Supabase Auth (RS256/JWKS in production, HS256 in local development).
- `user_id` MUST always be extracted from `user.sub` (JWT payload). It MUST NEVER be accepted from request bodies, query parameters, or path parameters.
- Sensitive data (API keys, tokens) MUST be encrypted at rest using per-user derived keys (`PBKDF2-HMAC-SHA256` with `ENCRYPTION_KEY` env var).
- Every endpoint MUST apply rate limiting via `@limiter.limit("N/minute")`.
- CORS origins MUST be explicitly listed; wildcard origins (`*`) are forbidden in production.
- Exposed response headers are limited to `X-Trace-Id` and `X-Response-Time`.

**Rationale**: Defense-in-depth at every layer — authentication, authorization (RLS), encryption, and rate limiting — prevents classes of vulnerabilities rather than individual bugs.

### V. Typed Everything

Static typing is mandatory across the entire stack.

- **Backend**: Python 3.11+ type hints on ALL public functions and method signatures. `mypy` strict mode MUST pass. Pydantic schemas MUST be used for ALL API input/output validation.
- **Frontend**: TypeScript strict mode. `Zod` for runtime form validation. `@typescript-eslint` rules enforced. `any` types produce warnings and MUST be justified.
- Schemas MUST support both `snake_case` (Python) and `camelCase` (frontend) via `populate_by_name=True` and field aliases.

**Rationale**: Static types catch errors at compile time, serve as living documentation, and enable safe refactoring across a multi-layer codebase.

### VI. Frontend Conventions

The frontend MUST follow a consistent state and data-fetching strategy.

- **API Client**: `apiClient` from `src/integrations/api/client.ts` is the canonical HTTP client for all FastAPI calls. New code MUST NOT create ad-hoc `fetch()` wrappers.
- **Server State**: TanStack Query (v5) with structured `queryKey` factories for all FastAPI-backed data. Direct Supabase queries are acceptable only for simple table operations not routed through FastAPI.
- **Client State**: Zustand stores for complex cross-component UI state. React Context for app-wide singletons (`AuthContext`, `ProjectContext`, `SidebarContext`).
- **Components**: Functional components with hooks only. shadcn/ui (Radix) for UI primitives. Domain components organized by category under `src/components/{domain}/`.
- **Forms**: `react-hook-form` + `Zod` for all form handling and validation.

**Rationale**: A single API client prevents inconsistent error handling. TanStack Query provides caching, deduplication, and background refetching. Zustand avoids prop drilling without Context boilerplate overhead.

### VII. Async All The Way

All I/O-bound operations MUST be asynchronous.

- ALL database operations use `async/await` with SQLAlchemy 2.0 async sessions.
- Long-running tasks (AI assessment, PDF processing, Zotero imports) MUST be offloaded to Celery workers via Redis broker.
- In-process decoupled operations use the `EventBus` domain event system (`publish` / `subscribe`).
- Endpoints MUST NOT perform blocking I/O on the main event loop.

**Rationale**: Async I/O maximizes throughput under concurrent load. Celery offloading prevents request timeouts for AI and file processing operations.

### VIII. Standardized API Contract

All API responses MUST use a uniform envelope format.

- Success: `ApiResponse(ok=True, data=..., trace_id=...)`.
- Failure: `ApiResponse(ok=False, error=ErrorDetail(code=..., message=...), trace_id=...)`.
- All custom exceptions MUST inherit from `AppError` and map to specific HTTP status codes (404, 422, 401, 403, 409, 429, 502, 500).
- Global exception handlers (`register_exception_handlers`) catch `AppError`, `HTTPException`, and unhandled `Exception` uniformly.
- Every endpoint MUST generate and propagate a `trace_id` (UUID) for request tracing.
- Middleware stack order: `RequestIdMiddleware` → `LoggingMiddleware` → `TimingMiddleware`.

**Rationale**: A uniform response envelope simplifies frontend error handling, enables centralized logging, and makes API behavior predictable for consumers.

## Technology & Tooling Constraints

The following technology choices are binding for all contributors:

| Concern                  | Tool                                             | Notes                                                                                   |
|--------------------------|--------------------------------------------------|-----------------------------------------------------------------------------------------|
| Python package manager   | `uv`                                             | Never use `pip install` directly                                                        |
| Frontend package manager | `npm`                                            |                                                                                         |
| Python linter/formatter  | Ruff                                             | 100-char line length, Python 3.11+ target                                               |
| Python type checker      | mypy                                             | Strict mode, `warn_return_any = true`                                                   |
| Frontend linter          | ESLint                                           | typescript-eslint + react-hooks plugins                                                 |
| Backend test framework   | pytest                                           | 70% minimum coverage (excludes `schemas/read_models/*`, `worker/*`)                     |
| Frontend test framework  | Vitest                                           | @testing-library/react + MSW for mocking                                                |
| Structured logging       | structlog                                        | All backend logging via `LoggerMixin` or `get_logger()`                                 |
| Rate limiting            | slowapi                                          | `get_remote_address` key function                                                       |
| Database migrations      | Alembic (public schema) + Supabase CLI (storage) | `make db-generate MSG=...` for app tables; Supabase CLI for storage bucket changes only |
| Background tasks         | Celery + Redis                                   | Task definitions in `app/worker/tasks/`                                                 |
| AI models                | OpenAI GPT-4o/4o-mini                            | BYOK supported; LangChain for orchestration                                             |

## Development Workflow & Quality Gates

### Branching Strategy

- `main` — Production (protected, requires PR review).
- `dev` — Development integration branch.
- `feature/*` — Feature branches (branch from `dev`).
- `fix/*` — Bug fix branches (branch from `dev`).

### Commit Convention

All commits MUST use conventional commit prefixes:
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

### CI Pipeline (GitHub Actions)

Every push/PR to `main` or `dev` MUST pass:

1. **backend-lint**: `ruff check` → `ruff format --check` → `mypy`.
2. **backend-test**: PostgreSQL 15 + migrations applied → `pytest --cov-fail-under=70`.
3. **backend-build**: Docker image builds successfully.
4. **frontend-lint**: ESLint → TypeScript type check (`tsc --noEmit`).
5. **frontend-build**: `npm run build` succeeds.

No merges are permitted when any gate fails.

### File Location Conventions

| Artifact                 | Path                                                                         |
|--------------------------|------------------------------------------------------------------------------|
| FastAPI endpoint         | `backend/app/api/v1/endpoints/{domain}.py` + register in `router.py`         |
| Service                  | `backend/app/services/{domain}_service.py`                                   |
| Repository               | `backend/app/repositories/{entity}_repository.py` + add to `unit_of_work.py` |
| SQLAlchemy model         | `backend/app/models/{entity}.py` + export in `__init__.py`                   |
| Pydantic schema          | `backend/app/schemas/{domain}.py`                                            |
| App table migration      | `backend/alembic/versions/{YYYYMMDD}_{rev}_{slug}.py` (Alembic)              |
| Storage migration        | `supabase/migrations/{NNNN}_{description}.sql` (Supabase CLI only)           |
| React component          | `src/components/{category}/{ComponentName}.tsx`                              |
| React page               | `src/pages/{PageName}.tsx`                                                   |
| Frontend API service     | `src/services/{domain}Service.ts`                                            |
| React hook               | `src/hooks/{domain}/use{Name}.ts`                                            |
| Backend unit test        | `backend/tests/unit/test_{module}.py`                                        |
| Backend integration test | `backend/tests/integration/test_{module}.py`                                 |

## Governance

This constitution is the authoritative reference for all architectural and process decisions in Review Hub. It supersedes informal conventions and ad-hoc patterns found elsewhere in the codebase.

### Amendment Procedure

1. Propose the change with rationale in a PR modifying this file.
2. The change MUST be reviewed and approved by at least one maintainer.
3. If the amendment modifies a NON-NEGOTIABLE principle, a migration plan MUST accompany the PR describing how existing code will be brought into compliance.
4. Version MUST be incremented per semantic versioning:
   - **MAJOR**: Removal or redefinition of a core principle.
   - **MINOR**: Addition of a new principle or material expansion of an existing one.
   - **PATCH**: Clarifications, wording fixes, non-semantic refinements.

### Compliance

- All PRs and code reviews MUST verify adherence to these principles.
- Added complexity beyond what a principle prescribes MUST be justified in the PR description.
- Use `CLAUDE.md` as the runtime development guidance companion to this constitution.

**Version**: 2.0.0 | **Ratified**: 2026-02-16 | **Last Amended**: 2026-02-27
