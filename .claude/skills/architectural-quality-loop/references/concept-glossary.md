# Concept glossary (compact mirror)

This is the **only** source of vocabulary the quality loop honours. It is a compact mirror of `docs/reference/extraction-hitl-architecture.md` §6 — the architecture doc is canonical. `scripts/fitness/check_glossary_sync.py` checks names only, one way: every `- **Term** —` bullet name here must appear verbatim somewhere in the canonical doc. Definitions are unchecked, so update them here whenever §6 changes.

When a scanner sees a term used in a way that contradicts this glossary, it emits a `concept-drift` finding with `glossary_term=<term>` populated.

## Modeling primitives

- **Template** — Canonical structure defining what to extract or assess. Lives in `extraction_templates_global` (shared catalogue, e.g. CHARMS, PROBAST, PROBAST+AI, QUADAS-2) or `project_extraction_templates` (clone per project, customizable).
- **TemplateVersion** — Immutable snapshot of an `entity_types` + `fields` tree at a point in time. Every Run references a version; editing the template never mutates past assessments.
- **EntityType** — In extraction, a "section" (e.g. *Outcome*); in QA, a *domain* (e.g. PROBAST *Participants*). `cardinality` is `one` or `many`. Hierarchy is `parent_entity_type_id` + `cardinality`; the `extraction_entity_role` enum that once discriminated root vs. nested types was dropped in 0069.
- **Field** — Typed variable inside an entity_type (`text/number/date/select/multiselect/boolean`), with `allowed_values`, `validation_schema`, `llm_description`.
- **Instance** — Concrete realization of an entity_type for one article. PROBAST *Participants* → 1 instance/article; CHARMS *Prediction Models* → N instances/article.
- **kind** — `extraction` vs `quality_assessment`. Discriminator on `Template` and `Run`. Coherence enforced via composite FK `Run (template_id, kind) → Template (id, kind)` + unique `(id, kind)`.

## HITL lifecycle

- **Consensus surface** — The resolve-mode compare table (`RunReviewerComparison` inside `ConsensusResolutionPanel`) both run screens render during the consensus stage; adopt-or-override per coordinate.
- **Run** — Atomic unit of HITL work; stage transitions `pending → extract → consensus → finalized`, plus `cancelled` (terminal at any non-terminal stage); the one back-edge is the arbitrator-only `consensus → extract` reopen (`reopen_to_extract`). Every Run has exactly one active TemplateVersion + a `HitlConfigSnapshot`.
- **stage / status** — orthogonal axes (stage = where in the lifecycle; status = execution condition `pending` / `running` / `completed` / `failed`).
- **ProposalRecord** — Append-only proposed value. `source` ∈ {`ai`, `human`, `system`}; `source='human'` requires `source_user_id IS NOT NULL`.
- **ReviewerDecision** — Append-only per-reviewer decision: `accept_proposal` (with `proposal_record_id`), `reject`, or `edit` (with `value`).
- **ReviewerState** — Materialized snapshot of the latest `ReviewerDecision` per `(run, reviewer, instance, field)`. Upserted alongside every new decision. Composite FK `(run_id, current_decision_id)` ensures a reviewer state cannot point at a decision in a different run.
- **ConsensusDecision** — Append-only resolution when reviewers diverge. `select_existing` (arbitrator picks a reviewer decision) or `manual_override` (writes a value directly; rationale optional).
- **PublishedState** — Canonical published value per `(run, instance, field)`, with integer `version` for optimistic concurrency.
- **Evidence** — Polymorphic — points at a PDF (`article_file_id`, `page`, `position`, `text_content`) AND exactly one of `proposal_record_id`/`reviewer_decision_id`/`consensus_decision_id` (enforced by CHECK constraint).
- **Extraction attempt** — One deliberate AI section extraction (`extraction_attempts`, 0075), keyed by the client `requestId`. It owns its proposals, its frozen engine and the runner identity (`owner_id`). A technical replay reuses it; a new kickoff creates a new one.
- **Generation snapshot** — The immutable, identity-free facts of one LLM call (engine, prompt version and composition, params, tokens, modes), stored on each proposal that call produced. Legacy proposals have none.

