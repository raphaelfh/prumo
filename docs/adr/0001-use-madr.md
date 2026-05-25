---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0001'
---

# Use MADR 4.0 for Architecture Decision Records

> **Status:** Accepted · Date: 2026-05-24 · Deciders: @raphaelfh

## Context and Problem Statement

The project has accumulated significant architectural decisions
(Alembic-vs-Supabase migration split, HITL `kind` discriminator,
Render→Railway hosting, AGPL-3.0 licensing, quality autoloop). Today these
are scattered across `CLAUDE.md`, plan files, and commit messages. Future
contributors (human or AI) cannot easily answer "why was X done this way?"
without trawling the entire history.

## Decision

Adopt **MADR 4.0** (<https://adr.github.io/madr/>) as the canonical format.

- Location: `docs/adr/NNNN-kebab-title.md` with monotonically-increasing
  zero-padded numbers.
- Template: `docs/adr/0000-template.md`.
- Status lifecycle: `proposed` → `accepted` → `deprecated` / `superseded by NNNN`.

## Consequences

- Good — Every important decision has one stable, citable location.
- Good — New contributors discover rationale without trawling history.
- Good — Supersession links keep the historical record intact.
- Neutral — Adds one more file to write per decision; mitigated by the template.

## Validation

By 2026-Q3, every architectural decision discussed in `CLAUDE.md` "Recent
Changes" must have a corresponding ADR. The frontmatter check enforces
ADRs carry the required keys.
