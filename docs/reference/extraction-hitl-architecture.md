---
status: stable
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

# Extraction-Centric HITL Architecture

> **Status:** Stable · Last reviewed: 2026-06-21 · Owner: @raphaelfh
> Canonical reference for the data-extraction and quality-assessment stack post the 2026-04-27 unification. Read this before touching anything in `extraction_*`, `extraction_runs`, the workflow tables, or the Quality-Assessment flow.

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
extract/consensus pipeline is shared.

## 2. The Run is the unit of work

A **Run** (`extraction_runs`) is the atomic HITL session for one
`(article × project_template × kind)`. Every proposal, decision, consensus
ruling, and published value belongs to exactly one Run. A Run progresses
through five stages, in this order — no skipping:

```text
pending → extract → consensus → finalized
                              ↓
                         cancelled (terminal at any non-terminal stage)
```

`stage` is the lifecycle position; `status` is the execution condition
(`pending` / `running` / `completed` / `failed`). They are orthogonal —
e.g. a Run can be `stage=extract, status=running` while the LLM is still
extracting.

When a Run is created it captures two immutable snapshots: `version_id`
(an `ExtractionTemplateVersion` row freezing the entity_types + fields
tree) and `hitl_config_snapshot` (a JSONB copy of the resolved
`reviewer_count` / `consensus_rule` / `arbitrator_id`). Editing the
template afterwards never affects existing runs.

### 2.1 User-facing vocabulary (do not leak "Run")

"Run" is internal ubiquitous language. It is correct in code, the schema,
the API (`/api/v1/runs/...`), and these docs — but it MUST NOT appear as a
**noun** in user-facing copy or toasts. End users are systematic-review
researchers; "Run" means nothing to them, whereas the tools they already
use (Covidence, DistillerSR) speak of *extraction* and *assessment*.

User-facing vocabulary is context-specific:

| Surface | Say | Not |
| --- | --- | --- |
| Quality-assessment screens | "assessment" | "Run" |
| AI suggestions panel | "AI extraction" | "Run" / "AI runs" |
| Shared (e.g. consensus settings) | phrase around "article" | "Run" |

The **verb** "to run" ("Run AI", "run assessments") is fine — only the
entity *noun* is banned. A copy regression guard
(`frontend/test/copy-run-vocabulary.test.ts`) fails if the plural noun
"Runs" reappears in any copy value. Rationale and the full string-level
change set live in
`docs/superpowers/specs/archive/2026-06-20-governance-sweep/2026-05-30-run-user-facing-vocabulary-design.md`.

### 2.2 Stage (DB) vs user-facing phase

The `extraction_run_stage` values
(`pending` / `extract` / `consensus` / `finalized` / `cancelled`)
are the **internal lifecycle**, NOT the model end users see. The UI presents
**three phases**:

| User-facing phase | DB stage(s) |
| --- | --- |
| **Extract** | `pending`, `extract` |
| **Consensus** | `consensus` |
| **Finalized** | `finalized` |

`extract` is the single editable stage (ADR-0014 collapsed the former
`proposal` + `review` into it). The AI writes `ai` proposals and humans write
their values **directly as per-user `ReviewerDecision`s** there (a `/proposals`
human write on an extraction run is rejected — blind-review write defense); there
is no `proposal → review` auto-advance and no boundary materialization. The
shared RunHeader maps `extract` to a single **Extract** node, so the rail reads
Extract → Consensus → Finalized.
The primary action is one role/phase-aware control: **"Mark ready →"** in
Extract (advances to consensus; available to every extractor since
`POST /runs/{id}/advance` is membership-gated) and **"Finalize"** in Consensus
(manager / consensus only). Design:
`docs/superpowers/specs/2026-06-20-extraction-header-refinement-design.md`.

## 3. Database — final schema

