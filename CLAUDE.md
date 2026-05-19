# prumo Development Guidelines

Last updated: 2026-05-18

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

- **2026-05-18**: Promoted **entity type "role"** from convention to
  schema column. Migration `0016_entity_role_column` adds
  `extraction_entity_role` enum (`study_section` / `model_container` /
  `model_section`), backfills every row, and locks the invariants with
  a partial unique index (≤1 `model_container` per template), a CHECK
  constraint (role ↔ parent coherence), and a deferred trigger
  (`model_section` parent must be `model_container`). The
  `name = 'prediction_models'` magic string is gone from every service
  and component — `partitionEntityTypes`
  (`frontend/lib/extraction/entityTypeRoles.ts`) and
  `ExtractionEntityTypeRepository.get_by_role` are the only places that
  know the role values. `TemplateCloneService` now topologically sorts
  before insertion (no more implicit "parent must sort before child"
  contract on `sort_order`), and the per-model render block was
  extracted from `ExtractionFormView` into its own `ModelSection`
  component. See `docs/architecture/extraction-hitl-architecture.md`
  §4.1.
- **2026-05-17**: CHARMS template split into **study-level** and
  **per-model** sections (bumped to v1.1.0). Migration `0015_charms_studylevel_split`
  reparents Source of Data, Participants, Outcome, Candidate Predictors,
  Sample Size, Missing Data, and Observations to the root of the template
  (and of every project clone), leaving Model Development, Final
  Predictors, Performance, Validation, Results, and Interpretation under
  `prediction_models`. Restores per-CHARMS-methodology behaviour where
  study-level fields are entered once per article and per-model fields
  are entered once per evaluated model. The migration also de-duplicates
  pre-existing instances (keeps the oldest per `(article, entity_type)`,
  CASCADE-drops the rest). The `sort_order` on the global template is
  globally unique so `TemplateCloneService` continues to see parents
  before children when iterating.
- **2026-04-30**: Extraction **template import** uses
  `POST /api/v1/projects/{id}/templates/clone` only (no direct browser
  inserts into `project_extraction_templates`). `TemplateCloneService`
  remains idempotent; it can **heal** empty clones. See §4.1 in
  `docs/architecture/extraction-hitl-architecture.md`.
- **2026-04-28** (latest): HITL surface unification round 2.
  - DB invariants: migration 0004 deferred trigger forbids a project
    template without an active version; 0005 replaces the simple FK on
    `extraction_reviewer_states.current_decision_id` with a composite
    `(run_id, current_decision_id)` FK so a reviewer state can never
    point at a decision in a different run.
  - One endpoint, both kinds: `POST /api/v1/hitl/sessions` accepting
    `kind=extraction|quality_assessment` replaces `/api/v1/qa-assessments`
    and `/api/v1/projects/:id/qa-templates`. Cloning is internal to the
    session open for QA; extraction requires a `project_template_id`.
  - Service renames: `qa_template_clone_service` → `template_clone_service`
    (kind-parametrized), `qa_assessment_session_service` →
    `hitl_session_service`. Same applies to the schema, endpoint, and
    integration test files.
- **2026-04-28** (earlier): Squashed 18 migrations into a single
  `0001_baseline_v1` baseline. Dropped `ai_suggestions` (migration
  archived under that baseline) and `extracted_values` (migration 0002
  on top of the baseline). The extraction UI now reads/writes through
  `extraction_reviewer_decisions` + `extraction_published_states` via a
  single `ExtractionValueService` on the frontend; AI extraction
  auto-advances the Run PROPOSAL → REVIEW after recording proposals.
  See `docs/architecture/migrations.md`.
- **2026-04-28**: Cleanup wave on top of the HITL unification — migration
  0017 dropped `extraction_evidence.target_type/target_id`; 0018 added the
  `is_project_reviewer` SECURITY DEFINER helper and relaxed workflow-table
  RLS so reviewers (not just managers) can write. Quality-Assessment
  values flow through ProposalRecord → manual_override consensus →
  PublishedState (today via `/api/v1/hitl/sessions`).
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



