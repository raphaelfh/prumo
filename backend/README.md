---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Prumo Backend

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

FastAPI service for prumo — the systematic-review platform.

## Stack

- **FastAPI** — async web framework.
- **SQLAlchemy 2.0** (async) — ORM, typed queries.
- **Alembic** — migrations for the `public` schema.
- **Pydantic v2** — validation and serialisation.
- **Celery + Redis** — background tasks (extraction, imports, exports).
- **Gunicorn + UvicornWorker** — production server.
- **Supabase** — Postgres + Auth + Storage (source of truth).
- **OpenAI** (GPT-4o) and **Anthropic** (Claude) — LLM providers.
- **structlog** — structured logging with `trace_id`, `run_id`, `duration_ms`.

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip
- Local Supabase stack (`supabase start` from the repo root)

## Setup

```bash
# Install dependencies
uv sync

# Configure env
cp .env.example .env
$EDITOR .env

# Run the API
uv run uvicorn app.main:app --reload --port 8000
```

## Layout

```text
backend/
├── app/
│   ├── api/v1/             # REST endpoints (FastAPI routers)
│   ├── core/               # Config, security, DI, factories
│   ├── db/                 # Engine, AsyncSessionLocal
│   ├── models/             # SQLAlchemy 2.0 models
│   ├── repositories/       # CRUD layer (flush, never commit)
│   ├── schemas/            # Pydantic v2 schemas
│   ├── services/           # Business logic
│   ├── worker/             # Celery app + task modules
│   └── seed.py             # Idempotent seed
├── alembic/                # Migration env
│   └── versions/           # Migrations (active) + versions/archive/
├── tests/                  # pytest (integration + unit + e2e contract)
├── Dockerfile              # Used by Railway for both web and worker
└── pyproject.toml          # Dependencies (uv)
```

## API endpoints (high level)

| Prefix | Domain |
| --- | --- |
| `/api/v1/projects` | Project + member management |
| `/api/v1/articles` | Article CRUD + Zotero import |
| `/api/v1/extraction` | Extraction-specific operations |
| `/api/v1/runs` | HITL run lifecycle (proposals, decisions, consensus, publish) |
| `/api/v1/hitl/sessions` | Open HITL session by kind (`extraction` or `quality_assessment`) |
| `/api/v1/extraction-export` | Excel export of extraction results |
| `/health` | Liveness probe |

Full schema is served at `/api/v1/docs` (Swagger UI) and `/api/v1/redoc`.

## Tests

```bash
# All tests
uv run pytest

# Integration only
uv run pytest tests/integration/

# With coverage
uv run pytest --cov=app --cov-report=term-missing
```

Integration tests require a local Postgres with the schema applied. The
fast path is `make db-fresh` from the repo root.

## Architecture references

- [Migration strategy](../docs/reference/migrations.md) — Alembic owns `public`, Supabase CLI owns `auth`/`storage`. Hand-write migrations, one logical change each, RLS on every new table.
- [Extraction + HITL architecture](../docs/reference/extraction-hitl-architecture.md) — schema, run lifecycle, RLS posture.
- [Deployment](../docs/reference/deployment.md) — Railway topology, env vars, gunicorn timeouts, rollback.
- [Extraction E2E observability](../docs/how-to/observability-extraction.md) — `trace_id`, `run_id`, `db_duration_ms`.
- [ADRs](../docs/adr/) — recorded architecture decisions.
- [Constitution](../.specify/memory/constitution.md) — non-negotiable architectural principles (layered architecture, DI first, split migration ownership, security by design, typed everything).

## Docker

```bash
docker build -t prumo-backend .
docker run -p 8000:8000 --env-file .env prumo-backend
```

(The image tag `prumo-backend` is local-only — Railway builds the same
Dockerfile and tags it internally.)

## License

AGPL-3.0 — see [`LICENSE`](../LICENSE).
