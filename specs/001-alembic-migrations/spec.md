# Feature Specification: Alembic Migration Management for Application Domain

**Feature Branch**: `001-alembic-migrations`
**Created**: 2026-02-26
**Status**: Draft

## Overview

The project currently uses Supabase migrations exclusively for all database changes, including application tables in the
`public` schema. This feature establishes a clear boundary: Supabase migrations will only manage what Supabase owns (
authentication, storage, and their related configurations), while Alembic will manage all application domain tables in
the `public` schema.

This separation aligns with the principle that each tool should manage only what it owns, reducing risk of accidental
interference and giving developers a familiar, code-driven workflow for evolving the application's data model.

## Clarifications

### Session 2026-02-26

- Q: How should existing and new environments handle the Supabase → Alembic migration transition? → A: Full replay — all
  existing Supabase application-domain migrations are deleted and recreated as Alembic migrations from scratch. All
  environments (existing and new) apply Alembic from the beginning.
- Q: Should RLS policies on application tables be owned by Alembic or Supabase migrations? → A: Alembic — policies are
  written as raw SQL within Alembic migration files, co-located with the table they protect.
- Q: What should happen when the application starts with unapplied Alembic migrations? → A: Fail fast — application
  refuses to start and outputs a list of all pending unapplied migrations.
- Q: How should the CI database be initialized for each test run? → A: Full reset per run — Supabase reset followed by
  Alembic migrate, applied fresh on every CI run.
- Q: How will Alembic migrations be applied in production? → A: Automated — migrations run automatically as a deployment
  step before the application server starts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Runs New Migration for Application Table (Priority: P1)

A backend developer has added a new SQLAlchemy model and needs to create a database migration for it. They run a single
command that detects the difference between the current models and the database state, generates a migration file, and
applies it — without ever touching auth or storage tables.

**Why this priority**: This is the core daily workflow. Every new feature that touches the data model depends on this
working correctly. If Alembic accidentally detects Supabase-managed tables as "missing" and tries to drop them, it would
be catastrophic.

**Independent Test**: Can be fully tested by adding a new SQLAlchemy model, running the migration generation command,
and verifying: (1) the generated migration only references the new table, (2) applying the migration creates the
table, (3) no auth/storage/Supabase-internal tables appear in the generated diff.

**Acceptance Scenarios**:

1. **Given** a new SQLAlchemy model is added to the codebase, **When** the developer runs the migration auto-generation
   command, **Then** a new migration file is created that only includes changes to the new model and no
   Supabase-internal tables are referenced for deletion or alteration.
2. **Given** a generated migration file exists, **When** the developer applies it, **Then** the new table is created in
   the database and the migration is recorded as applied.
3. **Given** the database has Supabase-injected tables in `public` (e.g., PostGIS or extension tables), **When** the
   migration auto-generate command runs, **Then** those tables are silently ignored and do not appear in the generated
   file.
4. **Given** an existing application table has a structural change in the SQLAlchemy model, **When** auto-generate runs,
   **Then** the migration correctly captures only that change.

---

### User Story 2 - Developer Sets Up Local Environment from Scratch (Priority: P2)

A new developer joins the project and sets up their local environment. They need to initialize the database with both
the Supabase-managed configurations (auth schema, storage buckets) and all application tables. The process should be
clearly documented and executable with a small set of commands.

**Why this priority**: Onboarding reliability directly impacts developer productivity. A broken setup process wastes
time and creates confusion about the migration ownership model.

**Independent Test**: Can be tested by starting with a blank local database, running the documented setup sequence, and
verifying that all expected tables exist in the correct schemas and that authentication and storage work correctly.

**Acceptance Scenarios**:

1. **Given** a fresh local database with no tables, **When** the developer runs the Supabase setup command followed by
   the Alembic migration command, **Then** all auth/storage configurations are present AND all application tables exist
   in `public`.
2. **Given** the environment is set up, **When** the developer creates a test user via Supabase Auth and creates a
   record in an application table referencing that user, **Then** the foreign key relationship is respected without
   errors.

---

### User Story 3 - Developer Understands Which Tool to Use for Which Change (Priority: P3)

A developer needs to make a database change (e.g., add a column, create a bucket, update an RLS policy). The project's
tooling and documentation make it unambiguous which migration system to use for which type of change.

**Why this priority**: Without clear guidance, developers may create migrations in the wrong system, leading to drift or
conflicts over time.

**Independent Test**: Can be tested by asking a developer unfamiliar with the split to make three different types of
changes (application table column, storage bucket configuration, auth-related policy) and observing whether they
naturally choose the correct tool for each.

**Acceptance Scenarios**:

1. **Given** a developer needs to add a column to an application table, **When** they consult the project setup, **Then
   ** they find clear guidance pointing them to Alembic.
2. **Given** a developer needs to create a new storage bucket or update storage RLS policies, **When** they consult the
   project setup, **Then** they find clear guidance pointing them to Supabase migrations.
3. **Given** a developer inadvertently creates an Alembic migration that references an auth or storage table, **When**
   the migration is validated or reviewed, **Then** the issue is detectable before it is applied.

---

### Edge Cases

- What happens when an Alembic auto-generate command is run against a database that has Supabase-injected views or
  functions in `public` (e.g., from PostGIS or pg_graphql extensions)?
