# Iteration 001 — f_001…f_006 (batched): extract `ExtractionRunReadService`

## Findings

All 6 are `layered-arch` violations in `extraction_runs.py` — 3 direct model imports + 3 direct repository imports. Same shape, same fix, same recurrence guard.

## Why batch

Closing them one-by-one would mean 6 commits each pulling out one query at a time, leaving the file in inconsistent half-refactored states between iterations. The cleanest end state is "endpoint imports only services + schemas". A single batched diff achieves that end state in one move, well under 300 LOC.

## PLAN

Create `backend/app/services/extraction_run_read_service.py` exporting:

- `RunNotFoundError` — domain exception (HTTP-aware translation lives in the endpoint).
- `get_run_or_raise(db, run_id) -> RunSummaryResponse` — replaces the `db.get(ExtractionRun, run_id)` + 404 check in `_load_run_and_check_member`. Returns a Pydantic schema (not the ORM type) so the endpoint never touches `app.models.*`.
- `get_run_with_workflow_history(db, run_id) -> RunDetailResponse` — owns the 3 repository instantiations + the published-state query from the old `get_run` endpoint body. Returns the response schema directly.
- `list_run_participants(db, run_id) -> list[RunReviewerProfile]` — owns the 3 `select(Model)` user-id aggregations + the Profile lookup from the old `list_run_reviewers` endpoint body.

Endpoint refactor:
- Drop the 6 forbidden imports + the unused `from sqlalchemy import select`.
- `_load_run_and_check_member` calls `get_run_or_raise`, catches `RunNotFoundError`, translates to `HTTPException(404)`. Return type changes from `ExtractionRun` → `RunSummaryResponse`.
- `get_run` body becomes 3 lines: `_load_run_and_check_member` + `get_run_with_workflow_history` + `ApiResponse.success`.
- `list_run_reviewers` body becomes 3 lines: `_load_run_and_check_member` + `list_run_participants` + `ApiResponse.success`.

Baseline cleanup: remove the 6 `extraction_runs.py:*` lines from `check_layered_arch.baseline`.

## DIFF

| File | Change |
|---|---|
| `app/services/extraction_run_read_service.py` (new) | ~155 LOC: domain exception + 3 service functions |
| `app/api/v1/endpoints/extraction_runs.py` | -6 forbidden imports; -unused `select` import; -inline SQL in 2 endpoints; +service-import block; helper return-type changes to `RunSummaryResponse`. Body of `get_run` 23 → 6 LOC, `list_run_reviewers` 67 → 5 LOC. |
| `scripts/fitness/check_layered_arch.baseline` | -6 entries |

Total: ~155 LOC added (service), ~80 LOC removed (endpoint), -6 baseline entries.

## Gate output

```
ruff check (extraction_runs.py + read_service.py): All checks passed!
ruff format --check: 2 files reformatted (auto-applied)
check_layered_arch.py: OK (55 ms; 7 edges checked, 7 grandfathered) [was: 13 grandfathered]
backend pytest -q: 543 PASSED, 31 skipped in 26.47s (no regression)
fitness/run_all.sh (7 checks): OK (~1 s total; all green)
```

## Counterfactual probe

Reverting the diff (restoring the 6 model/repo imports + the inline SQL + the baseline entries) returns the codebase to the pre-iteration state where the check tolerates the violations. The non-vacuous proof is the tightened baseline: the 6 imports are GONE from extraction_runs.py and the baseline no longer mentions them. Any future regression re-importing from `app.models` or `app.repositories` in this file would fail check_layered_arch at PR time.

A secondary check: `get_run` and `list_run_reviewers` endpoints' behaviour was preserved (no integration test broke). The pytest suite includes the integration coverage for these endpoints, and 543 tests still pass.

## Judge verdict

```
RESOLVES
Endpoint now imports only services + schemas (zero direct model/repo coupling); read-service owns the SQL and returns schemas; baseline reduced 13 → 7; 543 backend tests pass with no regression; the tightened baseline IS the recurrence guard for the now-removed 6 violations.
```

## Reflexion (iteration 001)

**What could still go wrong:** The service returns ORM-validated Pydantic schemas (`RunSummaryResponse.model_validate(run)`), so the schema fields shadow the model fields. If a future migration adds a column to `extraction_runs` without updating `RunSummaryResponse`, the endpoint silently loses access to the new column — and existing tests would not catch it because the test data wouldn't exercise the new column.

**What I'd do differently next time:** Pair this refactor with a `test_schema_drift.py` check that asserts `RunSummaryResponse` field set ⊇ `ExtractionRun.__table__.columns` (modulo a known-exempt list). That makes schema drift visible at PR time the same way the envelope check is.
