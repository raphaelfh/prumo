---
status: archived
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Archived: legacy spec-kit specifications

> **Status:** Archived 2026-05-24. Frozen — do not edit.

Between 2025-Q4 and 2026-04, prumo used the
[spec-kit](https://github.com/github/spec-kit) format under `/specs/` for
feature specifications. Each feature carried `spec.md`, `plan.md`, `tasks.md`,
`data-model.md`, `research.md`, and `quickstart.md`.

From 2026-04-27 onwards, the project consolidated on the
**superpowers** specification format (single `<date>-<slug>-design.md` per
feature, with execution captured separately in `docs/superpowers/plans/`).

The legacy specs below are preserved for historical context. They reflect the
state of the project at the time they were written; **do not treat them as
current**. For the up-to-date architecture, see
[`docs/reference/extraction-hitl-architecture.md`](../../../../reference/extraction-hitl-architecture.md).

## Inventory

| # | Slug | Status | Notes |
|---|---|---|---|
| 001 | alembic-migrations | Shipped | Backend Alembic adoption |
| 002 | ai-assessment-flow | Shipped | Original AI assessment pipeline (largely superseded by HITL refactor) |
| 003 | fix-assessment-sync | Shipped | Sync bug fix |
| 004 | frontend-i18n | Shipped | In-house i18n module (`frontend/lib/copy/`) |
| 005 | articles-export | Shipped | Excel articles export |
| 006 | zotero-articles-sync | Shipped | Zotero integration |
| 007 | (placeholder) | Cancelled | See `007-cancelled-placeholder.md` |
| 008 | unified-evaluation-model | **Cancelled** | Stack dropped in the 2026-04-27 HITL unification (migration `0016_drop_008_stack`). Replaced by the extraction-centric stack with `kind=quality_assessment`. |
| 009 | extraction-excel-export | Shipped | Excel extraction export |

## Where new specs live

`docs/superpowers/specs/<date>-<slug>-design.md`.
