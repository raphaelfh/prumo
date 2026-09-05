---
status: stable
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Roadmap

> **Status:** Stable · Last reviewed: 2026-09-05 · Owner: @raphaelfh

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

Carved out of the template-config redesign (`docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`, §5). The backend half shipped first (server-owned model, per-run engine freeze, key-scope provenance), and **the §5 surface shipped as C1b** (`docs/superpowers/plans/2026-08-17-c1b-engine-surface.md`): the server-curated catalogue + model picker, the per-project `projects.settings.llm_engine` setting with its one-line attribution, retired-engine blocking (typed 409), and the Fast/Verified selector — **Verified now live** (execution pass shipped 2026-08-17), with the mode enum and `mode_requested`/`mode_executed` provenance keys recorded. Still deferred to their own spec:

- [x] **Verified mode execution** — shipped 2026-08-17 (`docs/superpowers/plans/2026-08-17-verified-mode.md`): the second same-engine pass annotates each AI value with a `confirmed`/`unsupported`/`uncertain` verdict chip; per-section provenance records `mode_requested`/`mode_executed`/`passes`, degrading to Fast honestly on verify failure.
- [x] **Alternates + custom endpoints (§5, C2)** — shipped 2026-08-18 (`docs/superpowers/plans/2026-08-17-template-config-c2-alternates-endpoints.md`): manager-curated alternate engines on the stored engine spine (storage + popover only — trigger-time resolution stays §5.1), and project-scoped custom OpenAI-compatible endpoints (`project_llm_endpoints`, migration `0055`) with a day-one SSRF guard, per-row Fernet shared keys, a save-time capabilities probe, and endpoint-backed engines that fail a run with a typed `LLM_ENDPOINT_UNAVAILABLE` rather than falling back to cloud. A local Ollama evaluation (`docs/superpowers/plans/2026-08-17-ollama-local-eval.md`) exercised the path end to end: it found that `output_mode` does not predict extraction success, so self-hosted local inference stays undocumented as a supported path and the §10 SaaS posture is unchanged.
- [ ] **Reviewer surfaces + trigger-time resolution (§5.1) and the per-field "Probe with another model" side-artifact (§7)** — the per-article cost preview lands with this trigger-time UX.

## Future cycles — designed, not started

- [ ] **Screening workflow + imports** — the inclusion/exclusion stage prumo
  does not have. Articles currently go from import straight to extraction /
  quality assessment, with no PRISMA flow tracking and no dual-review
  consensus on screening decisions. Designed in
  [`docs/superpowers/specs/2026-05-03-screening-and-imports-design.md`](superpowers/specs/2026-05-03-screening-and-imports-design.md):
  a greenfield, per-project-optional `screening_*` module reusing the
  extraction HITL/consensus pattern, with AI seams (single-article verdict,
  active-learning prioritization, stop criteria) present but deferred. It
  supersedes the closed PR #7 and records why that attempt was rejected.
  **Nothing is implemented** — verified 2026-08-30 against production.

## Recently shipped (2026-Q2)

- ✅ Entry-group identity + follow-up train — every repeating section is an entry group with a versioned entry key (`is_entity_key`, migrations `0059`/`0066`/`0067`) and a required entry noun (migration `0068`); AI identification, resolution and extraction once per entry; typed `MISSING_ENTITY_KEY` refusal; the manual add dialog asks for the key only; rename/re-key with append-only history; identity E2E on a dedicated fixture project (2026-09-03 → 2026-09-05, #798–#812). Next: the entry-group trees spec (`docs/superpowers/specs/2026-09-03-entry-group-trees-design.md`).
- ✅ PICOT in the AI context — the project's structured review question (`projects.picots_config_ai_review`) now renders into every LLM call as a `Review question and scope:` block, pinned per run under `results.provenance.review_context`; one editor behind a manager-gated `PUT /projects/:id/ai-context`, plus the AI-instruction editor QA templates never had (migration `0064`) (2026-08-30).
- ✅ Table-cell + figure citations — native fitz table-cell grid with cell-scoped entailment (migration `0036`); `figure` region blocks + a "Verify manually" badge for ungroundable values (migration `0037`); P3/P4 of the grounded-extraction citation work (2026-06-29).
- ✅ Stored-markdown ingestion + deterministic citation highlight — `content_markdown` written atomically with blocks (migration `0033`); PyMuPDF free default; highlight anchored by `(page, block_index)`; `pypdf` path removed (2026-06-24).
- ✅ Extraction data-path consolidation — single API read path (ADR 0007); shipped via #228/#324 (2026-06).
- ✅ Extraction-centric HITL unification (2026-04-27).
- ✅ Role column promotion + template clone topological sort (2026-05-18 → 2026-05-19).
- ✅ Render → Railway migration (2026-05-24).

## Archived

For the previous PT/EN mixed roadmap, see git history of
`docs/planos/ROADMAP.md` prior to 2026-05-24.
