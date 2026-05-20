# Summary — 2026-05-20-0000-envelope-union-check

**Status:** `converged` (1/1 finding closed; envelope baseline 1 → 0).

## Findings

| ID | Severity | Confidence | Site |
|---|---|---|---|
| f_001 | medium | 1.0 | articles_export.py:98 — `Response | ApiResponse[ExportStartedResponse]` Union arm rejected by old matcher |

Closed in iteration 001 by extending the AST matcher in `scripts/fitness/check_api_response_envelope.py` to recognise PEP 604 unions, `typing.Union`, and `typing.Optional` where at least one arm is `ApiResponse[T]`. No source-code change to articles_export.py was needed — the matcher now accepts the existing legitimate Union shape.

## Final gate state

| Gate | Result |
|---|---|
| ruff format --check | OK |
| pytest envelope tests | 10/10 PASSED (was 6; 4 new union/optional canaries) |
| check_api_response_envelope.py | OK (no violations, baseline empty) |

## Why this matters

The envelope check now correctly distinguishes two failure modes:
- **Wrong envelope** (real violation): `-> dict`, `-> SomeModel`, bare `-> ApiResponse`
- **Streaming-or-envelope union** (legitimate): `-> Response | ApiResponse[T]`

This is exactly the kind of matcher refinement that the loop's design anticipates: a baseline entry that signals "the check is too strict here", and a check-improving iteration that removes the false positive WITHOUT making the check less rigorous (the new `test_rejects_union_without_apiresponse_arm` canary proves precision is preserved).

## Telemetry

- Wall-clock total: ≈ 5 s (1 pytest run + 1 fitness verification).
- Iterations: 1; loopbacks: 0; quarantined: 0; tokens (LLM): 0 (deterministic-only).
