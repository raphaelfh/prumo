# Extraction-Centric HITL Architecture

> Canonical reference for Prumo's data-extraction and quality-assessment
> stack post the 2026-04-27 unification. Read this before touching anything
> in `extraction_*`, `extraction_runs`, the workflow tables, or the
> Quality-Assessment flow.

## 1. Why this exists

Prumo originally had two parallel stacks: `extraction_*` for structured
data extraction (CHARMS templates, AI suggestions, reviewer/consensus) and
the 008 "unified evaluation model" skeleton for quality-assessment
(PROBAST, QUADAS-2). They duplicated workflow concepts (proposals,
decisions, consensus, published state) under different schemas, which made
it impossible to share UI, services, or audit infrastructure.

The 2026-04-27 refactor merged them into a single extraction-centric stack
with a `kind` discriminator — `extraction` vs `quality_assessment` — so a
PROBAST domain is just an `entity_type` with `kind=quality_assessment`,
its signaling questions are `extraction_fields`, and the entire
proposal/review/consensus pipeline is shared.

## 2. The Run is the unit of work

A **Run** (`extraction_runs`) is the atomic HITL session for one
`(article × project_template × kind)`. Every proposal, decision, consensus
ruling, and published value belongs to exactly one Run. A Run progresses
through six stages, in this order — no skipping:

```
pending → proposal → review → consensus → finalized
                                         ↓
                                    cancelled (terminal at any non-terminal stage)
```

`stage` is the lifecycle position; `status` is the execution condition
(`pending` / `running` / `completed` / `failed`). They are orthogonal —
e.g. a Run can be `stage=proposal, status=running` while the LLM is still
extracting.

When a Run is created it captures two immutable snapshots: `version_id`
(an `ExtractionTemplateVersion` row freezing the entity_types + fields
tree) and `hitl_config_snapshot` (a JSONB copy of the resolved
`reviewer_count` / `consensus_rule` / `arbitrator_id`). Editing the
template afterwards never affects existing runs.

## 3. Database — final schema

All tables live in the `public` schema with RLS enabled. Migration head:
`20260428_0018`.

### Core HITL tables (introduced 0010 → 0012, evolved through 0018)

| Table | Append-only? | Purpose |
|---|---|---|
| `extraction_template_versions` | No (mutable `is_active`) | Immutable schema snapshot of a project template. Unique `(project_template_id, version)`; partial unique index keeps exactly one `is_active` per template. Run references via `version_id`. |
| `extraction_hitl_configs` | No | HITL config (reviewer count, consensus rule, arbitrator) scoped to `project` or `template`. Resolution: template > project > system default. |
| `extraction_proposal_records` | **Yes** | One row per proposed value for a `(run, instance, field)` triplet. Source: `ai` / `human` / `system`. CHECK: `human` requires `source_user_id`. |
| `extraction_reviewer_decisions` | **Yes** | One row per reviewer decision: `accept_proposal` / `reject` / `edit`. CHECKs enforce that `accept_proposal` carries a `proposal_record_id` and `edit` carries a `value`. |
| `extraction_reviewer_states` | Materialized | Current `decision_id` per `(run, reviewer, instance, field)`. Upserted alongside each decision so reads are O(1). Unique `(run_id, reviewer_id, instance_id, field_id)`. |
| `extraction_consensus_decisions` | **Yes** | Conflict resolution: `select_existing` (arbitrator picks a reviewer decision) or `manual_override` (writes value + rationale directly). |
| `extraction_published_states` | Mutable with version | Canonical value per `(run, instance, field)` with optimistic concurrency. Update uses `WHERE version = :expected` so 0 rows = 409 conflict. |

### Pre-existing tables — evolved