- If a developer forgets to apply Alembic migrations before running the application, the application refuses to start
  and prints the list of pending migration identifiers (resolved: fail fast, see FR-011).
- What happens if a Supabase migration and an Alembic migration both try to modify the same object (e.g., an RLS policy
  on an application table)?
- In CI, the database is fully reset on every run (Supabase reset + Alembic migrate), so the full migration chain is
  validated end-to-end on every pull request (resolved: full reset per run, see SC-006).
- What happens if the Alembic migration history table (`alembic_version`) already exists from a previous failed attempt?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST have a configured Alembic setup that manages database schema changes exclusively for
  tables in the `public` schema that belong to the application domain.
- **FR-002**: The Alembic configuration MUST ignore all tables and objects in the `auth`, `storage`, `realtime`, and
  `extensions` schemas, preventing any auto-generated migration from referencing them.
- **FR-003**: The Alembic configuration MUST ignore known Supabase-injected tables that appear in the `public` schema (
  e.g., `spatial_ref_sys` and similar extension artifacts), with a documented, extendable ignore list.
- **FR-004**: All existing Supabase migration files that define application-domain tables in `public` MUST be deleted.
  Their content MUST be fully rewritten as Alembic migration files, preserving the same schema structure.
- **FR-004b**: Supabase migrations MUST be reduced to a minimal set covering only: storage bucket creation, storage RLS
  policies, and any required Supabase-specific extensions or configurations. No application table definitions may remain
  in Supabase migration files.
- **FR-005**: The complete Alembic migration chain MUST reproduce the exact same `public` schema as the prior Supabase
  migrations did for application tables, verifiable by schema comparison.
- **FR-005b**: All RLS policies on application-domain tables MUST be written as raw SQL within Alembic migration files,
  co-located with the table definitions they protect. No application table RLS policies may remain in Supabase migration
  files.
- **FR-006**: SQLAlchemy models that reference the `auth.users` table MUST use a cross-schema foreign key that does not
  require Alembic to manage or own the `auth.users` table itself.
- **FR-007**: Developers MUST be able to apply all application migrations using a single Alembic command against a
  locally running database.
- **FR-008**: The Makefile or development documentation MUST clearly specify the order of operations: Supabase setup
  first (auth/storage), then Alembic migrations (application tables).
- **FR-009**: The Alembic `env.py` configuration MUST be compatible with the project's async SQLAlchemy setup,
  supporting async database connections.
- **FR-010**: The migration workflow MUST support both an online mode (connected to a running database) and an
  offline/SQL-generation mode for generating raw SQL scripts for review.
- **FR-011**: The application MUST check at startup whether all Alembic migrations have been applied. If any are
  pending, the application MUST refuse to start and output the list of unapplied migration identifiers before exiting.
- **FR-012**: The deployment pipeline MUST automatically run all pending Alembic migrations as a step that executes
  before the application server starts, ensuring schema and code are always in sync at deployment time.

### Key Entities

- **Alembic Version Table**: A tracking record stored in the `public` schema that records which migrations have been
  applied. Managed entirely by Alembic; must not conflict with Supabase's internal tracking.
- **Migration File**: A versioned script that describes a single, reversible change to the application's database
  schema. Each file has an upgrade and optionally a downgrade path.
- **Supabase Migration File**: An SQL script applied by the Supabase CLI. After this feature, these files cover only
  auth schema configurations and storage bucket/policy setup.
- **Schema Boundary**: The conceptual and enforced separation between schemas managed by Supabase (`auth`, `storage`,
  `realtime`) and schemas managed by Alembic (`public`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the migration auto-generate command against any state of the database produces a migration file
  that contains zero references to `auth`, `storage`, or `realtime` schema objects.
- **SC-002**: A developer with no prior knowledge of the project can set up a fully working local database (all tables,
  auth, and storage configured) by following the documented steps in under 10 minutes.
- **SC-003**: 100% of existing application tables are covered by Alembic migrations — verified by comparing the final
  schema produced by Alembic-only migrations against the schema produced by the original Supabase migrations for
  application tables.
- **SC-004**: The number of Supabase migration files is reduced to cover only auth/storage concerns, with zero Supabase
  migration files defining application domain tables.
- **SC-005**: Applying Alembic migrations from a clean state and then running the full test suite produces zero
  database-schema-related errors.
- **SC-006**: The Alembic migration chain applies cleanly in a CI environment on every pull request without manual
  intervention. CI uses a full database reset (Supabase reset + Alembic migrate) on each run.

## Assumptions

- All existing Supabase migration files that define application-domain tables in `public` will be deleted and their
  content fully rewritten as Alembic migration files. This is a clean cutover — no stamping, no partial replay.
- All environments (local developer machines, CI, production) will reset their databases and apply migrations from
  scratch using the new Alembic chain after the cutover.
- Row-Level Security (RLS) policies on application tables will be managed by Alembic (as raw SQL in migration files),
  since they are part of the application domain's security model, not Supabase's internal auth/storage logic.
- The Supabase local development environment will still be used for its auth emulation and storage capabilities — only
  the migration tooling responsibility is being split.
- The project uses a single `public` schema for all application tables; no custom application schemas are introduced as
  part of this feature.
