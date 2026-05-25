# Quickstart: Unified Evaluation Data Model

## 1) Preconditions

- Checked out branch `008-unified-evaluation-model`
- Backend and frontend dependencies installed
- Local Postgres/Redis/Supabase dev environment available
- This feature is delivered in dev clean-slate mode: deleting/resetting development data is expected and supported

## 1.1) Reset baseline (development only)

1. Drop/reset existing development data for affected evaluation tables if present.
2. Reapply migrations from scratch to establish the target schema.
3. Do not implement legacy data migration scripts for this scope.

## 2) Implement backend data model and migrations

1. Add SQLAlchemy models for:
   - schema + versions + items
   - runs + run targets
   - proposal/reviewer/consensus append-only records
   - reviewer state materialized view table
   - published state authoritative table
   - evidence records
2. Add/extend PostgreSQL enum registrations in `app/models/base.py`.
3. Generate Alembic migration:
   - `make db-generate MSG="unified evaluation data model"`
4. Validate migration boundaries:
   - Ensure only `public` schema objects are touched.
5. Apply migration:
   - `cd backend && uv run alembic upgrade head`

## 3) Implement repositories and services

1. Create repositories under `backend/app/repositories/` for each aggregate.
2. Create service orchestration under `backend/app/services/`:
   - run creation and stage transitions
   - proposal generation kickoff (async/Celery)
   - reviewer decision append + reviewer state update
   - consensus publication with optimistic concurrency (`409` on conflict)
3. Ensure services return domain objects, not HTTP responses.

## 4) Implement API endpoints and schemas

1. Add Pydantic request/response schemas under `backend/app/schemas/`.
2. Add endpoints under `backend/app/api/v1/endpoints/` matching contract:
   - `POST /evaluation-runs`
   - `GET /evaluation-runs/{runId}`
   - `POST /evaluation-runs/{runId}/proposal-generation`
   - `GET /review-queue`
   - `POST /reviewer-decisions`
   - `POST /consensus-decisions`
   - `POST /evidence-attachments/presign`
3. Enforce:
   - project-scoped authorization
   - manual override justification
   - evidence type/size constraints
   - response envelope + trace_id

## 5) Integrate frontend workflow

1. Extend `frontend/integrations/api/client.ts` types/services for new endpoints.
2. Add TanStack Query hooks for run summary and review queue.
3. Update reviewer and consensus UI flows:
   - independent reviewer decisions
   - conflict handling for concurrent publish (`409`)
   - upload flow for evidence attachments within allowlist

## 6) Observability and operations

1. Add structured log events for:
   - run lifecycle transitions
   - reviewer decisions
   - consensus conflicts
2. Emit metrics for:
   - run duration
   - stage failures
   - publish conflict count
   - proposal/review queue backlog

## 7) Verification checklist

- Backend lint/type/tests:
  - `cd backend && make lint`
  - `cd backend && make test`
- Frontend lint/type/tests:
  - `cd frontend && npm run lint`
  - `cd frontend && npm run test`
- End-to-end path:
  - create run -> generate proposals -> submit independent decisions -> publish consensus
- Schema safety:
  - verify type-change prevention after extraction in active schema version
  - verify add/remove/new choice item behavior through new schema version
- Clean-slate reliability:
  - verify full reset -> migration -> test run passes without legacy data migration steps

## 8) Verification notes (implementation run)

- Backend focused suites executed with `uv run pytest`:
  - `tests/integration/test_evaluation_runs.py` + `test_evaluation_proposal_generation.py` + `test_evaluation_schema_versions.py` -> `5 passed`
  - `tests/integration/test_evaluation_reviewer_decisions.py` + `test_evaluation_reviewer_state.py` -> `2 passed`
  - `tests/integration/test_evaluation_consensus_publish.py` + `test_evaluation_consensus_conflicts.py` + `test_evaluation_evidence_upload.py` + schema-promotion suites -> `7 passed`
- Repository lint status:
  - `npm run lint` completed with no errors (existing unrelated warnings remain in extraction e2e/table files).
