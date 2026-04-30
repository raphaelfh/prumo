# Design: Extraction-Centric HITL Unification + Quality Assessment

**Date:** 2026-04-27
**Branch:** `claude/strange-wiles-a189ef`
**Phases covered:** Phase 1 (HITL absorption into extraction) + Phase 2 (Quality Assessment as `kind` discriminator)

## 1. Context

Two parallel evaluation models exist today:

- **Extraction stack** (`backend/app/models/extraction.py`): rich data model with multi-instance entities (`ExtractionCardinality.MANY`), hierarchical templates, typed fields. Production data exists. Lacks first-class multi-reviewer HITL — `ExtractedValue` has `source`/`confidence_score`/`is_consensus` columns but only one canonical value per `(instance, field)`.
- **Unified Evaluation Model 008** (`backend/app/models/evaluation_*.py`): skeleton infrastructure designed for HITL (proposal → review → consensus → published) but only flat 1:1 `target × item` shape. No production data (per `docs/unified-evaluation-clean-slate.md`). Frontend partially stubbed (`UnifiedReviewQueueTable`, `UnifiedConsensusPanel`).

Quality Assessment is missing entirely — the legacy stack was dropped in `backend/alembic/versions/20260426_0009_drop_legacy_assessment_stack.py`. The roadmap (`docs/planos/ROADMAP.md`, line 130) explicitly calls for: *"Redesenhar a seção de risk of bias assessment - Copiar da seção de extraction e ver se podemos copiar ou usar as tabelas de extraction"*.

## 2. Decision

**Unify around extraction.** Drop 008. Absorb HITL workflow into the extraction stack. Add Quality Assessment (PROBAST + QUADAS-2) as `kind=quality_assessment` reusing the entire stack.

## 3. Foundational decisions (locked in brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Storage strategy for QA | **(A) Single schema with `kind` discriminator** | Cleanest for development; queries are simple; no real isolation requirements that justify parallel tables. |
| Partitioning by `kind` | **No** | Data scale (hundreds of thousands of rows per project, not 10M+); queries always filter by `project_id` + `template_id`; physical partitioning costs (composite PKs, fragile FKs, vacuum fragmentation) outweigh negligible gains. |
| Where `kind` lives | **`Template` (canonical) + `Run` (denormalized)** | Most operational queries hit `Run` first; denormalization cheap there. Other tables (`Instance`, `Value`, `Evidence`, ...) derive via FK chain. |
| `kind` coherence | **Composite FK** `Run (template_id, kind) → Template (id, kind)` with unique index on `Template (id, kind)` | Declarative; no triggers required. |
| Reviewer model | **(B) Configurable per project** with **(C) project default + template override** | PROBAST has its own scientific norms (typically 2 + arbitrator); plain extraction may be lighter. Override-by-template aligns with reality. |
| HITL config snapshot | **At Run creation, immutable for that Run** | Avoids "what config was active when this decision was made?" ambiguity. |
| AI in HITL | **`ProposalRecord` source, not a reviewer** | Standard Covidence/008 pattern; reviewers always own decisions. |
| Approach | **(1) Big Bang** | 008 is dev-only; drop is cheap. Extraction has prod data but the synthetic-Run migration preserves it. |
| PDF panel default | **Collapsed (`useState(false)`)** | Per user UX preference; applies to extraction and QA. |
| TemplateVersion | **Immutable; Run snapshots version on creation** | Prevents retroactive template changes from breaking old Runs. |
| Evidence | **Polymorphic record linked to `(run, item)` + optional `(proposal | reviewer_decision | consensus_decision)`** | Aligns with 008's polymorphic design without duplicating tables. |
| Consensus rules | `unanimous`, `majority`, `arbitrator` (chosen by HITL config) | Covers Covidence/Rayyan-style flows. |
| Stage advance | **Explicit user action**, with auto-advance when all reviewers complete and consensus rule satisfied without conflict | Predictable UX; no surprises. |
| PROBAST/QUADAS rollup | **Manual in MVP** (reviewer marks domain ROB and overall ROB); auto-suggest is v2 | Keeps MVP focused. |

## 4. Phase 1 — Data Model Changes

### 4.1 `kind` discriminator

- Enum: `template_kind` = (`extraction`, `quality_assessment`).
- New columns:
  - `extraction_templates_global.kind`
  - `project_extraction_templates.kind`
  - `extraction_runs.kind`
