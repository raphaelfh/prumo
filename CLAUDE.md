# prumo Development Guidelines

Last updated: 2026-04-28

## Active Technologies

- Backend: Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis,
  Pydantic, structlog. PostgreSQL (`public` schema), Supabase Auth + Storage.
- Frontend: TypeScript strict, React 18.3 + Vite, TanStack Query, Zustand,
  shadcn/Radix, react-hook-form, Zod. Custom in-house i18n module at
  `frontend/lib/copy/` (no external i18n lib).
- Testing: pytest (backend), vitest (frontend), Playwright (E2E).

## Architecture references

The extraction + quality-assessment stack is the project's structural
heart. Read these before touching anything in `extraction_*` or
`/api/v1/runs/...`:

- **Canonical schema reference:**
  [`docs/architecture/extraction-hitl-architecture.md`](docs/architecture/extraction-hitl-architecture.md)
- **Migration strategy:**
  [`docs/architecture/migrations.md`](docs/architecture/migrations.md) —
  when to squash, how to write a migration, RLS conventions.
- **Original design spec (immutable):**
  [`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md`](docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md)
- **Archived execution plans (historical only):**
  [`docs/superpowers/plans/archive/2026-04-27-hitl-unification/`](docs/superpowers/plans/archive/2026-04-27-hitl-unification/)

## Project Structure

```text
backend/                  # FastAPI app + Alembic migrations + pytest
frontend/                 # Vite + React + Vitest + Playwright
supabase/                 # auth/storage migrations only
docs/                     # architecture/, superpowers/, planos/, ...
```

## Commands

- `make setup` — first-time install
- `make start` / `make stop` — local stack
- `make test-backend` — backend pytest
- `make lint-backend` — ruff check + format
- `npm test` / `npm run lint` — frontend

## Code Style

- **Language**: All code, comments, commit messages, docs, and project text
  must be written in **English**.
- TypeScript (strict), React 18.3: standard conventions.
- See `.claude/CLAUDE.md` for the project guide AI assistants must follow
  (db-migration rules, seeding, etc.).

## Recent Changes

- **2026-04-28**: Cleanup wave on top of the HITL unification — migration
  0017 dropped `extraction_evidence.target_type/target_id`; 0018 added the
  `is_project_reviewer` SECURITY DEFINER helper and relaxed workflow-table
  RLS so reviewers (not just managers) can write. Quality-Assessment
  values now persist through `/api/v1/qa-assessments` → ProposalRecord →
  manual_override consensus → PublishedState.
- **2026-04-27**: Extraction-centric HITL unification. Replaced the 008
  parallel evaluation skeleton with a single stack discriminated by
  `kind` (`extraction` | `quality_assessment`). Migrations 0010 → 0016
  introduced TemplateVersion + HitlConfig snapshots, the five workflow
  tables, the new run-stage enum, synthetic Runs for legacy
  `extracted_values`, and the 008 tear-down. PROBAST + QUADAS-2 seeded as
  global QA templates. See `docs/architecture/extraction-hitl-architecture.md`.
- **2026-04-27**: Sidebar revitalization — show/hide-binary sidebar with
  drag resize, G-prefixed nav shortcuts, theme toggle, mobile parity.
- **006-zotero-articles-sync**: Zotero integration (Auth/Storage).
- **005-articles-export**: Articles export pipeline (Celery + Storage).



