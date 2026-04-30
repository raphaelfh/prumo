# Unified Evaluation Observability

## Core metrics

- `evaluation_duration_metric`: emitted by run and stage timers.
- `evaluation_stage_failure`: emitted whenever a stage transition fails.
- `evaluation_publish_conflict`: emitted on optimistic-lock publish conflicts.
- `evaluation_queue_backlog_check`: backlog gauge event with threshold metadata.
- `evaluation_queue_backlog_scale_alert`: alert event when backlog is greater than 500 for at least 15 minutes.

## Structured event examples

- `evaluation_event` with `event_name=evaluation_run_created`
- `evaluation_event` with `event_name=evaluation_reviewer_decision_submitted`
- `evaluation_event` with `event_name=evaluation_consensus_published`
- `evaluation_event` with `event_name=evaluation_schema_promoted`

## Suggested queries

- Run duration trend:
  - filter `metric_name=evaluation_run_total_duration_ms`
- Publish conflict counter:
  - count `evaluation_publish_conflict` by `schema_version_id`
- Backlog scaling alert:
  - filter `evaluation_queue_backlog_scale_alert`
  - group by `project_id`
# Extraction E2E and Database Observability

## Goal

Measure extraction behavior end to end (browser -> API -> service -> database), capturing:

- latency by extraction phase
- latency of critical database operations
- correlated errors with `trace_id` and `extraction_run_id`

## E2E suite

- Test file: `frontend/e2e/extraction-observability.e2e.ts`
- Runner: Playwright (`playwright.config.ts`)
- Script:

```bash
npm run test:e2e:baseline
```

## Required environment variables

The baseline test needs real credentials and IDs:

- `E2E_FRONTEND_URL`
- `E2E_API_URL`
- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`
- `E2E_PROJECT_ID`
- `E2E_ARTICLE_ID`
- `E2E_TEMPLATE_ID`
- `E2E_ENTITY_TYPE_ID`

Optional database validation through Supabase REST:

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_SERVICE_ROLE_KEY`

## Instrumented points

### Request/flow correlation

- `frontend/integrations/api/client.ts` sends `X-Trace-Id`.
- extraction endpoints reuse `request.state.trace_id`.

### Endpoint timings

- `backend/app/api/v1/endpoints/model_extraction.py`
- `backend/app/api/v1/endpoints/section_extraction.py`

Captured:

- endpoint total duration
- commit latency
- rollback latency when errors happen

### Service phase timings

- `backend/app/services/model_extraction_service.py`
- `backend/app/services/section_extraction_service.py`

Captured phases include:

- PDF download
- PDF text extraction
- template/entity loading
- LLM call
- suggestion/model persistence
- run completion update

### Database operation timings

- `backend/app/repositories/base.py`
- `backend/app/repositories/extraction_repository.py`
- `backend/app/repositories/extraction_run_repository.py`

Captured:

- create/update/delete latency
- critical extraction queries latency
- extraction run state update latency

## How to inspect results

1. Run baseline suite.
2. Collect `trace_id` from test annotations/log output.
3. Filter backend logs by `trace_id`.
4. Confirm `extraction_runs.results.phase_durations_ms`.
5. Compare:
   - `endpoint_duration_ms` vs sum of service phases
   - `db_duration_ms` hotspots across repositories

## Latest baseline snapshot (remote Supabase)

- test command: `npm run test:e2e:baseline`
- browser login: success
- extraction API status:
  - models endpoint: `200`
  - sections endpoint: `200`
- measured API latency (wall time from Playwright):
  - model extraction request: `~4675ms`
  - section extraction request: `~6054ms`
- correlated trace example emitted by test:
  - `trace_id=e2e-1777177797717-e5e7f3ec`

Operational note:

- when backend process is running with stale environment/runtime state, extraction can fail with storage errors; restarting backend restored consistent storage behavior in this environment.
- startup hardening added: backend now validates storage bucket `articles` reachability during startup and exposes readiness in `/health.checks`.

Latest post-hardening run:

- `trace_id=e2e-1777177996727-b12b5eed`
- `model_status=200`, `model_api_ms=9219`
- `section_status=200`, `section_api_ms=8154`

## Known trade-offs

- Service-level DB timing is based on application-side wall time, not database execution plan.
- Remote Supabase baseline can vary by network and platform load.
- More logging increases payload volume; keep ingestion and retention configured accordingly.

## Next optimization steps

1. Add SQL-level `statement_timeout` and lock timeout configuration.
2. Export structured logs to centralized observability (OTel/APM).
3. Build percentile dashboards (`p50/p95/p99`) per extraction phase and DB operation.
