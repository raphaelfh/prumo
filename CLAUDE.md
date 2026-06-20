---
status: stable
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# prumo Development Guidelines

## Current focus

- See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the active cycle. As of
  2026-06-20: structured PDF parsing / grounded extraction (ADR-0011, ADR-0013).
  The extraction data-path consolidation **shipped** (#228, #324) — not active.
- Project history lives in `git log` and `docs/adr/` — do not append
  changelogs to this file. Keep this section to ≤ 5 lines.

## Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic,
  Celery + Redis, Pydantic v2, structlog. PostgreSQL via Supabase
  (Auth + Storage). Hosted on **Railway** (web + worker + Redis).
- **Frontend**: TypeScript strict, React 19 + Vite, TanStack Query,
  Zustand, shadcn/Radix, react-hook-form, Zod. In-house i18n at
  `frontend/lib/copy/` (no external i18n lib). Hosted on **Vercel**.
- **Testing**: pytest (backend), vitest (frontend), Playwright (E2E).

## Layout gotchas (agents get these wrong)

- Frontend tooling runs from the **repo root**: `package.json`,
  `vite.config.ts`, `vitest.config.ts` live at root; there is no
  `frontend/package.json`. Never `cd frontend && npm ...`.
- `supabase/` holds **auth/storage migrations only**; the app schema
  is owned by Alembic (`backend/alembic/versions/`).

## Commands

- `make setup` — first-time install
- `make start` / `make stop` — local stack (Supabase + backend + frontend)
- `make test-backend` — backend pytest (needs local Supabase Docker)
- `make lint-backend` — ruff check + format
- `npm run test:run` / `npm run lint` — frontend (from repo root)
- `make quality-scan` — full deterministic gate (`scripts/verify_all.sh`:
  lint + typecheck + tests + architectural fitness)

## Read before touching

The extraction + quality-assessment (HITL) stack is the structural
heart. Before changing anything in `extraction_*` tables,
`/api/v1/runs/...`, or `/api/v1/hitl/sessions`, read:

- [`docs/reference/extraction-hitl-architecture.md`](docs/reference/extraction-hitl-architecture.md)
  — canonical schema reference
- [`docs/reference/migrations.md`](docs/reference/migrations.md)
  — migration strategy, squashing, RLS conventions
- [`docs/reference/constitution.md`](docs/reference/constitution.md)
  — architectural principles (layering, typed everything)

Full doc index: [`docs/README.md`](docs/README.md) (Diátaxis).
Agent entry point: [`llms.txt`](llms.txt).
Design rationale (the *why*):
[`docs/explanation/extraction-hitl-design-rationale.md`](docs/explanation/extraction-hitl-design-rationale.md)
(the original 2026-04-27 spec is archived verbatim under `docs/superpowers/specs/archive/`).

## Hard rules

- **English only** for code, comments, commits, docs, and copy keys.
- **SQLAlchemy model change ⇒ Alembic migration** (run inside
  `backend/`: `alembic revision --autogenerate -m "..."`). Supabase
  CLI migrations are only for `auth`/`storage`. Never apply app-schema
  DDL through the Supabase MCP.
- **Seeding is not done in migrations**: `cd backend && uv run python
  -m app.seed` (idempotent). `make reset-db` wipes local data — prefer
  `make db-fresh` (chains migrate + seed).
- PRs target `dev` and are squash-merged. Conventional commits.

Path-scoped conventions live in `.claude/rules/` (`backend.md`,
`frontend.md`) and load automatically when matching files are touched.
