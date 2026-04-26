# Unified Evaluation Clean-Slate Guide

## Scope

This guide defines a development-only reset for the unified evaluation model rollout.

## Reset sequence

1. Ensure no local process is writing to evaluation tables.
2. Drop development data for:
   - `evaluation_schemas`
   - `evaluation_schema_versions`
   - `evaluation_items`
   - `evaluation_runs`
   - `evaluation_run_targets`
   - `proposal_records`
   - `reviewer_decision_records`
   - `reviewer_states`
   - `consensus_decision_records`
   - `published_states`
   - `evidence_records`
3. Re-run migrations from baseline:
   - `cd backend && uv run alembic upgrade head`
4. Execute focused integration tests for run/review/consensus paths.

## Constraints

- This process is for local/dev environments only.
- No legacy production migration is included in this feature scope.
- Any reset must preserve migration ownership under Alembic.