- All other tables (`extraction_entity_types`, `extraction_fields`, `extraction_instances`, `extracted_values`, `extraction_evidence`, `ai_suggestions`) **do not** carry `kind` — derivable via FK chain.
- Coherence enforced by composite FK `extraction_runs (template_id, kind) → project_extraction_templates (id, kind)` plus unique index `(id, kind)` on `project_extraction_templates`.

### 4.2 `extraction_template_versions` (new table)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| project_template_id | uuid FK → `project_extraction_templates.id` | CASCADE |
| version | int | unique with `project_template_id` |
| schema | jsonb | snapshot of entity_types + fields at publish time |
| published_at | timestamptz | server_default now() |
| published_by | uuid FK → `profiles.id` | RESTRICT |
| is_active | bool | only one active per template |

- `extraction_runs` gains `version_id` FK (NOT NULL).

### 4.3 `extraction_hitl_configs` (new table)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| scope_kind | enum (`project`, `template`) | |
| scope_id | uuid | references `projects.id` or `project_extraction_templates.id` (logical FK; constrained per scope_kind) |
| reviewer_count | int | ≥ 1 |
| consensus_rule | enum (`unanimous`, `majority`, `arbitrator`) | |
| arbitrator_id | uuid FK → `profiles.id` | nullable; required when `consensus_rule = arbitrator` |
| created_at, updated_at | timestamptz | |

- Resolution at Run creation: if a `template`-scoped config exists, use it; else use `project`-scoped; else system default (1 reviewer, unanimous).
- Resolved config is **snapshot-copied** to `extraction_runs.hitl_config_snapshot` JSONB (immutable for that Run).

### 4.4 `extraction_proposal_records` (new table, append-only)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK → `extraction_runs.id` | CASCADE; indexed |
| instance_id | uuid FK → `extraction_instances.id` | CASCADE; indexed |
| field_id | uuid FK → `extraction_fields.id` | RESTRICT |
| source | enum (`ai`, `human`, `system`) | |
| source_user_id | uuid FK → `profiles.id` | nullable; required when `source = human` |
| proposed_value | jsonb | |
| confidence_score | numeric | nullable |
| rationale | text | nullable |
| created_at | timestamptz | server_default now() |

- Replaces ad-hoc `ai_suggestions` for new flows. `ai_suggestions` table remains read-only for historical reference; new code writes only to `extraction_proposal_records`.

### 4.5 `extraction_reviewer_decisions` (new table, append-only)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK | CASCADE |
| instance_id | uuid FK | CASCADE |
| field_id | uuid FK | RESTRICT |
| reviewer_id | uuid FK → `profiles.id` | RESTRICT |
| decision | enum (`accept_proposal`, `reject`, `edit`) | |
| proposal_record_id | uuid FK → `extraction_proposal_records.id` | nullable; required when `decision = accept_proposal` |
| value | jsonb | nullable; required when `decision = edit` |
| rationale | text | nullable |
| created_at | timestamptz | |

- Composite index `(run_id, reviewer_id, instance_id, field_id, created_at desc)` for "latest decision" queries.

### 4.6 `extraction_reviewer_states` (new table, materialized current state)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK | CASCADE |
| reviewer_id | uuid FK | RESTRICT |
| instance_id | uuid FK | CASCADE |
| field_id | uuid FK | RESTRICT |
| current_decision_id | uuid FK → `extraction_reviewer_decisions.id` | RESTRICT |
| last_updated | timestamptz | |

- Unique `(run_id, reviewer_id, instance_id, field_id)`.
- Maintained by app on each new decision (upsert pattern).

### 4.7 `extraction_consensus_decisions` (new table, append-only)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK | CASCADE |
| instance_id | uuid FK | CASCADE |
| field_id | uuid FK | RESTRICT |
| consensus_user_id | uuid FK → `profiles.id` | arbitrator/owner |
| mode | enum (`select_existing`, `manual_override`) | |
| selected_decision_id | uuid FK → `extraction_reviewer_decisions.id` | nullable; required when `mode = select_existing` |
| value | jsonb | nullable; required when `mode = manual_override` |
| rationale | text | required when `mode = manual_override` |
| created_at | timestamptz | |

### 4.8 `extraction_published_states` (new table, canonical with optimistic concurrency)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| run_id | uuid FK | CASCADE |
| instance_id | uuid FK | CASCADE |
| field_id | uuid FK | RESTRICT |
| value | jsonb | |
| published_at | timestamptz | |
| published_by | uuid FK | RESTRICT |
| version | int | optimistic lock; increments on update |

