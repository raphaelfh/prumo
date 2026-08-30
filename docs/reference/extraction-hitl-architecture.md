---
status: stable
last_reviewed: 2026-08-30
owner: '@raphaelfh'
---

# Extraction-Centric HITL Architecture

> **Status:** Stable · Last reviewed: 2026-08-30 · Owner: @raphaelfh
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
             ↑__________|    ↓
      (reopen_to_extract)  cancelled (terminal at any non-terminal stage)
```

The `consensus → extract` **back-edge** is arbitrator-only and destructive:
`RunLifecycleService.reopen_to_extract`
(`POST /api/v1/runs/{id}/reopen-extraction`, `ensure_project_arbitrator`) sends a
consensus-stage extraction run back to `extract` **in place** (same run), hard-
deleting that run's `ExtractionConsensusDecision` + `ExtractionPublishedState`
rows (consensus-attached evidence cascades) while preserving reviewer
decisions/states/proposals and `reviewers_ready`. It sets `stage` directly and is
**deliberately absent from `_ALLOWED_TRANSITIONS`** so the reviewer-gated
`/advance` cannot reach it and `advance_stage` stays forward-only. Extraction
only. The discard is deliberate (constitution §IX reconciliation) and confirmed in
the UI — see [ADR-0017](../adr/0017-reopen-consensus-to-extract.md). Distinct from
the `finalized` reopen (`reopen_run` / `POST /runs/{id}/reopen`), which forks a
*new* child run.

`stage` is the lifecycle position; `status` is the execution condition
(`pending` / `running` / `completed` / `failed`). They are orthogonal —
e.g. a Run can be `stage=extract, status=running` while the LLM is still
extracting.

When a Run is created it captures two immutable snapshots: `version_id`
(an `ExtractionTemplateVersion` row freezing the entity_types + fields
tree) and `hitl_config_snapshot` (a JSONB copy of the resolved
`reviewer_count` / `consensus_rule` / `arbitrator_id`). Version rows are
immutable, but the *pin* is stage-aware: template configuration edits
republish the live structure as a new active version
(`TemplateVersionService.republish`, called by the config UI after every
section/field mutation via
`POST /projects/{id}/templates/{tid}/republish-version`), and the
republish re-pins runs still in an **editable** stage
(`pending`/`extract`) to the new version so open extraction/QA forms
render the edit. Runs in `consensus`/`finalized` keep the version they
were assessed under — editing the template never affects them.

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
shared RunHeader maps `extract` to a single node labelled **Extraction**
(extraction runs) or **Assessment** (QA runs), presented as one current-stage
chip (`RunHeader.RunStatus`) whose popover holds the 3-node timeline —
Extraction/Assessment → Consensus → Finalized — plus reviewer/divergence/role
status (design:
`docs/superpowers/specs/2026-07-02-run-header-declutter-design.md`).
The primary action is one role/phase-aware control (ADR-0015; labels renamed
2026-07-02, semantics unchanged):
**"Finish extraction"** for a reviewer in Extract (sets the advisory
per-reviewer ready flag via `POST /runs/{id}/ready` — it does **not**
advance the run),
**"Start consensus"** for a manager/consensus in Extract (advances
`extract → consensus`), and **"Approve & finalize"** for a
manager/consensus in Consensus
(`POST /runs/{id}/approve-finalize` — publishes every agreed coord then advances,
enabled only when complete and every divergence is resolved). The legacy header
`instance.status` finalize path is gone — its `extraction_instances.status` column
and `extraction_instance_status` enum were dropped in HITL Phase 3 (migration
`0030_drop_instance_status`); the run lifecycle lives solely on `extraction_runs`. Design:
`docs/superpowers/specs/2026-06-21-hitl-lifecycle-alignment-design.md`.

## 3. Database — final schema

All tables live in the `public` schema with RLS enabled. Migration head:
`0064_flatten_picots_timing` (post-squash numbering; run
`ls backend/alembic/versions/` for the current head — and bump this line
in any PR that adds an `extraction_*` migration).

**One-live-run invariant (0045).** At most ONE non-terminal run (stage in
`pending` / `extract` / `consensus`) exists per `(project_id, article_id,
template_id, kind)` — enforced by the partial unique index
`uq_one_live_extraction_run_per_coord`. "The atomic HITL session for one
(article × project_template × kind)" is therefore a DB guarantee, not
service-layer folklore: a second live run used to silently shadow the first
one's reviewer decisions on session open (the run-orphaning data-loss bug).
Standalone AI-extraction creators go through
`RunLifecycleService.resolve_or_create_extract_run` (reuse-the-live-run gate,
serialized by the `(article, template)` advisory lock); the session opener
ranks by human-work recency (`last_human_activity_order`) as
defense-in-depth. The 0045 heal cancelled pre-existing duplicate live runs
non-destructively (canonical = most recent human work; shadows flipped to
`cancelled`/`failed`, all workflow rows kept).

### Value envelope & `absent_reason` marker (ADR-0016)

Every workflow value column (`proposed_value`, decision `value`, published
`value`) is a JSONB envelope
`{"value": <typed | null>, "unit"?: <str>, "absent_reason"?: "no_information" | "not_applicable" | "not_evaluated"}`.
The value stays **type-correct** — `null` when absent, never a string sentinel.
A coded `absent_reason` sibling marks a **resolved** "no value, on purpose"
answer (the source is silent / not applicable / not evaluated) and counts as
**filled** for the finalize gate; a bare `{"value": null}` (no marker) stays
**unresolved**. `backend/app/services/value_semantics.py` is the single
emptiness oracle (enum, labels, write-time normalizer), mirrored 1:1 by
`frontend/lib/extraction/valueSemantics.ts` via a shared cross-checked test
vector. All three dispositions are opt-in per field; `no_information` was
universal until `0062_allows_no_information`, so its column defaults `true`
while its two siblings default `false` — an absent key means "the marker was
available". It is turned OFF only where the answer set already encodes the
concept as a value (PROBAST+AI's fifth signaling answer), so one concept
keeps one control. Historical in-band disposition strings
(`"No information"`, PROBAST `NI`/`NA`) were rewritten to the marker by
migration `0039_absent_reason_backfill`. Decision record:
[ADR-0016](../adr/0016-typed-absent-reason-marker.md).

### Core HITL tables (introduced pre-squash 0010 → 0012; evolving — see migration head above)

| Table | Append-only? | Purpose |
| --- | --- | --- |
| `extraction_template_versions` | No (mutable `is_active`) | Immutable schema snapshot of a project template. Unique `(project_template_id, version)`; partial unique index keeps exactly one `is_active` per template. Run references via `version_id`. |
| `extraction_hitl_configs` | No | HITL config (reviewer count, consensus rule, arbitrator) scoped to `project` or `template`. Resolution: template > project > system default. |
| `extraction_proposal_records` | **Yes** | One row per proposed value for a `(run, instance, field)` triplet. Source: `ai` / `human` / `system`. CHECK: `human` requires `source_user_id`. Append-only of *changes*: `ExtractionProposalService.record_proposal` no-ops when the value is identical to the latest row for the same coord+source(+user), so a client replaying an unchanged value (form remount, retry) doesn't grow a duplicate. |
| `extraction_reviewer_decisions` | **Yes** | One row per reviewer decision: `accept_proposal` / `reject` / `edit`. CHECKs enforce that `accept_proposal` carries a `proposal_record_id` and `edit` carries a `value`. Same idempotent-re-record rule as proposals: an unchanged decision replay (same decision+value+proposal) is a no-op. |
| `extraction_reviewer_states` | Materialized | Current `decision_id` per `(run, reviewer, instance, field)`. Upserted alongside each decision so reads are O(1). Unique `(run_id, reviewer_id, instance_id, field_id)`. |
| `extraction_consensus_decisions` | **Yes** | Conflict resolution: `select_existing` (arbitrator picks a reviewer decision) or `manual_override` (writes a value directly; rationale optional since `0032_optional_rationale`). CHECK `manual_override_complete` requires only `value` for an override. |
| `extraction_published_states` | Mutable with version | Canonical value per `(run, instance, field)` with optimistic concurrency. Update uses `WHERE version = :expected` so 0 rows = 409 conflict. |
| `extraction_reviewer_ready` | Upsert | Per-`(run, reviewer)` advisory "I'm done extracting" flag (`is_ready`, `marked_ready_at`). Unique `(run_id, reviewer_id)`. Does **not** gate any stage transition; surfaces the "N/M reviewers ready" hint. Added `0029` (HITL Phase 2). |

### Pre-existing tables — evolved

| Table | Notable evolution | Where |
| --- | --- | --- |
| `extraction_templates_global` | + `kind` column, unique `(id, kind)`; + `llm_template_instruction` TEXT NULL (CHECK ≤ 4000 — template-level general AI instruction, seeded per framework) | 0011 + 0047 |
| `project_extraction_templates` | + `kind`, unique `(id, kind)`; + `llm_template_instruction` TEXT NULL (CHECK ≤ 4000 — copied from the global on clone; snapshot emits the key only when non-NULL); + `config_draft_since` TIMESTAMPTZ NULL (B-4 draft marker — stamped by the `trg_extraction_{entity_types,fields}_mark_draft` AFTER-row triggers on any live config write, cleared only inside `TemplateVersionService.republish`'s locked section, which is now the ONLY writer of a version row. Run creation used to lazily publish a v=1 snapshot from LIVE rows when a template had no active version — publishing a pending draft under the run creator's identity, logged as least-harm. Migration 0004 heals stranded templates and then enforces the invariant with DEFERRED constraint triggers, so that state cannot exist in committed data; the lazy publisher was unreachable and has been deleted rather than guarded) | 0011 + 0047 + 0048 |
| `extraction_runs` | + `kind`, `version_id` FK, `hitl_config_snapshot`; composite FK `(template_id, kind)` enforces template-run kind coherence; stage enum reconstructed | 0011 + 0014 |
| `extraction_evidence` | + `run_id`, `proposal_record_id`, `reviewer_decision_id`, `consensus_decision_id`. Legacy `target_type`/`target_id` columns dropped in 0017; CHECK now requires the workflow path. Target FKs are `ON DELETE CASCADE` — evidence follows its sole workflow target (0044; SET NULL could never satisfy the CHECK). | 0013 + 0017 + 0044 |
| `extraction_entity_types` | Write RLS manager-gated (B-7): INSERT/UPDATE policies require `is_project_manager` (was member), both with explicit WITH CHECK, plus `template_id IS NULL` — the RLS floor against writing GLOBAL-catalogue sections (cross-tenant prompt injection via cloned `llm_description`; previously only the `template_xor` CHECK stood in the way). SELECT scoped to project members (0058): the policy is `can_read_entity_type(id, auth.uid())` — global-catalogue rows (`project_template_id IS NULL`) stay world-readable so the import dialog can list them, project-lineage rows require `is_project_member`. It was `USING (true)` with no `TO` clause and a baseline SELECT grant to `anon`, so unauthenticated callers could read every project's sections, fields and authored `llm_description`. Manager DELETE unchanged. Residual: manager JWTs can still write via PostgREST (GRANT survives) — follow-up REVOKE recorded in the 0049 docstring. + `entry_label` TEXT NULL (B-8 group entry noun — meaningful only for `role='model_container'`, backfilled `'model'` via a role-only predicate covering BOTH lineages, with the 0048 mark-draft trigger disabled during the backfill; seed stamps `"model"` on the catalogue containers; migration 0026's embedded snapshot SQL intentionally untouched — column post-dates its slot, `llm_template_instruction` precedent). | 0049 + 0051 + 0058 |
| `extraction_fields` | + `allows_not_applicable`, `allows_not_evaluated`, `allows_no_information` opt-in disposition flags (ADR-0016, the third added by 0062 with a `true` server_default because the marker was universal before it; copied into `version.schema_` by the snapshot builder); write RLS manager-gated (B-7): INSERT/UPDATE require `is_project_manager` through the et→pet chain (global lineage never joins), UPDATE gains explicit WITH CHECK; per-section name uniqueness enforced by unique index `uq_extraction_fields_entity_type_name (entity_type_id, name)` — preceded by a deterministic first-free-suffix heal of pre-existing duplicates (both lineages, 0048 trigger left ENABLED so healed templates stamp as real drift; downgrade drops the index only). SELECT scoped to project members (0058) through the SAME predicate as its parent — `can_read_entity_type(entity_type_id, auth.uid())`; a field is visible exactly when its entity type is, expressed once so the two policies cannot drift (several frontend reads select fields by `entity_type_id` alone and rely on the id list being pre-filtered). `template_field_service` remaps a 23505 on this index to the typed duplicate error. Promotion runs the duplicate + hybrid-row audit from the 0050 docstring against prod FIRST. | 0038 + 0049 + 0050 + 0058 + 0062 |

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

**Article-text input (2026-06-24).** The `article_text` passed to each
`render(...)` is no longer raw `pypdf` text truncated at 15k. The extraction
services call `build_prompt_input` (`app/services/extraction_prompt_input.py`),
which uses the **stored `article_files.content_markdown`** column directly when
it fits within `LLM_ASSEMBLY_BUDGET_TOKENS`; otherwise it falls back to
`app/llm/assembler.py::assemble_for_model` (a deterministic
`render_blocks_to_markdown` + IMRaD-aware whole-section dropping). The assembly
event is logged as `extraction.assembly` with a `source` field:
`stored_markdown` or `budgeted_blocks`. When an article has never been parsed,
`build_prompt_input` runs `PymupdfParser` **once** via `DocumentParsingService`
and persists blocks + `content_markdown` atomically — it is never re-parsed
afterward. The `pypdf` fallback (`pdf_processor.py`, `blocks_from_plain_text`,
the `pypdf` dep) has been **removed**; no unbounded-text path remains.
See ADR-0011 (block input) and ADR-0013 (stored markdown + deterministic highlight).

Unit tests for the prompt layer live in
`backend/tests/unit/llm/test_prompts.py`.

### 4.3 Project template import (extraction catalogue)

The extraction **Import template** dialog reads `extraction_templates_global` through the Supabase client (RLS). **Do not** insert `project_extraction_templates` from the frontend: a deferred trigger requires every project template to have an **active** `extraction_template_versions` row at commit time, so creation stays in the API layer.

| Step | What happens |
| ------ | ---------------- |
| **UI** | Calls `POST /api/v1/projects/{project_id}/templates/clone` with `global_template_id` and `kind=extraction` (JWT via `apiClient`). The UI may still load the global row first to validate that the id exists in the catalogue. |
| **Service** | `TemplateCloneService.clone` is **idempotent** on `(project_id, global_template_id)`: first call creates the project row, `extraction_entity_types`, `extraction_fields`, and exactly one active version; later calls return the existing clone and current counts. |
| **Heal** | Drift is measured against the **active version snapshot**, never the global template. Zero-state clones (empty live structure) rebuild from the global — **except** when the live `llm_template_instruction` differs from the one pinned in the active version, which raises `PendingConfigDraftError` (409). The rebuild resets structure but never that column, and `republish` snapshots it live, so healing would publish prompt text nobody approved — and session-open reaches this branch as any project **member**. `fail_if_pending_draft` cannot guard it: the rebuild's own inserts stamp the marker (0048, `COALESCE` with no `IS NULL` predicate), so the flag would refuse every heal; the marker alone would refuse the documented delete-everything factory recovery, whose marker is a trigger byproduct. Exit = Publish, then re-import. Non-empty drift (e.g. an edit whose republish call was lost) **self-heals by publishing the live structure** as a new version (`TemplateVersionService.republish`) — never wipe-and-rebuild: with user-editable templates a count mismatch is indistinguishable from a deliberate edit, and the historical wipe destroyed customizations. Factory recovery = delete the template and re-import. |

**File import/export (2026-08-23).** The same dialog (now "Switch template")
also lists the project's own templates — active and inactive — with *Switch
to* (`PATCH …/templates/{id}`, which since this slice deactivates the
extraction sibling first) and *Delete* (`DELETE …/templates/{id}`: guards run
under `SELECT … FOR UPDATE` — 409 `TEMPLATE_ACTIVE` / `TEMPLATE_IN_USE`, else
DB cascade plus the template-scoped `extraction_hitl_configs` row; the locked
pre-check is load-bearing because `extraction_runs` also carries a composite
CASCADE FK to the template). `GET …/templates/{id}/export` serializes the
**live** structure as a `prumo-template@1` document (`app/schemas/
template_portable.py`: nested, UUID-free, `role` derived from nesting + a
`group` flag); `POST …/templates/import` creates a **new** active template
from one and publishes v1 through `republish`. Design:
`docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md`.

**Create from scratch (2026-08-23).** `POST …/templates` (manager-gated,
`template_create_service.create_blank_template`) is the third creation path
and the one with no source: it inserts the row with **no sections** and
publishes v1, so the manager lands in the configuration editor on a
published — not permanently draft — template. It is the same tail as the
file import (deactivate the extraction sibling via
`deactivate_sibling_extraction_templates`, then `republish`), minus the
document parse and tree build. This is the path that replaced a direct
frontend insert, which could not satisfy either invariant above: it commits
alone (so the deferred trigger fires with no active version) and it cannot
deactivate the incumbent (so the partial unique index refuses it).

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
  `allowed_values=['Y','PY','PN','N']` (PROBAST; the historical `NI`/`NA`
  options are now coded dispositions — `no_information` is universal and
  `not_applicable` is the per-field opt-in flag, ADR-0016) or
  `['Y','N','Unclear']` (QUADAS-2).
- **Risk of Bias / Applicability concerns** = two summary `select`
  fields per domain, `allowed_values=['Low','High','Unclear']`. Manual for
  these two; PROBAST+AI derives them (below).
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
proposal track). As of 2026-07-09 (ADR-0018) QA mirrors the extraction stage
flow instead of a one-shot publish: reviewers signal readiness ("Finish
assessment"), an **arbitrator** opens consensus (`extract → consensus`, which
materializes reviewer decisions), resolves any divergence in the consensus
panel, and **Approve & finalize** publishes every agreed value then advances to
`finalized`. Resolving/publishing consensus (`POST /runs/{id}/consensus`) and
flipping a run to `finalized` (via `approve-finalize` or `advance`) are
arbitrator-only for **both** kinds; the earlier reviewer-level, single-click QA
"Publish assessment" is retired.

### PROBAST+AI — the third QA global

PROBAST+AI is a third `kind='quality_assessment'` catalogue row, seeded from
its own modules (`backend/app/seed_probast_ai.py` +
`backend/app/seed_probast_ai_data.py`, split off because `app.seed` sits at
its file-size ratchet cap). The seeder **converges unconditionally on every
boot**: the row is UPDATEd in place and its entity types replaced under
deterministic ids, never gated on a version compare — so a corrected spec
reaches a database that already has the row (the one skip is a loud safety
valve when recorded work references the catalogue's own entity types).
`version` is decorative display metadata, never a gate. Its signaling
questions answer Y/PY/PN/N/NI, so `allows_no_information` is off per field —
the answer set already encodes the concept, and one concept keeps one control.
The Step-2 study-type classifier is the single field that keeps the marker:
none of its three options means "the article does not say".

`project_extraction_templates.schema` (JSONB, `schema_` on the model) is a
live contract, not decoration. It carries two sibling keys:

- **`derived_judgments`** — the rollup spec. Each domain judgment gets a
  derived DEFAULT (`signaling_worst`) that the assessor may override, and the
  Step-4 overall values are computed (`worst_domain`) and never entered.
  Overriding a default with an empty rationale blocks finalize — see the
  third gate under **ConsensusRule** in §6.
- **`scope_rules`** — which sections each Step-2 study-type classification
  takes out of play, retiring the earlier `dev_`/`eval_` name-prefix
  convention.

Both are read **live** off the project template by every consumer — the
AI-path guard (`app/services/llm_field_filter.py`), progress
(`frontend/lib/qa/scopedProgress.ts` via `studyTypeScope`), export parity
(`app/services/extraction_export_service.py`) and the finalize backstop
(`app/services/qa_divergence_gate.py`) — while the entity-types tree those
same consumers walk comes from the run's FROZEN `version_id`. That
live-vs-frozen split is the non-obvious invariant to preserve here.

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
  PROBAST, PROBAST+AI, QUADAS-2) or `project_extraction_templates` (clone
  per project, customizable).
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

- **Consensus surface** — The resolve-mode compare table
  (`RunReviewerComparison` inside `ConsensusResolutionPanel`) rendered by
  both run screens during the consensus stage; adopt-or-override per
  coordinate. The earlier `ConsensusPanel` card list was deleted in #483.
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
  `manual_override` (writes a value directly; rationale optional).
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
  read it. Finalize gates are (1) `consensus_count > 0` (`EmptyFinalizeError`),
  (2) the extraction-only required-field completeness gate (ADR-0009), and (3)
  the derived-judgment rationale backstop (`DivergenceRationaleError`, via
  `qa_divergence_gate.divergence_rationale_failure`) — see
  `run_lifecycle_service.py`; all three answer 400. (1) and (2) are no longer a
  dead-end: `approve_and_finalize` (ADR-0015) publishes every agreed coord then
  advances in one transaction, so a complete run always satisfies them. (3) is
  not auto-satisfiable — it reads the run's PUBLISHED states against the
  template's `derived_judgments` spec and refuses a judgment that overrides its
  derived default with an empty rationale, so "Approve & finalize" can still
  refuse an otherwise-complete run until a manager records the rationale in
  Resolve divergence. It is data-driven and kind-neutral: a template declaring
  no `derived_judgments` exits on the first lookup, so it is inert for
  extraction. `majority` has no vote math; `arbitrator_id` is consumed only for
  unblinding visibility.
- **ReviewerReady** — advisory per-`(run, reviewer)` "I'm done extracting" flag
  (`extraction_reviewer_ready`, ADR-0015). Toggled via `POST /runs/{id}/ready`
  (membership + reviewer-role gated); does **not** gate any transition. The run
  view exposes an `N/M reviewers ready` hint (`M = max(reviewer_count, N)`).
  WHO marked ready is peer-attributable participation metadata (ADR-0012): the
  API scrubs `reviewers_ready` to the caller's own entry unless the caller is
  unblinded (`peers_revealed`); the counts stay aggregate. Single home of the
  scrub: `ExtractionReviewerReadyService.ready_summary_from`. The RLS SELECT
  (`0041`, superseding 0029's member-wide read) self-scopes with the 0025
  carve-outs (own row OR arbitrator OR finalized), so both read paths encode
  the reviewer↔reviewer boundary in lockstep.
- **managers_see_reviewers** — Per-kind manager blind-review policy on
  `projects.settings` (`{extraction, quality_assessment}`, both default
  `false` = managers blind). Read **live** by the API read path
  (`caller_can_see_peers`), not snapshotted onto the run. See §3 and ADR
  0012. **Consensus auto-reveal (ADR-0015):** independently of this toggle, an
  arbitrator (manager/consensus) is unblinded once the run reaches `consensus`
  (run-scoped, mirroring the `finalized` auto-unblind) — no toggle write; plain
  reviewers stay blind. The run payload's `peers_revealed` echoes the effective
  unblind.

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
  AI proposals remain suggestions to accept. A manager/consensus advances
  `EXTRACT → CONSENSUS` explicitly via **"Start consensus"** (ADR-0015; label
  renamed 2026-07-02); reviewers signal completion with the advisory
  **"Finish extraction"** flag (which does not advance).
  `CONSENSUS → FINALIZED` is the one-action **"Approve & finalize"**
  (`approve_and_finalize`: publish every agreed coord, then advance). "Run AI" is
  disabled once a run leaves `EXTRACT`.

## 7. References

- **Original design spec (immutable):**
  `docs/superpowers/specs/archive/2026-06-20-governance-sweep/2026-04-27-extraction-hitl-and-qa-design.md`
- **Execution plans (archived):**
  `docs/superpowers/plans/archive/2026-04-27-hitl-unification/`
- **Seeds:** `backend/app/seed.py` (`seed_probast`, `seed_quadas2`) and
  `backend/app/seed_probast_ai.py` + `backend/app/seed_probast_ai_data.py`
  (PROBAST+AI — own modules, see §5)
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
  - `app/services/qa_divergence_gate.py` — the finalize-time derived-judgment
    rationale rule; a rule module (pure `divergences_without_rationale` plus
    its async loader), not a service class like the others in this list. Its
    `_rationale_is_empty` deliberately mirrors the client's `rationaleIsEmpty`
    rather than `value_semantics.is_value_filled`, so the backstop is never
    stricter than the form that fed it.
  - `app/services/template_version_service.py` — `republish`: freezes the
    live structure into a new active `ExtractionTemplateVersion` (v+1;
    prior rows untouched) and re-pins `pending`/`extract` runs to it.
    Surface for `POST /projects/{id}/templates/{tid}/republish-version`,
    called by the config UI after every section/field edit.
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
