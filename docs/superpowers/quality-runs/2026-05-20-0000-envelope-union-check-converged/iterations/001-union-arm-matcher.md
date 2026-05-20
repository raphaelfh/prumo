# Iteration 001 — f_001: extend envelope matcher for Union arms

## Finding

```
f_001 [medium/1.0] articles_export.py:98  start_export returns Response | ApiResponse[ExportStartedResponse]
```

The check's AST matcher only accepted plain `ApiResponse[T]` (a Subscript with value=Name="ApiResponse"). The Union form (BinOp with BitOr op) was rejected even when one arm IS `ApiResponse[T]`. articles_export.py:start_export legitimately uses this shape: the endpoint can return a streaming binary `Response` (sync export) OR an envelope `ApiResponse[ExportStartedResponse]` (async job started).

## PLAN

Extend `_is_api_response_annotation` in `scripts/fitness/check_api_response_envelope.py` to accept:
- `ApiResponse[T]` (existing)
- `X | ApiResponse[T]` (PEP 604 `ast.BinOp` with `ast.BitOr` op — recurse on both sides)
- `Union[X, ApiResponse[T]]` (legacy `typing.Union` — Subscript with value=Name="Union" → recurse on each tuple-arm)
- `Optional[ApiResponse[T]]` (legacy `typing.Optional` — Subscript with value=Name="Optional" → recurse on inner arg)

Add 4 canary tests proving:
- PEP 604 union with ApiResponse arm → accepted
- typing.Union with ApiResponse arm → accepted
- Optional[ApiResponse[T]] → accepted
- Union without ApiResponse arm (`Response | dict`) → still rejected (matcher is precise, not permissive)

Remove `articles_export.py:start_export` from `check_api_response_envelope.baseline` (the new matcher accepts it automatically — no source-code change to the endpoint needed).

## DIFF

- `scripts/fitness/check_api_response_envelope.py` — `_is_api_response_annotation` becomes recursive across BinOp/Union/Optional shapes (~25 LOC, well-documented).
- `backend/tests/unit/scripts/test_check_api_response_envelope_canary.py` — 4 new canaries (~70 LOC).
- `scripts/fitness/check_api_response_envelope.baseline` — file cleared (only the comment block remains).

## Gate output

```
ruff format --check (scripts + tests): 2 files left unchanged
pytest tests/unit/scripts/test_check_api_response_envelope*.py: 10 PASSED in 0.38s
  - 1 green-path
  - 5 original canaries
  - 4 new canaries (pep604, typing.Union, Optional, union-without-arm)
python3 scripts/fitness/check_api_response_envelope.py: OK (11 ms; no violations)
```

## Counterfactual probe

The `test_rejects_union_without_apiresponse_arm` canary plants
`-> Response | dict` (a Union where NEITHER arm is ApiResponse) and
asserts the check still fails. If the matcher had been made too
permissive (e.g. accepting ANY BinOp regardless of arms), this canary
would FAIL — proving the extension is precise, not blanket-permissive.

## Judge verdict

```
RESOLVES
Matcher extended to accept Union-with-ApiResponse-arm shapes (PEP 604, typing.Union, Optional); baseline 1 → 0; 10/10 envelope tests green (including the precision-canary that rejects union-without-ApiResponse); articles_export.py:start_export passes automatically without source edits.
```

## Reflexion (iteration 001)

**What could still go wrong:** The recursive matcher walks BinOp arms one level deep — deeply nested unions like `(A | B) | ApiResponse[T]` work because Python parses left-associative (BinOp(BinOp(A,|,B), |, ApiResponse[T])), and my code recurses on both sides at every level. But unusual shapes like `Awaitable[ApiResponse[T]]` (a coroutine result type) would still fail — likely correct behaviour but worth noting if FastAPI ever introduces async-aware return types.

**What I'd do differently next time:** Add a test specifically for the deeply-nested union case (`A | B | ApiResponse[T]`) so a future refactor that simplifies the recursion can't accidentally regress that shape.
