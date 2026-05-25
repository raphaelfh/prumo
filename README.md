---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Prumo

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)
![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)

A complete platform for managing systematic reviews and meta-analyses.

## Features

- **Article management** — import, organise, and manage research articles.
- **Zotero integration** — import articles directly from Zotero collections.
- **AI-assisted assessment** — automated quality scoring with OpenAI (GPT-4o) and Anthropic (Claude).
- **Batch processing** — process multiple articles and assessment items in parallel via Celery.
- **Data extraction** — build custom forms backed by versioned templates (CHARMS, custom).
- **Quality assessment (HITL)** — risk-of-bias appraisal with PROBAST, QUADAS-2, and reviewer consensus.
- **PDF viewer** — integrated reader with annotations and search.

## Tech stack

**Backend** — Python 3.11+, FastAPI, SQLAlchemy 2.0 (async), Alembic, Celery + Redis, Pydantic v2, structlog, gunicorn + uvicorn worker.
**Frontend** — TypeScript (strict), React 18.3 + Vite, TanStack Query, Zustand, Tailwind + shadcn/ui (Radix), react-hook-form, Zod, in-house i18n (`frontend/lib/copy/`).
**Database / Auth / Storage** — PostgreSQL (Supabase), Row Level Security with project-scoped helpers.
**Testing** — pytest (backend), Vitest (frontend), Playwright (E2E + a11y + visual).
**Hosting** — Vercel (frontend) + Railway (backend web + Celery worker + managed Redis) + Supabase (Postgres + Auth + Storage).

## Quickstart

### Requirements

- Node.js 24 LTS and `npm` (recommended via [`nvm`](https://github.com/nvm-sh/nvm#installing-and-updating))
- Python 3.11+ and [`uv`](https://github.com/astral-sh/uv)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker Desktop (for the local Supabase stack)
- `make` (preinstalled on macOS/Linux)

### Setup

```sh
# 1. Clone
git clone https://github.com/raphaelfh/prumo.git
cd prumo

# 2. First-time install
make setup

# 3. (Optional) configure env
cp .env.example .env  # only if make setup did not already
$EDITOR .env backend/.env

# 4. Start the full local stack (Supabase + backend + worker + frontend)
make start

# 5. Sanity checks
make status
make urls
```

| URL | Service |
| --- | --- |
| <http://localhost:8080> | Frontend (Vite dev server) |
| <http://localhost:8000> | Backend API |
| <http://localhost:8000/api/v1/docs> | OpenAPI / Swagger UI |
| <http://127.0.0.1:54323> | Supabase Studio |

For manual setup (without `make`), see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).

## Common commands

| Command | Purpose |
| --- | --- |
| `make start` / `make stop` / `make restart` | Lifecycle of the local stack |
| `make status` / `make health` / `make urls` | Status, health, URL list |
| `make test-backend` / `make lint-backend` | Backend pytest + ruff |
| `make db-fresh` | Reset + migrate + seed (idempotent) |
| `npm test` / `npm run test:run` / `npm run test:coverage` | Frontend Vitest |
| `npm run lint` / `npm run build` / `npm run dev` | Frontend ESLint / production build / dev server |
| `npx playwright test` | E2E suite (see [`frontend/e2e/README.md`](frontend/e2e/README.md)) |

## Documentation

- 📖 [Documentation index](docs/README.md) — Diátaxis-organised site map.
- 🚀 [Deployment reference](docs/reference/deployment.md) — Railway + Vercel topology, env vars, rollback.
- 🧱 [Extraction + HITL architecture](docs/reference/extraction-hitl-architecture.md) — canonical schema, run lifecycle.
- 🛢️ [Migration strategy](docs/reference/migrations.md) — Alembic vs Supabase split, squash recipe.
- ✅ [Test strategy](docs/reference/test-strategy.md) — load-bearing tests.
- 🧭 [ADRs](docs/adr/) — recorded architecture decisions.
- 🗺️ [Roadmap](docs/ROADMAP.md) — milestones + link to GitHub Projects.

### Community

- [Contributing](.github/CONTRIBUTING.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Security policy](.github/SECURITY.md)
- [Support](.github/SUPPORT.md)

## Project layout

```text
prumo/
├── frontend/                # React + Vite app
│   ├── components/          # UI components (shadcn + custom)
│   ├── hooks/               # Custom React hooks
│   ├── services/            # API clients
│   ├── pages/               # Routes
│   ├── lib/                 # Utilities, i18n (copy/), validators
│   └── e2e/                 # Playwright suite
├── backend/                 # FastAPI app
│   ├── app/
│   │   ├── api/v1/          # REST endpoints
│   │   ├── core/            # Config, security, DI
│   │   ├── db/              # Engine, session
│   │   ├── models/          # SQLAlchemy models
│   │   ├── repositories/    # CRUD layer
│   │   ├── schemas/         # Pydantic v2 schemas
│   │   ├── services/        # Business logic
│   │   ├── worker/          # Celery tasks
│   │   └── seed.py          # Idempotent seed (CHARMS, PROBAST, QUADAS-2)
│   ├── alembic/versions/    # Migrations (app schema)
│   └── tests/               # pytest suite
├── supabase/migrations/     # Auth + Storage migrations only
├── docs/                    # Documentation (Diátaxis)
├── scripts/                 # Automation scripts
├── railway.toml             # Backend IaC (Railway)
├── vercel.json              # Frontend project config
└── docker-compose.yml       # Local-only Postgres helper
```

## Deployment

| Service | Platform |
| --- | --- |
| Frontend | Vercel — auto-deploys `main` |
| Backend `web` (FastAPI + gunicorn) | Railway, Hobby plan, US East |
| Backend `worker` (Celery) | Railway, Hobby plan, US East |
| Redis | Railway managed plugin |
| Postgres + Auth + Storage | Supabase |

See [`docs/reference/deployment.md`](docs/reference/deployment.md) for the
topology diagram, full environment-variable reference, deploy gates,
rollback procedure, and the CI coverage constraint.

## License

Prumo is released under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**.
See [`LICENSE`](LICENSE) for the full text.

## Acknowledgements

Thanks to every contributor who helped make this project better.
