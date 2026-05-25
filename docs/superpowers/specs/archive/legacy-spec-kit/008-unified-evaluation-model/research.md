# Research: Unified Evaluation Data Model

## Decision 1: Consensus publish concurrency uses optimistic locking

- Decision: Enforce first-writer-wins with explicit conflict (`409`) for concurrent consensus publication on the same project-target-item-schema tuple.
- Rationale: Preserves auditability, prevents silent overwrite, and keeps authoritative state deterministic.
- Alternatives considered:
  - Last-write-wins: rejected due to data loss risk and weak governance traceability.
  - Serialized global queue: rejected due to avoidable latency and operational complexity.

## Decision 2: Authoritative published state scope is global per project-target-item-schema version

- Decision: Maintain exactly one authoritative published state per `(project_id, target_id, item_id, schema_version_id)` independent of run.
- Rationale: Ensures downstream readers consume a single canonical truth and avoids run-fragmented publication state.
- Alternatives considered:
  - Run-scoped publication state: rejected because downstream consumers would need run-aware reconciliation.
  - Schema-agnostic publication state: rejected because schema version compatibility would be lost.

## Decision 3: Evidence attachments are constrained and validated server-side

- Decision: Support evidence files up to 25 MB, with allowed types `PDF`, `PNG`, `JPG/JPEG`, `TXT`.
- Rationale: Balances reviewer usability with bounded storage and upload abuse risk; straightforward to validate in API and storage adapters.
- Alternatives considered:
  - URL-only evidence: rejected because it weakens artifact durability and governance.
  - Any file type up to 100 MB: rejected due to malware, storage cost, and processing risk.

## Decision 4: Schema evolution after extraction start locks item types

- Decision: Once extraction exists for a schema version, item type is immutable; allowed evolution is rename metadata changes for existing items plus add/remove items through a new schema version, including multiple-choice/select item types.
- Rationale: Protects semantic consistency of historical values and avoids hidden recopy assumptions.
- Alternatives considered:
  - Automatic value recopy into changed types: rejected because semantic drift can produce invalid historical interpretation.
  - In-place type mutation on active schema version: rejected due to breaking traceability and validator consistency.

## Decision 5: Observability baseline is structured logs plus core metrics

- Decision: Emit structured logs and metrics for run duration, stage failures, publish conflict count, and proposal/review queue backlog.
- Rationale: Provides actionable operations visibility for v1 without requiring full distributed tracing rollout.
- Alternatives considered:
  - Logs-only baseline: rejected due to weak quantitative alerting.
  - Full tracing mandatory in v1: rejected as disproportionate rollout complexity for initial scope.

## Decision 6: Migration ownership follows constitution split boundaries

- Decision: Persist evaluation domain tables, indexes, constraints, and enums via Alembic in `backend/alembic/versions`, while keeping Supabase-managed auth/storage concerns outside this feature scope.
- Rationale: Prevents schema drift and keeps migration governance aligned with repository standards.
- Alternatives considered:
  - Mixed Alembic/Supabase ownership for app tables: rejected because it complicates ownership and validation.
  - Manual SQL migrations outside standard workflow: rejected due to review and rollback risk.
