# Concept glossary (compact mirror)

This is the **only** source of vocabulary the quality loop honours. It is a compact mirror of `docs/reference/extraction-hitl-architecture.md` §6 — the architecture doc is canonical; this file is a sealed copy maintained in sync by the `check_glossary_sync.py` fitness function (Phase 4). If the two diverge, the sync canary fires.

When a scanner sees a term used in a way that contradicts this glossary, it emits a `concept-drift` finding with `glossary_term=<term>` populated.

## Modeling primitives

- **Template** — Canonical structure defining what to extract or assess. Lives in `extraction_templates_global` (shared catalogue, e.g. CHARMS, PROBAST, QUADAS-2) or `project_extraction_templates` (clone per project, customizable).
- **TemplateVersion** — Immutable snapshot of an `entity_types` + `fields` tree at a point in time. Every Run references a version; editing the template never mutates past assessments.
- **EntityType** — In extraction, a "section" (e.g. *Outcome*); in QA, a *domain* (e.g. PROBAST *Participants*). `cardinality` is `one` or `many`. The `extraction_entity_role` enum (`study_section`, `model_container`, `model_section`; migration 0016) discriminates root vs. nested types.
- **Field** — Typed variable inside an entity_type (`text/number/date/select/multiselect/boolean`), with `allowed_values`, `validation_schema`, `llm_description`.
- **Instance** — Concrete realization of an entity_type for one article. PROBAST *Participants* → 1 instance/article; CHARMS *Prediction Models* → N instances/article.
- **kind** — `extraction` vs `quality_assessment`. Discriminator on `Template` and `Run`. Coherence enforced via composite FK `Run (template_id, kind) → Template (id, kind)` + unique `(id, kind)`.

## HITL lifecycle

- **Run** — Atomic unit of HITL work; stage transitions `pending → proposal → review → consensus → finalized` (cancelled terminal at any stage). Every Run has exactly one active TemplateVersion + a `HitlConfigSnapshot`.
- **stage / status** — orthogonal axes (stage = where in the lifecycle; status = active/cancelled/finalized).
- **ProposalRecord** — Append-only proposed value. `source` ∈ {`ai`, `human`, `system`}; `source='human'` requires `source_user_id IS NOT NULL`.
- **ReviewerDecision** — Append-only per-reviewer decision: `accept_proposal` (with `proposal_record_id`), `reject`, or `edit` (with `value`).
- **ReviewerState** — Materialized snapshot of the latest `ReviewerDecision` per `(run, reviewer, instance, field)`. Upserted alongside every new decision. Composite FK `(run_id, current_decision_id)` ensures a reviewer state cannot point at a decision in a different run.
- **ConsensusDecision** — Append-only resolution when reviewers diverge. `select_existing` (arbitrator picks a reviewer decision) or `manual_override` (writes value + rationale).
- **PublishedState** — Canonical published value per `(run, instance, field)`, with integer `version` for optimistic concurrency.
- **Evidence** — Polymorphic — points at a PDF (`article_file_id`, `page`, `position`, `text_content`) AND exactly one of `proposal_record_id`/`reviewer_decision_id`/`consensus_decision_id` (enforced by CHECK constraint).

## Configuration

- **HitlConfig** — Reviewer count + consensus rule + optional arbitrator, scoped to project or template. Resolution order: template > project > system default (1 reviewer, unanimous).
- **HitlConfigSnapshot** — JSONB copy of the resolved HitlConfig at Run creation time, stored on the Run. Guarantees "what config was in effect when this decision was made?" is always answerable.
- **ConsensusRule** — `unanimous` / `majority` / `arbitrator`. Drives when consensus triggers and how it resolves.

## Legacy (fully removed — do NOT reintroduce)

These two appear verbatim in the canonical doc's §6 Legacy section. The richer 16-entry blacklist (additional dropped concepts such as `prediction_models`, `initializeArticleInstances`, `qa_*` services, etc.) lives in `legacy-patterns.md` with hard-tier enforcement via `check_legacy_concepts.py` — that file is not glossary-sync-checked because it is the canonical source for its own concepts.

- **AISuggestion** — Removed. Replaced by `ProposalRecord` (source='ai').
- **ExtractedValue** — Removed. Replaced by `ReviewerDecision` (in-flight) + `PublishedState` (canonical).

## Roles & permissions (RLS shorthand — NOT glossary-sync-checked)

These identifiers come from `docs/reference/constitution.md` and the migrations, not from §6 of the architecture doc. Their literal names are not glossary-tracked; concept-drift findings against them rely on the constitution and the migration history, not on this mirror.

- `project_members(project_id, user_id, role)` — `role ∈ {manager, reviewer, extractor}`.
- `is_project_member(project_id, user_id)` — SQL function used by every RLS policy on `extraction_*` and `project_*` tables.
- `is_project_reviewer(project_id, user_id)` — SECURITY DEFINER helper (migration 0018); relaxes workflow-table RLS so reviewers (not just managers) can write `extraction_reviewer_decisions`.

## Concept tags accepted by SCOPE

The architectural-quality-loop accepts `concept:<tag>` as a scope. Resolution table:

| Tag | Resolves to |
|---|---|
| `concept:extraction-run` | `backend/app/services/extraction_*.py`, `backend/app/api/v1/endpoints/runs*.py`, `backend/app/models/extraction*.py`, `frontend/components/extraction/**`, `frontend/services/extraction*.ts` |
| `concept:hitl-session` | `backend/app/services/hitl_session_service.py`, `backend/app/api/v1/endpoints/hitl_sessions*.py`, `frontend/services/hitlSessionService.ts`, `frontend/hooks/extraction/useHitl*.ts` |
| `concept:reviewer-decision` | `backend/app/services/reviewer_decision_service.py`, `backend/app/repositories/extraction_reviewer_*.py`, `frontend/services/extractionValueService.ts` |
| `concept:template-clone` | `backend/app/services/template_clone_service.py`, `backend/tests/integration/test_template_clone_*.py` |
| `concept:consensus` | `backend/app/services/consensus_service.py`, `frontend/components/consensus/**` |

When you add a new concept tag, append a row here.