| Table | Notable evolution | Where |
|---|---|---|
| `extraction_templates_global` | + `kind` column, unique `(id, kind)` | 0011 |
| `project_extraction_templates` | + `kind`, unique `(id, kind)` | 0011 |
| `extraction_runs` | + `kind`, `version_id` FK, `hitl_config_snapshot`; composite FK `(template_id, kind)` enforces template-run kind coherence; stage enum reconstructed | 0011 + 0014 |
| `extraction_evidence` | + `run_id`, `proposal_record_id`, `reviewer_decision_id`, `consensus_decision_id`. Legacy `target_type`/`target_id` columns dropped in 0017; CHECK now requires the workflow path. | 0013 + 0017 |

### Legacy tables — fully removed

The original 2026-04-27 cut had two transition shims (`ai_suggestions`,
`extracted_values`). Both are gone. Status today:

| Former table | Removed in | Replacement |
|---|---|---|
| `ai_suggestions` | Migration `20260428_0019` (now in archive) | `extraction_proposal_records` (filter `source='ai'`) — `aiSuggestionService` reads here, derives status from the current reviewer_state. |
| `extracted_values` | Migration `0002_drop_extracted_values` | `extraction_reviewer_decisions` for per-user values, `extraction_published_states` for canonical post-consensus values. `ExtractionValueService` (frontend) wraps the read/write path. |
| `suggestion_status` enum | Migration `20260428_0019` (archived) | Status derived from reviewer_state's current decision (accept_proposal / edit / reject). |
| `extraction_source` enum | Migration `0002_drop_extracted_values` | `extraction_proposal_source` (ai/human/system) on ProposalRecord. |

### Enums introduced or modified

| Enum | Values | Migration |
|---|---|---|
| `template_kind` | `extraction`, `quality_assessment` | 0011 |
| `hitl_config_scope_kind` | `project`, `template` | 0010 |
| `consensus_rule` | `unanimous`, `majority`, `arbitrator` | 0010 |
| `extraction_proposal_source` | `ai`, `human`, `system` | 0012 |
| `extraction_reviewer_decision` | `accept_proposal`, `reject`, `edit` | 0012 |
| `extraction_consensus_mode` | `select_existing`, `manual_override` | 0012 |
| `extraction_run_stage` (rebuilt) | `pending`, `proposal`, `review`, `consensus`, `finalized`, `cancelled` | 0014 |

### RLS — workflow tables (post-0018)

`SELECT` and `DELETE` use `is_project_member` (broad, read-only).
`INSERT` and `UPDATE` use `is_project_reviewer` (`manager` /
`reviewer` / `consensus` roles), introduced in 0018 — pre-0018 these
were locked to `is_project_manager`, which would have blocked legitimate
reviewer writes in production.

## 4. Conceptual flow

```
ExtractionTemplateGlobal (kind = extraction | quality_assessment)
  └─ ProjectExtractionTemplate           (per-project clone, customizable)
       └─ ExtractionTemplateVersion      (immutable snapshot, exactly one active)
            ├─ ExtractionEntityType      (cardinality ONE / MANY)
            │    └─ ExtractionField      (typed: text/number/select/multiselect/...)
            │
            └─ Article + ProjectExtractionTemplate
                 ↓ creates
                 ExtractionRun
                   ├─ stage = pending → proposal → review → consensus → finalized
                   ├─ version_id (frozen)
                   ├─ hitl_config_snapshot (frozen)
                   │
                   ├─ ExtractionInstance       (1 per (article × entity_type) for ONE; N for MANY)
                   ├─ ExtractionProposalRecord (append-only, source: ai/human/system)
                   ├─ ExtractionReviewerDecision (append-only)
                   ├─ ExtractionReviewerState  (materialized current decision)
                   ├─ ExtractionConsensusDecision (append-only, when reviewers diverge)
                   ├─ ExtractionPublishedState (canonical, optimistic version)
                   └─ ExtractionEvidence       (polymorphic FK → proposal/decision/consensus)
```

## 5. Quality-Assessment specifics

