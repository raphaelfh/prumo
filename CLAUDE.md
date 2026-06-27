---
status: stable
last_reviewed: 2026-06-27
owner: '@raphaelfh'
---

# prumo Development Guidelines

## Current focus

- See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the live cycle — the
  source of truth; don't re-pin a date here. Now: grounded extraction on
  stored markdown (ADR-0013 **shipped**, #400; ADR-0011 still
  **proposed**). The *extraction* read-path consolidation shipped (#228,
  #324); other app-schema reads still use PostgREST.
- Project history lives in `git log` and `docs/adr/` — do not append
  changelogs to this file. Keep this section to ≤ 5 lines.

## Working principles

These bias toward caution over speed. For trivial changes, use judgment.

- **Think before coding.** State assumptions; if a requirement has multiple
  readings, surface them — don't choose silently. If a simpler path exists, say
  so; push back with evidence, not deference. Genuinely unclear, or the call is
  the user's? Stop and ask — otherwise act, don't re-litigate settled choices.
  Feature/creative work starts with `superpowers:brainstorming`.
- **Simplicity first (YAGNI).** The minimum code that solves the asked problem —
  no speculative abstractions, config, or handling for impossible cases. Any
  complexity beyond what a principle prescribes must be justified (constitution
  §Governance). If 200 lines could be 50, rewrite it.
- **Surgical on unrelated code; clean in code you touch.** Change only what the
  task requires; match surrounding style; flag unrelated dead code, don't delete
  it. But where you DO edit, prefer the clean fix over grandfathering a
  violation — no new legacy left for later.
- **Goal-driven and verified.** Turn the task into a checkable goal (write the
  failing test, then make it pass). State a short plan with a verify step each.
  Evidence before "done" — run the command and read the output, never assert
  (`code-review` Iron Law; `verification-before-completion`).

## Which skill to load

Load the skill before non-trivial work in its area (skills are on-demand —
naming them here is what makes them load reliably).

- Backend (FastAPI/SQLAlchemy/Alembic/Celery/RLS) → `backend-development`
- Frontend structure/data/state (components/hooks/services/stores) → `frontend-development`
- Frontend visual language (density/layout/empty states) → `frontend-ux`
- Tailwind/shadcn class mechanics → `ui-styling`
- Before "done" / PR / review → `code-review`
- Bug / failing test / weird behavior → `debugging`
- Tests (Vitest/Playwright/pytest/MSW) → `web-testing`
- Deploy / promotion / rollback → `deploy-release`
- Architectural drift sweep → `architectural-quality-loop`
- Visual feedback loop on a screen → `design-review`

## Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic,
  Celery + Redis, Pydantic v2, structlog. PostgreSQL via Supabase
  (Auth + Storage). Hosted on **Railway** (web + worker + Redis).
- **Frontend**: TypeScript strict, React 19 + Vite, TanStack Query,
  Zustand, shadcn/Radix, react-hook-form, Zod. In-house i18n at
  `frontend/lib/copy/` (no external i18n lib). Hosted on **Vercel**.
- **Testing**: pytest (backend), vitest (frontend), Playwright (E2E).

## Required plugins

- **superpowers** (`@claude-plugins-official`, pin to the installed
  6.x) is a required project plugin, declared in
  `.claude/settings.json`. The `architectural-quality-loop` family and
  the process skills under `.claude/skills/debugging/` defer to
  `superpowers:loop`, `writing-plans`, `using-git-worktrees`,
  `systematic-debugging`, and `verification-before-completion`. Generic
  engineering process lives there; keep prumo skills to the
  prumo-specific delta. Without the plugin those skills are incomplete.

## Layout gotchas (agents get these wrong)

- Frontend tooling runs from the **repo root**: `package.json`,
  `vite.config.ts`, `vitest.config.ts` live at root; there is no
  `frontend/package.json`. Never `cd frontend && npm ...`.
- `supabase/` holds **auth/storage migrations only**; the app schema
  is owned by Alembic (`backend/alembic/versions/`).

## Commands

- `make setup` — first-time install (runs `make hooks`)
- `make hooks` — install the pre-push gate (`.githooks/`): fast ruff/tsc on
  changed layers + a `/code-review` reminder on risk-sensitive paths
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
