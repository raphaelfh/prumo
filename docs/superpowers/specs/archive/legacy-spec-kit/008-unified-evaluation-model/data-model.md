# Data Model: Unified Evaluation Data Model

## Relationship Overview

- `evaluation_schemas` 1:N `evaluation_schema_versions`
- `evaluation_schema_versions` 1:N `evaluation_items`
- `evaluation_runs` N:1 `evaluation_schema_versions`
- `evaluation_runs` N:M `evaluation_targets` (through `evaluation_run_targets`)
- `proposal_records` N:1 (`evaluation_runs`, `evaluation_targets`, `evaluation_items`)
- `reviewer_decision_records` N:1 (`evaluation_runs`, `evaluation_targets`, `evaluation_items`, `proposal_records`)
- `reviewer_states` unique per (`reviewer_id`, `target_id`, `item_id`, `schema_version_id`)
- `consensus_decision_records` N:1 (`evaluation_targets`, `evaluation_items`, `schema_version_id`)
- `published_states` unique per (`project_id`, `target_id`, `item_id`, `schema_version_id`)
- `evidence_records` polymorphic links to proposal/reviewer/consensus/published entities

## Entities

## 1) EvaluationSchema

- Purpose: Top-level business schema identity for a project/domain.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `name` (text, required)
  - `description` (text, nullable)
  - `created_by` (UUID, required)
  - `created_at` (timestamptz, required)
- Validation:
  - `(project_id, name)` unique for active schemas.

## 2) EvaluationSchemaVersion

- Purpose: Immutable snapshot used during evaluation runs.
- Fields:
  - `id` (UUID, PK)
  - `schema_id` (UUID, FK -> evaluation_schemas.id)
  - `version_number` (int, required)
  - `status` (enum: `draft|published|archived`)
  - `published_at` (timestamptz, nullable)
  - `published_by` (UUID, nullable)
  - `created_at` (timestamptz, required)
- Validation:
  - `(schema_id, version_number)` unique.
  - Published versions are immutable.

## 3) EvaluationItem

- Purpose: Atomic evaluable field/question.
- Fields:
  - `id` (UUID, PK)
  - `schema_version_id` (UUID, FK -> evaluation_schema_versions.id)
  - `item_key` (text, required)
  - `label` (text, required)
  - `description` (text, nullable)
  - `item_type` (enum: `text|number|boolean|date|choice_single|choice_multi`)
  - `options_json` (jsonb, nullable; required for choice types)
  - `required` (bool, default false)
  - `sort_order` (int, required)
  - `is_deleted` (bool, default false)
- Validation:
  - `(schema_version_id, item_key)` unique for non-deleted rows.
  - Item type immutable once extraction exists for the version.

## 4) EvaluationRun

- Purpose: Unified operational context for proposal -> review -> publish lifecycle.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `schema_version_id` (UUID, FK)
  - `name` (text, required)
  - `status` (enum: `pending|active|completed|failed|cancelled`)
  - `current_stage` (enum: `proposal|review|consensus|finalized`)
  - `started_by` (UUID, required)
  - `started_at` (timestamptz, required)
  - `completed_at` (timestamptz, nullable)
  - `failed_reason` (text, nullable)
- Validation:
  - Status transitions are controlled and append-only in run events.

## 5) EvaluationRunTarget

- Purpose: Links targets selected for a run.
- Fields:
  - `id` (UUID, PK)
  - `run_id` (UUID, FK -> evaluation_runs.id)
  - `target_id` (UUID, indexed)
  - `target_type` (text, required)
  - `created_at` (timestamptz, required)
- Validation:
  - `(run_id, target_id)` unique.

## 6) ProposalRecord

- Purpose: Append-only proposed value per target-item.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `run_id` (UUID, FK)
  - `target_id` (UUID, indexed)
  - `item_id` (UUID, FK)
  - `schema_version_id` (UUID, FK)
  - `source_type` (enum: `ai|human|system`)
  - `value_json` (jsonb, required)
  - `confidence` (numeric, nullable)
  - `created_by` (UUID, nullable)
  - `created_at` (timestamptz, required)
- Validation:
  - Immutable after insert.