QA reuses every primitive — there are no QA-specific tables. PROBAST and
QUADAS-2 are seeded as `extraction_templates_global` rows with
`kind='quality_assessment'` (`backend/app/seed.py:seed_probast` and
`seed_quadas2`). Their structure:

- **Domain** = an `EntityType` (Participants, Predictors, Outcome,
  Analysis, Overall), all `cardinality='one'`.
- **Signaling question** = a `Field` of type `select`, with
  `allowed_values=['Y','PY','PN','N','NI','NA']` (PROBAST) or
  `['Y','N','Unclear']` (QUADAS-2).
- **Risk of Bias / Applicability concerns** = two summary `select`
  fields per domain, `allowed_values=['Low','High','Unclear']`. Manual in
  V1; auto-rollup is v2.
- **Overall** = a special domain (`cardinality='one'`) with
  `overall_risk_of_bias` + `overall_applicability` summary fields.

The QA frontend opens an assessment session via
`POST /api/v1/qa-assessments` (project_id, article_id, global_template_id):
the backend clones the global template into the project, ensures one
instance per domain for the article, and parks a Run in `proposal`. Every
field change becomes a `human` ProposalRecord; "Publish assessment"
advances `proposal → review → consensus`, posts a `manual_override`
consensus per filled field (which materializes PublishedState rows), and
advances to `finalized`.

### QA / Data-extraction code reuse boundary

Both flows share the **field-level primitives** but diverge above that:

| Layer | Shared? | Where |
|---|---|---|
| `FieldInput` (typed input per field) | ✅ Yes | `frontend/components/extraction/FieldInput.tsx`. Consumed by both `SectionAccordion` (extraction) and `QASectionAccordion` (QA). |
| `AssessmentShell` (PDF panel + form panel + header) | ✅ Yes (QA today; extraction page predates it) | `frontend/components/assessment/AssessmentShell.tsx`. |
| `ExtractionValueService` (find run, load/save values) | ✅ Yes | `frontend/services/extractionValueService.ts`. Both flows use it for read/write. |
| `useGlobalQATemplates` / `useExtractionTemplates` | ❌ Distinct | QA needs `kind='quality_assessment'` filter; extraction operates on project clones. |
| Form panel structure | ❌ Distinct | Extraction supports multi-instance (`cardinality='many'`) + AI suggestions panel; QA is 1:1 per domain. Trying to unify these creates over-engineering. |
| Header actions | ❌ Distinct | Extraction has AI extraction triggers, view-mode toggle, full export menu. QA has Publish + finalized badge. |

**Rule of thumb:** if you're adding behaviour that touches a *single field*
(rendering, validation, evidence), put it in the shared primitive
(`FieldInput` or the value service). If it touches *flow* (multi-instance,
publish, AI), keep it in the page-specific component.

## 6. Glossary

### Modeling primitives

- **Template** — Canonical structure defining what to extract or assess.
  Lives in `extraction_templates_global` (shared catalogue, e.g. CHARMS,
  PROBAST, QUADAS-2) or `project_extraction_templates` (clone per project,
  customizable).
- **TemplateVersion** — Immutable snapshot of an `entity_types` + `fields`
  tree at a point in time. Every Run references a version, so editing the
  template never mutates past assessments.
- **EntityType** — In extraction, a "section" (e.g. *Outcome*); in QA, a
  *domain* (e.g. PROBAST *Participants*). `cardinality` is `one`
  (single instance per article) or `many`.
- **Field** — Typed variable inside an entity_type
  (`text/number/date/select/multiselect/boolean`), with
  `allowed_values`, `validation_schema`, `llm_description`.
- **Instance** — Concrete realization of an entity_type for one article.
  PROBAST *Participants* → 1 instance/article; CHARMS *Prediction Models*
  → N instances/article.
- **kind** — `extraction` vs `quality_assessment`. Discriminator on
  `Template` and `Run`. Coherence enforced via composite FK `Run
  (template_id, kind) → Template (id, kind)` plus unique `(id, kind)`.