All tables live in the `public` schema with RLS enabled. Migration head:
`0029_reviewer_ready_flag` (post-squash numbering; run
`ls backend/alembic/versions/` for the current head — and bump this line
in any PR that adds an `extraction_*` migration).

### Core HITL tables (introduced pre-squash 0010 → 0012; evolving — see migration head above)

| Table | Append-only? | Purpose |
| --- | --- | --- |
| `extraction_template_versions` | No (mutable `is_active`) | Immutable schema snapshot of a project template. Unique `(project_template_id, version)`; partial unique index keeps exactly one `is_active` per template. Run references via `version_id`. |
| `extraction_hitl_configs` | No | HITL config (reviewer count, consensus rule, arbitrator) scoped to `project` or `template`. Resolution: template > project > system default. |
| `extraction_proposal_records` | **Yes** | One row per proposed value for a `(run, instance, field)` triplet. Source: `ai` / `human` / `system`. CHECK: `human` requires `source_user_id`. Append-only of *changes*: `ExtractionProposalService.record_proposal` no-ops when the value is identical to the latest row for the same coord+source(+user), so a client replaying an unchanged value (form remount, retry) doesn't grow a duplicate. |
| `extraction_reviewer_decisions` | **Yes** | One row per reviewer decision: `accept_proposal` / `reject` / `edit`. CHECKs enforce that `accept_proposal` carries a `proposal_record_id` and `edit` carries a `value`. Same idempotent-re-record rule as proposals: an unchanged decision replay (same decision+value+proposal) is a no-op. |
| `extraction_reviewer_states` | Materialized | Current `decision_id` per `(run, reviewer, instance, field)`. Upserted alongside each decision so reads are O(1). Unique `(run_id, reviewer_id, instance_id, field_id)`. |
| `extraction_consensus_decisions` | **Yes** | Conflict resolution: `select_existing` (arbitrator picks a reviewer decision) or `manual_override` (writes value + rationale directly). |
| `extraction_published_states` | Mutable with version | Canonical value per `(run, instance, field)` with optimistic concurrency. Update uses `WHERE version = :expected` so 0 rows = 409 conflict. |
| `extraction_reviewer_ready` | Upsert | Per-`(run, reviewer)` advisory "I'm done extracting" flag (`is_ready`, `marked_ready_at`). Unique `(run_id, reviewer_id)`. Does **not** gate any stage transition; surfaces the "N/M reviewers ready" hint. Added `0029` (HITL Phase 2). |

### Pre-existing tables — evolved

| Table | Notable evolution | Where |
| --- | --- | --- |
| `extraction_templates_global` | + `kind` column, unique `(id, kind)` | 0011 |
| `project_extraction_templates` | + `kind`, unique `(id, kind)` | 0011 |
| `extraction_runs` | + `kind`, `version_id` FK, `hitl_config_snapshot`; composite FK `(template_id, kind)` enforces template-run kind coherence; stage enum reconstructed | 0011 + 0014 |
| `extraction_evidence` | + `run_id`, `proposal_record_id`, `reviewer_decision_id`, `consensus_decision_id`. Legacy `target_type`/`target_id` columns dropped in 0017; CHECK now requires the workflow path. | 0013 + 0017 |

### Legacy tables — fully removed

The original 2026-04-27 cut had two transition shims (`ai_suggestions`,
`extracted_values`). Both are gone. Status today:

| Former table | Removed in | Replacement |
| --- | --- | --- |
| `ai_suggestions` | archived pre-squash migration `20260428_0019` | `extraction_proposal_records` (filter `source='ai'`) — `aiSuggestionService` reads here, derives status from the current reviewer_state. |
| `extracted_values` | Migration `0002_drop_extracted_values` | `extraction_reviewer_decisions` for per-user values, `extraction_published_states` for canonical post-consensus values. `ExtractionValueService` (frontend) wraps the read/write path. |
| `suggestion_status` enum | archived pre-squash migration `20260428_0019` | Status derived from reviewer_state's current decision (accept_proposal / edit / reject). |
| `extraction_source` enum | Migration `0002_drop_extracted_values` | `extraction_proposal_source` (ai/human/system) on ProposalRecord. |

