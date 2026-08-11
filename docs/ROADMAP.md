---
status: stable
last_reviewed: 2026-08-10
owner: '@raphaelfh'
---

# Roadmap

> **Status:** Stable · Last reviewed: 2026-08-10 · Owner: @raphaelfh

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

## Deferred to a future spec

Carved out of the template-config redesign (`docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`, §5). The backend half shipped — the server owns which model runs, the engine is frozen per run, and provenance records the resolved engine plus whose key paid. What remains is the surface, which needs its own spec rather than a slice:

- [ ] **Engine catalogue + model picker** — a server-curated list (3–6 models per provider; never free text, never a model `build_model` rejects), with plain-language labels, context window, cost tier, and the canonical `provider:model` string that provenance carries. BYOK-only providers render locked with an "Add your key" CTA rather than visible-but-failing. Retired entries must preserve stored strings while blocking new runs.
- [ ] **Per-project engine setting** — `projects.settings.llm_engine` owned by a service, with one attribution line ("Model changed by …"), not an audit trail.
- [ ] **Fast / Verified mode** — segmented selector; `Verified` (extract → independent verify) is the second pass. The enum and provenance key should land with the selector so records stay stable before the verify pass exists.

Two follow-ups from §5.1/§7 depend on the above and are deferred with them: reviewer-facing engine surfaces with trigger-time key resolution, and the per-field "Probe with another model" side-artifact.

## Recently shipped (2026-Q2)

- ✅ Table-cell + figure citations — native fitz table-cell grid with cell-scoped entailment (migration `0036`); `figure` region blocks + a "Verify manually" badge for ungroundable values (migration `0037`); P3/P4 of the grounded-extraction citation work (2026-06-29).
- ✅ Stored-markdown ingestion + deterministic citation highlight — `content_markdown` written atomically with blocks (migration `0033`); PyMuPDF free default; highlight anchored by `(page, block_index)`; `pypdf` path removed (2026-06-24).
- ✅ Extraction data-path consolidation — single API read path (ADR 0007); shipped via #228/#324 (2026-06).
- ✅ Extraction-centric HITL unification (2026-04-27).
- ✅ Role column promotion + template clone topological sort (2026-05-18 → 2026-05-19).
- ✅ Render → Railway migration (2026-05-24).

## Archived

For the previous PT/EN mixed roadmap, see git history of
`docs/planos/ROADMAP.md` prior to 2026-05-24.