### HITL lifecycle

- **Run** — *Atomic unit of HITL work* (see §2).
- **stage / status** — orthogonal axes (see §2).
- **ProposalRecord** — Append-only proposed value. `source=human`
  requires `source_user_id`.
- **ReviewerDecision** — Append-only per-reviewer decision:
  `accept_proposal` (with `proposal_record_id`), `reject`, or `edit`
  (with `value`).
- **ReviewerState** — Materialized snapshot pointing at the latest
  `ReviewerDecision` per `(run, reviewer, instance, field)`. Upserted
  alongside every new decision.
- **ConsensusDecision** — Append-only resolution when reviewers diverge.
  `select_existing` (arbitrator picks a reviewer decision) or
  `manual_override` (writes value + rationale).
- **PublishedState** — Canonical published value per `(run, instance,
  field)`, with an integer `version` for optimistic concurrency.
- **Evidence** — Polymorphic — points at a PDF (article_file_id, page,
  position, text_content) and at exactly one of
  `proposal_record_id`/`reviewer_decision_id`/`consensus_decision_id`.

### Configuration

- **HitlConfig** — Reviewer count + consensus rule + optional arbitrator,
  scoped to a project or a template. Resolution: template > project >
  system default (1 reviewer, unanimous).
- **HitlConfigSnapshot** — JSONB copy of the resolved HitlConfig at Run
  creation time, stored on the Run. Guarantees that "what config was in
  effect when this decision was made?" is always answerable.
- **ConsensusRule** — `unanimous` / `majority` / `arbitrator`. Drives
  when consensus triggers and how it resolves.

### Legacy (fully removed)

- **AISuggestion** — Old AI-suggestion table; status was mutated by
  accept/reject. Replaced by `ProposalRecord` (source=ai). Removed in
  migration `20260428_0019`.
- **ExtractedValue** — Old per-user value store. Replaced by
  `ReviewerDecision` (per-user, with run-stage REVIEW required) for
  in-flight values, and `PublishedState` for canonical post-consensus
  values. Removed in migration `0002_drop_extracted_values`.

  The frontend's `ExtractionValueService`
  (`frontend/services/extractionValueService.ts`) is the single
  read/write entry point: `findActiveRun` → `loadValuesForUser` /
  `saveValue` / `acceptProposal` / `rejectValue`. AI extraction
  auto-advances the Run from PROPOSAL → REVIEW after recording proposals
  so the form can write decisions immediately.

## 7. References

- **Original design spec (immutable):**
  `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md`
- **Execution plans (archived):**
  `docs/superpowers/plans/archive/2026-04-27-hitl-unification/`
- **Seeds:** `backend/app/seed.py` (`seed_probast`, `seed_quadas2`)
- **Reusable services:**
  - `app/services/run_lifecycle_service.py` — Run create + advance_stage
    with precondition matrix; lazy v=1 TemplateVersion creation.
  - `app/services/extraction_proposal_service.py` — append-only proposals
    with stage / coherence checks.
  - `app/services/extraction_review_service.py` — reviewer decisions
    (the per-user value store now flows through here).
  - `app/services/extraction_consensus_service.py` — consensus resolution
    + PublishedState materialization (with optimistic concurrency).
  - `app/services/qa_template_clone_service.py` — global → project clone
    (idempotent on `(project_id, global_template_id)`).
  - `app/services/qa_assessment_session_service.py` — one-shot QA setup
    (clone + instances + Run + advance to PROPOSAL).
- **Frontend services:**
  - `frontend/services/extractionValueService.ts` — single entry point
    for run resolution + per-user value reads/writes.
  - `frontend/services/aiSuggestionService.ts` — AI proposals shaped
    as the legacy `AISuggestion` view; accept/reject route through
    extractionValueService.
- **Frontend hooks:** `frontend/hooks/runs/` (run-scoped TanStack Query
  hooks), `frontend/hooks/qa/` (QA-specific orchestration).