### Enums introduced or modified

| Enum | Values | Migration |
| --- | --- | --- |
| `template_kind` | `extraction`, `quality_assessment` | 0011 |
| `hitl_config_scope_kind` | `project`, `template` | 0010 |
| `consensus_rule` | `unanimous`, `majority`, `arbitrator` | 0010 |
| `extraction_proposal_source` | `ai`, `human`, `system` | 0012 |
| `extraction_reviewer_decision` | `accept_proposal`, `reject`, `edit` | 0012 |
| `extraction_consensus_mode` | `select_existing`, `manual_override` | 0012 |
| `extraction_run_stage` (rebuilt) | `pending`, `extract`, `consensus`, `finalized`, `cancelled` | 0014, 0028 |

### RLS — workflow tables (post-0025, reviewer-scoped)

`INSERT` and `UPDATE` use `is_project_reviewer` (`manager` /
`reviewer` / `consensus` roles). `SELECT` on the reviewer-attributable
tables (`extraction_reviewer_decisions`, `extraction_reviewer_states`,
`extraction_proposal_records`) is **self-scoped** since
`0025_reviewer_scoped_select_rls` (the blind-leak fix): a member may
read a row only when (a) they authored it (`reviewer_id` /
`source_user_id` = `auth.uid()`), (b) they are a project
`manager`/`consensus` arbitrator (`is_project_arbitrator` SECURITY
DEFINER helper), or (c) the run is `finalized`. AI/system proposals
stay visible to all members. Non-attributable workflow tables keep
broad `is_project_member` SELECT.

Two read paths MUST encode the identical predicate: this RLS layer
(PostgREST/devtools path) and the service-layer filter in
`extraction_run_read_service` (API path, reached as `service_role`
which bypasses RLS). Before 0025, SELECT gated only on
`is_project_member` and blinding lived in frontend JavaScript — the
exact posture that produced the blind-review leak. Do not reintroduce
it.

**Manager blind-review (ADR 0012) — a deliberate API-stricter-than-RLS
split.** Managers are blind by default and reveal peers per kind. The
policy lives in `projects.settings.managers_see_reviewers`
(`{extraction, quality_assessment}`, both default `false`), read **live**
at request time by `extraction_run_read_service.caller_can_see_peers(
project_id, user_id, kind)`: `consensus` arbitrator → always; `manager` →
the live per-kind setting; everyone else → `false`; any `finalized` run →
all. RLS `0025` is intentionally **unchanged** — a manager stays an
arbitrator and *may* SELECT peer rows at the DB layer, but the API path
withholds them when the toggle is off. This is sound because manager
blindness is a bias-control UX policy, not a confidentiality boundary (a
manager can flip the toggle). The hard boundary — reviewer↔reviewer
blinding — remains enforced identically at **both** layers, so the
identical-predicate rule still holds for the case that matters. The toggle
is written through a focused typed endpoint
(`PUT …/manager-review-visibility`, manager-only) that sets one kind and
preserves the other.

## 4. Conceptual flow

