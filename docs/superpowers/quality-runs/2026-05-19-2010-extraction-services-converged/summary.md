# Summary — 2026-05-19-2010-extraction-services

**Status:** `scan_complete` (Phase 2 SCAN-only proof-of-concept; APPLY phase deferred to Phase 5 first real sweep)

## Scope

`backend/app/services/extraction_*` — 3 files, 450 LOC:
- `extraction_consensus_service.py`
- `extraction_proposal_service.py`
- `extraction_review_service.py`

## SCAN results

| Category | Count | High | Medium | Low |
|---|---:|---:|---:|---:|
| concept-drift | 0 | 0 | 0 | 0 |
| layered-arch | 0 | 0 | 0 | 0 |
| security | 4 | 4 | 0 | 0 |
| legacy | 0 | 0 | 0 | 0 |
| test-gaps | 2 | 1 | 1 | 0 |
| **Total** | **6** | **5** | **1** | **0** |

All 6 findings have `confidence ≥ 0.75` (well above 0.7 floor). 0 findings dropped.

## High-confidence findings (backlog priority)

### 1–4: TOCTOU race in run-stage transitions

Four high-severity (`confidence=0.9–0.95`) security findings: `extraction_consensus_service.py:58`, `:154`, `extraction_proposal_service.py:41`, `extraction_review_service.py:49`. All follow the same pattern:

```python
run = await self.db.get(ExtractionRun, run_id)
if run is None:
    raise ...
if run.stage != ExtractionRunStage.<EXPECTED>.value:
    raise ...
# ... append to extraction_proposal_records / extraction_reviewer_decisions / etc.
```

Between the stage check and the append, a concurrent `run_lifecycle_service.advance_stage()` can advance the run; the appended row lands on a run in the wrong stage. **Fix:** `SELECT ... FOR UPDATE` row lock when loading `run`, OR a CHECK constraint enforcing valid stage transitions at the DB level.

**Recurrence guard required:** integration test that exercises the race with two concurrent sessions.

### 5: `extraction_proposal_service.list_by_run` has no test

`backend/app/services/extraction_proposal_service.py:99` — public function with no integration test. **Fix:** add `backend/tests/integration/test_extraction_proposal_service_list_by_run.py` asserting chronological order + run-id filter.

### 6: `extraction_review_service.get_reviewer_state` lacks edge-case test

`backend/app/services/extraction_review_service.py:106` — `get_reviewer_state` only exercised as a side effect of `record_decision` tests; no test for the `None` return case (unknown coordinates). **Fix:** add explicit unit test for `get_reviewer_state` returning `None` and for direct positive retrieval.

## Telemetry

- Duration (wall): 5 subagents in parallel ≈ 68 s
- Subagent calls: 5 (well under 150 hard cap)
- Tokens used: ≈ 19 600 (well under 500k hard cap)
- Resumed from: (none — fresh run)

## Phase 2 acceptance — fulfilled

| Check | Result |
|---|---|
| Run-dir exists | ✅ `2026-05-19-2010-extraction-services/` |
| `findings.jsonl` non-empty | ✅ 6 rows |
| `telemetry.jsonl` non-empty | ✅ 8 rows |
| All findings ≥ 0.7 confidence | ✅ lowest is 0.75 |
| ≥1 category present | ✅ security + test-gaps |
| Budget within cap | ✅ 10 subagent_calls / 150 hard cap; 39 200 tokens / 500 000 hard cap |
| Schema validates | ✅ `jq -c '.category'` returns clean enum |

## Why Phase 2 stops here (no APPLY)

By design — Phase 2 is the **SCAN-only** phase. The orchestrator has all pieces of the loop, but APPLY/VERIFY/CONVERGE require driving a finding through a worktree-isolated diff + LLM judge. Those phases ship in Phase 5 (first real sweep) where the orchestrator picks a finding from this backlog and closes it end-to-end.

## Side finding (out-of-scope but recorded)

While building `scripts/verify_all.sh` (Phase 3), we discovered the prumo `dev` baseline has **16 backend files with pre-existing `ruff format --check` drift** that are not in the scope of this scan. They are tracked as a separate baseline issue for the Phase 5 first real sweep to address.

## Next steps

- Phase 5 first real sweep can resume this run-dir (idempotency: same `scope_hash`) OR pick a fresh slice. The 6 findings above are excellent first-fix candidates for proving the full loop on a real-world TOCTOU bug.
- Phase 6 CI integration will mean each PR sees `scripts/fitness/run_all.sh` as an advisory gate; the security findings above would have been caught at PR-time had this loop existed.
