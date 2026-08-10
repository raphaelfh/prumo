---
status: stable
last_reviewed: 2026-08-09
owner: '@raphaelfh'
---

<!-- markdownlint-disable MD033 -->
<br /><br />

<p align="center">
  <a href="https://prumoai.vercel.app">
    <img src="docs/assets/prumo-logo.svg" alt="Prumo logo" width="320">
  </a>
</p>
<p align="center"><b>Systematic reviews and meta-analyses, end to end</b></p>

<p align="center">
    <a href="https://prumoai.vercel.app"><b>Live app</b></a> •
    <a href="docs/README.md"><b>Documentation</b></a> •
    <a href="docs/ROADMAP.md"><b>Roadmap</b></a> •
    <a href="docs/adr/"><b>Decisions</b></a> •
    <a href=".github/CONTRIBUTING.md"><b>Contributing</b></a>
</p>
<!-- markdownlint-enable MD033 -->

Meet **Prumo**, an open-source platform for running systematic reviews and
meta-analyses without losing the audit trail: import the literature, extract
data against versioned templates, and appraise risk of bias with independent
reviewers and a recorded consensus step. 🔬

> Prumo is under active development. Your suggestions, ideas, and bug reports
> help us a lot — open a [GitHub issue](https://github.com/raphaelfh/prumo/issues/new/choose)
> or see [Support](.github/SUPPORT.md). We read everything.

## 🚀 Getting started

Choose the setup that works best for you:

- **Live instance**
  The hosted deployment runs at [prumoai.vercel.app](https://prumoai.vercel.app) — Vercel for the frontend, Railway for the API and workers, Supabase for Postgres, Auth, and Storage.

- **Run it locally**
  Full control over your data: one `make setup`, one `make start`, and the whole stack (Supabase, FastAPI, Celery worker, Vite) comes up together.

| Requirement | Notes |
| --- | --- |
| Node.js 24 LTS + `npm` | Recommended via [`nvm`](https://github.com/nvm-sh/nvm#installing-and-updating) |
| Python 3.11+ | Managed with [`uv`](https://github.com/astral-sh/uv) |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Local Auth + Storage + Postgres |
| Docker Desktop | Runtime for the local Supabase stack |
| `make` | Preinstalled on macOS and Linux |

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

For manual setup without `make`, see [CONTRIBUTING](.github/CONTRIBUTING.md).

## 🌟 Features

- **Article management**
  Import, organise, deduplicate, and track research articles across the whole review, with PDFs stored and parsed on ingest.

- **Zotero integration**
  Pull articles and attachments straight from Zotero collections instead of re-entering metadata by hand.

- **Data extraction**
  Build extraction forms from versioned templates (CHARMS, PROBAST+AI, or your own), and pin every run to the template snapshot it was answered against.

- **Quality assessment (HITL)**
  Risk-of-bias appraisal with PROBAST and QUADAS-2, independent reviewers, blind reviews, and an explicit consensus step before a result is published.

- **AI-assisted proposals**
  Field-level suggestions from OpenAI and Anthropic models using your own API keys — always a proposal a human accepts or rejects, never a silent write.

- **Grounded citations**
  Every AI suggestion carries the passage it came from, highlighted in the source document, so a reviewer can check the claim in one click.

- **PDF viewer**
  Integrated reader with search, annotations, and side-by-side extraction against the article text.

- **Batch processing**
  Process many articles and assessment items in parallel through Celery workers.

## 🛠️ Local development

| Command | Purpose |
| --- | --- |
| `make start` / `make stop` / `make restart` | Lifecycle of the local stack |
| `make status` / `make health` / `make urls` | Status, health, URL list |
| `make test-backend` / `make lint-backend` | Backend pytest + ruff |
| `make db-fresh` | Reset + migrate + seed (idempotent) |
| `make quality-scan` | Full gate: lint, typecheck, tests, architectural fitness |
| `npm test` / `npm run test:run` / `npm run test:coverage` | Frontend Vitest |
| `npm run lint` / `npm run build` / `npm run dev` | Frontend ESLint / production build / dev server |
| `npx playwright test` | E2E suite (see [`frontend/e2e/README.md`](frontend/e2e/README.md)) |

Frontend tooling runs from the repo root — there is no `frontend/package.json`.
The app schema is owned by Alembic (`backend/alembic/versions/`); the
`supabase/` migrations cover Auth and Storage only.

## ⚙️ Built with

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Celery](https://img.shields.io/badge/Celery-37814A?style=for-the-badge&logo=celery&logoColor=white)](https://docs.celeryq.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)

Typed end to end: TypeScript strict on the frontend, Pydantic v2 and
SQLAlchemy 2.0 async on the backend, with row-level security enforcing
project-scoped access in Postgres. Tests are pytest, Vitest, and Playwright
(E2E + accessibility + visual).

## 🗂️ Repo layout

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
│   │   ├── llm/             # Provider adapters, extraction prompts
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

## 🚢 Deployment

| Service | Platform |
| --- | --- |
| Frontend | Vercel — auto-deploys `main` |
| Backend `web` (FastAPI + gunicorn) | Railway, Hobby plan, US East |
| Backend `worker` (Celery) | Railway, Hobby plan, US East |
| Redis | Railway managed plugin |
| Postgres + Auth + Storage | Supabase |

See [`docs/reference/deployment.md`](docs/reference/deployment.md) for the
topology diagram, the full environment-variable reference, deploy gates,
rollback procedure, and the CI coverage constraint.

## 📝 Documentation

Explore the [documentation index](docs/README.md) — a Diátaxis-organised site
map covering deployment, migrations, architecture, and test strategy. Recorded
architecture decisions live in [ADRs](docs/adr/), planned work in the
[roadmap](docs/ROADMAP.md), and the agent entry point is [`llms.txt`](llms.txt).

## ❤️ Community

Ask questions, report bugs, share ideas, or request features through
[GitHub issues](https://github.com/raphaelfh/prumo/issues). We follow a
[Code of Conduct](.github/CODE_OF_CONDUCT.md) in all community channels, and
[Support](.github/SUPPORT.md) lists the fastest route for each kind of request.

## 🛡️ Security

If you discover a security vulnerability in Prumo, please report it responsibly
instead of opening a public issue. All legitimate reports are investigated
promptly — see the [security policy](.github/SECURITY.md) for how to reach us.

## 🤝 Contributing

- Report [bugs](https://github.com/raphaelfh/prumo/issues/new/choose) or submit feature requests.
- Improve the docs — typo fixes and new content are equally welcome.
- Pick up an item from the [roadmap](docs/ROADMAP.md) and open a pull request against `dev`.

Read [CONTRIBUTING](.github/CONTRIBUTING.md) for the branch model, commit
convention, and the checks a pull request has to pass.

### We couldn't have done this without you

[![Contributors](https://contrib.rocks/image?repo=raphaelfh/prumo)](https://github.com/raphaelfh/prumo/graphs/contributors)

## License

Prumo is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
