---
description: 
alwaysApply: true
---

# Project Development Guide for AI Assistants

This guide provides the essential architectural and procedural rules for working on the Prumo project. Adhere to
these instructions to ensure your contributions are consistent and correct.

## 1. Language

- **All code and project content must be written in English**: source code, comments, commit messages, documentation,
  variable/function names, and user-facing copy keys (values may be localized via i18n). No exceptions.

## 2. Core Technologies

- **Backend**: FastAPI with Python 3.11+
- **ORM**: SQLAlchemy 2.0 (async)
- **Database Migrations**: Alembic (for app schema) & Supabase CLI (for auth/storage)
- **Database**: PostgreSQL (via Supabase)
- **Frontend**: React (Vite) with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui
- **State Management**: TanStack Query (server state) & Zustand (client state)
- **Testing**: `pytest` for backend, `vitest` for frontend

## 3. Database & Migrations: A Hybrid Approach

This is the most important rule. We use two different migration systems.

- **Use Alembic for the Application Schema:**
    - **What**: All tables for the application's core features (projects, articles, assessments, etc.). These are
      defined by the SQLAlchemy models in `backend/app/models/`.
    - **Where**: Migrations are in `backend/alembic/versions/`.
    - **How**: To create a new migration, run `alembic revision --autogenerate -m "description"` inside the `backend`
      directory. To apply migrations, run `alembic upgrade head`.

- **Use Supabase Migration for Auth & Storage:**
    - **What**: Anything related to Supabase's built-in `auth` and `storage` schemas (e.g., creating storage buckets,
      defining RLS policies on buckets).
    - **Where**: Migrations are in `supabase/migrations/`.
    - **How**: Use `supabase migration new <description>`. Do not touch application tables here.

**Golden Rule**: If you are changing a SQLAlchemy model in `backend/app/models/`, you MUST use **Alembic**.

## 4. Data Seeding

- Initial data (e.g., default assessment instruments like PROBAST) is **NOT** handled in migrations.
- **Use the dedicated seed script**: `backend/app/seed.py`.
- To run it, execute `python -m backend.app.seed` from the project root.
- The script is idempotent and safe to run multiple times.

## 5. Key File Locations

- **Backend Logic**: `backend/app/`
- **SQLAlchemy Models**: `backend/app/models/`
- **Alembic Migrations**: `backend/alembic/versions/`
- **Supabase Migrations**: `supabase/migrations/`
- **Data Seeding Script**: `backend/app/seed.py`
- **Frontend Components**: `src/components/`
- **Frontend Pages**: `src/pages/`

## 6. Common Development Commands

Use the `Makefile` for most tasks.

- `make setup`: Install all dependencies for the first time.
- `make start`: Start all services (Supabase, backend, frontend).
- `make stop`: Stop all services.
- `make test-backend`: Run backend Python tests.
- `make lint-backend`: Lint and format the backend code.
- `make reset-db`: **DANGER!** Wipes the local database clean.

For a complete reference, always check the full constitution at `.specify/memory/constitution.md`.