- Unique `(run_id, instance_id, field_id)`.
- Updates use `WHERE version = :expected_version`; conflicts return 409.
- Replaces `extracted_values` for new lifecycle. Existing `extracted_values` are migrated as `version=1` published states under synthetic Runs.

### 4.9 `extraction_evidence` (evolved in place — table name kept)

Existing table evolves; **no rename** (avoids breaking references). New columns added:

| column | type | notes |
|---|---|---|
| run_id | uuid FK → `extraction_runs.id` | NOT NULL after migration |
| proposal_record_id | uuid FK | nullable |
| reviewer_decision_id | uuid FK | nullable |
| consensus_decision_id | uuid FK | nullable |

- CHECK constraint: at least one of `(proposal_record_id, reviewer_decision_id, consensus_decision_id)` is set, OR legacy `target_type/target_id` populated (for backward compat during migration window).
- After migration completes and all reads/writes flow through new columns, drop `target_type/target_id` in a follow-up migration.

### 4.10 Run lifecycle changes

`extraction_runs.stage` enum migrated to: `pending`, `proposal`, `review`, `consensus`, `finalized`, `cancelled`.

Mapping from old enum values to new:

| old value | new value | reason |
|---|---|---|
| `data_suggest` | `proposal` | AI suggestion stage = proposal generation |
| `parsing` | `proposal` | PDF/text parsing happens before review; treated as proposal sub-stage |
| `validation` | `review` | Human validation = reviewer decisions |
| `consensus` | `consensus` | preserved 1:1 |

`extraction_runs.kind` and `extraction_runs.version_id` added (see 4.1, 4.2). `extraction_runs.hitl_config_snapshot` JSONB added (see 4.3).

`status` enum unchanged: `pending`, `running`, `completed`, `failed`, `cancelled`.

## 5. Phase 1 — Data Migration

Migration is split into a **sequence of Alembic revisions** (granular for rollback and testing). Each revision has its own migration tests.

1. **`00XX_template_versions_and_hitl_configs.py`** — create `extraction_template_versions`, `extraction_hitl_configs`. Backfill v1 snapshot for each existing `project_extraction_template`. Add `extraction_runs.version_id` (nullable initially), backfill, then NOT NULL.
2. **`00XX_kind_discriminator.py`** — add `kind` enum column to `extraction_templates_global`, `project_extraction_templates`, `extraction_runs` (nullable initially with default `extraction`). Backfill explicitly. Apply NOT NULL. Add unique index `(id, kind)` on templates. Add composite FK `extraction_runs (template_id, kind) → project_extraction_templates (id, kind)`.
3. **`00XX_proposal_and_review_tables.py`** — create `extraction_proposal_records`, `extraction_reviewer_decisions`, `extraction_reviewer_states`, `extraction_consensus_decisions`, `extraction_published_states`. No backfill (new lifecycle starts empty for new Runs).
4. **`00XX_evidence_evolution.py`** — add `run_id`, `proposal_record_id`, `reviewer_decision_id`, `consensus_decision_id` columns to `extraction_evidence`. Add CHECK constraint allowing legacy `target_type/target_id` during transition. Backfill `run_id` where derivable.
5. **`00XX_run_stage_enum_migration.py`** — alter `extraction_run_stage` enum to new values (`pending`, `proposal`, `review`, `consensus`, `finalized`, `cancelled`). Map old values per §4.10. Add `extraction_runs.hitl_config_snapshot` JSONB.
6. **`00XX_synthetic_runs_for_extracted_values.py`** — for each existing `extracted_values`: ensure a Run exists for that `(article_id, project_template_id)` (create synthetic if missing, `stage=finalized`, `status=completed`), then write `extraction_published_states` row (`version=1`).
7. **`00XX_drop_008_stack.py`** — drop tables and enums per `docs/unified-evaluation-clean-slate.md`. Pre-drop scan asserts no FKs from outside reference these tables.

Code-side (not Alembic):
- Drop 008 endpoints (`/v1/evaluation-*`).
- Drop 008 frontend stubs (refactor `UnifiedReviewQueueTable` and `UnifiedConsensusPanel` to consume new `/v1/runs/...` endpoints rather than 008).
- Mark `extracted_values` and `ai_suggestions` as deprecated in code comments; remove all writes (reads kept temporarily for any historical UIs).

