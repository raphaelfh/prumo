# Data Model: Alembic Migration Management

**Feature**: 001-alembic-migrations | **Date**: 2026-02-26

---

## Ownership Boundary

This feature introduces a strict ownership boundary for database objects:

| Object Type                        | Owner       | Tool         | Location                          |
|------------------------------------|-------------|--------------|-----------------------------------|
| `auth.*` schema                    | Supabase    | Supabase CLI | Internal (not migrated)           |
| `storage.*` schema                 | Supabase    | Supabase CLI | Internal (not migrated)           |
| `public.*` application tables      | Application | Alembic      | `backend/alembic/versions/`       |
| `public.*` RLS policies            | Application | Alembic      | Same migration as table           |
| `public.*` functions & triggers    | Application | Alembic      | Same migration as dependency      |
| Storage buckets + storage policies | Supabase    | Supabase CLI | `supabase/migrations/` (retained) |
| Extensions (`pgcrypto`, etc.)      | Application | Alembic      | Initial migration                 |

---

## Alembic Version Table

**Entity**: `alembic_version` (created automatically by Alembic)
**Schema**: `public`
**Attributes**:

- `version_num` (varchar, PK): The current revision identifier

This table is managed exclusively by Alembic. It must not be referenced or modified by Supabase migrations or
application code.

---

## Migration File Entity

**Entity**: A Python file in `backend/alembic/versions/`
**Naming**: `{revision_id}_{description}.py` (Alembic-generated ID)
**Structure**:

- `revision`: Unique revision ID (12-character hex, Alembic-generated)
- `down_revision`: Parent revision ID (None for initial)
- `branch_labels`: Optional branch grouping
- `upgrade()`: SQL operations to apply
- `downgrade()`: SQL operations to reverse (where feasible)

**Lifecycle states**: pending → applied

**Initial Migration**: `0001_initial_public_schema.py` — covers the full schema from all deleted Supabase migrations.

---

## Schema Boundary: Public Schema Tables

All existing application tables remain in `public` schema with the same structure. Below is the entity grouping that
informs migration ordering:

### Core User Domain

- `profiles` — user profile data; PK = FK to `auth.users.id` (FK declared in SQL only)

### Project Domain

- `projects` — systematic review projects; references `profiles`
- `project_members` — membership with roles; references `projects` + `profiles`

### Article Domain

- `articles` — scientific articles per project; references `projects`
- `article_files` — PDF/document files per article; references `articles` + `projects`
- `article_highlights`, `article_boxes`, `article_annotations` — annotation data; reference `articles`

### Extraction Domain

- `extraction_templates_global` — global extraction templates
- `project_extraction_templates` — project-specific templates; references `projects`
- `extraction_entity_types` — entity type definitions per template
- `extraction_fields` — field definitions per entity type
- `extraction_instances` — extraction work items; references `projects` + `articles`
- `extracted_values` — individual extracted values; references `extraction_instances` + `extraction_fields`
- `extraction_evidence` — evidence for extracted values
- `extraction_runs` — AI extraction run tracking; references `projects`

### Assessment Domain

- `assessment_instruments` — assessment tools (e.g., PROBAST)
- `assessment_items` — individual assessment questions per instrument
- `assessments` — assessment instances per article; references `projects`
- `assessment_instances` — individual assessments; references `assessments`
- `assessment_responses` — responses per item; references `assessment_instances`
- `project_assessment_instruments` — project-instrument assignments

### AI Domain

- `ai_suggestions` — AI-generated suggestions; references `extraction_runs`
- `ai_assessment_runs` — AI assessment batch runs
- `ai_assessment_configs` — AI assessment configuration; references `projects`
- `ai_assessment_prompts` — prompt templates
- `ai_assessments` — AI assessment results; references `projects`

### Integration Domain

- `zotero_integrations` — Zotero API connections per user; references `profiles`
- `user_api_keys` — encrypted provider API keys per user; references `profiles`

### Feedback Domain

- `feedback_reports` — user feedback entries

---

## ENUM Types (owned by Alembic after migration)

All 14 ENUM types currently in `0002_enums.sql` transfer to the initial Alembic migration:

| ENUM Name                    | Values                                                                       |
|------------------------------|------------------------------------------------------------------------------|
| `review_type`                | interventional, predictive_model, diagnostic, prognostic, qualitative, other |
| `project_member_role`        | manager, reviewer, viewer, consensus                                         |
| `file_role`                  | MAIN, SUPPLEMENT, PROTOCOL, DATASET, APPENDIX, FIGURE, OTHER                 |
| `extraction_framework`       | CHARMS, PICOS, CUSTOM                                                        |
| `extraction_field_type`      | text, number, date, select, multiselect, boolean                             |
| `extraction_cardinality`     | one, many                                                                    |
| `extraction_source`          | human, ai, rule                                                              |
| `extraction_run_stage`       | data_suggest, parsing, validation, consensus                                 |
| `extraction_run_status`      | pending, running, completed, failed                                          |
| `suggestion_status`          | pending, accepted, rejected                                                  |
| `extraction_instance_status` | pending, in_progress, completed, reviewed, archived                          |
| `assessment_status`          | in_progress, submitted, locked, archived                                     |
| `assessment_source`          | human, ai, consensus                                                         |

---

## Supabase Migrations After Cutover

**Retained** (1 file):

- `0001_storage_bucket_articles.sql` — creates `articles` storage bucket and `storage.objects` RLS policies

**Deleted** (all others — 36+ files): All files defining public schema tables, enums, indexes, functions, triggers, RLS
on application tables, views, and data seeds. These become Alembic migrations.

---

## Files Introduced by This Feature

```text
backend/
├── alembic.ini                         # Alembic CLI configuration
└── alembic/
    ├── env.py                          # Async env + include_object filter
    ├── script.py.mako                  # Migration file template
    └── versions/
        └── 0001_initial_public_schema.py  # All current public schema SQL
```

**Modified**:

- `backend/app/models/base.py` — add naming_convention to `Base.metadata`
- `backend/app/main.py` — add `check_migrations()` call in `lifespan()` startup
- `backend/pyproject.toml` — add `alembic` dependency
- `backend/.env.example` — add `DATABASE_URL` note for Alembic sync connection
- `.specify/memory/constitution.md` — amend Principle III and Technology table
- `Makefile` — update migration targets
- `supabase/migrations/` — delete all non-storage migration files
