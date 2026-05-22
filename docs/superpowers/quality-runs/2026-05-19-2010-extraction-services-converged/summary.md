# Summary — 2026-05-19-2010-extraction-services

**Status:** `converged` (6/6 findings closed; deterministic gates green within scope; full inferential re-SCAN deferred to next invocation).

## Scope

`backend/app/services/extraction_*` — 3 files, 450 LOC:
- `extraction_consensus_service.py`
- `extraction_proposal_service.py`
- `extraction_review_service.py`

## SCAN results (original)

| Category | Count | High | Medium | Low |
|---|---:|---:|---:|---:|
| concept-drift | 0 | 0 | 0 | 0 |
| layered-arch | 0 | 0 | 0 | 0 |
| security | 4 | 4 | 0 | 0 |
| legacy | 0 | 0 | 0 | 0 |
| test-gaps | 2 | 1 | 1 | 0 |
| **Total** | **6** | **5** | **1** | **0** |

All 6 findings had `confidence ≥ 0.75` (well above the 0.7 floor). 0 dropped.

## Iterations (3 — all RESOLVES)

### Iteration 001 — closed f_005 (test-gaps, high)
Commit [`d0e806a`](../../..) — added `test_list_by_run_returns_chronological_filtered_by_run_id` exercising the chronological + run-id filter contract. Cross-run seeding doubles as the counterfactual probe.

### Iteration 002 — closed f_006 (test-gaps, medium)
Commit [`78f1a66`](../../..) — added `test_get_reviewer_state_returns_none_for_unknown_coordinates` + `test_get_reviewer_state_returns_state_after_record_decision`. Two short tests cover the None edge case and explicit positive retrieval.

### Iteration 003 — closed f_001/f_002/f_003/f_004 (security, high — batched)
Commit [`25c06eb`](../../..) — introduced `backend/app/services/_extraction_run_lock.py` with `load_run_for_update(db, run_id)` issuing `SELECT … FOR UPDATE`. Refactored 4 service callsites
(`extraction_consensus_service.record_consensus`, `.publish`,
`extraction_proposal_service.record_proposal`,
`extraction_review_service.record_decision`) to use the helper.
Added `backend/tests/integration/test_extraction_run_lock.py` as the
TDD recurrence guard: two-session test that holds a FOR UPDATE on the
run row from session2, asserts session1's `record_proposal` blocks
within `asyncio.wait_for(..., timeout=1.5)` and raises TimeoutError.
Without the fix the test fails (no block); with it the test passes (1.64s wall).

## Final gate state

| Gate | Result | Detail |
|---|---|---|
| pytest (backend full suite) | 539 PASSED, 31 skipped (27.49s) | +5 tests vs Phase 0 baseline; no regression |
| pytest scoped to extraction_* services | 27 PASSED (3.47s) | includes the new TOCTOU concurrency test |
| ruff check | OK | 3 unused `ExtractionRun` imports trimmed during fix |
| ruff format (this run's 5 touched files) | OK | all 5 files clean |
| fitness/run_all.sh (7 checks) | OK (~1 s total) | 0 hard violations; baselines unchanged |
| `backend/app/services/extraction_*.py` grep for `db.get(ExtractionRun` | 0 matches | original TOCTOU pattern eradicated from scope |

## Out-of-scope (separate findings for next sweep)

These were observed during VERIFY but are outside this run-dir's scope; they enter the **next** loop invocation's backlog rather than block this one's convergence.

- **`ruff format` drift on 16 unrelated backend files** (test_template_clone_extraction.py, test_model_identification_prompt.py, …). Pre-existing on `dev` HEAD `77bc471`; documented in the original Phase 2 summary. The `make lint-backend` gate (only `ruff check`) is currently green; the stricter `ruff format --check` part of `scripts/verify_all.sh` and CI catches them. Recommended next backlog item: scoped `ruff format` PR on those 16 files.

## Telemetry recap

- Wall-clock total (SCAN + 3 iterations + VERIFY): ≈ 75 s deterministic + ≈ 68 s subagent SCAN = ≈ 2.5 min.
- Subagent calls: 5 (Phase 2 SCAN) — well under the 150-call hard cap.
- Tokens used: ≈ 19 600 (SCAN only) — well under the 500k hard cap.
- Iterations closed: 3 of 3; loopbacks: 0; quarantined: 0.

## What the loop earned

Six real architectural findings on critical HITL service code, closed in three small reversible commits with their own recurrence guards. The TOCTOU fix (iteration 003) is the highest-value change: it eliminates a real concurrency window in the run-stage transition path that would have been a hard-to-debug production incident.

## Next invocation

Suggested scope candidates for a follow-up sweep:
- `concept:hitl-session` — exercises `template_clone_service`, `hitl_session_service`, the API endpoints that compose them.
- `backend/app/api/v1/endpoints/extraction_runs.py` — the largest grandfathered layered-arch hotspot (4 forbidden imports).
- Whole `frontend/` — the 4 query-key grandfathered call sites + the 16 ruff-format drift backlog item.