## Configuration

- **HitlConfig** — Reviewer count + consensus rule + optional arbitrator, scoped to project or template. Resolution order: template > project > system default (1 reviewer, unanimous).
- **HitlConfigSnapshot** — JSONB copy of the resolved HitlConfig at Run creation time, stored on the Run. Guarantees "what config was in effect when this decision was made?" is always answerable.
- **ConsensusRule** — `unanimous` / `majority` / `arbitrator`. Stored/frozen per-run config for display and CRUD only: the finalize path never reads it (its gates live in `run_lifecycle_service.py`), `majority` has no vote math, and `arbitrator_id` only drives unblinding.
- **ReviewerReady** — Advisory per-`(run, reviewer)` "I'm done extracting" flag (`extraction_reviewer_ready`, ADR-0015), set via `POST /runs/{id}/ready`; gates no transition. The API scrubs `reviewers_ready` to the caller's own entry unless the caller is unblinded (`peers_revealed`).
- **managers_see_reviewers** — Per-kind manager blind-review policy on `projects.settings` (`{extraction, quality_assessment}`, both default `false` = managers blind), read live by `caller_can_see_peers`, not snapshotted onto the run. Independently, an arbitrator is unblinded once the run reaches `consensus` (ADR-0015).

## Legacy (fully removed — do NOT reintroduce)

These two appear verbatim in the canonical doc's §6 Legacy section. The richer 16-entry blacklist (additional dropped concepts such as `prediction_models`, `initializeArticleInstances`, `qa_*` services, etc.) lives in `legacy-patterns.md`; `check_legacy_concepts.py` blocks only entries #1, #2 and #4 (hard tier) and reports the rest. That file is not glossary-sync-checked because it is the canonical source for its own concepts.

- **AISuggestion** — Removed. Replaced by `ProposalRecord` (source='ai').
- **ExtractedValue** — Removed. Replaced by `ReviewerDecision` (in-flight) + `PublishedState` (canonical).

## Roles & permissions (RLS shorthand — NOT glossary-sync-checked)

These identifiers come from `docs/reference/constitution.md` and the migrations, not from §6 of the architecture doc. Their literal names are not glossary-tracked; concept-drift findings against them rely on the constitution and the migration history, not on this mirror.

- `project_members(project_id, user_id, role)` — `role ∈ {manager, reviewer, viewer, consensus}`.
- `is_project_member(project_id, user_id)` — SQL function used by every RLS policy on `extraction_*` and `project_*` tables.
- `is_project_reviewer(project_id, user_id)` — SECURITY DEFINER helper (added by `archive/20260428_0018_is_project_reviewer_rls.py`; live definition in `baseline_v1.sql`); relaxes workflow-table RLS so reviewers (not just managers) can write `extraction_reviewer_decisions`.

## Concept tags accepted by SCOPE

The architectural-quality-loop accepts `concept:<tag>` as a scope. Resolution table:

| Tag | Resolves to |
|---|---|
| `concept:extraction-run` | `backend/app/services/extraction_*.py`, `backend/app/api/v1/endpoints/extraction_runs.py`, `backend/app/models/extraction*.py`, `frontend/components/extraction/**`, `frontend/services/extraction*.ts` |
| `concept:hitl-session` | `backend/app/services/hitl_session_service.py`, `backend/app/api/v1/endpoints/hitl_sessions*.py`, `frontend/services/extractionRunService.ts`, `frontend/hooks/extraction/useExtractionSession.ts`, `frontend/hooks/qa/useQAAssessmentSession.ts` |
| `concept:reviewer-decision` | `backend/app/services/extraction_review_service.py`, `backend/app/repositories/extraction_reviewer_*.py`, `frontend/services/extractionRunService.ts` |
| `concept:template-clone` | `backend/app/services/template_clone_service.py`, `backend/tests/integration/test_template_clone_*.py` |
| `concept:consensus` | `backend/app/services/extraction_consensus_service.py`, `frontend/components/runs/Consensus*.tsx` |

When you add a new concept tag, append a row here.