Migration tests verify:

- All pre-migration `extracted_values` count == post-migration `extraction_published_states` count.
- All pre-migration `project_extraction_templates` count == count of templates with at least one `extraction_template_versions` row.
- No orphan `extraction_evidence` rows after migration.

## 6. Phase 1 — Backend Services

New services under `backend/app/services/`:

- `hitl_config_service.py` — resolve project + template config; produce snapshot.
- `run_lifecycle_service.py` — create Run (snapshots config), advance stage with precondition checks, finalize.
- `proposal_service.py` — record AI/system/human proposals; query by run/item.
- `review_service.py` — record reviewer decisions; maintain `reviewer_states` upsert; detect conflicts.
- `consensus_service.py` — resolve conflicts (select existing or manual override); publish to `published_states` with optimistic concurrency.

Refactored:

- `model_extraction_service.py`, `section_extraction_service.py` — write proposals into `extraction_proposal_records` instead of directly populating `extracted_values`. Existing call sites updated.

Dropped:

- `evaluation_*` services (008 stack).

## 7. Phase 1 — Backend Endpoints

New under `/v1/runs`:

- `POST /v1/runs` — body `{ project_id, article_id, project_template_id }`; creates Run, snapshots HITL config, creates initial Instances per template.
- `GET /v1/runs/{id}` — returns full state (instances, fields, proposals, reviewer states, consensus, published).
- `POST /v1/runs/{id}/proposals` — body `{ instance_id, field_id, source, proposed_value, confidence_score?, rationale? }`.
- `POST /v1/runs/{id}/decisions` — body `{ instance_id, field_id, decision, proposal_record_id?, value?, rationale? }`.
- `POST /v1/runs/{id}/consensus` — body `{ instance_id, field_id, mode, selected_decision_id?, value?, rationale? }`.
- `POST /v1/runs/{id}/advance` — explicit stage advance with precondition checks.

Existing extraction endpoints (`/v1/model_extraction`, `/v1/section_extraction`) preserved but refactored to call new services and produce `ProposalRecord` entries.

Dropped: `/v1/evaluation-runs`, `/v1/evaluation-schema-versions`, `/v1/evaluation-review`, `/v1/evaluation-consensus`.

## 8. Phase 1 — Frontend

### 8.1 Shared shell

- New: `frontend/components/assessment/AssessmentShell.tsx` — split layout (PDF panel left, form panel right via `ResizablePanel`), header, error boundary, navigation. Accepts `kind`, `runId`, child components for form rendering.
- New: `frontend/hooks/usePdfPanel.ts` — encapsulates PDF panel state. **`initialOpen` defaults to `false`** (PDF starts collapsed).
- Existing `ExtractionPDFPanel` is moved into `frontend/components/assessment/AssessmentPDFPanel.tsx` and used by both extraction and QA.

### 8.2 Pages

- Refactored: `frontend/pages/ExtractionFullScreen.tsx` → consumes `AssessmentShell` with `kind=extraction`. PDF starts collapsed (line 77 changed from `useState(true)` to using `usePdfPanel({ initialOpen: false })`).
- New: `frontend/pages/QualityAssessmentFullScreen.tsx` → consumes `AssessmentShell` with `kind=quality_assessment`.
- Routes:
  - `/projects/:projectId/articles/:articleId/extraction`
  - `/projects/:projectId/articles/:articleId/quality-assessment`

### 8.3 Form rendering

- Extraction form: existing `SectionAccordion`, `EntityTreeNode`, `FieldInput` reused, fed by new lifecycle hooks.
- QA form: new `QASectionAccordion` per domain, with signaling questions inline. Domain ROB and overall ROB rendered as summary cards. New components in `frontend/components/assessment/qa/`.

### 8.4 HITL UI

- `UnifiedReviewQueueTable` and `UnifiedConsensusPanel` refactored to consume new `/v1/runs/...` endpoints. Same place, new wiring.
- New: `frontend/components/assessment/ProposalIndicator.tsx` — shows AI proposal next to each field with confidence chip.
- New: `frontend/components/assessment/ReviewerConflictBadge.tsx` — appears when reviewer decisions diverge.

### 8.5 Hooks

- `useRun(runId)` — fetches full run state.
- `useProposals(runId)` — list/create proposals.
- `useReviewerDecisions(runId, reviewerId)` — list/create decisions.
- `useConsensus(runId)` — list/create consensus decisions.
- `useHitlConfig(projectId, templateId?)` — resolves effective config (for UI display only; server is source of truth).