## 7) ReviewerDecisionRecord

- Purpose: Append-only reviewer action history.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `run_id` (UUID, FK)
  - `target_id` (UUID, indexed)
  - `item_id` (UUID, FK)
  - `schema_version_id` (UUID, FK)
  - `reviewer_id` (UUID, required)
  - `proposal_id` (UUID, FK, nullable)
  - `decision` (enum: `accept|reject|edit`)
  - `edited_value_json` (jsonb, nullable; required for `edit`)
  - `rationale` (text, nullable)
  - `created_at` (timestamptz, required)
- Validation:
  - Immutable after insert.

## 8) ReviewerState

- Purpose: Materialized current state per reviewer and item.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `reviewer_id` (UUID, indexed)
  - `target_id` (UUID, indexed)
  - `item_id` (UUID, FK)
  - `schema_version_id` (UUID, FK)
  - `latest_decision_id` (UUID, FK -> reviewer_decision_records.id)
  - `latest_decision` (enum: `accept|reject|edit`)
  - `updated_at` (timestamptz, required)
- Validation:
  - Unique key on `(reviewer_id, target_id, item_id, schema_version_id)`.

## 9) ConsensusDecisionRecord

- Purpose: Auditable final decision event.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `target_id` (UUID, indexed)
  - `item_id` (UUID, FK)
  - `schema_version_id` (UUID, FK)
  - `run_id` (UUID, FK, nullable)
  - `decision_maker_id` (UUID, required)
  - `mode` (enum: `select_existing|manual_override`)
  - `selected_reviewer_decision_id` (UUID, FK, nullable)
  - `override_value_json` (jsonb, nullable; required for override)
  - `override_justification` (text, nullable; required for override)
  - `created_at` (timestamptz, required)
- Validation:
  - Override mode requires non-empty justification.

## 10) PublishedState

- Purpose: Single authoritative state for downstream reads.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `target_id` (UUID, indexed)
  - `item_id` (UUID, FK)
  - `schema_version_id` (UUID, FK)
  - `latest_consensus_decision_id` (UUID, FK -> consensus_decision_records.id)
  - `published_value_json` (jsonb, required)
  - `published_status` (enum: `published|superseded`)
  - `published_at` (timestamptz, required)
- Validation:
  - Unique key on `(project_id, target_id, item_id, schema_version_id)`.
  - Optimistic concurrency via version/timestamp check on update path.

## 11) EvidenceRecord

- Purpose: Stores metadata for evidence artifacts attached to domain events.
- Fields:
  - `id` (UUID, PK)
  - `project_id` (UUID, indexed)
  - `entity_type` (enum: `proposal|reviewer_decision|consensus_decision|published_state`)
  - `entity_id` (UUID, required)
  - `storage_path` (text, required)
  - `filename` (text, required)
  - `mime_type` (text, required)
  - `size_bytes` (int, required)
  - `uploaded_by` (UUID, required)
  - `created_at` (timestamptz, required)
- Validation:
  - `size_bytes <= 26214400` (25 MB).
  - MIME type in allowlist (`application/pdf`, `image/png`, `image/jpeg`, `text/plain`).

## State Transitions

## EvaluationRun.status

- `pending -> active -> completed`
- `pending -> active -> failed`
- `pending|active -> cancelled`

## ReviewerState.latest_decision

- Initialized as absent for each reviewer/target/item.
- Updated on each new reviewer decision record; history retained in append-only table.

## PublishedState

- Created on first successful consensus publication.
- Updated only through subsequent successful consensus event for same key using optimistic concurrency guard.

## Indexing and Integrity Notes

- Add composite indexes for:
  - `proposal_records(project_id, run_id, target_id, item_id, created_at desc)`
  - `reviewer_decision_records(project_id, reviewer_id, target_id, item_id, created_at desc)`
  - `consensus_decision_records(project_id, target_id, item_id, schema_version_id, created_at desc)`
  - `published_states(project_id, target_id, item_id, schema_version_id)`
- Enforce RLS by `project_id` for every new table.
- Track enum additions in `POSTGRESQL_ENUM_VALUES` per constitution.
