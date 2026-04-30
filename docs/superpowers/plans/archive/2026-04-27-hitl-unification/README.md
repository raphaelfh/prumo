# Archived: 2026-04-27 HITL unification

These seven plans drove the 2026-04-27 refactor that merged the 008
"unified evaluation model" skeleton into the extraction-centric stack.
They were executed and shipped — keep them for historical context only.

For the **current architecture**, see
[`docs/architecture/extraction-hitl-architecture.md`](../../../../architecture/extraction-hitl-architecture.md).

For the **original design spec**, see
[`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md`](../../../specs/2026-04-27-extraction-hitl-and-qa-design.md).

## Phases (in execution order)

1. `2026-04-27-extraction-hitl-phase1a-database-foundation.md` —
   `extraction_template_versions`, `extraction_hitl_configs`, `kind` enum.
2. `2026-04-27-extraction-hitl-phase1b-workflow-tables.md` —
   ProposalRecord, ReviewerDecision, ReviewerState, ConsensusDecision,
   PublishedState.
3. `2026-04-27-extraction-hitl-phase1c-services.md` — Service layer for
   run lifecycle, proposals, decisions, consensus.
4. `2026-04-27-extraction-hitl-phase1c2-endpoints.md` — `/api/v1/runs/...`
   endpoints surface on top of the services.
5. `2026-04-27-extraction-hitl-phase1d-migration-and-drop-008.md` —
   Synthetic-Run backfill for legacy `extracted_values`; tear-down of the
   008 stack (tables, enums, code).
6. `2026-04-27-extraction-hitl-phase1e-frontend.md` — TanStack Query
   hooks against `/v1/runs/...`; first wiring of the run panel.
7. `2026-04-27-extraction-hitl-phase2-quality-assessment.md` — Seed
   PROBAST + QUADAS-2 as `kind=quality_assessment` global templates;
   QualityAssessmentFullScreen page.

## Follow-up cleanup waves (not in these plans)

- Migration 0017 dropped the legacy `extraction_evidence.target_type` /
  `target_id` columns.
- Migration 0018 added `is_project_reviewer` and relaxed workflow-table
  RLS so reviewers (not just managers) can write proposals/decisions.
- `ai_suggestions` and `extracted_values` are still alive as a transition
  shim — `section_extraction_service` mirrors every new ProposalRecord to
  `ai_suggestions` so the legacy extraction UI keeps working. Drop these
  once the frontend reads the run aggregate via `/v1/runs/{id}`.