## 9. Phase 2 — Quality Assessment

### 9.1 Seed data

`backend/app/seed.py` extended (idempotent, safe to re-run):

**PROBAST template** (`kind=quality_assessment`, framework=`CUSTOM`):

- 4 entity_types (domains, `cardinality=ONE`, `is_required=true`):
  - Participants
  - Predictors
  - Outcome
  - Analysis
- Per domain, signaling questions as `select` fields with `allowed_values=["Y", "PY", "PN", "N", "NI", "NA"]`. (Exact question list embedded from the published PROBAST tool.)
- Per domain, two summary fields: `risk_of_bias` (`select`, `["Low", "High", "Unclear"]`), `applicability_concerns` (`select`, `["Low", "High", "Unclear"]`).
- Top-level fields (cardinality=ONE entity called "Overall"): `overall_risk_of_bias`, `overall_applicability`.

**QUADAS-2 template** (`kind=quality_assessment`, framework=`CUSTOM`):

- 4 entity_types (domains): Patient Selection, Index Test, Reference Standard, Flow & Timing.
- Signaling questions as `select` fields with `allowed_values=["Y", "N", "Unclear"]`.
- Per domain: `risk_of_bias` and `applicability_concerns` (same enum as PROBAST).
- Top-level "Overall" entity with `overall_risk_of_bias` and `overall_applicability`.

Both templates are seeded as `extraction_templates_global` with `kind=quality_assessment`. Projects clone via existing template-cloning flow into `project_extraction_templates`.

### 9.2 UX specifics

- Domain accordion: collapsed by default, one expandable at a time (or all expandable — implementation choice during build).
- Signaling questions rendered inline within each domain.
- Per-domain ROB and applicability rendered at end of domain section as summary card.
- Overall ROB and applicability rendered as final card.
- AI proposal indicator appears next to each signaling question when proposals exist.
- Reviewer disagreement indicator appears when consensus stage is active and reviewer decisions diverge.

### 9.3 What's reused (no new code)

- 100% of HITL backend stack.
- All HITL frontend hooks and components (`AssessmentShell`, PDF panel, evidence linking, proposal display, reviewer queue, consensus panel).
- Only QA-specific seed data and form rendering layer is new.

## 10. Out of scope (explicit)

- Auto-suggest domain ROB and overall ROB from signaling answers (v2).
- AI confidence-threshold-based auto-acceptance (v2).
- Multi-instance for QA (PROBAST/QUADAS are 1:1 per article; if ever needed, the existing `cardinality=MANY` handles it for free).
- Real-time multi-reviewer sync via LISTEN/NOTIFY or Supabase Realtime (architecture supports; implementation v2).
- Migrating production data of any kind beyond what the synthetic-Run script does (development reset model only, per `docs/unified-evaluation-clean-slate.md`).
- pgvector / semantic similarity over evidence (radar, not scope).

## 11. Testing strategy

Per durable user feedback (`memory/feedback_always_test.md`): tests written **alongside** each layer, not deferred.

### Backend

- **Unit (pytest)**: per model (constraints, defaults), per repository (CRUD + edge cases), per service (state transitions, conflict detection), per API (auth, validation, response envelope).
- **Integration (pytest)**: full Run lifecycle for `kind=extraction` and `kind=quality_assessment` with reviewer counts 1 and 2+arbitrator. Conflict scenarios. Optimistic concurrency conflicts (409).
- **Migration tests (pytest)**:
  - Pre-migration `extracted_values` count == post-migration `extraction_published_states` count.
  - Synthetic Run creation preserves all field values.
  - 008 drop leaves no orphans (no FKs pointing to dropped tables).

### Frontend

- **Unit (vitest)**: hooks (`useRun`, `useProposals`, `useReviewerDecisions`, `useConsensus`, `useHitlConfig`, `usePdfPanel`).
- **Component (vitest + RTL)**: `AssessmentShell`, `QASectionAccordion`, `ProposalIndicator`, `ReviewerConflictBadge`. Coverage of PDF panel default-collapsed.

### E2E (playwright)

- Extraction full lifecycle, single reviewer.
- Extraction full lifecycle, 2 reviewers + arbitrator, with intentional conflict resolved at consensus.
- QA (PROBAST) full lifecycle, single reviewer.
- QA (QUADAS-2) full lifecycle, 2 reviewers + arbitrator.
- PDF panel starts collapsed, toggles open, persists choice within session.
- Project HITL config + template override resolution (verify Run snapshots template config when present).
- Optimistic concurrency: two reviewers race to publish; one wins, other gets 409.

