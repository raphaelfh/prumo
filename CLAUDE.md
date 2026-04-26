# prumo Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-26

## Active Technologies
- Python 3.11+ (backend), TypeScript strict (frontend) + FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis, Pydantic, structlog, React 18, TanStack Query, Zustand (008-unified-evaluation-model)
- PostgreSQL (`public` schema, Alembic-managed), Supabase Storage for evidence binaries (008-unified-evaluation-model)

- Python 3.11+ (backend), TypeScript strict (frontend) + FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis,
  Supabase Auth/Storage, React 18, (006-zotero-articles-sync)
- PostgreSQL `public` schema (`articles` and related domain tables) + Supabase Storage bucket `articles` (
  006-zotero-articles-sync)

- Python 3.11+ (backend), TypeScript strict (frontend) + FastAPI, SQLAlchemy 2.0 async, Celery + Redis, Supabase (auth +
  storage); React 18, Vite, TanStack Query, Zustand, shadcn/Radix (005-articles-export)
- PostgreSQL (public schema, Alembic) for articles/article_files; Supabase Storage for file binaries and export ZIPs (
  temp path or dedicated bucket) (005-articles-export)

- TypeScript (strict), React 18.3 + Vite, TanStack Query, Zustand, shadcn/Radix, react-hook-form, Zod; **i18n/copy**:
  módulo customizado em `frontend/lib/copy/` (namespaces por área, sem lib externa); ver research.md (004-frontend-i18n)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

- **Language**: All code, comments, commit messages, docs, and project text must be written in **English**.
- TypeScript (strict), React 18.3: Follow standard conventions

## Recent Changes
- 008-unified-evaluation-model: Added Python 3.11+ (backend), TypeScript strict (frontend) + FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis, Pydantic, structlog, React 18, TanStack Query, Zustand

- 006-zotero-articles-sync: Added Python 3.11+ (backend), TypeScript strict (frontend) + FastAPI, SQLAlchemy 2.0 async,
  Alembic, Celery + Redis, Supabase Auth/Storage, React 18,

- 005-articles-export: Added Python 3.11+ (backend), TypeScript strict (frontend) + FastAPI, SQLAlchemy 2.0 async,
  Celery + Redis, Supabase (auth + storage); React 18, Vite, TanStack Query, Zustand, shadcn/Radix

  react-hook-form, Zod; **i18n/copy**: módulo customizado em `frontend/lib/copy/` (namespaces por área, sem lib
  externa); ver research.md

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
