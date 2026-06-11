---
status: stable
last_reviewed: 2026-06-10
owner: '@raphaelfh'
---

# Roadmap

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

The day-to-day roadmap with status, priority, owner, and target dates lives
on the GitHub Project:

**<https://github.com/raphaelfh/prumo/projects>**

This file records only the **top-level milestones** (one bullet each) — the
"what are we aiming at this cycle?" view, not the issue tracker.

## Current cycle (2026-Q2)

- [ ] **Extraction data-path consolidation** — single API read path (ADR 0007): retire dual Supabase-REST reads, server-composed run views, fitness-enforced. Approved 2026-06-07; phases in `docs/superpowers/plans/2026-06-08-runopen-slowload-phase*.md`.
- [ ] **Quality of extracted data** — refine extraction prompts, add evidence-linked citations, surface page-anchored references in the PDF viewer.
- [ ] **Multi-reviewer reliability** — close the open bugs around inviting reviewers, concurrent assessment, and final-reviewer assignment.
- [ ] **Provider flexibility (BYOK)** — design + ship the Bring-Your-Own-Key flow with audit + per-user rate limits.

## Recently shipped (2026-Q2)

- ✅ Extraction-centric HITL unification (2026-04-27).
- ✅ Role column promotion + template clone topological sort (2026-05-18 → 2026-05-19).
- ✅ Render → Railway migration (2026-05-24).

## Archived

For the previous PT/EN mixed roadmap, see git history of
`docs/planos/ROADMAP.md` prior to 2026-05-24.
