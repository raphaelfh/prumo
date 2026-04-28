# Database schema (extraction + HITL stack)

> This file is now a stub. The schema for the extraction-centric HITL stack
> (templates, runs, proposals, decisions, consensus, published states,
> evidence, QA seeds) lives in a single canonical reference:

**👉 [`docs/architecture/extraction-hitl-architecture.md`](../architecture/extraction-hitl-architecture.md)**

Go read that. It covers:

- The full table inventory (core HITL tables, evolved tables, legacy in
  transition, enums).
- The conceptual flow from `Template` → `TemplateVersion` → `Run` →
  `Proposal` → `Decision` → `Consensus` → `PublishedState`.
- Glossary for every term (Run, Instance, kind, stage vs status,
  HitlConfigSnapshot, Domain, …).
- RLS posture for the workflow tables.
- Pointers to the migrations that built each piece.

For Alembic migration history specifically, run
`uv run alembic history --verbose` from `backend/`.

For Supabase auth/storage migrations (different system), see
`supabase/migrations/`.
