# Summary — 2026-05-20-0030-extraction-runs-layered-arch

**Status:** `converged` (6/6 findings closed in 1 batched iteration; layered-arch baseline reduced 13 → 7).

## Findings (all closed)

| ID | Severity | Confidence | Site (imported module) |
|---|---|---|---|
| f_001 | high | 1.0 | extraction_runs.py → `app.models.extraction` |
| f_002 | high | 1.0 | extraction_runs.py → `app.models.extraction_workflow` |
| f_003 | high | 1.0 | extraction_runs.py → `app.models.user` |
| f_004 | high | 1.0 | extraction_runs.py → `app.repositories.extraction_consensus_decision_repository` |
| f_005 | high | 1.0 | extraction_runs.py → `app.repositories.extraction_proposal_repository` |
| f_006 | high | 1.0 | extraction_runs.py → `app.repositories.extraction_reviewer_decision_repository` |

All closed in iteration 001 by extracting `ExtractionRunReadService` and refactoring the two endpoints (`get_run`, `list_run_reviewers`) plus the `_load_run_and_check_member` helper to import only from services + schemas.

## Final gate state

| Gate | Result |
|---|---|
| ruff check + format | OK |
| backend pytest | 543 passed, 31 skipped (no regression) |
| check_layered_arch | OK; baseline reduced 13 → 7 |
| fitness/run_all.sh (7 checks) | all green (~1 s) |

## What the loop earned

`extraction_runs.py` now exemplifies clean layered-architecture: imports only `app.services.*` and `app.schemas.*`. The endpoint is no longer a half-controller / half-data-access mishmash — every SQL query lives in a service. Future endpoints touching the same domain can mirror this pattern without paying the design cost.

The remaining 7 layered-arch violations are spread across 6 smaller endpoint files (`article_text_blocks`, `articles_export`, `citations`, `hitl_sessions`, `project_templates`, `zotero_import`), each carrying 1–2 entries. Same fix shape; the leverage is similar to this iteration but the volume is split across many small files.

## Telemetry

- Wall-clock total: ≈ 40 s (lint + pytest + fitness).
- Iterations: 1 (batched); loopbacks: 0; quarantined: 0; tokens (LLM): 0 (deterministic-only).