```text
ExtractionTemplateGlobal (kind = extraction | quality_assessment)
  └─ ProjectExtractionTemplate           (per-project clone, customizable)
       └─ ExtractionTemplateVersion      (immutable snapshot, exactly one active)
            ├─ ExtractionEntityType      (cardinality ONE / MANY)
            │    └─ ExtractionField      (typed: text/number/select/multiselect/...)
            │
            └─ Article + ProjectExtractionTemplate
                 ↓ creates
                 ExtractionRun
                   ├─ stage = pending → extract → consensus → finalized
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

### 4.1 Entity type roles & hierarchy invariants

Every `extraction_entity_types` row carries a structural **role**
(`extraction_entity_role` enum, migration `0016_entity_role_column`):

| Role | Meaning | Where rendered |
| --- | --- | --- |
| `study_section` | Root entity type. Filled once per article regardless of model. | Top-level accordion in `ExtractionFormView`. |
| `model_container` | Root entity type with `cardinality='many'`. At most one per template. Drives the model selector UI. | `ModelSection` + `ModelSelector`. |
| `model_section` | Child of a `model_container`. Rendered once per active model instance. | Inside `ModelSection`, scoped to the active model. |

The role is the **single source of truth** for partitioning entity
types — the frontend's `partitionEntityTypes` helper
(`frontend/lib/extraction/entityTypeRoles.ts`) reads only the role
column; backend services look up the container via
`ExtractionEntityTypeRepository.get_by_role('model_container', ...)`.
The previous convention of matching `name = 'prediction_models'` is
gone everywhere except seed/migration files (where `name` is part of
the data, not a discriminant).

Database guarantees post 0016:

1. **At most one `model_container` per template** — partial unique
   indexes `uq_extraction_entity_types_one_container_per_global` and
   `uq_extraction_entity_types_one_container_per_project`.
2. **Role ↔ parent coherence** — CHECK constraint
   `ck_extraction_entity_types_role_parent`: `study_section` and
   `model_container` rows must have `parent_entity_type_id IS NULL`;
   `model_section` rows must have a parent.
3. **`model_section` parent must be `model_container`** — deferred
   trigger `trg_check_model_section_parent_role`. Deferred so
   `TemplateCloneService` can insert parent+children in the same
   transaction.
4. **`sort_order` is display order only** — `TemplateCloneService`
   topologically sorts before insertion (Kahn's algorithm with cycle
   detection, O(N) via `collections.deque`), so seeds and project clones
   can use any sort_order numbering (local-per-parent or globally unique)
   without breaking the clone. No more implicit "parents must sort
   before children" contract.

5. **Snapshot consistency** — `extraction_template_versions.schema_` JSONB
   snapshots include `role` for every entity_type. Migration `0017`
   backfilled the role into pre-existing snapshots by joining with the
   live entity_types (information-preserving: same data, new label),
   so any future consumer that partitions a snapshot by role works on
   every Run, not just runs created post-0016.

### 4.2 LLM prompt module pattern

Prompts that drive LLM calls live in `backend/app/llm/prompts/` — one
module per prompt. Each module exposes:

- `NAME` (str) — a stable identifier used for logging and span tagging.
- `VERSION` (12-char content hash) — auto-bumps whenever the prompt text
  changes; stamped on every Logfire span alongside `NAME` so prompt
  regressions are traceable in production.
- `render(...)` — returns the user prompt string (pure function: no I/O,
  no globals, deterministic given inputs).
- `SYSTEM_PROMPT` constant, or `system_prompt(framework)` where the
  system prompt is parameterised by the calling context.

**Structured output** is enforced by the typed call layer
(`backend/app/llm/extractor.py::extract_structured`, Pydantic AI
`NativeOutput`). There are no `*_RESPONSE_SCHEMA` JSON-schema constants
and no tolerant parsers: if the model returns structurally invalid output,
the call layer reasks (up to `DEFAULT_USAGE_LIMITS.request_limit`) and
then raises `AgentRunError`, which fails the run. Callers must catch that
exception.

**Output models** — static schemas (e.g. `ModelIdentificationOutput`) are
defined next to their prompt module. Template-driven schemas whose shape
depends on the active template version are built at runtime by
`backend/app/llm/schema.py::build_output_models`.

Unit tests for the prompt layer live in
`backend/tests/unit/llm/test_prompts.py`.

### 4.3 Project template import (extraction catalogue)

The extraction **Import template** dialog reads `extraction_templates_global` through the Supabase client (RLS). **Do not** insert `project_extraction_templates` from the frontend: a deferred trigger requires every project template to have an **active** `extraction_template_versions` row at commit time, so creation stays in the API layer.

| Step | What happens |
| ------ | ---------------- |
| **UI** | Calls `POST /api/v1/projects/{project_id}/templates/clone` with `global_template_id` and `kind=extraction` (JWT via `apiClient`). The UI may still load the global row first to validate that the id exists in the catalogue. |
| **Service** | `TemplateCloneService.clone` is **idempotent** on `(project_id, global_template_id)`: first call creates the project row, `extraction_entity_types`, `extraction_fields`, and exactly one active version; later calls return the existing clone and current counts. |
| **Heal** | If a clone row exists but has zero entity types or fields (partial/legacy data), the service rebuilds structure from the global template and updates the active version snapshot. |

Configuration flows for QA tools may call the same clone endpoint before sessions; session lifecycle for QA vs extraction is in §5.

**Production timeouts** — The SPA (e.g. on Vercel) calls the API host directly (`VITE_API_URL`). Slow clones are usually capped by **Gunicorn’s worker timeout** (defaults to **30s** if not raised): the master kills the worker while SQLAlchemy is still working, and the browser sees a timeout or connection reset. Set Gunicorn `-t` to at least the clone request budget (the production Dockerfile uses **120s** (`-t 120`)); the import client uses the same **120s** `fetch` budget.

**Performance (clone service)** — Prefer **set-based reads** and **minimal round-trips**: load all global fields for the template’s entity types in **one** `IN (...)` query instead of per–entity-type queries; combine structure **counts** into a **single** SQL statement; after a heal insert, derive counts from the in-memory tree instead of re-querying. Deeper wins later would be a DB-side `INSERT … SELECT` clone (one statement), traded off against migration and trigger complexity.

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

Both flows open a session through the unified
`POST /api/v1/hitl/sessions` endpoint:

- `kind=quality_assessment` with `global_template_id` → the backend
  clones the global PROBAST/QUADAS-2 template into the project
  (idempotent), ensures one instance per top-level domain for the
  article, and parks a Run in `extract`.
- `kind=extraction` with `project_template_id` → no clone, just opens
  or resumes a Run on the existing project template.

Every field change becomes a `human` ProposalRecord (QA keeps the shared
proposal track); "Publish assessment" advances `extract → consensus`, posts a
`manual_override` consensus per filled field (which materializes PublishedState
rows), and advances to `finalized`.

### QA / Data-extraction code reuse boundary

Both flows share the **field-level primitives** but diverge above that:

| Layer | Shared? | Where |
| --- | --- | --- |
| `FieldInput` (typed input per field) | ✅ Yes | `frontend/components/extraction/FieldInput.tsx`. Consumed by both `SectionAccordion` (extraction) and `QASectionAccordion` (QA). |
| `AssessmentShell` (PDF panel + form panel + header) | ✅ Yes (QA today; extraction page predates it) | `frontend/components/assessment/AssessmentShell.tsx`. |
| `ExtractionValueService` (find run, load/save **own** values) | ✅ Yes | `frontend/services/extractionValueService.ts`. Both flows use it for read/write of the caller's own values. It no longer reads peer values — the bespoke `loadValuesForOthers` dual-read was removed (ADR 0012). |
| `RunReviewerComparison` (server-blinded reviewer compare view) | ✅ Yes | `frontend/components/runs/RunReviewerComparison.tsx`. Both screens render it for the manager/consensus compare surface, fed by `reviewerSummary.decisionsByCoord` (from `/runs/{id}/view`) — no direct Supabase read, blind callers get no peer columns. Gated by `useComparisonPermissions(projectId, userId, kind)`. |
| `useGlobalQATemplates` / `useExtractionTemplates` | ❌ Distinct | QA needs `kind='quality_assessment'` filter; extraction operates on project clones. |
| Form panel structure | ❌ Distinct | Extraction supports multi-instance (`cardinality='many'`) + AI suggestions panel; QA is 1:1 per domain. Both now carry a per-kind assess/extract↔compare view-mode toggle that swaps in the shared `RunReviewerComparison`. Trying to unify the rest creates over-engineering. |
| Header actions | ❌ Distinct | Extraction has AI extraction triggers, full export menu; QA has Publish + finalized badge. Both expose the compare view-mode toggle (shown only when the caller may see peers). |

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
- **ConsensusRule** — `unanimous` / `majority` / `arbitrator`. Stored/frozen
  per-run config (display + CRUD only); the backend finalize path does **not**
  read it. Finalize gates are (1) `consensus_count > 0` (`EmptyFinalizeError`)
  and (2) the extraction-only required-field completeness gate (ADR-0009) — see
  `run_lifecycle_service.py`. `majority` has no vote math; `arbitrator_id` is
  consumed only for unblinding visibility.
- **managers_see_reviewers** — Per-kind manager blind-review policy on
  `projects.settings` (`{extraction, quality_assessment}`, both default
  `false` = managers blind). Read **live** by the API read path
  (`caller_can_see_peers`), not snapshotted onto the run. See §3 and ADR
  0012.

### Legacy (fully removed)

- **AISuggestion** — Old AI-suggestion table; status was mutated by
  accept/reject. Replaced by `ProposalRecord` (source=ai). Removed in
  archived pre-squash migration `20260428_0019`.
- **ExtractedValue** — Old per-user value store. Replaced by
  `ReviewerDecision` (per-user, with run-stage REVIEW required) for
  in-flight values, and `PublishedState` for canonical post-consensus
  values. Removed in migration `0002_drop_extracted_values`.

  The frontend's `ExtractionValueService`
  (`frontend/services/extractionValueService.ts`) is the single
  read/write entry point: `findActiveRun` →
  `saveValue` / `acceptProposal` / `rejectValue`.

  **Stage advance (extraction).** For `kind=extraction`, `EXTRACT` is the single
  editable stage (ADR-0014): `HITLSessionService.open_or_resume` parks the run
  there, the AI writes its `ai` proposals, and humans write their values
  **directly as per-user `ReviewerDecision`s** via `/decisions` (a human
  `/proposals` write on an extraction run is rejected — blind-review write
  defense). The collaborative surface — per-reviewer decisions, the "X/N
  reviewers" counter, the "0% until you accept" progress — therefore exists live
  in `EXTRACT`; there is **no** `proposal → review` auto-advance and **no**
  boundary materialization (both removed in ADR-0014, which superseded ADR-0010).
  AI proposals remain suggestions to accept. The user advances `EXTRACT →
  CONSENSUS` explicitly via "Mark ready"; "Run AI" is disabled once a run leaves
  `EXTRACT`.

## 7. References

- **Original design spec (immutable):**
  `docs/superpowers/specs/archive/2026-06-20-governance-sweep/2026-04-27-extraction-hitl-and-qa-design.md`
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
    and PublishedState materialization (with optimistic concurrency).
  - `app/services/template_clone_service.py` — kind-parametrized
    global → project clone (idempotent on
    `(project_id, global_template_id)`). Validates the global template's
    `kind` matches what the caller asked for.
  - `app/services/hitl_session_service.py` — one-shot HITL setup for
    both kinds: clones (QA only) + seeds top-level instances + opens
    or resumes a Run + advances to EXTRACT. Surface for
    `POST /api/v1/hitl/sessions`.
- **Frontend services:**
  - `frontend/services/extractionValueService.ts` — single entry point
    for run resolution + per-user value reads/writes.
  - `frontend/services/aiSuggestionService.ts` — AI proposals shaped
    as the legacy `AISuggestion` view; accept/reject route through
    extractionValueService.
- **Frontend hooks:** `frontend/hooks/runs/` (run-scoped TanStack Query
  hooks), `frontend/hooks/qa/` (QA-specific orchestration).
