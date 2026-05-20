# Summary — 2026-05-19-2310-backend-envelope-batch

**Status:** `converged` (9/10 grandfathered envelope violations closed in 1 batched iteration; deterministic gates green; baseline tightened 10 → 1).

## Findings (9 closed; 1 deliberately left baselined)

| ID | Severity | Confidence | Site |
|---|---|---|---|
| f_001…f_006 | high | 1.0 | user_api_keys.py (6 endpoints) |
| f_007 | high | 1.0 | model_extraction.py:extract_models |
| f_008 | high | 1.0 | section_extraction.py:extract_section |
| f_009 | high | 1.0 | zotero_import.py:zotero_action |

Not closed (out of scope for the simple Generic-only fix):
- `articles_export.py:start_export` returns `Response | ApiResponse[ExportStartedResponse]` — Union arm; the AST check's matcher (Subscript with value=Name="ApiResponse") rejects the Union form. Stays baselined; the cleanest fix is extending `check_api_response_envelope.py` to accept Unions where one arm is `ApiResponse[T]`.

## Final gate state

| Gate | Result |
|---|---|
| ruff check (4 endpoint files + scripts) | OK |
| ruff format --check (4 endpoint files) | 4 unchanged |
| check_api_response_envelope.py | OK; baseline now 1 grandfathered (was 10) |
| backend pytest | 539 passed, 31 skipped in 25.01s (no regression) |

## Telemetry

- Wall-clock total: ≈ 30 s deterministic (typecheck + pytest + fitness).
- Iterations: 1 (batched); loopbacks: 0; quarantined: 0; tokens (LLM): ≈ 0 (deterministic-only).

## What the loop earned

A small mechanical fix that brings the prumo backend much closer to the
`ApiResponse[T]` envelope invariant. Tightening the baseline from 10 → 1
means the next time anyone adds an endpoint, they will write
`ApiResponse[T]` correctly — no more "monkey-see, monkey-do" copying
of bare-`ApiResponse` returns from these grandfathered neighbours.

## Out-of-scope (next run candidates)

- `articles_export.py:start_export` Union form — needs check enhancement.
- 13 layered-arch violations in baseline (most under `api/v1/endpoints/extraction_runs.py`).
- 2 remaining `check_react_query_keys.baseline` entries (require shape audit).
- Stronger Pydantic response models replacing `dict[str, Any]` (separate refactor).