## 12. Build sequence (high level)

1. **Foundation migrations**: `extraction_template_versions`, `extraction_hitl_configs`, `kind` discriminator, composite FK + unique index. Tests for each.
2. **Workflow migrations**: proposal, reviewer_decisions, reviewer_states, consensus, published_states, evidence_records refactor. Tests for each.
3. **Drop 008 stack** (after foundation/workflow stable). Tests verifying no orphans.
4. **Backend services** in order: `hitl_config` → `run_lifecycle` → `proposal` → `review` → `consensus`. Unit tests interleaved per service.
5. **Migration script** for existing extraction data → synthetic Runs + published_states. Migration test suite.
6. **Refactor existing extraction services** (`model_extraction_service`, `section_extraction_service`) to write through new lifecycle. Regression tests.
7. **New `/v1/runs/...` endpoints** with auth, validation, response envelope. API tests.
8. **Drop 008 endpoints** and 008 frontend stubs.
9. **Frontend `AssessmentShell` + `usePdfPanel`** (PDF default collapsed). Vitest tests.
10. **Refactor `ExtractionFullScreen`** to use shell. Component + E2E test.
11. **PROBAST + QUADAS-2 seed data**. Seed idempotency test.
12. **`QualityAssessmentFullScreen` page + QA form rendering**. Component test.
13. **HITL UI refactor** (reviewer queue, consensus panel) on new endpoints. Component + E2E test.
14. **E2E playwright suite** covering all flows.

Each step has accompanying tests written alongside implementation; tests are not batched at the end.

## 13. Risks and mitigations

- **Risk**: existing extraction data corrupted by synthetic-Run migration.
  - **Mitigation**: dry-run migration on dev DB first; row-count assertions; rollback transaction if any check fails.
- **Risk**: 008 drop leaves dangling FKs in unrelated tables we missed.
  - **Mitigation**: explicit pre-drop scan via `pg_catalog.pg_constraint` listing all FKs targeting 008 tables; tested in migration suite.
- **Risk**: composite FK on `(template_id, kind)` slows writes.
  - **Mitigation**: unique index `(id, kind)` on template is small (few hundred rows); negligible write overhead.
- **Risk**: reviewer state materialization race condition (two decisions arriving concurrently).
  - **Mitigation**: upsert with `INSERT ... ON CONFLICT (run_id, reviewer_id, instance_id, field_id) DO UPDATE` keyed by `last_updated`; latest write wins.
- **Risk**: optimistic-concurrency conflicts on `published_states` cause confusing UX.
  - **Mitigation**: 409 response includes the current `version` and `published_by`; frontend shows clear "another reviewer just published; refresh and retry" toast.
- **Risk**: scope creep into v2 features (auto-rollup, real-time sync) during implementation.
  - **Mitigation**: spec lists out-of-scope explicitly; plan tasks reference this section.

## 14. Open questions (to resolve in implementation plan, not blocking spec approval)

- Exact PROBAST signaling-question wording — pull from canonical published PROBAST 2019 paper.
- Exact QUADAS-2 signaling-question wording — pull from published QUADAS-2 tool.
- Whether `usePdfPanel` should persist open/collapsed in localStorage or session-only (UX call).
- Auth/RLS policy for new tables (mirror existing extraction RLS by `project_id`).

## 15. References

- `backend/app/models/extraction.py` — current extraction model.
- `backend/app/models/evaluation_*.py` — 008 stack to drop.
- `backend/alembic/versions/20260426_0008_unified_evaluation_model_skeleton.py` — 008 migration to reverse.
- `backend/alembic/versions/20260426_0009_drop_legacy_assessment_stack.py` — historical legacy QA drop.
- `docs/unified-evaluation-clean-slate.md` — clean-slate guide for 008 drop.
- `docs/planos/ROADMAP.md` line 130 — original mandate to copy extraction structure for QA.
- `frontend/pages/ExtractionFullScreen.tsx:77` — PDF panel state to flip default.
- `frontend/components/extraction/` — components to migrate into shared shell.
- `frontend/components/assessment/` — current 008 frontend stubs to refactor.
- `memory/feedback_always_test.md` — testing requirement at every layer.
