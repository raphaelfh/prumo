---
status: stable
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Roadmap

> **Status:** Stable · Last reviewed: 2026-06-20 · Owner: @raphaelfh

The day-to-day roadmap with status, priority, owner, and target dates lives
on the GitHub Project:

**<https://github.com/raphaelfh/prumo/projects>**

This file records only the **top-level milestones** (one bullet each) — the
"what are we aiming at this cycle?" view, not the issue tracker.

## Current cycle (2026-Q2)

- [ ] **Structured PDF parsing + grounded extraction** — layout-aware parse at ingest, page-anchored evidence, verbatim-verified citations (ADR-0011, ADR-0013).
- [ ] **Quality of extracted data** — refine extraction prompts, add evidence-linked citations, surface page-anchored references in the PDF viewer.
- [ ] **Multi-reviewer reliability** — close the open bugs around inviting reviewers, concurrent assessment, and final-reviewer assignment.
- [ ] **Provider flexibility (BYOK)** — design + ship the Bring-Your-Own-Key flow with audit + per-user rate limits.

## Recently shipped (2026-Q2)

- ✅ Stored-markdown ingestion + deterministic citation highlight — `content_markdown` written atomically with blocks (migration `0033`); PyMuPDF free default; highlight anchored by `(page, block_index)`; `pypdf` path removed (2026-06-24).
- ✅ Extraction data-path consolidation — single API read path (ADR 0007); shipped via #228/#324 (2026-06).
- ✅ Extraction-centric HITL unification (2026-04-27).
- ✅ Role column promotion + template clone topological sort (2026-05-18 → 2026-05-19).
- ✅ Render → Railway migration (2026-05-24).

## Archived

For the previous PT/EN mixed roadmap, see git history of
`docs/planos/ROADMAP.md` prior to 2026-05-24.
