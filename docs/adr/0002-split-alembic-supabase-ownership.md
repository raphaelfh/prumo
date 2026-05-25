---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0002'
---

# Split migration ownership between Alembic (public) and Supabase CLI (auth, storage)

> **Status:** Accepted · Date: 2026-04-01 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

Prumo runs on top of Supabase, which provides Postgres plus managed `auth`
and `storage` schemas with built-in triggers and policies. The application
also needs its own schema (`public.*` tables for projects, articles,
extraction templates, runs, decisions, etc.).

Mixing both in one migration system (e.g. Alembic-only or Supabase-CLI-only)
either drops Supabase-managed objects (Alembic) or makes
SQLAlchemy-autogenerate unusable (Supabase CLI).

## Decision

- **Alembic owns `public.*`** — application tables, indexes, triggers,
  enums, RLS policies. Migration files live under
  `backend/alembic/versions/`.
- **Supabase CLI owns `auth.*` and `storage.*`** — bucket creation, RLS
  on Supabase-managed schemas, the `handle_new_user` trigger that creates
  `profiles` rows. Migration files live under `supabase/migrations/`.
- The Alembic `env.py` `include_object` filter excludes everything outside
  `public.*` to prevent autogenerate noise.
- A CI script (`scripts/validate_migration_boundaries.sh`) enforces the
  split mechanically.

## Consequences

- Good — Each migration system stays in its lane; no ownership ambiguity.
- Good — Autogenerate is usable on `public.*` without producing noise from
  Supabase internals.
- Good — The app refuses to start if `alembic current ≠ alembic head`.
- Neutral — Two systems to learn; mitigated by the strict binary rule.
- Bad — One-time onboarding cost for new contributors.

## Validation

- `scripts/validate_migration_boundaries.sh` runs in CI.
- The `0001_baseline_v1` squash in 2026-04-28 confirmed the split survives
  a baseline regeneration cleanly.

## More Information

- [Migration strategy](../reference/migrations.md)
- [Constitution §III. Split Migration Ownership](../../.specify/memory/constitution.md)
