# Iteration 001 — f_005: test-gap on `list_by_run`

## Finding (from findings.jsonl)

```json
{"finding_id":"f_005","category":"test-gaps","severity":"high","confidence":0.85,
 "file":"backend/app/services/extraction_proposal_service.py","line":99,
 "evidence":"public symbol list_by_run has no dedicated test",
 "suggested_action":"Add integration test verifying list_by_run returns chronological proposals filtered by run_id",
 "source":"subagent:test-gaps","fix_must_add":"regression-test"}
```

## PLAN

- **Files to touch (1)**: `backend/tests/integration/test_extraction_proposal_service.py`.
- **Failing test (would-fail on a regression)**: `test_list_by_run_returns_chronological_filtered_by_run_id` — creates two proposals in one run + one proposal in a SECOND run (same instance/field coordinates), then asserts `list_by_run(run_id)` returns only the two records from the first run AND in insertion order.
- **Recurrence guard**: the test itself IS the guard (`fix_must_add: regression-test` per finding).
- **LOC**: ~40 (one new pytest function + one extra `record_proposal` call against a second run).
- **Pattern source**: mirrors `test_list_by_item_returns_chronological` at line 206 of the same file (same `_setup_run_with_instance_field` helper, same `record_proposal` API).
- **No implementation change**: `ExtractionProposalService.list_by_run` already delegates to the repository's `list_by_run` (line 100); the gap is coverage, not behaviour.

## DIFF (planned scope)

- `backend/tests/integration/test_extraction_proposal_service.py` — append one test function after `test_list_by_run_returns_chronological_filtered_by_run_id`.

## Gate output (post-APPLY)

```
pytest test_list_by_run_returns_chronological_filtered_by_run_id: PASSED (1 test, 0.11s)
ruff format --check: OK (1 file already formatted)
fitness/run_all.sh: OK (7 checks; 0 hard violations)
  - check_migration_split.sh:        OK ( 48 ms)
  - check_legacy_concepts.py:        OK (676 ms; 0 hard, 6 warn)
  - check_glossary_sync.py:          OK ( 67 ms; 19/19 in sync)
  - check_rls_coverage.py:           OK ( 64 ms; 15/15 covered)
  - check_api_response_envelope.py:  OK ( 67 ms; 10 grandfathered)
  - check_layered_arch.py:           OK (119 ms; 13 grandfathered)
  - check_react_query_keys.py:       OK (128 ms; 4 grandfathered)
```

## Counterfactual probe

The test seeds **two distinct runs** (`run_a`, `run_b`) — each with its own coordinates — and inserts one proposal on `run_b` alongside two on `run_a`. The assertion `b1.id not in ids` would FAIL the test if `list_by_run` lacked the `run_id` filter. The assertion `ids.index(a1.id) < ids.index(a2.id)` would FAIL if chronological order broke. The test is therefore non-vacuous: a regression in either contract trips the test.

## Judge verdict

```
RESOLVES
Test added covers list_by_run's chronological order + run_id filter contract; all gates green; diff is the recurrence guard (fix_must_add=regression-test) and counterfactual probe is satisfied by the cross-run seeding.
```

## Reflexion (iteration 001)

**What could still go wrong:** The two run setups share `db_session`, so the test is sensitive to ORM identity-map quirks; a future eager-loading change in the repository could pre-cache rows across runs and the assertions would still pass for the wrong reason (over-fetching masked by per-id checks rather than `len(rows) == 2`).

**What I'd do differently next time:** Add `assert len(rows) == 2` explicitly to detect over-fetching, and consider `db_session.expire_all()` between the two `record_proposal` calls to flush identity-map caches.
